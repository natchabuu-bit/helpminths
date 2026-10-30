"""Safe environment configuration for the optional persistent platform."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    # A typo must not silently disable Secure cookies or claim durable storage.
    return default


@dataclass(frozen=True)
class PlatformConfig:
    data_dir: Path | None
    cookie_secure: bool
    session_hours: int
    storage_durable: bool

    @classmethod
    def from_environment(cls, data_dir: str | Path | None = None) -> "PlatformConfig":
        raw = data_dir if data_dir is not None else os.getenv("HELPMINTHS_DATA_DIR", "").strip()
        try:
            hours = max(1, min(168, int(os.getenv("HELPMINTHS_SESSION_HOURS", "8"))))
        except ValueError:
            hours = 8
        return cls(
            data_dir=Path(raw).expanduser() if raw else None,
            cookie_secure=env_bool("HELPMINTHS_COOKIE_SECURE", True),
            session_hours=hours,
            storage_durable=env_bool("HELPMINTHS_STORAGE_DURABLE", False),
        )
