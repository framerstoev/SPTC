# Cold-Wave Roadway Resilience Dashboard Pilot

## Main Page

Open `index.html` through a local web server. Browser `file://` loading may block GeoJSON and curve JSON fetches.

Example from the project root:

```powershell
python -m http.server 8000 -d data/front-end/coldwave-demo
```

Then open:

```text
http://localhost:8000/
```

## Required Files

- `index.html`
- `css/style.css`
- `js/app.js`
- `data/coldwave_resilience_map.geojson`
- `data/coldwave_summary.json`
- `data/curve_data_status.json`
- `data/curves/*.json` when hourly NPMRDS curve support is available

## GitHub Pages Deployment

Deploy the whole `coldwave-demo/` folder as a static directory, or copy its contents into a GitHub Pages branch/folder. Do not rename `data/`, `js/`, or `css/` unless the paths in `index.html` and `js/app.js` are updated.

## Score Meaning

`Cold_Wave_Resilience_Score` is positive: higher means more resilient for the January 2026 cold-wave pilot.

- Hybrid sections combine potential resilience and observed NPMRDS-supported performance.
- Potential-only sections use Tier 1/2 potential resilience only.
- Missing observed support does not mean low resilience.

## Evidence Level

- `A_hybrid_direct_observed_high_quality`: hybrid score with high-quality NPMRDS/control-section support.
- `B_hybrid_direct_observed_lower_quality`: hybrid score with lower-confidence observed support.
- `C_potential_only_no_observed_support`: no direct observed NPMRDS support; score falls back to potential resilience.

## Resilience Curve

For observed sections with hourly NPMRDS support, the side panel shows normalized speed performance:

```text
Q(t) = observed speed at time t / baseline speed profile at time t
```

The chart includes reference lines at `Q = 0.8` and `Q = 0.9`. Event and recovery periods are shaded when hourly records are available. The processed hourly file used here includes event and recovery rows with baseline profiles for normalization; baseline-period rows are not plotted as direct points in this front-end package.
