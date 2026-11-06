"""Real encoded synthetic raster images, never microscope/diagnostic fixtures."""
from __future__ import annotations

import asyncio
import io
import struct

import pytest
from fastapi import HTTPException, UploadFile
from PIL import Image
from starlette.datastructures import Headers

from backend import images


def encoded(format_name: str, *, mode: str = "RGB", size=(32, 24), color="red", **save_options) -> bytes:
    output = io.BytesIO()
    with Image.new(mode, size, color) as image:
        image.save(output, format=format_name, **save_options)
    return output.getvalue()


@pytest.mark.parametrize("format_name", ["JPEG", "PNG", "WEBP", "BMP", "TIFF", "GIF", "PPM", "TGA", "PCX", "QOI", "ICO", "AVIF", "HEIF"])
def test_real_decodable_raster_formats_produce_metadata_free_rgb(format_name):
    if format_name not in images.supported_image_formats():
        pytest.skip(f"{format_name} codec is not installed in this local environment")
    payload = encoded(format_name)
    normalized, metadata = images.decode_image_details(payload)
    try:
        assert normalized.mode == "RGB"
        assert normalized.width > 0 and normalized.height > 0
        assert normalized.info == {}
        assert len(normalized.getexif()) == 0
        assert metadata["source_format"] == format_name
        assert metadata["frame_policy"] == "first_frame"
        assert metadata["multiple_frames"] is False
    finally:
        normalized.close()


@pytest.mark.parametrize("mime", ["image/tiff", "application/octet-stream", "text/plain", "application/x-unknown-camera-image", ""])
def test_actual_raster_bytes_are_accepted_independently_of_suffix_and_browser_mime(mime):
    payload = encoded("BMP")
    upload = UploadFile(file=io.BytesIO(payload), filename="synthetic-example.any-extension", headers=Headers({"content-type": mime}))
    received = asyncio.run(images.read_upload(upload))
    normalized = images.decode_image(received)
    try:
        assert normalized.size == (32, 24)
    finally:
        normalized.close()


@pytest.mark.parametrize("format_name", ["GIF", "TIFF", "WEBP", "PNG"])
def test_only_first_frame_of_an_actual_multiframe_image_is_normalized(format_name):
    output = io.BytesIO()
    first = Image.new("RGB", (32, 24), "red")
    second = Image.new("RGB", (32, 24), "blue")
    first.save(output, format=format_name, save_all=True, append_images=[second], duration=200, loop=0)
    first.close(); second.close()
    normalized, metadata = images.decode_image_details(output.getvalue())
    try:
        red, green, blue = normalized.getpixel((16, 12))
        assert red > 200 and green < 40 and blue < 40
        assert metadata["multiple_frames"] is True
        assert metadata["frame_policy"] == "first_frame"
        assert "first_frame_only" in metadata["normalization_notes"]
    finally:
        normalized.close()


def test_exif_orientation_is_applied_and_identifying_metadata_is_not_returned():
    exif = Image.Exif()
    exif[274] = 6
    exif[315] = "SYNTHETIC PRIVATE METADATA, NOT A PATIENT"
    payload = encoded("JPEG", size=(40, 20), exif=exif)
    normalized, metadata = images.decode_image_details(payload)
    try:
        assert normalized.size == (20, 40)
        assert normalized.info == {}
        assert len(normalized.getexif()) == 0
        assert "exif_orientation_applied" in metadata["normalization_notes"]
        assert "PRIVATE" not in str(metadata)
    finally:
        normalized.close()


def test_transparency_is_composited_on_white_instead_of_silently_becoming_black():
    normalized, metadata = images.decode_image_details(encoded("PNG", mode="RGBA", color=(0, 0, 0, 0)))
    try:
        assert normalized.getpixel((0, 0)) == (255, 255, 255)
        assert "transparency_composited_on_white" in metadata["normalization_notes"]
    finally:
        normalized.close()


def test_16bit_tiff_preserves_intensity_range_when_normalized_to_rgb():
    output = io.BytesIO()
    image = Image.frombytes("I;16", (3, 1), struct.pack("<HHH", 0, 32768, 65535))
    image.save(output, format="TIFF"); image.close()
    normalized, metadata = images.decode_image_details(output.getvalue())
    try:
        assert normalized.getpixel((0, 0)) == (0, 0, 0)
        assert normalized.getpixel((1, 0)) == (127, 127, 127)
        assert normalized.getpixel((2, 0)) == (255, 255, 255)
        assert "16bit_to_8bit" in metadata["normalization_notes"]
    finally:
        normalized.close()


@pytest.mark.parametrize("payload", [b"<svg xmlns='http://www.w3.org/2000/svg'><script>doNotRun()</script></svg>", b"%PDF-1.7\nsynthetic document", b"%!PS-Adobe-3.0\nquit"])
def test_vector_or_document_inputs_never_enter_external_rasterizers(payload):
    with pytest.raises(HTTPException) as failure:
        images.decode_image_details(payload)
    assert failure.value.status_code == 415


def test_raw_dng_sensor_data_is_not_mistaken_for_a_normal_tiff():
    image = Image.new("L", (32, 24), 80)
    output = io.BytesIO()
    image.save(output, format="TIFF", tiffinfo={50706: b"\x01\x04\x00\x00"})
    image.close()
    with pytest.raises(HTTPException) as failure:
        images.decode_image(output.getvalue())
    assert failure.value.status_code == 415
    assert "RAW/DNG" in failure.value.detail


def test_32bit_or_floating_tiff_requires_explicit_conversion_instead_of_clipping():
    with pytest.raises(HTTPException) as failure:
        images.decode_image(encoded("TIFF", mode="F", color=0.5))
    assert failure.value.status_code == 415


def test_declared_image_with_corrupt_data_reports_a_read_error():
    upload = UploadFile(file=io.BytesIO(b"not a picture"), filename="fake.png", headers=Headers({"content-type": "image/png"}))
    payload = asyncio.run(images.read_upload(upload))
    with pytest.raises(HTTPException) as failure:
        images.decode_image(payload)
    assert failure.value.status_code == 400


def test_actual_nonimage_with_text_mime_is_rejected_without_trusting_its_name():
    upload = UploadFile(file=io.BytesIO(b"not a picture"), filename="fake.jpg", headers=Headers({"content-type": "text/plain"}))
    with pytest.raises(HTTPException) as failure:
        asyncio.run(images.read_upload(upload))
    assert failure.value.status_code == 415


def test_raster_pixel_limit_is_checked_before_full_decode(monkeypatch):
    monkeypatch.setattr(images, "MAX_IMAGE_PIXELS", 100)
    with pytest.raises(HTTPException) as failure:
        images.decode_image(encoded("BMP", size=(11, 10)))
    assert failure.value.status_code == 413


def test_pillow_decompression_bomb_warning_remains_a_hard_limit(monkeypatch):
    payload = encoded("PNG", size=(10, 10))
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 64)
    with pytest.raises(HTTPException) as failure:
        images.decode_image(payload)
    assert failure.value.status_code == 413


def test_direct_decoder_and_stream_reader_both_reject_oversized_payloads(monkeypatch):
    monkeypatch.setattr(images, "MAX_UPLOAD_BYTES", 10)
    with pytest.raises(HTTPException) as direct:
        images.decode_image(b"x" * 11)
    assert direct.value.status_code == 413
    upload = UploadFile(file=io.BytesIO(b"x" * 11), filename="huge.bmp", headers=Headers({"content-type": "image/bmp"}))
    with pytest.raises(HTTPException) as streamed:
        asyncio.run(images.read_upload(upload))
    assert streamed.value.status_code == 413
