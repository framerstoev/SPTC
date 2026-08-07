# Jason local Qwen demonstration

This launcher runs the accepted Phase 3F/3G demonstration entirely on the local Windows
workstation. It does not install software, pull a model, change a driver or service, modify the
firewall, use a cloud API or API key, or deploy anything.

## Local-only path

The browser loads the production v2 page from `127.0.0.1:8001` and calls only the accepted
FastAPI service on `127.0.0.1:8080`. FastAPI calls the fixed local Ollama endpoint on
`127.0.0.1:11434` server-side. The launcher rejects non-loopback listeners and never connects the
browser directly to Ollama.

The pinned checkpoints are:

- Phase 3F backend: `5edc4688514f2c47ae3e8c03f50b853c0f5d8108`
- Phase 3G frontend: `58f04a9c8d608fa9622bf8a0133d446118970543`
- Phase 3G tag: `phase3g-local-qwen-chatbot-accepted`

The frontend launcher branch may contain later launcher-only commits, but the accepted Phase 3G
commit must remain its ancestor and the accepted tag must still target that exact commit. The
backend must remain at the exact accepted Phase 3F commit. Both worktrees must be clean.

## Before starting

Connect the laptop to power and make sure the discrete NVIDIA RTX 4060 is enabled. The launcher
requires Windows PowerShell 5.1, a healthy RTX 4060 with ConfigManagerErrorCode 0, a successful
`nvidia-smi` check, the accepted backend virtual environment and snapshot, an installed Ollama
executable, and the already-installed `qwen3:8b` model.

The launcher fails closed instead of silently using the CPU. It does not download a missing model.
Ports 8001 and 8080 must be free. Port 11434 must be free or owned by a verified, loopback-only
Ollama process.

## Commands

Run these commands from the frontend repository root:

```powershell
Set-Location E:\Projects\PhD\SPTC\data\front-end\sptc-demo
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\local-demo\start-local-chatbot-demo.ps1
```

The browser opens only after GPU checks, explicit model warm-up, GPU-allocation verification,
backend health, and frontend page readiness all pass. The production page is:

```text
http://127.0.0.1:8001/coldwave-demo-v2/?assistantMode=backend-agent
```

Check status without starting or stopping anything:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\local-demo\status-local-chatbot-demo.ps1
```

Stop the demo:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\local-demo\stop-local-chatbot-demo.ps1
```

The stop command is safe to repeat. It stops only processes whose PID, executable path, start
time, ownership link, and launcher state match. A pre-existing Ollama service is never stopped.
If this launch made the model resident, stop attempts to unload it while leaving `qwen3:8b`
installed; pre-existing model residency is left unchanged.

## Warm-up and response time

Warm-up runs the accepted `python -m resilience_agent.assistant_warmup` command before any browser
question is allowed. It has a bounded timeout, must return `READY`, and must leave `qwen3:8b`
reported by `ollama ps` as `100% GPU`. The ready summary records warm-up and total startup time plus
the read-only `nvidia-smi` VRAM observation.

On this laptop, the accepted Phase 3G run observed roughly 52 seconds for a cold explicit warm-up
and about 8.2 seconds median for successful pre-warmed grounded workflows. These are operational
observations, not a response-time guarantee; prompt type and current GPU load can change latency.

The three fixed actions—selected-section evidence, current-metric explanation, and deterministic
review note—remain the authoritative deterministic fallback. They do not depend on model prose and
remain available when the model response is rejected or unavailable.

## State, logs, and rollback

Operational state is kept in `local-demo/.runtime/active-session.json`. Per-session logs are under
`local-demo/.runtime/logs/<session-guid>/`. The runtime directory is ignored by Git. State contains
only process and startup metadata; it does not record chat text, prompts, raw evidence, API
responses, or raw NPMRDS data. Service logs are bounded while running, trimmed again at shutdown,
and only the latest five valid launcher session directories are retained.

If startup fails after creating a process, the launcher rolls back in dependency order, using
graceful termination first and a bounded, identity-revalidated force stop only when necessary.
Logs are retained. If any verified launcher-owned process cannot be cleared, state is retained for
a safe stop retry instead of authorizing a broad process kill.

This workflow is intended for a trusted single-user workstation. The runtime directory inherits the
workspace's Windows permissions; other authenticated local accounts with write access to this
workspace are outside the launcher threat model. Do not use this launcher from a shared writable
checkout. Malformed state, reparse-point paths, PID reuse, executable mismatch, or unverifiable
process ownership fail closed.

## Troubleshooting

- **Missing `qwen3:8b`:** install or restore the reviewed model separately, then rerun. The launcher
  deliberately does not call `ollama pull`.
- **Ollama started before the GPU was available:** enable the RTX 4060 first, then manually restart
  that user-owned Ollama instance and rerun. The launcher does not kill or restart a pre-existing
  Ollama process.
- **GPU Code 43 or `nvidia-smi` failure:** connect power, enable the discrete GPU, and resolve the
  driver/device condition outside this workflow. There is no silent CPU fallback.
- **Port occupied:** inspect the reported PID and stop or reconfigure that unrelated application
  yourself. The launcher will not kill it.
- **Partial prior session:** run the stop command, inspect the retained session logs if cleanup still
  cannot complete, and retry only after status is clear.

## Data and licensing boundary

The backend reads only its reviewed local snapshot through the accepted read-only contracts. The
launcher does not expose raw NPMRDS inputs, model files, filesystem paths, restricted source fields,
or new public endpoints. NPMRDS-derived sources and generated snapshots remain local pending
licensing and public-serving review. This is a local demonstration workflow, not a hosting,
deployment, causal-analysis, prediction, treatment, investment, or priority claim.
