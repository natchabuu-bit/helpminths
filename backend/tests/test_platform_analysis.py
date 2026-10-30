"""Isolated synthetic test fixtures; these are not clinical validation results."""
from __future__ import annotations

import io
from copy import deepcopy
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from backend.platform import analyses, auth, reviews
from backend.platform.quality import QualityThresholds, assess_quality, quality_router
from backend.platform.store import PlatformStore


class FixtureModel:
    ready = True
    name = "unit-test-only.pt"
    message = "Isolated test predictor"
    version = "test-only-version"
    metadata = {"name": name, "version": version, "sha256": None}

    def __init__(self):
        self.calls = 0

    def predict(self, image, confidence):
        self.calls += 1
        return [
            {"id": "det-1", "class_id": 0, "label": "Hookworm", "confidence": .4, "bbox": [20, 30, 90, 80]},
            {"id": "det-2", "class_id": 1, "label": "Uncatalogued fixture object", "confidence": .92, "bbox": [160, 100, 240, 180]},
        ]


def fixture_image(*, metadata=False, flat=False):
    image = Image.new("RGB", (640, 480), (120, 120, 120))
    if not flat:
        image.putdata([((75, 105, 125) if ((x // 4 + y // 4) % 2) else (175, 195, 215)) for y in range(480) for x in range(640)])
    result = io.BytesIO()
    if metadata:
        exif = Image.Exif()
        exif[315] = "SYNTHETIC-PRIVATE-AUTHOR-TEST"
        exif[270] = "SYNTHETIC-PRIVATE-DESCRIPTION-TEST"
        image.save(result, format="PNG", exif=exif)
    else:
        image.save(result, format="PNG")
    image.close()
    return result.getvalue()


@pytest.fixture
def platform(tmp_path, monkeypatch):
    monkeypatch.setenv("HELPMINTHS_COOKIE_SECURE", "0")
    store = PlatformStore(tmp_path / "private")
    users = {name: store.create_user(name, "Synthetic-test-password-2026", role) for name, role in [("labone", "lab"), ("labtwo", "lab"), ("expertone", "reviewer"), ("studentone", "student"), ("adminone", "admin")]}
    app = FastAPI()
    app.state.platform_store = store
    app.state.model_service = FixtureModel()
    app.include_router(auth.router)
    app.include_router(quality_router)
    app.include_router(analyses.router)
    app.include_router(reviews.router)
    with TestClient(app) as client:
        yield client, store, users, app.state.model_service


def login(client, username):
    response = client.post("/api/platform/login", json={"username": username, "password": "Synthetic-test-password-2026"})
    assert response.status_code == 200, response.text
    client.headers["X-CSRF-Token"] = response.json()["csrf_token"]


def create(client, **data):
    payload = {"sample_code": "SYNTHETIC_TEST_01", **data}
    return client.post("/api/platform/analyses", data=payload, files={"image": ("original-sensitive-name.png", fixture_image(metadata=True), "image/png")})


def test_quality_measures_actual_pixels_and_keeps_claims_limited():
    with Image.open(io.BytesIO(fixture_image())) as image:
        good = assess_quality(image)
    assert good["status"] == "pass"
    assert good["metrics"]["focus_variance"] > 30
    assert good["metrics"]["measurement_width"] == 512
    with Image.new("RGB", (40, 40), "black") as image:
        poor = assess_quality(image)
    assert poor["status"] == "warning"
    assert {item["id"] for item in poor["checks"] if item["status"] == "warning"} >= {"resolution", "focus", "brightness", "contrast", "clipping"}
    assert "ไม่ยืนยัน" in poor["notice"]


def test_quality_config_rejects_nonfinite_confidence(platform, monkeypatch):
    client, *_ = platform
    monkeypatch.setenv("HELPMINTHS_REVIEW_CONFIDENCE", "nan")
    assert client.get("/api/platform/quality/config").status_code == 503


def test_persisted_result_keeps_raw_labels_metadata_free_image_and_owner_acl(platform):
    client, store, users, model = platform
    login(client, "labone")
    response = create(client)
    assert response.status_code == 201, response.text
    record = response.json()
    assert record["status"] == "completed"
    assert record["model_version"] == "test-only-version"
    assert record["counts"]["predicted_total"] == 2
    assert record["counts"]["confirmed_total"] == 0
    assert record["counts"]["uncertain_total"] == 1
    assert record["detections"][1]["label"] == "Uncatalogued fixture object"
    assert record["epg"]["available"] is False
    assert "original-sensitive" not in response.text
    with Image.open(io.BytesIO(client.get(record["image_url"]).content)) as stored_image:
        assert not stored_image.getexif()
        assert not stored_image.info
    private = store.image_dir / f"{record['id']}.png"
    assert private.stat().st_mode & 0o777 == 0o600
    assert model.calls == 1
    assert client.get("/api/platform/analyses", params={"predicted_class": "Hookworm"}).json()["total"] == 1
    assert client.get("/api/platform/analyses", params={"predicted_class": "Never-in-fixture"}).json()["total"] == 0
    login(client, "labtwo")
    assert client.get(f"/api/platform/analyses/{record['id']}").status_code == 403
    assert client.get(record["image_url"]).status_code == 403
    assert client.get("/api/platform/analyses").json()["total"] == 0
    login(client, "studentone")
    assert create(client).status_code == 403


def test_quality_warning_requires_explicit_reason_and_no_inference_until_ack(platform):
    client, store, users, model = platform
    login(client, "labone")
    file = ("flat.png", fixture_image(flat=True), "image/png")
    response = client.post("/api/platform/analyses", data={"sample_code": "FLAT_TEST"}, files={"image": file})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "quality_acknowledgement_required"
    assert model.calls == 0
    assessments = store.list_documents("quality_assessment", owner_id=users["labone"]["id"])
    assert assessments[0]["data"]["accepted"] is False
    response = client.post("/api/platform/analyses", data={"sample_code": "FLAT_TEST", "acknowledge_quality": "true", "quality_comment": "Synthetic fixture override, not clinical use"}, files={"image": file})
    assert response.status_code == 201, response.text
    assert response.json()["quality_acknowledged"] is True
    assert model.calls == 1


def test_missing_model_persists_failed_attempt_without_fake_detections(platform):
    client, store, users, model = platform
    model.ready = False
    login(client, "labone")
    response = create(client)
    assert response.status_code == 503
    analysis_id = response.json()["detail"]["analysis_id"]
    record = client.get(f"/api/platform/analyses/{analysis_id}").json()
    assert record["status"] == "failed"
    assert record["error_code"] == "model_not_configured"
    assert record["duration_ms"] is None
    assert record["detections"] == []
    assert model.calls == 0


def test_expert_snapshot_checks_permissions_revisions_and_keeps_predictions(platform):
    client, store, users, model = platform
    login(client, "labone")
    response = create(client)
    original = response.json()
    uri = f"/api/platform/analyses/{original['id']}"
    body = {"expected_revision": original["revision"], "status": "verified", "full_image_reviewed": True, "comments": "Synthetic expert review fixture", "annotations": [{"detection_id": "det-1", "action": "confirm"}, {"detection_id": "det-2", "action": "correct_class", "label": "Taenia spp."}, {"action": "missed_detection", "label": "Hookworm", "bbox": [300, 200, 360, 250]}]}
    assert client.post(uri + "/reviews", json=body).status_code == 403
    login(client, "expertone")
    reviewed = client.post(uri + "/reviews", json=body)
    assert reviewed.status_code == 201, reviewed.text
    record = reviewed.json()
    assert record["detections"] == original["detections"]
    assert record["counts"]["confirmed_total"] == 3
    assert record["counts"]["by_confirmed_class"] == {"Hookworm": 2, "Taenia spp.": 1}
    assert record["counts"]["missed_detection_total"] == 1
    assert record["review_status"] == "verified"
    assert record["latest_review"]["reviewer_id"] == users["expertone"]["id"]
    assert record["latest_review"]["annotations"][1]["original_prediction"] == original["detections"][1]
    assert client.post(uri + "/reviews", json=body).status_code == 409
    assert client.get(uri + "/reviews").json()["total"] == 1
    assert client.get(uri + "/audit").json()["total"] >= 3
    assert model.calls == 1, "Human review must not run inference or change model weights"
    uncertain = {"expected_revision": record["revision"], "status": "verified", "full_image_reviewed": True, "comments": "Synthetic uncertain fixture", "annotations": [{"detection_id": "det-1", "action": "uncertain"}, {"detection_id": "det-2", "action": "confirm"}]}
    assert client.post(uri + "/reviews", json=uncertain).status_code == 422
    no_op = {"expected_revision": record["revision"], "status": "in_review", "comments": "No change fixture", "annotations": [{"detection_id": "det-1", "action": "correct_class", "label": "Hookworm"}]}
    assert client.post(uri + "/reviews", json=no_op).status_code == 422
    assert client.delete(uri, params={"expected_revision": record["revision"]}).status_code == 403
    login(client, "labone")
    assert client.delete(uri, params={"expected_revision": 1}).status_code == 409
    assert client.get(uri + "/image").status_code == 200, "A stale deletion must not remove image bytes"
    assert client.delete(uri, params={"expected_revision": record["revision"]}).status_code == 200
    assert client.get(uri).status_code == 404
    assert client.get(uri + "/image").status_code == 404
    assert client.get(uri + "/audit").status_code == 200, "Authorized deletion history remains inspectable"
    assert not (store.image_dir / f"{original['id']}.png").exists()
