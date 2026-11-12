"""The dialect adapter never interpolates credentials or JSON values into SQL."""
from __future__ import annotations

import sqlite3
from decimal import Decimal

import psycopg
import pytest

from backend.platform.postgres_store import (
    PostgresRow, _connection_settings, _safe_database_error, translate_sql,
)


def test_placeholder_and_identity_translation_preserves_literals_and_comments():
    sql = "SELECT 'rowid ? LIKE', \"quoted?\", n.rowid FROM documents n -- rowid ?\nWHERE id=? AND data='it''s ?' /* rowid ? */"
    translated = translate_sql(sql)
    assert "'rowid ? LIKE'" in translated
    assert '"quoted?"' in translated
    assert "n._sequence" in translated
    assert "-- rowid ?" in translated
    assert "id=%s" in translated
    assert "data='it''s ?'" in translated
    assert "/* rowid ? */" in translated


def test_case_insensitive_username_match_only_rewrites_sql_code():
    sql = "SELECT 'username=? COLLATE NOCASE' AS example FROM users WHERE username=? COLLATE NOCASE"
    translated = translate_sql(sql)
    assert "'username=? COLLATE NOCASE'" in translated
    assert "WHERE LOWER(username)=LOWER(%s)" in translated


def test_bound_sql_escapes_existing_percent_signs_without_touching_values():
    assert translate_sql("SELECT '50%' WHERE id=?") == "SELECT '50%%' WHERE id=%s"
    assert translate_sql("SELECT '50%'", bind=False) == "SELECT '50%'"


def test_numeric_json_aggregate_cast_preserves_case_expression_and_literal():
    translated = translate_sql("SELECT AVG(CASE WHEN json_extract(data,'$.status')='completed' THEN json_extract(data,'$.duration_ms') ELSE NULL END) FROM documents")
    assert "AVG(CAST((CASE WHEN" in translated
    assert "json_extract(data,'$.duration_ms') ELSE NULL END) AS NUMERIC))" in translated
    assert translate_sql("SELECT SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) FROM users") == "SELECT SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) FROM users"


def test_rows_allow_positional_and_mapping_access_but_hide_internal_sequence():
    row = PostgresRow(['id', '_sequence', 'username'], ('test-account', 99, 'Example'))
    assert row[0] == row['id'] == 'test-account'
    assert row[-1] == 'Example'
    assert row[:] == ('test-account', 'Example')
    assert dict(row) == {'id': 'test-account', 'username': 'Example'}
    assert row.keys() == ['id', 'username']
    assert list(row) == ['test-account', 'Example']
    with pytest.raises(IndexError):
        _ = row['_sequence']


@pytest.mark.parametrize('url', [
    'sqlite:///private.db',
    'postgresql://example',
    'postgresql://user:PRIVATE-SECRET@example.invalid/app?sslmode=disable',
    'postgresql://user:PRIVATE-SECRET@example.invalid/app?sslmode=prefer',
    'postgresql://user:PRIVATE-SECRET@localhost/app?host=example.invalid&sslmode=disable',
    'postgresql://user:PRIVATE-SECRET@localhost/app?hostaddr=203.0.113.1&sslmode=disable',
    'postgresql://user:PRIVATE-SECRET@localhost/app?service=external&sslmode=disable',
])
def test_bad_or_unencrypted_remote_configuration_is_rejected_without_secret(url):
    with pytest.raises(RuntimeError) as caught:
        _connection_settings(url)
    assert 'PRIVATE-SECRET' not in str(caught.value)
    assert 'example.invalid' not in str(caught.value)


def test_remote_tls_default_and_pooler_safe_prepare_settings():
    settings = _connection_settings('postgresql://server-user:private@example.invalid/postgres')
    assert settings['sslmode'] == 'require'
    assert settings['prepare_threshold'] is None
    assert settings['autocommit'] is True
    assert _connection_settings('postgresql://local@127.0.0.1:5432/test?sslmode=disable')['sslmode'] == 'disable'
    assert _connection_settings('postgresql://user@example.invalid/postgres?sslmode=verify-full')['sslmode'] == 'verify-full'


def test_integrity_error_details_are_not_copied_to_outer_exception():
    with pytest.raises(sqlite3.IntegrityError) as caught:
        _safe_database_error(psycopg.errors.UniqueViolation('secret password_hash row content'))
    assert str(caught.value) == 'Database constraint violation'


def test_operational_error_details_are_not_copied_to_outer_exception():
    with pytest.raises(sqlite3.OperationalError) as caught:
        _safe_database_error(psycopg.OperationalError('postgres://user:SECRET@host/database'))
    assert 'SECRET' not in str(caught.value)
    assert 'host' not in str(caught.value)


def test_numeric_aggregate_rows_use_json_numbers_instead_of_decimal_strings():
    row = PostgresRow(['completed', 'mean'], (Decimal('3'), Decimal('12.25')))
    assert row['completed'] == 3 and type(row['completed']) is int
    assert row['mean'] == 12.25 and type(row['mean']) is float


def test_local_plaintext_is_pinned_to_physical_loopback():
    settings = _connection_settings('postgresql://local@localhost/test?sslmode=disable')
    assert settings['hostaddr'] == '127.0.0.1'
