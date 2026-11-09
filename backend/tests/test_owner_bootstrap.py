"""Synthetic host credentials exercise real startup and the owner-only sign-in."""
from __future__ import annotations

import hashlib
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.platform.auth import COOKIE_NAME
from backend.platform.owner_bootstrap import BOOTSTRAP_DOCUMENT_ID
from backend.platform.store import PlatformStore, hash_password, verify_password


# These recognizable fixtures are never configured production credentials.
HOST_PASSWORD = "SYNTHETIC-host-owner-password-2026!"
RECOVERY_PASSWORD = "SYNTHETIC-host-owner-recovery-2026!"
WEB_PASSWORD = "SYNTHETIC-web-owner-password-2026!"
ORIGIN = {"Origin": "https://testserver"}


class SyntheticModel:
    ready = False
    name = "SYNTHETIC-owner-bootstrap-test"
    message = "SYNTHETIC TEST ONLY"
    version = "synthetic-owner-bootstrap"
    metadata = None

    def load(self):
        self.ready = True


@pytest.fixture(autouse=True)
def isolated_host(monkeypatch):
    for name in ("HELPMINTHS_SUPER_ADMIN_PASSWORD", "HELPMINTHS_OWNER_USERNAME",
                 "HELPMINTHS_ADMIN_SETUP_TOKEN", "HELPMINTHS_SERVE_WEB"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("HELPMINTHS_DASHBOARD_RESTORE_SNAPSHOT", "1")


def app_at(directory):
    return create_app(SyntheticModel(), platform_dir=directory)


def client_for(app):
    return TestClient(app, base_url="https://testserver")


def owner_signin(client, username="Super Admin", password=HOST_PASSWORD):
    return client.post("/api/platform/owner-signin", json={"username": username, "password": password}, headers=ORIGIN)


def rows(store, table):
    with store.connection() as conn:
        return [dict(row) for row in conn.execute(f"SELECT * FROM {table} ORDER BY rowid")]


def metadata(client):
    session = client.get("/api/platform/session")
    status = client.get("/api/platform/status")
    assert session.status_code == status.status_code == 200
    for response in (session, status):
        assert response.headers["cache-control"] == "no-store"
        assert set(response.json()["owner_bootstrap"]) == {"configured", "ready", "message"}
        assert isinstance(response.json()["owner_bootstrap"]["message"], str)
    return session.json(), status.json()


def test_absent_or_empty_host_password_never_creates_an_owner(tmp_path, monkeypatch):
    for value, name in ((None, "absent"), ("", "empty")):
        if value is not None:
            monkeypatch.setenv("HELPMINTHS_SUPER_ADMIN_PASSWORD", value)
        app = app_at(tmp_path / name)
        store = app.state.platform_store
        with client_for(app) as client:
            session, status = metadata(client)
            assert session["owner_login_username"] == status["owner_login_username"] == "Super Admin"
            assert session["owner_bootstrap"]["configured"] is False
            assert session["bootstrap_required"] is True
            assert client.post("/api/platform/owner-bootstrap", json={"password": HOST_PASSWORD}).status_code == 404
            assert client.post("/api/platform/admin-setup", json={"setup_token": "not-configured", "username": "Super Admin", "password": HOST_PASSWORD}).status_code == 503
        assert rows(store, "users") == []
        assert rows(store, "documents") == []
        assert rows(store, "sessions") == []


@pytest.mark.parametrize("password", ["abcd", HOST_PASSWORD, "é" * 512])
def test_host_password_creates_a_real_approved_owner_once(tmp_path, monkeypatch, password):
    monkeypatch.setenv("HELPMINTHS_SUPER_ADMIN_PASSWORD", password)
    directory = tmp_path / "private"
    app = app_at(directory)
    store = app.state.platform_store
    # The host setup runs during app creation, including clients not using lifespan.
    account = store.authenticate("Super Admin", password)
    assert account is not None
    assert account["is_super_admin"] is True and account["role"] == "admin"
    assert account["approval_status"] == "approved" and account["active"] is True
    assert len(rows(store, "users")) == 1
    with client_for(app) as client:
        session, status = metadata(client)
        assert session["owner_bootstrap"]["configured"] is True
        assert session["owner_bootstrap"]["ready"] is True
        assert status["administrator_setup_pending"] is False
        assert session["owner_login_username"] == "Super Admin"
        signed = owner_signin(client, password=password)
        assert signed.status_code == 200, signed.text
        assert signed.json()["user"]["id"] == account["id"]
        assert signed.json()["expert_verified_until"] is None
        assert client.cookies.get(COOKIE_NAME)
        assert client.get("/api/platform/users").status_code == 200
    before = {table: rows(store, table) for table in ("users", "documents", "audit_logs", "sessions")}
    reopened = app_at(directory)
    assert {table: rows(reopened.state.platform_store, table) for table in before} == before


def test_custom_owner_name_is_the_real_signin_name(tmp_path, monkeypatch):
    monkeypatch.setenv("HELPMINTHS_OWNER_USERNAME", "Project Owner")
    monkeypatch.setenv("HELPMINTHS_SUPER_ADMIN_PASSWORD", HOST_PASSWORD)
    app = app_at(tmp_path / "private")
    with client_for(app) as client:
        session, status = metadata(client)
        assert session["owner_login_username"] == status["owner_login_username"] == "Project Owner"
        assert owner_signin(client, "Project Owner").status_code == 200
        assert owner_signin(client, "Super Admin").status_code == 401


def test_unchanged_host_password_preserves_web_username_and_password_changes(tmp_path, monkeypatch):
    monkeypatch.setenv("HELPMINTHS_SUPER_ADMIN_PASSWORD", HOST_PASSWORD)
    directory = tmp_path / "private"
    app = app_at(directory)
    with client_for(app) as client:
        signed = owner_signin(client)
        assert signed.status_code == 200
        identifier = signed.json()["user"]["id"]
        changed = client.patch("/api/platform/account", json={"current_password": HOST_PASSWORD,
                               "username": "Renamed Owner", "new_password": WEB_PASSWORD},
                               headers={**ORIGIN, "X-CSRF-Token": signed.json()["csrf_token"]})
        assert changed.status_code == 200, changed.text
        cookie = client.cookies.get(COOKIE_NAME)
    reopened = app_at(directory)
    store = reopened.state.platform_store
    assert store.authenticate("Renamed Owner", WEB_PASSWORD)["id"] == identifier
    assert store.authenticate("Super Admin", HOST_PASSWORD) is None
    with client_for(reopened) as client:
        session, status = metadata(client)
        assert session["owner_login_username"] == status["owner_login_username"] == "Renamed Owner"
        client.cookies.set(COOKIE_NAME, cookie)
        assert client.get("/api/platform/session").json()["user"]["id"] == identifier
        assert owner_signin(client, "Renamed Owner", WEB_PASSWORD).status_code == 200


def test_initial_host_configuration_recovers_same_owner_and_revokes_sessions(tmp_path, monkeypatch):
    directory = tmp_path / "private"
    app = app_at(directory)
    store = app.state.platform_store
    owner = store.create_user("Existing Operator", WEB_PASSWORD, "admin", is_super_admin=True)
    member = store.create_user("ordinary_member", WEB_PASSWORD)
    saved = store.create_document("analysis", {"note": "SYNTHETIC preserved owner record"}, owner["id"], owner["id"])
    prior_history = [row for row in rows(store, "audit_logs") if row["document_id"] == saved["id"]]
    with client_for(app) as first, client_for(app) as second, client_for(app) as member_client:
        first_login = owner_signin(first, owner["username"], WEB_PASSWORD)
        assert first_login.status_code == 200
        assert owner_signin(second, owner["username"], WEB_PASSWORD).status_code == 200
        member_login = member_client.post("/api/platform/login", json={"username": member["username"], "password": WEB_PASSWORD}, headers=ORIGIN)
        assert member_login.status_code == 200
        verified = first.post("/api/platform/expert-login", json={"password": WEB_PASSWORD},
                              headers={**ORIGIN, "X-CSRF-Token": first_login.json()["csrf_token"]})
        assert verified.status_code == 200
        old_owner_cookie = first.cookies.get(COOKIE_NAME)
        member_cookie = member_client.cookies.get(COOKIE_NAME)
    monkeypatch.setenv("HELPMINTHS_SUPER_ADMIN_PASSWORD", HOST_PASSWORD)
    recovered = app_at(directory)
    store = recovered.state.platform_store
    assert store.authenticate("Super Admin", HOST_PASSWORD)["id"] == owner["id"]
    assert store.authenticate("Existing Operator", WEB_PASSWORD) is None
    assert len(rows(store, "users")) == 2
    assert store.get_document("analysis", saved["id"]) == saved
    assert [row for row in rows(store, "audit_logs") if row["document_id"] == saved["id"]] == prior_history
    assert not any(row["owner_id"] == owner["id"] and row["deleted_at"] is None
                   for row in rows(store, "documents") if row["kind"] == "expert_session")
    with client_for(recovered) as client:
        client.cookies.set(COOKIE_NAME, old_owner_cookie)
        assert client.get("/api/platform/session").json()["user"] is None
        client.cookies.set(COOKIE_NAME, member_cookie)
        assert client.get("/api/platform/session").json()["user"]["id"] == member["id"]
        assert owner_signin(client).json()["user"]["id"] == owner["id"]


def test_changed_host_password_recovers_web_modified_owner_without_duplicate(tmp_path, monkeypatch):
    directory = tmp_path / "private"
    monkeypatch.setenv("HELPMINTHS_SUPER_ADMIN_PASSWORD", HOST_PASSWORD)
    app = app_at(directory)
    with client_for(app) as client:
        signed = owner_signin(client)
        identifier = signed.json()["user"]["id"]
        changed = client.patch("/api/platform/account", json={"current_password": HOST_PASSWORD,
                               "username": "Forgotten Owner", "new_password": WEB_PASSWORD},
                               headers={**ORIGIN, "X-CSRF-Token": signed.json()["csrf_token"]})
        assert changed.status_code == 200
        old_cookie = client.cookies.get(COOKIE_NAME)
    monkeypatch.setenv("HELPMINTHS_SUPER_ADMIN_PASSWORD", RECOVERY_PASSWORD)
    recovered = app_at(directory)
    store = recovered.state.platform_store
    assert len(rows(store, "users")) == 1
    assert store.authenticate("Super Admin", RECOVERY_PASSWORD)["id"] == identifier
    assert store.authenticate("Forgotten Owner", WEB_PASSWORD) is None
    with client_for(recovered) as client:
        client.cookies.set(COOKIE_NAME, old_cookie)
        assert client.get("/api/platform/session").json()["user"] is None
        assert owner_signin(client, password=RECOVERY_PASSWORD).json()["user"]["id"] == identifier


@pytest.mark.parametrize("with_owner", [False, True])
def test_reserved_name_collision_never_promotes_or_deletes_an_existing_member(tmp_path, monkeypatch, with_owner):
    directory = tmp_path / "private"
    store = PlatformStore(directory)
    member = store.create_user("formerly_unreserved", WEB_PASSWORD, "lab", approval_status="pending")
    # Simulate a legacy account which predates reserved owner names.
    with store.transaction() as conn:
        conn.execute("UPDATE users SET username='Super Admin' WHERE id=?", (member["id"],))
    if with_owner:
        store.create_user("Established Owner", WEB_PASSWORD, "admin", is_super_admin=True)
    before = {table: rows(store, table) for table in ("users", "documents", "sessions", "audit_logs")}
    monkeypatch.setenv("HELPMINTHS_SUPER_ADMIN_PASSWORD", HOST_PASSWORD)
    app = app_at(directory)
    assert {table: rows(app.state.platform_store, table) for table in before} == before
    with client_for(app) as client:
        session, _status = metadata(client)
        assert session["owner_bootstrap"]["configured"] is True
        assert session["owner_bootstrap"]["ready"] is False
        assert session["owner_bootstrap"]["message"]
        assert owner_signin(client).status_code == 401
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/platform/operations/dashboard").status_code == 200
    account = next(row for row in rows(store, "users") if row["id"] == member["id"])
    assert account["role"] == "lab" and account["is_super_admin"] == 0
    assert account["approval_status"] == "pending"


def test_private_marker_id_collision_preserves_the_unrelated_record(tmp_path, monkeypatch):
    directory = tmp_path / "private"
    store = PlatformStore(directory)
    member = store.create_user("ordinary_member", WEB_PASSWORD)
    store.create_document("analysis", {"note": "SYNTHETIC unrelated preserved record"},
                          member["id"], member["id"], document_id=BOOTSTRAP_DOCUMENT_ID)
    before = {table: rows(store, table) for table in ("users", "documents", "sessions", "audit_logs")}
    monkeypatch.setenv("HELPMINTHS_SUPER_ADMIN_PASSWORD", HOST_PASSWORD)
    app = app_at(directory)
    assert {table: rows(app.state.platform_store, table) for table in before} == before
    with client_for(app) as client:
        session, _status = metadata(client)
        assert session["owner_bootstrap"]["configured"] is True
        assert session["owner_bootstrap"]["ready"] is False
        assert client.get("/api/platform/operations/dashboard").status_code == 200
    assert app.state.platform_store.has_users() is False


@pytest.mark.parametrize("password", ["abc", "é" * 513])
def test_invalid_host_password_fails_closed_without_breaking_public_dashboard(tmp_path, monkeypatch, password, caplog):
    monkeypatch.setenv("HELPMINTHS_SUPER_ADMIN_PASSWORD", password)
    app = app_at(tmp_path / "private")
    with client_for(app) as client:
        session, status = metadata(client)
        assert session["owner_bootstrap"]["configured"] is True
        assert session["owner_bootstrap"]["ready"] is False
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/platform/operations/dashboard").status_code == 200
        public = json.dumps([session, status], ensure_ascii=False)
        assert password not in public
    assert rows(app.state.platform_store, "users") == []
    assert rows(app.state.platform_store, "documents") == []
    assert password not in caplog.text


def test_invalid_host_username_does_not_break_public_status_or_dashboard(tmp_path, monkeypatch):
    monkeypatch.setenv("HELPMINTHS_OWNER_USERNAME", "invalid/owner")
    monkeypatch.setenv("HELPMINTHS_SUPER_ADMIN_PASSWORD", HOST_PASSWORD)
    app = app_at(tmp_path / "private")
    with client_for(app) as client:
        session, _status = metadata(client)
        assert session["owner_bootstrap"]["ready"] is False
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/platform/operations/dashboard").status_code == 200
    assert rows(app.state.platform_store, "users") == []


def test_owner_credentials_and_scrypt_marker_are_private(tmp_path, monkeypatch, caplog):
    monkeypatch.setenv("HELPMINTHS_SUPER_ADMIN_PASSWORD", HOST_PASSWORD)
    app = app_at(tmp_path / "private")
    store = app.state.platform_store
    with client_for(app) as client:
        responses = [client.get("/api/platform/session"), client.get("/api/platform/status"), owner_signin(client)]
        assert responses[-1].status_code == 200
        public = " ".join(response.text for response in responses)
    document_text = json.dumps(rows(store, "documents"), ensure_ascii=False)
    documents = rows(store, "documents")
    serialized_data = [json.loads(row["data"]) for row in documents]
    marker_hashes = [value for data in serialized_data for value in data.values()
                     if isinstance(value, str) and value.startswith("scrypt$")]
    assert marker_hashes and all(verify_password(HOST_PASSWORD, value) for value in marker_hashes)
    user_hash = rows(store, "users")[0]["password_hash"]
    assert user_hash not in marker_hashes, "The private application marker has its own random salt"
    for secret in (HOST_PASSWORD, user_hash, *marker_hashes, hashlib.sha256(HOST_PASSWORD.encode()).hexdigest()):
        assert secret not in public
        assert secret not in caplog.text
        assert secret not in json.dumps(rows(store, "audit_logs"))
    assert HOST_PASSWORD not in document_text


def test_owner_signin_validates_role_before_cookie_audit_or_session_mutations(tmp_path, monkeypatch):
    monkeypatch.setenv("HELPMINTHS_SUPER_ADMIN_PASSWORD", HOST_PASSWORD)
    app = app_at(tmp_path / "private")
    store = app.state.platform_store
    for role in ("admin", "reviewer", "lab", "student"):
        store.create_user("ordinary_" + role, WEB_PASSWORD, role)
    store.create_user("pending_member", WEB_PASSWORD, "lab", approval_status="pending")
    with client_for(app) as owner:
        signed = owner_signin(owner)
        assert signed.status_code == 200
        cookie = owner.cookies.get(COOKIE_NAME)
        owner_id = signed.json()["user"]["id"]
        before = {table: rows(store, table) for table in ("sessions", "audit_logs", "users")}
        for role in ("admin", "reviewer", "lab", "student"):
            rejected = owner_signin(owner, "ordinary_" + role, WEB_PASSWORD)
            assert rejected.status_code == 403
            assert "set-cookie" not in rejected.headers
            assert owner.cookies.get(COOKIE_NAME) == cookie
            assert owner.get("/api/platform/session").json()["user"]["id"] == owner_id
        for username, password, expected in (("Super Admin", "wrong-password", 401),
                                              ("no_such_owner", HOST_PASSWORD, 401),
                                              ("pending_member", WEB_PASSWORD, 403)):
            rejected = owner_signin(owner, username, password)
            assert rejected.status_code == expected
            assert "set-cookie" not in rejected.headers
            assert owner.cookies.get(COOKIE_NAME) == cookie
        assert {table: rows(store, table) for table in before} == before
    with client_for(app) as anonymous:
        rejected = owner_signin(anonymous, "ordinary_admin", WEB_PASSWORD)
        assert rejected.status_code == 403
        assert anonymous.cookies.get(COOKIE_NAME) is None
        assert anonymous.get("/api/platform/users").status_code == 401


def test_owner_signin_uses_public_login_origin_and_rate_controls(tmp_path, monkeypatch):
    monkeypatch.setenv("HELPMINTHS_SUPER_ADMIN_PASSWORD", HOST_PASSWORD)
    app = app_at(tmp_path / "private")
    with client_for(app) as client:
        cross_origin = client.post("/api/platform/owner-signin", json={"username": "Super Admin", "password": HOST_PASSWORD},
                                   headers={"Origin": "https://untrusted.example"})
        assert cross_origin.status_code == 403
        assert client.cookies.get(COOKIE_NAME) is None
        for _ in range(5):
            assert owner_signin(client, password="wrong-password").status_code == 401
        limited = owner_signin(client)
        assert limited.status_code == 429
        assert limited.headers["retry-after"] == "60"
        assert "set-cookie" not in limited.headers
        assert client.cookies.get(COOKIE_NAME) is None


def test_multiple_app_workers_apply_one_atomic_owner_bootstrap(tmp_path, monkeypatch):
    directory = tmp_path / "private"
    PlatformStore(directory)
    monkeypatch.setenv("HELPMINTHS_SUPER_ADMIN_PASSWORD", HOST_PASSWORD)
    with ThreadPoolExecutor(max_workers=4) as workers:
        apps = list(workers.map(lambda _value: app_at(directory), range(4)))
    store = apps[0].state.platform_store
    assert len(rows(store, "users")) == 1
    assert store.authenticate("Super Admin", HOST_PASSWORD)["is_super_admin"] is True
    assert all(app.state.owner_bootstrap["ready"] is True for app in apps)
    before = {table: rows(store, table) for table in ("users", "documents", "audit_logs")}
    with ThreadPoolExecutor(max_workers=4) as workers:
        list(workers.map(lambda _value: app_at(directory), range(4)))
    assert {table: rows(store, table) for table in before} == before


def test_host_recovery_preserves_the_migrated_owner_and_legacy_record(tmp_path, monkeypatch):
    directory = tmp_path / "legacy"
    directory.mkdir()
    with sqlite3.connect(directory / "helpminths.sqlite3") as conn:
        conn.executescript("""
            CREATE TABLE schema_version(version INTEGER PRIMARY KEY);
            INSERT INTO schema_version VALUES (1);
            CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
            CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,expires_at TEXT NOT NULL);
            CREATE TABLE documents(id TEXT PRIMARY KEY,kind TEXT NOT NULL,owner_id TEXT REFERENCES users(id),data TEXT NOT NULL,
                created_at TEXT NOT NULL,updated_at TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,deleted_at TEXT);
            CREATE TABLE audit_logs(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,document_id TEXT NOT NULL,
                actor_id TEXT REFERENCES users(id),action TEXT NOT NULL,created_at TEXT NOT NULL,before_data TEXT,after_data TEXT);
        """)
        for identifier, role in (("established_operator", "admin"), ("public_member", "lab")):
            conn.execute("INSERT INTO users VALUES (?,?,?,?,1,'2025-01-01T00:00:00Z')", (identifier, identifier, hash_password(WEB_PASSWORD), role))
        conn.execute("INSERT INTO documents VALUES ('original-analysis','analysis','public_member',?, '2025-01-01Z','2025-01-01Z',3,NULL)",
                     ('{"note":"SYNTHETIC legacy preserved record"}',))
        conn.execute("INSERT INTO audit_logs(kind,document_id,actor_id,action,created_at,after_data) VALUES ('analysis','original-analysis','public_member','legacy_created','2025-01-01Z',?)",
                     ('{"note":"SYNTHETIC legacy audit"}',))
    monkeypatch.setenv("HELPMINTHS_SUPER_ADMIN_PASSWORD", HOST_PASSWORD)
    app = app_at(directory)
    store = app.state.platform_store
    account = store.authenticate("Super Admin", HOST_PASSWORD)
    assert account["id"] == "established_operator" and account["is_super_admin"] is True
    users = rows(store, "users")
    assert len(users) == 2
    member = next(row for row in users if row["id"] == "public_member")
    assert member["role"] == "lab" and member["is_super_admin"] == 0 and member["approval_status"] == "pending"
    saved = store.get_document("analysis", "original-analysis")
    assert saved["owner_id"] == "public_member" and saved["revision"] == 3
    assert saved["data"] == {"note": "SYNTHETIC legacy preserved record"}
    assert store.list_audit("analysis", saved["id"])[0]["after_data"] == {"note": "SYNTHETIC legacy audit"}
