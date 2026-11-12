from __future__ import annotations

import asyncio
import logging
import io
import os
import re
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.images import MAX_IMAGE_PIXELS, MAX_UPLOAD_BYTES, decode_image, decode_image_details, read_upload, supported_image_formats
from backend.model import ModelNotReadyError, YOLOModelService
from backend.request_limits import RequestBodyLimitMiddleware
from backend.platform.auth import require_user, router as auth_router
from backend.platform.admin_archive import create_archive_image, update_archive_image
from backend.platform.owner_bootstrap import bootstrap_owner
from backend.platform.persistence import create_platform_store
from backend.platform.quality import QualityThresholds, assess_quality, enforce_quality, image_work_slot, quality_router
from backend.platform.store import PlatformStore, utc_now

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
    store = create_platform_store(platform_dir)
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
    app.state.owner_bootstrap = bootstrap_owner(store)
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

    @app.get("/api/images/formats")
    def image_formats() -> dict[str, Any]:
        return {"formats": supported_image_formats(), "max_bytes": MAX_UPLOAD_BYTES,
                "max_pixels": MAX_IMAGE_PIXELS, "frame_policy": "first_frame"}

    @app.post("/api/images/normalize")
    async def normalize_image(image: Annotated[UploadFile, File()]) -> Response:
        """Decode browser-incompatible rasters without storing uploaded pixels."""
        class BoundedPNG(io.BytesIO):
            def write(self, chunk):
                if self.tell() + len(chunk) > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "ภาพหลังแปลงมีขนาดเกิน 20 MB กรุณาลดความละเอียดหรือส่งออกเป็นภาพขนาดเล็กลง")
                return super().write(chunk)

        def convert(data: bytes):
            decoded, details = decode_image_details(data)
            try:
                with BoundedPNG() as output:
                    decoded.save(output, format="PNG", exif=b"", icc_profile=None)
                    return output.getvalue(), details
            finally:
                decoded.close()

        try:
            with image_work_slot():
                pixels, details = await run_in_threadpool(convert, await read_upload(image))
            return Response(pixels, media_type="image/png", headers={
                "Cache-Control": "no-store",
                "X-Image-Source-Format": details["source_format"],
                "X-Image-Multiple-Frames": "1" if details["multiple_frames"] else "0",
                "X-Image-Normalization-Notes": ",".join(details["normalization_notes"]),
            })
        finally:
            await image.close()

    @app.post("/api/analyze", response_model=AnalysisResponse)
    async def analyze(
        request: Request,
        image: Annotated[UploadFile, File(description="Supported raster image decoded by content, up to 20 MB; temporary analysis only")],
        confidence: Annotated[float, Form(ge=0.01, le=0.99)] = 0.15,
        acknowledge_quality: Annotated[bool, Form()] = False,
        quality_comment: Annotated[str, Form(max_length=1000)] = "",
    ) -> AnalysisResponse:
        """Compatibility response; authenticated submissions retain an owner-only archive."""
        started = time.perf_counter()
        identifier = uuid.uuid4().hex
        archive = None
        archive_user = None
        snapshot = None

        async def archive_status(status: str, error_code=None, error_message=None):
            nonlocal archive
            if archive is None or archive_user is None or snapshot is None:
                return
            snapshot.update(status=status, error_code=error_code, error_message=error_message,
                            updated_at=utc_now())
            archive = await run_in_threadpool(update_archive_image, store, archive, archive_user['id'],
                                               status=status, quality=snapshot.get('quality'),
                                               error_code=error_code, error_message=error_message,
                                               analysis_snapshot=dict(snapshot))

        try:
            if store.configured:
                # Both diagnostic routes apply account permissions. The legacy
                # response stays compatible while its image/results join the
                # same owner-only archive as ordinary persisted submissions.
                archive_user = require_user(request)
                if archive_user['role'] not in {'admin', 'reviewer', 'lab'}:
                    raise HTTPException(403, 'บัญชีนี้ไม่มีสิทธิ์วิเคราะห์ภาพด้วย AI')
                from backend.platform.analyses import _limiter as analysis_limiter
                analysis_limiter.check(archive_user['id'])
            with image_work_slot():
                decoded = await run_in_threadpool(decode_image, await read_upload(image))
                try:
                    if archive_user is not None:
                        examined_at = utc_now()
                        snapshot = {
                            'id': identifier, 'owner_id': archive_user['id'],
                            'sample_code': f'HM-{identifier[:8].upper()}',
                            'filename': f'microscopy-{identifier[:8]}.png',
                            'width': decoded.width, 'height': decoded.height,
                            'status': 'processing', 'created_at': examined_at,
                            'revision': 1, 'model': model_service.name,
                            'model_version': getattr(model_service, 'version', None),
                            'confidence_threshold': confidence, 'detections': [],
                            'quality': None, 'review_status': 'not_available', 'latest_review': None,
                        }
                        try:
                            archive = await run_in_threadpool(
                                create_archive_image, store, decoded, archive_user,
                                source='analysis', source_document_id=identifier,
                                sample_code=snapshot['sample_code'], examined_at=examined_at,
                            )
                        except OSError:
                            raise HTTPException(503, 'พื้นที่คลังภาพผู้ดูแลไม่พร้อมใช้งาน') from None
                    if not model_service.ready:
                        raise HTTPException(503, model_service.message)
                    assessment = await run_in_threadpool(assess_quality, decoded)
                    if snapshot is not None:
                        snapshot['quality'] = assessment
                    enforce_quality(assessment, acknowledge_quality, quality_comment)
                    inference_started = time.perf_counter()
                    detections = await run_in_threadpool(model_service.predict, decoded, confidence)
                    inference_ms = round((time.perf_counter() - inference_started) * 1000)
                    if snapshot is not None:
                        snapshot.update(detections=detections, duration_ms=inference_ms,
                                        quality_acknowledged=acknowledge_quality,
                                        quality_comment=quality_comment.strip(), review_status='pending')
                        await archive_status('completed')
                    filename = (image.filename or "image").replace("\\", "/").rsplit("/", 1)[-1]
                    return AnalysisResponse(
                        id=identifier, filename=filename, width=decoded.width,
                        height=decoded.height, model=model_service.name or "YOLO",
                        model_version=getattr(model_service, "version", None),
                        duration_ms=round((time.perf_counter() - started) * 1000),
                        inference_ms=inference_ms, detections=detections, quality=assessment,
                    )
                finally:
                    decoded.close()
        except asyncio.CancelledError:
            await archive_status('cancelled', 'request_cancelled', 'คำขอตรวจสิ้นสุดก่อนส่งผลกลับ')
            raise
        except ModelNotReadyError as exc:
            await archive_status('failed', 'model_not_configured', 'โมเดลยังไม่พร้อมตรวจภาพ')
            raise HTTPException(503, str(exc)) from None
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, dict) else {}
            code = detail.get('code') or ('model_not_configured' if not model_service.ready else 'request_failed')
            message = detail.get('message') or (exc.detail if isinstance(exc.detail, str) else 'คำขอตรวจภาพไม่สำเร็จ')
            await archive_status('quality_rejected' if code in {'quality_acknowledgement_required', 'quality_rejected'} else 'failed', code, message)
            raise
        except Exception as exc:
            await archive_status('failed', 'inference_failed', 'ประมวลผลภาพไม่สำเร็จ โปรดตรวจบริการหรือโมเดล')
            logger.warning("Image inference failed (%s)", type(exc).__name__)
            raise HTTPException(500, "ประมวลผลภาพไม่สำเร็จ กรุณาตรวจสอบบริการหรือโมเดล") from None
        finally:
            await image.close()

    app.include_router(auth_router)
    app.include_router(quality_router)
    # Domain routers use the same service, authorization and private transactional store.
    from backend.platform import analyses, reviews, reporting, analytics, feedback, modelversions, evaluation, learning, sheets_dashboard, notifications, admin_archive
    for module in (analyses, reviews, reporting, analytics, feedback, modelversions, evaluation, learning, sheets_dashboard, notifications, admin_archive):
        app.include_router(module.router)

    if serve_web:
        @app.api_route("/api", methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
        @app.api_route("/api/{path:path}", methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
        async def unknown_api(path: str = ""):
            raise HTTPException(404, "Not Found")

        @app.api_route("/admin", methods=["GET", "HEAD"], include_in_schema=False)
        async def admin_redirect():
            return RedirectResponse("/admin/", status_code=308)

        @app.api_route("/admin/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
        async def admin_site(path: str = ""):
            # This is a separate frontend entry. Never substitute the public app
            # for a missing admin build, asset, or a traversal-like path.
            if path not in {"", "index.html"} and not re.fullmatch(r"[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*/?", path):
                raise HTTPException(404, "Not Found")
            entry = web_dir / "admin" / "index.html"
            if not entry.is_file() or not entry.resolve().is_relative_to(web_dir.resolve()):
                raise HTTPException(404, "Not Found")
            return FileResponse(entry, media_type="text/html", headers={
                "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow",
            })

        app.mount("/", StaticFiles(directory=web_dir, html=True, check_dir=False), name="web")
    return app


app = create_app()
