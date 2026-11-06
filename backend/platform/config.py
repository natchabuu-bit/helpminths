"""Safe environment configuration for the optional persistent platform."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

DEFAULT_AUTO_STORAGE_DIR = Path("/var/lib/helpminths")


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
    automatic_storage: bool = False

    @classmethod
    def from_environment(cls, data_dir: str | Path | None = None) -> "PlatformConfig":
        raw = data_dir if data_dir is not None else os.getenv("HELPMINTHS_DATA_DIR", "").strip()
        # Hosted builds explicitly opt into automatic private storage. An
        # explicit constructor argument, including an empty disabling value,
        # always wins; a configured path is never silently replaced.
        automatic = data_dir is None and not raw and env_bool("HELPMINTHS_AUTO_STORAGE")
        if automatic:
            raw = DEFAULT_AUTO_STORAGE_DIR
        try:
            hours = max(1, min(168, int(os.getenv("HELPMINTHS_SESSION_HOURS", "8"))))
        except ValueError:
            hours = 8
        return cls(
            data_dir=Path(raw).expanduser() if raw else None,
            cookie_secure=env_bool("HELPMINTHS_COOKIE_SECURE", True),
            session_hours=hours,
            # Render Free's automatically chosen filesystem is temporary. A
            # stale declaration cannot turn it into a persistent mounted disk.
            storage_durable=env_bool("HELPMINTHS_STORAGE_DURABLE", False) and not automatic,
            automatic_storage=automatic,
        )
