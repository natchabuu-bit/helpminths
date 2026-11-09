"""Compare exact scalar/vectorized quality checks on licensed and synthetic images.

Run from the repository with its installed dependencies, for example:
  .venv/bin/python scripts/benchmark-quality.py --output /tmp/quality-timings.json

This measures preparation, not model inference or diagnostic accuracy. The scalar
reference is the retained original calculation. No image bytes are exported.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import statistics
import sys
import time
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from PIL import Image
from backend.platform import quality


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repeats', type=int, default=5)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if not 1 <= args.repeats <= 30:
        parser.error('--repeats must be between 1 and 30')
    numpy_runtime = quality._np
    records = []
    with ExitStack() as stack:
        cases = []
        for path in sorted((ROOT / 'public' / 'atlas' / 'photos').glob('*.jpg')):
            source = stack.enter_context(Image.open(path))
            cases.append((path.name, stack.enter_context(source.convert('RGB'))))
        for size in [(1706, 960), (2048, 1536)]:
            image = Image.frombytes('RGB', size, random.Random(709).randbytes(size[0] * size[1] * 3))
            cases.append((f'synthetic-rgb-{size[0]}x{size[1]}', stack.enter_context(image)))
        for label, image in cases:
            before = hashlib.sha256(image.tobytes()).hexdigest()
            timings = {'scalar': [], 'vectorized': []}
            cpu = {'scalar': [], 'vectorized': []}
            expected = None
            for repeat in range(args.repeats + 1):
                # Alternate ordering to reduce bias from CPU frequency changes.
                order = ['scalar', 'vectorized'] if repeat % 2 else ['vectorized', 'scalar']
                for mode in order:
                    with patch.object(quality, '_np', None if mode == 'scalar' else numpy_runtime):
                        started_cpu, started = time.process_time(), time.perf_counter()
                        result = quality.assess_quality(image)
                        elapsed = (time.perf_counter() - started) * 1000
                        elapsed_cpu = (time.process_time() - started_cpu) * 1000
                    if expected is None:
                        expected = result
                    assert result == expected, f'Quality response changed for {label}'
                    if repeat:
                        timings[mode].append(elapsed)
                        cpu[mode].append(elapsed_cpu)
            assert hashlib.sha256(image.tobytes()).hexdigest() == before, f'Input pixels changed for {label}'
            scalar, vectorized = (statistics.median(timings[mode]) for mode in ['scalar', 'vectorized'])
            records.append({'image': label, 'size': list(image.size), 'exact_quality_equal': True,
                            'input_pixels_unchanged': True, 'scalar_median_ms': round(scalar, 3),
                            'vectorized_median_ms': round(vectorized, 3), 'speed_ratio': round(scalar / vectorized, 3),
                            'scalar_cpu_median_ms': round(statistics.median(cpu['scalar']), 3),
                            'vectorized_cpu_median_ms': round(statistics.median(cpu['vectorized']), 3)})
    result = {'scope': 'quality preparation only; no diagnostic accuracy or hosted latency claim',
              'numpy_available': numpy_runtime is not None, 'repeats': args.repeats,
              'median_scalar_ms': round(statistics.median(item['scalar_median_ms'] for item in records), 3),
              'median_vectorized_ms': round(statistics.median(item['vectorized_median_ms'] for item in records), 3),
              'cases': records}
    output = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output + '\n')
    print(output)


if __name__ == '__main__':
    main()
