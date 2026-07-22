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

## Phase 2A2 Automated QA

From the nested frontend repository root, run:

```powershell
python coldwave-demo-v2/tests/run_assistant_client_qa.py
git diff --check
```

The Python runner performs static security/allowlist checks, verifies the accepted `app.js` and
CSS hashes, parses representative data files, and serves/fetches the frontend resources over an
ephemeral loopback HTTP port. It also runs `run_assistant_client_qa.js` when an existing compatible
JavaScript runtime is available. The audited workstation has no standalone Node installation; the
runner safely reuses VS Code's existing Electron Node mode without npm or installation.
With the accepted backend running on port 8080, add `--live` to pass four representative summaries,
the `q_min` and `event_rei` explanations, and detected/no-support review notes through the actual
production client validators.

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

The same suite can be viewed from a browser at:

```text
http://127.0.0.1:8001/coldwave-demo-v2/tests/assistant-client-tests.html?assistantMode=backend-tools
```

It should report `25 Phase 2A2 JavaScript contract tests passed.` No live backend is needed because
the suite supplies reviewed mock responses.

## Manual Browser and CORS Checks

Chrome and Edge on the audited workstation delegate command-line launches to an already running
personal browser session, so an isolated automated browser/CORS run was not reliable. Complete the
following manual checks before action wiring or demonstration:

1. Stop the backend, open the normal v2 page with no query parameter, and confirm the existing
   Assistant Preview, map, selected section, active metric, and console remain unchanged.
2. In browser DevTools Network, filter for `127.0.0.1:8080`; reload both the default page and the
   `?assistantMode=backend-tools` page. Confirm neither reload issues a backend or `/health` request.
3. Start the backend with only the two port-8001 origins documented in `README.md`. On the
   backend-tools page, call these methods from the console and inspect the frozen sanitized result:

   ```javascript
   await SPTCAssistant.client.getSectionSummary("CS_1081")
   await SPTCAssistant.client.explainMetric("q_min")
   await SPTCAssistant.client.explainMetric("event_rei")
   await SPTCAssistant.client.generateSectionReviewNote("CS_1081")
   await SPTCAssistant.client.generateSectionReviewNote("CS_1")
   ```

4. Serve the same frontend on port 8002 without adding that origin to the backend CORS allowlist.
   Open `http://127.0.0.1:8002/coldwave-demo-v2/?assistantMode=backend-tools` and call
   `getSectionSummary("1081")`. Confirm the browser blocks the cross-origin response and the client
   exposes only `backend_unavailable`, without the raw browser exception.
5. Repeat the existing representative UI checks for `CS_1081`, `CS_257`, `CS_3597`, `CS_1`, and
   `CS_583693`, including search, layer changes and runtime legend breaks, hover/click selection,
   lazy curve loading, Assistant Preview responses, console errors, and a mobile/small-screen size.

These console calls are QA only. Phase 2A2 does not connect any visible UI action to backend-tools.

## Known Limitations

- Candidate B remains experimental.
- The shaded chart area is an approximate visual representation of detected curve loss, not a recalculation of the metric.
- Recovery metrics are lower-confidence when `recovery_endpoint_censored` is flagged.
- Delay burden is a proxy based on profile demand weighting, not observed event-day vehicle volume.
- Browser-enforced CORS and visible dashboard interaction remain manual QA on the audited
  workstation; the automated JavaScript suite uses mocked fetch.
- This v2 is not deployed and should not replace the stable `coldwave-demo`.
