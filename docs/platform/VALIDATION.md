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

## Google Sheets health-area dashboard — 30 October 2026

Added the public `/#dashboard` menu for the project's owner-supplied Google Sheet and exact three-row school-report header. This source is separate from the private clinical-analysis dashboard. Published output contains aggregate numbers and canonical provinces/groups, with no raw school, tambon, district, affiliation or person fields. The supplied project source is public by the owner's explicit instruction; another source requires login unless its aggregate publication is explicitly enabled.

Software validation after this addition:

- `.venv/bin/python -m pytest -q backend/tests`: **65 passed**, one existing Starlette/httpx test-client deprecation warning. The18 new sheet scenarios cover bounded/safe reads, cache/single-flight/stale behavior, private/custom-source permissions, strict three-row headers, weighted denominators, coinfection, subtotal exclusion, school deduplication preserving Thai tone marks, actual first-tab selection and readonly OAuth adapter protocol. The additional Excel cases use a real synthetic .xlsx workbook, verify fallback from an Office-editing link, preserve cached values without evaluating formulas, and reject encrypted/oversized/invalid workbooks. Broad source labels remain broad instead of being inferred as species.
- `HELPMINTHS_TEST_URL=http://127.0.0.1:8081 npm run test:health-dashboard`: **7 passed**, no JavaScript errors or source/clinical writes. Tests use isolated synthetic fixtures only. They cover anonymous access, unavailable data without fabricated figures, correct metric units, source-driven filters,375/768/1440px layouts,30-second polling, labelled stale data and unchanged successful-fetch time, offline/reconnect/unmount cleanup, restricted-source gating, and clearing old data after source/permission changes. The reconnect test waits for the actual response before checking refresh completion.
- `HELPMINTHS_TEST_URL=http://127.0.0.1:8081 npm run test:feedback`: **5 passed** after adding the tenth navigation item. LocalSUS behavior remains unchanged.
- `npm run build`: TypeScript and production build passed with the additional lazy-loaded Dashboard.
- `HELPMINTHS_TEST_URL=http://127.0.0.1:8081 npm run test:offline`: **2 passed** (103.9s). The first-install/offline tour now also opens the previously unvisited Dashboard from the static package, verifies its offline state and unavailable statistics, and preserves all Atlas/image/font/demo and cache-integrity checks.

Actual source verification remains blocked: direct requests to `docs.google.com`, `drive.usercontent.google.com` and `sheets.googleapis.com` fail at this environment's network proxy with403. A real request to the integrated local API returns `status:unavailable`, `error.code:connection_failed`, `data:null`, `fetched_at:null`. No actual project values, live Google authorization, worksheet title or clinical/epidemiological results have been verified. Default unavailable screenshots contain no invented project numbers. Native CSV and Excel (.xlsx) readers are implemented; the source file format itself is still unverified without live access. Openpyxl3.1.5/et_xmlfile2.0.0 are pinned in the base runtime; pip dependency checking passed. The final worker update-integrity scenario was rerun after the source-format comparison update. The optional Google service-account transport is tested through a synthetic protocol stub, not a live credential.

See `docs/sheets-dashboard.md` for operator configuration, source-format limits and the remaining live-data checks. No write or sharing-setting change was made to Google Sheets, and no Render deployment is implied by these checks.

## Uploaded dashboard replacement and real 2569 import — 31 October 2026

The public Dashboard now follows the layout supplied in `helminth-dashboard.zip` (SHA-256 `93281b5f1ea6629a4457ff4f25b5a3c65cb77a17b3b139e574317d84150e8c2a`). The uploaded JavaScript and school-level payload are not served. The React replacement uses the existing source/access API and a versioned aggregate-only import. Public scatter points, follow-up lists and tables are district/affiliation aggregates. Source files remain outside Git.

