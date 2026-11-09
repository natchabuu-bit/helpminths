"""Private referral workflow tests using synthetic records, never clinical images."""
from __future__ import annotations

import io
import uuid
from copy import deepcopy

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from backend import images
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


def respond(client, referral, *, action="request_more", comment="SYNTHETIC TEST: send another focal plane"):
    return client.post(f"/api/platform/referrals/{referral['id']}/response", json={
        "expected_revision": referral["revision"], "action": action, "comment": comment,
    })


def attachment_bytes():
    output = io.BytesIO()
    exif = Image.Exif()
    exif[274] = 6
    exif[315] = "SYNTHETIC_PRIVATE_METADATA"
    with Image.new("RGB", (48, 32), "#a7b7a9") as picture:
        picture.save(output, format="JPEG", exif=exif)
    return output.getvalue()


def upload_attachment(client, referral, *, content=None, filename="SYNTHETIC_PRIVATE_FILE.jpg", mime="image/jpeg", revision=None):
    return client.post(f"/api/platform/referrals/{referral['id']}/attachments",
                       data={"expected_revision": revision or referral["revision"], "comment": "SYNTHETIC TEST additional view"},
                       files={"image": (filename, attachment_bytes() if content is None else content, mime)})


def prepare_requested_attachment(client, store, users):
    original = record(store, users["refowner"])
    login(client, "refowner")
    referral = submit(client, original).json()
    login(client, "refexpert", expert=True)
    requested = respond(client, referral)
    assert requested.status_code == 200, requested.text
    return original, requested.json()


def test_expert_messages_require_live_verification_and_do_not_confirm_or_replace_predictions(platform):
    client, store, users = platform
    original = record(store, users["refowner"])
    login(client, "refowner")
    referral = submit(client, original).json()
    assert respond(client, referral).status_code == 403
    login(client, "refexpert")
    locked = respond(client, referral)
    assert locked.status_code == 403
    assert locked.json()["detail"]["code"] == "expert_verification_required"
    client.post("/api/platform/expert-login", json={"password": PASSWORD})
    assert respond(client, referral, comment="  ").status_code == 422
    assert client.post(f"/api/platform/referrals/{referral['id']}/response", json={
        "expected_revision": 1, "action": "confirm", "comment": "Cannot bypass full review",
    }).status_code == 422
    replied = respond(client, referral, action="reply", comment="  SYNTHETIC TEST: reviewing this view  ")
    assert replied.status_code == 200, replied.text
    reply = replied.json()
    assert reply["status"] == "in_review"
    assert reply["analysis"]["revision"] == 3
    assert reply["response_comment"] == "SYNTHETIC TEST: reviewing this view"
    assert reply["reviewer_id"] == users["refexpert"]["id"]
    assert reply["responded_at"]
    assert respond(client, referral).status_code == 409
    requested = respond(client, reply).json()
    assert requested["status"] == "needs_more"
    saved = store.get_document("analysis", original["id"])
    assert saved["data"]["detections"] == original["data"]["detections"]
    assert saved["data"]["model_version"] == original["data"]["model_version"]
    assert saved["data"]["review_status"] == original["data"]["review_status"]
    assert saved["data"]["referral_status"] == "needs_more"
    assert store.count_documents("review") == 0
    messages = client.get(f"/api/platform/referrals/{referral['id']}/messages")
    assert messages.headers["cache-control"] == "private, no-store"
    assert [item["action"] for item in messages.json()["items"]] == ["request", "reply", "request_more"]
    assert messages.json()["items"][1]["author_username"] == "refexpert"
    assert client.get(f"/api/platform/referrals/{referral['id']}/messages", params={"limit": 1, "offset": 1}).json()["total"] == 3
    assert len(store.list_audit("referral", referral["id"])) == 3
    client.delete("/api/platform/expert-session")
    assert respond(client, requested).status_code == 403


