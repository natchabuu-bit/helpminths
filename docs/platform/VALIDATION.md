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

## Simplified account rules and Settings — 6 November 2026

At the owner's request, usernames now have no minimum/maximum character-count policy. They must still be nonempty and follow the existing ASCII letter/number/dot/hyphen/underscore syntax, starting with a letter or number. Registration, login, account changes, expert confirmation, administrator setup and user management accept the same username syntax. Existing request-body limits remain, and login rate-limit account keys use fixed-length hashes rather than retaining arbitrarily long usernames.

Passwords now require at least four characters, without uppercase/lowercase/digit composition rules. This applies to registration, changes, administrator-created accounts and resets, and interactive bootstrap. The existing 1,024-byte hash input limit, salted scrypt format and existing-account compatibility remain. Administrator setup secrets have their separate existing bounds; this change does not grant expert or administrator roles.

Removed the requested registration-note sentence and the entire “สถานะระบบที่ตรวจได้” section, including its technical state grid and operator details. Actual readiness/retry and the material temporary-storage notice remain. Account text wraps at phone widths with long usernames. The active account/CLI guides now describe the new rules.

Verification: production TypeScript/Vite build passed; full backend suite **294 passed** in 19.39 seconds, with the existing Starlette/httpx deprecation warning. The 17 new credential cases exercise real HTTP/CLI creation, login, self-edit, admin setup/create/reset, expert confirmation, one-character and over-150-character names, lowercase-only and numeric-only four-character passwords, shorter-password rejection, duplicate names, role isolation and the existing byte bound.

Browser suites against a fresh isolated production-build fixture: **4 passed**. Actual UI registration with a one-character name and `abcd`, update to a name over 100 characters and `1234`, session revocation, logout/login and 375px layout all passed. Existing referral/expert/account-security cases passed. The readiness test also checks native form validity, removed text/heading and retained temporary-storage wording. All credentials and images were explicitly synthetic local fixtures. `git diff --check` passed. Render still requires manual deployment; these checks do not establish that the public site has updated.

## Password visibility and direct expert referral — 7 November 2026

Removed the requested temporary-storage notice from Settings, decorative key/lock icons and the app-wide offline panel. The storage configuration remains temporary where it was temporary; no disk or hosting plan changed. Offline registration, integrity checks and the static cache still run from the existing application entrypoint. The active guides describe the interface without the removed notices.

The reusable `PasswordInput` adds show/hide controls to account passwords, confirmations, administrator setup/reset fields and expert password confirmation. Inputs start hidden; toggles use type="button", preserve field values and accessible names, and expose pressed/control state. Authentication, password rules, session rotation, administrator approval and expert step-up remain unchanged.

Sample labels are optional and accept free text including Thai without the former ASCII/40-character restriction. Blank labels receive `HM-<analysis ID prefix>` once after quality acceptance; history, the accepted quality record and referrals share that label. Image paths still derive only from the full generated analysis UUID. Existing whole-request size limits remain.

Completed saved results now offer “ส่งภาพให้ผู้เชี่ยวชาญยืนยัน”. The handler obtains the current owner/completed state and revision, posts a real referral with a default review request, then opens the selected image in Expert Verification. Failed submissions retain the result and allow retry; existing active referrals are deduplicated by the server. The custom-question referral form also opens the review page after success. Demo results never submit; session-only results direct the user to sign in and analyse/save before sending. Pending referrals remain separate from daily history.

Verification:

- Production TypeScript/Vite build passed. Full backend suite: **299 passed**, with one existing Starlette/httpx deprecation warning. Five new cases cover omitted/blank/whitespace labels, long Thai/path-like text, stable history/referral labels and UUID-only image paths.
- Account/readiness/referral browser suites: **6 passed** on a fresh guarded localhost synthetic fixture. These exercise show/hide without changed values or accidental submissions, existing ownership/session/expert rules, blank-label analysis, no demo writes, a simulated referral 503 with no database write or revision change, a successful real retry (201), automatic selected-private-image navigation and exclusion from daily history.
- Offline browser suite: **2 passed**. Tests query the actual service worker rather than the removed panel. Unvisited Atlas/assets/demo remain usable offline, API/private data remain outside the static cache, and incomplete installs, failed updates, asset eviction/recovery and update integrity retain their checks.
- `git diff --check` passed. Tests use only synthetic local accounts/images, not clinical accuracy evidence. Render remains `autoDeploy:false` and no Render deployment credentials are available here; the public service still requires **Manual Deploy → Deploy latest commit**. No public deployment or new model-readiness claim is made.