Actual workbook `2569.xlsx`, worksheet `เขต2`, SHA-256 `ddb914156866ec537f7c1d104422f278414d437b49e32b72b73142ccef1d7361`, was independently audited and imported as version `127cfb59ea094824`: 174 listed units, 172 numeric reports, 170 units with tested>0, 17,122 known enrollment, 15,888 tested, 698 reported positive, 17 reported multiple infections. Both overall source summaries and province summaries reconcile without counting summary rows as detail. All 50 independently checked aggregate scopes matched. Reported species findings are716 versus715 after separating the inconsistent pinworm1; raw pinworm7 is retained alongside numerically consistent6. Two missing species-count cells and44 cached percentage formula errors remain documented. Missing/pending counts are not imputed0. These are reporting consistency checks, not clinical validation or person-level deduplication.

The five descriptive unit-positivity ranges contain61/51/32/15/11 units. Selecting a range recomputes counts, district/affiliation/species groups, scoped quality notes and CSV, and excludes zero-tested/pending units from that scope. The histogram retains all ranges under other active filters so users can switch ranges. No population-prevalence or time-series claim is made. Source snapshot refresh_seconds is0; optional Google mode retains its polling/access safeguards.

Verification completed against the production build on localhost8082:

- `npm run build`: passed (TypeScript and Vite).
- `.venv/bin/python -m pytest -q backend/tests`: **96 passed**; includes importer, actual audited artifact, provider selection/access, nulls, source conflicts, exact range boundaries, filtering and CSV regressions.
- `HELPMINTHS_TEST_URL=http://127.0.0.1:8082 node --test tests/health-dashboard.test.mjs tests/health-snapshot.test.mjs`: **11 passed** (7 isolated synthetic Google-connector tests and4 real aggregate snapshot tests). An added incompatible-filter assertion was rerun successfully. Tested375/768/1440px layouts, keyboard scatter, whole-page range filtering, null/pending/zero distinctions, source provenance, no file polling, source/permission changes, stale/offline handling, table/search/sort and matching CSV. No browser errors or source/clinical writes.
- Existing SUS browser suite: **5 passed**; existing offline/service-worker suite: **2 passed**.
- `pip check` and `git diff --check`: passed.
- `node scripts/capture-survey.mjs`: captured actual desktop/mobile/chart screenshots, guarded against fixtures, configured accounts or a different dataset version. No patient images or invented project values.

The previous Google proxy403 verification describes that transport only. The uploaded workbook has now been verified independently, so the default public Dashboard can show real imported results without reaching Google. It remains a snapshot; file updates require reimport plus deployment. Local verification and Git updates do not themselves deploy Render (`autoDeploy:false`).

## Named school follow-up and 170-school listing — 31 October 2026

The owner explicitly requested named school follow-up results and all170 names after reviewing the aggregate-only dashboard. The import now has an opt-in `--include-school-details`; the default still omits names. The committed dataset uses this option and version `f8fa159f5ee78221`, including170 tested-only school/center records with names, area, affiliation and group-level counts. The original workbook, its notes, person-level records, and the names of zero-tested/pending units are not published. Artifact school counts and enrollment/tested/positive/coinfection totals reconcile with the tested-unit cubes, and API projection allows only documented fields.

Independent source audit:170 tested units,108 eligible tested>=30 (including4 exactly30),62 below30. All170 sum to17,122 enrolled /15,888 tested /698 positive. The follow-up panel displays8 names ordered by the exact raw infected/tested fraction; rounding does not decide order. Equal fractions sort by positive count descending then name/stableID. Eligible zero-positive units are included (27) because the requested criterion is tested>=30. The full table initially shows170 names, including the62 below30. Clicked follow-up names select/highlight the matching table row; the view-all action shows108 eligible rows and an explicit checkbox; clearing that local option restores170 under the same global filters. School search/sort/CSV use the visible school subset. Region, status and positivity-range filters apply consistently to the named API data and follow-up panel; zero/pending scopes return no school names.

Verification:

- Production TypeScript/Vite build passed.
- Full backend suite: **103 passed**. New regressions cover default omission, explicit publication, tested-only names,30/29 eligibility, exact-ratio ordering and ties, metadata/field projection, reconciliation and real-data170/108/top8/filtered scopes.
- Dashboard browser suites on frozen localhost8083: **12 passed** (7 Google regressions,5 real snapshot checks), no JavaScript errors or API writes. They verify all170 API names in the table,108 eligibility, named top8, follow-up row selection, table checkbox, name search and matching CSV, mobile/tablet/desktop layout and retained aggregate functionality.
- Screenshot capture from the actual versioned API succeeded with explicit170-school/108-eligible guards. Added separate follow-up and school-table images to the screenshot manifest; these school statistics are intentionally public under the owner's new request. No patient images are used.
- `git diff --check` passed. This update does not change the clinical model, SUS, authentication or offline API-caching policy.

## Multi-year Dashboard from the second owner archive — 3 November 2026

Completed the prior Dashboard request against `helminth-dashboard (1).zip`, SHA-256 `20f47291b10157625fb2efae2eb2dedd08d37ec70413e4acd683c17b3781f530`. The attached scripts were read as reference and were not executed. The application now includes annual selection2568/2569, school-level scatter, a global school/tambon search, extended school table, all five year-comparison KPIs, district/species paired bars, matched-school scatter, largest increase/decrease rankings, thirteen-year trend controls/legends/year inspection, both heatmaps, separate species-share denominators, ten descriptive history insights, and source quality/provenance notes. No iframe or external font/script dependency was introduced.

Source boundaries: 2569 remains independently audited from `2569.xlsx` with unknown species cells and the reported pinworm contradiction retained. The v4 importer adds institution tambon and per-school type counts behind the extended-publication flag; current version is `dc48437479a72eda`. The169 tested 2568 records and older annual percentages come from the owner's JSON, with explicit original-workbook-unverified/zero-imputation limitations. The2568/history artifact version is `e1ec3662027ec99a`. No patient records, original workbook files, excluded/pending institution names or free-text source notes are published.

Independent reconciliation: 2568 has174 listed/169 tested units,16,799 enrollment,15,106 tested,974 positive,91 multiple infections,110 units tested>=30; 2569 remains174/170,17,122/15,888/698/17,108 eligible. Default year is2569 alone, not a sum across years. Exactly167 schools match by school/tambon/province (including a district move);102 pairs meet tested>=30 in both years. The overall rate delta is computed from raw counts as−2.054516pp, displayed−2.05pp. Using±0.5pp descriptively produces92 decreasing/44 increasing/31 stable pairs. Missing cohorts remain unknown, and ambiguous identities are not paired.

Historical source checks preserve the reported2567 province/agency total discrepancies andพบพระ2565 coverage115.43%. The latest two years are recomputed from counts, retaining original reported values in quality entries; this corrects the supplied child-centre2569 0/0 to coverage67.90% and positivity5.45%. Broad affiliation grouping and the child-centre spelling alias are documented. Historical controls have their own scope: no denominators are fabricated from old percentages and no lines connect missing points. Species history uses reported-positive people as denominator; annual/comparison species rates use tested people.

Verified on3 November2026 against the frozen production build and fresh localhost8085 backend:

- `npm run build`: TypeScript/Vite passed.
- `.venv/bin/python -m pytest -q backend/tests`: **117 passed**; one pre-existing Starlette/httpx deprecation warning.
- `HELPMINTHS_TEST_URL=http://127.0.0.1:8085 node --test tests/health-dashboard.test.mjs tests/health-snapshot.test.mjs tests/history-dashboard.test.mjs`: **17 passed** (7 Google regressions,5 real snapshot cases,5 real history cases), no browser errors or API writes.
- `HELPMINTHS_TEST_URL=http://127.0.0.1:8085 npm run test:offline`: **2 passed**, including preparation of previously unvisited application features and update-integrity handling.
- `pip check`, browser-script syntax and `git diff --check`: passed.
- `scripts/capture-survey.mjs`:8 actual screenshot captures with source-version,170-school/108-eligible,167-matched and13-year guards, including comparison/trend/past-year views. Archive-origin limitations remain stated; these are not model or participant-evaluation evidence.

The source/model diagnosis integration files were not changed by this Dashboard work. Optional clinical AI remains dependent on a separately configured trusted detection model; Dashboard survey statistics do not provide trained weights or clinical accuracy evidence. Render still uses manual deployment, so Git updates alone do not update the public service.

