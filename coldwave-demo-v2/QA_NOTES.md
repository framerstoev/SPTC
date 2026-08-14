# QA Notes

## Scope

This folder is a local-only experimental frontend prototype for data-driven resilience curve v0 outputs.

The stable deployed dashboard at `data/front-end/sptc-demo/coldwave-demo` was not modified.

## Data Package

- Map layer: `data/data_driven_resilience_map_v0.geojson`
- Curve files: `data/curves/*.json`
- Summary/index files: `data/summary.json`, `data/curve_index.json`

The large source CSV `control_section_q_timeseries_v0.csv` is not copied into the frontend. Curves are split by control section and lazy-loaded when a feature is clicked.

## Intended Checks

- Map loads from local server.
- Layer selector updates color styling and legend.
- Search finds partial matches for CS IDs, `CS_` keys, routes, and counties.
- Search result selection zooms to the control section, highlights it, updates the panel, and lazy-loads Q(t).
- Clicking a control section updates the selected-section panel.
- Q(t) is open by default, shows a compact no-selection placeholder, and loads lazily for sections
  with curve JSON without requiring a second disclosure click.
- `no_sustained_drop` sections show the v0 warning and do not imply full resilience.
- `recovery_endpoint_censored` sections show the censored-recovery warning.
- Tier 3 observed curve metrics are displayed separately from Tier 1/2 predictor/context fields.
- The analysis sidebar contains evidence only; Assistant controls live outside it in one floating
  panel that is collapsed by default.
- Desktop widths above 980 px expose a focusable 10 px separator with pointer and keyboard
  resizing. Narrow layouts hide it and preserve the single-column map layout.
- The Assistant always preserves exactly three deterministic quick actions. Their output appears in
  the unified timeline as **Verified result**; free-form output is labeled **AI-assisted response**.
- The free-form composer is visible and enabled only in exact loopback-HTTP `backend-agent` mode.
- Exactly three suggestions are initially visible and five additional examples are collapsed under
  **More suggestions**.
- Normal user-facing UI contains no Qwen, Ollama, model-name, GPU, or FastAPI branding. Technical
  tests and operations documentation retain those names where required.
- No Assistant API request occurs on page load, mode resolution, section selection, or map-layer
  change.
- Detection-status and supplemental-delay layers disable only the metric-explanation action and
  show a visible reason.
- Pending requests are aborted and invalidated when replaced or when section/layer context changes;
  late results never replace the current selection's content, history resets, the floating panel
  stays open, and no replacement question is sent.
- Deterministic quick actions remain available during AI/model unavailability. Backend failures use
  an explicit local-fallback status while retaining **Verified result** provenance.
- A successful review note remains compact until its native details control is expanded, and Copy
  Markdown copies only the validated backend string.
- Chat comparison is limited to exactly two explicit reviewed sections. Filter, rank, curve-API,
  map-action, upload, arbitrary endpoint, and direct browser-to-model behavior remain unavailable.
- The browser calls only FastAPI at `127.0.0.1:8080`; Ollama and port `11434` remain backend-only.
- Stable `coldwave-demo` remains untouched.

## Score Classes

The `Observed Curve Resilience Score v0` layer uses quantile classes because fixed classes were imbalanced:

- fixed breaks produced `0` Very Low and only `37` Very High sections among valid detections.
- quantile breaks produce roughly balanced classes.

Current breakpoints:

- Very Low: `0.343600-0.690711`
- Low: `0.690711-0.734266`
- Moderate: `0.734266-0.775293`
- High: `0.775293-0.833314`
- Very High: `0.833314-0.913378`

These are experimental v0 classes and should not be presented as official resilience categories.

Classification logic fix:

- Missing scores, `null`, blank strings, and N/A values are excluded from quantile calculation.
- `no_sustained_drop` sections are excluded from numeric quantiles and shown as a separate warning/status class.
- `recovery_endpoint_censored` sections are included in numeric classes only when they have a valid score, and are still flagged with a warning badge.
- Previous incorrect browser legend values came from JavaScript treating `null` as `0` through `Number(null)`.

## Q(t) Chart Improvements

