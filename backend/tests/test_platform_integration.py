"""Cross-domain contracts using isolated test fixtures, never clinical/model evidence."""
from __future__ import annotations

import csv
import io
import json
import shutil
import subprocess
from contextlib import ExitStack
from copy import deepcopy
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.model import YOLOModelService

PASSWORD = "isolated-test-fixture-password"
ORIGINAL_DETECTIONS = [
    {"id": "fixture-object-1", "class_id": 0, "label": "Ascaris lumbricoides", "confidence": .95, "bbox": [20., 30., 110., 115.]},
    # A model label is untrusted spreadsheet text, even when it is not a taxon.
    {"id": "fixture-object-2", "class_id": 1, "label": "=1+1", "confidence": .42, "bbox": [140., 80., 230., 180.]},
]


class FixtureModel(YOLOModelService):
    """Injected exclusively into temporary test applications."""
    def __init__(self):
        super().__init__("")
        self.calls = 0

    def load(self):
        self.ready = True
        self.name = "test-fixture-only.pt"
        self.version = "test-fixture-version-not-a-checkpoint"
        self.metadata = {"name": self.name, "version": self.version, "task": "detect", "device": "cpu"}
        self.message = "Isolated automated-test predictor; not clinical inference"

    def predict(self, image, confidence):
        assert image.mode == "RGB"
        self.calls += 1
        return [deepcopy(item) for item in ORIGINAL_DETECTIONS if item["confidence"] >= confidence]