def test_additional_image_requeues_same_analysis_and_preserves_conversation_and_final_review_gate(platform):
    client, store, users = platform
    original, referral = prepare_requested_attachment(client, store, users)
    login(client, "refowner")
    uploaded = upload_attachment(client, referral)
    assert uploaded.status_code == 201, uploaded.text
    assert uploaded.headers["cache-control"] == "private, no-store"
    attachment, queued = uploaded.json()["attachment"], uploaded.json()["referral"]
    assert queued["id"] == referral["id"] and queued["status"] == "pending"
    assert queued["response_comment"] == referral["response_comment"]
    assert queued["analysis"]["id"] == original["id"]
    assert queued["analysis"]["revision"] == 4
    assert "image_filename" not in attachment and "SYNTHETIC_PRIVATE_FILE" not in str(attachment)
    assert (attachment["width"], attachment["height"]) == (32, 48)
    assert len(attachment["id"]) == 32
    image_path = store.image_dir / f"{attachment['id']}.png"
    assert image_path.stat().st_mode & 0o777 == 0o600
    downloaded = client.get(attachment["image_url"])
    assert downloaded.status_code == 200
    assert downloaded.headers["cache-control"] == "private, no-store"
    assert downloaded.headers["x-content-type-options"] == "nosniff"
    assert "SYNTHETIC_PRIVATE" not in str(downloaded.headers)
    assert b"SYNTHETIC_PRIVATE_METADATA" not in downloaded.content
    with Image.open(io.BytesIO(downloaded.content)) as normalized:
        assert normalized.format == "PNG" and normalized.size == (32, 48)
        assert normalized.info == {} and len(normalized.getexif()) == 0
    listed = client.get(f"/api/platform/referrals/{referral['id']}/attachments").json()
    assert listed["total"] == 1 and listed["items"][0] == attachment
    assert upload_attachment(client, queued).status_code == 409
    assert upload_attachment(client, referral).status_code == 409
    assert store.count_documents("analysis") == 1, "Additional images must never create another AI result"
    assert store.get_document("analysis", original["id"])["data"]["detections"] == original["data"]["detections"]
    login(client, "refexpert", expert=True)
    assert client.get("/api/platform/referrals?scope=expert&status=pending").json()["total"] == 1
    incomplete = review_body(4)
    incomplete["full_image_reviewed"] = False
    assert client.post(f"/api/platform/analyses/{original['id']}/reviews", json=incomplete).status_code == 422
    incomplete["full_image_reviewed"] = True
    incomplete["annotations"].pop()
    assert client.post(f"/api/platform/analyses/{original['id']}/reviews", json=incomplete).status_code == 422
    confirmed = client.post(f"/api/platform/analyses/{original['id']}/reviews", json=review_body(4))
    assert confirmed.status_code == 201, confirmed.text
    assert confirmed.json()["referral_status"] == "confirmed"
    messages = client.get(f"/api/platform/referrals/{referral['id']}/messages").json()["items"]
    assert [item["action"] for item in messages] == ["request", "request_more", "attachment", "confirmed"]
    assert messages[2]["attachment_id"] == attachment["id"]
    assert messages[-1]["review_id"] == confirmed.json()["latest_review"]["id"]
    assert client.get("/api/platform/referrals?scope=expert&state=pending").json()["total"] == 0
    assert client.get("/api/platform/referrals?scope=expert&state=completed").json()["total"] == 1
    assert client.get("/api/platform/referrals?scope=expert&state=all").json()["total"] == 1
    current = client.get(f"/api/platform/referrals/{referral['id']}").json()
    assert respond(client, current, action="reply").status_code == 409


def test_attachment_access_is_owner_or_current_expert_only_and_upload_is_owner_only(platform):
    client, store, users = platform
    _, referral = prepare_requested_attachment(client, store, users)
    assert upload_attachment(client, referral).status_code == 403, "Experts may read but cannot upload for owners"
    login(client, "refowner")
    attachment = upload_attachment(client, referral).json()["attachment"]
    routes = [f"/api/platform/referrals/{referral['id']}/attachments", attachment["image_url"],
              f"/api/platform/referrals/{referral['id']}/messages"]
    for username in ("refother", "refstudent", "refexpert", "refadmin"):
        login(client, username)
        for route in routes:
            assert client.get(route).status_code == 403, (username, route)
        assert upload_attachment(client, referral).status_code == 403
    login(client, "refexpert", expert=True)
    for route in routes:
        assert client.get(route).status_code == 200
    client.delete("/api/platform/expert-session")
    for route in routes:
        assert client.get(route).status_code == 403
    client.post("/api/platform/logout")
    for route in routes:
        assert client.get(route).status_code == 401


