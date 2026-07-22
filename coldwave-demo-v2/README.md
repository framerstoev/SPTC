# Experimental Data-Driven Resilience Curve Prototype

This is a local experimental frontend for the data-driven resilience curve v0 results. It is not the stable deployed `coldwave-demo` dashboard and should not replace the stable score formulas.

## Main Page

Open locally from `data/front-end/sptc-demo`:

```powershell
python -m http.server 8001 --bind 127.0.0.1
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

## Fixed Deterministic Assistant Actions

Phase 2A3 connects the reviewed runtime configuration and bounded client to exactly three visible,
selected-section actions:

- **Explain this section** uses the current deterministic local section preview in
  `local-template` mode and the reviewed section-summary endpoint in `backend-tools` mode.
- **Explain the current metric** is available only when the selected map layer has an accepted
  metric mapping. It returns mapping-only local text in `local-template` mode and the reviewed
  metric-registry explanation in `backend-tools` mode.
- **Generate review note** requires the deterministic backend. A successful result shows a compact
  summary, a visible **Draft for human review** label, and a collapsed full-note area. The local
  template never fabricates the full draft.

The Assistant displays a persistent **Local template** or **Backend tools** mode label and textual
loading, result, fallback, and draft states. The old free-form composer remains only as a dormant
future hook: its container is hidden, its input and Send button are disabled, and no Enter, Send,
or prose-to-backend path is bound. Compare, filter, rank, curve-API, map-action, and natural-language
chat behavior are not available.

Neither mode makes an Assistant backend request on page load, mode resolution, section selection,
or layer change. Only an explicit click on one of the three enabled actions can invoke a backend
client method. Existing dashboard requests for static summary, GeoJSON, tiles, and selected local
curve JSON remain separate from Assistant API traffic.

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
reviewed response fields. Review-note Markdown remains inert copy content and is never parsed or
rendered as HTML.

The action controller keeps runtime mode separate from explicit request state. Starting a new action
aborts the previous request and replaces its generation token. A section or map-layer change also
aborts and invalidates any pending action. Late, cancelled, or stale results are ignored without an
error or fallback warning. This protects the current selection from receiving a result requested for
an earlier section or metric.

In `backend-tools` mode, reviewed network, timeout, not-found, validation, snapshot, JSON, response,
and unexpected-status failures produce a visible backend/fallback label and the corresponding local
template result. Review-note failure explicitly states that no draft was generated and does not show
the full-note or copy controls. Cancellation and staleness remain silent.

Section-summary results are deliberately compact: identity, support/detection status, no more than
three observed metrics, no more than three planning-context metrics, warnings, and the distinction
between planning context and observed evidence. Metric results describe the metric definition,
unit, applicability, null meaning, and no more than three limitations; they do not rank the selected
section or add a preferred direction.

A successful review note keeps the normal response compact. Its native, initially collapsed
**Open full review note** control contains the accepted six structured sections in order, followed
by separate warnings, limitations, and human-review checklist blocks. **Copy Markdown** copies the
client-validated `rendered_markdown` string exactly. Copy success, unavailable Clipboard API, and
copy rejection are announced with concise accessible text; copied content is not stored or inserted
as HTML.

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
python -m http.server 8001 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:8001/coldwave-demo-v2/?assistantMode=backend-tools
```

The normal local-template page remains:

```text
http://127.0.0.1:8001/coldwave-demo-v2/
```

Reloading either URL makes no Assistant API request. On the backend-tools URL, select a valid
control section and explicitly choose one of the three fixed actions to make a reviewed request.
The detection-status and supplemental-delay map layers do not have accepted metric explanations,
so **Explain the current metric** is disabled for those layers with a visible reason. The section and
review-note actions remain available.

There is no LLM, free-form assistant request, credential, API key, health preflight, retry,
telemetry, or user-configurable backend URL. Backend output is rendered through created DOM nodes
and `textContent`; the Phase 2A3 Assistant renderer does not use dynamic HTML or a Markdown parser.

## Caveats

- This is experimental v0 logic.
- Speed-based Q(t) measures observed operational performance, not total societal resilience.
- Delay burden is supplemental user-impact information.
- `volume_2025` is a profile demand weight, not observed event-day traffic volume.
- Data-driven phase detection is sensitive to smoothing, threshold, missing data, and congestion noise.
- This v2 is local-only and is not deployed.
