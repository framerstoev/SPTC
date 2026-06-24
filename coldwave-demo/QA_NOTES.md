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

## Chart Behavior

- Chart container height is fixed at 240px on desktop and 200px on small screens.
- `maintainAspectRatio` is set to `false`.
- Previous Chart.js instances are destroyed before rendering a newly selected section.
- The app keeps one canvas in the side panel and updates it; it does not append duplicate canvases.
- Curve points are sorted by timestamp, duplicate timestamps are averaged, missing `q` values are filtered out, and display series are downsampled to at most 300 points.
- A compact schematic resilience curve was added above the measured Q(t) chart.
- The measured Q(t) chart remains the primary observed-data chart.
- A baseline reference note explains that Q(t) is normalized by the baseline speed profile and that baseline-period raw rows are not plotted in this prototype.

## Data Loading

- `coldwave_resilience_map.geojson` is loaded once at startup.
- Curve JSON files are lazy-loaded only when a section with `curve_file` is selected.
- The map GeoJSON is approximately 15 MB.
- The curve JSON folder is approximately 75 MB.

## UI Polish

- Responsive layout was updated for the deployed GitHub Pages version:
  - desktop columns now use clamp-based side-panel widths
  - large screens allocate wider left/right panels
  - medium screens tighten columns and use single-column KPI cards
  - small screens stack panels and allow normal page scrolling
- Compact desktop layout was applied after wide-screen review:
  - side panels use `clamp(300px, 18vw, 360px)` and `clamp(360px, 23vw, 460px)`
  - left header and panel spacing were reduced
  - KPI card padding and numeric type were tightened
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
- Node.js is not installed in this environment, so `node --check` could not be run.
- Browser console inspection still needs a human browser pass after opening the local preview URL.
- Curves are still lazy-loaded only when a selected feature has `curve_file`.

## Remaining Known Issues

- The generated data package is still large for a static demo: about 90 MB total.
- Baseline-period rows are not plotted as direct points because the available processed hourly curve file contains event and recovery rows with baseline profiles attached for normalization.
