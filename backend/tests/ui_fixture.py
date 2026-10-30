"""Opt-in localhost-only synthetic API fixture for browser tests.

Never import this module from production. No fixture record is created by the
normal application entrypoint. Browser tests create their own analyses/reviews/
approvals through the real authenticated API; only test accounts are bootstrapped.
"""
from __future__ import annotations

import atexit
import os
import tempfile
from contextlib import asynccontextmanager
from copy import deepcopy

if os.getenv("HELPMINTHS_ENABLE_TEST_FIXTURES") != "1":
    raise RuntimeError("This synthetic UI fixture requires HELPMINTHS_ENABLE_TEST_FIXTURES=1")
if os.getenv("RENDER") or os.getenv("RENDER_SERVICE_ID") or os.getenv("HELPMINTHS_ENV", "").lower() == "production":
    raise RuntimeError("Synthetic UI fixtures must not run on a production/Render service")

# Test configuration is deliberately local and never reuses a configured data dir.
os.environ["HELPMINTHS_COOKIE_SECURE"] = "0"
os.environ["HELPMINTHS_SERVE_WEB"] = "1"
os.environ.pop("HELPMINTHS_DATA_DIR", None)
os.environ.pop("HELPMINTHS_MODEL_PATH", None)

from fastapi.responses import JSONResponse

from backend.main import create_app
from backend.model import YOLOModelService

TEST_PASSWORD = "Synthetic-UI-test-only-2026!"
TEST_USERS = {"admin": "fixture-admin", "reviewer": "fixture-reviewer", "lab": "fixture-lab",
              "student": "fixture-student", "other": "fixture-other"}


class UITestModel(YOLOModelService):
    """Predictable test chart annotations; never a trained parasitology model."""
    def __init__(self):
        super().__init__("")

    def load(self):
        self.ready = True
        self.name = "UI-TEST-FIXTURE-NOT-TRAINED.pt"
        self.version = "synthetic-ui-fixture-v1"
        self.metadata = {"name": self.name, "version": self.version, "task": "detect",
                         "device": "cpu", "test_fixture": True, "evaluation_metrics": None}
        self.message = "SYNTHETIC UI TEST FIXTURE — not a trained detector or a diagnostic result"

    def predict(self, image, confidence):
        width, height = image.size
        objects = [
            {"id": "ui-fixture-1", "class_id": 0, "label": "TEST FIXTURE object A", "confidence": .93,
             "bbox": [width * .15, height * .2, width * .38, height * .48]},
            {"id": "ui-fixture-2", "class_id": 1, "label": "TEST FIXTURE object B", "confidence": .36,
             "bbox": [width * .56, height * .3, width * .81, height * .65]},
        ]
        return deepcopy([item for item in objects if item["confidence"] >= confidence])


_private_directory = tempfile.TemporaryDirectory(prefix="helpminths-synthetic-ui-")
atexit.register(_private_directory.cleanup)
app = create_app(UITestModel(), platform_dir=_private_directory.name)
app.title = "HelpMinths SYNTHETIC UI TEST FIXTURE"
app.state.platform_test_fixture = True
for role, username in TEST_USERS.items():
    app.state.platform_store.create_user(username, TEST_PASSWORD, "lab" if role == "other" else role)

_original_lifespan = app.router.lifespan_context


@asynccontextmanager
async def fixture_lifespan(application):
    try:
        async with _original_lifespan(application):
            yield
    finally:
        _private_directory.cleanup()


app.router.lifespan_context = fixture_lifespan


@app.middleware("http")
async def identify_fixture(request, call_next):
    if request.client and request.client.host not in {"127.0.0.1", "::1", "testclient"}:
        return JSONResponse({"detail": "Synthetic test fixtures accept localhost traffic only"}, status_code=403)
    response = await call_next(request)
    response.headers["X-HelpMinths-Test-Fixture"] = "synthetic-only"
    return response
