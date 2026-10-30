"""Create the first real administrator interactively; never seeds credentials.

Usage: HELPMINTHS_DATA_DIR=/private/persistent/path python -m backend.platform.bootstrap --username operator
"""
from __future__ import annotations

import argparse
import getpass

from fastapi import HTTPException

from .store import PlatformStore


def main() -> int:
    parser = argparse.ArgumentParser(description="Create the first HelpMinths administrator using a private persistent data directory")
    parser.add_argument("--username", required=True, help="Operator username, 3–64 ASCII letters/numbers/._-")
    args = parser.parse_args()
    store = PlatformStore()
    if not store.configured:
        parser.error("Set HELPMINTHS_DATA_DIR to private storage first")
    password = getpass.getpass("New administrator password (at least 12 characters): ")
    repeat = getpass.getpass("Repeat password: ")
    if password != repeat:
        parser.error("Passwords do not match")
    try:
        with store.transaction() as conn:
            if conn.execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None:
                parser.error("Accounts already exist. Sign in as an administrator to manage users.")
            store.create_user(args.username, password, "admin", conn=conn)
    except HTTPException as error:
        parser.error(str(error.detail))
    print("Administrator created. No password or session token was printed. Sign in through HelpMinths Settings.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