## Owner approval and expert case lifecycle — 7 November 2026

All public general/expert registrations now create pending accounts with no authenticated cookie or CSRF session. Correct credentials for pending/rejected accounts do not authorize private APIs. Only the server-verified owner can list/manage/approve/reject accounts; an ordinary admin role alone does not grant these capabilities. Approval, rejection, role changes and password changes retain audit records and invalidate affected sessions. The owner cannot be demoted, rejected or disabled by the account-management API. Owner-created approved accounts are explicitly presented as creation plus approval.

The requested owner login name is `Super Admin`, including its internal space. Usernames support internal spaces, and the normalized configured owner name is reserved from public signup and non-owner renaming. The environment/CLI host-authorized setup remains mandatory; no production password, setup token or privileged account is seeded. The first-setup name is read-only in the UI. Approved experts have a dedicated sign-in/registration portal; expert sign-in performs the same password verification and grants the existing 15-minute session-bound clinical access. Ordinary users cannot use that portal to elevate their roles.

Schema 2 has an explicit atomic migration from schema 1. It preserves user IDs, password hashes, clinical documents and old audit data; the oldest active established admin becomes the owner, other existing accounts await approval, and all pre-migration sessions are revoked. Existing owner names/passwords are preserved. Unknown schema versions still fail rather than being guessed or overwritten. The new owner/account guide describes activation, approval and the unchanged temporary-storage limitation.

Experts can send dated replies or request additional images, without marking the case clinically confirmed. Replies, requests, supplemental image events and final confirmations form a paginated, private conversation timeline. The submitter can upload a requested image; bounded normalized PNGs use generated private filenames, retain no supplied metadata, and requeue the same referral. Live roles, ownership, expert verification and revisions are checked, including after image decoding. Read-only students cannot upload even when they own an older record. Failed/conflicting writes clean up temporary image bytes; deleting the source analysis also removes supplemental bytes. The original AI prediction/image remains distinct.

The waiting queue includes open and needs-more cases; final confirmation moves a case to completed only through the existing complete-annotation/full-image review checks. Expert responses do not silently bypass those checks. Per-account history starts with all dates and all records, with waiting/completed filters, Thai day/time grouping and access to original results and dated responses. Supplemental uploads do not create another initial analysis or change its examination date.

Verification: production TypeScript/Vite build passed on the final source; full backend suite **334 passed**, with one existing Starlette/httpx deprecation warning. New cases cover pending/rejected access, owner uniqueness/reservation, approval filters/revocation, atomic migration/data preservation, expert portal verification, replies/request-more, private attachment limits/ACL/concurrency/cleanup, read-only demotion and all/waiting/history date filters. A separate actual first-owner UI check on an empty isolated database passed exact-name prefill, invalid token 403 with no owner created, valid claim 201, protected owner UI and reserved-name signup rejection. Its random credentials stayed in the test process; the temporary server/database were removed. No public owner account was created by that test.

The final serialized production-build browser invocation passed **11/11 cases** in 149.65 seconds across account readiness, authenticated platform and referral suites. It exercises real public expert registration without a session, pending-login refusal, actual owner UI approval and rejection, dedicated expert sign-in, request-more, owner private image attachment, requeue, full annotation confirmation and owner history retaining its original Thai day. It also retains credential visibility/rotation, read-only roles, PDF/CSV/audit and cross-account isolation. Locking the expert session denies both original and supplemental images. The scan retry case verifies no write on a simulated failure and a real successful retry with automatic selected-image navigation. Setup helpers reuse actual owner sessions and respect the real rate limiter with a bounded asynchronous Retry-After cooldown; production throttling was not relaxed. Prior signup assumptions were replaced by real pending/approval/login flows, and history tests check both all-record and completed-only behavior.

`git diff --check` passed. No new dependencies, paid resources, hosting changes or model/accuracy claims were introduced. Source changes do not establish public deployment. First ownership still requires the host-owned setup secret or CLI; the actual owner password is chosen by the user. Render remains manual-deploy and its free filesystem remains temporary, so durable historical retention requires persistent storage outside this change.

## Dedicated Super Admin backoffice — 9 November 2026

Added the direct `#admin` route with the heading “หลังบ้าน Super Admin”, an owner-only “หลังบ้าน” navigation item and a prominent “เปิดหลังบ้าน” button in Settings. A logged-out visitor can open the direct link, enter through Settings and return to the backoffice after actual owner authentication. Existing inline Settings management remains compatible. The backoffice reuses the real owner-only approval/member APIs, starts on pending requests, and supports approvals, rejection, role selection and member filters without seeding accounts or changing authorization.

