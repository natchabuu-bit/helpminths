"""Private referral workflow tests using synthetic records, never clinical images."""
from __future__ import annotations

import uuid
from copy import deepcopy

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from backend.platform import analyses, auth, reviews
from backend.platform.store import PlatformStore

PASSWORD = "Synthetic-referral-password-2026"


@pytest.fixture
def platform(tmp_path, monkeypatch):
    monkeypatch.setenv("HELPMINTHS_COOKIE_SECURE", "0")
    store = PlatformStore(tmp_path / "private-synthetic-referrals")
    users = {name: store.create_user(name, PASSWORD, role) for name, role in [
        ("refowner", "lab"), ("refother", "lab"), ("refexpert", "reviewer"),
        ("refadmin", "admin"), ("refstudent", "student"),
    ]}
    app = FastAPI()
    app.state.platform_store = store
    app.include_router(auth.router)
    app.include_router(analyses.router)
    app.include_router(reviews.router)
    with TestClient(app) as client:
        yield client, store, users


def login(client, name, *, expert=False):
    response = client.post("/api/platform/login", json={"username": name, "password": PASSWORD})
    assert response.status_code == 200, response.text
    client.headers["X-CSRF-Token"] = response.json()["csrf_token"]
    if expert:
        unlocked = client.post("/api/platform/expert-login", json={"password": PASSWORD})
        assert unlocked.status_code == 200, unlocked.text


def record(store, user, *, status="completed", code="SYNTHETIC_REFERRAL", image=True):
    identifier = uuid.uuid4().hex
    data = {
        "sample_code": code, "width": 320, "height": 240, "status": status,
        "review_status": "unreviewed", "model_version": "synthetic-referral-model",
        "review_confidence_threshold": .5,
        "detections": [
            {"id": "ref-det-1", "class_id": 0, "label": "TEST CHART OBJECT A", "confidence": .4, "bbox": [20, 20, 80, 80]},
            {"id": "ref-det-2", "class_id": 1, "label": "TEST CHART OBJECT B", "confidence": .9, "bbox": [120, 100, 200, 180]},
        ],
        "image_filename": f"{identifier}.png" if image else None,
    }
    if image:
        picture = Image.new("RGB", (320, 240), "#a7b7a9")
        path = store.image_dir / f"{identifier}.png"
        picture.save(path, format="PNG")
        path.chmod(0o600)
        picture.close()
    return store.create_document("analysis", data, user["id"], user["id"], document_id=identifier)


def submit(client, item, reason="SYNTHETIC TEST: unclear chart border, please review."):
    return client.post(f"/api/platform/analyses/{item['id']}/referrals", json={
        "expected_revision": item["revision"], "reason": reason,
    })


def review_body(revision, *, status="verified", comment="SYNTHETIC TEST expert response"):
    return {"expected_revision": revision, "status": status, "full_image_reviewed": status == "verified",
            "comment": comment, "annotations": [
                {"detection_id": "ref-det-1", "action": "confirm"},
                {"detection_id": "ref-det-2", "action": "confirm"},
            ]}


def test_owner_referral_is_atomic_deduplicated_and_does_not_copy_the_image(platform):
    client, store, users = platform
    original = record(store, users["refowner"])
    original_detections = deepcopy(original["data"]["detections"])
    before_images = list(store.image_dir.iterdir())
    login(client, "refowner")
    created = submit(client, original)
    assert created.status_code == 201, created.text
    referral = created.json()
    assert referral["status"] == "pending"
    assert referral["owner_id"] == users["refowner"]["id"]
    assert referral["analysis_revision_at_referral"] == 1
    assert referral["analysis"]["revision"] == 2
    assert referral["analysis"]["counts"]["uncertain_total"] == 1
    assert referral["analysis"]["image_url"] == f"/api/platform/analyses/{original['id']}/image"
    repeated = submit(client, original, "A repeated click must not replace the first request.")
    assert repeated.status_code == 200
    assert repeated.json()["id"] == referral["id"]
    assert repeated.json()["reason"] == referral["reason"]
    assert store.count_documents("referral") == 1
    saved = store.get_document("analysis", original["id"])
    assert saved["revision"] == 2
    assert saved["data"]["detections"] == original_detections
    assert saved["data"]["referral_status"] == "pending"
    assert list(store.image_dir.iterdir()) == before_images
    assert client.get(f"/api/platform/analyses/{original['id']}/referral").json()["referral"]["id"] == referral["id"]


