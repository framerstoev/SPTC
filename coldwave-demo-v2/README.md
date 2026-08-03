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

The expandable selected-section chart shows the full Jan. 1-Feb. 3 Q(t) series for the selected
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

## Local Assistant: Fixed Actions and Bounded Qwen Chat

Phase 3G adds an explicit local-review `backend-agent` mode to the existing Assistant. The
committed default remains `local-template`; the new mode is not enabled on the deployed site and is
not a deployment-readiness claim.

The reviewed modes are:

| Mode | Activation | Behavior |
| --- | --- | --- |
| `local-template` | Default and fail-closed fallback | Deterministic local explanatory templates; no Assistant API request. |
| `backend-tools` | Exact `assistantMode=backend-tools` on loopback HTTP | Three deterministic fixed actions call their accepted FastAPI endpoints. |
| `backend-agent` | Exact `assistantMode=backend-agent` on loopback HTTP | Shows the bounded chat composer and keeps all three deterministic fixed actions available. |

`backend-agent` activates only from plain HTTP on exactly `127.0.0.1` or `localhost`, with one
exactly cased `assistantMode` parameter. HTTPS, `file://`, GitHub Pages, remote hosts, userinfo,
malformed or differently cased values, duplicate mode parameters, and backend/model/provider/key/
timeout override parameters resolve to `local-template`. There is no normal-UI mode selector.

The browser destination is fixed at `http://127.0.0.1:8080`. It never calls the Ollama service or
port `11434`. The frozen client exposes exactly four methods:

- `getSectionSummary(csId, options?)` -> `GET /api/v1/sections/{cs_id}`
- `explainMetric(metricName, options?)` -> `GET /api/v1/metrics/{metric_name}`
- `generateSectionReviewNote(csId, options?)` -> `POST /api/v1/reports/review-note`
- `queryAssistant(request, options?)` -> `POST /api/v1/assistant/query`

The three fixed actions are never routed through Qwen. They remain deterministic and usable in
`backend-agent` mode when the model is disabled, unavailable, or rejected:

- **Explain this section** uses the accepted section-summary endpoint.
- **Explain the current metric** uses the accepted metric-registry endpoint only for a reviewed
  current-layer mapping.
- **Generate review note** uses the accepted review-note endpoint and retains the compact draft,
  initially collapsed native details, and validated Markdown copy behavior.

### Composer and context ownership

Only `backend-agent` shows and enables the visible **Ask the local Qwen assistant** textarea. It
accepts plain text only, rejects blank input, enforces 1,000 characters, displays a live character
count, sends on Enter, preserves a newline on Shift+Enter, prevents duplicate submission, and shows
an accessible Cancel button while loading. No upload, browser storage, telemetry, automatic retry,
or automatic question is added. The normal UI does not expose the timeout; it may note that the
first response can take longer when the local model was not pre-warmed.

Every chat request sends the current frontend `selected_section_id` and reviewed `active_metric`
when present. Current frontend state is authoritative: history cannot select a section or metric.
The private history contains at most four records and only prior user text plus bounded assistant
answer text. It excludes tools, evidence, warnings, DOM text, prompts, configuration, and hidden
messages. A section or layer change cancels pending work, invalidates late responses, clears the
history, shows a context-reset notice, and sends no replacement request.

The eight visible suggestion buttons submit ordinary text through the same validated client:

- What happened on the selected section?
- Explain the current metric.
- Why is observed evidence unavailable here?
- What does the recovery-censored warning mean?
- Compare CS_1081 and CS_583693.
- Generate a review note for this section.
- What is the difference between planning context and observed evidence?
- What kinds of questions are outside the scope of this assistant?

Section- and metric-dependent suggestions are disabled when their required current context is
missing. In particular, **Explain the current metric** is not offered for an unsupported layer; the
frontend does not send an empty metric merely to exercise model clarification.

### Validated response presentation

The client uses CORS with omitted credentials, rejected redirects, `no-store`, JSON request/accept
headers, caller cancellation, and endpoint-specific internal timeouts: 8,000 ms for deterministic
tools and 80,000 ms only for chat. Requests are not retried.

Before rendering, the client reconstructs a frozen allowlisted copy containing only reviewed
`status`, `answer`, `intent`, `tools_used`, `evidence`, `warnings`, `limitations`, `clarification`,
`data_release`, and `method_version` fields. It checks HTTP/status pairing, array/text/number bounds,
finite structured values, warning and evidence shapes, exact release/method identifiers, and
restricted path/provider/HTML/raw-JSON content. Unknown fields, raw model payloads, and
chain-of-thought fields are ignored rather than passed to the renderer.

Chat output is built only with created elements, `textContent`, reviewed attributes, and native
`details`/`summary`. It does not parse Markdown or raw JSON. Each accepted completed,
clarification, or unsupported response displays the source label **Local Qwen3 8B + deterministic
tools**. Tools, deterministic evidence, warnings, limitations, and release/method metadata remain
separate; long evidence is collapsed initially and warnings include text labels rather than color
alone.

