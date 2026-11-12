"""Create the first real administrator interactively; never seeds credentials.

Usage: HELPMINTHS_DATA_DIR=/private/persistent/path python -m backend.platform.bootstrap --username operator
"""
from __future__ import annotations

import argparse
import getpass

from fastapi import HTTPException

from .persistence import create_platform_store


def main() -> int:
    parser = argparse.ArgumentParser(description="Create the first HelpMinths administrator using a private persistent data directory")
    parser.add_argument("--username", required=True, help="Nonempty operator username: ASCII letters/numbers/spaces/._-, starting with a letter or number")
    args = parser.parse_args()
    store = create_platform_store()
    if not store.configured:
        parser.error("Configure a private data directory or the external PostgreSQL database first")
    password = getpass.getpass("New administrator password (at least 4 characters): ")
    repeat = getpass.getpass("Repeat password: ")
    if password != repeat:
        parser.error("Passwords do not match")
    try:
        with store.transaction() as conn:
            if conn.execute("SELECT 1 FROM users WHERE is_super_admin=1 LIMIT 1").fetchone() is not None:
                parser.error("An owner already exists. Sign in as the owner to manage users.")
            store.create_user(args.username, password, "admin", conn=conn, is_super_admin=True)
    except HTTPException as error:
        parser.error(str(error.detail))
    print("Administrator created. No password or session token was printed. Sign in through HelpMinths Settings.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
