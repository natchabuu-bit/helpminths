"""Owner-only archival evidence uses synthetic images and disposable databases.

These cases exercise retention and authorization, never diagnostic accuracy.
"""
from __future__ import annotations

import io
import errno
import stat
import uuid
from copy import deepcopy

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from PIL import Image

from backend import images
from backend.platform import analyses, auth, reviews
from backend.platform.store import PlatformStore
from backend.tests.test_platform_analysis import FixtureModel, fixture_image
from backend.tests.test_referrals import record as legacy_record

PASSWORD = "Synthetic-archive-test-only-2026!"
BASE = "/api/platform/admin/image-archive"


@pytest.fixture
def archive(tmp_path, monkeypatch):
    from backend.platform import admin_archive

    monkeypatch.setenv("HELPMINTHS_COOKIE_SECURE", "0")
    store = PlatformStore(tmp_path / "private-archive")
    prefix = uuid.uuid4().hex[:8]
    users = {
        name: store.create_user(
            f"{prefix}_{name}", PASSWORD, role,
            is_super_admin=name == "owner",
            full_name=f"Synthetic archive {name}",
        )
        for name, role in (
            ("owner", "admin"), ("lab", "lab"), ("other", "lab"),
            ("expert", "reviewer"), ("admin", "admin"), ("student", "student"),
        )
    }
    app = FastAPI()
    app.state.platform_store = store
    app.state.model_service = FixtureModel()
    for module in (auth, analyses, reviews, admin_archive):
        app.include_router(module.router)
    with TestClient(app) as client:
        yield client, store, users, app.state.model_service, app


def sign_in(archive, name, *, stepup=False):
    client, _store, users, _model, _app = archive
    response = client.post("/api/platform/login", json={"username": users[name]["username"], "password": PASSWORD})
    assert response.status_code == 200, response.text
    client.headers["X-CSRF-Token"] = response.json()["csrf_token"]
    if stepup:
        response = client.post("/api/platform/expert-login", json={"password": PASSWORD})
        assert response.status_code == 200, response.text


def send_image(archive, *, account="lab", code="SYNTHETIC_ARCHIVE", flat=False, **fields):
    client, *_ = archive
    sign_in(archive, account)
    return client.post("/api/platform/analyses", data={"sample_code": code, **fields},
                       files={"image": ("PRIVATE-original-sensitive-name.png", fixture_image(metadata=True, flat=flat), "image/png")})


def owner_list(archive, **query):
    client, *_ = archive
    sign_in(archive, "owner")
    response = client.get(BASE, params=query)
    assert response.status_code == 200, response.text
    assert "no-store" in response.headers.get("cache-control", "")
    return response.json()


def item_for(items, analysis_id):
    return next(item for item in items if item.get("analysis_id") == analysis_id)


def assert_png(response, expected=None):
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].split(";")[0] == "image/png"
    assert "no-store" in response.headers.get("cache-control", "")
    with Image.open(io.BytesIO(response.content)) as image:
        image.load()
        assert image.mode == "RGB"
        assert not image.info and not image.getexif(), "Private source metadata must be stripped"
        if expected is not None:
            with Image.open(io.BytesIO(expected)) as original:
                assert image.size == original.size
                assert image.tobytes() == original.convert("RGB").tobytes()


