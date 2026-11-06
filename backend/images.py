"""Bounded, content-based raster decoding; no uploads are persisted here.

Image suffixes and browser MIME declarations are not trusted as evidence of a
format. Only in-process raster decoders are allowed: document/vector decoders
that could launch external programs are deliberately excluded.
"""
from __future__ import annotations
import io
import warnings
from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

try:
    from pillow_heif import register_heif_opener
except ImportError:
    # Keep the ordinary raster decoder useful in minimally installed local
    # environments. Production requirements include the HEIF decoder.
    pass
else:
    register_heif_opener(thumbnails=False)

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
ALLOWED_MEDIA_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/avif", "image/gif", "image/bmp", "image/tiff"}
ALLOWED_FORMATS = frozenset({
    "JPEG", "JPEG2000", "MPO", "PNG", "WEBP", "HEIF", "AVIF", "GIF",
    "TIFF", "BMP", "DIB", "ICO", "ICNS", "CUR", "PPM", "PCX", "DCX",
    "DDS", "TGA", "SGI", "SUN", "XBM", "XPM", "IM", "MSP", "QOI",
    "PSD", "PALM", "FLI", "FTEX", "BLP", "PIXAR", "PCD",
})
UNSUPPORTED_FORMAT_MESSAGE = (
    "ไฟล์นี้ไม่ใช่ภาพราสเตอร์ที่ระบบอ่านได้ รองรับ JPEG, PNG, HEIC/HEIF, AVIF, "
    "WebP, TIFF, BMP, GIF และภาพราสเตอร์อื่นตามตัวถอดรหัส ไม่รองรับ SVG, PDF หรือ RAW โดยตรง"
)


def supported_image_formats() -> list[str]:
    """Report installed in-process decoders, not every registered file suffix."""
    Image.init()
    return sorted(ALLOWED_FORMATS.intersection(Image.OPEN))


def _check_dimensions(image: Image.Image) -> None:
    if image.width < 1 or image.height < 1:
        raise HTTPException(400, "ภาพมีขนาดไม่ถูกต้อง กรุณาเลือกไฟล์ภาพใหม่")
    if image.width * image.height > MAX_IMAGE_PIXELS:
        raise HTTPException(413, "ภาพมีความละเอียดสูงเกินไป กรุณาใช้ภาพไม่เกิน 40 ล้านพิกเซล")


def _reject_raw_tiff(image: Image.Image) -> None:
    # DNG/other camera RAW can use a TIFF container. Treating its sensor/CFA
    # samples as an ordinary RGB microscopy image would be misleading.
    tags = getattr(image, "tag_v2", {})
    if image.format == "TIFF" and (50706 in tags or tags.get(262) in (32803, 34892)):
        raise HTTPException(415, "ยังไม่รองรับข้อมูลกล้อง RAW/DNG โดยตรง กรุณาส่งออกเป็น TIFF, PNG หรือ JPEG ก่อน")


def decode_image_details(data: bytes) -> tuple[Image.Image, dict]:
    """Return the first normalized raster plus non-sensitive conversion notes.

    Returned metadata never contains EXIF, GPS, filenames, profile bytes or
    patient identifiers. A first-frame policy avoids silently changing the
    target while an animation plays and bounds work for multi-page images.
    """
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "ไฟล์มีขนาดเกิน 20 MB กรุณาลดขนาดภาพแล้วลองอีกครั้ง")
    if not data:
        raise HTTPException(400, "ไฟล์ภาพว่างเปล่า กรุณาเลือกภาพใหม่")
    header = data.lstrip()[:1024].lower()
    if header.startswith((b"%pdf-", b"%!ps")) or b"<svg" in header:
        raise HTTPException(415, UNSUPPORTED_FORMAT_MESSAGE)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data), formats=supported_image_formats()) as original:
                source_format = original.format
                if source_format not in ALLOWED_FORMATS:
                    raise HTTPException(415, UNSUPPORTED_FORMAT_MESSAGE)
                _check_dimensions(original)
                _reject_raw_tiff(original)
                multiple_frames = bool(getattr(original, "is_animated", False))
                # The detector receives a single still frame, never an
                # arbitrarily selected later animation/TIFF page.
                original.seek(0)
                original.load()
                notes = ["first_frame_only"] if multiple_frames else []
                if original.getexif().get(274) in range(2, 9):
                    notes.append("exif_orientation_applied")
                ImageOps.exif_transpose(original, in_place=True)
                _check_dimensions(original)
                if original.mode.startswith("I;16"):
                    # Preserve the full unsigned16-bit range instead of clipping
                    # all values above255 during a plain convert('RGB').
                    monochrome = original.point(lambda value: value / 257).convert("L")
                    normalized = monochrome.convert("RGB")
                    monochrome.close()
                    notes.append("16bit_to_8bit")
                elif original.mode in ("I", "F"):
                    raise HTTPException(415, "ภาพจำนวนเต็ม 32 บิตหรือทศนิยมต้องส่งออกเป็น TIFF 16 บิต, PNG หรือ JPEG ก่อน")
                elif original.mode in ("RGBA", "LA") or "transparency" in original.info:
                    rgba = original.convert("RGBA")
                    background = Image.new("RGBA", original.size, (255, 255, 255, 255))
                    background.alpha_composite(rgba)
                    normalized = background.convert("RGB")
                    rgba.close()
                    background.close()
                    notes.append("transparency_composited_on_white")
                else:
                    normalized = original.convert("RGB")
                normalized.info.clear()
                return normalized, {
                    "source_format": source_format,
                    "multiple_frames": multiple_frames,
                    "frame_policy": "first_frame",
                    "normalization_notes": notes,
                }
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(413, "ภาพมีความละเอียดสูงเกินไป กรุณาลดขนาดภาพ") from None
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError, EOFError, RuntimeError):
        raise HTTPException(400, "ไม่สามารถอ่านภาพนี้ได้ กรุณาเลือกไฟล์ภาพที่สมบูรณ์") from None

def decode_image(data: bytes) -> Image.Image:
    return decode_image_details(data)[0]


async def read_upload(image: UploadFile) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while chunk := await image.read(1024 * 1024):
        total += len(chunk)
        if total > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "ไฟล์มีขนาดเกิน 20 MB กรุณาลดขนาดภาพแล้วลองอีกครั้ง")
        chunks.append(chunk)
    if not total:
        raise HTTPException(400, "ไฟล์ภาพว่างเปล่า กรุณาเลือกภาพใหม่")
    data = b"".join(chunks)
    # A renamed image may arrive with application/octet-stream, text/plain or no
    # MIME declaration. Accept a genuine supported raster regardless; retain415
    # for an actual non-image upload instead of trusting its file extension.
    if image.content_type and not image.content_type.lower().startswith("image/"):
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(data), formats=supported_image_formats()) as candidate:
                    if candidate.format not in ALLOWED_FORMATS:
                        raise HTTPException(415, UNSUPPORTED_FORMAT_MESSAGE)
                    _check_dimensions(candidate)
                    _reject_raw_tiff(candidate)
        except (Image.DecompressionBombError, Image.DecompressionBombWarning):
            raise HTTPException(413, "ภาพมีความละเอียดสูงเกินไป กรุณาลดขนาดภาพ") from None
        except (UnidentifiedImageError, OSError, ValueError, SyntaxError, EOFError, RuntimeError):
            raise HTTPException(415, UNSUPPORTED_FORMAT_MESSAGE) from None
    return data
