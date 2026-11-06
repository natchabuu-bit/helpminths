"""Artifact transport/selection tests, not model inference or clinical evidence.

All checkpoint-shaped archives below are tiny synthetic containers. Their pickle
payloads contain primitive dictionaries and are never deserialized by these tests.
No Google service is contacted; the fake opener exercises its download protocol.
"""
from __future__ import annotations

import hashlib
import io
import json
import pickle
import stat
import sys
from email.message import Message
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile, ZipInfo

import pytest

from backend import model_artifact as artifacts


FILE_ID = 'SYNTHETIC_TEST_FILE_1234567890'
VIEW_URL = f'https://drive.google.com/file/d/{FILE_ID}/view?usp=sharing'


def checkpoint_bytes(*, marker=b'SYNTHETIC MODEL STORAGE', padding=0) -> bytes:
    stream = io.BytesIO()
    with ZipFile(stream, 'w', compression=ZIP_STORED) as archive:
        archive.writestr('best/data.pkl', pickle.dumps({'model': 'SYNTHETIC FORMAT FIXTURE ONLY'}, protocol=2))
        archive.writestr('best/data/0', marker + b'\x00' * padding)
        archive.writestr('best/version', b'3\n')
        archive.writestr('best/byteorder', b'little')
    return stream.getvalue()


def archive_bytes(members: dict[str, bytes], *, compression=ZIP_STORED) -> bytes:
    stream = io.BytesIO()
    with ZipFile(stream, 'w', compression=compression) as archive:
        for name, payload in members.items():
            archive.writestr(name, payload)
    return stream.getvalue()


class Response(io.BytesIO):
    def __init__(self, body: bytes, *, content_type='application/octet-stream', url=None, status=200, content_length=None):
        super().__init__(body)
        self.url = url
        self.status = status
        self.headers = Message()
        self.headers['Content-Type'] = content_type
        self.headers['Content-Length'] = str(len(body) if content_length is None else content_length)

    def geturl(self):
        return self.url


class Opener:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests = []

    def open(self, request, *, timeout):
        self.requests.append(request)
        assert timeout > 0
        if not self.responses:
            raise AssertionError('Unexpected extra download request')
        result = self.responses.pop(0)
        if isinstance(result, Exception):
            raise result
        result.url = result.url or request.full_url
        return result


def installed(tmp_path, payload, **kwargs):
    path = tmp_path / 'models' / 'parasite_yolo.pt'
    result = artifacts.install_model(VIEW_URL, path, opener=Opener(Response(payload)), **kwargs)
    return path, result


def test_drive_view_url_normalizes_to_the_same_download_file():
    normalized = artifacts.normalize_download_url(VIEW_URL)
    parsed = urlsplit(normalized)
    assert parsed.scheme == 'https'
    assert parsed.hostname in {'drive.google.com', 'drive.usercontent.google.com'}
    assert parse_qs(parsed.query)['id'] == [FILE_ID]
    assert parse_qs(parsed.query)['export'] == ['download']


@pytest.mark.parametrize('url', [
    'http://drive.google.com/uc?id=bad',
    'file:///private/checkpoint.pt',
    'ftp://example.com/checkpoint.pt',
    f'https://username:password@drive.google.com/file/d/{FILE_ID}/view',
    'https://127.0.0.1/checkpoint.pt',
    'https://localhost/checkpoint.pt',
])
def test_non_https_and_credential_urls_fail_before_network(tmp_path, url):
    opener = Opener()
    with pytest.raises(artifacts.ModelArtifactError):
        artifacts.install_model(url, tmp_path / 'model.pt', opener=opener)
    assert not opener.requests


