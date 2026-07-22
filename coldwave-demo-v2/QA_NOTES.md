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

## Phase 2A3 Automated QA

From the nested frontend repository root, run:

```powershell
python coldwave-demo-v2/tests/run_assistant_client_qa.py
git diff --check
```

The Python runner performs static security/allowlist checks, verifies the accepted `app.js` and CSS
hashes, confirms the reviewed script order, rejects unsafe rendering/request tokens in the action
module, parses representative data files, and serves/fetches frontend resources over an ephemeral
loopback HTTP port. When an existing compatible JavaScript runtime is available, it runs both the
Phase 2A2 configuration/client contracts and the Phase 2A3 action-controller suite. The audited
workstation has no standalone Node installation; the runner safely reuses VS Code's existing
Electron Node mode without npm or installation.

The Phase 2A3 mocked suite covers:

- zero client calls for local-template, invalid, and disabled backend-agent modes;
- no backend-tools call before an explicit enabled action;
- no-selection, supported-metric, unsupported-metric, status-layer, and delay-layer availability;
- section, metric, and review-note loading/success states;
- replacement-request cancellation, section/layer invalidation, stale-result rejection, silent
  cancellation, and repeated-click stability;
- the complete reviewed fallback error matrix and visible local source text;
- detected, no-sustained-drop, censored-recovery, and no-observed-support presentation;
- bounded section metrics and metric limitations;
- collapsed review details, six accepted sections in order, warnings, limitations, checklist, and
  copy-control visibility;
- exact Markdown copy, copy success/unavailable/rejection states, and stale copy completion;
- script-like backend fixtures remaining inert text and no unsafe dynamic HTML.

On the audited workstation, the action suite can also be run directly with the existing VS Code
Electron Node runtime:

```powershell
$env:ELECTRON_RUN_AS_NODE = "1"
& "D:\VScode\Microsoft VS Code\Code.exe" "coldwave-demo-v2\tests\run_assistant_actions_qa.js"
Remove-Item Env:ELECTRON_RUN_AS_NODE
```

Successful automated output includes:

```text
Phase 2A3 static/resource QA passed
25 Phase 2A2 JavaScript contract tests passed.
27 Phase 2A3 Assistant action tests passed.
```

Electron may emit a non-fatal Crashpad access-denied diagnostic on stderr; the test process exit
code and exact pass line determine the action-suite result.

With the accepted backend running on port 8080, add `--live` to pass five representative summaries,
the `q_min` and `event_rei` explanations, and detected/no-support review notes through the actual
production client validators. The same command also runs the production action-controller probe.

To run the production action controller probe separately, use:

```powershell
$env:ELECTRON_RUN_AS_NODE = "1"
& "D:\VScode\Microsoft VS Code\Code.exe" "coldwave-demo-v2\tests\run_assistant_actions_live_qa.js"
Remove-Item Env:ELECTRON_RUN_AS_NODE
```

Expected success is:

```text
Live production-controller QA passed: zero automatic requests; section, metric, and review actions each issued one validated request.
```

With the backend stopped, append `--expect-unavailable`; expected success is:

```text
Live production-controller unavailable-backend QA passed: zero automatic requests and one explicit local fallback.
```

The JavaScript suite executes the production configuration and client code with mocked fetch. It
covers:

- exact local/remote/file/HTTPS mode resolution and immutable fixed configuration;
- the exact three-method client surface and ten active-layer mappings;
- normalized IDs, rejected identifiers, and the reviewed metric allowlist;
- exact paths, methods, headers, POST body, no retry, and no page-evaluation request;
- timeout, pre-aborted and active caller cancellation, and cleanup on success/failure;
- sanitized 404/422/503/network/JSON/contract/unexpected-status errors;
- all four detection-status warning sequences and support/null consistency;
- finite numbers, relative-loss unit consistency, real calendar timestamps, and bounded text;
- exact six-section review-note structure, 1-64 evidence records, unique IDs, resolved references,
  critical identity/status/release agreement, and metric provenance;
- removal of unknown backend fields and deep-freezing of returned copies.

The Phase 2A2 client-contract suite can also be viewed from a browser at:

```text
http://127.0.0.1:8001/coldwave-demo-v2/tests/assistant-client-tests.html?assistantMode=backend-tools
```

It should report `25 Phase 2A2 JavaScript contract tests passed.` No live backend is needed because
the suite supplies reviewed mock responses. The Phase 2A3 action tests use a deterministic fake DOM
under the existing JavaScript runtime so request sequencing, accessibility state, safe rendering,
details, and clipboard outcomes do not depend on a personal browser profile.

## Manual Browser and CORS Checks

