# Roadway Resilience Explorer V3

Phase 4B is a frontend-only comparative workspace. V1/V2, analytical assets,
Candidate B, Q(t), quantile classes, and research calculations remain unchanged.

## Comparative workspace

Left: always Tier 3, one map, exactly four KPIs (Score, Minimum, Loss Area,
Recovery), and Q(t). Raw Q(t), the centered six-observation median, thresholds,
loss shading, and phase markers are preserved. Censored endpoints stay labeled.

Right: one map with Tier 1 / Tier 2 / Potential choices.

| Layer | Compact metrics | Direction |
| --- | --- | --- |
| Tier 1 | WEATHER_REI | Higher means stronger weather/pavement exposure concern. |
| Tier 2 | NETWORK_REI and AADT (vehicles/day) | Higher NETWORK_REI means stronger network-context concern. |
| Potential | Potential Resilience, Tier 1 Weather, Tier 2 Network | Higher Potential is more favorable; component directions remain distinct. |

Both maps reuse one loaded geometry/data object. One search and selected-section
identity update both highlights/panels. Pan/zoom synchronization is bidirectional,
frame-coalesced, and guarded against recursive movement. Legends are independent.
Right-layer changes do not reload Q(t) or change the left metric.

The central separator defaults to 50/50, bounded at 35/65. Horizontal separators
default to 43% map height, bounded at 25/65. Drag, arrow keys (two percentage
points), Home, and End are supported. Resizing invalidates both maps and resizes
Q(t). Observed/Planning buttons hide either side, restore the divider ratio, and
prevent an empty workspace. At widths up to 900px they become single-workspace
tabs with desktop splitters disabled. Layout state is not persisted.

At 1440x900 the default layout fits four observed KPIs and the complete Q(t)
without observed-panel scrolling. Smaller screens may scroll internally.
The floating Assistant does not reflow the workspace; its collapsed button sits
outside maps/charts. Long answers scroll within the expanded panel.

## Simplified Assistant

The panel has a header, three demo prompts, collapsed deterministic Quick actions,
conversation, and anchored composer/Send/Cancel. Normal messages contain only the
question and plain answer. Separate warning, tool, evidence, limitation,
release/method, raw JSON, and provenance panels are removed. Exceptional service
errors remain visible.

This is presentation only: closed client validation and backend structured
evidence, warnings, provenance, method/release metadata, and tool permissions
remain unchanged. Essential caveats remain in answer prose. Quick actions use
existing deterministic endpoints, never the model. Review-note prose omits the
developer metadata section but retains warnings/interpretation limitations.
Response insertion uses textContent; untrusted HTML/Markdown is never executed.

Network answers include a plain text projection of validated structured results:
actual ranking positions/values, county denominators, and alignment correlations.
The browser does not calculate rankings, correlations, statistics, or classifications.
Numerical output comes from deterministic backend results. Internal names/codes
map to display labels. Model history excludes the additional network projection.

The browser sends assistant_profile="v3", the shared selected section, and the
right-side planning context through existing fields. Left remains Tier 3.
UI-owned context cannot be overwritten by history. Page load, map movement,
selection, tier switches, splitters, visibility, and opening the Assistant cause
zero Assistant requests. Only explicit questions/Quick actions initiate work.
Cancellation/stale-response guards remain. Browser calls FastAPI, never Ollama.

### Existing inventory (no new tools)

| Tool | Supported example |
| --- | --- |
| rank_sections | Rank control sections by Tier 3 observed resilience. |
| summarize_tier_alignment | How consistent are Potential Resilience and Tier 3 Observed Resilience? |
| summarize_county_resilience | How did roadway sections in Dallas County perform during this event? |
| explain_project_concept | What is Potential Resilience? |
| get_section_summary | Explain this control section. |
| explain_metric | Explain the current planning layer. |
| compare_sections | Compare two explicitly identified control sections. |
| generate_review_note | Generate a review note for the selected section. |

Controls remain request_clarification, answer_scope_explanation, and
decline_unsupported_request. Investment advice, predictions, causal claims,
SQL/files/shell, arbitrary identifiers, and prompt disclosure remain unsupported.

### Interpretation boundaries

Alignment has 3,473 valid paired values: Pearson 0.277170, Spearman 0.281802.
The API's distinct common_support_count is 3,842 curve-supported sections;
valid_pair_count is 3,473. These denominators are not interchangeable.
No reviewed classification rule exists: classification_status remains
method_definition_required and consistency/mismatch counts remain unavailable.
The UI explains this in plain prose, without internal codes or invented thresholds.

Dallas has 58 sections, 56 with observed support and two without. Missing support
is not zero resilience or proof of no disruption. No sustained drop is not proof
of no impact; censored endpoints do not confirm recovery completion.
Planning and observed evidence are different constructs, not causal/investment outputs.

Backend remains e289aeb9ecf92d8d3d2f937dbc2d693342a35bee, tagged
phase4a1b-response-contract-fix-accepted. Historical accepted evaluations:
V3 15/15, focused contract 14/14, legacy V2 26/28. Existing safe V2 missing_metric
and history_id_injection routing/clarification deviations remain deferred;
Phase 4B does not modify backend routing or attempt to fix them.

## Local operation

From E:\Projects\PhD\SPTC\data\front-end\sptc-demo:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\local-demo\start-local-chatbot-demo-v3.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\local-demo\status-local-chatbot-demo-v3.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\local-demo\stop-local-chatbot-demo-v3.ps1
```

V3: http://127.0.0.1:8001/coldwave-demo-v3/?assistantMode=backend-agent

V2: http://127.0.0.1:8001/coldwave-demo-v2/?assistantMode=backend-agent

The separate V2 launcher and its checkpoint/URL policy are unchanged. Do not run
competing sessions. See [launcher documentation](../local-demo/README-V3.md).
V3 lifecycle is preserved; its private checkpoint policy pins the reviewed Phase
4B application commit. Backend pin and immutable Phase 4A tags remain unchanged.

For frontend-only review, use Python http.server on loopback. Without assistantMode
the local-template fallback remains available; backend-tools uses deterministic
backend actions only. No deployment is authorized.

## QA

```powershell
D:\programming\Minicoda\python.exe -B .\coldwave-demo-v3\tests\run_v3_frontend_qa.py --live
```

Checks frozen V1/V2/data scope, analytical source parity, 72 DOM IDs, 3 planning
choices, 3 prompts, 3,849 data files/3,842 curves, 10,029 features, 96 JavaScript
tests, and 12 ephemeral-server resource requests. Does not start the model/backend.

run_phase4b_browser_qa.py uses the production page and established isolated Chrome
CDP lifecycle. Scenario ui covers six viewports (1920x1080, 1440x900, 1366x768,
1024x768, 768x900, 390x844), shared selection, synchronized maps, splitters,
visibility, no automatic requests, and V2 coexistence. Scenario live additionally
runs the six required real-Qwen workflows, fixed actions, cancellation/stale
responses, answer-only presentation, evidence/caveat consistency, and network/console
assertions. Use base Python with websocket-client and an isolated browser profile.
Operational logs must not persist questions, answers, or row-level evidence.
