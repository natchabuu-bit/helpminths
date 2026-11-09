"""Exact legacy-equivalence checks, not clinical accuracy validation.

The frozen legacy assessment below intentionally preserves the previous scalar
calculation and its complete response. It is independent of NumPy/the new helper.
"""
from __future__ import annotations

import math
import os
import random
from dataclasses import asdict, replace

import pytest
from fastapi import HTTPException
from PIL import Image, ImageStat

from backend.platform import quality
from backend.platform.quality import QualityThresholds


def _legacy_assess_quality(image: Image.Image, thresholds: QualityThresholds | None = None) -> dict[str, Any]:
    """Measure a bounded thumbnail; no classifier, physical size or clinical claim."""
    try:
        limits = thresholds or QualityThresholds.from_environment()
    except ValueError:
        raise HTTPException(503, {"code": "quality_not_configured", "message": "การตั้งค่าเกณฑ์คุณภาพภาพไม่ถูกต้อง โปรดให้ผู้ดูแลตรวจค่าที่กำหนด"}) from None
    width, height = image.size
    scale = min(1.0, limits.thumbnail_size / max(width, height))
    resized = image.resize((max(1, round(width * scale)), max(1, round(height * scale))), Image.Resampling.BILINEAR)
    gray = resized.convert("L")
    try:
        stats = ImageStat.Stat(gray)
        brightness = float(stats.mean[0])
        contrast = float(stats.stddev[0])
        histogram = gray.histogram()
        clipped_fraction = (sum(histogram[:6]) + sum(histogram[250:])) / (gray.width * gray.height)
        pixels = list(gray.get_flattened_data())
        row_width = gray.width
        total = squares = 0.0
        samples = 0
        for y in range(1, gray.height - 1):
            base = y * row_width
            for x in range(1, row_width - 1):
                p = base + x
                laplacian = pixels[p - row_width] + pixels[p + row_width] + pixels[p - 1] + pixels[p + 1] - 4 * pixels[p]
                total += laplacian
                squares += laplacian * laplacian
                samples += 1
        focus = max(0.0, squares / samples - (total / samples) ** 2) if samples else 0.0
    finally:
        gray.close()
        resized.close()
    checks = [
        {"id": "integrity", "label": "ไฟล์ภาพสมบูรณ์", "status": "pass", "message": "เปิดและถอดรหัสภาพสำเร็จ"},
        {"id": "resolution", "label": "ความละเอียด", "status": "pass" if width >= limits.min_width and height >= limits.min_height else "warning", "message": f"ภาพ {width} × {height} พิกเซล; เกณฑ์เบื้องต้น {limits.min_width} × {limits.min_height} พิกเซล"},
        {"id": "focus", "label": "ความคมชัด", "status": "pass" if focus >= limits.min_focus_variance else "warning", "message": "สัญญาณขอบภาพเพียงพอตามเกณฑ์เบื้องต้น" if focus >= limits.min_focus_variance else "ภาพอาจเบลอหรือมีรายละเอียดน้อย ลองปรับโฟกัสและยึดกล้องให้นิ่ง"},
        {"id": "brightness", "label": "ความสว่าง", "status": "pass" if limits.min_brightness <= brightness <= limits.max_brightness else "warning", "message": "ความสว่างอยู่ในช่วงที่ตั้งไว้" if limits.min_brightness <= brightness <= limits.max_brightness else "ภาพมืดเกินไป ลองเพิ่มแสง" if brightness < limits.min_brightness else "ภาพสว่างเกินไป ลองลดแสง"},
        {"id": "contrast", "label": "ความต่างระดับสี", "status": "pass" if contrast >= limits.min_contrast else "warning", "message": "ระดับความต่างสีเพียงพอตามเกณฑ์เบื้องต้น" if contrast >= limits.min_contrast else "ภาพมีความต่างระดับสีน้อย ลองปรับแสงหรือเลือกบริเวณที่เห็นโครงสร้างชัด"},
        {"id": "clipping", "label": "ส่วนมืดหรือสว่างจัด", "status": "pass" if clipped_fraction <= limits.max_clipped_fraction else "warning", "message": "ส่วนมืดหรือสว่างจัดอยู่ในเกณฑ์ที่ตั้งไว้" if clipped_fraction <= limits.max_clipped_fraction else "ภาพมีพื้นที่ดำหรือขาวจัดมาก อาจเกิดจากขอบช่องมองภาพหรือการรับแสง"},
    ]
    return {
        "status": "pass" if all(item["status"] == "pass" for item in checks) else "warning",
        "assessment_type": "heuristic",
        "checks": checks,
        "metrics": {"width": width, "height": height, "focus_variance": round(focus, 3), "brightness": round(brightness, 3), "contrast": round(contrast, 3), "clipped_fraction": round(clipped_fraction, 6), "measurement_width": max(1, round(width * scale)), "measurement_height": max(1, round(height * scale))},
        "thresholds": asdict(limits),
        "can_override": os.getenv("HELPMINTHS_QUALITY_ALLOW_OVERRIDE", "1") == "1",
        "notice": "เป็นการประเมินคุณภาพภาพเบื้องต้นด้วยเกณฑ์เชิงภาพ ไม่ยืนยันว่าภาพเหมาะสำหรับวินิจฉัย และไม่ใช้วัดขนาดไข่จริง",
    }

