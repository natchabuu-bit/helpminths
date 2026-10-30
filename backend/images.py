"""Shared bounded image validation. No uploads are persisted by these helpers."""
from __future__ import annotations
import io
import warnings
from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
ALLOWED_MEDIA_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}

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
                ImageOps.exif_transpose(original, in_place=True)
                normalized = original.convert("RGB")
                normalized.info.clear()
                return normalized
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(413, "ภาพมีความละเอียดสูงเกินไป กรุณาลดขนาดภาพ") from None
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError):
        raise HTTPException(400, "ไม่สามารถอ่านภาพนี้ได้ กรุณาเลือกไฟล์ภาพที่สมบูรณ์") from None


async def read_upload(image: UploadFile) -> bytes:
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
    return b"".join(chunks)
