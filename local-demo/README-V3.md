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

- Frontend: `e8d5cf801fb6f7fdeae0bc4a60406f76ba217b7d`
- Immutable frontend tag: `phase4a-v3-tier-aware-explorer-accepted`
- Backend runtime with reviewed response-contract fix:
  `e289aeb9ecf92d8d3d2f937dbc2d693342a35bee`
- Immutable Phase 4A backend baseline:
  `b550f11ca75b8c4921667a264ae7a3ca78710ea9`
- Immutable backend baseline tag: `phase4a-v3-network-assistant-accepted`

Adding the launcher necessarily advances frontend HEAD. V3 therefore verifies
the exact accepted application checkpoint/tag, requires its ancestry, and compares
the **entire repository** against that checkpoint with renames disabled. The only
permitted committed differences are the exact launcher, launcher-test,
launcher-documentation and ignore-file paths returned by
`Get-V3DemoAllowedChanges` in `lib/LocalDemo.V3.ps1`. No application path is
allowlisted. This is application-content equivalence, not a claim that the new
launcher commit has the same Git hash as Phase 4A.

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

Real acceptance uses the accepted production-page browser harness
`coldwave-demo-v3/tests/run_phase4a_browser_qa.py --scenario live` with an isolated
temporary Chrome profile and an artifact directory outside the repository. It
checks tier synchronization, concept/ranking/Dallas/alignment/refusal workflows,
deterministic evidence/warnings, cancellation, V2 coexistence, viewports, map/
curve operation, zero automatic Assistant requests and zero browser traffic to
Ollama. Alignment's unresolved classification remains
`method_definition_required`; rankings are not investment recommendations.

No push, merge, deployment, remote-server work or research recalculation belongs
to this launcher workflow.