- The Q(t) disclosure is open by default; before selection it shows **Select a control section to
  view Q(t).** Tier 1/2 context and method disclosures remain closed by default.
- Chart height increased for presentation readability.
- X-axis label clarified as `Time, Jan 1-Feb 3, 2026`.
- Date tick density reduced.
- Onset/min/recovery marker text moved into a small legend to avoid overlap.
- Q = 1.0, 0.9, and 0.8 reference lines retained.
- Loss-area shading remains subtle.
- Visible smoothing wording now says **centered six-observation rolling median**: observations, not
  elapsed hours, with no missing-hour interpolation.

## Delay Proxy Audit

The v0 script shows:

- `total_detected_phase_delay_proxy` equals `disruption_delay_proxy`.
- `recovery_delay_proxy` is a subset from minimum point to recovery endpoint.
- Therefore `total_detected_phase_delay_proxy` should not be read as `disruption + recovery`.

The UI labels were updated to:

- Detected phase delay proxy
- Detected recovery-subset delay proxy
- V0 disruption-delay field
- Full-window delay proxy: N/A

## Phase 2A4 Search Rendering Security Audit

The accepted Phase 2A3 `app.js` contained 14 `innerHTML` assignments. The audit classified every
assignment before changing code:

| Site | Accepted-head classification | Phase 2A4 disposition |
| --- | --- | --- |
| score-class legend | dynamic but constrained | Closed labels/colors and finite-formatted ranges; unchanged. |
| detection-status legend | dynamic but constrained | Closed status/color mapping; unchanged. |
| continuous legend | dynamic but constrained | Closed layer configuration and finite-formatted ranges; unchanged. |
| blank-search clear | safely cleared container | Replaced locally with `replaceChildren()`. |
| no-match search message | static trusted template | Rebuilt as a created `div` with fixed `textContent`. |
| matching search results | **dynamic and unsafe** | Route, control-section, county, status, and `data-key` interpolation replaced with created nodes, `textContent`, and reviewed `dataset.key`. |
| status badges | dynamic and unsafe for an unknown raw status | `statusLabel` now uses the closed status registry and fixed `Unknown` fallback. |
| top metric cards | dynamic but constrained | Constant labels/help and finite numeric formatters; unchanged. |
| warning-card clear | safely cleared container | Empty string only; unchanged. |
| curve metric cards | dynamic but constrained | Constant labels/help and finite numeric formatters; unchanged. |
| impact metric cards | dynamic but constrained | Constant labels/help and finite numeric formatters; unchanged. |
| Tier 1/2 metric cards | dynamic and unsafe for raw data-density text | Data density now resolves through the closed `A`/`B`/`C` registry with fixed `N/A` fallback. |
| phase-marker clear | safely cleared container | Empty string only; unchanged. |
| phase-marker legend | static trusted template | Fixed literal only; unchanged. |

The search renderer now has no HTML-string sink. Eleven non-search assignments remain: eight receive
only closed or finite-formatted values, two only clear containers, and one is a fixed marker
template. The separate Leaflet tooltip path still escapes route, control-section, and county values
through `escapeHtml`. `assistant-actions.js` remains byte-identical to the accepted Phase 2A3
renderer and contains no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `DOMParser`, or Markdown
HTML parsing. At the Phase 2A4 checkpoint, `assistant-actions.js` was byte-identical to the accepted
Phase 2A3 renderer; Phase 3G subsequently expanded only its reviewed mode handling so the same
fixed actions remain available in `backend-agent` mode.

The production-function test fixtures include `<script>alert(1)</script>`,
`<img src=x onerror=alert(1)>`, quotes, apostrophes, ampersands, angle brackets, route/county-like
markup, 512-character bounded values, tabs/newlines, and control characters. The tests assert exact
inert visible text, no created script/image/SVG or event-handler attribute, preserved classes and
ordering, the ten-result cap, blank/no-match behavior, and exact section IDs for delegated click and
Enter selection. No sanitizer library was introduced.

## Phase 2A4 Automated QA

From the nested frontend repository root, run:

```powershell
D:\programming\Minicoda\python.exe coldwave-demo-v2\tests\run_assistant_client_qa.py
git diff --check
```

The result on the audited workstation was:

```text
Phase 2A4 static/resource QA passed
25 Phase 2A2 JavaScript contract tests passed.
27 Phase 2A3 Assistant action tests passed.
8 Phase 2A4 search rendering tests passed.
```

The 60 deterministic JavaScript tests use the existing VS Code Electron Node runtime without npm
or installation. They retain all Phase 2A2 client contracts and Phase 2A3 action, error, warning,
cancellation, staleness, review-note, safe-rendering, and Clipboard success/failure contracts. The
new tests extract the actual production search functions from `app.js`; they do not test a copied
renderer.

For live client/controller validation, start the accepted deterministic backend from
`services/resilience-agent`:

```powershell
$env:RESILIENCE_CORS_ALLOWED_ORIGINS = "http://127.0.0.1:8001,http://localhost:8001"
.\.venv\Scripts\uvicorn.exe resilience_agent.api:app --host 127.0.0.1 --port 8080
```

Serve the actual frontend from the nested frontend repository root:

```powershell
D:\programming\Minicoda\python.exe -m http.server 8001 --bind 127.0.0.1
```

Then run:

```powershell
D:\programming\Minicoda\python.exe coldwave-demo-v2\tests\run_assistant_client_qa.py --live
```

This passed five summaries, two metric definitions, two review notes, and the production controller
probe with zero automatic requests and exactly one section, metric, and review action request.

## Phase 3G Automated QA

Phase 3G keeps the accepted local-template, backend-tools, search, map, curve, review-note, and
Clipboard regression suites and adds mocked client/chat coverage plus a dedicated production-page
browser harness. This subsection records the pre-Phase 3I regression baseline; the Phase 3I section
below supersedes its eight-suggestion and two-column layout assertions. From the nested frontend
repository root, run:

```powershell
D:\programming\Minicoda\python.exe coldwave-demo-v2\tests\run_assistant_client_qa.py
git diff --check
```

The completed 2026-08-03 deterministic run was:

```text
Phase 3G static/resource regression QA passed
36 Phase 2A2 JavaScript contract tests passed.
28 Phase 2A3 Assistant action tests passed.
17 Phase 3G Assistant chat interaction tests passed.
8 Phase 2A4 search rendering tests passed.
```

All **89 JavaScript tests** passed. They cover exact loopback mode activation and fail-closed
fallbacks; fixed FastAPI routing and 8,000/80,000 ms timeout separation; strict request/history
bounds; all seven response/HTTP states; finite structured evidence; warning/release/method checks;
unknown-field stripping and deep freezing; cancellation, no retry, and stale suppression; long
answer history bounding; Enter/Shift+Enter; character count and duplicate prevention; section and
metric context resets; inert text rendering; tools/evidence/warnings/limitations/details; all eight
suggestions; all three deterministic fixed actions in agent mode; local-template/backend-tools;
search; local curve resource paths; the two-column map shell; and horizontal-overflow guards.

The tests use no cloud service, API key, model request, npm install, generated analytical output,
or modified backend. The Phase 3G harness also passed AST/import/CLI validation before browser
execution. The backend worktree remained clean at accepted HEAD
`5edc4688514f2c47ae3e8c03f50b853c0f5d8108`.

## Phase 3G Real-Browser Acceptance

`tests/run_phase3g_browser_qa.py` reuses the accepted Phase 2A4 isolated Chrome/CDP ownership
layer. Its `live` scenario drives the production frontend through FastAPI and the local `qwen3:8b`
workflow; `model-unavailable` keeps FastAPI available while the local model is unavailable and
verifies that deterministic quick actions still work.

The accepted Phase 3G run completed the 16-case, five-section matrix for `CS_1081`, `CS_257`,
`CS_3597`, `CS_1`, and `CS_583693`. It covered section and metric explanations, warning/status
handling, comparison, review note, planning versus observed evidence, clarification, prediction
and investment refusals, SQL/file/shell/prompt attempts, bounded history, Cancel, rapid context
changes, fixed actions, curve loading, responsive layouts, safe rendering, and allowlisted network
traffic. The run passed 543 checks. Successful-workflow latency was 1.604 seconds median and 7.961
seconds p95/maximum for that acceptance run; these are run-specific observations, not a current
response-time guarantee. Phase 3I reruns must record fresh values.