Chrome and Edge on the audited workstation delegate command-line launches to an already running
personal browser session, so an isolated automated visual/browser-CORS run has not been reliable.
The Electron Node fake-DOM/live-controller probes do not enforce browser CORS, native Clipboard
permission, focus/details keyboard behavior, responsive/map layout, or browser console cleanliness.
Do not treat mocked/runtime QA as completed visual validation. Use these exact manual steps:

1. From the nested frontend repository root, run `python -m http.server 8001 --bind 127.0.0.1`, open
   `http://127.0.0.1:8001/coldwave-demo-v2/`, and open DevTools Console and Network. Filter Network
   for `127.0.0.1:8080`.
2. With the backend stopped, reload the local-template page. Confirm the visible `Local template`
   mode label, hidden/disabled composer, three fixed actions, no Assistant API or `/health` request,
   no console error, and unchanged two-column map width.
3. Select `CS_1081`. Confirm the section and review-note actions enable; click all three actions and
   confirm each returns local deterministic content without a backend request. Generate review note
   must say the backend is required, must retain the concise section preview, and must not show a
   draft, full-note details, or Copy Markdown.
4. Start the accepted backend from `services/resilience-agent` with:

   ```powershell
   $env:RESILIENCE_CORS_ALLOWED_ORIGINS = "http://127.0.0.1:8001,http://localhost:8001"
   .\.venv\Scripts\uvicorn.exe resilience_agent.api:app --host 127.0.0.1 --port 8080
   ```

5. Open `http://127.0.0.1:8001/coldwave-demo-v2/?assistantMode=backend-tools`. Before selecting or
   clicking anything, confirm the visible `Backend tools` label and zero Assistant API requests.
   Select `CS_1081`; confirm selection itself still makes no Assistant API request.
6. Click **Explain this section** once. Confirm one reviewed section request, the loading label, then
   `Backend result`. Verify identity, support/detection status, no more than three observed metrics,
   no more than three planning metrics, warnings, and the planning/observed distinction.
7. Choose the `Q_min` map layer and click **Explain the current metric**. Confirm one metric request
   and a result containing display name, definition, unit, applicability, null meaning where
   relevant, no more than three limitations, and no selected-section ranking or preferred direction.
8. Select `Detection Status / Warning`, then `Supplemental Delay Burden`. For each, confirm the metric
   action is disabled with a visible explanation while section and review-note actions remain
   enabled. Confirm no request can be issued from the disabled control.
9. Return to a supported layer and click **Generate review note**. Confirm one POST request, a compact
   `Draft for human review` result, and a closed **Open full review note** control. Confirm the compact
   area does not contain all report bodies. Expand it and verify six report sections in accepted
   order, followed by separate warnings, limitations, and human-review checklist blocks.
10. Click **Copy Markdown**. Where Clipboard API permission is available, confirm the status says
    `Copied Markdown.` and the clipboard contains the returned Markdown. If the API is unavailable or
    permission is rejected, confirm only `Clipboard unavailable.` or `Copy failed.` is shown and no
    raw exception appears.
11. In DevTools Network, enable throttling. Start an action, immediately select another section or
    change the map layer, and confirm the pending request is cancelled/invalidated. No stale result,
    backend-unavailable warning, or old review/copy control may appear for the new context. Repeat by
    rapidly clicking two different actions and by clicking the same action twice.
12. Stop the backend and invoke each action on the backend-tools page. Confirm a visible, specific
    local-fallback label and local content. Review-note failure must say no draft was generated and
    must not expose full-note or copy controls.
13. Repeat presentation checks for `CS_1081` (detected), `CS_257` (no sustained drop), `CS_3597`
    (censored recovery), `CS_1` (no observed support), and `CS_583693` (high-score detected example).
    Confirm no-observed-support text does not claim that no disruption occurred.
14. Serve the frontend on port 8002 without adding that origin to the CORS allowlist. Open
    `http://127.0.0.1:8002/coldwave-demo-v2/?assistantMode=backend-tools`, select a section, and click
    a fixed action. Confirm browser CORS blocks the response and the UI shows only the sanitized
    backend-unavailable/local-fallback result.
15. Repeat search, map hover/click selection, layer/legend changes, lazy local Q(t) loading, native
    details/summary keyboard activation, action-button keyboard focus/activation, and small-screen
    checks. Confirm the current curve remains local, the map remains usable, and the Console has no
    new errors.

## Known Limitations

- Candidate B remains experimental.
- The shaded chart area is an approximate visual representation of detected curve loss, not a recalculation of the metric.
- Recovery metrics are lower-confidence when `recovery_endpoint_censored` is flagged.
- Delay burden is a proxy based on profile demand weighting, not observed event-day vehicle volume.
- Browser-enforced CORS, Clipboard API permission, and visible dashboard interaction remain manual
  QA on the audited workstation; the automated Phase 2A3 suite uses mocked clients and a fake DOM.
- This v2 is not deployed and should not replace the stable `coldwave-demo`.
