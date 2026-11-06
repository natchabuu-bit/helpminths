"""Synthetic owner/referral history fixtures, not patient or diagnostic evidence."""
from __future__ import annotations

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.platform import analyses, auth
from backend.platform.store import PlatformStore

PASSWORD = "Synthetic-history-test-2026!"


@pytest.fixture
def history(tmp_path, monkeypatch):
    monkeypatch.setenv("HELPMINTHS_COOKIE_SECURE", "0")
    store = PlatformStore(tmp_path / "private-history-fixture")
    users = {name: store.create_user(name, PASSWORD, role) for name, role in
             (("ownerone", "lab"), ("ownertwo", "lab"), ("expertone", "reviewer"), ("adminone", "admin"))}
    app = FastAPI()
    app.state.platform_store = store
    app.include_router(auth.router)
    app.include_router(analyses.router)
    with TestClient(app) as client:
        yield client, store, users


def login(client, name, *, expert=False):
    response = client.post("/api/platform/login", json={"username": name, "password": PASSWORD})
    assert response.status_code == 200, response.text
    client.headers["X-CSRF-Token"] = response.json()["csrf_token"]
    if expert:
        response = client.post("/api/platform/expert-login", json={"password": PASSWORD})
        assert response.status_code == 200, response.text


def record(store, owner, created, *, status="completed", referral_status=None, deleted=False):
    data = {"sample_code": "SYNTHETIC_HISTORY_ONLY", "status": status, "review_status": "pending",
            "model": "SYNTHETIC-NOT-A-CLINICAL-MODEL", "model_version": "test-only", "detections": []}
    if referral_status is not None:
        data["referral_status"] = referral_status
    document = store.create_document("analysis", data, owner["id"], owner["id"])
    # Only the isolated test database is given fixed times to exercise Thai dates.
    with store.transaction() as conn:
        conn.execute("UPDATE documents SET created_at=?,updated_at=? WHERE id=?", (created, created, document["id"]))
    if deleted:
        store.soft_delete_document("analysis", document["id"], owner["id"], document["revision"])
    return document


def test_daily_history_groups_at_thai_midnight_and_preserves_actual_status_counts(history):
    client, store, users = history
    owner = users["ownerone"]
    record(store, owner, "2026-11-01T16:59:59.000Z")
    record(store, owner, "2026-11-01T17:00:00.000Z")
    record(store, owner, "2026-11-02T16:59:59.000Z", status="failed")
    record(store, owner, "2026-11-02T17:00:00.000Z")
    record(store, owner, "2026-11-04T04:00:00.000Z", status="cancelled")
    record(store, users["ownertwo"], "2026-11-02T09:00:00.000Z")
    login(client, "ownerone")
    result = client.get("/api/platform/history/days").json()
    assert result == {"items": [
        {"date": "2026-11-04", "total": 1, "completed": 0, "failed": 0},
        {"date": "2026-11-03", "total": 1, "completed": 1, "failed": 0},
        {"date": "2026-11-02", "total": 2, "completed": 1, "failed": 1},
        {"date": "2026-11-01", "total": 1, "completed": 1, "failed": 0},
    ], "total_days": 4, "total_analyses": 5, "limit": 31, "offset": 0, "timezone": "Asia/Bangkok"}
    filtered = client.get("/api/platform/history/days", params={"date_from": "2026-11-02", "date_to": "2026-11-02"}).json()
    assert filtered["items"] == [{"date": "2026-11-02", "total": 2, "completed": 1, "failed": 1}]
    same_day = client.get("/api/platform/analyses", params={"scope": "mine", "referral_state": "not_pending", "date_from": "2026-11-02", "date_to": "2026-11-02"}).json()
    assert same_day["total"] == filtered["total_analyses"] == 2