The browser made zero Assistant query requests on page load, zero requests or WebSockets to port
`11434`, and recorded zero console errors and uncaught exceptions. Tool/control selection, warning,
evidence, unsupported-decline, and safety rates passed their reviewed gates. The accepted local tag
`phase3g-local-qwen-chatbot-accepted` targets
`58f04a9c8d608fa9622bf8a0133d446118970543`.

The earlier RTX 4060 Code 43 condition is historical rather than a current Phase 3G blocker: the GPU
was healthy before the accepted real-model run, `nvidia-smi` succeeded, and Ollama reported the
reviewed model at 100% GPU allocation. The accepted Phase 3H launcher later preserved that workflow
without changing frontend/backend Assistant semantics.

The harness continues to accept the same operational inputs for a live rerun:

```powershell
$env:PYTHONDONTWRITEBYTECODE = "1"
D:\programming\Minicoda\python.exe coldwave-demo-v2\tests\run_phase3g_browser_qa.py `
  --scenario live `
  --cold-warmup-seconds <measured-seconds> `
  --qwen-gpu-allocation "100% GPU" `
  --peak-vram-mib <measured-peak-mib>

# Keep the frontend and assistant-enabled FastAPI process available while the model is unavailable:
D:\programming\Minicoda\python.exe coldwave-demo-v2\tests\run_phase3g_browser_qa.py `
  --scenario model-unavailable
```

The normal harness creates, owns, closes, and removes its isolated profile. On a constrained host,
`--isolated-profile` may be used only with an outer-owned temporary profile following the accepted
Phase 2A4 ownership checks. Headless Chrome can report native Clipboard access unavailable; in that
case exact DOM/Markdown and keyboard contracts are checked without claiming an OS clipboard write.

## Phase 3I UI Simplification QA

Phase 3I changes only the frontend information architecture and interaction surface. Tests must
retain every accepted deterministic endpoint, free-form `/api/v1/assistant/query` path, response
schema, grounding/warning gate, cancellation/staleness rule, and safe-rendering restriction.

### Deterministic and static commands

From the nested frontend repository root:

```powershell
$env:PYTHONDONTWRITEBYTECODE = "1"
D:\programming\Minicoda\python.exe coldwave-demo-v2\tests\run_assistant_client_qa.py
git diff --check
```

With the accepted backend on `127.0.0.1:8080`, add the real deterministic client/action probe:

```powershell
D:\programming\Minicoda\python.exe coldwave-demo-v2\tests\run_assistant_client_qa.py --live
```

The static/JavaScript suites now assert:

- no permanent Assistant content in the sidebar and exactly one `#assistantMessages` timeline;
- Q(t) open by default, with Tier 1/2 and method disclosures closed;
- no-selection placeholder and unchanged lazy curve loading;
- a 420 px default splitter, 320 px minimum, 650 px absolute/dynamic maximum, pointer cancellation,
  Arrow Left/Right 16 px steps, Home/End bounds, no width persistence, and throttled Leaflet/Chart
  resize notification;
- collapsed launcher, open/close/Escape and focus return, with no open/close network request;
- three primary suggestions plus five under **More suggestions**;
- deterministic **Verified result** and free-form **AI-assisted response** entries in the same
  timeline without changing either execution path;
- neutral useful statuses, silent success, AI-unavailable deterministic fallback, and context reset;
- inert script-like content, no raw JSON/reasoning/internal paths, preserved warnings, and no normal
  UI branding for Qwen, Ollama, model details, GPU, or FastAPI; and
- all prior section/metric cancellation, stale-response, history, request-bound, CORS, restricted
  field, and network checks.

### Production-page browser commands

Serve the frontend on `127.0.0.1:8001` and the accepted backend on `127.0.0.1:8080`, then run:

