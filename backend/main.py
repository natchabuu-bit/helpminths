from __future__ import annotations

import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.images import decode_image, read_upload
from backend.model import ModelNotReadyError, YOLOModelService
from backend.request_limits import RequestBodyLimitMiddleware
from backend.platform.auth import require_user, router as auth_router
from backend.platform.quality import QualityThresholds, assess_quality, enforce_quality, image_work_slot, quality_router
from backend.platform.store import PlatformStore

logger = logging.getLogger(__name__)


class HealthResponse(BaseModel):
    status: str
    model_ready: bool
    model_name: str | None
    message: str


class Detection(BaseModel):
    id: str
    class_id: int
    label: str
    confidence: float
    bbox: tuple[float, float, float, float]


class AnalysisResponse(BaseModel):
    id: str
    filename: str
    width: int
    height: int
    model: str
    model_version: str | None = None
    duration_ms: int
    inference_ms: int | None = None
    detections: list[Detection]
    quality: dict[str, Any] | None = None
    storage: str = "session_only"


def create_app(
    service: YOLOModelService | None = None,
    *,
    static_dir: str | Path | None = None,
    platform_dir: str | Path | None = None,
) -> FastAPI:
    model_service = service if service is not None else YOLOModelService()
    store = PlatformStore(platform_dir)
    QualityThresholds.from_environment()  # Reject invalid heuristic configuration at startup.
    serve_web = os.getenv("HELPMINTHS_SERVE_WEB") == "1"
    web_dir = Path(static_dir) if static_dir is not None else Path(__file__).resolve().parents[1] / "dist"

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if serve_web and not (web_dir.is_dir() and (web_dir / "index.html").is_file()):
            raise RuntimeError(
                "HELPMINTHS_SERVE_WEB=1 requires the built frontend in dist/. "
                "Run npm ci and npm run build from the repository root before starting the API."
            )
        await run_in_threadpool(model_service.load)
        yield

    app = FastAPI(title="HelpMinths AI API", version="2.0.0", lifespan=lifespan)
    app.state.platform_store = store
    app.state.model_service = model_service
    app.add_middleware(RequestBodyLimitMiddleware)

    @app.exception_handler(RequestValidationError)
    async def safe_validation_error(_request, exc: RequestValidationError):
        # Pydantic's default `input`/`ctx` may contain passwords or private payloads.
        errors = [{"loc": list(error.get("loc", ())), "msg": error.get("msg", "ข้อมูลไม่ถูกต้อง"),
                   "type": error.get("type", "validation_error")} for error in exc.errors()]
        return JSONResponse(status_code=422, content={"detail": errors})

    @app.middleware("http")
    async def private_api_responses(request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
            response.headers["Pragma"] = "no-cache"
            response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        return response

    @app.get("/api/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(status="ok", model_ready=model_service.ready,
                              model_name=model_service.name, message=model_service.message)

    @app.post("/api/analyze", response_model=AnalysisResponse)
    async def analyze(
        request: Request,
        image: Annotated[UploadFile, File(description="JPEG, PNG or WebP, up to 20 MB; temporary analysis only")],
        confidence: Annotated[float, Form(ge=0.01, le=0.99)] = 0.15,
        acknowledge_quality: Annotated[bool, Form()] = False,
        quality_comment: Annotated[str, Form(max_length=1000)] = "",
    ) -> AnalysisResponse:
        """Backward-compatible ephemeral inference; never creates a clinical record."""
        started = time.perf_counter()
        try:
            if store.configured:
                # The compatibility route must not bypass the account-mode
                # inference permissions enforced on the persistent endpoint.
                user = require_user(request)
                if user['role'] not in {'admin', 'reviewer', 'lab'}:
                    raise HTTPException(403, 'บัญชีนี้ไม่มีสิทธิ์วิเคราะห์ภาพด้วย AI')
            with image_work_slot():
                decoded = await run_in_threadpool(decode_image, await read_upload(image))
                try:
                    if not model_service.ready:
                        raise HTTPException(503, model_service.message)
                    assessment = await run_in_threadpool(assess_quality, decoded)
                    enforce_quality(assessment, acknowledge_quality, quality_comment)
                    inference_started = time.perf_counter()
                    detections = await run_in_threadpool(model_service.predict, decoded, confidence)
                    inference_ms = round((time.perf_counter() - inference_started) * 1000)
                    filename = (image.filename or "image").replace("\\", "/").rsplit("/", 1)[-1]
                    return AnalysisResponse(
                        id=uuid.uuid4().hex, filename=filename, width=decoded.width,
                        height=decoded.height, model=model_service.name or "YOLO",
                        model_version=getattr(model_service, "version", None),
                        duration_ms=round((time.perf_counter() - started) * 1000),
                        inference_ms=inference_ms, detections=detections, quality=assessment,
                    )
                finally:
                    decoded.close()
        except ModelNotReadyError as exc:
            raise HTTPException(503, str(exc)) from None
        except HTTPException:
            raise
        except Exception as exc:
            logger.warning("Image inference failed (%s)", type(exc).__name__)
            raise HTTPException(500, "ประมวลผลภาพไม่สำเร็จ กรุณาตรวจสอบบริการหรือโมเดล") from None
        finally:
            await image.close()

    app.include_router(auth_router)
    app.include_router(quality_router)
    # Domain routers use the same service, authorization and private transactional store.
    from backend.platform import analyses, reviews, reporting, analytics, feedback, modelversions, evaluation, learning
    for module in (analyses, reviews, reporting, analytics, feedback, modelversions, evaluation, learning):
        app.include_router(module.router)

    if serve_web:
        @app.api_route("/api", methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
        @app.api_route("/api/{path:path}", methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
        async def unknown_api(path: str = ""):
            raise HTTPException(404, "Not Found")
        app.mount("/", StaticFiles(directory=web_dir, html=True, check_dir=False), name="web")
    return app


app = create_app()
