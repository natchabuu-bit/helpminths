"""Isolated Learning Lab fixtures; not production users, approvals or results."""
from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.platform.auth import router as auth_router
from backend.platform.learning import router as learning_router
from backend.platform.store import PlatformStore

REFERENCE = "ascaris-fertilized-unfertilized-buckelew"
PASSWORD = "isolated-test-only-password"


@pytest.fixture
def learning_app(tmp_path, monkeypatch):
    monkeypatch.setenv("HELPMINTHS_COOKIE_SECURE", "0")
    store = PlatformStore(tmp_path / "learning-fixture")
    users = {role: store.create_user(f"fixture-{role}", PASSWORD, role) for role in ("admin", "reviewer", "student")}
    users["other"] = store.create_user("fixture-other-student", PASSWORD, "student")
    app = FastAPI()
    app.state.platform_store = store
    app.include_router(auth_router)
    app.include_router(learning_router)
    return app, store, users


def login(app, username):
    client = TestClient(app)
    response = client.post("/api/platform/login", json={"username": username, "password": PASSWORD})
    assert response.status_code == 200
    return client, {"X-CSRF-Token": response.json()["csrf_token"]}


def approval(**changes):
    return {"reference_id": REFERENCE, "approved": True, "rights_confirmed": True, "label_reviewed": True, "limitations_reviewed": True,
            "notes": "Test fixture: reviewed source label and image limitations for teaching only.", **changes}


def approve(client, headers, **changes):
    result = client.post("/api/platform/learning/approvals", headers=headers, json=approval(**changes))
    assert result.status_code == 200, result.text
    return result.json()


def quiz(client, headers):
    result = client.post("/api/platform/learning/quizzes", headers=headers, json={"mode": "pretest", "question_count": 5})
    assert result.status_code == 200, result.text
    return result.json()


def test_catalog_is_source_backed_without_fabricated_approval_or_config(monkeypatch):
    monkeypatch.delenv("HELPMINTHS_DATA_DIR", raising=False)
    app = FastAPI()
    app.state.platform_store = PlatformStore()
    app.include_router(auth_router)
    app.include_router(learning_router)
    with TestClient(app) as client:
        result = client.get("/api/platform/learning/catalog")
        assert result.status_code == 200
        body = result.json()
        assert body["configured"] is False and body["approved_count"] == 0
        assert len(body["items"]) == 11
        assert all(item["approval"] is None and item["source_url"].startswith("https://") and item["license"] == "CC BY-NC 4.0" for item in body["items"])
        assert client.post("/api/platform/learning/quizzes", json={"mode": "practice", "question_count": 1}).status_code == 503


def test_only_actual_privileged_review_unlocks_quizzes(learning_app):
    app, store, users = learning_app
    student, student_headers = login(app, users["student"]["username"])
    reviewer, reviewer_headers = login(app, users["reviewer"]["username"])
    try:
        assert student.post("/api/platform/learning/quizzes", json={"mode": "practice", "question_count": 1}, headers=student_headers).status_code == 409
        assert student.post("/api/platform/learning/approvals", json=approval(), headers=student_headers).status_code == 403
        assert reviewer.post("/api/platform/learning/approvals", json=approval()).status_code == 403
        assert reviewer.post("/api/platform/learning/approvals", json=approval(reference_id="untrusted-remote-reference"), headers=reviewer_headers).status_code == 404
        assert reviewer.post("/api/platform/learning/approvals", json=approval(correct_species_id="taenia"), headers=reviewer_headers).status_code == 422
        record = approve(reviewer, reviewer_headers)
        assert record["reviewer_id"] == users["reviewer"]["id"]
        assert record["species_id"] == "ascaris" and record["revision"] == 1
        assert len(record["source_fingerprint"]) == 64
        assert student.get("/api/platform/learning/catalog").json()["approved_count"] == 1
        assert store.count_documents("learning_attempt") == 0
        created = quiz(student, student_headers)
        assert len(created["questions"]) == 1, "No duplicate or fictitious images fill an undersized bank"
        assert "correct_species_id" not in json.dumps(created)
        assert "reference_id" not in json.dumps(created)
        assert REFERENCE not in created["questions"][0]["image_url"]
    finally:
        student.close(); reviewer.close()


