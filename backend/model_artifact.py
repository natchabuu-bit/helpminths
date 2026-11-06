"""Fetch the operator's model artifact without executing anything inside it.

This module is a build/deployment utility, not a public upload endpoint. It can
copy a modern PyTorch checkpoint or select a unique ``weights/best.pt`` from a
results archive. Container structure is checked here; the inference service must
still load the checkpoint and verify its detection task. No model accuracy or
training provenance is inferred from a filename.
"""
from __future__ import annotations

import argparse
import hashlib
import http.cookiejar
import ipaddress
import json
import os
import re
import shutil
import stat
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from typing import Mapping
from zipfile import BadZipFile, ZipFile, ZipInfo

MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024
MAX_MODEL_BYTES = 256 * 1024 * 1024
MAX_ARCHIVE_MEMBERS = 10000
MAX_COMPRESSION_RATIO = 100
MAX_HTML_BYTES = 1024 * 1024
_CHUNK = 64 * 1024
_GOOGLE_HOSTS = {'drive.google.com', 'docs.google.com', 'drive.usercontent.google.com'}
_FILE_ID = re.compile(r'^[A-Za-z0-9_-]{10,200}$')


class ModelArtifactError(ValueError):
    """A sanitized operator-facing error; never embeds a signed download URL."""


def _google_host(host: str) -> bool:
    return host in _GOOGLE_HOSTS or host.endswith('.googleusercontent.com')


def _validate_url(url: str, *, google_only: bool = False) -> str:
    if not isinstance(url, str) or not url or len(url) > 8192 or any(ord(char) < 32 for char in url):
        raise ModelArtifactError('ลิงก์โมเดลไม่ถูกต้อง')
    try:
        parsed = urllib.parse.urlsplit(url)
        host, port = (parsed.hostname or '').lower(), parsed.port
    except ValueError:
        raise ModelArtifactError('ลิงก์โมเดลไม่ถูกต้อง') from None
    if parsed.scheme != 'https' or not host or parsed.username is not None or parsed.password is not None or port not in (None, 443):
        raise ModelArtifactError('ลิงก์โมเดลต้องเป็น HTTPS โดยไม่มีรหัสผ่านหรือพอร์ตพิเศษใน URL')
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise ModelArtifactError('ไม่รองรับลิงก์โมเดลที่ระบุ IP โดยตรง')
    if host.rstrip('.') == 'localhost' or host.rstrip('.').endswith(('.localhost', '.local', '.internal')):
        raise ModelArtifactError('ไม่รองรับลิงก์โมเดลภายในเครื่องหรือเครือข่ายส่วนตัว')
    if google_only and not _google_host(host):
        raise ModelArtifactError('ลิงก์ยืนยันหรือ redirect ของ Google Drive ชี้ไปยังปลายทางที่ไม่อนุญาต')
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ''))


def _drive_id(url: str) -> str | None:
    parsed = urllib.parse.urlsplit(url)
    if not _google_host((parsed.hostname or '').lower()):
        return None
    matched = re.search(r'/file/d/([^/]+)', parsed.path)
    identifier = matched.group(1) if matched else urllib.parse.parse_qs(parsed.query).get('id', [None])[0]
    if identifier is not None and not _FILE_ID.fullmatch(identifier):
        raise ModelArtifactError('รหัสไฟล์ Google Drive ไม่ถูกต้อง')
    return identifier


def normalize_download_url(url: str) -> str:
    """Translate a Drive sharing page into its standard public download URL."""
    clean = _validate_url(url)
    parsed = urllib.parse.urlsplit(clean)
    if (parsed.hostname or '').lower() not in _GOOGLE_HOSTS:
        return clean
    identifier = _drive_id(clean)
    if not identifier:
        raise ModelArtifactError('ลิงก์ Google Drive ต้องระบุไฟล์ที่ต้องการดาวน์โหลด')
    params = {'id': identifier, 'export': 'download', 'confirm': 't'}
    resource_key = urllib.parse.parse_qs(parsed.query).get('resourcekey', [None])[0]
    if resource_key:
        params['resourcekey'] = resource_key
    return 'https://drive.usercontent.google.com/download?' + urllib.parse.urlencode(params)