def test_demoted_student_owner_can_read_previous_images_but_cannot_add_requested_images(platform):
    client, store, users = platform
    _, referral = prepare_requested_attachment(client, store, users)
    login(client, "refowner")
    uploaded = upload_attachment(client, referral).json()
    attachment = uploaded["attachment"]
    login(client, "refexpert", expert=True)
    requested = respond(client, uploaded["referral"]).json()
    assert requested["status"] == "needs_more"
    store.create_user("refsystemowner", PASSWORD, "admin", is_super_admin=True)
    login(client, "refsystemowner")
    demoted = client.patch(f"/api/platform/users/{users['refowner']['id']}", json={"role": "student"})
    assert demoted.status_code == 200, demoted.text
    assert demoted.json()["role"] == "student" and demoted.json()["approval_status"] == "approved"
    login(client, "refowner")
    for route in [f"/api/platform/referrals/{referral['id']}",
                  f"/api/platform/referrals/{referral['id']}/attachments",
                  f"/api/platform/referrals/{referral['id']}/messages", attachment["image_url"]]:
        assert client.get(route).status_code == 200, route
    before_files = set(store.image_dir.iterdir())
    assert upload_attachment(client, requested).status_code == 403
    assert set(store.image_dir.iterdir()) == before_files
    assert store.count_documents("referral_attachment") == 1
    unchanged = store.get_document("referral", referral["id"])
    assert unchanged["revision"] == requested["revision"]
    assert unchanged["data"]["status"] == "needs_more"


@pytest.mark.parametrize("content,mime,expected", [
    (b"", "image/png", 400), (b"not-a-raster", "image/png", 400),
    (b"<svg><script>test</script></svg>", "image/svg+xml", 415),
    (b"%PDF-1.7 synthetic", "application/pdf", 415),
])
def test_invalid_attachment_keeps_request_open_without_partial_files_or_documents(platform, content, mime, expected):
    client, store, users = platform
    _, referral = prepare_requested_attachment(client, store, users)
    login(client, "refowner")
    files_before = set(store.image_dir.iterdir())
    response = upload_attachment(client, referral, content=content, mime=mime)
    assert response.status_code == expected, response.text
    assert set(store.image_dir.iterdir()) == files_before
    assert store.count_documents("referral_attachment") == 0
    assert store.get_document("referral", referral["id"])["revision"] == referral["revision"]
    assert store.get_document("referral", referral["id"])["data"]["status"] == "needs_more"
    assert store.count_documents("referral_message") == 2


def test_attachment_limits_and_failed_database_writes_cleanup_private_files(platform, monkeypatch):
    client, store, users = platform
    _, referral = prepare_requested_attachment(client, store, users)
    login(client, "refowner")
    before = set(store.image_dir.iterdir())
    with monkeypatch.context() as limits:
        limits.setattr(images, "MAX_UPLOAD_BYTES", 10)
        assert upload_attachment(client, referral).status_code == 413
    with monkeypatch.context() as limits:
        limits.setattr(images, "MAX_IMAGE_PIXELS", 10)
        assert upload_attachment(client, referral).status_code == 413
    with monkeypatch.context() as limits:
        limits.setattr(reviews, "MAX_REFERRAL_ATTACHMENTS", 0)
        assert upload_attachment(client, referral).status_code == 409
    original_create = store.create_document

    def fail_after_image_and_attachment(kind, *args, **kwargs):
        if kind == "referral_message":
            raise RuntimeError("Synthetic write failure")
        return original_create(kind, *args, **kwargs)

    with monkeypatch.context() as failure:
        failure.setattr(store, "create_document", fail_after_image_and_attachment)
        with pytest.raises(RuntimeError, match="Synthetic write failure"):
            upload_attachment(client, referral)
    assert set(store.image_dir.iterdir()) == before
    assert store.count_documents("referral_attachment") == 0
    assert store.count_documents("referral_message") == 2
    assert store.get_document("referral", referral["id"])["revision"] == referral["revision"]
    assert store.get_document("analysis", referral["analysis"]["id"])["revision"] == referral["analysis"]["revision"]


