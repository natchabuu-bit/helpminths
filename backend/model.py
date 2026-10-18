"""Optional local YOLO inference. No weights are downloaded or fabricated."""

from __future__ import annotations

import logging
import math
import os
import threading
from pathlib import Path
from typing import Any

from PIL import Image

logger = logging.getLogger(__name__)


class ModelNotReadyError(RuntimeError):
    pass


class YOLOModelService:
    def __init__(self, model_path: str | None = None) -> None:
        self._path = model_path if model_path is not None else os.getenv("HELPMINTHS_MODEL_PATH", "")
        self._model: Any = None
        self._lock = threading.Lock()
        self.ready = False
        self.name: str | None = None
        self.message = "ยังไม่ได้เชื่อมต่อโมเดล AI กรุณาตั้งค่า HELPMINTHS_MODEL_PATH ให้ชี้ไปยังโมเดล YOLO ที่ฝึกแล้ว"

    def load(self) -> None:
        if not self._path:
            return
        path = Path(self._path).expanduser()
        if not path.is_file() or path.suffix.lower() != ".pt":
            self.message = "ไม่พบไฟล์โมเดล YOLO .pt ที่ใช้งานได้ กรุณาตรวจสอบการตั้งค่าโมเดล"
            return
        try:
            from ultralytics import YOLO
        except ImportError:
            self.message = "ยังไม่ได้ติดตั้งส่วนประมวลผลโมเดล กรุณาติดตั้ง backend/requirements-model.txt แล้วเริ่ม API ใหม่"
            return
        except Exception as exc:
            logger.warning("YOLO runtime could not be imported (%s)", type(exc).__name__)
            self.message = "ส่วนประมวลผลโมเดลเริ่มทำงานไม่สำเร็จ กรุณาตรวจสอบการติดตั้ง Ultralytics และ PyTorch"
            return
        try:
            self._model = YOLO(str(path), task="detect")
            if getattr(self._model, "task", "detect") != "detect":
                self._model = None
                self.message = "โมเดลนี้ไม่ใช่โมเดลตรวจจับวัตถุ กรุณาใช้โมเดล YOLO detection ที่ฝึกกับไข่พยาธิ"
                return
        except Exception as exc:
            # Raw exception strings may contain filesystem paths; do not expose them.
            logger.warning("YOLO checkpoint could not be loaded (%s)", type(exc).__name__)
            self.message = "โหลดโมเดลไม่สำเร็จ กรุณาตรวจสอบไฟล์โมเดลและเวอร์ชันของ Ultralytics"
            return
        self.ready = True
        self.name = path.name
        self.message = "โมเดลพร้อมประมวลผลภาพ ผลลัพธ์ต้องได้รับการยืนยันโดยผู้เชี่ยวชาญ"

    def predict(self, image: Image.Image, confidence: float) -> list[dict[str, Any]]:
        if not self.ready or self._model is None:
            raise ModelNotReadyError(self.message)
        # A single model instance is shared by requests; serialize its inference.
        with self._lock:
            results = self._model.predict(source=image, conf=confidence, device="cpu", verbose=False)
            if not results or results[0].boxes is None:
                return []
            result = results[0]
            boxes = result.boxes
            coordinates = boxes.xyxy.cpu().tolist()
            scores = boxes.conf.cpu().tolist()
            classes = boxes.cls.cpu().tolist()
            names = getattr(result, "names", None) or self._model.names
            detections = []
            for coordinates_, score, class_ in zip(coordinates, scores, classes, strict=True):
                if len(coordinates_) != 4 or not all(math.isfinite(float(value)) for value in [*coordinates_, score, class_]):
                    continue
                if not confidence <= float(score) <= 1:
                    continue
                class_id = int(class_)
                if isinstance(names, dict):
                    label = str(names.get(class_id, f"class_{class_id}"))
                else:
                    label = str(names[class_id]) if 0 <= class_id < len(names) else f"class_{class_id}"
                x1, y1, x2, y2 = coordinates_
                bbox = [
                    max(0.0, min(float(x1), image.width)),
                    max(0.0, min(float(y1), image.height)),
                    max(0.0, min(float(x2), image.width)),
                    max(0.0, min(float(y2), image.height)),
                ]
                if bbox[2] <= bbox[0] or bbox[3] <= bbox[1]:
                    continue
                detections.append({
                    "id": f"det-{len(detections) + 1}",
                    "class_id": class_id,
                    "label": label,
                    "confidence": round(float(score), 6),
                    "bbox": [round(value, 2) for value in bbox],
                })
            return detections