def test_unreferred_analysis_is_archived_with_owner_pixels_and_original_predictions(archive):
    client, store, users, model, app = archive
    created = send_image(archive)
    assert created.status_code == 201, created.text
    analysis = created.json()
    assert model.calls == 1 and store.count_documents("referral") == 0
    listing = owner_list(archive)
    assert listing["total"] == len(listing["items"]) == 1
    item = item_for(listing["items"], analysis["id"])
    assert item["owner_id"] == users["lab"]["id"]
    assert item["sample_code"] == analysis["sample_code"]
    assert item["status"] == "completed"
    detail = client.get(f"{BASE}/{item['id']}")
    assert detail.status_code == 200, detail.text
    evidence = detail.json()
    assert evidence["analysis"]["detections"] == analysis["detections"]
    assert evidence["analysis"]["latest_review"] is None
    assert users["lab"]["username"] in detail.text
    assert "PRIVATE-original-sensitive-name" not in detail.text
    assert "password_hash" not in detail.text and PASSWORD not in detail.text
    assert_png(client.get(f"{BASE}/{item['id']}/image"), fixture_image(metadata=True))
    directory = store.data_dir / "archive-images"
    assert directory.is_dir() and stat.S_IMODE(directory.stat().st_mode) == 0o700
    files = list(directory.glob("*.png"))
    assert len(files) == 1 and stat.S_IMODE(files[0].stat().st_mode) == 0o600
    # Reopening the actual data directory proves this is durable database state.
    app.state.platform_store = PlatformStore(store.data_dir)
    assert client.get(BASE).json()["items"][0]["id"] == item["id"]


def test_archive_endpoints_and_audit_require_actual_owner_even_for_verified_experts(archive):
    client, _store, _users, _model, _app = archive
    original = send_image(archive).json()
    entry = item_for(owner_list(archive)["items"], original["id"])
    paths = [BASE, f"{BASE}/accounts", f"{BASE}/days", f"{BASE}/{entry['id']}",
             f"{BASE}/{entry['id']}/image", f"/api/platform/audit/admin_image/{entry['id']}"]
    assert client.get(f"/api/platform/expert-session").json()["verified"] is False
    for path in paths:
        assert client.get(path).status_code == 200, f"Owner should not need expert step-up for {path}"
    for name in ("lab", "other", "student", "expert", "admin"):
        sign_in(archive, name, stepup=name in {"expert", "admin"})
        for path in paths:
            response = client.get(path)
            assert response.status_code in {403, 404}, (name, path, response.text)
            assert original["sample_code"] not in response.text
    client.cookies.clear()
    for path in paths:
        assert client.get(path).status_code == 401


def test_owner_flag_is_checked_on_each_archive_request_not_only_at_login(archive):
    client, store, users, _model, _app = archive
    send_image(archive)
    entry = owner_list(archive)["items"][0]
    with store.connection() as conn:
        conn.execute("UPDATE users SET is_super_admin=0 WHERE id=?", (users["owner"]["id"],))
    assert client.get(BASE).status_code == 403
    assert client.get(f"{BASE}/{entry['id']}/image").status_code == 403


def test_expert_cannot_read_archival_audit_even_for_their_own_submission(archive):
    client, _store, _users, _model, _app = archive
    created = send_image(archive, account="expert").json()
    entry = item_for(owner_list(archive)["items"], created["id"])
    sign_in(archive, "expert", stepup=True)
    assert client.get(f"/api/platform/analyses/{created['id']}").status_code == 200
    assert client.get(f"/api/platform/audit/admin_image/{entry['id']}").status_code in {403, 404}
    assert client.get(f"{BASE}/{entry['id']}/image").status_code == 403


def test_quality_rejected_upload_is_retained_without_calling_model_or_creating_analysis(archive):
    client, store, users, model, _app = archive
    response = send_image(archive, flat=True, code="SYNTHETIC_REJECTED_QUALITY")
    assert response.status_code == 422, response.text
    assert model.calls == 0 and store.count_documents("analysis") == 0
    listing = owner_list(archive)
    assert listing["total"] == 1
    item = listing["items"][0]
    assert item["status"] == "quality_rejected" and item.get("analysis_id") is None
    assert item["owner_id"] == users["lab"]["id"]
    assert_png(client.get(f"{BASE}/{item['id']}/image"), fixture_image(flat=True))
    detail = client.get(f"{BASE}/{item['id']}").json()
    assert detail["analysis"] is None
    assert "warning" in str(detail)


