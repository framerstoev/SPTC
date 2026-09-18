# Phase 4E-B local integration

Integration branch in both repositories: `feature/v3-gemma-planning-left-integration`.
Frontend application checkpoint: `e9b1e9cf14ccde0a03534f8cce70a38853403d2f`.
Backend integration: `61726c9890526a5dd79a79ab3ed40c83a3ae9bb3`.

At entry, frontend was detached at `345fe7a4d4f4bd4299c027d0c2cd7e1254b2819b`
with only accepted untracked `debug.log`; backend was clean and detached at
`e6b0ad5600e1d0056cd927ba9034bda6243b6030`. Frontend integration was based on
`feature/v3-planning-left-workspace` at
`346bd4fc73b9e9d2bbe90d6853dcfb433e78d8fa`; backend integration was based on
`feature/v3-gemma4-12b-assistant` at
`e3c7547a25c3283c34f8165e05a7bdd969b24af8`. The Planning-left stash was applied,
not popped, and remains available. No hard reset or forced checkout was used.

The previously stashed four-file Planning-left change was inspected and applied
without dropping its stash. Desktop Planning / Potential is physically left;
Observed / Tier 3 is right and exclusively owns Q(t). Mobile retains explicit
Planning/Observed tabs. Shared selection, map synchronization, tier switching,
splitters and hide/show behavior remain intact. Visible wording is simplified;
analytical values and formulas are not modified.

Initial layout QA: 116 checks across 1920x1080, 1440x900, 1366x768, 1024x768,
768x900 and 390x844. The final live Gemma browser run passed 487 checks across
the same six viewports, including map/section synchronization, Q(t), tier switches,
splitters, hide/show, V2 coexistence, full-ranking pagination, cancellation and
stale-response protection. Zero console errors, uncaught exceptions, automatic
Assistant requests or direct browser port-11434 requests. The 13 intentional
Assistant requests include 11 workflows plus cancellation/stale checks.
Frontend JavaScript suites: 122 checks; 12 local resources.

Live browser workflows: investment decline, framework education, Potential,
technical follow-up, selected-road comparison and its why paraphrase, county
benchmarking, county ranking, section ranking, alignment, and Dallas summary.
All used their expected deterministic tools/control. Alignment retained
`classification_status=method_definition_required`, 3,473 valid pairs and the
accepted correlation. Browser workflow median 11.721s, p95 15.081s (11 cases).

Screenshots were inspected at desktop and mobile sizes. Local artifacts are in
workspace `.local/phase4eb-live-browser/phase4a-browser-20260918T153346Z-4f6a4c13`.

## Model and launch

See [development launcher instructions](../../local-demo/README-V3-DEV.md).
The development profile selects `gemma4:12b` and reports partial GPU offload
honestly. Normal UI still says AI Assistant. It does not change the accepted
Qwen launcher or its original tag/checkpoint requirements.

Real launcher startup on 2026-09-18: NVIDIA RTX 4060 Laptop, device Code 0,
driver 616.56; Gemma prewarm 19.486s, backend 5.207s, frontend 1.491s,
total 37.654s. Browser open was requested after readiness and live browser QA
passed. Existing loopback Ollama was reused (not owned); Gemma was loaded by
this development session. Repeated start failed safely on occupied ports,
leaving the active session untouched. Status correctly reported active ownership.

Model: `gemma4:12b`, digest
`4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c`,
Q4_K_M, 11.9B, context 4096, 7,556,508,396 disk bytes. Measured split
31% CPU / 69% GPU; model GPU residency 5,842 MiB, startup device VRAM usage
6,867 MiB (later sample 7,098 MiB). Runner working set sampled at 4,570 MiB;
this is process RAM usage, not a claim about dedicated model-only CPU memory.
No full-GPU claim on this laptop. Both Gemma and Qwen remain installed.

Launcher tests: development 45/45, accepted V2 92/92, accepted V3 134/134.
Old V3 wrappers and `LocalDemo.V3.ps1` are unchanged; shared lifecycle changes
only add the explicit development profile and model-aware operator messages.

Backend-only changes clarify model instructions, narrow offered decline reasons
to the existing host-valid set, and keep raw history out of Gemma routing while
retaining host-resolved follow-up context. All numerical evidence and warnings
remain deterministic. No new tools, permissive parser, retries or validator
relaxation. The backend's `docs/PHASE4EB_GEMMA_INTEGRATION.md` records diagnosis
and eventual A30 configuration considerations.

Acceptance requires full real-model results, at least 90% compatibility, exact
evidence/safety, and live six-viewport browser/launcher lifecycle validation.
Do not infer acceptance from the existence of this development branch.

**Local acceptance completed on 2026-09-18.** The gates below passed. New local
annotated tags in both repositories identify this integrated release:
`phase4eb-v3-gemma-planning-left-accepted`. Old accepted tags remain unchanged.
This is local acceptance only, not public/server rollout approval.