class _SafeRedirect(urllib.request.HTTPRedirectHandler):
    def __init__(self, google_only: bool, identifier: str | None = None):
        self.google_only = google_only
        self.identifier = identifier

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        selected = _validate_url(urllib.parse.urljoin(req.full_url, newurl), google_only=self.google_only)
        redirected_id = _drive_id(selected) if self.identifier else None
        if redirected_id is not None and redirected_id != self.identifier:
            raise ModelArtifactError('ลิงก์ redirect ไม่ตรงกับไฟล์ Google Drive ที่ระบุ')
        return super().redirect_request(req, fp, code, msg, headers, selected)


class _ConfirmationParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.forms: list[dict] = []
        self.links: list[str] = []
        self.current: dict | None = None

    def handle_starttag(self, tag, attrs):
        attributes = {key.lower(): value or '' for key, value in attrs}
        if tag.lower() == 'form':
            self.current = {'id': attributes.get('id', ''), 'action': attributes.get('action', ''),
                            'method': attributes.get('method', 'get').lower(), 'fields': {}}
            self.forms.append(self.current)
        elif tag.lower() == 'input' and self.current is not None:
            if attributes.get('type', 'hidden').lower() == 'hidden' and attributes.get('name'):
                self.current['fields'][attributes['name']] = attributes.get('value', '')
        elif tag.lower() == 'a' and attributes.get('href'):
            self.links.append(attributes['href'])

    def handle_endtag(self, tag):
        if tag.lower() == 'form':
            self.current = None


def _confirmation_url(html: str, current_url: str, identifier: str, jar=None) -> str:
    parser = _ConfirmationParser()
    try:
        parser.feed(html)
    except Exception:
        raise ModelArtifactError('อ่านหน้ายืนยัน Google Drive ไม่สำเร็จ') from None
    allowed_fields = {'id', 'export', 'confirm', 'uuid', 'resourcekey', 'authuser'}
    for form in parser.forms:
        if form['id'].lower() not in {'download-form', 'downloadform'} or form['method'] != 'get':
            continue
        candidate = _validate_url(urllib.parse.urljoin(current_url, form['action']), google_only=True)
        fields = {key: value for key, value in form['fields'].items() if key in allowed_fields}
        existing = urllib.parse.parse_qs(urllib.parse.urlsplit(candidate).query)
        for key, values in existing.items():
            if key in allowed_fields and key not in fields and values:
                fields[key] = values[0]
        if fields.get('id') != identifier or not fields.get('confirm') or any(len(value) > 2048 for value in fields.values()):
            raise ModelArtifactError('หน้ายืนยัน Google Drive ไม่ตรงกับไฟล์ที่ระบุ')
        fields.setdefault('export', 'download')
        parsed = urllib.parse.urlsplit(candidate)
        if parsed.path not in {'/download', '/uc'}:
            raise ModelArtifactError('ปลายทางยืนยัน Google Drive ไม่ใช่ช่องทางดาวน์โหลดที่รองรับ')
        return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urllib.parse.urlencode(fields), ''))
    for link in parser.links:
        candidate = urllib.parse.urljoin(current_url, link)
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(candidate).query)
        if query.get('confirm') and query.get('id', [None])[0] == identifier:
            selected = _validate_url(candidate, google_only=True)
            if urllib.parse.urlsplit(selected).path not in {'/download', '/uc'}:
                raise ModelArtifactError('ปลายทางยืนยัน Google Drive ไม่ใช่ช่องทางดาวน์โหลดที่รองรับ')
            return selected
    if jar is not None:
        for cookie in jar:
            if cookie.name.startswith('download_warning') and cookie.value and len(cookie.value) <= 2048:
                return 'https://drive.usercontent.google.com/download?' + urllib.parse.urlencode(
                    {'id': identifier, 'export': 'download', 'confirm': cookie.value})
    raise ModelArtifactError('ได้รับหน้าเว็บแทนไฟล์โมเดล ตรวจว่าลิงก์อนุญาตดาวน์โหลดโดยไม่ต้องเข้าสู่ระบบ และไม่มีหน้าอนุญาตสิทธิ์หรือ CAPTCHA')