@pytest.mark.parametrize("failure", ["not_ready", "prediction_error"])
def test_model_failures_keep_original_uploaded_image_and_failure_status(archive, monkeypatch, failure):
    client, store, _users, model, _app = archive
    if failure == "not_ready":
        model.ready = False
    else:
        def broken(*_args):
            raise RuntimeError("SYNTHETIC model failure")
        monkeypatch.setattr(model, "predict", broken)
    response = send_image(archive, code=f"SYNTHETIC_FAILURE_{failure}")
    assert response.status_code == (503 if failure == "not_ready" else 500), response.text
    assert store.count_documents("analysis") == 1
    entry = owner_list(archive)["items"][0]
    assert entry["status"] == "failed"
    assert_png(client.get(f"{BASE}/{entry['id']}/image"), fixture_image())
    detail = client.get(f"{BASE}/{entry['id']}").json()
    assert detail["analysis"]["status"] == "failed"
    assert detail["analysis"]["detections"] == []


def test_invalid_and_oversized_files_do_not_create_archival_image_records(archive, monkeypatch):
    client, store, _users, model, _app = archive
    sign_in(archive, "lab")
    broken = client.post("/api/platform/analyses", files={"image": ("bad.png", b"not an image", "image/png")})
    assert broken.status_code == 400
    monkeypatch.setattr(images, "MAX_UPLOAD_BYTES", 64)
    oversized = client.post("/api/platform/analyses", files={"image": ("too-large.png", fixture_image(), "image/png")})
    assert oversized.status_code == 413
    assert model.calls == 0 and store.count_documents("analysis") == 0
    assert owner_list(archive)["total"] == 0


def test_owner_archive_preserves_ai_expert_messages_and_final_structured_review(archive):
    client, store, _users, _model, _app = archive
    created = send_image(archive).json()
    raw_detections = deepcopy(created["detections"])
    referral = client.post(f"/api/platform/analyses/{created['id']}/referrals", json={
        "expected_revision": created["revision"], "reason": "Synthetic classification question"}).json()
    sign_in(archive, "expert", stepup=True)
    reply = client.post(f"/api/platform/referrals/{referral['id']}/response", json={
        "expected_revision": referral["revision"], "action": "reply", "comment": "SYNTHETIC intermediate expert comment"})
    assert reply.status_code == 200, reply.text
    current = client.get(f"/api/platform/analyses/{created['id']}").json()
    confirmed = client.post(f"/api/platform/analyses/{created['id']}/reviews", json={
        "expected_revision": current["revision"], "full_image_reviewed": True,
        "status": "verified", "comment": "SYNTHETIC final corrected diagnosis",
        "annotations": [
            {"detection_id": "det-1", "action": "correct", "label": "Taenia spp. egg"},
            {"detection_id": "det-2", "action": "false_positive"},
            {"action": "missed", "label": "Hookworm", "bbox": [300, 300, 350, 350]},
        ],
    })
    assert confirmed.status_code == 201, confirmed.text
    entry = item_for(owner_list(archive)["items"], created["id"])
    response = client.get(f"{BASE}/{entry['id']}")
    assert response.status_code == 200, response.text
    detail = response.json()
    assert detail["analysis"]["detections"] == raw_detections
    assert detail["analysis"]["latest_review"]["status"] == "verified"
    assert detail["analysis"]["latest_review"]["annotations"] == confirmed.json()["latest_review"]["annotations"]
    assert "SYNTHETIC intermediate expert comment" in response.text
    assert "SYNTHETIC final corrected diagnosis" in response.text
    assert "Taenia spp. egg" in response.text
    assert store.get_document("analysis", created["id"])["data"]["detections"] == raw_detections


