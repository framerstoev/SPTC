# Independent V3 local demo launcher

Run from `E:\Projects\PhD\SPTC\data\front-end\sptc-demo` in Windows PowerShell.
This is a local-only launcher, not a deployment. No software, model, driver,
firewall, analytical method, data, or Assistant tools are installed or changed.

## Commands and version boundaries

V2 start (original URL and original checkpoint requirements remain unchanged):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\local-demo\start-local-chatbot-demo.ps1
```

V3 start:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\local-demo\start-local-chatbot-demo-v3.ps1
```

V3 status:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\local-demo\status-local-chatbot-demo-v3.ps1
```

V3 stop:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\local-demo\stop-local-chatbot-demo-v3.ps1
```

V3 browser URL:
`http://127.0.0.1:8001/coldwave-demo-v3/?assistantMode=backend-agent`

V2 browser URL:
`http://127.0.0.1:8001/coldwave-demo-v2/?assistantMode=backend-agent`

The V3 static server exposes both pages. The accepted V3 backend supports both
profiles; V2 does not acquire V3 UI or tools. The original V2 launcher still pins
its original Phase 3F backend and Phase 3G frontend tag/ancestry and requires clean
worktrees. It is deliberately **not** repointed to the current V3 backend. To view
V2 with this checkout/backend, start V3 and open the V2 URL manually.

The explicitly named V3 entries select an internal, closed `v3` launcher profile.
Shared start/stop orchestration retains `v2` as its default. The original V2 status
entry, V2 tests, V2 constants, V2 checkpoint predicates, V2 browser target, and all
application code remain unchanged. Process supervision is shared rather than
duplicated. The internal profile is never selected from environment variables,
repository branch names, or a browser preference.

## Accepted application checkpoints

- Reviewed Phase 4C1 frontend content: `3abeb9d39d5b9851e0840392f186d08012aa52a7`
- Immutable Phase 4A frontend baseline: `e8d5cf801fb6f7fdeae0bc4a60406f76ba217b7d`
- Immutable frontend tag: `phase4a-v3-tier-aware-explorer-accepted`
- Backend runtime with reviewed response-contract fixes and analytical depth:
  `e6b0ad5600e1d0056cd927ba9034bda6243b6030`
- Immutable Phase 4A backend baseline:
  `b550f11ca75b8c4921667a264ae7a3ca78710ea9`
- Immutable backend baseline tag: `phase4a-v3-network-assistant-accepted`

Adding the launcher necessarily advances frontend HEAD. V3 therefore verifies
the immutable Phase 4A baseline/tag ancestry and the exact reviewed Phase 4C1
application commit ancestry. It compares the **entire repository** against the
Phase 4C1 content commit with renames disabled. The only
permitted committed differences are the exact launcher, launcher-test,
launcher-documentation and ignore-file paths returned by
`Get-V3DemoAllowedChanges` in `lib/LocalDemo.V3.ps1`. No application path is
allowlisted. This is application-content equivalence, not a claim that the new
launcher commit has the same Git hash as either application checkpoint. The
private V3 policy alone advances the content pin; V2 and shared lifecycle,
GPU checks, process ownership, port safety, and state handling are unchanged.

The backend HEAD must equal the exact reviewed runtime fix hash above. The
Phase 4A backend tag must still target the original baseline hash, independently
of runtime HEAD. Neither an arbitrary descendant nor the old baseline as runtime
HEAD is accepted. This explicit V3 pin update does not change V2 checkpoint rules
or move either Phase 4A tag.
Both worktrees must be clean, including untracked files, except for the previously
accepted **untracked root `debug.log`** in the frontend. A tracked change to that
file or another debug/log filename is not accepted. No user file is deleted.
There is no dirty-worktree bypass for development or acceptance.

The additional annotated tag `phase4a1-v3-local-launcher-accepted` is created only
after launcher tests and actual local acceptance pass. It identifies the final
launcher checkpoint and never moves the Phase 4A application tags.

