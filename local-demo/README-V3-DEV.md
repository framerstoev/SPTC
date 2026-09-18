# Experimental Gemma V3 integration launcher

This separate profile is for `feature/v3-gemma-planning-left-integration` in both
repositories. It does not replace the accepted Phase 4C1 Qwen launcher or modify
the published Pages site, K3s images, or delivered deployment archive.

From this repository:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\local-demo\start-local-chatbot-demo-v3-dev.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\local-demo\status-local-chatbot-demo-v3-dev.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\local-demo\stop-local-chatbot-demo-v3-dev.ps1
```

Browser: http://127.0.0.1:8001/coldwave-demo-v3/?assistantMode=backend-agent

The visible UI says **AI Assistant**, not the provider/model name. The operator
console and `ollama ps` identify `gemma4:12b`. Both models may remain installed.
The old `start-local-chatbot-demo-v3.ps1` still requires accepted Qwen checkpoints
and cannot be used to bypass this profile's integration checks.

## Identity and ownership

`v3-dev-checkpoints.psd1` pins the reviewed application commit, exact backend
commit, integration branch, model and digest. Frontend descendants may differ
only in the explicitly listed launcher/test/documentation files; application
changes, wrong branches and dirty worktrees fail closed (existing untracked
`debug.log` alone is allowed). Original rollback tags must still match.

State lives in `.runtime-v3-dev`, never the V2/V3 state namespace. The existing
shared lifecycle retains loopback binding, Windows Job Objects, executable/path/
start-time identity checks, child ownership, safe stale-state handling and port
conflict rejection. PID alone is never permission to terminate a process.
Stop preserves pre-existing Ollama and pre-existing model residency. It unloads
Gemma only if this session loaded it and the recorded Ollama identity still
matches. Both model installations remain intact.

## Laptop GPU profile

NVIDIA device health and `nvidia-smi` are mandatory. This explicit development
profile supports the measured partial offload on the 8GB RTX 4060, reports the
actual split, requires exact model digest/context=4096, and rejects CPU-only or
less than 50% GPU residency. This is not a full-GPU claim. Accepted Qwen profile
requirements remain 100% GPU. No driver repair, model substitution or auto-pull.

Warm-up has a bounded 180-second process budget; backend inference remains at
its unchanged timeout/token limits. No automatic inference retries. Close an
existing demo with its own stop script before starting another profile on the
shared 8001/8080 ports.

Run `local-demo/tests/run-local-demo-v3-dev-tests.ps1` plus both original V2/V3
launcher suites after shared lifecycle changes. This remains experimental until
the full real-model and live-browser gates are recorded as passing.
