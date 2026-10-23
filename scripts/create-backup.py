#!/usr/bin/env python3
"""Create a portable source, production-web and Git-history backup of HelpMinths."""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile


ROOT = Path(__file__).resolve().parents[1]
BANGKOK = timezone(timedelta(hours=7), name="Asia/Bangkok")
REPOSITORY_URL = "https://github.com/natchabuu-bit/helpminths"
DOCS = {
    "README-RESTORE.th.md": "docs/backup/RESTORE.th.md",
    "NEW-ACCOUNT-PROMPT.th.txt": "docs/backup/NEW-ACCOUNT-PROMPT.th.txt",
}


class BackupError(RuntimeError):
    """An incomplete or unsafe backup must fail before publication."""


def capture(*command: str) -> str:
    result = subprocess.run(
        command, cwd=ROOT, check=True, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True,
    )
    return result.stdout.strip()


def safe_name(name: str) -> str:
    path = PurePosixPath(name)
    if (
        not name or path.is_absolute() or ".." in path.parts
        or "\\" in name or "\n" in name or "\r" in name or "\0" in name
    ):
        raise BackupError(f"Unsupported archive path: {name!r}")
    return path.as_posix()


def is_secret_path(name: str) -> bool:
    basename = PurePosixPath(name).name.lower()
    return (
        (basename.startswith(".env") and basename != ".env.example")
        or basename.endswith((".pem", ".key", ".p12", ".pfx"))
        or basename in {
            "id_rsa", "id_ed25519", ".git-credentials", ".netrc", ".npmrc",
            "credentials", "credentials.json", "service-account.json",
        }
    )


def check_clean_checkout() -> None:
    # Existing backup artifacts are deliberately excluded from this check and
    # from source/. Ignored installations and caches are not website source.
    changes = capture(
        "git", "status", "--porcelain=v1", "--untracked-files=all", "--",
        ".", ":(exclude)backups/**",
    )
    if changes:
        raise BackupError(
            "Commit all source changes and new files before creating a backup. "
            "Uncommitted files would be missing from git archive and the bundle."
        )
    historical_paths = capture(
        "git", "log", "--all", "--name-only", "--format=",
    ).splitlines()
    if any(is_secret_path(name) for name in historical_paths if name):
        raise BackupError(
            "A credential-like filename exists in tracked Git history. "
            "Review the history before distributing a full Git bundle; "
            "no credential contents were printed."
        )


def source_files() -> dict[str, tuple[bytes, int]]:
    archive = subprocess.run(
        ["git", "archive", "--format=tar", "HEAD"], cwd=ROOT, check=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    ).stdout
    files: dict[str, tuple[bytes, int]] = {}
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:") as source:
        for member in source:
            name = safe_name(member.name)
            if name == "backups" or name.startswith("backups/") or member.isdir():
                continue
            if not member.isfile():
                raise BackupError(f"Non-regular source entry needs explicit review: {name}")
            if is_secret_path(name):
                raise BackupError("A credential-like source filename cannot be included.")
            handle = source.extractfile(member)
            if handle is None:
                raise BackupError(f"Could not read committed source file: {name}")
            files[name] = (handle.read(), member.mode & 0o777)

    tracked = {
        safe_name(name) for name in capture(
            "git", "ls-tree", "-r", "--name-only", "HEAD",
        ).splitlines()
        if name != "backups" and not name.startswith("backups/")
    }
    if set(files) != tracked:
        raise BackupError(
            "Git archive did not contain every tracked source file. "
            "Review export-ignore attributes or special entries."
        )
    return files


def production_files() -> dict[str, tuple[bytes, int]]:
    directory = ROOT / "dist"
    for required in ("index.html", "sw.js"):
        if not (directory / required).is_file():
            raise BackupError("Production build missing; run npm run build first.")
    worker = (directory / "sw.js").read_text(encoding="utf-8")
    if "__HELPMINTHS_BUILD_VERSION__" in worker or "__HELPMINTHS_PRECACHE__" in worker:
        raise BackupError("The service worker is an unbuilt template, not a production build.")

    files: dict[str, tuple[bytes, int]] = {}
    for path in sorted(directory.rglob("*")):
        if path.is_symlink():
            raise BackupError("A production symlink needs explicit review before archiving.")
        if not path.is_file():
            continue
        name = safe_name(path.relative_to(directory).as_posix())
        if is_secret_path(name):
            raise BackupError("A credential-like production filename cannot be included.")
        files[name] = (path.read_bytes(), path.stat().st_mode & 0o777)
    return files