def test_removing_user_history_keeps_owner_archive_image_and_both_result_versions(archive):
    client, store, _users, _model, _app = archive
    created = send_image(archive).json()
    entry = item_for(owner_list(archive)["items"], created["id"])
    archived_bytes = client.get(f"{BASE}/{entry['id']}/image").content
    sign_in(archive, "lab")
    removed = client.delete(f"/api/platform/analyses/{created['id']}", params={"expected_revision": created["revision"]})
    assert removed.status_code == 200, removed.text
    assert removed.json()["admin_archive_retained"] is True
    assert client.get(f"/api/platform/analyses/{created['id']}").status_code == 404
    assert client.get(f"/api/platform/analyses/{created['id']}/image").status_code == 404
    assert not (store.image_dir / f"{created['id']}.png").exists()
    assert owner_list(archive)["total"] == 1
    assert client.get(f"{BASE}/{entry['id']}/image").content == archived_bytes
    detail = client.get(f"{BASE}/{entry['id']}").json()
    assert detail["analysis"]["detections"] == created["detections"]


def test_supplemental_image_is_archived_and_survives_analysis_history_removal(archive):
    client, store, users, _model, _app = archive
    created = send_image(archive).json()
    referral = client.post(f"/api/platform/analyses/{created['id']}/referrals", json={
        "expected_revision": created["revision"], "reason": "Synthetic extra image question"}).json()
    sign_in(archive, "expert", stepup=True)
    requested = client.post(f"/api/platform/referrals/{referral['id']}/response", json={
        "expected_revision": referral["revision"], "action": "request_more", "comment": "SYNTHETIC request for a wider view"}).json()
    sign_in(archive, "lab")
    uploaded = client.post(f"/api/platform/referrals/{referral['id']}/attachments", data={
        "expected_revision": requested["revision"], "comment": "SYNTHETIC supplied wider view"},
        files={"image": ("private-supplemental.png", fixture_image(metadata=True), "image/png")})
    assert uploaded.status_code == 201, uploaded.text
    attachment = uploaded.json()["attachment"]
    listing = owner_list(archive)
    assert listing["total"] == 2
    entry = next(item for item in listing["items"] if item.get("attachment_id") == attachment["id"])
    assert entry["source"] == "supplemental" and entry["owner_id"] == users["lab"]["id"]
    before = client.get(f"{BASE}/{entry['id']}/image")
    assert_png(before, fixture_image(metadata=True))
    detail = client.get(f"{BASE}/{entry['id']}")
    assert "SYNTHETIC supplied wider view" in detail.text
    sign_in(archive, "lab")
    revision = uploaded.json()["referral"]["analysis"]["revision"]
    removed = client.delete(f"/api/platform/analyses/{created['id']}", params={"expected_revision": revision})
    assert removed.status_code == 200, removed.text
    assert not (store.image_dir / f"{attachment['id']}.png").exists()
    assert owner_list(archive)["total"] == 2
    assert client.get(f"{BASE}/{entry['id']}/image").content == before.content


def test_existing_image_backfill_is_idempotent_and_preserves_existing_predictions(archive):
    client, store, users, _model, _app = archive
    legacy = legacy_record(store, users["lab"], code="SYNTHETIC_OLD_IMAGE")
    before = (store.image_dir / f"{legacy['id']}.png").read_bytes()
    original = deepcopy(legacy["data"])
    assert store.count_documents("admin_image") == 0
    listing = owner_list(archive)
    entry = item_for(listing["items"], legacy["id"])
    assert client.get(f"{BASE}/{entry['id']}/image").content == before
    assert client.get(BASE).json()["total"] == 1
    assert store.count_documents("admin_image") == 1
    assert store.get_document("analysis", legacy["id"])["data"] == original


def test_legacy_image_is_archived_before_user_deletion_even_without_prior_admin_visit(archive):
    client, store, users, _model, _app = archive
    legacy = legacy_record(store, users["lab"], code="SYNTHETIC_DELETE_BEFORE_OWNER_VISIT")
    before = (store.image_dir / f"{legacy['id']}.png").read_bytes()
    sign_in(archive, "lab")
    removed = client.delete(f"/api/platform/analyses/{legacy['id']}", params={"expected_revision": legacy["revision"]})
    assert removed.status_code == 200, removed.text
    assert not (store.image_dir / f"{legacy['id']}.png").exists()
    entry = item_for(owner_list(archive)["items"], legacy["id"])
    assert client.get(f"{BASE}/{entry['id']}/image").content == before


