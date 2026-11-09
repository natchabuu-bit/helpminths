"""Expert replies create private, durable notifications for the submitting account."""
from __future__ import annotations

import uuid

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.platform import analyses, auth, notifications, reviews
from backend.platform.store import PlatformStore
from backend.tests.test_referrals import PASSWORD, login, record, review_body, submit


@pytest.fixture
def inbox(tmp_path, monkeypatch):
    monkeypatch.setenv("HELPMINTHS_COOKIE_SECURE", "0")
    store = PlatformStore(tmp_path / "private-notifications")
    prefix = uuid.uuid4().hex[:8]
    users = {name: store.create_user(f"{prefix}_{name}", PASSWORD, role) for name, role in (
        ("owner", "lab"), ("other", "lab"), ("expert", "reviewer"), ("admin", "admin"))}
    app = FastAPI()
    app.state.platform_store = store
    for module in (auth, analyses, reviews, notifications):
        app.include_router(module.router)
    with TestClient(app) as client:
        yield client, store, users, app


def referral(inbox, *, owner="owner", code="SYNTHETIC_INBOX"):
    client, store, users, _app = inbox
    analysis = record(store, users[owner], code=code)
    login(client, users[owner]["username"])
    sent = submit(client, analysis)
    assert sent.status_code == 201, sent.text
    return analysis, sent.json()


def respond(inbox, sent, *, action="reply", comment="SYNTHETIC expert answer"):
    client, _store, users, _app = inbox
    login(client, users["expert"]["username"], expert=True)
    result = client.post(f"/api/platform/referrals/{sent['id']}/response", json={
        "expected_revision": sent["revision"], "action": action, "comment": comment})
    assert result.status_code == 200, result.text
    return result.json()


def test_reply_notification_is_private_persistent_and_points_to_exact_message(inbox):
    client, store, users, app = inbox
    analysis, sent = referral(inbox)
    assert client.get("/api/platform/notifications").json()["total"] == 0
    respond(inbox, sent)
    # Experts do not see notifications addressed to a clinical owner.
    assert client.get("/api/platform/notifications").json()["total"] == 0
    login(client, users["owner"]["username"])
    response = client.get("/api/platform/notifications")
    assert response.headers["cache-control"] == "private, no-store"
    data = response.json()
    assert data["total"] == data["unread_count"] == 1
    item = data["items"][0]
    assert item["analysis_id"] == analysis["id"] and item["referral_id"] == sent["id"]
    assert item["sample_code"] == "SYNTHETIC_INBOX"
    assert item["kind"] == "reply" and item["comment"] == "SYNTHETIC expert answer"
    assert item["expert_name"] == users["expert"]["username"]
    assert item["read_at"] is None
    message = client.get(f"/api/platform/referrals/{sent['id']}/messages/{item['message_id']}")
    assert message.status_code == 200
    assert message.json()["comment"] == item["comment"]
    assert message.json()["author_name"] == item["expert_name"]
    # New store/application instance uses the same database rather than memory.
    replacement = PlatformStore(store.config.data_dir)
    app.state.platform_store = replacement
    assert client.get("/api/platform/notifications").json() == data


def test_accounts_cannot_read_another_inbox_even_when_expert_verified(inbox):
    client, _store, users, _app = inbox
    _analysis, sent = referral(inbox)
    respond(inbox, sent)
    login(client, users["owner"]["username"])
    item = client.get("/api/platform/notifications").json()["items"][0]
    for account in ("other", "expert", "admin"):
        login(client, users[account]["username"], expert=account != "other")
        assert client.get("/api/platform/notifications").json()["items"] == []
        assert client.post(f"/api/platform/notifications/{item['id']}/read").status_code == 404
        assert client.get(f"/api/platform/audit/notification/{item['id']}").status_code in (403, 404)
    client.cookies.clear()
    assert client.get("/api/platform/notifications").status_code == 401