## Startup and GPU checks

The startup sequence checks repository/executable prerequisites, the installed
fixed model manifest, Windows GPU device health and `nvidia-smi`, port ownership,
Ollama API/model availability, explicit model warm-up, `100% GPU` allocation,
FastAPI health, both frontend URLs and the V3 OpenAPI tool/profile contract. Only
then does it open the V3 URL. No Assistant request is made during these checks.

The GPU must be `NVIDIA GeForce RTX 4060 Laptop GPU`, with Windows status `OK`,
ConfigManagerErrorCode `0` and successful `nvidia-smi`. A CPU-only or mixed
CPU/GPU model allocation fails closed. A driver update is not assumed successful:
every start repeats the device checks and checks residency after warm-up. There
is no automatic driver repair, reboot or CPU fallback.

The already-installed model is exactly `qwen3:8b`. Warm-up uses the accepted
`python -m resilience_agent.assistant_warmup` provider command. Only its sanitized
`READY elapsed_seconds=...` result is accepted; no raw prompt or answer is printed.
The default warm-up bound is 120 seconds (configurable 80–180 seconds). The
default service-readiness bound is 30 seconds (configurable 10–60 seconds).

FastAPI uses the existing `.venv\Scripts\uvicorn.exe resilience_agent.api:app`
entry, bound to `127.0.0.1:8080`, with the reviewed snapshot, assistant enablement,
fixed local Qwen provider and CORS origins `http://127.0.0.1:8001` and
`http://localhost:8001`. The static server binds only to `127.0.0.1:8001`.
V3 retains the frontend's existing `assistant_profile = "v3"` behavior. Its
network tools use `/api/v1/assistant/query`; the launcher adds no backend route.

Successful startup prints GPU/driver/VRAM, warm-up time, frontend/backend readiness
times, total startup time and the final URL. `-NoBrowser` explicitly suppresses
browser opening for an operator-controlled check. If normal auto-open fails,
the healthy demo remains running and the URL is printed for manual opening.

## Ownership, coexistence and shutdown

V3 state is separate: `local-demo/.runtime-v3/active-session.json`. V3 bounded
operational logs are under `.runtime-v3/logs/<session-guid>/`. V2 continues using
`.runtime/active-session.json`. Both runtime namespaces are Git-ignored. They
contain operational metadata/logs, not chat questions, answers, evidence or
row-level analytical data. Do not use the runtime folders as application logs.

V3 holds the original V2 lifecycle lock during startup and its own V3 lock during
startup/stop. This prevents concurrent launch ownership during model warm-up.
An existing V2 state file causes a clear conflict; V3 never edits/deletes V2
state, even if it looks stale. Use the V2 status/stop workflow to inspect it.
Occupied frontend/backend ports fail closed, including a repeated V3 start;
use V3 status or stop first. The launcher prints the conflicting PID/executable
and never kills a process just because of its port or executable name.

A pre-existing Ollama is reused only when its executable, listener identity,
loopback-only address (`127.0.0.1:11434`) and local API/model contracts are verified.
It is recorded as externally owned and never stopped by V3. If Ollama is absent,
the launcher may start its own loopback-only instance. Unbound/unverifiable
Ollama processes or unrelated port-11434 listeners block startup.

Every owned process is tracked by PID, absolute executable path, UTC process
creation time and parent/child linkage. The shared supervisor starts the service
suspended inside a kill-on-close Windows Job Object. It opens the startup gate
only after durable ownership recording. Bounded helper cleanup and shutdown
revalidate identity; a reused PID never authorizes termination.

After reboot or independently restarted Ollama, a validated V3 state for which
**no recorded process identity matches** is stale: startup removes only that
V3 state file, without terminating any process. Partially matching state is
preserved and blocks a new start. Malformed state or reparse-point runtime paths
also fail closed. No arbitrary live Windows process is used for stale-state tests.

