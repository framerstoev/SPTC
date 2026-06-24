# Cold-Wave Demo QA Notes

## Bug Fixed

- Fixed the selected control-section curve/chart panel stretching vertically after clicking an observed section.
- The page shell is now viewport-constrained, with internal scrolling on the left and right sidebars.
- The resilience curve canvas is inside a fixed-height wrapper, so Chart.js cannot expand the side panel indefinitely.
- Fixed potential-only sections so observed performance fields display as `N/A` instead of `0.000`.

## Files Changed

- `index.html`
- `css/style.css`
- `js/app.js`
- `QA_NOTES.md`

## Selected Panel and Chart Behavior

- The selected-section panel was reordered so the header, top score cards, method/evidence badges, and observed Q(t) curve appear before detailed observed component cards.
- The score cards now distinguish Composite, Potential, and Observed scores so users do not read the composite map as the same thing as the observed Q(t) curve.
- A compact Potential vs Observed card was added for every selected section.
- Hybrid sections show the potential score, observed score, observed-minus-potential gap, gap category, and a short interpretation.
- Potential-only sections show that observed comparison is unavailable because there is no direct NPMRDS support.
- The Q(t) chart now appears above Resistance, Absorptive Capacity, Recovery v2, and time-to-recovery details.
- Chart container height is fixed at 232px on normal desktop screens, 248px on wide screens, and 200px on small screens.
- `maintainAspectRatio` is set to `false`.
- Previous Chart.js instances are destroyed before rendering a newly selected section.
- The app keeps one canvas in the side panel and updates it; it does not append duplicate canvases.
- Curve points are sorted by timestamp, duplicate timestamps are averaged, and missing `q` values are filtered out before charting or summary calculation.
- Q(t) summary metrics are now computed from the full deduplicated hourly series before chart downsampling.
- Chart rendering can still downsample the display series to at most 300 points for performance.
- The Q(t) chart now displays raw hourly Q(t) plus a 6-hour rolling median smoothed Q(t) trend line.
- Compact Q(t) summary metrics were added: event mean Q, event min Q, event percent below 0.8, event percent below 0.9, recovery mean Q, and recovery percent below 0.9.
- Known audit mismatch `CS_549936` was fixed: Event min Q should display as `0.687`, matching raw event min Q `0.6868` after rounding.
- The conceptual resilience schematic was moved out of the per-section chart card and into a compact collapsible global help section in the left sidebar.
- The measured Q(t) chart is the only section-specific curve shown in the selected-section panel.
- A baseline reference note explains that Q(t) is normalized by the baseline speed profile, that baseline-period raw rows are not plotted in this prototype, and that measured Q(t) can fluctuate because hourly speeds vary with congestion, probe sample size, incidents, and baseline-profile differences.

## Data Loading

- `coldwave_resilience_map.geojson` is loaded once at startup.
- Curve JSON files are lazy-loaded only when a section with `curve_file` is selected.
- The map GeoJSON is approximately 15 MB.
- The curve JSON folder is approximately 75 MB.

## UI Polish

- Dashboard interpretation was clarified by separating map layers for:
  - Composite Resilience Score
  - Potential Resilience Score
  - Observed Resilience Score
  - Potential-Observed Gap Category
  - Evidence Level
  - Score Method
- The default map layer label was renamed from Cold-Wave Resilience Score to Composite Resilience Score.
- A layer-selector note now says that map color reflects the selected layer and the Q(t) curve shows observed speed performance only.
- Gap category logic is derived in browser memory at GeoJSON load time; the source GeoJSON and curve JSON files were not regenerated.
- Gap categories use transparent thresholds:
  - potential >= 0.6 and observed >= 0.6: consistently high resilience
  - potential < 0.4 and observed < 0.4: consistently low resilience / priority concern
  - observed - potential >= 0.25: observed better than potential / potential risk overestimated
  - observed - potential <= -0.25: observed worse than potential / hidden vulnerability
  - all other hybrid sections: mixed / moderate agreement
  - potential-only sections: no observed support
- Responsive layout was updated for the deployed GitHub Pages version:
  - desktop columns now use clamp-based side-panel widths
  - large screens allocate wider left/right panels
  - medium screens tighten columns and use single-column KPI cards
  - small screens stack panels and allow normal page scrolling
- Compact desktop layout was applied after wide-screen review:
  - side panels use `clamp(300px, 18vw, 360px)` and `clamp(360px, 23vw, 460px)`
  - left header title is 25px with compact line height
  - sidebar padding, section spacing, and legend spacing were reduced
  - KPI card padding is 9px and numeric type is 21px
  - selected-section score cards use a compact top grid, with observed component cards below the chart
  - map line weight was reduced to keep statewide control sections from looking too heavy
  - map fit padding was increased so Texas fits with more breathing room at 100% browser zoom
- Evidence and score-method raw codes are mapped to dashboard labels:
  - A: Hybrid + high-quality observed support
  - B: Hybrid + lower-quality observed support
  - C: Potential-only, no observed support
  - Hybrid: potential + observed
  - Potential-only
- Potential-only sections explicitly state that no direct NPMRDS hourly support is available.
- Potential-only KPI cards show Cold-Wave Score and Potential normally, while Observed, Resistance, Absorptive Capacity, Recovery v2, and time-to-recovery fields show `N/A`.
- Potential-only selected sections do not show a Q(t) chart.
- Leaflet popups do not show observed metrics for potential-only sections.
- County display now uses `county_name`, then `county`, then `COUNTY`, and falls back to `Unknown` rather than `-`.
- Control-section counties were reassigned from geometry using Texas county polygons, so potential-only sections no longer depend on TMC county metadata.
- Legends update dynamically and include the note that potential-only does not mean low resilience.
- The map uses `fitBounds` after GeoJSON loads and Leaflet zoom is constrained to `minZoom: 5` and `maxZoom: 14`.

## Local Preview

From the GitHub Pages repo root:

```powershell
cd E:\Projects\PhD\SPTC\data\front-end\sptc-demo
python -m http.server 8001
```

Open:

```text
http://localhost:8001/coldwave-demo/
```

## Verification Notes

- HTTP checks passed for the main page, CSS, JS, summary JSON, map GeoJSON, and a sample lazy-loaded curve JSON.
- Local endpoint checks used the deployed subfolder path `http://localhost:8001/coldwave-demo/`.
- Static viewport tuning was implemented for wide/medium/small breakpoints; visual browser checks at 1280, 1440, 1920, and 2560 px still need a human browser pass.
- Compact layout should be checked at 100% browser zoom for 1440, 1920, and 2560 px widths.
- Selected-section layout should be checked at 100% browser zoom to confirm the measured Q(t) curve is visible soon after a hybrid section is clicked.
- The conceptual schematic should appear only in the left global help section, not inside each selected section.
- Potential-only N/A behavior was preserved in the display logic.
- Node.js is not installed in this environment, so `node --check` could not be run.
- Browser console inspection still needs a human browser pass after opening the local preview URL.
- Curves are still lazy-loaded only when a selected feature has `curve_file`.

## Remaining Known Issues

- The generated data package is still large for a static demo: about 90 MB total.
- Baseline-period rows are not plotted as direct points because the available processed hourly curve file contains event and recovery rows with baseline profiles attached for normalization.
