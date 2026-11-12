"""Opt-in conformance runner for existing workflows on LOCAL PostgreSQL.

This is not conftest.py and is never enabled by ordinary test collection.
Enable explicitly with ``-p backend.tests.postgres_workflow_plugin`` and set
``HELPMINTHS_TEST_POSTGRES_URL`` to a disposable localhost PostgreSQL instance.
Each selected test uses its own newly created UUID-named database. No existing
application database or Supabase project is selected, cleared, or dropped.
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlsplit, urlunsplit

import psycopg
import pytest
from psycopg import sql

_WORKFLOW_MODULES = frozenset({
    "test_registration.py", "test_referrals.py", "test_registration_profiles.py",
    "test_daily_history.py", "test_notifications.py", "test_platform_reporting.py",
    "test_admin_image_archive.py",
})
_SQLITE_ONLY_CASES = frozenset({
    "test_v2_migration_preserves_ids_passwords_sessions_roles_history_and_audit",
    "test_actual_anonymous_unconfigured_compatibility_route_remains_nonpersistent",
})
_TEST_DIRECTORY = Path(__file__).resolve().parent


def _is_workflow(module) -> bool:
    source = getattr(module, "__file__", None)
    return bool(source and Path(source).resolve().parent == _TEST_DIRECTORY
                and Path(source).name in _WORKFLOW_MODULES)


def _local_url() -> str:
    value = os.getenv("HELPMINTHS_TEST_POSTGRES_URL", "").strip()
    try:
        parsed = urlsplit(value)
        query = parse_qs(parsed.query)
        if (parsed.scheme not in {"postgres", "postgresql"}
                or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
                or not parsed.path.strip("/") or parsed.fragment
                or set(query) - {"sslmode", "connect_timeout"}
                or (parsed.port is not None and not 1 <= parsed.port <= 65535)):
            raise ValueError
    except (ValueError, TypeError):
        # Do not interpolate a test DSN or authentication value into errors.
        raise pytest.UsageError(
            "The PostgreSQL workflow plugin requires HELPMINTHS_TEST_POSTGRES_URL "
            "for a disposable localhost server; remote/routing-override URLs are refused"
        ) from None
    return value


def pytest_configure(config):
    _local_url()


def pytest_collection_modifyitems(items):
    for item in items:
        if _is_workflow(item.module) and item.originalname in _SQLITE_ONLY_CASES:
            item.add_marker(pytest.mark.skip(
                reason="SQLite in-place migration/disabled local-store contract; run in ordinary SQLite suite"
            ))


@pytest.fixture(autouse=True)
def _postgres_workflow_database(request, monkeypatch):
    if not _is_workflow(request.module):
        yield
        return

    from backend.platform.postgres_store import PostgresPlatformStore

    base = _local_url()
    name = "helpminths_workflow_" + uuid.uuid4().hex
    # Identifiers come only from the generated fixed prefix/UUID, never a URL,
    # request body, filename, account name, or an existing database name.
    with psycopg.connect(base, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    parsed = urlsplit(base)
    isolated_url = urlunsplit((parsed.scheme, parsed.netloc, "/" + name, parsed.query, ""))
    monkeypatch.setenv("HELPMINTHS_DATABASE_BACKEND", "postgres")
    monkeypatch.setenv("HELPMINTHS_DATABASE_URL", isolated_url)
    monkeypatch.delenv("HELPMINTHS_SUPER_ADMIN_PASSWORD", raising=False)

    def external_store(data_dir=None):
        return PostgresPlatformStore(data_dir, database_url=isolated_url)

    if hasattr(request.module, "PlatformStore"):
        monkeypatch.setattr(request.module, "PlatformStore", external_store)
    try:
        yield
    finally:
        with psycopg.connect(base, autocommit=True) as admin:
            admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))