def test_date_and_account_filters_use_thai_days_and_paginate_without_mixing_owners(archive):
    client, store, users, _model, _app = archive
    first = send_image(archive, code="SYNTHETIC_DAY_ONE").json()
    second = send_image(archive, account="other", code="SYNTHETIC_DAY_TWO").json()
    entries = owner_list(archive)["items"]
    first_entry, second_entry = (item_for(entries, analysis["id"]) for analysis in (first, second))
    # 17:00 UTC is midnight in Thailand. Both UTC values are the same calendar day.
    for entry, analysis, timestamp in ((first_entry, first, "2026-11-08T16:59:59.000Z"),
                                       (second_entry, second, "2026-11-08T17:00:00.000Z")):
        with store.connection() as conn:
            conn.execute("UPDATE documents SET created_at=? WHERE id IN (?,?)", (timestamp, entry["id"], analysis["id"]))
            conn.execute("UPDATE documents SET data=json_set(data,'$.examined_at',?) WHERE id=? AND kind='admin_image'", (timestamp, entry["id"]))
    day = client.get(BASE, params={"date_from": "2026-11-09", "date_to": "2026-11-09"})
    assert day.status_code == 200, day.text
    assert [item["analysis_id"] for item in day.json()["items"]] == [second["id"]]
    mine = client.get(BASE, params={"owner_id": users["lab"]["id"]}).json()
    assert mine["total"] == 1 and mine["items"][0]["analysis_id"] == first["id"]
    page = client.get(BASE, params={"limit": 1, "offset": 1}).json()
    assert page["total"] == 2 and len(page["items"]) == 1
    assert client.get(BASE, params={"q": "SYNTHETIC_DAY_ONE"}).json()["total"] == 1
    accounts = client.get(f"{BASE}/accounts").json()
    assert {item["id"] for item in accounts["items"]} == {users["lab"]["id"], users["other"]["id"]}
    days = client.get(f"{BASE}/days").json()
    assert {item["date"] for item in days["items"]} == {"2026-11-08", "2026-11-09"}
    for query in ({"date_from": "not-a-date"}, {"date_from": "2026-11-10", "date_to": "2026-11-08"}):
        assert client.get(BASE, params=query).status_code == 422


def test_referral_specific_review_stays_bound_to_its_original_round(archive):
    client, _store, _users, model, _app = archive
    created = send_image(archive).json()
    first = client.post(f"/api/platform/analyses/{created['id']}/referrals", json={
        "expected_revision": created["revision"], "reason": "SYNTHETIC first round"}).json()

    def confirm(label, revision):
        result = client.post(f"/api/platform/analyses/{created['id']}/reviews", json={
            "expected_revision": revision, "full_image_reviewed": True, "status": "verified",
            "comment": f"SYNTHETIC final {label}", "annotations": [
                {"detection_id": "det-1", "action": "correct", "label": label},
                {"detection_id": "det-2", "action": "confirm"},
            ]})
        assert result.status_code == 201, result.text
        return result.json()

    sign_in(archive, "expert", stepup=True)
    final_first = confirm("Taenia spp. egg", first["analysis"]["revision"])
    sign_in(archive, "lab")
    second_response = client.post(f"/api/platform/analyses/{created['id']}/referrals", json={
        "expected_revision": final_first["revision"], "reason": "SYNTHETIC second round"})
    assert second_response.status_code == 201, second_response.text
    second = second_response.json()
    sign_in(archive, "expert", stepup=True)
    final_second = confirm("Ascaris lumbricoides", second["analysis"]["revision"])
    earlier = client.get(f"/api/platform/referrals/{first['id']}").json()
    later = client.get(f"/api/platform/referrals/{second['id']}").json()
    assert earlier["latest_review"]["id"] == final_first["latest_review"]["id"]
    assert later["latest_review"]["id"] == final_second["latest_review"]["id"]
    assert earlier["latest_review"]["annotations"][0]["label"] == "Taenia spp. egg"
    assert later["latest_review"]["annotations"][0]["label"] == "Ascaris lumbricoides"
    entry = owner_list(archive)["items"][0]
    detail = client.get(f"{BASE}/{entry['id']}").json()
    assert len(detail["reviews"]) == len(detail["referrals"]) == 2
    assert model.calls == 1, "Expert responses cannot rerun or overwrite the AI prediction"