The page waits for session loading and gates unconfigured, disconnected, anonymous and nonowner states before mounting member resources. An ordinary admin role without the owner flag has no backoffice access. First-owner guidance remains visible when no owner and no setup token exist, including the host-owned activation requirement; a username alone never grants ownership. All user-facing “พอร์ทัลผู้เชี่ยวชาญ” wording in Settings now uses “ผู้เชี่ยวชาญ” or the corresponding action phrase. Internal variable names do not affect displayed text.

Verification: production TypeScript/Vite build passed. The new guarded browser suite **6/6 passed**, exercising anonymous-to-owner login return, both navigation entries, actual general/expert approvals and rejection, unchanged server 403 isolation, a nonowner admin account, public/member/owner phone layouts at 375px, missing-host-token guidance and removal of the requested wording. The existing account-readiness browser case also passed (**1/1**). All mutations used an isolated localhost synthetic fixture; no real accounts or clinical images were used. `git diff --check` passed. Backend implementation and schema were unchanged, so the prior 334-test backend result was not rerun or presented as a new validation run.

No Render deployment connection is available here. The public `https://helpminths.onrender.com/#admin` link requires deployment of this source; `autoDeploy:false` remains unchanged and the owner must select Manual Deploy → Deploy latest commit. Existing owner activation and temporary-storage constraints remain as documented.

## New live school-summary sheet — 9 November 2026

The owner selected spreadsheet `1pvGSBJEykTf5NUEsd3SqVdOqpYbpibTj07p23yJ5o-8` and confirmed the same school/area/student/test/parasite report layout, with edits to cells and rows. Docker and the Render Blueprint now explicitly select `google_sheets`, that ID, the `health2-kpd-school-v1` preset, public aggregate publication and 30-second refresh. Empty GID selects the first tab; configured worksheet/GID overrides remain available. Deployment environment overrides still take priority, so an existing Render service with old values must update those values. Local execution without deployment environment retains the earlier snapshot default.

The explicit live school preset retains district/affiliation/status/prevalence-band/search filters, dynamic named tested-school statistics, weighted ratios, parasites and exact-prevalence follow-up ranking for schools with at least 30 tested. It does not hard-code 170 schools or a historical year. Year comes only from an explicit configured value or an unambiguous source header. Duplicate/total rows, contradictory counts, missing values and unknown areas retain validation and warnings; different affiliations for an otherwise duplicate school are treated as ambiguous rather than merged silently. Raw personal columns/notes are not projected.

The UI distinguishes live Google Sheets from imported workbooks, shows the poll interval and last successful read, and preserves the last valid same-source payload visibly as stale on transient fetch/header failures. New payloads are validated before replacing the cache; another source/configuration cannot inherit old data. Historical workbook comparison panels do not impersonate the new sheet. No imported-file fallback is used when the selected live source fails. Reading/polling is bounded and read-only, with no Google writes or changes to sharing permissions.

Verification:

- Production TypeScript/Vite build passed. Full backend suite: **348 passed**, with the existing Starlette/httpx deprecation warning. The 14 new live API cases cover changed cells/rows after cache expiry, rich filters and denominators, privacy, first-tab requests, strict headers, stale recovery, source changes, year provenance and duplicate ambiguity.
- Browser suites: **11/11 passed** (four new live-sheet cases plus seven existing dashboard cases). Explicitly synthetic API fixtures drive the actual 30-second scheduler with the browser clock, changed totals/school membership/timestamps, stale retention, source switches, rich filters/follow-up eligibility, public access errors and phone/tablet/desktop layouts. Requests remain no-store with no mutations; tests do not establish real Google data or totals.
- A minimal isolated Docker image using the actual Dockerfile ENV block verified source selection, JSON preset quoting, empty GID, public flag and 30-second refresh at runtime. Render YAML values were separately parsed and checked. This is an environment/configuration probe, not a full application/model Docker rebuild.
- A real application request configured with the new ID returned Google Sheets metadata with the correct ID/interval/access, then `status:unavailable`, `fetched_at:null`, `data:null` and `error.code:connection_failed` on the actual upstream attempt. Direct Google access also failed at the execution proxy with tunnel 403 before reaching Google. This does not establish that the sheet is private or mis-shared. No old workbook totals or synthetic replacements were returned.
- `git diff --check` passed. No new credentials/dependencies/paid resources were introduced. Actual worksheet contents, sharing access, live totals and Render deployment remain unverified here; after Manual Deploy the operator must check `/api/platform/operations/status` and `/dashboard` for the new source and `status:ready`. Cell edits thereafter require no new application deployment. This is periodic polling, not immediate Google edit notifications.