def _download(url: str, destination: Path, *, opener, timeout: float, max_bytes: int, identifier: str | None, jar) -> tuple[str, int]:
    current = normalize_download_url(url)
    for attempt in range(4):
        request = urllib.request.Request(current, headers={'User-Agent': 'HelpMinths-model-artifact/1.0', 'Accept-Encoding': 'identity'})
        try:
            with opener.open(request, timeout=timeout) as response:
                final_url = _validate_url(response.geturl(), google_only=identifier is not None)
                final_id = _drive_id(final_url) if identifier else None
                if final_id is not None and final_id != identifier:
                    raise ModelArtifactError('ไฟล์ Google Drive ที่ตอบกลับไม่ตรงกับลิงก์ต้นทาง')
                status_code = getattr(response, 'status', 200)
                if status_code >= 400:
                    raise ModelArtifactError(f'แหล่งโมเดลตอบกลับ HTTP {status_code} กรุณาตรวจสิทธิ์และลิงก์ดาวน์โหลด')
                first = response.read(4096)
                if not isinstance(first, bytes):
                    raise ModelArtifactError('รูปแบบข้อมูลดาวน์โหลดไม่ถูกต้อง')
                content_type = response.headers.get('Content-Type', '').lower()
                is_html = 'text/html' in content_type or first.lstrip()[:256].lower().startswith((b'<!doctype html', b'<html', b'<form'))
                if is_html:
                    if identifier is None or attempt == 3:
                        raise ModelArtifactError('ได้รับหน้าเว็บแทนไฟล์โมเดล กรุณาใช้ลิงก์ดาวน์โหลดไฟล์ที่ไม่ต้องเข้าสู่ระบบ')
                    document = bytearray(first)
                    if len(document) > MAX_HTML_BYTES:
                        raise ModelArtifactError('หน้ายืนยันดาวน์โหลดมีขนาดเกินขอบเขต')
                    while True:
                        chunk = response.read(min(_CHUNK, MAX_HTML_BYTES + 1 - len(document)))
                        if not chunk:
                            break
                        document.extend(chunk)
                        if len(document) > MAX_HTML_BYTES:
                            raise ModelArtifactError('หน้ายืนยันดาวน์โหลดมีขนาดเกินขอบเขต')
                    current = _confirmation_url(document.decode('utf-8', errors='replace'), final_url, identifier, jar)
                    continue
                length = response.headers.get('Content-Length')
                expected = int(length) if length is not None and length.isdigit() else None
                if expected is not None and expected > max_bytes:
                    raise ModelArtifactError('ไฟล์ดาวน์โหลดเกินขนาดที่รองรับ')
                digest = hashlib.sha256()
                received = 0
                with destination.open('wb') as target:
                    chunk = first
                    while chunk:
                        received += len(chunk)
                        if received > max_bytes:
                            raise ModelArtifactError('ไฟล์ดาวน์โหลดเกินขนาดที่รองรับ')
                        digest.update(chunk)
                        target.write(chunk)
                        chunk = response.read(_CHUNK)
                    target.flush()
                    os.fsync(target.fileno())
                if not received or (expected is not None and expected != received):
                    raise ModelArtifactError('ดาวน์โหลดไฟล์ไม่ครบหรือได้รับไฟล์ว่าง')
                return digest.hexdigest(), received
        except ModelArtifactError:
            raise
        except urllib.error.HTTPError as exc:
            raise ModelArtifactError(f'ดาวน์โหลดโมเดลไม่ได้ (HTTP {exc.code}) ตรวจสิทธิ์และลิงก์ไฟล์ที่ไม่ต้องเข้าสู่ระบบ') from None
        except (urllib.error.URLError, OSError, TimeoutError, ValueError):
            raise ModelArtifactError('เชื่อมต่อหรือดาวน์โหลดแหล่งโมเดลไม่สำเร็จ กรุณาตรวจเครือข่ายและลิงก์ดาวน์โหลด') from None
    raise ModelArtifactError('Google Drive ขอการยืนยันดาวน์โหลดหลายครั้งเกินขอบเขต')