def test_pending_referrals_are_separate_until_confirmed_without_duplicating_analysis(history):
    client, store, users = history
    owner = users["ownerone"]
    ordinary = record(store, owner, "2026-11-01T09:00:00.000Z")
    pending = [record(store, owner, "2026-11-02T09:00:00.000Z", referral_status=status)
               for status in ("pending", "in_review", "needs_more")]
    confirmed = record(store, owner, "2026-11-03T09:00:00.000Z", referral_status="confirmed")
    record(store, owner, "2026-11-04T09:00:00.000Z", deleted=True)
    login(client, "ownerone")
    daily = client.get("/api/platform/history/days").json()
    assert daily["total_analyses"] == 2
    assert {item["date"] for item in daily["items"]} == {"2026-11-01", "2026-11-03"}
    normal = client.get("/api/platform/analyses", params={"scope": "mine", "referral_state": "not_pending"}).json()
    assert {item["id"] for item in normal["items"]} == {ordinary["id"], confirmed["id"]}
    waiting = client.get("/api/platform/analyses", params={"scope": "mine", "referral_state": "pending"}).json()
    assert {item["id"] for item in waiting["items"]} == {item["id"] for item in pending}
    assert client.get("/api/platform/analyses").json()["total"] == 5, "The old unfiltered list remains all non-deleted records"
    original = pending[0]
    store.update_document("analysis", original["id"], {**original["data"], "referral_status": "confirmed"}, owner["id"], expected_revision=original["revision"])
    assert client.get("/api/platform/history/days").json()["total_analyses"] == 3
    assert client.get("/api/platform/analyses").json()["total"] == 5, "Referral transitions must not create duplicate results"


@pytest.mark.parametrize("name", ["expertone", "adminone"])
def test_owner_history_never_becomes_a_cross_owner_expert_queue(history, name):
    client, store, users = history
    own = record(store, users[name], "2026-11-02T09:00:00.000Z")
    record(store, users["ownerone"], "2026-11-02T10:00:00.000Z")
    login(client, name)
    before = client.get("/api/platform/analyses").json()
    assert {item["id"] for item in before["items"]} == {own["id"]}, "Base login alone must not expose other owners' records"
    login(client, name, expert=True)
    assert client.get("/api/platform/analyses").json()["total"] == 2
    mine = client.get("/api/platform/analyses", params={"scope": "mine"}).json()
    assert {item["id"] for item in mine["items"]} == {own["id"]}
    assert client.get("/api/platform/history/days").json()["total_analyses"] == 1


def test_history_pagination_totals_and_empty_results_do_not_invent_calendar_days(history):
    client, store, users = history
    login(client, "ownerone")
    empty = client.get("/api/platform/history/days").json()
    assert empty["items"] == [] and empty["total_days"] == empty["total_analyses"] == 0
    for day in (1, 3, 9):
        record(store, users["ownerone"], f"2026-11-{day:02d}T01:00:00.000Z")
    page = client.get("/api/platform/history/days", params={"limit": 1, "offset": 1}).json()
    assert page["items"] == [{"date": "2026-11-03", "total": 1, "completed": 1, "failed": 0}]
    assert page["total_days"] == page["total_analyses"] == 3
    assert client.get("/api/platform/history/days", params={"offset": 99}).json()["items"] == []


@pytest.mark.parametrize("path,params", [
    ("history/days", {"date_from": "not-a-date"}),
    ("history/days", {"date_from": "2026-11-03", "date_to": "2026-11-02"}),
    ("history/days", {"limit": 101}),
    ("history/days", {"offset": -1}),
    ("analyses", {"scope": "everybody"}),
    ("analyses", {"referral_state": "made-up-status"}),
])
def test_history_and_list_filters_validate_bounds(history, path, params):
    client, *_ = history
    assert client.get(f"/api/platform/{path}", params=params).status_code == 401
    login(client, "ownerone")
    assert client.get(f"/api/platform/{path}", params=params).status_code == 422


def test_internal_filter_rejects_unknown_scope_without_interpolating_values():
    with pytest.raises(HTTPException) as failure:
        analyses.analysis_filter_sql({"id": "synthetic", "role": "lab"}, {"referral_state": "pending') OR 1=1 --"})
    assert failure.value.status_code == 422
