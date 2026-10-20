# Ascaris stage extension — validation, 20 October 2026

- `npm run build`: TypeScript and production bundling passed.
- `HELPMINTHS_TEST_URL=http://127.0.0.1:8081 npm run test:e2e`:
  **12 passed, 0 failed, 0 skipped**.
- `HELPMINTHS_TEST_URL=http://127.0.0.1:8081 npm run test:offline`:
  **2 passed, 0 failed, 0 skipped**.

The stage checks distinguish unfertilized granular contents, an early fertilized
ovum, an illustrative four-cell cleavage stage, and a coiled larva. All four
schematic drawings are tested with and without the mammillated coat, including
on a phone without WebGL. Changing coat status retains the selected developmental
stage; changing stage clears the previous part selection and resets model zoom.
Incompatible parts are absent from the selectable structure list.

The existing mixed micrograph is used only with its source-labelled fertilized
and lower-left unfertilized examples. The larvated micrograph is selected for
embryonated appearance. Cleavage and decorticated selections explicitly report
that a matching licensed micrograph is unavailable, while keeping their own
original drawings and 3D models available. No other-stage photo is substituted.
All nine existing micrographs remain covered by decoding and attribution checks.

Offline tests start from a home visit before Atlas is ever opened. They verify all
four stage diagrams and explanations, independent decortication, all nine cached
photos, and the existing upload privacy and service-worker update protections.

Separate renderer browser checks passed 26 actual mesh selections with marker
labels disabled, 26 camera-target checks and 26 material-highlight checks across
the four stages and both coat states. The elongated unfertilized egg fit a
360 × 720 portrait stage without clipping. Desktop 1520 px and phone 390 px
visual checks found no horizontal overflow. No browser exceptions were reported.

No image bytes, training data, weights or backend inference behavior changed.
These checks verify application behavior; they do not measure diagnostic accuracy
or prove an egg's viability or infectivity. Clinical/source limitations and image
rights are recorded in [the evidence review](./ascaris-stages-evidence.md).