```powershell
$env:PYTHONDONTWRITEBYTECODE = "1"
D:\programming\Minicoda\python.exe coldwave-demo-v2\tests\run_phase2a4_browser_qa.py --scenario full
D:\programming\Minicoda\python.exe coldwave-demo-v2\tests\run_phase3g_browser_qa.py `
  --scenario live `
  --cold-warmup-seconds <measured-seconds> `
  --qwen-gpu-allocation "100% GPU" `
  --peak-vram-mib <measured-peak-mib>
```

Repeat the fail-closed paths separately as applicable:

```powershell
# Backend genuinely unavailable:
D:\programming\Minicoda\python.exe coldwave-demo-v2\tests\run_phase2a4_browser_qa.py --scenario unavailable

# Frontend and assistant-enabled FastAPI remain available; model is unavailable:
D:\programming\Minicoda\python.exe coldwave-demo-v2\tests\run_phase3g_browser_qa.py --scenario model-unavailable
```

The required geometry viewports are:

| Viewport | Expected layout |
| --- | --- |
| `1440x900` | Three grid tracks: analysis panel, visible separator, primary map; floating Assistant at most 440 px wide and clear of attribution. |
| `1024x768` | Same desktop splitter layout; dynamic maximum preserves at least 480 px for the map. |
| `768x900` | One column, splitter hidden, Assistant presented as a fixed inset bottom sheet. |
| `390x844` | One column with no horizontal overflow; near-full-width bottom sheet, visible Close/composer, internally scrolling timeline, and recoverable map after close. |

Every viewport must retain an initialized map, visible default-open Q(t), usable controls, no
horizontal overflow, a panel fully within the viewport, no overlap with Leaflet attribution, and no
permanent third content column. Pointer resizing must trigger bounded `map.invalidateSize()` rather
than map reconstruction.

### Real local AI smoke

