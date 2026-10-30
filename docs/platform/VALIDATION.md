# Platform validation record

Date: 30 October 2026 (Asia/Bangkok).

This record distinguishes software verification from model or clinical validation. Synthetic images, accounts, predictions and quiz answers used in automated tests are isolated test fixtures in temporary storage. They are not production data, patient data, model-training evidence or measured diagnostic performance.

## Existing architecture audited

- React 19, TypeScript, Vite and Three.js frontend; Thai Atlas and the explicitly labelled demonstration remain separate from real inference.
- FastAPI backend with Pillow upload decoding and optional Ultralytics/PyTorch YOLO detection adapter.
- Before this platform work, there was no server database or authentication. Analysis history was session memory, and SUS responses were local browser storage.
- Docker serves the built frontend and API from the same origin. Render configuration uses manual deployment. A successful local test or GitHub push does not establish that Render has deployed the new build.
- No trusted trained checkpoint or independent clinical evaluation dataset is supplied by this platform implementation. Missing model/configuration must remain visible; no accuracy statistics are inferred from test fixtures.

## Security and integrity verification scope

The platform verification is split between focused domain tests and an independent cross-domain integration suite. The security/integrity invariants are:

1. An unset database directory reports not configured and does not bootstrap accounts or create clinical records.
2. Passwords use salted scrypt; browser sessions use Secure/HttpOnly/SameSite cookies and a server-validated CSRF header for authenticated mutations.
3. Owners can access only their records. Reviewers/admins have the explicitly permitted broader scope. Students cannot create clinical analyses or verify predictions.
4. Private normalized image files never live in the public/static frontend tree. Image decoding, format, bytes and dimensions are checked before inference; metadata is stripped before persistence.
5. Expert review preserves the original model predictions, requires privilege and revision matching, and appends an audit event. Uncertain or incomplete review cannot become a completed verification silently.
6. CSV/PDF exports enforce the same object permissions as image/detail access. CSV protects against spreadsheet formula injection; generated PDF uses an actual Thai Unicode font.
7. Dashboard counts derive from stored authorized records. An analysis with several objects is counted once; predicted and reviewer-confirmed totals remain distinct.
8. Feedback requires access to a linked analysis, and a confirmed model error requires supporting review evidence. Feedback never changes model weights or becomes independent ground truth automatically.
9. Quiz questions use recorded reviewer approvals of licensed references. Approval revocation/staleness invalidates affected quiz submission, scoring uses server-side labels, and attempts remain within their authorized scope.
10. Audit rows are append-only. Account disable/role/password changes revoke existing sessions, and the last active administrator cannot be removed accidentally.

## Checks and results

Final backend suite:

```bash
.venv/bin/python -m pytest -q backend/tests
```

Result: **47 passed**, no failures or skips. The single FastAPI/Starlette test-client deprecation warning does not affect results. This includes the compatibility endpoint's conditional account/role/CSRF enforcement, known-length and chunked request-body bounds before multipart parsing, and a corrected-bbox regression verifying original/reviewer/effective coordinates in actual CSV, PDF and overlay pixels.

`npm run build` passes TypeScript checking and Vite production compilation. Actual development-proxy login and CSRF-protected logout were verified through Vite5173 to an isolated local fixture API8000, both returning200 after preserving Host in the proxy.


Independent command run against the integrated FastAPI application:

```bash
.venv/bin/python -m pytest backend/tests/test_platform_integration.py -q
```

Result: **4 passed** in 4.71 seconds; no failures or skips. One pre-existing Starlette warning notes deprecation of its `httpx` test-client integration; it is not an application failure.

The four cross-domain scenarios verify:

- Default not-configured sessions/status and the public source catalogue without invented approvals, accounts, analysis results or evaluation metrics.
- Private analysis upload using a synthetic image chart and an injected test-only predictor; EXIF removal; owner/reviewer permissions; cross-user image, CSV, PDF, feedback and audit denials; CSRF rejection; revision conflicts; immutable predictions; corrected/false-positive/missed annotations; actual object counts; evidence-linked feedback that remains ineligible for automatic training/evaluation; CSV formula escaping; no extra inference during review/reporting.
- Approved-only learning, access to quiz/attempt images and records, server-side answer scoring, protection against the generic-audit answer-key bypass, duplicate submission rejection, and revocation of clinical image access after an administrator disables the account.
- Matching Thai-calendar date boundaries across analysis history, dashboard aggregation and multi-case CSV export.

The report scenario generated an actual two-page PDF using bundled Noto Sans Thai fonts and HarfBuzz. It checks embedded `/ToUnicode`, extracts Thai text using the installed `pdftotext`, and checks the PDF signature. Both pages were rendered with `pdftoppm` and visually inspected for Thai glyphs, original/annotated image placement and footers. These images are synthetic test charts, stored outside the repository, and must not be presented as production or clinical examples.

Focused domain test files additionally cover account/bootstrap/storage rules, quality assessment, review validation, learning approval withdrawal and report/evaluation mathematics. Their final full-suite command/results are recorded by the main implementation task; this document does not infer clinical accuracy from any test result.

