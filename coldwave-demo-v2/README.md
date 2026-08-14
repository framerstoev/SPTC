# Roadway Resilience Explorer — Prototype

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

Selecting a search result zooms to the control section, highlights it, updates the selected-section panel, and lazy-loads the curve JSON only for that selected section.

### Safe Result Rendering

Phase 2A4 replaced the former search-result HTML interpolation with reviewed DOM construction.
Each result is a created `button` containing created `strong` and `span` nodes; route,
control-section, county, and status values are assigned with `textContent`, and selection identity
is assigned through `dataset.key`. Clear, no-match, and result states use `replaceChildren`.
Fixtures containing script- and image-like text, event-handler text, quotes, apostrophes,
ampersands, angle brackets, route/county-like HTML, bounded long strings, and relevant control
characters remained inert visible text. No sanitizer dependency was added, and search ordering,
click/Enter selection, map zoom, and local curve loading are unchanged.

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
- centered six-observation rolling median (observations, not elapsed hours; no missing-hour interpolation)
- threshold = 0.90 x Q0
- k = 3 consecutive observations

Tier 3 curve metrics are observed operational performance labels. Tier 1/2 variables are shown as predictor/context layers for future modeling.

## Q(t) Chart

The default-open selected-section chart shows the full Jan. 1-Feb. 3 Q(t) series for the selected
control section:

- raw Q(t) observations
- centered six-observation rolling median
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

## Phase 3I Review Interface

Phase 3I changes the presentation only. The analytical data, Q(t) calculation, Candidate B phase
logic, metrics, warnings, backend contracts, local model, and launcher process behavior are
unchanged.

### Analysis sidebar and Q(t)

At the Phase 3I checkpoint, the left panel was reserved for analytical evidence.
Phase 3J retains that evidence order while moving application identity and statewide
counts into the shared header:

1. control-section search;
2. map-layer selection;
3. selected-section identity, warnings, and summary metrics;
4. Q(t) curve and phase metrics;
5. Tier 1/2 context and delay proxy; and
6. method and limitations.

The Q(t) details region is open by default. Before selection it says **Select a control section to
view Q(t).** Selecting a supported section still lazy-loads the existing curve JSON and renders the
unchanged curve, markers, warnings, and phase metrics without a second expansion click. Tier 1/2
context and method/limitations remain collapsed by default.

### Adjustable desktop analysis panel

At viewport widths of 981 px and above, the workspace is `analysis panel | separator | map`. The
initial analysis-panel width is 420 px, the minimum is 320 px, and the absolute maximum is 650 px.
The actual maximum is reduced on smaller desktop viewports so at least 480 px remains for the map.
The width is not saved; reload resets it to 420 px.

The 10 px separator supports pointer dragging and the keyboard. Arrow Left/Right changes the width
in 16 px increments; Home selects the minimum and End selects the current dynamic maximum. It is a
focusable vertical `separator` with an accessible label and current/minimum/maximum ARIA values.
Pointer capture and cancellation are bounded, and active dragging suppresses text selection.

Panel changes are coalesced through `requestAnimationFrame`. The existing Leaflet instance receives
`map.invalidateSize({ pan: false, debounceMoveend: true })`, and the existing Chart.js curve is
resized; neither component is recreated. Below 981 px the separator is hidden and the existing
single-column responsive layout is retained.

### Floating unified AI Assistant

The Assistant no longer occupies the analysis sidebar. A lower-right **AI Assistant** launcher is
collapsed by default. Opening it sends no request, focuses the Close control, and reveals one
floating panel; closing it returns focus to the launcher. Escape also closes the panel. On desktop
the panel is at most 430 px wide and approximately 74% of the viewport height. At 768 px and below
it becomes a 12 px-inset, near-full-width bottom sheet with an internally scrolling timeline and
accessible composer. Opening or closing it does not change map dimensions.

The panel contains one conversation/result timeline for both reviewed execution paths:

- the three quick actions call their existing deterministic endpoints and label their output
  **Verified result**; and
- free-form questions continue to call `POST /api/v1/assistant/query` and label accepted model
  output **AI-assisted response**.

The execution paths remain separate. A deterministic action is never routed through the AI
endpoint, and a free-form question does not replace the deterministic tool contracts. Successful
ready states are intentionally silent; concise status text is retained for selection required,
loading, clarification, cancellation, unsupported requests, response rejection, and service or AI
unavailability.

Three compact suggestions are shown initially: **What happened here?**, **Explain this warning.**,
and **Planning vs. observed evidence?** Five additional supported examples remain under the native
**More suggestions** disclosure. Context-dependent suggestions are disabled when their section or
metric requirement is unavailable. Every suggestion uses the same validated free-form submission
path as typed input.