def test_archive_image_rejects_traversal_record_and_never_returns_external_file(archive, tmp_path):
    client, store, users, _model, _app = archive
    send_image(archive)
    entry = owner_list(archive)["items"][0]
    external = tmp_path / "SYNTHETIC-outside-archive.png"
    external.write_bytes(b"SYNTHETIC PRIVATE OUTSIDE SENTINEL")
    document = store.get_document("admin_image", entry["id"])
    store.update_document("admin_image", entry["id"], {
        **document["data"], "image_filename": str(external),
    }, users["owner"]["id"], document["revision"])
    response = client.get(f"{BASE}/{entry['id']}/image")
    assert response.status_code in {404, 410, 503}
    assert external.read_bytes() not in response.content
    assert str(external) not in response.text


def test_archive_image_rejects_symlink_without_leaking_target(archive, tmp_path):
    client, store, _users, _model, _app = archive
    send_image(archive)
    entry = owner_list(archive)["items"][0]
    document = store.get_document("admin_image", entry["id"])
    target = tmp_path / "SYNTHETIC-external-image.png"
    target.write_bytes(b"SYNTHETIC PRIVATE EXTERNAL IMAGE")
    archived_path = store.data_dir / "archive-images" / document["data"]["image_filename"]
    archived_path.unlink()
    archived_path.symlink_to(target)
    response = client.get(f"{BASE}/{entry['id']}/image")
    assert response.status_code in {404, 410, 503}
    assert target.read_bytes() not in response.content
    assert str(target) not in response.text


def test_cross_device_copy_collision_never_removes_an_existing_destination(tmp_path, monkeypatch):
    from backend.platform import admin_archive

    source, destination = tmp_path / "source.png", tmp_path / "existing.png"
    source.write_bytes(b"SYNTHETIC new immutable pixels")
    destination.write_bytes(b"SYNTHETIC pre-existing private pixels")
    before = destination.read_bytes()
    def cross_device(*_args):
        raise OSError(errno.EXDEV, "Synthetic cross-device link")
    monkeypatch.setattr(admin_archive.os, "link", cross_device)
    with pytest.raises((FileExistsError, HTTPException)) as collision:
        admin_archive._copy_private(source, destination)
    if isinstance(collision.value, HTTPException):
        assert collision.value.status_code == 409
    assert destination.read_bytes() == before


def test_failed_archive_write_does_not_run_model_or_claim_a_saved_analysis(archive, monkeypatch):
    client, store, _users, model, _app = archive
    def unavailable(*_args):
        raise OSError("SYNTHETIC private storage location must not leak")
    monkeypatch.setattr(analyses, "_save_image", unavailable)
    response = send_image(archive)
    assert response.status_code == 503, response.text
    assert "SYNTHETIC private storage location" not in response.text
    assert model.calls == store.count_documents("analysis") == store.count_documents("admin_image") == 0


def test_legacy_previously_deleted_bytes_are_reported_unavailable_without_inventing_image(archive):
    client, store, users, _model, _app = archive
    legacy = legacy_record(store, users["lab"], code="SYNTHETIC_ALREADY_DELETED")
    (store.image_dir / f"{legacy['id']}.png").unlink()
    store.soft_delete_document("analysis", legacy["id"], users["lab"]["id"], legacy["revision"])
    entry = item_for(owner_list(archive)["items"], legacy["id"])
    assert entry["image_available"] is False and entry["image_url"] is None
    assert entry["operational_deleted"] is True
    assert client.get(f"{BASE}/{entry['id']}/image").status_code == 410
    detail = client.get(f"{BASE}/{entry['id']}").json()
    assert detail["analysis"]["detections"] == legacy["data"]["detections"]