def test_only_the_owner_can_refer_a_completed_available_image(platform):
    client, store, users = platform
    original = record(store, users["refowner"])
    assert submit(client, original).status_code == 401
    login(client, "refother")
    assert submit(client, original).status_code == 403
    login(client, "refexpert", expert=True)
    assert submit(client, original).status_code == 403, "Experts may not create owner requests for another person"
    login(client, "refowner")
    assert submit(client, original, "   ").status_code == 422
    assert client.post(f"/api/platform/analyses/{original['id']}/referrals", json={"expected_revision": 1, "reason": "test", "status": "confirmed"}).status_code == 422
    failed = record(store, users["refowner"], status="failed")
    assert submit(client, failed).status_code == 409
    missing = record(store, users["refowner"], image=False)
    assert submit(client, missing).status_code == 410
    stale = {**original, "revision": 2}
    assert submit(client, stale).status_code == 409
    assert store.count_documents("referral") == 0


def test_expert_queue_requires_a_separate_live_expert_login_and_scope_stays_private(platform):
    client, store, users = platform
    original = record(store, users["refowner"])
    login(client, "refowner")
    referral = submit(client, original).json()
    assert client.get("/api/platform/referrals").json()["total"] == 1
    assert client.get("/api/platform/referrals?scope=expert").status_code == 403
    assert client.post("/api/platform/expert-login", json={"password": PASSWORD}).status_code == 403
    login(client, "refother")
    assert client.get("/api/platform/referrals").json()["total"] == 0
    assert client.get(f"/api/platform/referrals/{referral['id']}").status_code == 403
    assert client.get(f"/api/platform/analyses/{original['id']}/image").status_code == 403
    login(client, "refexpert")
    queue = client.get("/api/platform/referrals?scope=expert")
    assert queue.status_code == 403
    assert queue.json()["detail"]["code"] == "expert_verification_required"
    assert client.post(f"/api/platform/analyses/{original['id']}/reviews", json=review_body(2)).status_code == 403
    unlocked = client.post("/api/platform/expert-login", json={"password": PASSWORD})
    assert unlocked.status_code == 200
    assert client.get("/api/platform/referrals?scope=expert").json()["total"] == 1
    assert client.get("/api/platform/referrals").json()["total"] == 0, "Expert mine scope must not include all owners"
    assert client.get(f"/api/platform/referrals/{referral['id']}").status_code == 200
    locked = client.delete("/api/platform/expert-session")
    assert locked.status_code == 200
    assert client.get("/api/platform/referrals?scope=expert").status_code == 403
    assert client.get(f"/api/platform/referrals/{referral['id']}").status_code == 403


def test_confirmation_replies_to_the_owner_and_retains_predictions_and_audit(platform):
    client, store, users = platform
    original = record(store, users["refowner"])
    login(client, "refowner")
    referral = submit(client, original).json()
    login(client, "refexpert", expert=True)
    response = client.post(f"/api/platform/analyses/{original['id']}/reviews", json=review_body(2))
    assert response.status_code == 201, response.text
    reviewed = response.json()
    assert reviewed["detections"] == original["data"]["detections"]
    assert reviewed["review_status"] == "verified"
    assert reviewed["referral_status"] == "confirmed"
    assert reviewed["counts"]["confirmed_total"] == 2
    assert client.get("/api/platform/referrals?scope=expert").json()["total"] == 0
    assert client.get("/api/platform/referrals?scope=expert&status=confirmed").json()["total"] == 1
    login(client, "refowner")
    answered = client.get(f"/api/platform/referrals/{referral['id']}").json()
    assert answered["status"] == "confirmed"
    assert answered["response_comment"] == "SYNTHETIC TEST expert response"
    assert answered["reviewer_username"] == "refexpert"
    assert answered["responded_at"]
    assert answered["latest_review_id"] == reviewed["latest_review"]["id"]
    history = client.get(f"/api/platform/analyses/{original['id']}/reviews").json()
    assert history["total"] == 1
    audit = store.list_audit("referral", referral["id"])
    assert audit[0]["before_data"]["status"] == "pending"
    assert audit[0]["after_data"]["status"] == "confirmed"


def test_additional_review_remains_in_the_queue_until_an_expert_can_confirm(platform):
    client, store, users = platform
    original = record(store, users["refowner"])
    login(client, "refowner")
    referral = submit(client, original).json()
    login(client, "refexpert", expert=True)
    uncertain = review_body(2, status="needs_additional_review", comment="SYNTHETIC TEST: require another focal plane")
    uncertain["annotations"][0]["action"] = "uncertain"
    response = client.post(f"/api/platform/analyses/{original['id']}/reviews", json=uncertain)
    assert response.status_code == 201
    assert response.json()["referral_status"] == "needs_more"
    assert client.get("/api/platform/referrals?scope=expert&status=needs_more").json()["total"] == 1
    login(client, "refowner")
    assert client.get(f"/api/platform/referrals/{referral['id']}").json()["response_comment"] == uncertain["comment"]
    assert client.get("/api/platform/referrals").json()["total"] == 1
    login(client, "refexpert", expert=True)
    confirmed = client.post(f"/api/platform/analyses/{original['id']}/reviews", json=review_body(3))
    assert confirmed.status_code == 201
    assert confirmed.json()["referral_status"] == "confirmed"


