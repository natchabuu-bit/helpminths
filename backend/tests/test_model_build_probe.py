"""Synthetic service responses test the build gate, never clinical accuracy."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from backend.verify_model import verify_model


class ProbeService:
    ready = True
    name = 'SYNTHETIC.pt'
    version = 'SYNTHETIC'
    metadata = {'sha256': 'SYNTHETIC'}
    message = 'Synthetic service only'
    predictions = []

    def __init__(self, path):
        self.path = path

    def load(self):
        pass

    def predict(self, image, confidence):
        assert image.size == (640, 640) and image.mode == 'RGB'
        assert confidence == .99
        return self.predictions


def test_empty_runtime_detection_result_passes_without_claiming_accuracy():
    result = verify_model('not-real-test-path.pt', service_factory=ProbeService)
    assert result['model_ready'] is True
    assert result['runtime_smoke_detections'] == 0
    assert result['diagnostic_accuracy_evaluated'] is False
    assert result['runtime_smoke_input'] == 'synthetic_blank_640x640'


def test_missing_model_never_passes_runtime_gate():
    with pytest.raises(ValueError):
        verify_model('/nonexistent/model.pt')


@pytest.mark.parametrize('predictions', [None, [{'bbox': [0, 0, 700, 10], 'confidence': .99, 'label': 'SYNTHETIC'}],
                                         [{'bbox': [0, 0, 10, 10], 'confidence': float('nan'), 'label': 'SYNTHETIC'}]])
def test_invalid_detector_outputs_fail_gate(predictions):
    factory = lambda path: SimpleNamespace(ready=True, name='SYNTHETIC', version='SYNTHETIC', metadata={},
                                          load=lambda: None, predict=lambda image, confidence: predictions)
    with pytest.raises(ValueError):
        verify_model('not-real-test-path.pt', service_factory=factory)
