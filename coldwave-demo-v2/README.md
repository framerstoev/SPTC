# Experimental Data-Driven Resilience Curve Prototype

This is a local experimental frontend for the data-driven resilience curve v0 results. It is not the stable deployed `coldwave-demo` dashboard and should not replace the stable score formulas.

## Main Page

Open locally from `data/front-end/sptc-demo`:

```powershell
python -m http.server 8001
```

Then visit:

```text
http://localhost:8001/coldwave-demo-v2/
```

## Data Files

- `data/data_driven_resilience_map_v0.geojson`: simplified control-section map with frontend-needed fields only.
- `data/summary.json`: package summary and method metadata.
- `data/curve_index.json`: control-section to curve JSON lookup.
- `data/curves/*.json`: lazy-loaded full-window Q(t) curve files.
- `data/qa_examples.json`: clear, no-sustained-drop, and censored/ambiguous QA examples.
- `data/qa_metric_correlations.json`: current-score comparison correlations.
- `data/qa_sensitivity_by_threshold.json`: threshold sensitivity summary.
- `data/qa_sensitivity_by_smoothing.json`: smoothing-window sensitivity summary.

## Search

The left-panel search uses the map GeoJSON properties only. It supports partial matches for:

- `CTRL_SECT_`
- `CTRL_SECT_KEY`, such as `CS_5998`
- route keys, such as `FM_1541_`, `IH_35_`, or `US_287_`
- county names

Selecting a search result zooms to the control section, highlights it, updates the right panel, and lazy-loads the curve JSON only for that selected section.

## Experimental Score Classes

The `Observed Curve Resilience Score v0` layer uses quantile classes because fixed breaks were highly imbalanced for the current v0 score distribution.

Classification excludes missing/N/A score values and excludes `no_sustained_drop` sections from the numeric quantiles. `no_sustained_drop` is displayed as a separate warning/status class. `recovery_endpoint_censored` sections are included in numeric classes only when they have a valid score, and they remain flagged with a warning badge.

Current runtime breakpoints:

- Very Low: `0.343600-0.690711`
- Low: `0.690711-0.734266`
- Moderate: `0.734266-0.775293`
- High: `0.775293-0.833314`
- Very High: `0.833314-0.913378`

These are experimental v0 classes, not official resilience categories. The numeric score remains visible in the popup and selected-section panel.

## Method

The prototype uses Candidate B from v0:

- dominant sustained performance drop
- 6-hour centered rolling median
- threshold = 0.90 x Q0
- k = 3 consecutive observations

Tier 3 curve metrics are observed operational performance labels. Tier 1/2 variables are shown as predictor/context layers for future modeling.

## Q(t) Chart

The right-panel chart shows the full Jan. 1-Feb. 3 Q(t) series for the selected control section:

- raw hourly Q(t)
- 6-hour rolling median
- Q = 1.0, 0.9, and 0.8 reference lines
- detected onset, minimum, and recovery endpoint markers when available
- subtle loss-area shading for the detected phase

Marker labels are shown in a small legend below the chart to avoid overlap on the plot.

## Delay Proxy Audit

The v0 processing script currently sets `total_detected_phase_delay_proxy` equal to `disruption_delay_proxy`. Both represent the detected onset-to-recovery phase sum. `recovery_delay_proxy` is a min-to-recovery subset, not an additional amount to add to the total. The UI therefore labels the fields as:

- Detected phase delay proxy
- Detected recovery-subset delay proxy
- V0 disruption-delay field
- Full-window delay proxy: N/A

## Dormant Deterministic Backend Client

Phase 2A2 adds a static, dormant client foundation only. It is not connected to the Assistant
Preview buttons or any other `app.js` action. The committed default remains `local-template`, so
the existing deterministic Assistant Preview continues to operate when the backend is stopped.
There is no LLM, credential, API key, health check, retry, telemetry, or automatic backend request.

The reviewed runtime modes are:

- `local-template`: the default and fallback mode.
- `backend-tools`: available only when the page is served over plain HTTP from exactly
  `127.0.0.1` or `localhost` and the exact query parameter is
  `assistantMode=backend-tools`.
- `backend-agent`: reserved and disabled; requesting it resolves to `local-template`.

Unknown, malformed, duplicated, or differently cased mode parameters resolve to
`local-template`. HTTPS, `file://`, userinfo, remote hosts, fragments, browser storage, and query
parameters such as `backendUrl`, `apiUrl`, `host`, or `port` cannot activate or redirect the
client. Reviewed state is exposed as frozen data under `window.SPTCAssistant.runtime`.

The backend destination and timeout are fixed in committed code:

```text
http://127.0.0.1:8080
8000 milliseconds
```

Only three explicit methods are exposed under `window.SPTCAssistant.client`:

- `getSectionSummary(csId, options?)` -> `GET /api/v1/sections/{cs_id}`
- `explainMetric(metricName, options?)` -> `GET /api/v1/metrics/{metric_name}`
- `generateSectionReviewNote(csId, options?)` -> `POST /api/v1/reports/review-note`

The client normalizes reviewed section identifiers, restricts metric explanations to current map
metrics, constructs no arbitrary paths or bodies, omits credentials, and validates/copies only
reviewed response fields. Review-note Markdown is returned as inert text/copy content and is not
rendered as HTML. A caller can pass `{ signal: abortController.signal }`; the client combines that
signal with its fixed timeout and cleans up timers/listeners after completion. A later UI can abort
an earlier controller before starting its replacement request.

Sanitized client error codes are `invalid_request`, `backend_unavailable`, `request_timeout`,
`request_cancelled`, `section_not_found`, `metric_not_found`, `backend_validation_error`,
`snapshot_unavailable`, `invalid_json`, `invalid_response`, and `unexpected_status`. Raw fetch
exceptions and backend error bodies are not exposed.

### Local backend-tools startup

From `services/resilience-agent`, configure only the reviewed frontend origins and start the
accepted deterministic backend:

```powershell
$env:RESILIENCE_CORS_ALLOWED_ORIGINS = "http://127.0.0.1:8001,http://localhost:8001"
.\.venv\Scripts\uvicorn.exe resilience_agent.api:app --host 127.0.0.1 --port 8080
```

From the nested frontend repository root, start the static server:

```powershell
python -m http.server 8001
```

Then open:

```text
http://127.0.0.1:8001/coldwave-demo-v2/?assistantMode=backend-tools
```

This only makes the dormant client callable from the browser console or future reviewed wiring.
No current UI action calls it.

## Caveats

- This is experimental v0 logic.
- Speed-based Q(t) measures observed operational performance, not total societal resilience.
- Delay burden is supplemental user-impact information.
- `volume_2025` is a profile demand weight, not observed event-day traffic volume.
- Data-driven phase detection is sensitive to smoothing, threshold, missing data, and congestion noise.
- This v2 is local-only and is not deployed.
