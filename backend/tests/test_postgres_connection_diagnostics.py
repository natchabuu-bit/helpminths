"""Connection failures produce useful static hints, never provider secrets."""
from __future__ import annotations

import sqlite3

import psycopg
import pytest

from backend.platform.database_diagnostics import connection_failure_message
from backend.platform.postgres_store import PostgresPlatformStore


PRIVATE = "SYNTHETIC-PRIVATE-password-token-host.invalid"


@pytest.mark.parametrize("error,code", [
    (psycopg.errors.InvalidPassword(PRIVATE), "DB_AUTH"),
    (psycopg.errors.InvalidAuthorizationSpecification(PRIVATE), "DB_AUTH"),
    (psycopg.errors.InvalidCatalogName(PRIVATE), "DB_DATABASE_NAME"),
    (psycopg.errors.TooManyConnections(PRIVATE), "DB_CONNECTION_LIMIT"),
    (psycopg.errors.CannotConnectNow(PRIVATE), "DB_UNAVAILABLE"),
    (psycopg.OperationalError("Tenant or user not found " + PRIVATE), "DB_POOLER_IDENTITY"),
    (psycopg.errors.InvalidAuthorizationSpecification("Tenant or user not found " + PRIVATE), "DB_POOLER_IDENTITY"),
    (psycopg.OperationalError("error received from server in SCRAM exchange: Wrong password " + PRIVATE), "DB_AUTH"),
    (psycopg.OperationalError("password authentication failed " + PRIVATE), "DB_AUTH"),
    (psycopg.OperationalError("no password supplied " + PRIVATE), "DB_AUTH"),
    (psycopg.OperationalError("database " + PRIVATE + " does not exist"), "DB_DATABASE_NAME"),
    (psycopg.OperationalError("could not translate host name " + PRIVATE), "DB_DNS"),
    (psycopg.OperationalError("failed to resolve host " + PRIVATE), "DB_DNS"),
    (psycopg.OperationalError("Name or service not known " + PRIVATE), "DB_DNS"),
    (psycopg.OperationalError("Network is unreachable " + PRIVATE), "DB_NETWORK"),
    (psycopg.OperationalError("connection refused " + PRIVATE), "DB_NETWORK"),
    (psycopg.OperationalError("SSL connection has been closed unexpectedly " + PRIVATE), "DB_NETWORK"),
    (psycopg.OperationalError("SSL SYSCALL error: EOF detected " + PRIVATE), "DB_NETWORK"),
    (psycopg.OperationalError("connection timeout expired " + PRIVATE), "DB_TIMEOUT"),
    (psycopg.OperationalError("connection timed out " + PRIVATE), "DB_TIMEOUT"),
    (psycopg.OperationalError("certificate verify failed " + PRIVATE), "DB_TLS"),
    (psycopg.OperationalError("server certificate for " + PRIVATE + " does not match host name"), "DB_TLS"),
    (psycopg.OperationalError("server does not support SSL " + PRIVATE), "DB_TLS"),
    (psycopg.OperationalError("max client connections reached " + PRIVATE), "DB_CONNECTION_LIMIT"),
    (psycopg.OperationalError("database system is starting up " + PRIVATE), "DB_UNAVAILABLE"),
    (psycopg.OperationalError("unexpected private detail " + PRIVATE), "DB_CONNECTION_FAILED"),
])
def test_failures_use_a_static_code_without_echoing_provider_details(error, code):
    message = connection_failure_message(error)
    assert message.startswith(f"[{code}] ")
    assert PRIVATE not in message
    assert "host.invalid" not in message
    assert str(error) not in message


@pytest.mark.parametrize("error", [
    psycopg.errors.InvalidPassword(PRIVATE),
    psycopg.OperationalError("Tenant or user not found " + PRIVATE),
    psycopg.OperationalError("Network is unreachable " + PRIVATE),
    psycopg.OperationalError("unexpected private detail " + PRIVATE),
])
def test_real_store_connection_hook_raises_sanitized_errors_without_fallback(monkeypatch, error):
    store = PostgresPlatformStore.__new__(PostgresPlatformStore)
    store._database_url = "postgresql://user:URI-SECRET@example.invalid/postgres"
    store._connection_kwargs = {"password": "RAW-SECRET"}
    calls = []

    def fail(*args, **kwargs):
        calls.append((args, kwargs))
        raise error

    monkeypatch.setattr(psycopg, "connect", fail)
    with pytest.raises(sqlite3.OperationalError) as caught:
        store._open_connection()
    assert str(caught.value) == connection_failure_message(error)
    for secret in [PRIVATE, "URI-SECRET", "RAW-SECRET", store._database_url]:
        assert secret not in str(caught.value)
    assert caught.value.__suppress_context__ is True
    assert len(calls) == 1
    assert calls[0][1]["password"] == "RAW-SECRET"
