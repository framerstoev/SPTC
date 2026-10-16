# V4 local design acceptance — 2026-10-16

Decision: **V4 FRONTEND READY FOR DESIGN REVIEW**.
This is acceptance of the isolated interface and local evidence fidelity. Public
analytical redistribution and production deployment remain outside this result.

## 1. Reference Website Design Audit

[TIDE Mapper](https://tidal-tipping.com/) was inspected with real Chrome at
desktop and mobile sizes. Its actual navigation, layer panel, selected-location
charts, methods and mobile navigation informed the
[component audit](REFERENCE_DESIGN_AUDIT.md). No reference code or visual assets
were copied.

## 2. Adopted Component Patterns

Map-dominant navigation, contextual evidence, grouped layers, unit-aware legends,
progressive disclosure, and mobile bottom navigation. V4 uses original roadway
branding, ivory/teal/ochre styling and three labeled workspaces. Forecasting and
wetland-specific features were not adopted.

## 3. V3 Reuse Assessment

Reuse is limited to existing geometry/IDs, accepted fields, derived curve JSON,
classification behavior, shared selection and the latest-request map-reset
pattern. V3 API/event/Assistant startup dependencies are replaced by a static
loader. See [the module mapping](ARCHITECTURE.md). V3 files were not edited.

## 4. V4 Information Architecture

Explore is the default. Compare keeps Planning on the left and Observed on the
right. Methods & Data holds definitions, coverage, windows and limitations.

## 5. Files Created / Modified

Only `coldwave-demo-v4/` is added: HTML shell, CSS, seven modular JavaScript
files, empty public metadata, two export/build tools, three QA files, README,
three documentation files and pinned MIT UI libraries/licenses/images. Ignored
local preview/build folders are not part of the commit.

## 6. Explore Workspace

Canvas renders all 10,029 accepted control sections with county/event/hazard
controls, grouped layers, search, selection, reset extent and contextual legend.
Only the supported January cold-wave event is available; other hazards are
disabled placeholders. No historical results are fabricated.

## 7. Compare Workspace

Side-by-side Canvas maps synchronize viewport and selection. Planning/Potential
and Observed remain separate; no combined score is calculated. Geometry is
fetched once and reused. Rapid county-to-Texas changes cancel stale map movement.

## 8. Section Inspector

Weather, Planning, Observed and Impact tabs share one selected ID across map
clicks, search and both comparison maps. Curves load lazily with stale-response
protection. Missing evidence remains unavailable. No-sustained-drop and censored
recovery retain distinct wording and scoring eligibility.

## 9. Temperature Research Layers

Local preview includes minimum buffer-mean daily Tmin, Tmin-below-zero days and
Tmax-below-zero days. January 22–27 legacy labels and January 22–28 overlap labels
are separate choices. PRISM's 12:00 UTC day ending and TMC delivered-local-clock
distinction are documented. These experimental air-temperature attributes do not
modify WEATHER_REI or imply pavement temperature, freezing hours or icing.

## 10. Mobility Impact Presentation

The default compact area summary has delay cost and vehicle delay hours. Area
details expose the accepted passenger/commercial/support fields. Sections expose
only their two existing impact fields. Expected-demand valuation is explicitly
distinct from total economic loss. Review status remains visible.

## 11. No-AI Architecture

No Assistant import/button, model client, readiness request, Ollama/Gemma startup
or backend is required. Relative static JSON, vendored Leaflet/Chart.js and
OpenStreetMap tiles support the application. Browser traffic confirmed zero
backend/model requests.

## 12. Static Data / Publication Boundary

LOCAL_RESEARCH_PREVIEW requires an explicit query, loopback origin and reviewed
local metadata. Its Git-ignored package retains REVIEW_READY / NOT_APPROVED.
The public builder allowlists 21 runtime files, zero analytical files, and forces
PUBLIC_SHOWCASE. A local-preview query cannot activate research fetches in that
build. No approved V4 public metrics or geometry are assumed. Public data remains
unavailable pending approval. Serve research previews only on loopback.

## 13. Responsive and Browser QA

Final real Chrome run: 59 checks passed at desktop 1440×1000, tablet 1024×820 and
mobile 390×844; zero runtime exceptions, console errors, failed requests or HTTP
errors. Checks cover event/area selection, layers, inspector tabs, real Canvas
click, search, shared comparison selection, synchronized pan, ten rapid resets,
temperature window, supported/missing/censored evidence, clearing, responsive
bounds, cached geometry and public-mode isolation.

Core checks: 10 passed. Independent source comparison: 10,029 exact geometry
joins, 160,464 exact numeric field comparisons, 3,842 unchanged curve copies and
223 accepted county impact summaries. All 4,177 protected-file hashes matched
the pre-work snapshot. Public-bundle inspection found zero research data files.

Fourteen private screenshots plus machine-readable evidence are retained under
`.local/v4-audit/browser/050ec956d8ba4d0da9b3aa15a9b22a5b/` in the authorized project.
Representative files: `desktop-explore.png`, `desktop-compare.png`,
`desktop-section-observed.png`, `desktop-methods.png`, `tablet-inspector.png`,
`mobile-inspector.png` and `public-showcase.png`. They are deliberately excluded
from Git because local-preview screenshots display review-only analytical data.

## 14. Git Status and Commit

The new feature branch is `feature/v4-tide-inspired-static-explorer` in an
isolated worktree. It starts from the already-published Phase 4E-B frontend
commit `7a63e305143cac9a5947825ebb66b253027872cc`, allowing a V4-only diff without
publishing unrelated local V3 commits. V4 does not depend on that historical
parent's application code. Original frontend HEAD remains `46ce800`; its prior
eight dirty V3 files and untracked debug log are preserved. Backend remains
`d287fb6`. The final response records the resulting V4 commit and remote check.

## 15. GitHub Push Result

Authorized scope is the V4 feature branch only, code-only after staged safety
review. No default/production branch, tag, Pages setting or deployment workflow
is changed. Push success and exact remote commit are verified and reported in
the accompanying completion response.

## 16. Local Startup Instructions

From the project root: `python -m http.server 8004 --bind 127.0.0.1 --directory data/front-end`.
Open `/sptc-demo/coldwave-demo-v4/?mode=LOCAL_RESEARCH_PREVIEW` on that server.
See [README](../README.md) for initial local packaging, public build and QA.

## 17. Known Limitations

Only January 2026 is packaged. There are 254 county filters but accepted impact
summaries for 223 counties; remaining summaries are unavailable. Mobile comparison
is compact, and inspector content scrolls. Daily temperature is exploratory.
Basemap tiles require network access. Public data deployment awaits rights and
publication approval; the public showcase intentionally has no analytical values.
Keyboard controls and viewport bounds were checked, but no full screen-reader
audit, physical touch-device test or cross-browser certification is claimed.

## 18. V4 Decision

**V4 FRONTEND READY FOR DESIGN REVIEW**. Accepted formulas, Q(t), Candidate B,
economic calculations, January run artifacts, backend and existing V3 application
remain unchanged. No production deployment or default-branch merge was performed.