@pytest.mark.parametrize("outcome", ["accepted", "quality_rejected", "model_unavailable", "prediction_error"])
def test_actual_compatibility_route_keeps_authenticated_image_and_result_snapshot(tmp_path, monkeypatch, outcome):
    from backend.main import create_app

    monkeypatch.setenv("HELPMINTHS_COOKIE_SECURE", "0")
    monkeypatch.setenv("HELPMINTHS_SERVE_WEB", "0")
    monkeypatch.delenv("HELPMINTHS_SUPER_ADMIN_PASSWORD", raising=False)
    class CompatibilityModel(FixtureModel):
        def load(self):
            pass
    model = CompatibilityModel()
    if outcome == "model_unavailable":
        model.ready = False
    elif outcome == "prediction_error":
        def broken(*_args):
            model.calls += 1
            raise RuntimeError("SYNTHETIC compatibility inference failure")
        monkeypatch.setattr(model, "predict", broken)
    app = create_app(model, platform_dir=tmp_path / "private-compatibility")
    store = app.state.platform_store
    prefix = uuid.uuid4().hex[:8]
    users = {name: store.create_user(f"{prefix}_{name}", PASSWORD, role, is_super_admin=name == "owner")
             for name, role in (("owner", "admin"), ("lab", "lab"))}
    with TestClient(app) as client:
        context = client, store, users, model, app
        sign_in(context, "lab")
        original = fixture_image(metadata=True, flat=outcome == "quality_rejected")
        response = client.post("/api/analyze", files={"image": ("PRIVATE-sensitive-compatibility.png", original, "image/png")},
                               data={"confidence": ".15"})
        assert response.status_code == {"accepted": 200, "quality_rejected": 422,
                                        "model_unavailable": 503, "prediction_error": 500}[outcome], response.text
        assert store.count_documents("analysis") == 0, "The compatibility route must retain its existing clinical-history contract"
        listing = owner_list(context)
        assert listing["total"] == 1
        item = listing["items"][0]
        assert item["owner_id"] == users["lab"]["id"]
        assert item["status"] == ("completed" if outcome == "accepted" else "quality_rejected" if outcome == "quality_rejected" else "failed")
        detail = client.get(f"{BASE}/{item['id']}")
        assert detail.status_code == 200, detail.text
        evidence = detail.json()["analysis"]
        assert evidence["owner_id"] == users["lab"]["id"]
        assert evidence["model_version"] == model.version
        assert evidence["confidence_threshold"] == .15
        assert (evidence["width"], evidence["height"]) == (640, 480)
        assert_png(client.get(f"{BASE}/{item['id']}/image"), original)
        assert "PRIVATE-sensitive-compatibility" not in detail.text
        if outcome == "accepted":
            assert evidence["id"] == response.json()["id"]
            assert evidence["detections"] == response.json()["detections"]
            assert evidence["quality"] == response.json()["quality"]
            assert model.calls == 1
        else:
            assert evidence["detections"] == []
            assert model.calls == (1 if outcome == "prediction_error" else 0)
        if outcome == "quality_rejected":
            assert evidence["quality"] == response.json()["detail"]["quality"]


