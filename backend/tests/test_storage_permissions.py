"""Private SQLite modes survive transient-journal removal during connection close."""
from __future__ import annotations

import errno
import os
import stat
from pathlib import Path

import pytest

from backend.platform.store import PlatformStore


@pytest.mark.parametrize('suffix', ['-wal', '-shm', '-journal'])
def test_missing_transient_journal_between_stat_and_chmod_is_allowed(tmp_path, monkeypatch, suffix):
    store = PlatformStore(tmp_path / 'private')
    journal = store.data_dir / f'helpminths.sqlite3{suffix}'
    journal.write_bytes(b'SYNTHETIC transient journal for permission-race verification only')
    original_chmod = os.chmod
    encountered = []

    def concurrent_removal(path, mode):
        if Path(path) == journal:
            encountered.append(Path(path))
            journal.unlink()
        return original_chmod(path, mode)

    monkeypatch.setattr(os, 'chmod', concurrent_removal)
    store._restrict_database_files()
    assert encountered == [journal], 'The regression must actually reach the removal race'
    assert not journal.exists()
    assert store.db_path.is_file()
    assert stat.S_IMODE(store.db_path.stat().st_mode) == 0o600


@pytest.mark.parametrize('filename', ['helpminths.sqlite3', 'helpminths.sqlite3.backup'])
def test_disappearing_database_or_nonjournal_file_still_raises(tmp_path, monkeypatch, filename):
    store = PlatformStore(tmp_path / 'private')
    target = store.data_dir / filename
    if filename != 'helpminths.sqlite3':
        target.write_bytes(b'SYNTHETIC durable file')
    original_chmod = os.chmod

    def concurrent_removal(path, mode):
        if Path(path) == target:
            target.unlink()
        return original_chmod(path, mode)

    monkeypatch.setattr(os, 'chmod', concurrent_removal)
    with pytest.raises(FileNotFoundError):
        store._restrict_database_files()
    assert not target.exists()


@pytest.mark.parametrize('suffix', ['-wal', '-shm', '-journal'])
@pytest.mark.parametrize('exception_type,error_number', [(PermissionError, errno.EACCES), (OSError, errno.EIO)])
def test_transient_journal_permission_and_io_errors_are_not_swallowed(tmp_path, monkeypatch, suffix, exception_type, error_number):
    store = PlatformStore(tmp_path / 'private')
    journal = store.data_dir / f'helpminths.sqlite3{suffix}'
    journal.write_bytes(b'SYNTHETIC private journal')
    original_chmod = os.chmod
    failure = exception_type(error_number, 'Synthetic permission/I/O failure', str(journal))

    def failed_chmod(path, mode):
        if Path(path) == journal:
            raise failure
        return original_chmod(path, mode)

    monkeypatch.setattr(os, 'chmod', failed_chmod)
    with pytest.raises(exception_type) as caught:
        store._restrict_database_files()
    assert caught.value is failure


def test_all_present_database_and_journal_files_are_private(tmp_path):
    store = PlatformStore(tmp_path / 'private')
    files = [store.db_path]
    for suffix in ['-wal', '-shm', '-journal']:
        journal = store.data_dir / f'helpminths.sqlite3{suffix}'
        journal.write_bytes(b'SYNTHETIC journal')
        files.append(journal)
    for path in files:
        os.chmod(path, 0o644)
    store._restrict_database_files()
    assert all(stat.S_IMODE(path.stat().st_mode) == 0o600 for path in files)
