# Phase 4C: analytical Assistant and deterministic ranking browser

Base: `88d040740c424543d0144daec75d767e913ededf` (accepted Phase 4B).
V1/V2 files, the dual-map workspace, splitters, tier panels, Q(t), data and
quantile coloring remain unchanged.

## Reading and resizing

Desktop default: 700px by 78vh, bottom-right anchored. Drag the visible top-left
handle or focus **Resize AI Assistant** and use arrow keys (20px; Shift = 40px).
Minimum 480×420; maximum 92vw×90vh, constrained to the viewport. Answers use
18px text at 1.5 line height. Scroll the conversation instead of shrinking text.
At widths at or below 900px, manual resizing is disabled and the responsive panel
remains bounded. Keyboard/pointer browser tests are not a full assistive-technology audit.

## Ranking scope and full access

An Assistant ranking is a bounded sample, not the full statewide list: normally
the highest ten and lowest ten, with eligible N, direction and metric meaning.
For this release, Tier 3 has 3,473 eligible scores, not the 3,842 curve-supported
sections. Missing scores are excluded rather than treated as zero.

**View full ranking** opens an independent modal. First/previous/next/last
controls request 25 rows from `/api/v1/sections/rank/page`, preserving the returned
metric, direction and county. Dense ranks share ties; numeric CS ordering breaks
display ties. Close returns focus to the initiating button. Pending page results
are cancelled/ignored on close. Errors show sanitized text only.
Opening, paging and closing do not invoke Qwen or add chat-history messages.
CSV export is not included.

## Analytical questions

**Compare selected section** is disabled until a section is selected. It sends
the current host-owned selection; history cannot substitute an earlier section.
`compare_section_resilience` supplies values, percentile/dense-rank positions,
eligible statewide medians, common valid-pair medians, planning context and status.
Percentiles compare relative positions, never classify a section as consistent or
mismatched. Explicit statewide correlation continues to use the alignment tool.

County answers show metric quartiles, statewide median comparisons, relative
positions, bounded high/low examples and status counts. Numerical display is a
projection of validated backend fields, not JavaScript analytical calculations.
The model supplies interpretation; all structured warnings/limitations/provenance
remain in the API, while normal prose avoids repeated boilerplate. Contextual
“why” explanations cannot establish causes. Investment advice remains unsupported.

## Local operation and QA

Use the existing V3 launcher, never the V2 launcher for this checkpoint:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\local-demo\start-local-chatbot-demo-v3.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\local-demo\status-local-chatbot-demo-v3.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\local-demo\stop-local-chatbot-demo-v3.ps1
```

URL: `http://127.0.0.1:8001/coldwave-demo-v3/?assistantMode=backend-agent`.
The V3 private reviewed checkpoint pin must be updated after application commits;
the V2 launcher and its checkpoint/URL stay unchanged.

`tests/run_v3_frontend_qa.py --live` covers strict API projection, chat, actions,
search, tier behavior, ranking/resize controllers and local resources.
`tests/run_phase4c_browser_qa.py` reuses the accepted isolated Chrome lifecycle,
preserves Phase 4B layout checks and adds real resizing/full-ranking workflows at
1920×1080, 1440×900, 1366×768, 1024×768, 768×900 and 390×844.
Model latency, deterministic pagination latency and pointer resize round-trip
are reported separately. No browser requests may go to port 11434. Page load,
map/selection/tier changes, workspace/chat resizing and ranking navigation must
generate zero automatic Assistant requests.

Full acceptance requires live model and launcher start/stop QA; the dated local
acceptance record is kept in `local-demo/README-V3.md` alongside the runtime pins.