def _member_name(name: str) -> str:
    if not isinstance(name, str) or not name or '\\' in name or any(ord(char) < 32 for char in name):
        raise ModelArtifactError('ชื่อไฟล์ภายใน ZIP ไม่ปลอดภัย')
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or re.match(r'^[A-Za-z]:', name):
        raise ModelArtifactError('ชื่อไฟล์ภายใน ZIP ไม่ปลอดภัย')
    return path.as_posix().rstrip('/')


def _archive_members(archive: ZipFile) -> list[ZipInfo]:
    members = archive.infolist()
    if len(members) > MAX_ARCHIVE_MEMBERS:
        raise ModelArtifactError('ZIP มีจำนวนไฟล์เกินขอบเขต')
    seen = set()
    for item in members:
        normalized = _member_name(item.filename)
        if normalized in seen:
            raise ModelArtifactError('ZIP มีชื่อไฟล์ซ้ำหรือกำกวม')
        seen.add(normalized)
        kind = stat.S_IFMT(item.external_attr >> 16)
        if kind not in (0, stat.S_IFREG, stat.S_IFDIR):
            raise ModelArtifactError('ZIP มีลิงก์หรือชนิดไฟล์พิเศษที่ไม่รองรับ')
    return members


def _check_selected(info: ZipInfo, *, allow_empty: bool = False):
    if info.is_dir() or info.flag_bits & 1 or not (0 if allow_empty else 1) <= info.file_size <= MAX_MODEL_BYTES:
        raise ModelArtifactError('ไฟล์โมเดลว่าง เข้ารหัส หรือใหญ่เกินขอบเขต')
    if info.file_size / max(1, info.compress_size) > MAX_COMPRESSION_RATIO:
        raise ModelArtifactError('อัตราการบีบอัดไฟล์โมเดลเกินขอบเขต')


def select_checkpoint(archive: ZipFile, archive_member: str | None = None) -> ZipInfo:
    """Select a unique best checkpoint; never guess among multiple training runs."""
    members = _archive_members(archive)
    candidates = [item for item in members if not item.is_dir() and _member_name(item.filename).lower().endswith('.pt')]
    if archive_member is not None:
        selected_name = _member_name(archive_member)
        selected = [item for item in candidates if _member_name(item.filename) == selected_name]
        if len(selected) != 1:
            raise ModelArtifactError('ไม่พบไฟล์โมเดลที่กำหนดใน ZIP')
    else:
        preferred = [item for item in candidates if PurePosixPath(item.filename).parent.name.lower() == 'weights'
                     and PurePosixPath(item.filename).name.lower() == 'best.pt']
        best = [item for item in candidates if PurePosixPath(item.filename).name.lower() == 'best.pt']
        selected = preferred or best or candidates
        if len(selected) != 1:
            if not selected:
                raise ModelArtifactError('ไม่พบ checkpoint .pt ภายใน ZIP')
            raise ModelArtifactError('พบโมเดลหลายไฟล์ใน ZIP กรุณากำหนด HELPMINTHS_MODEL_ARCHIVE_MEMBER ให้ตรงกับไฟล์ที่ต้องการ')
    _check_selected(selected[0])
    return selected[0]


def _inspect_checkpoint(path: Path):
    if not 0 < path.stat().st_size <= MAX_MODEL_BYTES:
        raise ModelArtifactError('ไฟล์โมเดลว่างหรือใหญ่เกินขอบเขต')
    with ZipFile(path) as checkpoint:
        members = _archive_members(checkpoint)
        names = [_member_name(item.filename) for item in members if not item.is_dir()]
        headers = [name for name in names if name == 'data.pkl' or name.endswith('/data.pkl')]
        if len(headers) != 1:
            raise ModelArtifactError('ไฟล์ที่เลือกไม่ใช่โครงสร้าง checkpoint PyTorch ZIP ที่รองรับ')
        prefix = headers[0][:-len('data.pkl')]
        if not any(name.startswith(prefix + 'data/') for name in names):
            raise ModelArtifactError('checkpoint ไม่มี tensor data ที่จำเป็น')
        if sum(item.file_size for item in members) > MAX_MODEL_BYTES:
            raise ModelArtifactError('เนื้อหา checkpoint ที่คลายแล้วใหญ่เกินขอบเขต')
        for item in members:
            if item.is_dir():
                continue
            relative = _member_name(item.filename)[len(prefix):]
            _check_selected(item, allow_empty=relative.startswith('data/'))
            # Read to EOF for CRC/truncation checks, without unpickling any data.
            with checkpoint.open(item) as source:
                while source.read(_CHUNK):
                    pass


