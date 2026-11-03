"""Model path precedence using isolated stubs, never real or clinical weights."""
from __future__ import annotations

import builtins
import hashlib
import sys
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend import model
from backend.main import create_app


@pytest.fixture
def model_repository(tmp_path, monkeypatch):
    """Simulate an installed repository without placing weights in the app."""
    repository = tmp_path / 'synthetic-repository'
    backend_dir = repository / 'backend'
    backend_dir.mkdir(parents=True)
    monkeypatch.setattr(model, '__file__', str(backend_dir / 'model.py'))
    monkeypatch.delenv('HELPMINTHS_MODEL_PATH', raising=False)
    return repository


@pytest.fixture
def runtime_stub(monkeypatch):
    calls = []

    def load(path, *, task):
        calls.append((path, task))
        return SimpleNamespace(task='detect')

    monkeypatch.setitem(sys.modules, 'ultralytics', SimpleNamespace(YOLO=load))
    return calls


def checkpoint(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b'SYNTHETIC path-selection fixture; not trained model weights')
    return path


def test_named_checkpoint_loads_from_repository_independent_of_launch_directory(model_repository, tmp_path, monkeypatch, runtime_stub):
    named = checkpoint(model_repository / 'models' / 'parasite_yolo.pt')
    unrelated = tmp_path / 'unrelated-launch-directory'
    unrelated.mkdir()
    monkeypatch.chdir(unrelated)

    service = model.YOLOModelService()
    service.load()

    assert runtime_stub == [(str(named), 'detect')]
    assert service.ready is True
    assert service.name == 'parasite_yolo.pt'
    assert service.metadata['sha256'] == hashlib.sha256(named.read_bytes()).hexdigest()
    assert service.version == service.metadata['sha256'][:16]
    assert service.metadata['evaluation_metrics'] is None


def test_environment_path_overrides_named_checkpoint(model_repository, tmp_path, monkeypatch, runtime_stub):
    checkpoint(model_repository / 'models' / 'parasite_yolo.pt')
    configured = checkpoint(tmp_path / 'operator' / 'approved-detection.pt')
    monkeypatch.setenv('HELPMINTHS_MODEL_PATH', str(configured))

    service = model.YOLOModelService()
    service.load()

    assert runtime_stub == [(str(configured), 'detect')]
    assert service.name == configured.name


def test_argument_path_overrides_environment_and_named_checkpoint(model_repository, tmp_path, monkeypatch, runtime_stub):
    checkpoint(model_repository / 'models' / 'parasite_yolo.pt')
    configured = checkpoint(tmp_path / 'operator' / 'environment.pt')
    explicit = checkpoint(tmp_path / 'explicit' / 'selected.pt')
    monkeypatch.setenv('HELPMINTHS_MODEL_PATH', str(configured))

    service = model.YOLOModelService(model_path=str(explicit))
    service.load()

    assert runtime_stub == [(str(explicit), 'detect')]
    assert service.name == explicit.name


def test_explicit_blank_disables_loading_despite_available_named_and_environment_models(model_repository, tmp_path, monkeypatch, runtime_stub):
    checkpoint(model_repository / 'models' / 'parasite_yolo.pt')
    configured = checkpoint(tmp_path / 'operator' / 'environment.pt')
    monkeypatch.setenv('HELPMINTHS_MODEL_PATH', str(configured))

    with TestClient(create_app(model.YOLOModelService(model_path=''))) as client:
        health = client.get('/api/health').json()

    assert runtime_stub == []
    assert health['model_ready'] is False
    assert health['model_name'] is None
    assert 'HELPMINTHS_MODEL_PATH' in health['message']


def test_invalid_configured_path_does_not_silently_fall_back(model_repository, tmp_path, monkeypatch, runtime_stub):
    checkpoint(model_repository / 'models' / 'parasite_yolo.pt')
    monkeypatch.setenv('HELPMINTHS_MODEL_PATH', str(tmp_path / 'missing' / 'operator-model.pt'))

    service = model.YOLOModelService()
    service.load()

    assert runtime_stub == []
    assert service.ready is False
    assert service.name is None
    assert service.metadata is None


@pytest.mark.parametrize('environment', [None, '', '   '])
def test_missing_named_checkpoint_stays_unconfigured_without_importing_yolo(model_repository, monkeypatch, environment):
    if environment is not None:
        monkeypatch.setenv('HELPMINTHS_MODEL_PATH', environment)
    original_import = builtins.__import__

    def guarded_import(name, *args, **kwargs):
        assert name != 'ultralytics', 'Missing weights must not invoke the model runtime or trigger downloads'
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, '__import__', guarded_import)
    with TestClient(create_app(model.YOLOModelService())) as client:
        health = client.get('/api/health').json()

    assert health['model_ready'] is False
    assert health['model_name'] is None
    assert 'HELPMINTHS_MODEL_PATH' in health['message']
