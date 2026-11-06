"""Build-time detection-runtime smoke check, not diagnostic validation."""
from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

from PIL import Image

from backend.model import YOLOModelService


def verify_model(path: str | Path, *, service_factory=YOLOModelService) -> dict:
    started = time.perf_counter()
    service = service_factory(str(path))
    service.load()
    if not service.ready:
        raise ValueError(service.message)
    # A blank synthetic input checks tensor preparation, the detection head and
    # postprocessing. It does not estimate sensitivity or diagnostic accuracy.
    image = Image.new('RGB', (640, 640), '#808080')
    try:
        predictions = service.predict(image, .99)
    finally:
        image.close()
    if not isinstance(predictions, list):
        raise ValueError('โมเดลไม่ได้คืนรายการกรอบตรวจจับตามรูปแบบที่รองรับ')
    for prediction in predictions:
        try:
            box = prediction['bbox']
            x1, y1, x2, y2 = box
            confidence = prediction['confidence']
            valid = (all(type(value) in (int, float) and math.isfinite(value) for value in (*box, confidence))
                     and 0 <= x1 < x2 <= 640 and 0 <= y1 < y2 <= 640 and .99 <= confidence <= 1
                     and isinstance(prediction['label'], str))
        except (KeyError, TypeError, ValueError):
            valid = False
        if not valid:
            raise ValueError('ผลทดสอบโมเดลมีกรอบหรือค่าความมั่นใจไม่ถูกต้อง')
    try:
        import resource
        peak_rss_mib = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)
    except ImportError:
        peak_rss_mib = None
    names = getattr(getattr(service, '_model', None), 'names', None)
    if isinstance(names, dict):
        class_names = {str(key): str(value) for key, value in names.items()}
    elif isinstance(names, (list, tuple)):
        class_names = {str(index): str(value) for index, value in enumerate(names)}
    else:
        class_names = None
    return {
        'model_ready': True, 'model_name': service.name,
        'model_sha256': (service.metadata or {}).get('sha256'),
        'model_version': service.version,
        'model_class_names': class_names,
        'runtime_smoke_input': 'synthetic_blank_640x640',
        'runtime_smoke_detections': len(predictions),
        'elapsed_seconds': round(time.perf_counter() - started, 3),
        'peak_rss_mib': peak_rss_mib,
        'diagnostic_accuracy_evaluated': False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', type=Path, default=Path(__file__).resolve().parents[1] / 'models' / 'parasite_yolo.pt')
    args = parser.parse_args()
    try:
        result = verify_model(args.model)
    except Exception:
        # Library tracebacks can disclose training/local paths. The normal model
        # service already records sanitized exception types for operators.
        parser.exit(1, 'โมเดลที่เลือกไม่ผ่านการโหลดหรือทดสอบประมวลผลภาพ โปรดตรวจ checkpoint และเวอร์ชัน runtime\n')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