## Browser verification

```bash
npm run test:platform
```

Result: **4 passed** (92.4s), no skips or browser JavaScript errors. These tests refuse mutation unless a localhost fixture returns its explicit synthetic-only header. They verify:

- Real pixel quality heuristics, warning acknowledgement before inference, and independent backend422 rejection without acknowledgement.
- Authenticated persistence, owner/staff permissions, same-document account-switch image/result clearing, correction/false-positive/missed annotations, verified counts and before/after audit.
- Actual PDF/CSV download bytes, feedback linked to the saved record, honest unavailable evaluation, and real expired-cookie401 clearing private client state.
- Learning reference approval by an authorized reviewer, student approval denial, no quizzes before approval, actual server-scored attempt and stored progress.
- Wrong credentials, admin user inventory without password hashes, and usable unconfigured pages at375px/1440px without horizontal overflow. The separate simpleSUS form remains available.

The final guest-home layout was also rechecked at375px/1440px after moving the unconfigured dashboard below the entry actions; the responsive scenario passed.

Existing Atlas/inference/browser regressions: **14 scenarios passed** across the main run and one isolated rerun. The software-rendered seven-Atlas label-link tour exceeded its original90s suite budget during the first run; with a180s CPU-renderer budget, all its assertions passed in66.4s. No correctness assertion was removed. The remaining13 scenarios passed, including all Ascaris stages/decortication, Strongyloides genital-primordium interaction, licensed photographs, touch gestures and no-model behavior.

`HELPMINTHS_TEST_URL=http://127.0.0.1:8082 npm run test:feedback` passed **5/5** scenarios: complete/incomplete answers, exact0/50/100SUS scoring, explicit local save, drafts/reload, legacy-data preservation, storage-failure reporting and absence of remote writes.

`HELPMINTHS_TEST_URL=http://127.0.0.1:8082 npm run test:offline` verified the complete offline Atlas/stage/touch/demo tour in63.9s. The update-integrity scenario then exposed a test race: opening a new controlled page immediately after closing the old one could legitimately postpone activation of the waiting worker. The test now observes the pending worker's actual activated lifecycle event through a CDP observer on an uncontrolled about:blank page before opening the new client, and waits for the injected server-request event before checking installation completion. Every integrity/old-session assertion is preserved. Two consecutive isolated reruns passed in8.850s and8.837s. Both offline scenarios passed; no production service-worker lifecycle policy was weakened.

Seven public documentation screenshots were captured from the actual unconfigured application, with a guard rejecting configured/user/fixture backends. They contain no patient images or fixture-generated clinical records; demonstration panels remain explicitly labelled.

## Integration findings addressed during development

- Generic owner audit access could bypass the quiz API's hidden answer-key response. Sensitive document kinds now require a privileged role; the integration suite asserts quiz owners receive403 from that audit route.
- Private storage inside public/dist could expose images through static hosting. The store now rejects those locations and symlink paths; private directories/files have restrictive permissions.
- Concurrent large-image preparation could multiply decompression memory. A shared nonblocking image-work slot bounds decoder/quality/inference/report rendering, while PDF images are resized for layout without changing stored originals.
- History and reporting originally used different date-zone boundaries, and detail/dashboard used different default uncertainty thresholds. Shared filtering/counting now keeps the records and totals consistent.
- A no-op correction or bbox-only correction must not become evidence of an incorrect class. Review validation rejects empty corrections; classification-error triage requires an actual label change.

These are software safeguards, not claims of penetration-test certification, regulatory clearance or clinical validation.

Additional final integration fixes:

- Account and role changes remount private pages and discard upload DataURLs, results and form drafts; private analyses never enter public session history. Unauthorized API401 responses clear the client session before refreshing it.
- API bodies are bounded before multipart parsing: total multipart21MiB including fields/overhead, JSON1MiB, plus the independent20MiB file and40MP decoded-image caps. Chunked requests obey the same limits.
- PDF and CSV now preserve original AI boxes separately from reviewer corrections; reviewed overlays use effective boxes and identify moved coordinates.
- The legacy ephemeral inference API requires the same lab/reviewer/admin role and CSRF when persistent account mode is configured. Its unconfigured public mode remains compatible.

## Operational limits to verify before a user study

- Set private storage explicitly and use a mounted persistent volume before treating stored records as durable. The existence of a SQLite file alone does not make an ephemeral Render filesystem persistent.
- Bootstrap an administrator through the operator CLI, use HTTPS, and grant reviewer roles only to authorized people. There are no default production credentials.
- Install and configure a trusted helminth detector separately. Application/API contract tests are not evidence of YOLO detection accuracy.
- Approve learning reference labels and rights before enabling their scored quizzes. Source-labelled teaching images are not automatically application-expert-approved data.
- Obtain independent reviewed test data and a declared matching/evaluation protocol before reporting precision, recall, F1 or mAP. Raw confidence is not probability of infection.
- EPG and infection-intensity claims require a validated specimen/counting protocol. Ordinary uncalibrated microscopy photographs do not provide those inputs.