def test_mark_read_is_csrf_guarded_idempotent_and_does_not_modify_conversation(inbox):
    client, store, users, _app = inbox
    _analysis, sent = referral(inbox)
    respond(inbox, sent)
    login(client, users["owner"]["username"])
    item = client.get("/api/platform/notifications").json()["items"][0]
    message = store.get_document("referral_message", item["message_id"])
    token = client.headers.pop("X-CSRF-Token")
    endpoint = f"/api/platform/notifications/{item['id']}/read"
    assert client.post(endpoint).status_code == 403
    client.headers["X-CSRF-Token"] = token
    first = client.post(endpoint)
    assert first.status_code == 200 and first.json()["read_at"]
    assert first.headers["cache-control"] == "private, no-store"
    revision = store.get_document("notification", item["id"])["revision"]
    assert client.post(endpoint).json() == first.json()
    assert store.get_document("notification", item["id"])["revision"] == revision
    assert client.get("/api/platform/notifications").json()["unread_count"] == 0
    assert store.get_document("referral_message", item["message_id"]) == message


def test_each_response_is_separate_and_stale_retry_creates_no_notification(inbox):
    client, store, users, _app = inbox
    _analysis, sent = referral(inbox)
    first = respond(inbox, sent)
    repeated = client.post(f"/api/platform/referrals/{sent['id']}/response", json={
        "expected_revision": sent["revision"], "action": "reply", "comment": "must not be sent twice"})
    assert repeated.status_code == 409
    assert store.count_documents("notification") == 1
    more = respond(inbox, first, action="request_more", comment="SYNTHETIC another focal plane please")
    assert more["status"] == "needs_more"
    login(client, users["owner"]["username"])
    result = client.get("/api/platform/notifications?limit=1").json()
    assert result["total"] == result["unread_count"] == 2
    assert result["items"][0]["kind"] == "request_more"
    earlier = client.get("/api/platform/notifications?limit=1&offset=1").json()["items"][0]
    assert earlier["kind"] == "reply" and earlier["message_id"] != result["items"][0]["message_id"]


def test_final_confirmation_notifies_and_keeps_old_referral_when_resubmitted(inbox):
    client, store, users, _app = inbox
    analysis, sent = referral(inbox)
    login(client, users["expert"]["username"], expert=True)
    confirmed = client.post(f"/api/platform/analyses/{analysis['id']}/reviews", json=review_body(2))
    assert confirmed.status_code == 201, confirmed.text
    assert confirmed.json()["detections"] == analysis["data"]["detections"]
    login(client, users["owner"]["username"])
    item = client.get("/api/platform/notifications").json()["items"][0]
    assert item["kind"] == "confirmed" and item["referral_id"] == sent["id"]
    next_referral = submit(client, confirmed.json(), "SYNTHETIC different follow-up question")
    assert next_referral.status_code == 201
    assert next_referral.json()["id"] != sent["id"]
    old_message = client.get(f"/api/platform/referrals/{item['referral_id']}/messages/{item['message_id']}")
    assert old_message.status_code == 200 and old_message.json()["action"] == "confirmed"
    wrong = client.get(f"/api/platform/referrals/{next_referral.json()['id']}/messages/{item['message_id']}")
    assert wrong.status_code == 404
    assert store.count_documents("notification") == 1


@pytest.mark.parametrize("deleted_kind", ["analysis", "referral"])
def test_deleted_cases_do_not_leave_readable_notification_comments(inbox, deleted_kind):
    client, store, users, _app = inbox
    analysis, sent = referral(inbox)
    respond(inbox, sent)
    login(client, users["owner"]["username"])
    item = client.get("/api/platform/notifications").json()["items"][0]
    identifier = analysis["id"] if deleted_kind == "analysis" else sent["id"]
    latest = store.get_document(deleted_kind, identifier)
    store.soft_delete_document(deleted_kind, identifier, users["owner"]["id"], latest["revision"])
    assert client.get("/api/platform/notifications").json()["total"] == 0
    assert client.post(f"/api/platform/notifications/{item['id']}/read").status_code == 404