The normal interface intentionally does not display Qwen, Ollama, model, GPU, or FastAPI branding.
Those implementation names remain in technical configuration, operations, and QA documentation
where they are needed. The permanent scope text is reduced to one sentence plus a disclosure; the
analytical warnings, limitations, evidence, and method cautions are not removed.

## Assistant Modes and Local-Only Architecture

The committed default remains `local-template`; `backend-agent` is local-review behavior and is not
a deployment-readiness claim.

| Mode | Activation | Behavior |
| --- | --- | --- |
| `local-template` | Default and fail-closed fallback | Deterministic local explanatory templates; no Assistant API request. |
| `backend-tools` | Exact `assistantMode=backend-tools` on loopback HTTP | Three deterministic quick actions call their accepted backend endpoints. |
| `backend-agent` | Exact `assistantMode=backend-agent` on loopback HTTP | Adds the bounded free-form composer while retaining all deterministic quick actions. |

`backend-agent` activates only from plain HTTP on exactly `127.0.0.1` or `localhost`, with one
exactly cased `assistantMode` parameter. HTTPS, `file://`, GitHub Pages, remote hosts, userinfo,
malformed or differently cased values, duplicate mode parameters, and backend/model/provider/key/
timeout override parameters resolve to `local-template`. There is no normal-UI mode selector.

The browser destination is fixed at `http://127.0.0.1:8080`. It never contacts Ollama or port
`11434`; only FastAPI contacts the loopback-only model service server-side. The frozen browser
client retains exactly four methods:

- `getSectionSummary(csId, options?)` -> `GET /api/v1/sections/{cs_id}`
- `explainMetric(metricName, options?)` -> `GET /api/v1/metrics/{metric_name}`
- `generateSectionReviewNote(csId, options?)` -> `POST /api/v1/reports/review-note`
- `queryAssistant(request, options?)` -> `POST /api/v1/assistant/query`

The three quick actions remain usable when Ollama is stopped, the AI endpoint is unavailable, a
request is unsupported, or model prose is rejected. Section explanation uses the reviewed section
summary; metric explanation uses only a reviewed current-layer mapping; review-note generation
retains its initially collapsed draft and validated Markdown copy behavior.

### Composer, context, and safe rendering

Only `backend-agent` enables the visible **Ask a question** textarea. It accepts plain text only,
rejects blank input, enforces 1,000 characters, displays a character count, sends on Enter,
preserves a newline on Shift+Enter, prevents duplicate submission, and shows Cancel while loading.
There is no upload, browser storage, telemetry, automatic retry, or automatic question.

Every free-form request sends the current frontend `selected_section_id` and reviewed
`active_metric` when present. Frontend selection remains authoritative. Private history contains at
most four bounded user/assistant text records and excludes tools, evidence, warnings, DOM text,
prompts, and configuration. A section or layer change cancels pending work, rejects late results,
clears history and stale timeline output, identifies the new context without sending a request, and
leaves an already-open floating panel open.

The response client still validates the closed schema, HTTP/status pair, size bounds, finite
structured values, warnings, evidence, release/method identifiers, and restricted content. Output
uses created DOM nodes, `textContent`, reviewed attributes, and native `details`/`summary`; it does
not parse Markdown, raw JSON, model reasoning, internal paths, or executable markup. Essential
warnings remain visible, while longer evidence, limitations, tools, and release/method metadata use
compact disclosures.

The supported scope remains explanation of one reviewed section or metric, warning/status meaning,
comparison of exactly two explicit sections, one-section review-note generation, and the
planning-context versus observed-evidence distinction. Prediction, causal/physical-damage claims,
investment or treatment recommendations, raw/restricted data access, arbitrary export, code/SQL/
shell/file/internet execution, prompt/provider disclosure, filter/rank/map control, and other
unreviewed tools are declined.

Conversational paraphrase robustness remains a deferred item. Phase 3I does not change routing,
prompts, tool descriptions, or backend orchestration merely to accept additional wording variants.

## Phase 3J Map-First Visual Polish

Phase 3J changes frontend presentation and prepares a maintainable view seam only. The visible
application title is **Roadway Resilience Explorer**, with a secondary **Prototype** badge and
compact **Winter Weather Pilot · Data-driven Review** context. A thin shared header presents the
four already-reviewed statewide values exactly once: 10,029 sections, 3,842 observed curves,
3,473 valid phases, and 18 censored recoveries. They are informational, not clickable, and no
percentage or new statewide metric is inferred.

