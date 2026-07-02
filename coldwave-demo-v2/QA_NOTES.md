# QA Notes

## Scope

This folder is a local-only experimental frontend prototype for data-driven resilience curve v0 outputs.

The stable deployed dashboard at `data/front-end/sptc-demo/coldwave-demo` was not modified.

## Data Package

- Map layer: `data/data_driven_resilience_map_v0.geojson`
- Curve files: `data/curves/*.json`
- Summary/index files: `data/summary.json`, `data/curve_index.json`

The large source CSV `control_section_q_timeseries_v0.csv` is not copied into the frontend. Curves are split by control section and lazy-loaded when a feature is clicked.

## Intended Checks

- Map loads from local server.
- Layer selector updates color styling and legend.
- Search finds partial matches for CS IDs, `CS_` keys, routes, and counties.
- Search result selection zooms to the control section, highlights it, updates the panel, and lazy-loads Q(t).
- Clicking a control section opens the right panel.
- Q(t) curve loads lazily for sections with curve JSON.
- `no_sustained_drop` sections show the v0 warning and do not imply full resilience.
- `recovery_endpoint_censored` sections show the censored-recovery warning.
- Tier 3 observed curve metrics are displayed separately from Tier 1/2 predictor/context fields.
- Stable `coldwave-demo` remains untouched.

## Score Classes

The `Observed Curve Resilience Score v0` layer uses quantile classes because fixed classes were imbalanced:

- fixed breaks produced `0` Very Low and only `37` Very High sections among valid detections.
- quantile breaks produce roughly balanced classes.

Current breakpoints:

- Very Low: `0.343600-0.690711`
- Low: `0.690711-0.734266`
- Moderate: `0.734266-0.775293`
- High: `0.775293-0.833314`
- Very High: `0.833314-0.913378`

These are experimental v0 classes and should not be presented as official resilience categories.

Classification logic fix:

- Missing scores, `null`, blank strings, and N/A values are excluded from quantile calculation.
- `no_sustained_drop` sections are excluded from numeric quantiles and shown as a separate warning/status class.
- `recovery_endpoint_censored` sections are included in numeric classes only when they have a valid score, and are still flagged with a warning badge.
- Previous incorrect browser legend values came from JavaScript treating `null` as `0` through `Number(null)`.

## Q(t) Chart Improvements

- Chart height increased for presentation readability.
- X-axis label clarified as `Time, Jan 1-Feb 3, 2026`.
- Date tick density reduced.
- Onset/min/recovery marker text moved into a small legend to avoid overlap.
- Q = 1.0, 0.9, and 0.8 reference lines retained.
- Loss-area shading remains subtle.

## Delay Proxy Audit

The v0 script shows:

- `total_detected_phase_delay_proxy` equals `disruption_delay_proxy`.
- `recovery_delay_proxy` is a subset from minimum point to recovery endpoint.
- Therefore `total_detected_phase_delay_proxy` should not be read as `disruption + recovery`.

The UI labels were updated to:

- Detected phase delay proxy
- Detected recovery-subset delay proxy
- V0 disruption-delay field
- Full-window delay proxy: N/A

## Known Limitations

- Candidate B remains experimental.
- The shaded chart area is an approximate visual representation of detected curve loss, not a recalculation of the metric.
- Recovery metrics are lower-confidence when `recovery_endpoint_censored` is flagged.
- Delay burden is a proxy based on profile demand weighting, not observed event-day vehicle volume.
- This v2 is not deployed and should not replace the stable `coldwave-demo`.