def _temporary(parent: Path, suffix: str) -> Path:
    descriptor, name = tempfile.mkstemp(prefix='.helpminths-model-', suffix=suffix, dir=parent)
    os.close(descriptor)
    return Path(name)


def _discard(path: Path):
    """Do not hide a sanitized primary error with a cleanup-only traceback."""
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def _publish(model_tmp: Path, output: Path, provenance: dict):
    manifest = output.with_suffix('.provenance.json')
    if any(path.is_symlink() or (path.exists() and not path.is_file()) for path in (output, manifest)):
        raise ModelArtifactError('ปลายทางโมเดลหรือข้อมูลแหล่งที่มาไม่ใช่ไฟล์ปกติ')
    temporary = _temporary(output.parent, '.json')
    backups = {}
    changed = False
    rollback_failed = False
    try:
        temporary.write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        for path in (output, manifest):
            if path.exists():
                backup = _temporary(output.parent, '.backup')
                shutil.copy2(path, backup)
                backups[path] = backup
        os.replace(model_tmp, output)
        changed = True
        os.replace(temporary, manifest)
    except OSError:
        if changed:
            for path in (output, manifest):
                try:
                    if path in backups:
                        os.replace(backups[path], path)
                    else:
                        path.unlink(missing_ok=True)
                except OSError:
                    rollback_failed = True
        if rollback_failed:
            raise ModelArtifactError('บันทึกโมเดลไม่สำเร็จและคืนไฟล์เดิมไม่ครบ จึงเก็บสำเนาสำรองไว้ในโฟลเดอร์โมเดลให้ผู้ดูแลตรวจสอบ') from None
        raise ModelArtifactError('บันทึกโมเดลหรือข้อมูลแหล่งที่มาไม่สำเร็จ') from None
    finally:
        _discard(temporary)
        if not rollback_failed:
            for backup in backups.values():
                _discard(backup)


def install_model(url: str, output: str | Path, *, archive_member: str | None = None,
                  sha256: str | None = None, opener=None, timeout: float = 30,
                  max_download_bytes: int = MAX_DOWNLOAD_BYTES) -> dict:
    """Fetch, select, validate and atomically install one model with provenance."""
    original = _validate_url(url)
    identifier = _drive_id(original)
    expected = _validate_sha256(sha256)
    if archive_member is not None:
        _member_name(archive_member)
    if type(max_download_bytes) is not int or not 0 < max_download_bytes <= MAX_DOWNLOAD_BYTES:
        raise ModelArtifactError('ขนาดไฟล์ดาวน์โหลดสูงสุดไม่ถูกต้อง')
    if type(timeout) not in (int, float) or not 0 < timeout <= 300:
        raise ModelArtifactError('ระยะเวลาดาวน์โหลดไม่ถูกต้อง')
    target = Path(output)
    artifact = selected_file = None
    jar = None
    if opener is None:
        jar = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(_SafeRedirect(identifier is not None, identifier), urllib.request.HTTPCookieProcessor(jar))
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        artifact = _temporary(target.parent, '.download')
        selected_file = _temporary(target.parent, '.pt')
        artifact_sha, artifact_size = _download(original, artifact, opener=opener, timeout=timeout,
                                                 max_bytes=max_download_bytes, identifier=identifier, jar=jar)
        selected_member = None
        with ZipFile(artifact) as archive:
            members = _archive_members(archive)
            if any(not item.is_dir() and item.filename.lower().endswith('.pt') for item in members):
                chosen = select_checkpoint(archive, archive_member)
                selected_member = chosen.filename
                with archive.open(chosen) as source, selected_file.open('wb') as destination:
                    count = 0
                    while chunk := source.read(_CHUNK):
                        count += len(chunk)
                        if count > MAX_MODEL_BYTES:
                            raise ModelArtifactError('ไฟล์โมเดลที่คลายแล้วใหญ่เกินขอบเขต')
                        destination.write(chunk)
                if count != chosen.file_size:
                    raise ModelArtifactError('ไฟล์โมเดลใน ZIP ไม่ครบ')
            else:
                if archive_member is not None:
                    raise ModelArtifactError('กำหนดไฟล์ใน archive แต่ข้อมูลที่ได้รับไม่มี checkpoint .pt ภายใน')
                shutil.copyfile(artifact, selected_file)
        _inspect_checkpoint(selected_file)
        with selected_file.open('rb') as checkpoint:
            model_sha = hashlib.file_digest(checkpoint, 'sha256').hexdigest()
        if expected is not None and model_sha != expected:
            raise ModelArtifactError('SHA-256 ของโมเดลไม่ตรงกับค่าที่กำหนด จึงไม่แทนที่โมเดลเดิม')
        provenance = {'schema_version': 1, 'source_host': urllib.parse.urlsplit(original).hostname,
                      'source_file_id': identifier, 'artifact_sha256': artifact_sha, 'model_sha256': model_sha,
                      'selected_member': selected_member, 'artifact_bytes': artifact_size,
                      'model_bytes': selected_file.stat().st_size,
                      'fetched_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
                      'validation': 'checkpoint_container_only; inference_and_accuracy_not_verified'}
        _publish(selected_file, target, provenance)
        return provenance
    except ModelArtifactError:
        raise
    except (BadZipFile, OSError, RuntimeError, EOFError):
        raise ModelArtifactError('ไฟล์ดาวน์โหลดหรือ ZIP เสีย ไม่ครบ หรือเป็น checkpoint ที่ไม่รองรับ จึงไม่แทนที่โมเดลเดิม') from None
    finally:
        if artifact is not None:
            _discard(artifact)
        if selected_file is not None:
            _discard(selected_file)