When GPU health, `nvidia-smi`, and the accepted launcher preflight pass, start the unchanged Phase 3H
workflow:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\local-demo\start-local-chatbot-demo.ps1
```

Verify one supported-section **Verified result**, one grounded **AI-assisted response**, one
unsupported investment decline, and the model-unavailable deterministic fallback. The browser must
make no page-load query and must never contact port `11434`. Stop with the accepted stop script and
confirm ports 8001/8080 are free. Launcher tests are not required for Phase 3I because no
`local-demo/**` file or launcher behavior changes.

Conversational paraphrase robustness remains a documented deferred issue. Phase 3I acceptance must
not weaken routing/security assertions or introduce routing, prompt, tool-description, backend, or
model changes to address it.

## Phase 2A4 Isolated Browser Acceptance

The original accepted Phase 2A4 run used Google Chrome `150.0.7871.181`; the Phase 3G regression
rerun used Chrome `150.0.7871.187`, both through CDP protocol 1.3.
The run used a GUID-named directory directly under the OS temporary directory, a new hidden
headless process, and `--user-data-dir` pointing only to that directory. No personal browser process
or profile was reused. On this Codex Windows job host, an outer PowerShell `Start-Process` was needed
to keep the GUI process alive; `run_phase2a4_browser_qa.py --isolated-profile <path>` then attached
only through that profile's `DevToolsActivePort`. `Browser.close` ended Chrome, and every run verified
zero Chrome processes and removed the exact temporary profile. Internal screenshots were captured
for geometry checks and were not retained.

After the outer process created `$profile`, the exact harness commands were:

```powershell
D:\programming\Minicoda\python.exe coldwave-demo-v2\tests\run_phase2a4_browser_qa.py --scenario full --isolated-profile $profile
# Stop the backend, launch a fresh isolated profile, then run:
D:\programming\Minicoda\python.exe coldwave-demo-v2\tests\run_phase2a4_browser_qa.py --scenario unavailable --isolated-profile $profile
```

In a normal PowerShell session that is not constrained by the Codex Windows job, omit
`--isolated-profile`; the harness creates, owns, closes, and removes its own temporary profile.

The full scenario passed **128 checks**; a separate run with the backend genuinely stopped passed
**11 checks**.

| Area | Accepted result |
| --- | --- |
| local-template | Correct mode label, zero Assistant API calls, deterministic section/metric content, no fabricated review draft, map selection, and local curve loading. |
| backend-tools | Zero calls on load/selection; one `GET /api/v1/sections/1081`, one `GET /api/v1/metrics/q_min`, and one `POST /api/v1/reports/review-note` with `{"scope":"section","section_ids":["1081"]}` after explicit actions. |
| review note | Initially collapsed; six accepted sections, warnings, limitations, and checklist visible after expansion; Markdown remained text and was not rendered as HTML. |
| representative sections | `CS_1081`, `CS_257`, `CS_3597`, `CS_1`, and `CS_583693` rendered their reviewed statuses without causal, predictive, investment, high/low, confirmed-recovery, no-impact, or no-disruption claims. |
| failure handling | Browser-blocked response, genuine eight-second timeout, and genuinely stopped backend all produced reviewed local fallback; review failure stated that no draft was generated. |
| cancellation/staleness | Delayed CDP-intercepted requests confirmed action replacement, section change, and metric change suppress stale/cancelled results and duplicate current responses. |
| unsupported metrics | Detection-status and supplemental-delay layers kept metric explanation disabled and emitted no metric request. |
| keyboard/structure | All three action buttons, native details/summary, and Copy Markdown were keyboard reachable/activatable as applicable; disabled state, visible focus, ARIA live structure, and hidden disabled composer were inspected. No screen-reader announcement behavior is claimed. |
| responsive/map | `1440x900`, `1024x768`, `768x900`, and `390x844` passed column, overlap, scroll, overflow, map-size/invalidation, selection, and curve-canvas checks; no permanent third column appeared. |
| console/network | No uncaught application exception or console error; accepted Assistant endpoints only; no `/health`, Authorization, Cookie, credential, arbitrary backend URL, internal path, or traceback; requesting-origin CORS header matched `http://127.0.0.1:8001`. |
| Clipboard | Safe DOM, exact validated Markdown contract, keyboard access, and concise unavailable/failure handling passed. Headless Chrome did not complete the native OS clipboard write, so successful OS clipboard copying is not claimed. |

The normal reviewer URLs were:

```text
http://127.0.0.1:8001/coldwave-demo-v2/
http://127.0.0.1:8001/coldwave-demo-v2/?assistantMode=backend-tools
```

### Manual Checks Still Outstanding

- Run the full Phase 3I static, deterministic-live, four-viewport browser, real-model smoke, and
  model-unavailable fallback matrix after the production changes are committed cleanly; record the
  resulting counts and latency measurements rather than carrying Phase 3G values forward.
- Confirm successful **Copy Markdown** behavior in a visible browser session where the reviewer
  grants native Clipboard permission.
- Perform a human visible-window review at all four required viewports. Headless geometry and
  internal screenshots do not substitute for human visual judgment or assistive-technology testing.
- Evaluate conversational paraphrase robustness in a later routing phase; do not fold it into the
  Phase 3I UI acceptance.

## Known Limitations

- Candidate B remains experimental.
- The shaded chart area is an approximate visual representation of detected curve loss, not a recalculation of the metric.
- Recovery metrics are lower-confidence when `recovery_endpoint_censored` is flagged.
- Delay burden is a proxy based on profile demand weighting, not observed event-day vehicle volume.
- Phase 3G chat is local/reviewer-only and uses the accepted local `qwen3:8b` backend path. It adds
  no cloud provider, browser credential, API key, direct browser-to-Ollama connection, or deployment.
- Local Qwen can fail closed with `invalid_model_response` or `model_unavailable`; deterministic
  evidence and the three fixed actions remain authoritative. No result should be inferred when a
  response is rejected.
- The accepted Phase 3H launcher is local-only; visible assistive-technology validation remains
  future work.
- Conversational paraphrase robustness is deferred; Phase 3I intentionally leaves routing, prompts,
  tool descriptions, backend orchestration, and model behavior unchanged.
- Public hosting, licensing, authentication, canonical timezone, and backend-hosting decisions remain unresolved; this is not deployment readiness.
- This v2 is not deployed and should not replace the stable `coldwave-demo`.
