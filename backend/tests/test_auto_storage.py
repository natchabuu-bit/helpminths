"""Automatic private storage fixtures contain synthetic users and raster charts only."""
from __future__ import annotations

import io
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from backend.main import create_app
from backend.platform import config
from backend.platform.config import PlatformConfig
from backend.platform.store import PlatformStore

PASSWORD = "SYNTHETIC-auto-storage-password-2026!"
ORIGIN = {"Origin": "https://testserver"}


class SyntheticModel:
    """An explicit test chart predictor, never trained parasite inference."""
    ready = False
    name = "SYNTHETIC-AUTO-STORAGE-NOT-TRAINED.pt"
    version = "synthetic-auto-storage-fixture"
    metadata = {"name": name, "version": version, "test_fixture": True}
    message = "SYNTHETIC TEST ONLY"

    def load(self):
        self.ready = True

    def predict(self, image, confidence):
        return []


@pytest.fixture
def automatic(tmp_path, monkeypatch):
    directory = tmp_path / "automatic-private"
    monkeypatch.setattr(config, "DEFAULT_AUTO_STORAGE_DIR", directory)
    monkeypatch.setenv("HELPMINTHS_AUTO_STORAGE", "1")
    monkeypatch.delenv("HELPMINTHS_DATA_DIR", raising=False)
    monkeypatch.delenv("HELPMINTHS_STORAGE_DURABLE", raising=False)
    monkeypatch.delenv("HELPMINTHS_ADMIN_SETUP_TOKEN", raising=False)
    return directory


def test_auto_selection_is_opt_in_and_explicit_disable_wins(automatic, monkeypatch):
    selected = PlatformConfig.from_environment()
    assert selected.data_dir == automatic
    assert selected.automatic_storage is True
    assert selected.storage_durable is False
    assert not automatic.exists(), "Configuration selection itself does not write files"
    disabled = PlatformStore("")
    assert disabled.configured is False
    assert disabled.config.automatic_storage is False
    assert disabled.db_path is None
    monkeypatch.setenv("HELPMINTHS_AUTO_STORAGE", "0")
    assert PlatformConfig.from_environment().data_dir is None
    assert PlatformStore().configured is False
    monkeypatch.delenv("HELPMINTHS_AUTO_STORAGE")
    assert PlatformConfig.from_environment().data_dir is None


@pytest.mark.parametrize("value", ["0", "false", "invalid", ""])
def test_non_enabled_auto_values_do_not_create_private_storage(automatic, monkeypatch, value):
    monkeypatch.setenv("HELPMINTHS_AUTO_STORAGE", value)
    assert PlatformStore().configured is False
    assert not automatic.exists()


def test_blank_environment_path_uses_opted_in_default(automatic, monkeypatch):
    monkeypatch.setenv("HELPMINTHS_DATA_DIR", "   ")
    selected = PlatformConfig.from_environment()
    assert selected.data_dir == automatic
    assert selected.automatic_storage is True


def test_explicit_and_environment_paths_keep_priority_and_durability(automatic, tmp_path, monkeypatch):
    environment = tmp_path / "mounted-environment-volume"
    explicit = tmp_path / "explicit-operator-volume"
    monkeypatch.setenv("HELPMINTHS_DATA_DIR", str(environment))
    monkeypatch.setenv("HELPMINTHS_STORAGE_DURABLE", "1")
    configured = PlatformConfig.from_environment()
    assert configured.data_dir == environment
    assert configured.automatic_storage is False
    assert configured.storage_durable is True
    configured = PlatformConfig.from_environment(explicit)
    assert configured.data_dir == explicit
    assert configured.automatic_storage is False
    assert configured.storage_durable is True
    assert not automatic.exists()


@pytest.mark.parametrize("declaration", ["1", "true", "yes"])
def test_auto_filesystem_never_claims_durable_from_a_stale_flag(automatic, monkeypatch, declaration):
    monkeypatch.setenv("HELPMINTHS_STORAGE_DURABLE", declaration)
    store = PlatformStore()
    assert store.configured is True
    assert store.config.automatic_storage is True
    assert store.config.storage_durable is False


def test_auto_store_creates_private_schema_without_accounts_or_records(automatic):
    store = PlatformStore()
    assert store.data_dir == automatic.resolve()
    assert store.db_path.is_file() and store.image_dir.is_dir()
    assert os.stat(store.data_dir).st_mode & 0o777 == 0o700
    assert os.stat(store.image_dir).st_mode & 0o777 == 0o700
    assert os.stat(store.db_path).st_mode & 0o777 == 0o600
    with store.connection() as connection:
        assert connection.execute("SELECT count(*) FROM users").fetchone()[0] == 0
        assert connection.execute("SELECT count(*) FROM documents").fetchone()[0] == 0
        assert connection.execute("SELECT count(*) FROM sessions").fetchone()[0] == 0
    assert store.has_users() is False