def test_direct_checkpoint_is_installed_with_auditable_sanitized_provenance(tmp_path):
    payload = checkpoint_bytes()
    path, provenance = installed(tmp_path, payload, sha256=hashlib.sha256(payload).hexdigest())
    assert path.read_bytes() == payload
    assert provenance['selected_member'] is None
    assert provenance['model_sha256'] == hashlib.sha256(payload).hexdigest()
    assert provenance['artifact_sha256'] == hashlib.sha256(payload).hexdigest()
    assert provenance['artifact_bytes'] == provenance['model_bytes'] == len(payload)
    assert provenance['source_file_id'] == FILE_ID
    assert provenance['source_host'] in {'drive.google.com', 'drive.usercontent.google.com'}
    assert provenance['fetched_at']
    assert json.loads(path.with_suffix('.provenance.json').read_text()) == provenance
    assert not {'url', 'source_url', 'download_url', 'local_path'} & provenance.keys()


def test_checkpoint_can_contain_an_empty_internal_tensor_storage(tmp_path):
    payload = checkpoint_bytes(marker=b'')
    path, provenance = installed(tmp_path, payload)
    assert path.read_bytes() == payload
    assert provenance['model_sha256'] == hashlib.sha256(payload).hexdigest()


def test_unique_weights_best_wins_over_last_and_unrelated_code_is_not_executed_or_extracted(tmp_path):
    best, last = checkpoint_bytes(marker=b'BEST'), checkpoint_bytes(marker=b'LAST')
    payload = archive_bytes({'run/weights/best.pt': best, 'run/weights/last.pt': last,
                             'run/evaluation.py': b'raise RuntimeError("MUST NEVER RUN")',
                             'run/results.csv': b'epoch,metric\n1,.5\n'})
    path, provenance = installed(tmp_path, payload)
    assert path.read_bytes() == best
    assert provenance['selected_member'] == 'run/weights/best.pt'
    assert provenance['model_sha256'] == hashlib.sha256(best).hexdigest()
    assert provenance['artifact_sha256'] == hashlib.sha256(payload).hexdigest()
    assert sorted(p.name for p in path.parent.iterdir()) == ['parasite_yolo.provenance.json', 'parasite_yolo.pt']
    assert not (tmp_path / 'evaluation.py').exists()


def test_multiple_best_models_require_explicit_selection_and_never_pick_a_first_model(tmp_path):
    first, second = checkpoint_bytes(marker=b'FIRST'), checkpoint_bytes(marker=b'SECOND')
    payload = archive_bytes({'run1/weights/best.pt': first, 'run2/weights/best.pt': second})
    with pytest.raises(artifacts.ModelArtifactError):
        installed(tmp_path, payload)
    assert not (tmp_path / 'models' / 'parasite_yolo.pt').exists()
    path, provenance = installed(tmp_path, payload, archive_member='run2/weights/best.pt')
    assert path.read_bytes() == second
    assert provenance['selected_member'] == 'run2/weights/best.pt'


def test_a_directory_name_ending_in_weights_is_not_the_preferred_weights_directory(tmp_path):
    payload = archive_bytes({'notweights/best.pt': checkpoint_bytes(marker=b'FIRST'),
                             'other/best.pt': checkpoint_bytes(marker=b'SECOND')})
    with pytest.raises(artifacts.ModelArtifactError):
        installed(tmp_path, payload)


def test_an_actual_weights_directory_is_preferred_over_a_loose_best_checkpoint(tmp_path):
    best = checkpoint_bytes(marker=b'PREFERRED')
    path, provenance = installed(tmp_path, archive_bytes({'run/weights/best.pt': best,
                                                        'notweights/best.pt': checkpoint_bytes(marker=b'OTHER')}))
    assert path.read_bytes() == best
    assert provenance['selected_member'] == 'run/weights/best.pt'


def test_multiple_non_best_checkpoints_do_not_fall_back_to_last(tmp_path):
    payload = archive_bytes({'weights/last.pt': checkpoint_bytes(marker=b'LAST'),
                             'weights/epoch10.pt': checkpoint_bytes(marker=b'EPOCH')})
    with pytest.raises(artifacts.ModelArtifactError):
        installed(tmp_path, payload)


def test_single_non_best_checkpoint_can_be_selected_unambiguously(tmp_path):
    model = checkpoint_bytes()
    path, provenance = installed(tmp_path, archive_bytes({'trained/parasite_yolo.pt': model}))
    assert path.read_bytes() == model
    assert provenance['selected_member'] == 'trained/parasite_yolo.pt'