def test_stale_or_invalid_reviews_do_not_partially_update_the_referral(platform):
    client, store, users = platform
    original = record(store, users["refowner"])
    login(client, "refowner")
    referral = submit(client, original).json()
    login(client, "refexpert", expert=True)
    stale = client.post(f"/api/platform/analyses/{original['id']}/reviews", json=review_body(1))
    assert stale.status_code == 409
    invalid = review_body(2)
    invalid["annotations"] = invalid["annotations"][:1]
    assert client.post(f"/api/platform/analyses/{original['id']}/reviews", json=invalid).status_code == 422
    assert store.count_documents("review") == 0
    unchanged = store.get_document("referral", referral["id"])
    assert unchanged["revision"] == 1
    assert unchanged["data"]["status"] == "pending"
    assert unchanged["data"]["response_comment"] is None


def test_a_confirmed_request_can_be_resubmitted_without_overwriting_the_previous_answer(platform):
    client, store, users = platform
    original = record(store, users["refowner"])
    login(client, "refowner")
    first = submit(client, original).json()
    login(client, "refexpert", expert=True)
    confirmed = client.post(f"/api/platform/analyses/{original['id']}/reviews", json=review_body(2)).json()
    login(client, "refowner")
    assert submit(client, original, "SYNTHETIC TEST stale revision").status_code == 409
    new = submit(client, confirmed, "SYNTHETIC TEST: new question about the same chart")
    assert new.status_code == 201
    assert new.json()["id"] != first["id"]
    assert new.json()["status"] == "pending"
    previous = client.get(f"/api/platform/referrals/{first['id']}").json()
    assert previous["status"] == "confirmed"
    assert previous["response_comment"] == "SYNTHETIC TEST expert response"
    assert store.count_documents("referral") == 2
    assert client.get("/api/platform/referrals").json()["total"] == 1


def test_queue_dates_search_and_pagination_keep_thai_days_and_escape_wildcards(platform):
    client, store, users = platform
    one = record(store, users["refowner"], code="SYNTHETIC_REF_ONE")
    two = record(store, users["refowner"], code="SYNTHETIC_REF_TWO")
    login(client, "refowner")
    first, second = submit(client, one).json(), submit(client, two).json()
    with store.transaction() as conn:
        conn.execute("UPDATE documents SET created_at=? WHERE id=?", ("2026-11-05T17:01:00Z", first["id"]))
        conn.execute("UPDATE documents SET created_at=? WHERE id=?", ("2026-11-05T16:59:00Z", second["id"]))
    selected = client.get("/api/platform/referrals", params={"date_from": "2026-11-06", "date_to": "2026-11-06"}).json()
    assert selected["total"] == 1
    assert selected["items"][0]["id"] == first["id"]
    assert client.get("/api/platform/referrals", params={"q": "_ONE"}).json()["total"] == 1
    assert client.get("/api/platform/referrals", params={"q": "%"}).json()["total"] == 0
    assert client.get("/api/platform/referrals", params={"limit": 1, "offset": 1}).json()["items"][0]["id"] == first["id"]
    assert client.get("/api/platform/referrals", params={"date_from": "2026-11-07", "date_to": "2026-11-06"}).status_code == 422
    assert client.get("/api/platform/referrals", params={"status": "made_up"}).status_code == 422


def test_deleting_the_analysis_removes_it_from_both_queues_and_image_access_but_retains_audit(platform):
    client, store, users = platform
    original = record(store, users["refowner"])
    login(client, "refowner")
    referral = submit(client, original).json()
    deleted = client.delete(f"/api/platform/analyses/{original['id']}", params={"expected_revision": 2})
    assert deleted.status_code == 200, deleted.text
    assert client.get("/api/platform/referrals").json()["total"] == 0
    assert client.get(f"/api/platform/referrals/{referral['id']}").status_code == 404
    assert client.get(f"/api/platform/analyses/{original['id']}/image").status_code == 404
    login(client, "refexpert", expert=True)
    assert client.get("/api/platform/referrals?scope=expert").json()["total"] == 0
    assert store.get_document("referral", referral["id"]) is not None
    assert store.list_audit("referral", referral["id"])