The root application shell now separates shared chrome from
`#explorerView[data-app-view="explorer"]`. This is a stable insertion seam for a future real
Overview and navigation, but Phase 3J deliberately adds no Overview control, statewide chart, or
global AI behavior. See [OVERVIEW_ARCHITECTURE.md](OVERVIEW_ARCHITECTURE.md) for the future
deterministic aggregate boundary and unresolved district source.

### Explorer evidence and map

- The map remains the dominant desktop workspace. The 420 px default resizable analysis panel,
  320 px minimum, dynamic 650 px maximum, 480 px minimum map reserve, keyboard separator, and
  throttled Leaflet/Chart resize behavior are retained.
- Selected route/CS identity is visually primary. Detection/class/support/TMC badges remain
  textual, and the no-sustained-drop, censored-recovery, and no-observed-support warnings now sit
  directly in the selected-section evidence region rather than inside a collapsed method region.
- Four unchanged headline values use a compact two-column value-first visual hierarchy. One
  visible note carries their event/method limitation; a censored recovery qualification remains
  explicit rather than color-only or hover-only.
- Q(t) remains open and lazy-loaded. The raw observations are quieter, the existing centered
  six-observation rolling median and event markers are visually stronger, and the chart spacing,
  grid, and axis text are calmer. Data, smoothing, phase timing, mathematical domains, markers,
  and warnings are unchanged; observations are not elapsed hours and missing hours are not
  interpolated.
- The current OpenStreetMap source is unchanged. A modest saturation/contrast/brightness filter is
  scoped only to tile images; resilience Canvas geometry, controls, chart, warnings, and Assistant
  are not filtered.
- Selection now uses a white outer halo and dark casing around the existing thematic-color core.
  The clones are noninteractive, are replaced on each selection, and refresh on layer/zoom changes
  without changing classifications or unselected styles.
- The unique reviewed legend is a collapsed, keyboard-accessible Leaflet map control. Its class
  meanings, quantile breaks, status colors, continuous ranges, and p99-cap wording are unchanged.
  The map-layer selector remains in the analysis panel and is not duplicated.

### Retained Assistant boundary

The floating Assistant remains collapsed by default, lower-right on desktop, and an inset bottom
sheet on narrow screens. It retains the one timeline, deterministic **Verified result** actions,
free-form **AI-assisted response**, safe rendering, cancellation/staleness protection, and zero
request behavior on page load, section/layer changes, and open/close. Phase 3J aligns only its
visual chrome with the refined interface. The browser still calls FastAPI only and never calls
Ollama or port 11434 directly.

Backend HEAD `5edc4688514f2c47ae3e8c03f50b853c0f5d8108`, model configuration,
analytical data, Q(t), Candidate B, metrics, warning contracts, snapshots, and the accepted Phase
3H launcher are unchanged. Statewide AI analytics and the candidate network-summary tools are not
implemented. Conversational paraphrase robustness remains deferred.

### Accepted local demo launcher

The Phase 3H launcher remains the preferred local-only startup path. It uses the already-installed
`qwen3:8b`, the accepted read-only FastAPI backend, and loopback-only Ollama; it adds no cloud model,
API key, deployment, download, driver change, or CPU fallback.

Phase 3I leaves the backend unchanged at accepted HEAD
`5edc4688514f2c47ae3e8c03f50b853c0f5d8108`; it also leaves the installed model and its reviewed
configuration unchanged.

From the nested frontend repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\local-demo\start-local-chatbot-demo.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\local-demo\status-local-chatbot-demo.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\local-demo\stop-local-chatbot-demo.ps1
```

The production review URL remains:

```text
http://127.0.0.1:8001/coldwave-demo-v2/?assistantMode=backend-agent
```

See `../local-demo/README.md` from this folder for GPU preconditions, verified process ownership,
warm-up, rollback, logs, and manual three-process details. Phase 3I does not change any launcher,
backend, Ollama, or model behavior.

This remains a local experimental review prototype. Public hosting, authentication, licensing,
canonical timezone, backend hosting, and deployment hardening remain unresolved.

## Caveats

- This is experimental v0 logic.
- Speed-based Q(t) measures observed operational performance, not total societal resilience.
- Delay burden is supplemental user-impact information.
- `volume_2025` is a profile demand weight, not observed event-day traffic volume.
- Data-driven phase detection is sensitive to smoothing, threshold, missing data, and congestion noise.
- Local Qwen routing or synthesis can fail closed; rejected prose is not a substitute for the
  separately rendered deterministic evidence, warnings, and **Verified result** quick actions.
- Phase 3I changes interface structure only; conversational paraphrase robustness remains deferred.
- Full screen-reader and assistive-technology validation is not included.
- This v2 is local-only and is not deployed.