def test_actual_answer_scoring_attempt_acl_and_duplicate_prevention(learning_app):
    app, store, users = learning_app
    reviewer, review_headers = login(app, users["reviewer"]["username"])
    student, headers = login(app, users["student"]["username"])
    other, other_headers = login(app, users["other"]["username"])
    try:
        approve(reviewer, review_headers)
        created = quiz(student, headers)
        question = created["questions"][0]
        assert student.get(question["image_url"]).status_code == 200
        assert other.get(question["image_url"]).status_code == 403
        assert other.get(f'/api/platform/learning/quizzes/{created["id"]}').status_code == 403
        path = f'/api/platform/learning/quizzes/{created["id"]}/submit'
        assert other.post(path, headers=other_headers, json={"answers": [{"question_id": question["id"], "species_id": "ascaris"}]}).status_code == 403
        assert student.post(path, headers=headers, json={"answers": [{"question_id": question["id"], "species_id": "not-a-choice"}]}).status_code == 422
        response = student.post(path, headers=headers, json={"answers": [{"question_id": question["id"], "species_id": None}]})
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["percentage_correct"] == 0 and result["correct"] == 0 and result["total"] == 1
        assert result["results"][0]["correct_species_id"] == "ascaris"
        assert result["results"][0]["reviewer_id"] == users["reviewer"]["id"]
        assert student.post(path, headers=headers, json={"answers": [{"question_id": question["id"], "species_id": "ascaris"}]}).status_code == 409
        assert store.count_documents("learning_attempt") == 1
        assert student.get("/api/platform/learning/progress").json()["attempt_count"] == 1
        assert other.get("/api/platform/learning/progress", params={"owner_id": users["student"]["id"]}).json()["attempt_count"] == 0
        assert other.get(f'/api/platform/learning/attempts/{result["id"]}').status_code == 403
        assert student.get("/api/platform/learning/attempts").json()["items"][0]["id"] == result["id"]
    finally:
        reviewer.close(); student.close(); other.close()


def test_stale_or_withdrawn_approval_cannot_silently_grade_old_questions(learning_app):
    app, store, users = learning_app
    reviewer, review_headers = login(app, users["reviewer"]["username"])
    student, headers = login(app, users["student"]["username"])
    try:
        approved = approve(reviewer, review_headers)
        old = quiz(student, headers)
        revised = approve(reviewer, review_headers, expected_revision=approved["revision"], notes="Test fixture: second reviewer pass with updated teaching limitations.")
        assert revised["revision"] == 2
        path = f'/api/platform/learning/quizzes/{old["id"]}/submit'
        assert student.post(path, headers=headers, json={"answers": [{"question_id": old["questions"][0]["id"], "species_id": "ascaris"}]}).status_code == 409
        assert store.count_documents("learning_attempt") == 0
        current = quiz(student, headers)
        result = student.post(f'/api/platform/learning/quizzes/{current["id"]}/submit', headers=headers, json={"answers": [{"question_id": current["questions"][0]["id"], "species_id": "ascaris"}]})
        assert result.status_code == 200 and result.json()["percentage_correct"] == 100
        pending = quiz(student, headers)
        approve(reviewer, review_headers, expected_revision=2, approved=False)
        assert student.get("/api/platform/learning/catalog").json()["approved_count"] == 0
        assert student.post(f'/api/platform/learning/quizzes/{pending["id"]}/submit', headers=headers, json={"answers": [{"question_id": pending["questions"][0]["id"], "species_id": "ascaris"}]}).status_code == 409
        assert store.count_documents("learning_attempt") == 1
    finally:
        reviewer.close(); student.close()
