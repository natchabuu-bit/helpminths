"""Select the account database explicitly, without a local fallback on failure."""
from __future__ import annotations

import os
from pathlib import Path

from .store import PlatformStore


def create_platform_store(data_dir: str | Path | None = None) -> PlatformStore:
    """Keep SQLite compatibility; an external URL opts into PostgreSQL.

    The URL and optional separate password are backend hosting secrets. Never include them in error messages,
    public status, frontend configuration, or a failed-connection fallback.
    ``data_dir`` remains the private image directory in PostgreSQL mode.
    """
    backend = os.getenv("HELPMINTHS_DATABASE_BACKEND", "").strip().lower()
    database_url = os.getenv("HELPMINTHS_DATABASE_URL", "").strip()
    if backend not in {"", "sqlite", "postgres"}:
        raise RuntimeError("HELPMINTHS_DATABASE_BACKEND must be sqlite or postgres")
    if backend == "sqlite" and database_url:
        raise RuntimeError("External database is configured but the selected backend is sqlite")
    if backend == "postgres" or database_url:
        if not database_url:
            raise RuntimeError("PostgreSQL requires HELPMINTHS_DATABASE_URL in private host settings")
        from .postgres_store import PostgresPlatformStore

        return PostgresPlatformStore(data_dir, database_url=database_url)
    return PlatformStore(data_dir)