Stop terminates only verified V3-owned frontend/backend and supervisors, then
attempts model unload, then stops V3-owned Ollama if applicable. A pre-existing
Ollama remains. As in the accepted V2 lifecycle, pre-existing model residency is
preserved; a model made resident by this launcher is unloaded only against the
same verified Ollama identity. The model remains installed. Any failed owned
cleanup retains state for a safe retry. Ports 8001/8080 must be released when
owned by V3; 11434 may remain on loopback for external Ollama.

This is a trusted single-user local-workstation workflow, not protection against
another account able to rewrite the launcher/runtime files. Status prints only
operational facts, never raw state, service log bodies or chat content.

## Verification

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\local-demo\tests\run-local-demo-tests.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\local-demo\tests\run-local-demo-v3-tests.ps1
```

The original V2 assertions/checkpoint expectations are unchanged. Dedicated V3
fixtures cover both profiles, strict application equivalence, known-debug-file
handling, GPU/model failures, unrelated listeners, stale/reused identities,
state validation/cleanup, ownership-aware shutdown, browser fallback and status
privacy. Test-created temporary directories are bounded and cleaned safely.

Current real acceptance uses the production-page browser harness
`coldwave-demo-v3/tests/run_phase4c_browser_qa.py --scenario live`, which reuses
the accepted Phase 4A/4B lifecycle and preservation checks, with an isolated
temporary Chrome profile and an artifact directory outside the repository. It
checks tier synchronization, concept/ranking/Dallas/alignment/refusal workflows,
deterministic evidence/warnings, cancellation, V2 coexistence, viewports, map/
curve operation, zero automatic Assistant requests and zero browser traffic to
Ollama. Alignment's unresolved classification remains
`method_definition_required`; rankings are not investment recommendations.

No push, merge, deployment, remote-server work or research recalculation belongs
to this launcher workflow.

## Phase 4C acceptance record — 2026-09-09

Starting frontend/backend: `88d040740c424543d0144daec75d767e913ededf` /
`e289aeb9ecf92d8d3d2f937dbc2d693342a35bee`. Both Phase 4C branches are
`feature/v3-assistant-analysis-depth`. Backend runtime is
`cc30a34dae57c2046c81c2ac9ed7d82782d50a1c`. Browser acceptance ran on frontend
`b5f4ae90eca7a70d47a3c960f58af008b3ecf7ac`; the final documentation-only descendant
uses the same application content and exact backend pin. Resolve final local tags:
`phase4c-v3-analytical-assistant-accepted` (frontend) and
`phase4c-assistant-analysis-depth-accepted` (backend). Prior tags are unchanged.

Capabilities and boundaries:

- The earlier ranking display was a bounded subset. It now explicitly labels
  3,473 eligible Tier 3 scores and the highest/lowest ten. Full access uses
  deterministic pages of 25 (API maximum 100), stable dense ties, county scope,
  first/previous/next/last controls and visible row range. No pagination LLM calls.
- `compare_section_resilience` uses host-owned current selection. Evidence:
  exact CS/route/county, Potential, Observed, WEATHER_REI, NETWORK_REI, support/
  status, eligible statewide distributions/medians, percentile/dense-rank positions,
  paired-sample medians and warnings. Explicit statewide scope retains alignment.
- Percentiles use mean strict/weak empirical CDF, `100*(below+0.5*equal)/N`;
  descending dense rank counts distinct greater values. Each metric has its own
  non-null denominator; paired references share 3,473 valid pairs. No consistency
  thresholds/classes were invented. See the backend Phase 4C method document.
- Dallas remains 58 total / 56 supported / 2 unsupported. Four metric summaries
  add Q1/Q3/min/max/N, statewide medians and above/below/equal relations, plus
  county-median percentiles among individual sections. Existing three highest/
  three lowest observed examples and all four detection status counts remain.
  No county composite, county Q(t), timing aggregation or CSV export was added.
- Direct facts precede interpretation. Ordinary ranking/county prose omits
  repeated generic investment/prediction/causality disclaimers. County coverage is
  stated once; alignment has one method-definition caveat. Contextual “why” keeps
  a causality limitation; missing/censored/no-drop statuses retain their cautions.
  Structured warnings, limitations and provenance remain in the API.
- Assistant desktop default: 700px × 78vh; min 480×420; max 92vw×90vh. Top-left
  pointer resize and keyboard arrows preserve the lower-right anchor. Answers:
  18px, line height 1.5. Manual resize is disabled at <=900px, with bounded mobile
  layout. Keyboard/pointer tests do not constitute a full screen-reader audit.

Verification:

| Gate | Result |
| --- | --- |
| Backend unit/API/schema/release tests | 1,377 passed; one existing TestClient deprecation warning |
| Ruff format/lint; pip check | Passed |
| Source-backed real release; restricted/OpenAPI exposure | Passed; no snapshot rebuild |
| Frontend focused tests/checks | 120 passed; 12 local resources passed |
| Existing V3 real evaluator | 15/15, all original gates passed |
| New analytical-depth real matrix | 13/13 routing, response, evidence/warning and style checks |
| Phase 4A1-B real response regressions | 14/14; zero automatic retries |
| V2 real evaluator | 26/28, only accepted missing_metric/history_id_injection deviations |
| V3/V2 launcher suites | 134/134 and 92/92, including parse and stale/PID ownership cases |
| Final live browser | 431 checks; seven successful workflows; six viewports |
| Automatic Assistant / direct browser 11434 requests | 0 / 0 |
| Console errors / uncaught exceptions | 0 / 0 |
| Cancellation, stale results, deterministic actions, V2 coexistence | Passed |

Final browser end-to-end timings (seconds):

| Workflow | Seconds |
| --- | ---: |
| Tier 3 ranking | 4.737 |
| Selected-section comparison | 2.862 |
| Statewide alignment | 3.776 |
| Dallas statewide comparison | 3.982 |
| Dallas interpretation | 3.986 |
| Potential concept | 3.674 |
| Unsupported investment decline | 1.355 |

Successful workflow median/p95: **3.776 / 4.737 seconds** (nearest-rank p95).
Deterministic ranking initial page: **0.222s**; subsequent page operations:
**0.209–0.211s**, excluded from model latency. Pointer-resize CDP round trips:
**8.0–45.9ms** across desktop viewports; these are interaction checks, not frame-rate
benchmarks. Viewports: 1920×1080, 1440×900, 1366×768, 1024×768, 768×900, 390×844.
The nine browser Assistant requests comprised seven explicit workflows plus two
intentionally intercepted cancellation/staleness probes, not unsolicited queries.

GPU: RTX 4060 Laptop, Windows Code 0, NVIDIA 616.56, healthy `nvidia-smi`.
Qwen `qwen3:8b`: 100% GPU; launcher VRAM reading 5,846 MiB (live status 5,896 MiB).
Warm-up: 6.678s. Backend startup: 6.577s; frontend: 1.632s; total: 26.781s.
Browser auto-open was requested after readiness; the isolated production-page
browser run confirmed both V3 and V2 load. Ollama was externally owned, loopback
only at `127.0.0.1:11434`, and preserved throughout.

Stop succeeded: owned frontend/backend and supervisors stopped, Qwen unloaded,
8001/8080 released, external Ollama retained and the model still installed.
PID/path/start-time and Job Object protections, reboot/stale-state handling and
the original V2 launcher entry points/URL/checkpoint are unchanged.

An initial final-network assertion omitted the newly reviewed ranking-page route.
The Phase 4C harness now adds only that exact route; Phase 4A/4B defaults remain
unchanged. The full browser run was repeated and passed. No production safety
check or model validator was weakened to obtain acceptance.

Scope audit: 18 frontend/demo paths and 13 backend paths changed (including tests
and docs). New UI modules: `assistant-window.js`, `ranking-browser.js`; new backend
module: `analytical_depth.py`. Contracts, API/client projection, Assistant routing/
synthesis, focused/live tests and these documents comprise the remaining changes.
The only shared launcher change is the constant inside its explicit V3 branch.
V1/V2 frontend, Phase 4B workspace controller and analytical functions, all data,
Q(t), Candidate B, metrics and tier-alignment math remain unchanged. Worktrees are
clean except the accepted pre-existing frontend `debug.log`. Nothing was pushed,
merged or deployed. Phase 4C is ready for local Jason/TTI review, not deployment.

## Phase 4C1 acceptance record - 2026-09-09

### Checkpoints, scope and changed files

Starting frontend: `c6be1e3d094ffc18607a1c73791c544e37245aef`,
`phase4c-v3-analytical-assistant-accepted`. Starting backend:
`cc30a34dae57c2046c81c2ac9ed7d82782d50a1c`,
`phase4c-assistant-analysis-depth-accepted`. Both new branches are
`feature/v3-plain-language-ai`. Backend final runtime:
`e6b0ad5600e1d0056cd927ba9034bda6243b6030`. Frontend application/test content:
`3abeb9d39d5b9851e0840392f186d08012aa52a7`; final start/stop tested its private-pin
descendant `59e696b56801aae3e82f1f5bf4781953fe9c04eb`. This acceptance record is a
documentation-only descendant. Resolve the final frontend HEAD through
`phase4c1-v3-plain-language-ai-accepted`, and backend through
`phase4c1-plain-language-ai-accepted`. These are new local annotated tags; Phase 4A
and Phase 4C tags are not moved. No push, merge or deployment was performed.

Thirteen frontend/demo paths changed relative to Phase 4C:

- `coldwave-demo-v3/index.html`, `js/assistant-api.js`, `js/assistant-chat.js`:
  three novice suggestions, closed county contracts and answer-first rendering.
- Under `coldwave-demo-v3/tests/`: `assistant-client-tests.js`,
  `assistant-chat-tests.js`, `run_v3_frontend_qa.py`, `run_phase4a_browser_qa.py`,
  and new `run_phase4c1_browser_qa.py`.
- New `coldwave-demo-v3/PHASE4C1.md`.
- `local-demo/lib/LocalDemo.Core.psm1` (constant inside explicit V3 branch only),
  `lib/LocalDemo.V3.ps1`, `tests/run-local-demo-v3-tests.ps1`, and this document.

Seventeen backend paths changed:

- New `src/resilience_agent/project_language.py`, `county_benchmarking.py`,
  `plain_language_validation.py`.
- Existing `analytical_depth.py`, `api.py`, `assistant.py`,
  `assistant_contracts.py`, `network_contracts.py`, `network_tools.py`,
  `project_concepts.py` in the same package.
- New `tests/run_phase4c1_real_qa.py`, `tests/test_plain_language_counties.py`;
  updated `test_analytical_depth.py`, `test_v3_assistant.py`,
  `test_v3_assistant_api.py`, `test_v3_project_concepts.py`.
- New `docs/PHASE4C1_PLAIN_LANGUAGE.md` with audited methods, county calculations,
  diagnostic findings, safety boundaries and future-work note.

### Reviewed project language

The immutable backend `project_language.py::PLAIN_DEFINITIONS` contains the exact
default answers, normally two short paragraphs. The framework answer is 142 words.
The following are the final registry definitions for the six core concepts:

**Tier 1:** Tier 1 asks how much weather-related stress a road faced during this
event. It uses precipitation exposure and the roadway surface's susceptibility
to that exposure. A higher value means more weather-related concern, not stronger
resilience.

This is part of the planning side: what the road looks like on paper before
examining real traffic performance. It is not a complete measure of cold or ice
conditions.

**Tier 2:** Tier 2 asks how difficult it could be for the surrounding network to
cope if a road is affected. It uses traffic carried by the road, its network
connections, and nearby alternative roads. A higher value means more network
concern.

Together with Tier 1, it describes the planning side. Nearby alternatives are a
screening measure, not verified usable detours or observed traffic performance.

**Potential Resilience:** Potential Resilience combines planning-side information
from Tier 1 and Tier 2: weather exposure, roadway surface susceptibility, traffic,
network connections, and nearby alternatives. It describes what the road looks
like on paper before looking at real traffic performance.

A higher score means the road looks stronger on the planning side; a lower score
means more challenging conditions on paper. It is not a direct prediction of
Tier 3 and does not prove how the road actually performed.

**Tier 3:** Tier 3 asks what actually happened to traffic during the event. It uses
real traffic speed observations compared with normal traffic speed for the same
road and time of day, accounting for day of week where available. Q(t) means actual
speed compared with normal speed.

The traffic curve helps describe a detected drop, how low performance fell, and
recovery where it was observed. A higher observed score means a smaller average
speed-performance loss during the detected disruption. Missing observations cannot
establish the road's event performance.

**Q(t):** Q(t) means actual traffic speed compared with normal traffic speed,
followed over time. Normal speed comes from the road's baseline observations for
the same time of day and, where available, day of week.

A higher curve means traffic speeds are closer to or above normal; a lower curve
means slower traffic. Tier 3 uses this curve to examine drops and recovery. Speed
alone does not establish that a road was open, safe, or carrying normal traffic
demand.

**Project purpose:** This project uses planning information to describe roads and
real traffic observations where they are available. The planning side combines
weather exposure, roadway surface susceptibility, traffic, network connections,
and nearby alternatives. The observed side describes what happened to traffic
during this event.

Comparing them helps find roads where the planning picture and actual event
performance tell different stories. Those roads can be useful for further
engineering review. The tool does not currently predict performance for roads
without traffic observations or choose construction investments.

Normal answers omit dense rank, common-valid-pair, eligible population,
classification codes, percentiles and "structured summary/ranking" wording.
Evidence, warnings, limitations, release, method and provenance remain in the
validated response and technical disclosure. Explicit technical requests select
`TECHNICAL_DEFINITIONS`: official names, exact reviewed weights/normalization,
units, Q(t) baseline/fallback/clipping and Candidate B rules. A validated native
concept action is still required; the host returns its reviewed text without a
second model copy/synthesis call. No arbitrary model prose is accepted instead.

### Comparisons, county ranking and deterministic facts

Section answers lead with the conclusion, then planning position, observed
performance, meaning and a review-only next action. Both relative positions use
the SAME snapshot rows with observed support and both scores present: currently
3,473, derived from data. Strict "higher than" is `100 * count(value < selected) / N`;
ties are not counted as lower. The technical midrank percentile is retained but
is not mislabeled as strict "higher than". Existing map classes use a different
population, so no language bands or mismatch thresholds were added. Raw Potential
and Tier 3 scores are never directly subtracted. This is not prediction error.

For CS_1081, planning is higher than 10.797581% of the paired roads; observed is
higher than 3.397639%. The conclusion follows these same-group positions. The
current selected ID remains host-owned, not inferred from old chat. The real
comparison and subsequent "why" workflow passed without a causal/treatment claim.

New V3-only `rank_counties` / `POST /api/v1/counties/rank` accepts only four reviewed
metrics, numeric direction and an optional validated highlighted county. It groups
existing section values by county, equally weighted: median, existing type-7
Q1/Q3, metric N, total N, observed-support N and coverage. No minimum-N cutoff or
new composite is introduced. One-value counties remain included; null is never
zero and null medians remain unranked. Exact median ties share a dense rank, with
alphabetic tie ordering. The reference is the median of county medians, not the
median of individual roads. Explicit direction metadata protects interpretation.
The full bounded list (at most 254 counties) expands without another model/API call.

Dallas county-versus-county QA, descending numeric order (not investment priority):

| Metric | Median | County rank / available counties | Metric N / total |
| --- | ---: | ---: | ---: |
| Tier 1 weather concern | 0.625914 | 63 / 254 | 58 / 58 |
| Tier 2 network concern | 0.584718 | 4 / 254 | 58 / 58 |
| Potential | 0.297112 | 214 / 254 | 58 / 58 |
| Tier 3 observed | 0.701060 | 189 / 223 | 56 / 58 |

Dallas observed-score coverage is 96.552%; missing roads are not assigned scores.
Potential/observed medians are below county references; weather/network concern is
above. Existing statewide-roadway median comparisons remain separately identified.
Support/coverage is stated once in the normal answer. No small-N result is hidden.

Statewide alignment retains 3,473 pairs and Pearson `0.2771701622936432`.
`classification_status=method_definition_required`, with null consistency/mismatch
counts, remains unchanged. No calibration or classification method was invented.

### Verification results

| Gate | Result |
| --- | --- |
| Backend full unit/API/schema suite, final backend HEAD | 1,429 passed; one existing Starlette TestClient deprecation warning |
| Ruff format/lint; pip check | Passed; 88 Python files format-checked |
| Real-release source comparison, restricted-field/OpenAPI scan | Passed, 10,029 rows, five representative cases; no rebuild |
| Frontend JavaScript | 122 passed: client 44, actions 21, chat 23, search 8, tiers 7, resize/ranking 19 |
| Frontend static/resources | 10,029 features, 3,842 curves, 83 DOM IDs, three suggestions; 12 live resources passed |
| New Phase 4C1 real Qwen matrix | 26/26; routing, contract, deterministic evidence, direction and plain-language checks passed |
| Continuous real conversation | 11/11 with bounded history; zero automatic retries |
| Existing Phase 4A V3 real evaluator, final backend HEAD | 15/15; routing, numerical, contract and safety gates passed |
| Prior Phase 4C analytical real matrix | 13/13 before the final routing-context-only correction; final conversation covers affected ranking paths |
| Legacy V2 real evaluator, final backend HEAD | 26/28, only accepted missing_metric/history_id_injection safe deviations; no new regression |
| V3 / original V2 launcher suites | 134/134 and 92/92, including PowerShell parse, stale-state and PID-reuse safety |
| Final production-page real browser | 483 checks, 11 explicit workflows, six viewports; all passed |
| Automatic Assistant / direct browser port 11434 requests | 0 / 0 |
| Console errors / uncaught exceptions | 0 / 0 |
| Cancellation, stale-response protection, fixed actions, V2 coexistence | Passed |

The real source-validation summary SHA-256 remains
`812e84031d6eef3c854035b0cb0a0a513086c09f528d36fa6f63ee3c5d7f8d8e`.
The V2 native registry hash remains
`60846a1b631b159d38f4507a02cd42877b9fd291a4d2dd5c88d818e095dc39a5`.
Real evaluator outcomes distinguish routing, response-contract compliance,
deterministic numerical consistency, directional checks and safe declines; they
are not a claim of generic AI accuracy or exhaustive semantic verification.

Final browser workflow end-to-end latency:

| Workflow | Seconds |
| --- | ---: |
| Unsupported investment safely declined, no project evidence | 1.680 |
| Novice framework after decline | 1.133 |
| Potential plain-language definition | 1.234 |
| Exact technical follow-up | 1.132 |
| Selected-road comparison | 2.954 |
| Selected-road why/review interpretation | 3.063 |
| Dallas county-versus-county comparison | 3.670 |
| County ranking | 3.089 |
| Statewide section ranking after county history | 3.904 |
| Statewide alignment | 3.769 |
| Dallas multi-metric summary | 4.419 |

Median/p95 successful workflow latency: **3.063 / 4.419 seconds** (nearest-rank
p95). The 13 browser query requests comprise 11 explicit workflows plus two
intentionally intercepted cancellation/staleness probes, not automatic questions.
Full section pages first/next/last/previous/first used offsets 0/25/3450/3425/0,
taking 0.138/0.106/0.106/0.106/0.130 seconds without any extra model call.
Pointer-resize round trips were 9.8-18.3ms, not a frame-rate benchmark.

Viewports: 1920x1080, 1440x900, 1366x768, 1024x768, 768x900 and 390x844.
Screenshots were visually reviewed for bounded readable Assistant text, composer
placement and retained maps/curve. Production-page artifacts are outside Git at
`E:\Projects\PhD\SPTC\.tmp-phase4c1-browser\phase4a-browser-20260909T214328Z-2760d5b1`.
The browser run used the same application bytes as the final reviewed content;
later changes only corrected QA disclosure checks, V3-private pins and docs.

### Diagnosed issues and bounded corrections

Live sequence testing caught two genuine routing-context problems: framework
questions after a decline could produce prose without a native action (before
tool execution); statewide ranking after county questions could inherit an
unauthorized county (rejected by host validation before execution). Resolved V3
concept and ranking routing now omit raw previous chat. The host explicitly binds
the already-resolved technical topic, and current-question/host-layer scope still
controls ranking. History-only identifiers remain rejected; V2 history is unchanged.
The backend method document records the exact stages and bounded reproduction.
No retries, arbitrary-output acceptance, expanded permissions or weaker validation
were added. Both isolated and continuous real sequences were rerun successfully.

A later browser QA false positive scanned intentionally requested official metric
names and closed technical JSON as default prose. A backward-compatible QA text
hook leaves the old default behavior intact; Phase 4C1 excludes only the explicit
technical answer and closed disclosure from its default-language check. Full
timeline private-path/runtime-leak checks, DOM execution guards and network/console
checks still apply. The entire 483-check browser run then passed. This did not
change production UI or weaken model/action validation.

### Final launcher and cleanup

The final version-lock start on `59e696b56801aae3e82f1f5bf4781953fe9c04eb` verified
application equivalence to `3abeb9d39d5b9851e0840392f186d08012aa52a7` and exact backend
`e6b0ad5600e1d0056cd927ba9034bda6243b6030`, with clean worktrees except the accepted
existing frontend untracked `debug.log`. GPU: RTX 4060 Laptop, Windows Code 0,
status OK, driver 616.56, healthy `nvidia-smi`. Qwen: `qwen3:8b`, 100% GPU, no CPU
fallback; total VRAM used/free 5,991/1,966 MiB. Model residency reported 5,320 MiB.

Warm-up: **5.772s**. Backend startup: **5.166s**; frontend: **1.112s**;
total: **19.985s**. Browser opening was requested only after readiness at the V3
URL above. Both V2 and V3 URLs and `/health` returned HTTP 200. The isolated real
browser run additionally verified actual rendering and Assistant interaction.

Ollama was pre-existing and retained its verified PID/path/exact start-time
identity, listening only on `127.0.0.1:11434`. Final stop unloaded the model made
resident by this launcher, stopped only the owned frontend/backend and supervisors,
released 8001/8080 and removed its completed V3 session state. A subsequent check
showed empty `ollama ps`, installed `qwen3:8b`, no V3 state, free 8001/8080 and the
same external loopback Ollama. No unrelated process was terminated. Job Object,
parent/child identity, stale/reused PID and reboot safeguards are unchanged.

V1/V2 production files, original V2 launcher entries/expectations, Phase 4B dual-map
workspace/synchronization/splitters/hide-show, Phase 4C 700px/18px resizable chat
and ranking pagination remain intact. App/CSS/data and research scripts, formulas,
Candidate B, Q(t), score values and alignment math were not modified or regenerated.
Backend is clean; frontend retains only the accepted untracked `debug.log` after
the documentation commit. No chat/evidence runtime logs or QA artifacts are committed.

Future calibration is documented separately in both Phase 4C1 method notes:
planning inputs -> validated model -> expected Tier 3 -> comparison where observed
and estimation elsewhere only after validation. It does not exist yet. No training,
unsupported-road predictions, thresholds, remote-server changes or K3s packaging
were performed. **Phase 4C1 is an accepted local candidate for the next K3s baseline;
deployment readiness/security remain a separate future phase.** Stop here.