## Restore the original populated dashboard — 9 November 2026

The owner reported that all dashboard information disappeared after the unverified live-sheet source was selected and explicitly requested the original dashboard back. Restored Docker, Blueprint and example configuration to the original committed snapshots. Added `HELPMINTHS_DASHBOARD_RESTORE_SNAPSHOT=1` as an explicit restoration setting evaluated before stale source/Sheets environment values. This makes the deployed restoration effective even if Render still has `HELPMINTHS_DASHBOARD_SOURCE=google_sheets` or the new sheet ID set. It does not present an implicit live-source fallback as current data: metadata/UI remain `uploaded_workbook`, imported time and refresh interval zero. Opting out preserves the existing connector/access rules; malformed restore values and missing snapshot files fail honestly.

Original data files are unchanged from the last working pre-live-source commit `bfa5d12`. Actual snapshot responses show 2569: 15,888 tested, 698 reported positive, 170 published school records and 108 eligible for follow-up at 30 or more tested; 2568: 15,106 tested, 974 reported positive and 169 published schools. Annual comparison and 2557–2569 history remain available. No source counts, import dates, personal records or other app features were rewritten.

The newly supplied Drive folder `1a5wiQ9_0W-yzDBiq35Act6-s1_dYn1vq` could not be opened: the execution proxy returns tunnel 403 before reaching Google. Restoration therefore uses the original repository artifacts, not an unverified import from that folder. This is not evidence that the folder's Google sharing permissions are wrong.

Verification:

- Full backend suite: **353 passed**, with one existing Starlette/httpx deprecation warning. Restoration cases cover stale/invalid Google settings, zero upstream requests, exact source/timestamp/totals, both years, filtered CSV, history, opt-out private access and missing-artifact/invalid-flag failures.
- Actual production-build browser suites: **10/10 passed** (five snapshot and five historical-dashboard cases), using real public APIs and the original data without API response mocks. Checks include all named schools, follow-up threshold/search/CSV, province/status/year filters, charts, annual comparison with 167 matched schools, historical charts/heatmaps and mobile/keyboard layouts. The server deliberately retained the old Google source/ID settings alongside the restoration flag.
- An anonymous spot-check confirmed `ready`, `uploaded_workbook`, `2569.xlsx`, `refresh_seconds:0`, and the unchanged import/fetched timestamp `2026-10-31T13:50:19+00:00`; no Google requests, writes, cookies or browser errors were observed. A screenshot of the restored public statistics was saved outside Git at `/workspace/helpminths-restored-dashboard.png` and visually inspected.
- A minimal isolated Docker runtime using the actual ENV block and read-only installed dependencies confirmed that its default restore flag wins over an externally supplied old `google_sheets` source. This is a configuration/runtime probe, not a full production model-image rebuild. The frontend source/build is unchanged by this restoration.
- `git diff --check` passed. Actual Render deployment still requires Manual Deploy → Deploy latest commit; no hosting credentials or paid resource changes were used. These local checks do not claim the public site has already redeployed.

## Working owner credentials and visible approval controls — 9 November 2026

The owner could not enter the backoffice because no actual hosted owner password had been provisioned, and the prior flow redirected to Settings or required a separate host setup token. Added optional startup-only `HELPMINTHS_SUPER_ADMIN_PASSWORD`: the host owner chooses the actual password in Render Environment, then startup creates an approved `Super Admin` or recovers the same established owner ID. There is no fixed/shared/default password in source, Docker or Blueprint. An unchanged host password does not undo later account name/password edits while the same database remains; a changed host value explicitly recovers credentials and revokes owner sessions/expert verification. The last applied value is represented by a separately salted scrypt hash in a private, unaudited marker, not a cheap password fingerprint. Name/marker collisions fail without altering unrelated accounts/documents; invalid configuration reports a sanitized status without taking the public dashboard down. Concurrent app workers serialize this operation atomically.

Added owner-only `POST /api/platform/owner-signin`, checking approved/active/actual ownership before cookie creation or login audit. Wrong credentials or ordinary accounts do not replace/clear an existing session. Session/status metadata provides the actual owner login name and sanitized bootstrap readiness, with no password, hash or environment value. Legacy bare-router unconfigured session responses retain their original minimal contract; the real application includes startup status. Token setup and CLI remain compatible.