@pytest.mark.parametrize('member', ['../weights/best.pt', '/weights/best.pt', 'run/../../best.pt'])
def test_unsafe_model_paths_are_rejected(tmp_path, member):
    payload = archive_bytes({member: checkpoint_bytes()})
    with pytest.raises(artifacts.ModelArtifactError):
        installed(tmp_path, payload, archive_member=member)
    assert not (tmp_path / 'models' / 'parasite_yolo.pt').exists()


def test_symlink_checkpoint_is_rejected(tmp_path):
    stream = io.BytesIO()
    with ZipFile(stream, 'w') as archive:
        entry = ZipInfo('run/weights/best.pt')
        entry.create_system = 3
        entry.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive.writestr(entry, '../elsewhere.pt')
    with pytest.raises(artifacts.ModelArtifactError):
        installed(tmp_path, stream.getvalue())


@pytest.mark.parametrize('payload', [b'', b'not a checkpoint', b'PK\x03\x04truncated', archive_bytes({'best.pt': b'not a model'})])
def test_empty_malformed_and_non_checkpoint_payloads_do_not_create_a_model(tmp_path, payload):
    with pytest.raises(artifacts.ModelArtifactError):
        installed(tmp_path, payload)
    assert not (tmp_path / 'models' / 'parasite_yolo.pt').exists()


def test_sha256_mismatch_preserves_previous_model_and_provenance(tmp_path):
    path = tmp_path / 'models' / 'parasite_yolo.pt'
    path.parent.mkdir()
    path.write_bytes(b'PREVIOUS APPROVED MODEL')
    manifest = path.with_suffix('.provenance.json')
    manifest.write_text('{"previous": true}')
    before = {entry.name: entry.read_bytes() for entry in path.parent.iterdir()}
    with pytest.raises(artifacts.ModelArtifactError):
        artifacts.install_model(VIEW_URL, path, sha256='0' * 64, opener=Opener(Response(checkpoint_bytes())))
    assert {entry.name: entry.read_bytes() for entry in path.parent.iterdir()} == before


def test_output_directory_failure_is_sanitized_without_network(tmp_path, monkeypatch):
    private = tmp_path / 'PRIVATE_OUTPUT_PATH' / 'model.pt'
    opener = Opener()

    def denied(*args, **kwargs):
        raise PermissionError(f'PRIVATE_FILESYSTEM_DETAILS: {private}')

    with monkeypatch.context() as patch:
        patch.setattr(Path, 'mkdir', denied)
        with pytest.raises(artifacts.ModelArtifactError) as caught:
            artifacts.install_model(VIEW_URL, private, opener=opener)
    assert str(private) not in str(caught.value) and 'PRIVATE_FILESYSTEM_DETAILS' not in str(caught.value)
    assert opener.requests == []


