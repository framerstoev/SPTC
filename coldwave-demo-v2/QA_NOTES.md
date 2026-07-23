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
- Clicking a control section opens the right panel.
- Q(t) curve loads lazily for sections with curve JSON.
- `no_sustained_drop` sections show the v0 warning and do not imply full resilience.
- `recovery_endpoint_censored` sections show the censored-recovery warning.
- Tier 3 observed curve metrics are displayed separately from Tier 1/2 predictor/context fields.
- Assistant mode is visibly labeled `Local template` or `Backend tools`.
- The Assistant exposes exactly three fixed actions and keeps the free-form composer hidden and
  disabled.
- No Assistant API request occurs on page load, mode resolution, section selection, or map-layer
  change.
- Detection-status and supplemental-delay layers disable only the metric-explanation action and
  show a visible reason.
- Pending requests are aborted and invalidated when replaced or when section/layer context changes;
  late results never replace the current selection's content.
- Backend failures show an explicit local-fallback label rather than silently presenting local text
  as a backend result.
- A successful review note remains compact until its native details control is expanded, and Copy
  Markdown copies only the validated backend string.
- No LLM, free-form request, compare, filter, rank, curve-API, or map-action behavior is present.
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

- Chart height increased for presentation readability.
- X-axis label clarified as `Time, Jan 1-Feb 3, 2026`.
- Date tick density reduced.
- Onset/min/recovery marker text moved into a small legend to avoid overlap.
- Q = 1.0, 0.9, and 0.8 reference lines retained.
- Loss-area shading remains subtle.

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
HTML parsing.

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

## Phase 2A4 Isolated Browser Acceptance

The real production page was exercised in Google Chrome `150.0.7871.181` through CDP protocol 1.3.
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

- Confirm successful **Copy Markdown** behavior in a visible browser session where the reviewer
  grants native Clipboard permission.
- Perform a human visible-window design review if subjective visual polish is required. The
  headless run inspected actual DOM geometry and screenshots, but is not a substitute for human
  visual judgment or assistive-technology testing.

## Known Limitations

- Candidate B remains experimental.
- The shaded chart area is an approximate visual representation of detected curve loss, not a recalculation of the metric.
- Recovery metrics are lower-confidence when `recovery_endpoint_censored` is flagged.
- Delay burden is a proxy based on profile demand weighting, not observed event-day vehicle volume.
- Phase 2A4 acceptance is local/reviewer-only. It adds no LLM, free-form request, credential, or API key.
- Public hosting, licensing, authentication, canonical timezone, and backend-hosting decisions remain unresolved; this is not deployment readiness.
- This v2 is not deployed and should not replace the stable `coldwave-demo`.