def test_actual_anonymous_unconfigured_compatibility_route_remains_nonpersistent(tmp_path, monkeypatch):
    from backend.main import create_app

    monkeypatch.setenv("HELPMINTHS_SERVE_WEB", "0")
    monkeypatch.setenv("HELPMINTHS_AUTO_STORAGE", "0")
    monkeypatch.delenv("HELPMINTHS_SUPER_ADMIN_PASSWORD", raising=False)
    class CompatibilityModel(FixtureModel):
        def load(self):
            pass
    model = CompatibilityModel()
    app = create_app(model, platform_dir="")
    store = app.state.platform_store
    with TestClient(app) as client:
        result = client.post("/api/analyze", files={"image": ("SYNTHETIC-anonymous.png", fixture_image(), "image/png")})
        assert result.status_code == 200, result.text
        assert result.json()["storage"] == "session_only"
        assert model.calls == 1 and store.configured is False and store.data_dir is None
        assert client.get(BASE).status_code == 503, "Unconfigured private storage must remain unavailable"
        assert not list(tmp_path.rglob("*.png")) and not list(tmp_path.rglob("*.sqlite3"))


def test_partial_legacy_backfill_rollback_can_retry_without_losing_retained_bytes(archive, monkeypatch):
    from backend.platform import admin_archive

    _client, store, users, _model, _app = archive
    originals = [legacy_record(store, users["lab"], code=f"SYNTHETIC_BACKFILL_{index}") for index in range(2)]
    before = {item["id"]: (store.image_dir / f"{item['id']}.png").read_bytes() for item in originals}
    original_create = store.create_document
    attempted = []
    def fail_second(kind, *args, **kwargs):
        if kind == "admin_image":
            attempted.append(kwargs.get("document_id"))
            if len(attempted) == 2:
                raise RuntimeError("SYNTHETIC backfill transaction rollback")
        return original_create(kind, *args, **kwargs)
    monkeypatch.setattr(store, "create_document", fail_second)
    with pytest.raises(RuntimeError, match="SYNTHETIC backfill transaction rollback"):
        admin_archive.ensure_legacy_archive(store, users["owner"]["id"])
    assert store.count_documents("admin_image") == 0, "The whole failed batch must roll back"
    assert list((store.data_dir / "archive-images").glob("*.png")), "This regression needs a retained orphan from the earlier batch item"
    monkeypatch.setattr(store, "create_document", original_create)
    listing = owner_list(archive)
    assert listing["total"] == 2
    client = archive[0]
    for item in listing["items"]:
        assert client.get(f"{BASE}/{item['id']}/image").content == before[item["analysis_id"]]
    assert client.get(BASE).json()["total"] == 2, "Backfill retry must remain idempotent"


def test_configured_compatibility_route_shares_analysis_quota_before_archival_work(tmp_path, monkeypatch):
    from backend.main import create_app

    monkeypatch.setenv("HELPMINTHS_COOKIE_SECURE", "0")
    monkeypatch.setenv("HELPMINTHS_SERVE_WEB", "0")
    monkeypatch.delenv("HELPMINTHS_SUPER_ADMIN_PASSWORD", raising=False)
    class CompatibilityModel(FixtureModel):
        def load(self):
            pass
    model = CompatibilityModel()
    app = create_app(model, platform_dir=tmp_path / "private-quota")
    store = app.state.platform_store
    user = store.create_user(f"quota_{uuid.uuid4().hex[:8]}", PASSWORD, "lab")
    quota_actors = []
    def quota_exhausted(actor_id):
        quota_actors.append(actor_id)
        raise HTTPException(429, "Synthetic shared quota exhausted", headers={"Retry-After": "60"})
    monkeypatch.setattr(analyses._limiter, "check", quota_exhausted)
    with TestClient(app) as client:
        sign_in((client, store, {"lab": user}, model, app), "lab")
        for endpoint in ("/api/analyze", "/api/platform/analyses"):
            response = client.post(endpoint, files={"image": ("SYNTHETIC-quota.png", fixture_image(), "image/png")})
            assert response.status_code == 429, response.text
            assert response.headers["retry-after"] == "60"
        assert quota_actors == [user["id"], user["id"]], "Both routes must use the same account-scoped limiter"
        assert model.calls == 0
        assert store.count_documents("admin_image") == store.count_documents("analysis") == 0
        assert not list(store.data_dir.rglob("*.png")), "Quota rejection must happen before image archival"

