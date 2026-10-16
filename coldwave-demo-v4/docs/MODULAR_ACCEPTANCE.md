# V4 modular UX acceptance — 2026-10-16

## 1. Executive Result

**V4 MODULAR UX READY FOR DESIGN REVIEW**. The working static V4 baseline
f9edd464ee30c5192ef1d17a8282999c393ee1c4 was refactored into a map-first modular
explorer. No analytical method, research dataset, accepted output, V3 file or
backend file was changed. Forecast remains planned research.

## 2. Current V4 Architecture Audit

Unchanged: core.js numerical presentation helpers, data.js loader/validation,
charts.js accepted curve renderer, local exporter, UI libraries and research
preview bytes. Reorganized: filters, layers, search, impact and explanations.
Minimally refactored: maps.js resizing and inspector visibility. Replaced:
permanent filter sidebar and top Methods workspace. The component plan was
recorded before major UI edits in [MODULAR_ARCHITECTURE.md](MODULAR_ARCHITECTURE.md).

## 3. Reference UI Patterns Adopted

Real Chrome re-inspection of [TIDE Mapper](https://tidal-tipping.com/) confirmed
seven navigation modules, contextual panels, Guide, Docs, map controls and mobile
navigation. Its persistent rail, progressive disclosure and documentation
separation informed V4. Reference code, branding and assets were not copied.
V4 retains its original ivory/teal/ochre identity and original SVG symbols.

## 4. New Information Architecture

Compact header: Explore, Compare, Guide, Docs and mode/version. Seven-module
rail: Overview, Analysis, Layers, Time Series, Forecast, Data, About. Only one
contextual panel opens at a time. The central map persists. The inspector and
expanded charts/details remain contextual rather than permanent large blocks.

## 5. New Seven-Module Sidebar

Desktop uses a 68 px rail and 352 px panel; tablet uses a 310 px panel; mobile
uses a seven-item bottom rail and overlay sheet. Click the active icon or close
control to collapse. Filters, layer, selection, center and zoom are retained.
Resize is coalesced and does not refetch geometry or animate stale fits.

## 6. Overview Module

Area, hazard and event selectors define the supported January cold-wave context.
Registered impact dates are read from package metadata with the exclusive end
shown explicitly. Current layer, compact impact values and selected-section
summary update from shared state. Area details use the accepted county/event
summary; unsupported summaries remain unavailable.

## 7. Analysis Module

Three separate explanation/action cards expose Planning/Potential, Observed/Tier 3
and Mobility Economic Impact. Actions show real layers, open selected evidence,
open Time Series or switch to Compare. The actual Tier 2 field is NETRISK_LITE;
no unsupported NETWORK_REI field, new combined score or Tier 4 is introduced.

## 8. Layers Module

Weather, Planning, Observed, Mobility and Experimental Temperature groups contain
each Explore metric once. Active radio states, keyboard arrow navigation, units,
metric-specific legends and missing-value styling are retained. Compare keeps
its own independent Planning and Observed metric controls.

## 9. Time Series Module

The shared selected section drives the unchanged accepted curve renderer. Raw Q,
smoothed Q, baseline/reference lines, available Candidate B markers, minimum,
loss and recovery evidence remain intact. Expanded charts reuse cached payloads.
Unsupported curves, no sustained drop and censored endpoints retain distinct
wording. Generation checks discard stale display responses; no hourly values or
phases are synthesized.

## 10. Forecast Placeholder Module

The navigable Forecast panel has Temporal Forecasting and Spatial Prediction
cards, both marked “Planned — model not yet available.” Computation is disabled.
No prediction values, intervals, chart, layer, playback, backend request or model
exists. The minimal future product interface is documentation only and requires
provenance, model/version, explicit predicted labels, validation, uncertainty and
publication approval before any future runtime integration.

## 11. Data Module

Counts are derived from loaded rows and summaries: accepted sections, observed
support, counties, county impact summaries and section impact support. Local
event/run identifiers, actual method versions and registered windows are available
in expandable details. Sources, release vintage, reporting domain, quality and
review/publication status remain explicit. Public mode has unavailable data.

## 12. About Module

Explains the research motivation, four evidence families, January case study,
experimental temperature, future multi-event work and planned forecasts.
SPTC/TTI/TAMU attribution is retained without invented contacts. Economic cost
is not total loss; event association is not a causal disaster-loss estimate.

## 13. Explore Workspace

Default landing has a collapsed panel and large Canvas map. Floating search,
layer summary/action, zoom/reset controls, legend and compact two-value impact
summary remain accessible. All 10,029 accepted geometries are reused exactly.

## 14. Compare Workspace

Planning remains left and Observed remains right, with separate legends and
metric selectors. Viewport synchronization, shared map/search selection and
Q(t) access are preserved. First opening copies Explore's viewport; subsequent
workspace changes preserve each workspace's view. Ten rapid county-to-Texas
resets passed without stale bounds overriding the latest selection.

## 15. Section Inspector

Weather, Planning, Observed and Impact share one selected ID. Hiding the inspector
preserves selection and offers a reopen control; Clear selection removes it.
Observed links to Time Series. The inspector is hidden while that module is
active to avoid competing evidence panels. Desktop floats; mobile uses a sheet.

## 16. Guided Onboarding

Eight steps highlight actual components and explain current capabilities.
Next, Previous, Skip, Finish and keyboard Escape work. A native modal dialog
contains focus. Highlights respect scroll-panel bounds. Closing restores the
prior workspace, panel and inspector visibility. A dismissible invitation uses
optional browser storage; no forced full tour or external service is required.

## 17. Docs Experience

docs.html is a separate static user-facing page with fourteen chapters, left
navigation, internal anchors, active-chapter indication and local text search.
It explains accepted methods, units, sources, windows, coverage, publication
limits and the unimplemented forecast roadmap. Back-to-map preserves authorized
local mode; public Docs returns to public mode. Docs fetches no research package.

## 18. Mobility Economic Impact Presentation

The compact B+ area summary is retained; Overview and Analysis offer details on
demand. Only the existing six area/county breakdown metrics and support fields
are displayed. Sections still show only Vehicle Delay Hours and Expected-Demand
Mobility Delay Cost. Values are read unchanged, in 2024 USD where monetary, with
expected/profile-demand interpretation and REVIEW_READY / NOT_APPROVED status.

## 19. Temperature Research Layer Preservation

Three existing attributes and both January 22–27 legacy / January 22–28 overlap
label windows remain available only in authorized local preview. PRISM ends its
day at 12:00 UTC; TMC clocks retain their delivered local timestamps. Temperature
is experimental weather evidence, not pavement icing, freezing hours or a new
score. WEATHER_REI remains precipitation-based and unchanged.

## 20. Responsive Results

Real Chrome screenshots and checks cover desktop 1440×1000, tablet 1024×820 and
mobile 390×844. No horizontal page overflow; all seven module buttons have at
least 44 px height and stay inside the viewport. Context panels and inspectors
scroll within their bounds. Mobile side-by-side comparison is compact; closing
its sheet restores map space. Guide and Docs are usable at all tested sizes.

## 21. Browser QA

Final run: **126 checks passed**, zero runtime exceptions, console errors,
failed requests or HTTP errors. Includes all modules, collapse/state retention,
search/real Canvas click, legends/units, shared selection, comparison sync,
county reset race, accepted curve equality/cache, unsupported/censored evidence,
expanded charts, full Guide including mobile, Docs anchors/search/return and
public-build isolation. Ten core utility checks passed. Python syntax, HTML IDs
and static stylesheet/script paths also passed.

## 22. Data Fidelity and Publication Safety

Independent source verification passed: 10,029 exact geometry joins, 160,464
exact numeric field comparisons, 3,842 unchanged curve copies and 223 accepted
county impact summaries. All 4,177 original protected files and 3,873 V4 preview,
library and unchanged-module files matched their respective pre-work snapshots.
The snapshots overlap and are not additive unique-file counts.

Public build: **26 runtime files, zero analytical data files**, public_only=true.
The local-preview query cannot activate research loading. Public Docs and return
also fetch no research data. No raw probes, ledgers, unapproved monetary or
temperature products, private paths or credentials are included. Screenshots
with review-only values stay local. No deployment or Pages setting is changed.

## 23. Files Modified

New: navigation.js, timeseries.js, guide.js, docs.js, docs.html, css/docs.css,
MODULAR_ARCHITECTURE.md and this report. Updated: index.html, app.css, app.js,
maps.js, inspector.js, public builder, browser/fidelity QA, README, architecture
and reference audit. Removed: redundant methods.js; its user explanations are
reorganized into Data/About and Docs. All changes are inside coldwave-demo-v4/.

## 24. Git Commit and Push Status

Branch: feature/v4-modular-navigation-guide-forecast, based directly on f9edd46
in the existing isolated V4 worktree. The original V3 worktree and backend are
preserved. Intended V4-only changes are reviewed and committed after passing QA;
the accompanying completion response records the exact commit and remote check.
Only the feature branch is pushed. No default merge, accepted-tag movement or
production deployment is performed.

## 25. Local Startup Instructions

From the SPTC project root:

```powershell
python -m http.server 8004 --bind 127.0.0.1 --directory data/front-end
```

Open /sptc-demo/coldwave-demo-v4/?mode=LOCAL_RESEARCH_PREVIEW on that local
server. Docs is ./docs.html. Existing .local-preview remains valid; no analytical
regeneration or model launcher is needed. See [README](../README.md).

## 26. Known Limitations

Only January 2026 is currently packaged. County economics are not available for
every county. Temperature is exploratory; Forecast has no model. Public data
redistribution approval is pending. Basemap tiles require network access. Mobile
comparison is deliberately compact. Chrome device emulation, keyboard controls
and viewport bounds were tested; no physical-device, full screen-reader or
cross-browser certification is claimed. No observed temporal playback is added.

## 27. Screenshots

Twenty-five private screenshots and browser_qa.json are retained at
.local/v4-modular-audit/browser/b589c3fa3cd849ef916a28cf31f77571/:

- desktop-explore-collapsed.png
- desktop-overview.png
- desktop-layers.png
- desktop-timeseries.png and desktop-timeseries-expanded.png
- desktop-forecast.png
- desktop-compare.png
- desktop-guide.png
- desktop-docs-introduction.png
- mobile-overview.png, mobile-inspector.png, mobile-guide.png and mobile-docs.png

They are not published or committed because local-preview screenshots can show
unapproved research values. Reference screenshots are private in the same audit
root's reference directory.

## 28. Final Decision

**V4 MODULAR UX READY FOR DESIGN REVIEW**.