def test_user_own_expert_action_does_not_notify_themselves(inbox):
    client, _store, users, _app = inbox
    analysis, sent = referral(inbox, owner="expert")
    respond(inbox, sent)
    assert client.get("/api/platform/notifications").json()["total"] == 0
    confirmed = client.post(f"/api/platform/analyses/{analysis['id']}/reviews", json=review_body(3))
    assert confirmed.status_code == 201
    assert client.get("/api/platform/notifications").json()["total"] == 0


def test_invalid_review_rolls_back_before_any_message_or_notification(inbox):
    client, store, users, _app = inbox
    analysis, _sent = referral(inbox)
    login(client, users["expert"]["username"], expert=True)
    invalid = review_body(2)
    invalid["annotations"] = invalid["annotations"][:1]
    assert client.post(f"/api/platform/analyses/{analysis['id']}/reviews", json=invalid).status_code == 422
    assert store.count_documents("notification") == store.count_documents("review") == 0
    assert store.count_documents("referral_message") == 1


def test_single_message_endpoint_preserves_owner_and_expert_stepup_boundaries(inbox):
    client, _store, users, _app = inbox
    _analysis, sent = referral(inbox)
    respond(inbox, sent)
    login(client, users["owner"]["username"])
    item = client.get("/api/platform/notifications").json()["items"][0]
    endpoint = f"/api/platform/referrals/{sent['id']}/messages/{item['message_id']}"
    login(client, users["other"]["username"])
    assert client.get(endpoint).status_code == 403
    login(client, users["expert"]["username"])
    assert client.get(endpoint).status_code == 403
    assert client.post("/api/platform/expert-login", json={"password": PASSWORD}).status_code == 200
    assert client.get(endpoint).status_code == 200


def test_multiple_images_have_independent_notification_links_and_read_state(inbox):
    client, _store, users, _app = inbox
    first_analysis, first = referral(inbox, code="SYNTHETIC_FIRST_CASE")
    second_analysis, second = referral(inbox, code="SYNTHETIC_SECOND_CASE")
    respond(inbox, first, comment="SYNTHETIC answer for first image")
    respond(inbox, second, comment="SYNTHETIC answer for second image")
    login(client, users["owner"]["username"])
    items = client.get("/api/platform/notifications").json()["items"]
    by_code = {item["sample_code"]: item for item in items}
    assert len(by_code) == 2
    for code, analysis, sent in (("SYNTHETIC_FIRST_CASE", first_analysis, first),
                                 ("SYNTHETIC_SECOND_CASE", second_analysis, second)):
        assert by_code[code]["analysis_id"] == analysis["id"]
        assert by_code[code]["referral_id"] == sent["id"]
    assert client.post(f"/api/platform/notifications/{by_code['SYNTHETIC_FIRST_CASE']['id']}/read").status_code == 200
    assert client.get("/api/platform/notifications").json()["unread_count"] == 1


def test_notification_failure_rolls_back_the_response_and_message_together(inbox, monkeypatch):
    client, store, users, _app = inbox
    analysis, sent = referral(inbox)
    before_analysis = store.get_document("analysis", analysis["id"])
    before_referral = store.get_document("referral", sent["id"])
    original_create = store.create_document

    def fail_notification(kind, *args, **kwargs):
        if kind == "notification":
            raise HTTPException(409, "Synthetic notification conflict")
        return original_create(kind, *args, **kwargs)

    monkeypatch.setattr(store, "create_document", fail_notification)
    login(client, users["expert"]["username"], expert=True)
    result = client.post(f"/api/platform/referrals/{sent['id']}/response", json={
        "expected_revision": sent["revision"], "action": "reply", "comment": "SYNTHETIC must roll back"})
    assert result.status_code == 409
    assert store.get_document("analysis", analysis["id"]) == before_analysis
    assert store.get_document("referral", sent["id"]) == before_referral
    assert store.count_documents("referral_message") == 1
    assert store.count_documents("notification") == 0