def test_failed_image_save_and_stale_upload_cleanup_without_answering_the_request(platform, monkeypatch):
    client, store, users = platform
    _, referral = prepare_requested_attachment(client, store, users)
    login(client, "refowner")
    before = set(store.image_dir.iterdir())

    def failed_save(_image, path):
        path.write_bytes(b"synthetic interrupted file")
        raise OSError("Synthetic storage failure")

    with monkeypatch.context() as failure:
        failure.setattr(analyses, "_save_image", failed_save)
        assert upload_attachment(client, referral).status_code == 503
    assert set(store.image_dir.iterdir()) == before
    assert store.get_document("referral", referral["id"])["revision"] == referral["revision"]
    save_image = analyses._save_image

    def save_with_simultaneous_expert_response(image, path):
        save_image(image, path)
        # The upload has decoded the image; another expert response arrives
        # before the short database write transaction starts.
        with store.transaction() as conn:
            current = store.get_document("referral", referral["id"], conn=conn)
            store.update_document("referral", referral["id"], {**current["data"], "status": "in_review"},
                                  users["refexpert"]["id"], expected_revision=current["revision"], conn=conn)
            analysis = store.get_document("analysis", referral["analysis"]["id"], conn=conn)
            store.update_document("analysis", analysis["id"], {**analysis["data"], "referral_status": "in_review"},
                                  users["refexpert"]["id"], expected_revision=analysis["revision"], conn=conn)

    with monkeypatch.context() as race:
        race.setattr(analyses, "_save_image", save_with_simultaneous_expert_response)
        assert upload_attachment(client, referral).status_code == 409
    assert set(store.image_dir.iterdir()) == before
    assert store.count_documents("referral_attachment") == 0
    assert store.get_document("referral", referral["id"])["data"]["status"] == "in_review"


def test_attachment_writes_keep_csrf_checks_and_private_image_path_guards(platform):
    client, store, users = platform
    _, referral = prepare_requested_attachment(client, store, users)
    login(client, "refowner")
    csrf = client.headers.pop("X-CSRF-Token")
    assert upload_attachment(client, referral).status_code == 403
    client.headers["X-CSRF-Token"] = csrf
    attachment = upload_attachment(client, referral).json()["attachment"]
    path = store.image_dir / f"{attachment['id']}.png"
    saved = path.read_bytes()
    path.unlink()
    outside = store.data_dir / "synthetic-outside-image-store.png"
    outside.write_bytes(saved)
    path.symlink_to(outside)
    assert client.get(attachment["image_url"]).status_code == 410
    path.unlink()
    path.write_bytes(saved)
    stored = store.get_document("referral_attachment", attachment["id"])
    store.update_document("referral_attachment", attachment["id"], {**stored["data"], "image_filename": "../synthetic-outside-image-store.png"},
                          users["refowner"]["id"], expected_revision=stored["revision"])
    assert client.get(attachment["image_url"]).status_code == 410


def test_attachment_ids_are_bound_to_their_referral_and_deletion_removes_all_private_image_bytes(platform):
    client, store, users = platform
    original, referral = prepare_requested_attachment(client, store, users)
    login(client, "refowner")
    uploaded = upload_attachment(client, referral).json()
    attachment = uploaded["attachment"]
    other_analysis = record(store, users["refowner"])
    other = submit(client, other_analysis).json()
    assert client.get(f"/api/platform/referrals/{other['id']}/attachments/{attachment['id']}/image").status_code == 404
    assert client.get(f"/api/platform/referrals/{referral['id']}/attachments/not-a-uuid/image").status_code == 404
    deleted = client.delete(f"/api/platform/analyses/{original['id']}", params={"expected_revision": uploaded["referral"]["analysis"]["revision"]})
    assert deleted.status_code == 200, deleted.text
    assert not (store.image_dir / f"{attachment['id']}.png").exists()
    assert not (store.image_dir / f"{original['id']}.png").exists()
    assert client.get(attachment["image_url"]).status_code == 404
    assert store.get_document("referral_attachment", attachment["id"]) is None
    assert store.get_document("referral_attachment", attachment["id"], include_deleted=True)["deleted_at"]
    assert store.list_audit("referral_attachment", attachment["id"])[0]["action"] == "deleted"
    assert store.count_documents("referral_message") == 4, "Conversation audit remains after the image is removed"
