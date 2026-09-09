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

- Reviewed Phase 4C1 frontend content: `f2387591720aeab9e43a517d1f1a93dd5e7ca263`
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
