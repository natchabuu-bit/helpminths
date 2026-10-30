"""Configurable image-quality heuristics, independent of inference and diagnosis."""
from __future__ import annotations

import math
import os
import threading
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from PIL import Image, ImageStat


_IMAGE_WORK = threading.BoundedSemaphore(1)

@contextmanager
def image_work_slot():
    """Bound memory: do not accumulate decoded images while inference is busy."""
    if not _IMAGE_WORK.acquire(blocking=False):
        raise HTTPException(429, {"code": "image_processing_busy", "message": "กำลังประมวลผลภาพอื่น โปรดลองอีกครั้ง"}, headers={"Retry-After": "2"})
    try:
        yield
    finally:
        _IMAGE_WORK.release()


@dataclass(frozen=True)
class QualityThresholds:
    min_width: int = 512
    min_height: int = 384
    min_focus_variance: float = 30.0
    min_brightness: float = 35.0
    max_brightness: float = 225.0
    min_contrast: float = 12.0
    max_clipped_fraction: float = 0.45
    thumbnail_size: int = 512

    @classmethod
    def from_environment(cls) -> "QualityThresholds":
        defaults = cls()
        values: dict[str, Any] = {}
        for name in asdict(defaults):
            raw = os.getenv(f"HELPMINTHS_QUALITY_{name.upper()}")
            if raw is None:
                continue
            try:
                value = float(raw)
            except ValueError:
                raise ValueError(f"Invalid HELPMINTHS_QUALITY_{name.upper()}") from None
            if not math.isfinite(value):
                raise ValueError(f"Invalid HELPMINTHS_QUALITY_{name.upper()}")
            if name in {"min_width", "min_height", "thumbnail_size"}:
                if not value.is_integer() or not 16 <= value <= (2048 if name == "thumbnail_size" else 20000):
                    raise ValueError(f"Invalid HELPMINTHS_QUALITY_{name.upper()}")
                values[name] = int(value)
            elif name == "max_clipped_fraction":
                if not 0 <= value <= 1:
                    raise ValueError(f"Invalid HELPMINTHS_QUALITY_{name.upper()}")
                values[name] = value
            elif not 0 <= value <= (100000 if name == "min_focus_variance" else 255):
                raise ValueError(f"Invalid HELPMINTHS_QUALITY_{name.upper()}")
            else:
                values[name] = value
        result = cls(**values)
        if result.min_brightness >= result.max_brightness:
            raise ValueError("Quality brightness minimum must be below maximum")
        return result


def assess_quality(image: Image.Image, thresholds: QualityThresholds | None = None) -> dict[str, Any]:
    """Measure a bounded thumbnail; no classifier, physical size or clinical claim."""
    try:
        limits = thresholds or QualityThresholds.from_environment()
    except ValueError:
        raise HTTPException(503, {"code": "quality_not_configured", "message": "การตั้งค่าเกณฑ์คุณภาพภาพไม่ถูกต้อง โปรดให้ผู้ดูแลตรวจค่าที่กำหนด"}) from None
    width, height = image.size
    scale = min(1.0, limits.thumbnail_size / max(width, height))
    resized = image.resize((max(1, round(width * scale)), max(1, round(height * scale))), Image.Resampling.BILINEAR)
    gray = resized.convert("L")
    try:
        stats = ImageStat.Stat(gray)
        brightness = float(stats.mean[0])
        contrast = float(stats.stddev[0])
        histogram = gray.histogram()
        clipped_fraction = (sum(histogram[:6]) + sum(histogram[250:])) / (gray.width * gray.height)
        pixels = list(gray.get_flattened_data())
        row_width = gray.width
        total = squares = 0.0
        samples = 0
        for y in range(1, gray.height - 1):
            base = y * row_width
            for x in range(1, row_width - 1):
                p = base + x
                laplacian = pixels[p - row_width] + pixels[p + row_width] + pixels[p - 1] + pixels[p + 1] - 4 * pixels[p]
                total += laplacian
                squares += laplacian * laplacian
                samples += 1
        focus = max(0.0, squares / samples - (total / samples) ** 2) if samples else 0.0
    finally:
        gray.close()
        resized.close()
    checks = [
        {"id": "integrity", "label": "ไฟล์ภาพสมบูรณ์", "status": "pass", "message": "เปิดและถอดรหัสภาพสำเร็จ"},
        {"id": "resolution", "label": "ความละเอียด", "status": "pass" if width >= limits.min_width and height >= limits.min_height else "warning", "message": f"ภาพ {width} × {height} พิกเซล; เกณฑ์เบื้องต้น {limits.min_width} × {limits.min_height} พิกเซล"},
        {"id": "focus", "label": "ความคมชัด", "status": "pass" if focus >= limits.min_focus_variance else "warning", "message": "สัญญาณขอบภาพเพียงพอตามเกณฑ์เบื้องต้น" if focus >= limits.min_focus_variance else "ภาพอาจเบลอหรือมีรายละเอียดน้อย ลองปรับโฟกัสและยึดกล้องให้นิ่ง"},
        {"id": "brightness", "label": "ความสว่าง", "status": "pass" if limits.min_brightness <= brightness <= limits.max_brightness else "warning", "message": "ความสว่างอยู่ในช่วงที่ตั้งไว้" if limits.min_brightness <= brightness <= limits.max_brightness else "ภาพมืดเกินไป ลองเพิ่มแสง" if brightness < limits.min_brightness else "ภาพสว่างเกินไป ลองลดแสง"},
        {"id": "contrast", "label": "ความต่างระดับสี", "status": "pass" if contrast >= limits.min_contrast else "warning", "message": "ระดับความต่างสีเพียงพอตามเกณฑ์เบื้องต้น" if contrast >= limits.min_contrast else "ภาพมีความต่างระดับสีน้อย ลองปรับแสงหรือเลือกบริเวณที่เห็นโครงสร้างชัด"},
        {"id": "clipping", "label": "ส่วนมืดหรือสว่างจัด", "status": "pass" if clipped_fraction <= limits.max_clipped_fraction else "warning", "message": "ส่วนมืดหรือสว่างจัดอยู่ในเกณฑ์ที่ตั้งไว้" if clipped_fraction <= limits.max_clipped_fraction else "ภาพมีพื้นที่ดำหรือขาวจัดมาก อาจเกิดจากขอบช่องมองภาพหรือการรับแสง"},
    ]
    return {
        "status": "pass" if all(item["status"] == "pass" for item in checks) else "warning",
        "assessment_type": "heuristic",
        "checks": checks,
        "metrics": {"width": width, "height": height, "focus_variance": round(focus, 3), "brightness": round(brightness, 3), "contrast": round(contrast, 3), "clipped_fraction": round(clipped_fraction, 6), "measurement_width": max(1, round(width * scale)), "measurement_height": max(1, round(height * scale))},
        "thresholds": asdict(limits),
        "can_override": os.getenv("HELPMINTHS_QUALITY_ALLOW_OVERRIDE", "1") == "1",
        "notice": "เป็นการประเมินคุณภาพภาพเบื้องต้นด้วยเกณฑ์เชิงภาพ ไม่ยืนยันว่าภาพเหมาะสำหรับวินิจฉัย และไม่ใช้วัดขนาดไข่จริง",
    }


