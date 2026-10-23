# Strongyloides validation — 23 October 2026

Production build and checks ran against the same-origin FastAPI server on port
8081 with Chromium, including software WebGL and phone layouts.

- `npm run build`: TypeScript and production bundling passed.
- `HELPMINTHS_TEST_URL=http://127.0.0.1:8081 npm run test:e2e`:
  **14 passed, 0 failed, 0 skipped**.
- `HELPMINTHS_TEST_URL=http://127.0.0.1:8081 npm run test:offline`:
  **2 passed, 0 failed, 0 skipped**.

Coverage includes all 12 reference entries, all 11 micrographs and their credits,
Strongyloides' initially selected genital primordium, six selectable structures,
repeatable GP magnification after reset, the rhabditiform comparison table,
phone SVG fallback anatomy, correct larval wording, exact inference-label export,
and rejection of unrelated S. fuelleborni/S. ratti aliases. Existing Ascaris
stages, decortication, upload guards, privacy and worker-update checks still pass.

The first home visit precaches every photo and the unvisited Atlas. Offline checks
verify Strongyloides images, GP selection, guide, citations and zoom without an
online Atlas visit first. Photographs do not claim a visibly verified GP hotspot.

Separate renderer browser checks passed six actual mesh selections with marker
labels disabled, six emissive highlights and six camera targets. The GP focus
action retains its target after manual rotation. Initial framing fits the whole
body in a 360 × 720 portrait stage. A dense surface sample confirmed that the
emphasized GP and its highlight remain inside the cuticle; it is not an external
gonad. No browser exceptions occurred. Desktop 1520 px and phone 390 px visual
checks found no horizontal overflow.

SHA-256 checks match the original image bytes for all 11 photographs. No weights
or backend inference behavior were added. These checks validate application
behavior rather than diagnostic performance. See [the evidence and photo-rights
review](./strongyloides-evidence.md) for the biological and image limitations.

The public Render deployment is a separate Manual Deploy step; it was not
performed or independently verified by these local checks.
