from __future__ import annotations

import io
import logging
import os
import time
import uuid
import warnings
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel

from backend.model import ModelNotReadyError, YOLOModelService

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
ALLOWED_MEDIA_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
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
    duration_ms: int
    detections: list[Detection]


def decode_image(data: bytes) -> Image.Image:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as original:
                if original.format not in ALLOWED_FORMATS:
                    raise HTTPException(415, "รองรับเฉพาะภาพ JPEG, PNG และ WebP")
                if original.width * original.height > MAX_IMAGE_PIXELS:
                    raise HTTPException(413, "ภาพมีความละเอียดสูงเกินไป กรุณาใช้ภาพไม่เกิน 40 ล้านพิกเซล")
                original.load()
                # Match browser previews, which automatically apply EXIF orientation.
                return ImageOps.exif_transpose(original).convert("RGB")
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(413, "ภาพมีความละเอียดสูงเกินไป กรุณาลดขนาดภาพ") from None
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError):
        raise HTTPException(400, "ไม่สามารถอ่านภาพนี้ได้ กรุณาเลือกไฟล์ภาพที่สมบูรณ์") from None


def create_app(
    service: YOLOModelService | None = None,
    *,
    static_dir: str | Path | None = None,
) -> FastAPI:
    model_service = service if service is not None else YOLOModelService()
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

    app = FastAPI(title="HelpMinths API", version="1.0.0", lifespan=lifespan)

    @app.get("/api/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            model_ready=model_service.ready,
            model_name=model_service.name,
            message=model_service.message,
        )

    @app.post("/api/analyze", response_model=AnalysisResponse)
    async def analyze(
        image: Annotated[UploadFile, File(description="JPEG, PNG or WebP microscope image, up to 20 MB")],
        confidence: Annotated[float, Form(ge=0.01, le=0.99)] = 0.15,
    ) -> AnalysisResponse:
        started = time.perf_counter()
        try:
            if image.content_type not in ALLOWED_MEDIA_TYPES:
                raise HTTPException(415, "รองรับเฉพาะภาพ JPEG, PNG และ WebP")
            chunks: list[bytes] = []
            total = 0
            while chunk := await image.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "ไฟล์มีขนาดเกิน 20 MB กรุณาลดขนาดภาพแล้วลองอีกครั้ง")
                chunks.append(chunk)
            if not total:
                raise HTTPException(400, "ไฟล์ภาพว่างเปล่า กรุณาเลือกภาพใหม่")
            decoded = await run_in_threadpool(decode_image, b"".join(chunks))
            try:
                if not model_service.ready:
                    raise HTTPException(503, model_service.message)
                detections = await run_in_threadpool(model_service.predict, decoded, confidence)
                filename = (image.filename or "image").replace("\\", "/").rsplit("/", 1)[-1]
                return AnalysisResponse(
                    id=uuid.uuid4().hex,
                    filename=filename,
                    width=decoded.width,
                    height=decoded.height,
                    model=model_service.name or "YOLO",
                    duration_ms=round((time.perf_counter() - started) * 1000),
                    detections=detections,
                )
            finally:
                decoded.close()
        except ModelNotReadyError as exc:
            raise HTTPException(503, str(exc)) from None
        except HTTPException:
            raise
        except Exception as exc:
            logger.warning("Image inference failed (%s)", type(exc).__name__)
            raise HTTPException(500, "ประมวลผลภาพไม่สำเร็จ กรุณาลองใหม่หรือตรวจสอบโมเดล") from None
        finally:
            await image.close()

    if serve_web:
        # Reserve the API namespace even if the static directory contains an api/ folder.
        @app.api_route("/api", methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
        @app.api_route("/api/{path:path}", methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
        async def unknown_api(path: str = ""):
            raise HTTPException(404, "Not Found")

        # StaticFiles handles path containment and MIME types. The startup check above
        # gives an actionable error before the first request when no build exists.
        app.mount("/", StaticFiles(directory=web_dir, html=True, check_dir=False), name="web")

    return app


app = create_app()
