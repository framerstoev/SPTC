# Roadway Resilience Explorer V3

V3 is a separate, no-build frontend prototype for tier-aware roadway resilience review. It does
not replace or import V1 or V2 at runtime. The analytical files under `data/` are an independent
copy of the accepted V2 release; V3 changes presentation and bounded assistant integration only.

## Four analysis modes

One `activeAnalysisLayer` controls the map, legend, selected-section panel, and Assistant context:

| V3 mode | Display metric | Existing source field | Interpretation |
| --- | --- | --- | --- |
| Tier 1 — Weather | `WEATHER_REI` | `WEATHER_REI` | Higher indicates stronger event-specific weather/pavement exposure concern. |
| Tier 2 — Network | `NETWORK_REI` | internal `NETRISK_LITE` | Higher indicates stronger network consequence and constraint concern. |
| Tier 1+2 — Potential | Potential Resilience | `Potential_Resilience_Score` | Higher indicates more favorable combined planning context. |
| Tier 3 — Observed Resilience | Score | internal `observed_curve_resilience_score_v0` | Higher indicates more favorable observed performance for supported sections in this event. |

Tier 1 displays only the verified composite available in the current release. Tier 2 adds AADT as
an existing demand-context value. Potential Resilience displays the combined value and its Tier 1
and Tier 2 context. Tier 3 displays exactly four KPIs—Score, Minimum, Loss Area, and Recovery—and
automatically shows the existing Q(t) curve when a section is selected. No new analytical value is
computed by the frontend.

Missing observed support is not zero resilience. `no_sustained_drop` is not evidence of no impact,
and censored recovery remains explicitly qualified.

## Run locally

From the nested frontend repository root:

```powershell
Set-Location E:\Projects\PhD\SPTC\data\front-end\sptc-demo
D:\programming\Minicoda\python.exe -m http.server 8001 --bind 127.0.0.1
```

Open one of these URLs:

- deterministic fallback: `http://127.0.0.1:8001/coldwave-demo-v3/`
- deterministic backend tools: `http://127.0.0.1:8001/coldwave-demo-v3/?assistantMode=backend-tools`
- local model-backed assistant: `http://127.0.0.1:8001/coldwave-demo-v3/?assistantMode=backend-agent`

The accepted `local-demo` launcher is still pinned to V2 and must not be treated as a V3 launcher.
Changing that launcher is outside Phase 4A.

## Assistant boundary

`js/deployment-config.js` is the only deployment-owned backend target selection. Its committed
value is `local-loopback`. In local backend modes, the browser calls only FastAPI at
`http://127.0.0.1:8080`; it never calls the model service directly. The client sends
`assistant_profile: "v3"` and the current `active_analysis_layer` with the corresponding reviewed
internal active metric.

The larger chat-first panel has three global demo questions and a collapsed deterministic quick-
action group. Opening the panel, selecting a section, changing a tier, or changing the viewport
sends no Assistant request. Quick actions retain their deterministic endpoints.

Ranking, county, and tier-alignment results are validated against closed client schemas and
rendered as DOM-built cards and tables. Rankings show direction, actual metric rank, and Tier 3
observed-support status. County cards show all four detection-status counts, while alignment cards
show common support and explicitly identify unresolved classification fields. Internal provenance
identifiers are not displayed. The
top-level `warnings[]` array remains the sole warning contract; result rows carry only analysis
status and observed-support state. All response values are inserted with `textContent`.

## Focused QA

Run the complete no-build V3 suite:

```powershell
D:\programming\Minicoda\python.exe .\coldwave-demo-v3\tests\run_v3_frontend_qa.py --live
```

The runner checks repository scope, DOM/tier contracts, production script order, V3 deployment
constraints, copied-data parity, representative analytical states, local resources, and the
client/action/chat, safe-search-rendering, and production tier-runtime JavaScript suites. `--live`
starts and stops only a temporary ephemeral-port HTTP server for resource checks; it does not start
FastAPI, Ollama, or the accepted demo launcher.

Browser acceptance should additionally cover desktop and mobile tier switching, map selection,
lazy Q(t), all four warning/status cases, all three global questions, deterministic quick actions,
safe structured rendering, cancellation, stale-response suppression, and zero console errors.

See [deployment readiness](docs/DEPLOYMENT_READINESS.md) before any nonlocal hosting work.