## Named parasite checkpoint configuration — 3 November 2026

The owner identified `models/parasite_yolo.pt` as the intended diagnosis checkpoint. Its bytes remain unavailable: the original uploaded ZIP exceeded the32MiB transfer limit, the latest supplied GitHub main tree contains no such file, and the direct raw model URL returned404. A file path is therefore configured/prepared, but no actual checkpoint has been read, loaded, evaluated or deployed in this update.

`YOLOModelService` now discovers that exact file relative to the repository root when no explicit argument or nonempty `HELPMINTHS_MODEL_PATH` is supplied. Explicit paths retain priority, an explicit empty constructor argument disables loading, and an invalid environment path never silently falls back. Missing default weights stay unconfigured without importing Ultralytics or triggering model downloads. Prediction, label mapping, bounding boxes, quality checks, account permissions and model SHA metadata remain unchanged.

Packaging now allows only the named checkpoint through the Docker model/weight exclusions. A tracked `models/README.md` keeps the directory available in a clean checkout; checkpoints remain Git-ignored until an operator intentionally supplies one. When the actual file exists in the Docker build context, Docker installs CPU-only torch/torchvision plus the existing YOLO requirements, constrained against the installed CPU versions and base dependency lock. Without the file, the ordinary lightweight application is retained. No checkpoint, random pretrained replacement or production fixture was generated.

Verification: full backend suite **125 passed**, including8 new path/configuration cases and existing API/permission/quality regressions; `git diff --check` passed. The new tests use isolated, explicitly labelled runtime stubs only, so their success is not checkpoint inference or clinical accuracy evidence.

Full Docker rebuild was attempted with both default and host build networking, using a temporary writable Docker configuration directory. Both reached the pre-existing base dependency installation step and failed because package-index DNS resolution was unavailable inside the build. The new model-dependent install branch was not reached. Consequently the new full image and CPU model branch have not been verified in this environment. Actual checkpoint/library compatibility, real-image inference, memory use and Render deployment remain untested until the model file is supplied.

## Owner-selected Drive model delivery — 6 November 2026

The owner supplied Google Drive file `1gw6sXzWF1bH4ikYcyOxVi7L4I5MFwK1N` for the requested replacement from `results.zip`. That source is now committed in `models/source.json`. The development proxy rejects connections to Google Drive before reaching Google (tunnel403 on the sharing and download hosts). This is not evidence that the file's sharing permissions are wrong. The new artifact has not been downloaded, its contents/classes/training results have not been inspected, and its SHA is not yet known.

Docker now fetches that selected source at build time, handles ordinary public Drive download confirmation, selects a unique `weights/best.pt` (or an unambiguous best/single checkpoint), and installs it as `models/parasite_yolo.pt`. Selection ambiguity, failed access, invalid ZIP/checkpoint structure, incomplete transfer or an optional model-SHA mismatch stop the build. Download512MiB/checkpoint256MiB limits, bounded CRC reads, safe member selection, temporary files and provenance publication are covered by tests. The fetcher does not deserialize the checkpoint or run archive scripts. The selected checkpoint is loaded only in the subsequent detection-runtime check. No older uploaded checkpoint or generic pretrained model is substituted for a failed selected-source fetch.

The model branch installs CPU torch2.5.1+cpu/torchvision0.20.1+cpu and the existing model requirements, constrained against the base lock and CPU wheels. A build gate loads the detector and runs its normal prediction method on a blank synthetic640×640 image. It checks output format, finite coordinates and confidence, and reports the actual checkpoint SHA, class names, elapsed time and process peak memory with `diagnostic_accuracy_evaluated:false`. Successful synthetic inference is a runtime compatibility check, not evidence of diagnostic performance or full API-worker memory use. New-source compatibility and Render memory requirements remain unknown until that artifact is available.

Verification of this change:

- Full backend suite: **171 passed**, one pre-existing Starlette/httpx deprecation warning. The41 download/import tests and5 build-probe tests use explicitly synthetic data or runtime stubs; they do not certify any actual Drive model.
- The actual configured-source CLI returned a sanitized nonzero network error here. It left no checkpoint, provenance or temporary file behind, and no model was copied into the repository as a fallback.
- Separately, the new verifier ran successfully against the earlier private6,485,482-byte upload, SHA-256 `5615bcfcd4f0e283a48a59ec74b2457506b6cc98dc059fda0e9477c8580ad11a`, using local Ultralytics8.4.193: eleven class names, zero detections on the synthetic input at confidence0.99,3.557seconds and385.1MiB CLI-process peakRSS. This is the **earlier upload only**, not the new Drive ZIP. It was kept outside Git and does not establish accuracy or the memory consumption of the full service.
- A clean Docker build with explicit `HELPMINTHS_FETCH_MODEL=0` reached the unchanged base pip dependency step, then failed on package-index DNS resolution. It did not reach the fetch/model branch; the full image has not been verified in this environment. No frontend source changed.

Render still has `autoDeploy:false`. The owner must use **Manual Deploy → Deploy latest commit**, inspect the build result, then check `/api/health` for `model_ready:true` and `model_name:parasite_yolo.pt`; HTTP200/Live alone does not establish model readiness. No new Render environment settings are required for the committed default source. Updating the contents at the same Drive URL requires a source/hash change or a cleared build cache. Actual new-artifact download, inference, independent clinical evaluation and public-service deployment are not reported as completed.

## Aqua/coral instrument interface — 6 November 2026

The owner requested the presentation of the supplied Medusa JF-4 field-simulator reference while retaining HelpMinths functions. The design now uses pale aqua, deep teal text, coral accents, translucent instrument cards, subtle specimen rings and a compact navigation shell. Thai text keeps local fonts and normal page scrolling. The reference's robot model, simulated gauges, external font/CDN dependencies, viewport-shrinking typography and global Space handler were not imported.

The home field reuses the actual existing Atlas renderer for OV, Ascaris and Taenia. Selection, internal-structure explanations, cutaway, rotation/pause, zoom/reset and links to the selected full Atlas entry are interactive. Atlas catalogue counts come from the existing reference data and are labelled separately from detection-model readiness. Reference sizes are explicitly not screen calibration. The home scene starts paused for reduced-motion preferences and retains an explicit2D fallback when WebGL is unavailable. Mobile has a direct upload/camera entry before the specimen viewer. The new skip link focuses the main content without changing the current route.

Scan, quality results, Atlas comparisons and stage/Strongyloides panels, public survey Dashboard, account/report/learning screens and SUS share the new visual surfaces. Analysis APIs, quality rules, boxes/class mapping, model/source settings, authentication/authorization, stored records and survey data are unchanged by this interface task. All ten navigation entries and existing entry points remain available.

Verification against the locally running production build, using Chromium software WebGL:

- `npm run build`: TypeScript and Vite passed. New UI assets are included in the existing integrity-versioned offline build.
- Existing analysis/Atlas browser suite: **14 passed**, covering demo/export/history, file validation, exact model-label mapping,3D picking, credited real-photo comparison, independent zoom/pan/pinch, Ascaris stages/decortication and Strongyloides genital primordium.
- Existing SUS suite: **5 passed**, preserving all ten questions, fifty radio controls, keyboard answers, score calculation, explicit local save, drafts, storage failures and no remote submission.
- Existing public Dashboard suites: **17 passed**, preserving real annual totals, filters,170-school listing/follow-up, matched-year comparisons, historic charts, provenance, stale/source/access handling and phone/tablet/desktop layouts.
- Existing offline suite: **2 passed**, including previously unvisited Atlas/local fonts/photos/demo and update-integrity/failure handling. API responses and private images remain outside the app cache.
- Existing authenticated platform suite: **4 passed across the full run and focused reruns**, covering quality acknowledgement, saved predictions, expert review/audit, real PDF/CSV bytes, feedback, role isolation, learning approval and unconfigured layouts. The initial expired-cookie check exposed a test race: the feedback list refresh legitimately returned401 first and cleared identity before the specifically observed Dashboard request. The test now waits for that preceding refresh to finish before expiring the cookie; its Dashboard401 and private-state-clearing assertions remain intact. The affected scenario passed again with this synchronization; production auth logic was not changed.
- New field-interface suite: **3 passed** on the final build. It checks actual WebGL anatomy/zoom/cutaway/selection links, reduced-motion rotation, route-preserving keyboard skip navigation, honest fallback, immediately visible mobile upload/camera access, all ten menu entries and SUS at320/375/768/1024/1440px without horizontal overflow. One initial new-test failure was an incorrect heading locator, corrected to the actual existing Atlas specimen heading; no application assertion was removed.
- `scripts/capture-interface.mjs`: **8 actual desktop/mobile screenshots** of home, scan, Atlas and Dashboard, stored outside Git with a manifest. The capture refuses configured/account/clinical-fixture services. No patient images or invented clinical results appear. Build and browser checks verify software behavior, not diagnostic accuracy or a participant usability study.