The backoffice now contains its own username/password form, show/hide control and a direct “เข้าสู่หลังบ้าน” action. It no longer requires a primary-login detour through Settings. First-use/recovery instructions use one host password setting. Pending membership cards show name/status, target role and compact full-size approve/reject controls before expandable metadata, retaining complete accessible account names and timestamps. Approval instructions are collapsed below the member list; the duplicated settings button above the list was removed because the existing account navigation remains available. This addresses approval controls being below the phone viewport without shrinking text or relaxing access checks.

Verification:

- Final production TypeScript/Vite build passed. Full backend suite: **372 passed**, with one existing Starlette/httpx deprecation warning. Nineteen new actual-application integration cases cover initial creation, recovery without changing owner IDs/history, unchanged host settings after web edits, atomic workers/migration, session revocation, reserved names/marker collisions, invalid configuration, secret/audit protection and owner-only sign-in.
- Final browser checks: **7 passed**: six existing backoffice cases plus one complete fresh-database startup workflow. The latter verified exactly one startup-created approved owner and zero initial applicants, wrong-password denial, actual direct sign-in, real general/expert requests and approvals, session switching/refresh, and member/admin/student denial by both UI and backend.
- Strict visibility checks passed unchanged at **375×1000** and **1440×1000**: the pending filter and first approval control are fully within the initial viewport. Earlier geometry failures identified a button below the phone fold; source-order/compact-label changes and removal of duplicated navigation fixed the layout. Password-free pending-request screenshots were captured outside Git under `/workspace/helpminths-owner-approval/` and reviewed.
- All passwords used in checks were explicitly synthetic values passed only to isolated localhost fixtures with private temporary databases and fixture headers. No production account/password was created by those tests. `git diff --check` passed. Dashboard restoration and existing image/model configuration remain unchanged.

Actual Render management credentials/deploy hooks are unavailable in this session, and public status probes fail at the execution proxy. The real host owner must set the private password variable and deploy this source before live sign-in can be claimed. No secret was committed or proposed as a universal login, and no public ownership bypass was added.


## Registration profiles, separate admin site and per-case responses — 9 November 2026

Registration now requires a full name, workplace, affiliation and a ten-digit phone number for both ordinary users and experts, with browser and server validation. Schema 3 migrates existing schema 1/2 stores atomically. Upgrading from schema 2 preserves IDs, hashes, roles, approvals, sessions, clinical documents and previous audit entries; legacy/operator accounts can retain missing profile values and still sign in. Profile edits require the current password and rotate sessions. Applicant identity/contact details remain within the account and owner approval APIs, and are excluded from the public survey dashboard.

The Super Admin frontend has its own `/admin/index.html` Vite entry and dark application shell, served at `/admin/` by the same deployment. The public app no longer embeds member management or an admin navigation page. Existing `/#admin` links redirect to the new entry. The owner form and server ownership checks are preserved; separate frontend routing does not grant extra permissions. Missing admin builds/assets, traversal paths and external entry symlinks fail closed. Admin HTML is no-store/noindex, and the service worker maps only valid admin navigation to that entry while every private API still bypasses static caches. No separate domain or Render service was provisioned.

The public header now has an accessible account dropdown showing full name, role/approval status, Settings and Logout. The requested readiness strip, duplicated sidebar identity and decorative header captions were removed. The settings page keeps working registration/login/profile forms with concise guidance. Applicant approvals show the full name and retain workplace, affiliation and phone in expandable private details. Dark mobile controls retain readable contrast and full-size approval actions; an explicit accessible name fixes the icon-only mobile return link.

Each expert reply, request for more images, intermediate review and final confirmation creates a private notification for the submitting account in the same transaction as its immutable message. The inbox and read state are owner-scoped, including against other admins/experts. Notifications link to the exact analysis, referral and message; marking one read leaves the others unread. Concurrent/stale conflicts roll back both the response and notification, and deleted cases/referrals are omitted. The bell polls every 30 seconds while online/visible and when the tab regains focus. The selected answer appears prominently before image/model details; historical referrals remain read-only and conversation/audit details collapse. No emails or external messages are sent.

Verification:

- Final production TypeScript/Vite build passed with both frontend entries. Full backend suite: **426 passed**, with one existing Starlette/httpx deprecation warning. Coverage includes profile validation and migration preservation, current-password edits, notification ownership/CSRF/persistence/pagination, independent case/read states, exact historical messages, transaction rollback and separate admin static routing.
- The final separate-admin browser suite passed **6/6** and profile/notification workflow passed **2/2**. Actual signup → owner approval → login verifies both mandatory profile forms, full-name dropdown/Settings/logout, separate image-specific request/reply/confirmation notices, private isolation, exact-message navigation and persisted independent read state. Public/nonowner accounts never render or request the owner inventory.
- The fresh host-owner browser workflow passed **1/1**, exercising startup-created ownership, direct admin login, real user/expert applications and approvals, unchanged role isolation, and full visibility of the pending filter and first approval action at 375×1000 and 1440×1000.
- The full referral/account browser suite passed **6/6**, retaining actual expert approval, supplemental private images, requeue/final confirmation, credential edits/session rotation, password visibility and failed referral retry/history behavior. The readiness-removal/session-refresh browser case passed **1/1**.
- A focused service-worker browser check passed **1/1**: a first public visit precaches the distinct admin entry, offline admin navigation retains its dark shell without private inventory, returning to public Settings retains the light theme, and no private APIs enter static caches. This is static-shell offline support; authentication and clinical services still require the server.

All browser mutations used guarded localhost fixtures and synthetic accounts/images. Passwords were explicitly test-only; screenshots outside Git under `/workspace/helpminths-account-ui/` were visually reviewed at phone and desktop widths and contain no visible passwords. No live owner account, host secret, deployment, persistent disk or new diagnostic accuracy claim was created by these checks. Render remains `autoDeploy:false`; the host owner must select **Manual Deploy → Deploy latest commit** to publish this version. The existing temporary-storage limitation and restored dashboard data remain unchanged.


## Render frontend build-context fix — 9 November 2026

The Render deployment of `29e73ea` failed during Docker's `npm run build`: the multi-entry Vite configuration requires `/build/admin/index.html`, but the frontend stage copied only root configuration, `public/` and `src/`. The standalone admin HTML directory was absent. Added `COPY admin ./admin` before the build; `.dockerignore` already allows this directory. Application behavior, dependencies, credentials and data configuration are unchanged.

Verification used two clean temporary directories populated exclusively from the frontend `COPY` instructions, with the installed lockfile dependencies linked in for compilation. The previous Dockerfile input set reproduces the actual Rollup error, `Could not resolve entry module ... admin/index.html`. The fixed input set passes TypeScript/Vite and contains distinct public/admin HTML entries, all referenced entry assets, and the admin entry in the integrity-generated service worker precache. `git diff --check` passes. These checks verify build inputs and compilation, not a deployed service or model accuracy.

A separate attempt to build the actual Docker `--target frontend` was stopped after its dependency-install (`npm ci`) step produced no progress within the local probe timeout, before application compilation. It is not reported as a passing clean container build. Render's screenshot already shows its own dependency installation reached the later compilation step. Publishing this fix still requires Manual Deploy → Deploy latest commit; the prior failed deployment is not a successful publication of the new UI.


## Faster analysis preparation with unchanged model inputs — 9 November 2026

The requested speed improvement is deliberately confined to preparation: model code, checkpoint selection, normalization, PNG encoding, inference size, confidence/NMS, precision, device and runtime thread settings are unchanged. `Scan.analyze` no longer automatically uploads an unassessed image to the standalone quality endpoint and then uploads it a second time for analysis. It submits the same prepared file once; the existing analysis endpoint still decodes and enforces quality before inference. Warning responses populate the existing acknowledgement UI, known unacknowledged warnings remain blocked locally, and manual quality checks remain available. Successful analysis displays the authoritative server quality assessment.

The interior Laplacian quality metric uses optional NumPy int32 working buffers and int64 reductions, retaining the exact original variance expression and complete response. Supported thumbnails have at most 2048² 8-bit pixels; each squared Laplacian fits int32 and both integer sums remain below 2**53, so the old float sums and new integer sums are exact. The original scalar calculation remains the fallback without NumPy and for direct callers outside the supported bound. RGB input, Pillow resize/gray conversion, thresholds, metadata handling and PNG bytes are preserved. No dependency/version changes or model optimization are introduced.

Verification and evidence:

- Production TypeScript/Vite build passes for the public and separate admin entries. The Docker `COPY admin ./admin` deployment fix remains present. Final complete backend verification: **479 passed**, with only the existing Starlette/httpx deprecation warning. `git diff --check` passed.
- Three actual guarded localhost browser workflows pass: an accepted image uses one upload, unchanged bytes/configured confidence/full dimensions/expected detections and stored pixels; an initial quality warning creates no analysis and requires acknowledgement before an unchanged retry; manual quality checking remains available and analysis independently enforces quality.
- Exact quality tests compare a frozen complete legacy response against optimized and forced-scalar paths on flat/noisy/checker/ramp/edge/tiny/skinny inputs, extreme 2048² thumbnails, unrounded values and adjacent threshold boundaries, and all eleven licensed Atlas photos. They assert unchanged image pixels and metadata. A reproducible quality-only benchmark is available as `scripts/benchmark-quality.py`; 13 images × 5 measured repetitions gave median quality preparation **52.005 → 4.096 ms**, with identical JSON/pixels.
- An independent local real-checkpoint comparison used the previously uploaded original model SHA-256 `5615bcfcd4f0e283a48a59ec74b2457506b6cc98dc059fda0e9477c8580ad11a`, eleven licensed photographs and three paired steady-state repetitions (66 pipelines). Complete quality JSON, normalized RGB hashes, saved PNG hashes, and all detection JSON matched exactly. Median quality time was **43.907 → 3.347 ms**; local decode + quality + save + inference was **174.381 → 122.257 ms**; inference itself stayed approximately 39 ms. The initial setup call was excluded, and the runtime's actual four Torch threads were recorded without changing them. Artifacts are outside Git under `/workspace/helpminths-performance/`. This checkpoint can differ from the current Drive-selected deployment model; these are local timings and equivalence evidence, not production latency or clinical accuracy estimates.

The initial full backend run exposed a pre-existing concurrent SQLite journal-removal race during permission checks (466 passed, one failed). The fix ignores only FileNotFoundError for exact transient -wal/-shm/-journal names disappearing between stat and chmod, retains 0600, and propagates main/other-file disappearance, permission and I/O errors. Twelve deterministic regression cases plus the originally failing concurrent-owner test pass. This reliability fix does not affect image/model computation.

The application is not automatically deployed by these checks. Render still requires Manual Deploy → Deploy latest commit; no host plan, production checkpoint or paid resources were changed. Render Free startup/network/resource delays can remain. See [Thai performance notes](PERFORMANCE.th.md) for scope and verification commands.


## Clear AI/expert comparison and owner-only submitted-image archive — 9 November 2026

The user asked for unambiguous AI versus expert results and a Super Admin-only archive grouped by day and submitting account. The clarified scope is images actually submitted for diagnosis plus supplemental images, including quality-rejected and failed attempts; selecting a local preview, using standalone quality checks, format conversion and synthetic demo images do not create archive entries.

Added reusable diagnosis comparison with immutable original AI labels/counts, separately labelled confirmed expert labels/counts, reviewer/time/comment and per-object corrections, false positives and missed detections. Intermediate replies and requests for images explicitly remain unconfirmed. A final result requires verified status, full-image review and coverage of every original object; a confirmed zero result is explicit. On phones the confirmed expert panel appears first; owners can switch between AI and confirmed image boxes, with confirmed boxes selected initially. An old notification keeps its exact message below the latest authoritative result for that same referral round. Backend referral presentation now returns its own review snapshot/counts rather than a later referral's review. Read-only viewers no longer see a draft object editor.

Added owner-only archive list/detail/image/account/day APIs and dark backoffice navigation. Accepted decodable diagnosis submissions are normalized and encoded once into a private retained PNG before quality enforcement; operational history images link to those same immutable bytes. Rejected/failed/cancelled outcomes are retained, and supplemental images identify their parent case rather than pretending to have independent AI results. Authenticated compatibility-route submissions are archived with their original results too and share the normal account analysis quota. Anonymous unconfigured compatibility mode remains non-persistent. Archive and generic audit access require the actual approved active Super Admin, including against other admin/reviewer accounts with expert step-up.

History removal deletes operational bytes and soft-deletes the history record while preserving the owner-only archival copy and all original AI/review/conversation evidence; the confirmation dialog states this retention policy. Existing files backfill in bounded, resumable batches, including safe rollback/retry handling; missing historical bytes are reported honestly. Paths use random identifiers and metadata-free PNG, reject symlinks/traversal, and keep 0700/0600 modes. List pagination and lazy visible-image fetches bound browser work. Date/account filters group by Thai dates, and the frontend shows backfill progress while older records are collected.

Verification:

- Final full backend suite: **506 passed**, with one existing Starlette/httpx deprecation warning. Twenty-seven new archive cases cover all roles, rejected/failed images, attachments, retained deletion, legacy/backfill rollback, missing/symlink/copy failures, Thai midnight filtering, original predictions/reviews/history, authenticated compatibility snapshots and shared quotas. Related existing analysis/referral/notification cases also pass.
- Final production TypeScript/Vite build passed with both public/admin entries. Six actual browser cases passed on guarded localhost synthetic fixtures: two new comparison/archive integrations, three unchanged single-upload/quality-gate cases and the complete expert approval → request-more → supplemental image → final confirmation workflow. New cases include corrected/false-positive/missed/zero results, old notification clarity, exact archive access isolation, date/account filters, retained originals/attachments after history removal and logout cleanup. Mobile overflow from a long case code and explicit accessible names for filter selects were corrected; checks pass at 375px and 1440px.
- Password-free synthetic screenshots under `/workspace/helpminths-archive-ui/` were visually inspected, including mobile comparison, daily/account archive and a zero-result confirmation. `git diff --check` passes. Model weights, inference settings, image pixel normalization and public survey data are unchanged.

No live deployment or permanent hosted storage was provisioned. Render remains manual-deploy and its Free filesystem remains temporary: this archive cannot guarantee retention across restart/redeploy without durable storage and consistent database/image backups. Files already lost before this feature cannot be reconstructed. Current usage and retention are documented in [Thai archive/results guide](IMAGE-ARCHIVE-AND-RESULTS.th.md).

## External PostgreSQL accounts on Render Free — 12 November 2026

Added an explicit PostgreSQL store selected by `HELPMINTHS_DATABASE_BACKEND=postgres` / private `HELPMINTHS_DATABASE_URL`. The existing account/password/approval and expert-session APIs reuse their original authorization logic. Database outages or missing external configuration never create a replacement local SQLite account store. The server uses a private `helpminths` schema, TLS for remote connections, no client database credentials, transaction-scoped writer serialization, and pooler-compatible transactions without prepared statements.

Accounts, approvals, owner-bootstrap markers, sessions, documents and audit records are external. Local uploaded/archived/supplemental image bytes remain ephemeral on Render Free; `/api/platform/status` separates `accounts_persistent` / `storage.database_durable` from `storage.images_durable` rather than claiming that all storage is durable. The optional free Blueprint and Thai Supabase guide require the owner to create a project and enter the connection string privately; no hosted project, secret, deployment or paid resource was created by this change.

An explicit offline SQLite migration preserves IDs, password hashes, profiles, roles, approvals, documents/revisions/deleted history and append-only audit records. It verifies copied row contents within the same transaction, refuses a nonempty destination, leaves the source read-only and drops usable old login sessions. It does not move image files or recover data already lost from an ephemeral instance.

Validation on disposable localhost PostgreSQL and synthetic identities:

- Full backend suite with the local PostgreSQL integration URL: **543 passed**, with one existing Starlette/httpx deprecation warning.
- Seven unchanged workflow suites through the opt-in local PostgreSQL plugin: **157 passed, 2 intentionally SQLite-only cases skipped**. This covers registration/approval, expert verification, referrals, revisions, inbox ownership, history, reports and the Super Admin image archive.
- PostgreSQL-specific regressions explicitly remove the old local media directory and reopen the app with a new directory; original account IDs, credential hashes, profiles, approvals, owner identity and stored result metadata remain. Session expiry still permits a new sign-in with the same account. Expert verification remains 15 minutes.
- Dialect checks preserve JSON numeric counts and exact Thai midnight boundaries; SQL parameters and private error contents are not interpolated into responses. Migration tests cover rollback and nonempty-target refusal on real PostgreSQL.
- `npm run typecheck` and `npm run build` passed. Interface, profile/notification and referral browser checks passed **11 / 2 / 7** cases on the guarded localhost fixture. General e2e checks passed **14/14** separately against an unconfigured localhost backend because that suite's inference contract stubs `/api/analyze` rather than the authenticated analysis endpoint. An initial invocation against the configured fixture correctly left anonymous inference disabled; the suite was rerun with its required backend mode, without altering tests or access rules.

No existing UI labels were changed and no existing UI tests were rewritten to hide removed functionality. Models, Atlas assets, the 3D model and frontend API calls were not modified. Production persistence requires the owner-provided Supabase connection and verification after deployment; the tests do not establish public deployment or diagnostic accuracy.