def tool_version(command: list[str]) -> str:
    try:
        return capture(*command)
    except (OSError, subprocess.CalledProcessError):
        return "not available"


def add_zip_file(
    archive: zipfile.ZipFile, name: str, contents: bytes, mode: int,
    created: datetime,
) -> None:
    info = zipfile.ZipInfo(name, date_time=created.timetuple()[:6])
    info.create_system = 3
    info.external_attr = (0o100000 | mode) << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    archive.writestr(info, contents, compresslevel=9)


def verify_zip(path: Path, prefix: str, expected: dict[str, str]) -> None:
    with zipfile.ZipFile(path) as archive:
        bad_file = archive.testzip()
        if bad_file:
            raise BackupError(f"ZIP integrity check failed: {bad_file}")
        names = set(archive.namelist())
        if names != {prefix + name for name in expected} | {prefix + "SHA256SUMS.txt"}:
            raise BackupError("ZIP entry list does not match the complete manifest.")
        for name, checksum in expected.items():
            if hashlib.sha256(archive.read(prefix + name)).hexdigest() != checksum:
                raise BackupError(f"Archived file checksum failed: {name}")
        listed = archive.read(prefix + "SHA256SUMS.txt").decode("utf-8")
        wanted = "".join(f"{digest}  {name}\n" for name, digest in sorted(expected.items()))
        if listed != wanted:
            raise BackupError("The stored checksum manifest does not match the archive.")


