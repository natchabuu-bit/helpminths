"""Public, non-persistent image conversion using real synthetic raster bytes.

These tests check decoding/transport/privacy, never diagnostic model accuracy.
"""
from __future__ import annotations

import io
import random

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.images import MAX_IMAGE_PIXELS, MAX_UPLOAD_BYTES, supported_image_formats
from backend import images, main
from backend.main import create_app
from backend.model import YOLOModelService


def encoded(format_name: str, *, size=(48, 32), color="red", **options) -> bytes:
    output = io.BytesIO()
    with Image.new("RGB", size, color) as image:
        image.save(output, format=format_name, **options)
    return output.getvalue()


@pytest.fixture
def client(tmp_path):
    # Configured private storage deliberately has no authenticated user. Preview
    # conversion must work without recording an analysis or granting data access.
    application = create_app(YOLOModelService(model_path=""), platform_dir=tmp_path / "private")
    with TestClient(application) as test_client:
        yield test_client, application.state.platform_store


def assert_no_documents_or_images(store):
    with store.connection() as connection:
        assert connection.execute("SELECT COUNT(*) FROM documents").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM audit_logs").fetchone()[0] == 0
    assert not list(store.image_dir.rglob("*"))


def decoded_response(response) -> Image.Image:
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].split(";")[0] == "image/png"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["pragma"] == "no-cache"
    assert response.headers["x-content-type-options"] == "nosniff"
    with Image.open(io.BytesIO(response.content)) as image:
        assert image.format == "PNG"
        image.load()
        assert image.info == {}
        assert len(image.getexif()) == 0
        return image.copy()


def test_format_capabilities_describe_actual_decoders_and_bounded_first_frame_policy(client):
    test_client, store = client
    response = test_client.get("/api/images/formats")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert body["formats"] == supported_image_formats()
    assert {"JPEG", "PNG", "TIFF", "BMP", "GIF"}.issubset(body["formats"])
    assert not {"EPS", "PDF", "WMF", "SVG", "RAW"}.intersection(body["formats"])
    assert body["max_bytes"] == MAX_UPLOAD_BYTES
    assert body["max_pixels"] == MAX_IMAGE_PIXELS
    assert body["frame_policy"] == "first_frame"
    assert_no_documents_or_images(store)


@pytest.mark.parametrize("format_name,mime", [("TIFF", "image/tiff"), ("BMP", "application/octet-stream"), ("HEIF", "image/heic"), ("AVIF", "image/avif")])
def test_nonbrowser_formats_convert_to_metadata_free_png_without_inference_or_persistence(client, format_name, mime):
    if format_name not in supported_image_formats():
        pytest.skip(f"{format_name} is not installed in the local decoder")
    test_client, store = client
    assert test_client.get("/api/health").json()["model_ready"] is False
    assert test_client.get("/api/platform/session").json()["user"] is None
    response = test_client.post("/api/images/normalize", files={"image": ("synthetic-arbitrary.extension", encoded(format_name), mime)})
    normalized = decoded_response(response)
    try:
        assert normalized.size == (48, 32)
        assert normalized.mode == "RGB"
        assert response.headers["x-image-source-format"] == format_name
        assert response.headers["x-image-multiple-frames"] == "0"
    finally:
        normalized.close()
    assert_no_documents_or_images(store)


def test_animated_gif_returns_the_first_still_frame_and_an_explicit_header(client):
    test_client, store = client
    output = io.BytesIO()
    first = Image.new("RGB", (48, 32), "red")
    second = Image.new("RGB", (48, 32), "blue")
    first.save(output, format="GIF", save_all=True, append_images=[second], duration=150, loop=0)
    first.close(); second.close()
    response = test_client.post("/api/images/normalize", files={"image": ("synthetic.gif", output.getvalue(), "image/gif")})
    normalized = decoded_response(response)
    try:
        assert normalized.getpixel((20, 10)) == (255, 0, 0)
        assert response.headers["x-image-source-format"] == "GIF"
        assert response.headers["x-image-multiple-frames"] == "1"
        assert "first_frame_only" in response.headers["x-image-normalization-notes"].split(",")
    finally:
        normalized.close()
    assert_no_documents_or_images(store)


def test_rotation_is_applied_without_returning_original_exif_gps_or_filename(client):
    test_client, store = client
    exif = Image.Exif()
    exif[274] = 6
    exif[315] = "SYNTHETIC_PRIVATE_ARTIST_NOT_A_PATIENT"
    response = test_client.post("/api/images/normalize", files={"image": ("SYNTHETIC_PRIVATE_FILENAME.jpg", encoded("JPEG", size=(48, 32), exif=exif), "image/jpeg")})
    normalized = decoded_response(response)
    try:
        assert normalized.size == (32, 48)
        assert "exif_orientation_applied" in response.headers["x-image-normalization-notes"].split(",")
        assert "PRIVATE" not in str(response.headers)
        assert b"SYNTHETIC_PRIVATE_ARTIST" not in response.content
    finally:
        normalized.close()
    assert_no_documents_or_images(store)


@pytest.mark.parametrize("name,payload,mime,expected", [
    ("script.svg", b"<svg><script>mustNotRun()</script></svg>", "image/svg+xml", 415),
    ("document.pdf", b"%PDF-1.7\nsynthetic", "application/pdf", 415),
    ("fake.png", b"not an image", "image/png", 400),
    ("empty.bmp", b"", "image/bmp", 400),
])
def test_invalid_or_document_inputs_remain_errors_and_are_never_stored(client, name, payload, mime, expected):
    test_client, store = client
    response = test_client.post("/api/images/normalize", files={"image": (name, payload, mime)})
    assert response.status_code == expected
    assert response.headers["cache-control"] == "no-store"
    assert "detail" in response.json()
    assert_no_documents_or_images(store)


def test_upload_transport_limit_is_enforced_before_image_decoding(client):
    test_client, store = client
    response = test_client.post("/api/images/normalize", files={"image": ("oversized.bmp", b"x" * (MAX_UPLOAD_BYTES + 1), "image/bmp")})
    assert response.status_code == 413
    assert response.headers["cache-control"] == "no-store"
    assert_no_documents_or_images(store)


def test_conversion_output_limit_returns_413_instead_of_cropping_or_rescaling(client, monkeypatch):
    test_client, store = client
    # A noisy raster expands when encoded as losslessPNG. Reduce ONLY the
    # response writer's bound, leaving the input decoder's20MB bound intact.
    monkeypatch.setattr(main, "MAX_UPLOAD_BYTES", 256)
    source = Image.frombytes("RGB", (48, 32), random.Random(2026).randbytes(48 * 32 * 3))
    output = io.BytesIO()
    source.save(output, format="BMP"); source.close()
    response = test_client.post("/api/images/normalize", files={"image": ("synthetic-noise.bmp", output.getvalue(), "image/bmp")})
    assert response.status_code == 413
    assert response.headers["cache-control"] == "no-store"
    assert "หลังแปลง" in response.json()["detail"]
    assert_no_documents_or_images(store)


def test_decoder_pixel_bound_also_protects_the_public_conversion_endpoint(client, monkeypatch):
    test_client, store = client
    monkeypatch.setattr(images, "MAX_IMAGE_PIXELS", 100)
    response = test_client.post("/api/images/normalize", files={"image": ("synthetic.bmp", encoded("BMP"), "image/bmp")})
    assert response.status_code == 413
    assert response.headers["cache-control"] == "no-store"
    assert_no_documents_or_images(store)