Final backend test run: 1,475 passed, with one existing Starlette/httpx
deprecation warning. Ruff format/check and `pip check` passed; source-backed
real-release validation passed. Frontend JavaScript: 122 passed; resources: 12.
Both repositories passed `git diff --check`. Backend worktree is clean;
frontend retains only the previously accepted untracked `debug.log` after this
documentation commit. Planning-left stash remains preserved.

## Final real-model evaluation

The final code was evaluated once through all unchanged accepted suites, without
automatic retries. Earlier diagnostic and intermediate reports were retained,
not overwritten. Final reports: backend `.local/phase4eb-final-evaluation`.

| Suite | Passed |
| --- | --- |
| Compatibility | 28/28 (100%, above 90% requirement) |
| Network/tool workflows | 15/15 |
| Analytical depth | 13/13 |
| Language/framework/county | 26/26 |
| Continuous conversation | 11/11 |
| Total standard workflows | 93/93 |

All suite gates passed, including exact deterministic evidence/warnings,
current identifier constraints and unsupported-request declines. Final standard
suite invalid_model_response count: 0. Remaining standard-suite failures: none.
All-workflow median: 12.255s; nearest-rank p95: 16.246s; maximum: 16.718s.
Compatibility project-tool median: 14.371s, passing the unchanged 15s gate.
These are measured laptop latencies, not an A30 performance claim.

Final supplemental paraphrase/context/security run: 14/14, no retries, exact
evidence/warnings and current-selection grounding. Covered changed selection,
historical identifiers, missing section/metric, investment, prediction, SQL,
file, shell and system-prompt requests. Supplemental median 5.339s, p95 15.116s.
Combined final real-model case count: 107/107.

## Shutdown and next deployment boundary

The development stop script successfully unloaded its own Gemma residency and
stopped only its frontend/backend processes and verified supervisors. Ports
8001 and 8080 were released. Pre-existing Ollama PID 22056 remained on
127.0.0.1:11434; neither model was removed. Runtime active-session state was
removed by the reviewed lifecycle. No push, merge, deployment or image build.

The main accepted V3 entry point should remain the Qwen rollback path for now;
use the clearly separated Gemma integration launcher for this local release.
Any main-entry promotion should be explicit, not an incidental hash update.
Before K3s replacement, obtain separate rollout authorization, prepare new
private-build image and Gemma-specific readiness/bootstrap configuration,
verify exact model/image digests, and measure full-GPU fit, warm-up and the same
contract suites on A30. Hardware capacity does not establish model reliability.

## Preserved rollback and deployment

- Frontend Qwen tag: `phase4c1-v3-plain-language-ai-accepted`
  (`345fe7a4d4f4bd4299c027d0c2cd7e1254b2819b`).
- Backend Qwen tag: `phase4c1-plain-language-ai-accepted`
  (`e6b0ad5600e1d0056cd927ba9034bda6243b6030`).
- Both installed models are retained. No old tags moved.
- V1/V2 runtime, research data, Q(t), Candidate B and deterministic statistics
  are outside this change. Public Pages and Jinyu's shipped ZIP/images are not
  updated. No INRIX/User Cost implementation.
- Screenshots of the comparative workspace need refresh because panel order and
  a few descriptive labels changed. QA screenshots remain local artifacts, not
  runtime assets or a poster/video deliverable.

Integrity audit: the six backend snapshot/metadata SHA-256 values match the
private build manifest; source-backed real-release validation passed. Delivered
Jinyu ZIP SHA-256 remains
`39d1d7692b09d86dfb23b33684527abc6c679090f63b8d25be73ae757e68c4ec`.
No analytical source module changed except Assistant instruction assembly and
model configuration; all research calculations and data files remain untouched.

## Changed-file scope

Frontend application: `index.html`, `css/style.css`, `js/workspace.js`, three
descriptive strings in `js/app.js`, and corresponding geometry/legend assertions
in `tests/run_phase4b_browser_qa.py`. No Assistant client logic changed.

Launcher: `.gitignore` adds the development state directory; shared
`LocalDemo.Core.psm1`, `LocalDemo.Windows.psm1`, start/stop lifecycle scripts and
`supervise_service.py` add an explicit profile. New files are the three
`*-v3-dev.ps1` entry points, `lib/LocalDemo.V3Dev.ps1`,
`supervise_service_v3_dev.py`, `v3-dev-checkpoints.psd1`,
`tests/run-local-demo-v3-dev-tests.ps1`, and `README-V3-DEV.md`, plus this record.

Backend: `config.py`, instruction assembly in `assistant.py`, new
`gemma_instructions.py`; four default/profile/provider test files and the
frozen Qwen response-contract fixture; new `test_gemma_integration_contracts.py`,
sanitized opt-in `run_gemma_diagnosis.py`, and `PHASE4EB_GEMMA_INTEGRATION.md`.
No provider transport, validators, native registry, analytical tool or contract
implementation changed.