The code update still requires manual deployment on Render. Local previews, screenshots and Git changes do not establish that the public service has deployed this interface or the separately selected Drive checkpoint.

## Accounts, expanded rasters and expert referral workflow — 6 November 2026

Implemented the owner's seven follow-up requests. File selection accepts any suffix, while actual bytes must identify a supported raster decoder. Pillow plus pinned pillow-heif1.8.1 now handles HEIC/HEIF, AVIF, TIFF, BMP, GIF and the installed safe raster formats in addition to JPEG/PNG/WebP. A non-persisting `/api/images/normalize` endpoint enables browser-incompatible formats; the existing image-work slot and request limits remain. Normalized output is also bounded20MiB, with no hidden resizing/cropping. GIF/WebP previews freeze their initial frame; TIFF/HEIF processing selects the first page/frame, applies orientation, strips EXIF, composites transparency on white and reports conversion notes.16-bit TIFF maps its full range to8-bit. RAW/DNG, SVG, PDF, EPS and32-bit/float images require conversion. This is broad raster support, not a claim that arbitrary files or every conceivable codec can be opened.

Removed the scan JSON-export control and its download implementation, the Learning Lab navigation/Atlas entry/route, and the annual-history “ข้อค้นพบสำคัญจากข้อมูลรายปี” block. The9 remaining navigation entries, Atlas references, survey calculations, annual graphs and PDF/CSV reports remain. The old learning backend/catalog is retained for compatibility; it is not advertised as an available menu.

Public registration creates only an owner-scoped `lab` user, including for the first signup. Account updates require the current password, preserve the owner ID, rotate the session/CSRF token and revoke other sessions. Administrators approve expert roles; no public role selector elevates a user. Optional first-admin web setup requires a strong host-owner secret and closes once an active administrator exists. Operator CLI bootstrap still works after ordinary signup and never seeds credentials. Expert password confirmation is session-bound for15minutes; role change, logout, account change, expiration or locking prevents reuse. Cross-owner clinical analysis/image access and expert review writes require that server-verified state. Password reconfirmation is not MFA or automatic professional credential verification.

Referrals are separate, private documents pointing to existing saved images and immutable predictions. Only the owner can submit a completed saved analysis with a reason. Active submissions are deduplicated, revision checks serialize review changes, and deleted analyses disappear from the queue. Experts return actual confirmation/comments to the owner. Daily history uses Asia/Bangkok dates, owner-only scopes for all roles, bounded day/list pagination, and excludes pending/in-review/needs-more referrals. Confirmation returns the original record to its original examination day without duplicating the image or replacing the AI output. Owners retain access to replies and previously answered referral records.

Verification:

- Production TypeScript/Vite build passed; dependency compatibility checked with `uv pip check` (**61 packages compatible**).
- Full backend suite: **263 passed**, one pre-existing Starlette/httpx deprecation warning. New cases exercise genuine synthetic raster/HEIF/AVIF encoding/decoding, conversion/output limits, metadata stripping, registration, one-time owner setup, account/session/CSRF isolation, step-up expiration/locking, referral deduplication/revisions/replies/deletion and Thai daily boundaries. Existing expert test helpers now explicitly reconfirm passwords; owner-denial assertions remain.
- Browser suites against the production build: **49 passed**: analysis/Atlas14, SUS5, field interface3, authenticated platform4, public survey/history17, offline2, expanded image upload2 and new registration/referral/account workflow2. These use anonymous local pages or guarded localhost synthetic clinical fixtures, never real patient records. Replaced obsolete JSON/Learning expectations with removal assertions while retaining exact model labels/boxes, demo history, reports/audit, account isolation, survey provenance and offline integrity checks.
- An additional actual first-admin web UI check on an isolated temporary localhost database passed: wrong-token403, one-time owner claim201, no expert bypass, normal subsequent signup remains lab, and375px layout. The fixture secret and credentials were explicitly synthetic, never used or committed as production defaults.
- Eight public desktop/mobile screenshots were captured with the existing unconfigured/non-fixture guards and a manifest outside Git. No private clinical screenshots or invented clinical results were published. `git diff --check` passed.

The owner confirmed that the current Render service is Free and has no persistent disk/database. No paid plan, volume or external storage was provisioned, and no temporary directory was automatically presented as durable clinical storage. Current public registration/history/referrals require a configured private data directory; durable online operation still requires an actual mounted volume or a separately implemented external-storage adapter. The new Thai deployment/account guide documents this material limitation, the no-hosting-cost local option, HTTPS/cookies, initial administrator setup and expert approval. Model/Drive source selection is unchanged and no new diagnostic-accuracy or public-Render deployment claim follows from these software tests.

## Automatic account storage and readiness — 6 November 2026

The owner subsequently requested that account setup and data storage work immediately. Docker and the Render Blueprint now opt into `HELPMINTHS_AUTO_STORAGE=1`. Without an explicit data path, the existing private SQLite/image store initializes under `/var/lib/helpminths`. Ordinary users can register and log in directly from Settings without first creating an administrator. No account, password, administrator or clinical result is seeded. Existing ownership, CSRF, session, expert approval and password-reconfirmation rules remain in place.

An explicit constructor path or environment path retains priority; explicit disabling and invalid-path failures do not silently fall back. Automatic storage always reports `durable:false`, even under a stale durability declaration. Settings visibly labels temporary storage and warns that accounts and results can disappear on host restart or deployment. It also refreshes the actual server session on opening and provides a retry control, so an earlier unavailable response does not permanently disable account forms. The status API reports authentication readiness separately from pending administrator setup.

Verification:

- Production TypeScript/Vite build passed. Full backend suite: **277 passed**, with one existing Starlette/httpx deprecation warning. The 14 new automatic-storage cases cover selection priority, private permissions, no seeded records, real registration/login, saved synthetic images/results retained when reopening the same filesystem, owner isolation and honest temporary status.
- The new account-readiness browser test passed against the production UI, using isolated GET responses to exercise stale-unavailable recovery and enabled forms without mutations. It also checks temporary-storage wording and the 375px layout.
- A separate real HTTP/browser check against an isolated automatic-storage instance passed signup (201, ordinary `lab` role), page reload, logout, login (200, same account) and the mobile layout without browser errors. Only the automatic directory location was remapped into temporary test storage; account APIs were real.
- An isolated `python:3.12-slim` Docker runtime initialized the actual default `/var/lib/helpminths`, registered a real synthetic account and logged in from a fresh Python process on the same container filesystem. The container used existing pinned dependencies mounted read-only, no network and no clinical data. This is a storage/runtime check, not a full production Docker rebuild or model test.
- `git diff --check` passed. The prior account/referral workflow tests remain included in the full backend suite; the preceding 49 browser regressions are documented above.

No paid resources or persistent volume were provisioned. Render Free data remains temporary, and process reopening on the same filesystem does not prove retention across a Render restart/deploy. No Render deployment credentials are available here, and public status reads were blocked by the execution proxy. `autoDeploy:false` remains unchanged: the owner must select **Manual Deploy → Deploy latest commit**. The selected model download/build gates are unchanged; local account tests do not establish actual Render deployment, model readiness or diagnostic accuracy.