def test_reopening_the_same_private_files_retains_real_signup_login_and_owned_results(automatic):
    app = create_app(SyntheticModel())
    with TestClient(app, base_url="https://testserver") as owner:
        session = owner.get("/api/platform/session").json()
        assert session["configured"] is True
        assert session["registration_enabled"] is True
        assert session["user"] is None
        status = owner.get("/api/platform/status").json()
        assert status["configured"] is True and status["authentication"] == "ready"
        assert status["administrator_setup_pending"] is True
        assert status["storage"]["mode"] == "temporary"
        assert status["storage"]["automatic"] is True and status["storage"]["durable"] is False
        response = owner.post("/api/platform/register", json={"username": "synthetic_owner", "password": PASSWORD}, headers=ORIGIN)
        assert response.status_code == 201, response.text
        account = response.json()
        assert account["user"]["role"] == "lab"
        assert account["expert_verified_until"] is None
        assert account["user"]["approval_status"] == "pending" and account["csrf_token"] is None
        assert owner.get("/api/platform/analyses?scope=mine").status_code == 401
        store = app.state.platform_store
        operator = store.create_user("synthetic_super_admin", PASSWORD, "admin", is_super_admin=True)
        with TestClient(app, base_url="https://testserver") as operator_client:
            operator_login = operator_client.post("/api/platform/login", json={"username": operator["username"], "password": PASSWORD}, headers=ORIGIN)
            assert operator_login.status_code == 200
            approved = operator_client.patch(f'/api/platform/users/{account["user"]["id"]}', json={"approval_status": "approved"},
                                             headers={**ORIGIN, "X-CSRF-Token": operator_login.json()["csrf_token"]})
            assert approved.status_code == 200, approved.text
        login = owner.post("/api/platform/login", json={"username": "synthetic_owner", "password": PASSWORD}, headers=ORIGIN)
        assert login.status_code == 200
        account = login.json()
        image = Image.new("RGB", (512, 384), "white")
        drawing = ImageDraw.Draw(image)
        for x in range(0, 512, 16):
            for y in range(0, 384, 16):
                drawing.rectangle((x, y, x + 15, y + 15), fill=(75, 75, 75) if (x // 16 + y // 16) % 2 else (180, 180, 180))
        output = io.BytesIO()
        image.save(output, format="PNG")
        image.close()
        response = owner.post("/api/platform/analyses", files={"image": ("SYNTHETIC-chart.png", output.getvalue(), "image/png")},
                              data={"sample_code": "SYNTHETIC_AUTO_PERSIST", "acknowledge_quality": "true", "quality_comment": "SYNTHETIC chart verifies storage only, not microscopy or diagnostic accuracy."},
                              headers={**ORIGIN, "X-CSRF-Token": account["csrf_token"]})
        assert response.status_code == 201, response.text
        record = response.json()
        assert record["model_version"] == SyntheticModel.version
        assert record["owner_id"] == account["user"]["id"]
        saved_pixels = owner.get(f'/api/platform/analyses/{record["id"]}/image').content

    reopened = create_app(SyntheticModel())
    with TestClient(reopened, base_url="https://testserver") as owner, TestClient(reopened, base_url="https://testserver") as other:
        login = owner.post("/api/platform/login", json={"username": "synthetic_owner", "password": PASSWORD}, headers=ORIGIN)
        assert login.status_code == 200
        assert login.json()["user"]["id"] == account["user"]["id"]
        results = owner.get("/api/platform/analyses?scope=mine&referral_state=not_pending").json()
        assert results["total"] == 1
        assert results["items"][0]["id"] == record["id"]
        assert owner.get(f'/api/platform/analyses/{record["id"]}/image').content == saved_pixels
        signup = other.post("/api/platform/register", json={"username": "synthetic_other", "password": PASSWORD}, headers=ORIGIN)
        assert signup.status_code == 201
        assert signup.json()["user"]["approval_status"] == "pending"
        assert other.get("/api/platform/analyses?scope=mine").status_code == 401
        assert other.get(f'/api/platform/analyses/{record["id"]}').status_code == 401
        assert other.get(f'/api/platform/analyses/{record["id"]}/image').status_code == 401
        pending_login = other.post("/api/platform/login", json={"username": "synthetic_other", "password": PASSWORD}, headers=ORIGIN)
        assert pending_login.status_code == 403
    assert reopened.state.platform_store.config.storage_durable is False


def test_an_invalid_explicit_path_does_not_silently_use_auto_storage(automatic, monkeypatch):
    repository = Path(__file__).resolve().parents[2]
    unsafe = repository / "public" / "SYNTHETIC-auto-storage-forbidden"
    monkeypatch.setenv("HELPMINTHS_DATA_DIR", str(unsafe))
    with pytest.raises(RuntimeError, match="outside public and dist"):
        PlatformStore()
    assert not automatic.exists() and not unsafe.exists()


def test_automatic_path_still_enforces_private_location_and_no_symlinks(automatic, tmp_path, monkeypatch):
    repository = Path(__file__).resolve().parents[2]
    unsafe = repository / "dist" / "SYNTHETIC-auto-storage-forbidden"
    monkeypatch.setattr(config, "DEFAULT_AUTO_STORAGE_DIR", unsafe)
    with pytest.raises(RuntimeError, match="outside public and dist"):
        PlatformStore()
    assert not unsafe.exists()
    actual = tmp_path / "real-private"
    actual.mkdir()
    linked = tmp_path / "linked-private"
    linked.symlink_to(actual, target_is_directory=True)
    monkeypatch.setattr(config, "DEFAULT_AUTO_STORAGE_DIR", linked)
    with pytest.raises(RuntimeError, match="symbolic link"):
        PlatformStore()
    assert not list(actual.iterdir())