def create_backup(output: Path, skip_build: bool) -> tuple[Path, Path, int]:
    check_clean_checkout()
    if not skip_build:
        npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
        if not npm:
            raise BackupError("npm is required to build; install Node.js first.")
        subprocess.run([npm, "run", "build"], cwd=ROOT, check=True)
        check_clean_checkout()

    source = source_files()
    production = production_files()
    for name in DOCS.values():
        if name not in source:
            raise BackupError(f"Committed recovery instructions are missing: {name}")
    created = datetime.now(BANGKOK)
    prefix = f"HelpMinths-backup-{created.date().isoformat()}/"
    commit = capture("git", "rev-parse", "HEAD")
    branch = capture("git", "branch", "--show-current") or "detached HEAD"
    output = output.expanduser().resolve()
    if output.suffix.lower() != ".zip":
        raise BackupError("The output filename must end in .zip.")
    if output.is_relative_to(ROOT) and not output.is_relative_to(ROOT / "backups"):
        raise BackupError("Choose backups/ or a destination outside the source checkout.")
    output.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="helpminths-backup-") as temporary:
        directory = Path(temporary)
        bundle = directory / "git-history.bundle"
        subprocess.run(
            ["git", "bundle", "create", str(bundle), "--all"], cwd=ROOT,
            check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        subprocess.run(
            ["git", "bundle", "verify", str(bundle)], cwd=ROOT, check=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )

        files = {f"source/{name}": entry for name, entry in source.items()}
        files.update({f"production-web/{name}": entry for name, entry in production.items()})
        files["git-history.bundle"] = (bundle.read_bytes(), 0o644)
        for target, origin in DOCS.items():
            files[target] = source[origin]
        weight_files = [
            name for name in source
            if PurePosixPath(name).suffix.lower() in {".pt", ".pth", ".onnx", ".tflite"}
        ]
        metadata = {
            "application": "HelpMinths",
            "created_at": created.isoformat(timespec="seconds"),
            "timezone": "Asia/Bangkok",
            "source_commit": commit,
            "source_branch": branch,
            "repository_url": REPOSITORY_URL,
            "source_file_count": len(source),
            "production_file_count": len(production),
            "node_version": tool_version(["node", "--version"]),
            "python_packager_version": sys.version.split()[0],
            "build_mode": "existing verified dist" if skip_build else "npm run build",
            "model_weights_included": bool(weight_files),
            "model_weight_files": weight_files,
            "scope": {
                "source": "All committed files at source_commit, excluding backups/ to avoid recursive archives.",
                "production_web": "Complete built static web app including local photos, fonts and service worker.",
                "git_history": "All Git refs and reachable committed history; Git configuration and credentials are not included.",
                "not_included": [
                    "Provider credentials, local environment secrets and account sessions.",
                    "Reinstallable node_modules, Python virtual environments and package caches.",
                    "External datasets, uploaded notebooks or model weights not present in committed source.",
                    "Browser session-only uploaded images and result history, which this script cannot export.",
                ],
            },
            "photo_license": "Bundled Buckelew microscopy photos retain their CC BY-NC 4.0 attribution and noncommercial restrictions.",
            "clinical_limit": "Atlas content and application checks do not establish trained AI availability or diagnostic accuracy.",
        }
        files["BACKUP-METADATA.json"] = (
            (json.dumps(metadata, ensure_ascii=False, indent=2) + "\n").encode("utf-8"), 0o644,
        )
        checksums = {name: hashlib.sha256(value[0]).hexdigest() for name, value in files.items()}
        manifest = "".join(f"{digest}  {name}\n" for name, digest in sorted(checksums.items()))
        staged_zip = directory / "backup.zip"
        with zipfile.ZipFile(staged_zip, mode="w", allowZip64=True) as archive:
            for name, (contents, mode) in sorted(files.items()):
                add_zip_file(archive, prefix + safe_name(name), contents, mode, created)
            add_zip_file(archive, prefix + "SHA256SUMS.txt", manifest.encode("utf-8"), 0o644, created)
        verify_zip(staged_zip, prefix, checksums)
        digest = hashlib.sha256(staged_zip.read_bytes()).hexdigest()

        # Copy to temporary siblings before atomic replacement, including when
        # the destination and the system temporary directory are different disks.
        with tempfile.NamedTemporaryFile(dir=output.parent, prefix=".backup-", delete=False) as handle:
            sibling = Path(handle.name)
            try:
                with staged_zip.open("rb") as source_handle:
                    shutil.copyfileobj(source_handle, handle)
                handle.flush()
                os.fsync(handle.fileno())
            except BaseException:
                sibling.unlink(missing_ok=True)
                raise
        try:
            os.replace(sibling, output)
        finally:
            sibling.unlink(missing_ok=True)
        checksum_file = output.with_name(output.name + ".sha256")
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=output.parent, prefix=".checksum-", delete=False,
        ) as handle:
            checksum_sibling = Path(handle.name)
            handle.write(f"{digest}  {output.name}\n")
        try:
            os.replace(checksum_sibling, checksum_file)
        finally:
            checksum_sibling.unlink(missing_ok=True)
    return output, checksum_file, len(checksums)


def main() -> int:
    today = datetime.now(BANGKOK).date().isoformat()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path,
        default=ROOT / "backups" / f"HelpMinths-backup-{today}.zip",
        help="ZIP destination (default: backups/HelpMinths-backup-YYYY-MM-DD.zip).",
    )
    parser.add_argument(
        "--skip-build", action="store_true",
        help="Use an existing tested dist instead of rebuilding; source must still be committed.",
    )
    arguments = parser.parse_args()
    try:
        output, checksum, count = create_backup(arguments.output, arguments.skip_build)
    except (BackupError, OSError, subprocess.CalledProcessError, tarfile.TarError, zipfile.BadZipFile) as error:
        # Never dump subprocess environments or file contents when reporting a failure.
        print(f"Backup failed: {error}", file=sys.stderr)
        return 1
    print(f"Verified backup: {output}")
    print(f"SHA-256 file: {checksum}")
    print(f"Verified archived files: {count}")
    print(f"ZIP bytes: {output.stat().st_size}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