def test_second_temporary_file_failure_preserves_model_and_cleans_first_temporary(tmp_path, monkeypatch):
    path = tmp_path / 'models' / 'model.pt'
    path.parent.mkdir()
    path.write_bytes(b'PREVIOUS MODEL')
    opener = Opener()
    mkstemp = artifacts.tempfile.mkstemp
    calls = 0

    def fail_second(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError(f'PRIVATE_TEMPORARY_DETAILS: {path}')
        return mkstemp(*args, **kwargs)

    monkeypatch.setattr(artifacts.tempfile, 'mkstemp', fail_second)
    with pytest.raises(artifacts.ModelArtifactError) as caught:
        artifacts.install_model(VIEW_URL, path, opener=opener)
    assert str(path) not in str(caught.value) and 'PRIVATE_TEMPORARY_DETAILS' not in str(caught.value)
    assert path.read_bytes() == b'PREVIOUS MODEL'
    assert [entry.name for entry in path.parent.iterdir()] == ['model.pt']
    assert opener.requests == []


@pytest.mark.parametrize('header_length', [True, False])
def test_download_limit_is_enforced_with_or_without_a_trustworthy_size_header(tmp_path, header_length):
    payload = checkpoint_bytes()
    response = Response(payload, content_length=len(payload) if header_length else 0)
    with pytest.raises(artifacts.ModelArtifactError):
        artifacts.install_model(VIEW_URL, tmp_path / 'model.pt', opener=Opener(response), max_download_bytes=64)
    assert not (tmp_path / 'model.pt').exists()


def test_truncated_transfer_with_a_larger_content_length_is_rejected(tmp_path):
    payload = checkpoint_bytes()
    response = Response(payload, content_length=len(payload) + 10)
    with pytest.raises(artifacts.ModelArtifactError):
        artifacts.install_model(VIEW_URL, tmp_path / 'model.pt', opener=Opener(response))
    assert not (tmp_path / 'model.pt').exists()


def test_high_compression_selected_payload_is_rejected_before_install(tmp_path):
    payload = archive_bytes({'weights/best.pt': b'0' * 100000}, compression=ZIP_DEFLATED)
    with pytest.raises(artifacts.ModelArtifactError):
        installed(tmp_path, payload)
    assert not (tmp_path / 'models' / 'parasite_yolo.pt').exists()


def test_model_size_cap_and_archive_member_cap_are_enforced(tmp_path, monkeypatch):
    monkeypatch.setattr(artifacts, 'MAX_MODEL_BYTES', 64)
    with pytest.raises(artifacts.ModelArtifactError):
        installed(tmp_path, checkpoint_bytes())
    monkeypatch.setattr(artifacts, 'MAX_MODEL_BYTES', 256 * 1024 * 1024)
    monkeypatch.setattr(artifacts, 'MAX_ARCHIVE_MEMBERS', 2)
    payload = archive_bytes({'weights/best.pt': checkpoint_bytes(), 'plot.png': b'plot', 'results.csv': b'csv'})
    with pytest.raises(artifacts.ModelArtifactError):
        installed(tmp_path, payload)
    assert not (tmp_path / 'models' / 'parasite_yolo.pt').exists()


def test_drive_response_redirect_to_foreign_host_is_rejected(tmp_path):
    opener = Opener(Response(checkpoint_bytes(), url='https://foreign.example/model.pt'))
    with pytest.raises(artifacts.ModelArtifactError):
        artifacts.install_model(VIEW_URL, tmp_path / 'model.pt', opener=opener)
    assert not (tmp_path / 'model.pt').exists()


def test_google_download_confirmation_form_preserves_file_id_and_hidden_nonce(tmp_path):
    html = f'''<!doctype html><form id="download-form" action="https://drive.usercontent.google.com/download" method="get">
      <input type="hidden" name="id" value="{FILE_ID}">
      <input type="hidden" name="export" value="download">
      <input type="hidden" name="confirm" value="t">
      <input type="hidden" name="uuid" value="SYNTHETIC-NONCE"></form>'''.encode()
    payload = checkpoint_bytes()
    opener = Opener(Response(html, content_type='text/html'), Response(payload))
    path = tmp_path / 'model.pt'
    artifacts.install_model(VIEW_URL, path, opener=opener)
    assert path.read_bytes() == payload
    assert len(opener.requests) == 2
    confirmation = parse_qs(urlsplit(opener.requests[1].full_url).query)
    assert confirmation['id'] == [FILE_ID]
    assert confirmation['confirm'] == ['t']
    assert confirmation['uuid'] == ['SYNTHETIC-NONCE']


def test_legacy_google_confirmation_link_is_followed_for_same_file_only(tmp_path):
    html = f'<html><a href="/uc?export=download&amp;confirm=SYNTHETIC&amp;id={FILE_ID}">Download</a></html>'.encode()
    payload = checkpoint_bytes()
    opener = Opener(Response(html, content_type='text/html', url=f'https://drive.google.com/uc?id={FILE_ID}'), Response(payload))
    path = tmp_path / 'model.pt'
    artifacts.install_model(VIEW_URL, path, opener=opener)
    assert path.read_bytes() == payload
    assert len(opener.requests) == 2


@pytest.mark.parametrize('html', [
    b'<html><form action="https://accounts.google.com/ServiceLogin">Sign in</form></html>',
    f'<html><form id="download-form" action="https://evil.example/download"><input name="id" value="{FILE_ID}"></form></html>'.encode(),
    b'<html><form id="download-form" action="https://drive.usercontent.google.com/download"><input name="id" value="OTHER_FILE"><input name="confirm" value="t"></form></html>',
])
def test_login_or_foreign_confirmation_pages_are_not_treated_as_models(tmp_path, html):
    opener = Opener(Response(html, content_type='text/html'))
    with pytest.raises(artifacts.ModelArtifactError):
        artifacts.install_model(VIEW_URL, tmp_path / 'model.pt', opener=opener)
    assert len(opener.requests) == 1
    assert not (tmp_path / 'model.pt').exists()


def test_http_failure_does_not_expose_signed_url_or_private_output_path(tmp_path):
    secret = 'PRIVATE_SIGNED_TOKEN'
    url = f'https://drive.google.com/uc?export=download&id={FILE_ID}&token={secret}'
    private = tmp_path / 'PRIVATE_BUILD_PATH' / 'model.pt'
    opener = Opener(HTTPError(url, 403, secret, {}, None))
    with pytest.raises(artifacts.ModelArtifactError) as caught:
        artifacts.install_model(url, private, opener=opener)
    message = str(caught.value)
    assert secret not in message and str(private) not in message
    assert '403' in message


def test_config_precedence_is_cli_then_environment_then_json(tmp_path):
    config_path = tmp_path / 'source.json'
    config_path.write_text(json.dumps({'url': VIEW_URL, 'archive_member': 'config/best.pt', 'sha256': 'a' * 64}))
    env = {'HELPMINTHS_MODEL_ARCHIVE_MEMBER': 'environment/best.pt', 'HELPMINTHS_MODEL_SHA256': 'b' * 64}
    config = artifacts.load_source_config(config_path, archive_member='cli/best.pt', environ=env)
    assert config['url'] == VIEW_URL
    assert config['archive_member'] == 'cli/best.pt'
    assert config['sha256'] == 'b' * 64
    fallback = artifacts.load_source_config(config_path, environ={})
    assert fallback['archive_member'] == 'config/best.pt' and fallback['sha256'] == 'a' * 64


def test_missing_url_and_invalid_hash_do_not_allow_an_implicit_old_model(tmp_path):
    source = tmp_path / 'source.json'
    source.write_text('{}')
    with pytest.raises(artifacts.ModelArtifactError):
        artifacts.load_source_config(source, environ={})
    source.write_text(json.dumps({'url': VIEW_URL, 'sha256': 'not-a-checksum'}))
    with pytest.raises(artifacts.ModelArtifactError):
        artifacts.load_source_config(source, environ={})


def test_cli_passes_config_and_explicit_selection_to_installer_and_prints_only_audit_summary(tmp_path, monkeypatch, capsys):
    source = tmp_path / 'source.json'
    source.write_text(json.dumps({'url': VIEW_URL, 'archive_member': 'config/best.pt'}))
    output = tmp_path / 'models' / 'parasite_yolo.pt'
    for key in ['HELPMINTHS_MODEL_URL', 'HELPMINTHS_MODEL_ARCHIVE_MEMBER', 'HELPMINTHS_MODEL_SHA256']:
        monkeypatch.delenv(key, raising=False)
    captured = {}

    def install(**kwargs):
        captured.update(kwargs)
        return {'model_sha256': 'f' * 64, 'model_bytes': 123, 'selected_member': 'chosen/best.pt'}

    monkeypatch.setattr(artifacts, 'install_model', install)
    monkeypatch.setattr(sys, 'argv', ['model_artifact', '--config', str(source), '--output', str(output), '--archive-member', 'chosen/best.pt'])
    artifacts.main()
    assert captured == {'url': VIEW_URL, 'output': output, 'archive_member': 'chosen/best.pt', 'sha256': None}
    printed = capsys.readouterr()
    assert json.loads(printed.out) == {'model_sha256': 'f' * 64, 'model_bytes': 123, 'selected_member': 'chosen/best.pt'}
    assert str(output) not in printed.out and VIEW_URL not in printed.out and not printed.err