The seven reviewed response states are visibly distinct:

- `completed`: show the validated answer and any structured details.
- `clarification_required`: show the reviewed clarification prominently without fabricating a result.
- `unsupported_request`: show the reviewed limitation and retain supported suggestions.
- `assistant_disabled`: state that local chat is not enabled; fixed actions remain available.
- `model_unavailable`: state that local Qwen is unavailable without attributing a template to Qwen.
- `tool_error`: state that the deterministic tool could not complete; raw errors are hidden.
- `invalid_model_response`: state that the response could not be safely accepted; rejected prose is hidden.

The composer has a visible label and documented Enter/Shift+Enter behavior. Send, Cancel, and
suggestions are native keyboard-accessible buttons; loading/status use ARIA live/busy attributes;
and evidence uses native disclosure controls. Automated structure, keyboard, focus, and responsive
checks do not constitute full screen-reader or assistive-technology validation.

### Exact local Qwen demo startup

This is a three-terminal local workflow. It uses the installed `qwen3:8b` model, no cloud model,
and no API key.

1. Start Ollama loopback-only:

   ```powershell
   Set-Location E:\Projects\PhD\SPTC
   $env:OLLAMA_HOST = "127.0.0.1:11434"
   ollama serve
   ```

2. In `E:\Projects\PhD\SPTC\services\resilience-agent`, enable and pre-warm the accepted backend,
   then start FastAPI:

   ```powershell
   Set-Location E:\Projects\PhD\SPTC\services\resilience-agent
   $env:RESILIENCE_ASSISTANT_ENABLED = "true"
   $env:RESILIENCE_SNAPSHOT_DIR = ".local\snapshot"
   $env:RESILIENCE_CORS_ALLOWED_ORIGINS = "http://127.0.0.1:8001,http://localhost:8001"
   $env:RESILIENCE_MODEL_PROVIDER = "ollama"
   $env:RESILIENCE_OLLAMA_BASE_URL = "http://127.0.0.1:11434"
   $env:RESILIENCE_OLLAMA_MODEL = "qwen3:8b"
   $env:RESILIENCE_ASSISTANT_TIMEOUT_SECONDS = "75"
   $env:RESILIENCE_ASSISTANT_MAX_HISTORY_MESSAGES = "4"
   $env:RESILIENCE_ASSISTANT_MAX_TOOL_CALLS = "1"
   $env:RESILIENCE_ASSISTANT_MAX_ANSWER_WORDS = "180"
   .\.venv\Scripts\python.exe -m resilience_agent.assistant_warmup
   .\.venv\Scripts\uvicorn.exe resilience_agent.api:app --host 127.0.0.1 --port 8080
   ```

3. In `E:\Projects\PhD\SPTC\data\front-end\sptc-demo`, start the static server:

   ```powershell
   Set-Location E:\Projects\PhD\SPTC\data\front-end\sptc-demo
   D:\programming\Minicoda\python.exe -m http.server 8001 --bind 127.0.0.1
   ```

Open the local Qwen review URL:

```text
http://127.0.0.1:8001/coldwave-demo-v2/?assistantMode=backend-agent
```

The unchanged local-template and deterministic-tools URLs remain:

```text
http://127.0.0.1:8001/coldwave-demo-v2/
http://127.0.0.1:8001/coldwave-demo-v2/?assistantMode=backend-tools
```

Before stopping Ollama, optionally unload the model with `ollama stop qwen3:8b`; then stop Ollama,
FastAPI, and the frontend with Ctrl+C. A one-command launcher is not included in Phase 3G.

The supported scope is explanation of one reviewed section or metric, warning/status meaning,
comparison of exactly two explicit sections, one-section review-note generation, and the
planning-context versus observed-evidence distinction. Prediction, causal/physical-damage claims,
investment or treatment recommendations, raw/restricted data access, arbitrary export, code/SQL/
shell/file/internet execution, prompt/provider disclosure, filter/rank/map control, and other
unreviewed tools are declined.

This remains a local experimental review prototype. Public hosting, authentication, licensing,
canonical timezone, backend hosting, and deployment hardening remain unresolved.

## Caveats

- This is experimental v0 logic.
- Speed-based Q(t) measures observed operational performance, not total societal resilience.
- Delay burden is supplemental user-impact information.
- `volume_2025` is a profile demand weight, not observed event-day traffic volume.
- Data-driven phase detection is sensitive to smoothing, threshold, missing data, and congestion noise.
- Local Qwen routing or synthesis can fail closed; rejected prose is not a substitute for the
  separately rendered deterministic evidence and warnings.
- The Phase 3G model-unavailable production-page scenario passed 100 checks with a 2.16-second
  visible unavailable-state latency. The real-Qwen browser matrix and Qwen latency remain pending
  because the RTX 4060 driver failed the required `nvidia-smi` health check. See `QA_NOTES.md`.
- Full screen-reader validation and a one-command launcher are not included.
- This v2 is local-only and is not deployed.