def patterned(size, pattern):
    width, height = size
    if pattern == 'noise':
        return Image.frombytes('RGB', size, random.Random(width * 10000 + height).randbytes(width * height * 3))
    if pattern == 'checker':
        data = bytes(255 * ((x + y) % 2) for y in range(height) for x in range(width))
    elif pattern == 'ramp':
        data = bytes((x * 13 + y * 7) % 256 for y in range(height) for x in range(width))
    elif pattern == 'edge':
        data = bytes(255 if x in (0, width - 1) or y in (0, height - 1) else 0 for y in range(height) for x in range(width))
    else:
        data = bytes([int(pattern)]) * (width * height)
    with Image.frombytes('L', size, data) as gray:
        return gray.convert('RGB')


CASES = [
    ((1, 1), 'noise'), ((2, 19), 'checker'), ((19, 2), 'ramp'),
    ((3, 3), 'edge'), ((17, 11), 'noise'), ((4, 15), 'checker'),
    ((640, 480), '0'), ((640, 480), '255'), ((640, 480), '127'),
    ((511, 385), 'noise'), ((640, 480), 'checker'), ((640, 480), 'ramp'),
    ((640, 480), 'edge'), ((1706, 960), 'noise'), ((2048, 1536), 'ramp'),
    ((2048, 3), 'noise'), ((3, 2048), 'noise'),
]


@pytest.mark.parametrize('numpy_enabled', [True, False], ids=['numpy', 'basic-install-fallback'])
@pytest.mark.parametrize('size,pattern', CASES)
def test_full_quality_response_equals_frozen_legacy_for_exact_pixels(monkeypatch, numpy_enabled, size, pattern):
    if numpy_enabled and quality._np is None:
        pytest.skip('NumPy is optional; the basic installation uses the exact scalar fallback')
    if not numpy_enabled:
        monkeypatch.setattr(quality, '_np', None)
    with patterned(size, pattern) as image:
        image.info['description'] = 'Synthetic private metadata: do not alter the inference image'
        image.getexif()[315] = 'Synthetic test owner'
        before = (image.tobytes(), dict(image.info), dict(image.getexif()))
        assert quality.assess_quality(image) == _legacy_assess_quality(image)
        assert (image.tobytes(), dict(image.info), dict(image.getexif())) == before


def test_maximum_supported_thumbnail_exact_even_at_extreme_laplacian():
    with patterned((2048, 2048), 'checker') as image:
        limits = QualityThresholds(thumbnail_size=2048)
        assert quality.assess_quality(image, limits) == _legacy_assess_quality(image, limits)
        assert quality.assess_quality(image, limits)['metrics']['focus_variance'] == 1040400.0


def _legacy_focus(gray):
    pixels = list(gray.get_flattened_data())
    width = gray.width
    total = squares = 0.0
    samples = 0
    for y in range(1, gray.height - 1):
        for x in range(1, width - 1):
            i = y * width + x
            value = pixels[i-width] + pixels[i+width] + pixels[i-1] + pixels[i+1] - 4*pixels[i]
            total += value
            squares += value * value
            samples += 1
    return max(0.0, squares / samples - (total / samples) ** 2) if samples else 0.0


@pytest.mark.parametrize('pattern', ['noise', 'checker', 'edge', 'ramp'])
def test_unrounded_float_and_boundary_decisions_remain_exact(pattern):
    with patterned((63, 47), pattern) as image:
        with image.convert('L') as gray:
            expected = _legacy_focus(gray)
            assert quality._focus_variance(gray) == expected
        for boundary in [math.nextafter(expected, -math.inf), expected, math.nextafter(expected, math.inf)]:
            limits = replace(QualityThresholds(), min_focus_variance=boundary)
            result = quality.assess_quality(image, limits)
            assert result == _legacy_assess_quality(image, limits)
            focus_check = next(check for check in result['checks'] if check['id'] == 'focus')
            assert focus_check['status'] == ('pass' if expected >= boundary else 'warning')


def test_direct_custom_threshold_beyond_validated_bound_keeps_scalar_fallback(monkeypatch):
    original = quality._focus_variance_scalar
    observed = []
    def scalar(gray):
        observed.append(gray.size)
        return original(gray)
    monkeypatch.setattr(quality, '_focus_variance_scalar', scalar)
    limits = QualityThresholds(thumbnail_size=2049)
    with patterned((2049, 5), 'noise') as image:
        assert quality.assess_quality(image, limits) == _legacy_assess_quality(image, limits)
    assert observed == [(2049, 5)]


def test_licensed_atlas_photos_retain_complete_quality_response():
    from pathlib import Path
    photos = sorted((Path(__file__).resolve().parents[2] / 'public' / 'atlas' / 'photos').glob('*.jpg'))
    assert len(photos) == 11
    for path in photos:
        with Image.open(path) as original, original.convert('RGB') as image:
            before = image.tobytes()
            assert quality.assess_quality(image) == _legacy_assess_quality(image), path.name
            assert image.tobytes() == before
