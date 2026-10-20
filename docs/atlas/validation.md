# Atlas comparison validation — 20 October 2026

Checked locally against the production FastAPI server on port 8081 with Chromium,
including software WebGL and phone viewports. These are application checks, not
clinical accuracy or independent parasitology validation.

- `npm run build`: passed TypeScript and production bundling.
- Full `test:e2e`: 10 passed, 0 failed, 0 skipped. Covers existing image upload,
  model-label contracts and demo behavior, plus all nine real-photo loads, credits,
  stage notes, honest missing-image states, keyboard tabs, separate photo/model
  zoom, photo pan/gallery/reset, cited structure selection, expanded-view focus,
  real two-finger photo pinch and image-load failure recovery.
- After final fallback-zoom changes, the five affected browser cases passed again,
  including computed SVG enlargement/reset when WebGL is unavailable.
- After the final Taeniidae heading clarification, the complete nine-photo
  comparison case passed again (1 passed, 0 failed, 0 skipped).
- Final `test:offline`: 2 passed, 0 failed, 0 skipped. A first home visit precaches
  all nine photos before Atlas is ever opened. All decode offline; structure
  descriptions and selection work. Failed downloads/updates do not claim
  readiness, existing sessions retain their worker, and image uploads/API results
  remain outside the persistent static cache.
- Original JPEG SHA-256 values match `photo_manifest.json` for all nine images.
  Their combined file size is 666,179 bytes. No image content was changed.
- Separate renderer browser checks selected 21 anatomical meshes with marker
  labels disabled, checked emissive highlighting and the selected camera target,
  wheel/numeric zoom and camera preservation across toggles. A 360 × 720 portrait
  stage framed the largest egg without clipping. No browser exceptions occurred.
- Visual review at desktop 1520 px and phone 390 px showed no horizontal overflow;
  the comparison panes stack on narrow screens.

No backend behavior changed. No trained weights were added. The live Render
deployment was not performed or independently verified in this environment.
The real-photo coverage remains eight of eleven reference groups: OV, MIF and
Echinostoma require additional source access and verification before their egg
photographs can be bundled. See the source and license audit in this directory.