def enforce_quality(assessment: dict[str, Any], acknowledge: bool = False, comment: str = "") -> None:
    if assessment["status"] == "pass":
        return
    if assessment.get("can_override") and acknowledge and comment.strip():
        return
    raise HTTPException(422, {"code": "quality_acknowledgement_required" if assessment.get("can_override") else "quality_rejected", "message": "ภาพมีข้อจำกัด โปรดถ่ายใหม่ หรือยืนยันข้อจำกัดพร้อมเหตุผลก่อนตรวจ" if assessment.get("can_override") else "คุณภาพภาพไม่ผ่านเกณฑ์ที่ตั้งไว้ โปรดถ่ายใหม่", "quality": assessment})


quality_router = APIRouter(prefix="/api/platform", tags=["Image quality"])


@quality_router.post("/quality")
async def quality_check(image: UploadFile = File(...)) -> dict[str, Any]:
    # Import lazily so the shared decoder is owned by the existing API layer.
    from backend.images import decode_image, read_upload
    try:
        with image_work_slot():
            decoded = await run_in_threadpool(decode_image, await read_upload(image))
            try:
                return await run_in_threadpool(assess_quality, decoded)
            finally:
                decoded.close()
    finally:
        await image.close()


def configured_confidence(name: str, default: float) -> float:
    try:
        result = float(os.getenv(name, str(default)))
        if not math.isfinite(result) or not .01 <= result <= .99:
            raise ValueError()
        return result
    except ValueError:
        raise HTTPException(503, f"ตั้งค่า {name} ไม่ถูกต้อง ต้องเป็นค่าระหว่าง 0.01–0.99") from None


@quality_router.get("/quality/config")
def quality_configuration() -> dict[str, Any]:
    try:
        thresholds = QualityThresholds.from_environment()
    except ValueError:
        raise HTTPException(503, {"code": "quality_not_configured", "message": "การตั้งค่าเกณฑ์คุณภาพภาพไม่ถูกต้อง โปรดให้ผู้ดูแลตรวจค่าที่กำหนด"}) from None
    return {"assessment_type": "heuristic", "thresholds": asdict(thresholds), "can_override": os.getenv("HELPMINTHS_QUALITY_ALLOW_OVERRIDE", "1") == "1", "inference_confidence": configured_confidence("HELPMINTHS_CONFIDENCE_THRESHOLD", .15), "review_confidence_threshold": configured_confidence("HELPMINTHS_REVIEW_CONFIDENCE", .5), "notice": "เกณฑ์ภาพเบื้องต้นต้องตรวจสอบความเหมาะสมกับอุปกรณ์และวิธีเตรียมสไลด์จริงก่อนใช้ทางคลินิก"}