def _validate_sha256(value: str | None) -> str | None:
    if value is None or value == '':
        return None
    if not isinstance(value, str) or re.fullmatch(r'[0-9a-fA-F]{64}', value) is None:
        raise ModelArtifactError('SHA-256 ต้องมีเลขฐานสิบหก 64 ตัว')
    return value.lower()


def load_source_config(path: str | Path | None = None, *, url=None, archive_member=None,
                       sha256=None, environ: Mapping[str, str] | None = None) -> dict:
    config = {}
    if path is not None:
        selected = Path(path)
        try:
            if selected.is_symlink() or selected.stat().st_size > 64 * 1024:
                raise ValueError
            config = json.loads(selected.read_text(encoding='utf-8'))
            if not isinstance(config, dict) or set(config) - {'url', 'archive_member', 'sha256'}:
                raise ValueError
        except (OSError, ValueError, TypeError):
            raise ModelArtifactError('อ่าน configuration แหล่งโมเดลไม่สำเร็จ') from None
    environment = os.environ if environ is None else environ
    values = {}
    for key, explicit in (('url', url), ('archive_member', archive_member), ('sha256', sha256)):
        env_key = {'url': 'HELPMINTHS_MODEL_URL', 'archive_member': 'HELPMINTHS_MODEL_ARCHIVE_MEMBER', 'sha256': 'HELPMINTHS_MODEL_SHA256'}[key]
        value = explicit if explicit not in (None, '') else environment.get(env_key) or config.get(key)
        if value is not None and not isinstance(value, str):
            raise ModelArtifactError('ค่า configuration แหล่งโมเดลไม่ถูกต้อง')
        values[key] = value.strip() if isinstance(value, str) else None
    if not values['url']:
        raise ModelArtifactError('ยังไม่ได้ระบุลิงก์แหล่งโมเดล')
    values['url'] = _validate_url(values['url'])
    values['archive_member'] = _member_name(values['archive_member']) if values['archive_member'] else None
    values['sha256'] = _validate_sha256(values['sha256'])
    return values


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--url')
    parser.add_argument('--archive-member')
    parser.add_argument('--sha256')
    args = parser.parse_args()
    try:
        config = load_source_config(args.config, url=args.url, archive_member=args.archive_member, sha256=args.sha256)
        result = install_model(output=args.output, **config)
    except ModelArtifactError as exc:
        parser.exit(1, f'ติดตั้งโมเดลไม่สำเร็จ: {exc}\n')
    print(json.dumps({key: result[key] for key in ('model_sha256', 'model_bytes', 'selected_member')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