def fixture_png() -> bytes:
    """A synthetic gray test chart with private EXIF, not microscopy imagery."""
    image = Image.new("RGB", (512, 384))
    image.putdata([(75, 80, 85) if ((x // 8 + y // 8) % 2) else (180, 175, 170)
                   for y in range(384) for x in range(512)])
    exif = Image.Exif()
    exif[270] = "Synthetic private metadata must not persist"
    exif[315] = "Test fixture creator"
    output = io.BytesIO()
    image.save(output, format="PNG", exif=exif)
    image.close()
    return output.getvalue()


@dataclass
class Actor:
    client: TestClient
    user: dict
    csrf: str

    def write(self, method: str, path: str, **kwargs):
        headers = {"x-csrf-token": self.csrf, **kwargs.pop("headers", {})}
        return self.client.request(method, path, headers=headers, **kwargs)


@pytest.fixture
def platform(tmp_path, monkeypatch):
    from backend.main import create_app
    monkeypatch.delenv("HELPMINTHS_SERVE_WEB", raising=False)
    monkeypatch.delenv("HELPMINTHS_DATA_DIR", raising=False)
    monkeypatch.setenv("HELPMINTHS_COOKIE_SECURE", "1")
    app = create_app(FixtureModel(), platform_dir=tmp_path / "private-platform")
    store = app.state.platform_store
    users = {role: store.create_user(f"fixture-{role}", PASSWORD, role)
             for role in ("admin", "reviewer", "lab", "student")}
    users["other"] = store.create_user("fixture-other", PASSWORD, "lab")
    with ExitStack() as stack:
        actors = {}
        for role, user in users.items():
            client = stack.enter_context(TestClient(app, base_url="https://testserver"))
            response = client.post("/api/platform/login", json={"username": user["username"], "password": PASSWORD})
            assert response.status_code == 200, response.text
            actors[role] = Actor(client, user, response.json()["csrf_token"])
        yield app, store, actors


def create_analysis(actor: Actor, sample="QA_fixture") -> dict:
    response = actor.write("POST", "/api/platform/analyses",
                           files={"image": ("must-not-retain-this-filename.png", fixture_png(), "image/png")},
                           data={"sample_code": sample, "confidence": ".15"})
    assert response.status_code == 201, response.text
    return response.json()


def verified_review(analysis: dict) -> dict:
    return {"expected_revision": analysis["revision"], "status": "verified", "full_image_reviewed": True,
            "comments": "Isolated fixture review, not a clinical annotation",
            "annotations": [
                {"detection_id": "fixture-object-1", "action": "correct_class", "label": "Trichuris trichiura"},
                {"detection_id": "fixture-object-2", "action": "false_positive"},
                {"action": "missed_detection", "label": "Hookworm", "bbox": [300., 100., 360., 180.]},
            ]}


def test_unconfigured_platform_has_no_fake_accounts_or_patient_results(monkeypatch):
    from backend.main import create_app
    monkeypatch.delenv("HELPMINTHS_DATA_DIR", raising=False)
    monkeypatch.delenv("HELPMINTHS_SERVE_WEB", raising=False)
    with TestClient(create_app(YOLOModelService("")), base_url="https://testserver") as client:
        session = client.get("/api/platform/session")
        assert session.status_code == 200
        assert session.json()["configured"] is False
        assert session.json()["user"] is None
        assert client.get("/api/platform/status").json()["model"]["ready"] is False
        for path in ("/api/platform/analyses", "/api/platform/dashboard", "/api/platform/models"):
            response = client.get(path)
            assert response.status_code == 503, response.text
            assert "not configured" in response.text.lower()
        catalog = client.get("/api/platform/learning/catalog")
        assert catalog.status_code == 200
        assert catalog.json()["approved_count"] == 0
        assert all(item["approval"] is None for item in catalog.json()["items"])


def test_analysis_review_export_feedback_and_counts_share_permissions_and_provenance(platform):
    app, store, actors = platform
    lab, other, reviewer = actors["lab"], actors["other"], actors["reviewer"]
    analysis = create_analysis(lab)
    analysis_id = analysis["id"]
    assert analysis["detections"] == ORIGINAL_DETECTIONS
    assert analysis["counts"]["predicted_total"] == 2
    assert analysis["epg"]["available"] is False
    assert analysis["epg"]["value"] is None
    assert "image_filename" not in analysis
    assert "must-not-retain" not in json.dumps(analysis)
    assert analysis["quality"]["assessment_type"] == "heuristic"

    image = lab.client.get(f"/api/platform/analyses/{analysis_id}/image")
    assert image.status_code == 200
    assert "no-store" in image.headers["cache-control"]
    with Image.open(io.BytesIO(image.content)) as decoded:
        assert dict(decoded.getexif()) == {}
        assert "exif" not in decoded.info
        assert decoded.size == (512, 384)
    for suffix in ("", "/image", "/export.csv", "/audit"):
        denied = other.client.get(f"/api/platform/analyses/{analysis_id}{suffix}")
        assert denied.status_code == 403, denied.text
    denied_pdf = other.write("POST", f"/api/platform/analyses/{analysis_id}/report.pdf")
    assert denied_pdf.status_code == 403
    assert store.count_documents("report") == 0
    denied_feedback = other.write("POST", "/api/platform/feedback", json={"analysis_id": analysis_id, "category": "incorrect_classification", "message": "Fixture cross-user attempt"})
    assert denied_feedback.status_code == 403

    body = verified_review(analysis)
    assert lab.write("POST", f"/api/platform/analyses/{analysis_id}/reviews", json=body).status_code == 403
    without_csrf = reviewer.client.post(f"/api/platform/analyses/{analysis_id}/reviews", json=body)
    assert without_csrf.status_code == 403
    reviewed = reviewer.write("POST", f"/api/platform/analyses/{analysis_id}/reviews", json=body)
    assert reviewed.status_code == 201, reviewed.text
    reviewed = reviewed.json()
    assert reviewed["review_status"] == "verified"
    assert reviewed["detections"] == ORIGINAL_DETECTIONS
    assert reviewed["counts"]["predicted_total"] == 2
    assert reviewed["counts"]["confirmed_total"] == 2
    assert reviewed["counts"]["false_positive_total"] == 1
    assert reviewed["counts"]["missed_detection_total"] == 1
    assert reviewed["latest_review"]["reviewer_id"] == reviewer.user["id"]
    assert reviewed["latest_review"]["annotations"][0]["original_prediction"] == ORIGINAL_DETECTIONS[0]
    assert reviewer.write("POST", f"/api/platform/analyses/{analysis_id}/reviews", json=body).status_code == 409
    assert store.count_documents("review") == 1

    feedback = lab.write("POST", "/api/platform/feedback", json={"analysis_id": analysis_id, "object_id": "fixture-object-1", "category": "incorrect_classification", "message": "Fixture label correction for review"})
    assert feedback.status_code == 201, feedback.text
    feedback = feedback.json()
    triaged = reviewer.write("PATCH", f'/api/platform/feedback/{feedback["id"]}', json={"expected_revision": feedback["revision"], "status": "verified_error", "verified_category": "incorrect_classification", "reviewer_comment": "Matches the isolated review's changed label"})
    assert triaged.status_code == 200, triaged.text
    assert triaged.json()["training_eligible"] is False
    assert triaged.json()["evaluation_eligible"] is False
    assert triaged.json()["evidence_review_id"] == reviewed["latest_review"]["id"]

    exported = lab.client.get(f"/api/platform/analyses/{analysis_id}/export.csv")
    assert exported.status_code == 200
    assert exported.content.startswith(b"\xef\xbb\xbf")
    rows = list(csv.DictReader(io.StringIO(exported.content.decode("utf-8-sig"))))
    assert len(rows) == 3
    assert all(row["analysis_id"] == analysis_id for row in rows)
    assert next(row for row in rows if row["object_id"] == "fixture-object-2")["predicted_class"] == "'=1+1"
    summary = lab.client.get("/api/platform/dashboard").json()
    assert summary["summary"]["total_analyses"] == 1
    assert summary["summary"]["total_detected_objects"] == 2
    assert summary["summary"]["confirmed_objects"] == 2
    assert other.client.get("/api/platform/dashboard").json()["summary"]["total_analyses"] == 0
    assert app.state.model_service.calls == 1, "Review/exports/feedback must not retrain or rerun inference"

    pdf = lab.write("POST", f"/api/platform/analyses/{analysis_id}/report.pdf")
    assert pdf.status_code == 200, pdf.text
    assert pdf.content.startswith(b"%PDF-")
    assert len(pdf.content) > 5000
    assert b"/ToUnicode" in pdf.content, "Thai text needs an embedded Unicode character map"
    if shutil.which("pdftotext"):
        pdf_path = store.data_dir / "synthetic-fixture-report.pdf"
        pdf_path.write_bytes(pdf.content)
        extracted = subprocess.run(["pdftotext", "-layout", str(pdf_path), "-"], check=True, capture_output=True, text=True).stdout
        assert "HelpMinths" in extracted
        assert "รายงาน" in extracted, "The generated report must contain extractable Thai text"
    assert store.count_documents("report") == 1
    evaluation = lab.client.get("/api/platform/evaluation")
    assert evaluation.status_code == 200
    assert evaluation.json()["status"] == "unavailable"
    assert evaluation.json()["metrics"] is None
    assert app.state.model_service.calls == 1


def test_approved_learning_isolated_answers_audit_and_session_revocation(platform):
    _app, store, actors = platform
    student, reviewer, other, admin = actors["student"], actors["reviewer"], actors["other"], actors["admin"]
    catalog = student.client.get("/api/platform/learning/catalog").json()
    reference = catalog["items"][0]
    assert catalog["approved_count"] == 0
    assert student.write("POST", "/api/platform/learning/quizzes", json={"mode": "pretest", "question_count": 1}).status_code == 409
    approval = {"reference_id": reference["id"], "approved": True, "rights_confirmed": True, "label_reviewed": True, "limitations_reviewed": True, "notes": "Explicit isolated test approval, not a production review"}
    assert student.write("POST", "/api/platform/learning/approvals", json=approval).status_code == 403
    approved = reviewer.write("POST", "/api/platform/learning/approvals", json=approval)
    assert approved.status_code in (200, 201), approved.text
    quiz = student.write("POST", "/api/platform/learning/quizzes", json={"mode": "pretest", "question_count": 1})
    assert quiz.status_code == 200, quiz.text
    quiz = quiz.json()
    assert "correct_species_id" not in json.dumps(quiz)
    assert "reference_id" not in json.dumps(quiz)
    # Generic audit access must not bypass the quiz's answer-key filtering.
    assert student.client.get(f'/api/platform/audit/learning_quiz/{quiz["id"]}').status_code == 403
    assert other.client.get(f'/api/platform/learning/quizzes/{quiz["id"]}').status_code == 403
    assert other.client.get(quiz["questions"][0]["image_url"]).status_code == 403
    stored = store.get_document("learning_quiz", quiz["id"])
    answer = {"question_id": quiz["questions"][0]["id"], "species_id": stored["data"]["questions"][0]["correct_species_id"]}
    result = student.write("POST", f'/api/platform/learning/quizzes/{quiz["id"]}/submit', json={"answers": [answer]})
    assert result.status_code == 200, result.text
    result = result.json()
    assert result["correct"] == result["total"] == 1
    assert result["percentage_correct"] == 100
    assert "ไม่ใช่ความแม่นยำ" in result["notice"]
    assert other.client.get(f'/api/platform/learning/attempts/{result["id"]}').status_code == 403
    assert student.write("POST", f'/api/platform/learning/quizzes/{quiz["id"]}/submit', json={"answers": [answer]}).status_code == 409
    assert student.client.get("/api/platform/learning/progress").json()["attempt_count"] == 1

    # A previously valid role/session must lose clinical access after an admin change.
    analysis = create_analysis(actors["lab"], "SESSION_fixture")
    changed = admin.write("PATCH", f'/api/platform/users/{actors["lab"].user["id"]}', json={"active": False})
    assert changed.status_code == 200, changed.text
    assert actors["lab"].client.get(f'/api/platform/analyses/{analysis["id"]}/image').status_code == 401
    assert actors["lab"].client.get("/api/platform/session").json()["user"] is None


def test_history_dashboard_and_csv_share_thai_calendar_boundaries(platform):
    _app, store, actors = platform
    lab = actors["lab"]
    analysis = create_analysis(lab, "DATE_fixture")
    # A historical test timestamp: 01:00 on 29 October in Thailand, still 28 October UTC.
    with store.connection() as conn:
        conn.execute("UPDATE documents SET created_at=? WHERE id=?", ("2026-10-28T18:00:00.000Z", analysis["id"]))
    query = {"date_from": "2026-10-29", "date_to": "2026-10-29"}
    history = lab.client.get("/api/platform/analyses", params=query)
    dashboard = lab.client.get("/api/platform/dashboard", params=query)
    exported = lab.client.get("/api/platform/exports.csv", params=query)
    assert history.status_code == dashboard.status_code == exported.status_code == 200
    assert history.json()["total"] == dashboard.json()["summary"]["total_analyses"] == 1
    rows = list(csv.DictReader(io.StringIO(exported.content.decode("utf-8-sig"))))
    assert len(rows) == 2
    assert {row["analysis_id"] for row in rows} == {analysis["id"]}
    previous = {"date_from": "2026-10-28", "date_to": "2026-10-28"}
    assert lab.client.get("/api/platform/analyses", params=previous).json()["total"] == 0
    assert lab.client.get("/api/platform/dashboard", params=previous).json()["summary"]["total_analyses"] == 0
