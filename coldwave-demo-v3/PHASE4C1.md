# Phase 4C1: Planning vs Observed, explained plainly

Starting frontend: `c6be1e3d094ffc18607a1c73791c544e37245aef`, tag
`phase4c-v3-analytical-assistant-accepted`; branch `feature/v3-plain-language-ai`.

The three suggestions now introduce the framework, compare the selected road's
planning and observed performance, and compare Dallas with other Texas counties.
General project questions need no selection. The host still supplies the current
selected road; history never overrides it.

The answer comes first, followed by a few deterministically rendered facts.
Default statistical field names, dense ranks, percentiles, eligibility terms and
method-classification codes are moved to a closed technical disclosure. The full
validated result, warnings, limitations, method/release and tool provenance remain
auditable there; no HTML from responses is executed. Explicit concept calculations
preserve official metric names as text, including EVENT_REI and NETRISK_LITE.

Both selected-road positions use the same roads with both scores, currently 3,473.
"Higher than" counts only strictly lower values, not ties. Scores are not directly
subtracted; no new high/medium/low bands or mismatch thresholds were invented.
Existing statewide map classes are not appropriate for this paired comparison.

County ranks compare county medians with county medians, not county medians with
individual roads. Every displayed row includes metric N/total and coverage. There
is no minimum-N cutoff. The normal result shows a selected county or ten available
counties; "View all counties and technical details" expands the complete bounded
result (at most 254 counties) without any API or model call. Section ranking still
uses the accepted full-pagination controller without additional model calls.

See backend `docs/PHASE4C1_PLAIN_LANGUAGE.md` and the immutable
`project_language.py` registry for source-audited definitions, exact formulas,
county aggregation, tie conventions, direction metadata and limitations.

No changes are made to V1/V2 files, data, app/map/curve calculations, Phase 4B
workspace, splitters, synchronized maps or Phase 4C resize/ranking controllers.
The Assistant stays 700px wide by default with 18px answer text. Default loading
must make zero Assistant requests and the browser must never contact port 11434.

## Local QA

```powershell
D:\programming\Minicoda\python.exe coldwave-demo-v3/tests/run_v3_frontend_qa.py --live
powershell.exe -NoProfile -ExecutionPolicy Bypass -File local-demo/tests/run-local-demo-v3-tests.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File local-demo/tests/run-local-demo-tests.ps1
```

After the existing V3 launcher is ready:

```powershell
D:\programming\Minicoda\python.exe coldwave-demo-v3/tests/run_phase4c1_browser_qa.py --scenario live
```

The isolated-browser harness reuses accepted process lifecycle and tests real
framework/technical/road/why/county/section-ranking/alignment/safety workflows,
full ranking pagination, V2 coexistence, cancellation/stale responses, deterministic
actions and six viewports: 1920x1080, 1440x900, 1366x768, 1024x768, 768x900, 390x844.
Technical answers may contain statistical vocabulary; novice answers must not.

Only V3-private launcher checkpoint locks advance. The V2 launcher and Phase 4C
tags remain unchanged. A new acceptance tag requires the real browser and launcher
gates, not only mocked tests.

## Future work, not a current feature

Planning inputs could eventually feed a validated calibration model to estimate
expected Tier 3, compare with observed roads and estimate for unobserved roads.
No such model currently exists. This phase does not package or deploy to K3s,
train a model, generate predictions, or change research methodology.
