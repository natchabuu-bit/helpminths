from __future__ import annotations

import io
import sys
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.main import create_app
from backend.model import YOLOModelService


def image_bytes(*, size=(100, 50), orientation: int | None = None) -> bytes:
    output = io.BytesIO()
    image = Image.new("RGB", size, "#f0cfa0")
    exif = Image.Exif()
    if orientation:
        exif[274] = orientation
    image.save(output, format="JPEG", exif=exif)
    return output.getvalue()


@pytest.fixture
def client():
    with TestClient(create_app(YOLOModelService(model_path=""))) as client:
        yield client


def test_health_reports_missing_model_without_crashing(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["model_ready"] is False
    assert response.json()["model_name"] is None
    assert "HELPMINTHS_MODEL_PATH" in response.json()["message"]


def test_valid_image_without_model_returns_actionable_503(client):
    response = client.post("/api/analyze", files={"image": ("slide.jpg", image_bytes(), "image/jpeg")})
    assert response.status_code == 503
    assert "HELPMINTHS_MODEL_PATH" in response.json()["detail"]
    assert "detections" not in response.json()


@pytest.mark.parametrize(
    ("filename", "payload", "content_type", "expected"),
    [
        ("script.txt", b"not an image", "text/plain", 415),
        ("fake.jpg", b"not an image", "image/jpeg", 400),
        ("empty.png", b"", "image/png", 400),
        ("huge.jpg", b"x" * (20 * 1024 * 1024 + 1), "image/jpeg", 413),
    ],
)
def test_invalid_uploads_are_rejected(client, filename, payload, content_type, expected):
    response = client.post("/api/analyze", files={"image": (filename, payload, content_type)})
    assert response.status_code == expected


def test_confidence_is_validated(client):
    response = client.post(
        "/api/analyze",
        files={"image": ("slide.jpg", image_bytes(), "image/jpeg")},
        data={"confidence": "1.1"},
    )
    assert response.status_code == 422


class TensorStub:
    def __init__(self, values):
        self.values = values

    def cpu(self):
        return self

    def tolist(self):
        return self.values


class BoxesStub:
    xyxy = TensorStub([[-5, 10, 500, 80], [1, 1, 10, 10], [5, 5, 5, 8]])
    conf = TensorStub([0.9234, 0.1, 0.8])
    cls = TensorStub([3, 3, 3])


class ResultStub:
    names = {3: "Trichuris trichiura"}
    boxes = BoxesStub()


class PredictorStub:
    names = ResultStub.names

    def predict(self, *, source, conf, device, verbose):
        assert source.mode == "RGB"
        assert source.size == (50, 100)  # Original 100x50, EXIF rotation applied.
        assert conf == 0.4
        assert device == "cpu"
        assert verbose is False
        return [ResultStub()]


class InjectedModelService(YOLOModelService):
    def load(self):
        self._model = PredictorStub()
        self.ready = True
        self.name = "test-only.pt"
        self.message = "test predictor ready"


def test_configured_platform_cannot_bypass_inference_permissions_via_legacy_route(tmp_path):
    app = create_app(InjectedModelService(model_path=""), platform_dir=tmp_path / 'private')
    store = app.state.platform_store
    password = 'Synthetic-legacy-test-only-2026!'
    store.create_user('legacy_lab', password, 'lab')
    store.create_user('legacy_student', password, 'student')

    def upload(client, csrf=None):
        return client.post('/api/analyze',
                           files={'image': ('fixture.jpg', image_bytes(orientation=6), 'image/jpeg')},
                           data={'confidence': '.4', 'acknowledge_quality': 'true',
                                 'quality_comment': 'Synthetic test only: tiny EXIF chart.'},
                           headers={'Origin': 'https://testserver', **({'X-CSRF-Token': csrf} if csrf else {})})

    with TestClient(app, base_url='https://testserver') as client:
        assert upload(client).status_code == 401
        student = client.post('/api/platform/login', json={'username': 'legacy_student', 'password': password}).json()
        assert upload(client, student['csrf_token']).status_code == 403
        lab = client.post('/api/platform/login', json={'username': 'legacy_lab', 'password': password}).json()
        assert upload(client).status_code == 403
        result = upload(client, lab['csrf_token'])
        assert result.status_code == 200
        assert result.json()['storage'] == 'session_only'
        assert store.count_documents('analysis') == 0


def test_inference_contract_orientation_dynamic_names_and_clipped_boxes():
    # The stub verifies the API/adapter contract; it is never used in the app.
    with TestClient(create_app(InjectedModelService(model_path=""))) as client:
        assert client.get("/api/health").json()["model_ready"] is True
        response = client.post(
            "/api/analyze",
            files={"image": ("slide.jpg", image_bytes(orientation=6), "image/jpeg")},
            # The deliberately tiny orientation fixture needs an explicit quality override.
            data={"confidence": "0.4", "acknowledge_quality": "true",
                  "quality_comment": "Automated adapter test with a tiny EXIF fixture; not a clinical image"},
        )
    assert response.status_code == 200
    result = response.json()
    assert result["width"] == 50
    assert result["height"] == 100
    assert result["filename"] == "slide.jpg"
    assert result["model"] == "test-only.pt"
    assert len(result["id"]) == 32
    assert result["duration_ms"] >= 0
    assert result["quality"]["status"] == "warning"
    assert result["detections"] == [{
        "id": "det-1", "class_id": 3, "label": "Trichuris trichiura",
        "confidence": 0.9234, "bbox": [0.0, 10.0, 50.0, 80.0],
    }]


def test_unloadable_checkpoint_does_not_crash_health(tmp_path):
    service = YOLOModelService(model_path=str(tmp_path / "missing.pt"))
    with TestClient(create_app(service)) as client:
        response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["model_ready"] is False
    assert str(tmp_path) not in response.json()["message"]


def test_corrupt_checkpoint_does_not_crash_api_or_expose_paths(tmp_path, monkeypatch):
    model_path = tmp_path / "corrupt.pt"
    model_path.write_bytes(b"not real model weights")

    def failing_loader(*_args, **_kwargs):
        raise ValueError(f"Corrupt file at {model_path}")

    monkeypatch.setitem(sys.modules, "ultralytics", SimpleNamespace(YOLO=failing_loader))
    with TestClient(create_app(YOLOModelService(str(model_path)))) as client:
        response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["model_ready"] is False
    assert str(tmp_path) not in response.json()["message"]


def test_production_serves_web_assets_and_keeps_api_json(tmp_path, monkeypatch):
    web_dir = tmp_path / "dist"
    (web_dir / "assets").mkdir(parents=True)
    (web_dir / "index.html").write_text("<!doctype html><title>HelpMinths</title>", encoding="utf-8")
    (web_dir / "assets" / "app.js").write_text("console.log('HelpMinths')", encoding="utf-8")
    # Static content must never take ownership of the reserved API namespace.
    (web_dir / "api").mkdir()
    (web_dir / "api" / "unknown").write_text("unexpected static API file", encoding="utf-8")
    monkeypatch.setenv("HELPMINTHS_SERVE_WEB", "1")

    with TestClient(create_app(YOLOModelService(""), static_dir=web_dir)) as client:
        homepage = client.get("/")
        assert homepage.status_code == 200
        assert "text/html" in homepage.headers["content-type"]
        assert "HelpMinths" in homepage.text
        asset = client.get("/assets/app.js")
        assert asset.status_code == 200
        assert "javascript" in asset.headers["content-type"]
        health = client.get("/api/health")
        assert health.status_code == 200
        assert health.json()["status"] == "ok"
        for path in ("/api", "/api/unknown", "/assets/missing.js", "/unknown"):
            assert client.get(path).status_code == 404
        assert client.get("/api/unknown").json() == {"detail": "Not Found"}


@pytest.mark.parametrize("include_directory", [False, True])
def test_production_without_frontend_build_fails_at_startup(tmp_path, monkeypatch, include_directory):
    web_dir = tmp_path / "dist"
    if include_directory:
        web_dir.mkdir()
    monkeypatch.setenv("HELPMINTHS_SERVE_WEB", "1")
    with pytest.raises(RuntimeError, match="npm run build"):
        with TestClient(create_app(YOLOModelService(""), static_dir=web_dir)):
            pass


def test_web_serving_is_opt_in(tmp_path, monkeypatch):
    monkeypatch.delenv("HELPMINTHS_SERVE_WEB", raising=False)
    with TestClient(create_app(YOLOModelService(""), static_dir=tmp_path / "missing")) as client:
        assert client.get("/").status_code == 404
        assert client.get("/api/health").status_code == 200


def test_production_static_cannot_escape_build_directory(tmp_path, monkeypatch):
    web_dir = tmp_path / "dist"
    web_dir.mkdir()
    (web_dir / "index.html").write_text("HelpMinths", encoding="utf-8")
    (tmp_path / "private.txt").write_text("must not be served", encoding="utf-8")
    monkeypatch.setenv("HELPMINTHS_SERVE_WEB", "1")
    with TestClient(create_app(YOLOModelService(""), static_dir=web_dir)) as client:
        response = client.get("/%2e%2e/private.txt")
        assert response.status_code == 404
        assert "must not be served" not in response.text
