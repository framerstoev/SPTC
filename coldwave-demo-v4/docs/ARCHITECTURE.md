# V4 architecture and V3 separation

V4 is a standalone static application. There is no Assistant button, model client,
readiness check, API server, model startup or V3 script import. Pinned Leaflet 1.9.4
and Chart.js 4.4.1 are vendored with their MIT licenses. OpenStreetMap basemap tiles are
the only external runtime resources; the evidence package is same-origin static JSON.

| Concern | V3 assessment / reusable behavior | V4 module |
| --- | --- | --- |
| Shell and navigation | V3 comparative workspace is the accepted conceptual basis; layout is new | index.html, css/app.css, js/app.js |
| Maps and identifiers | Reuse accepted line coordinates/IDs and Canvas rendering, not a rebuilt crosswalk | js/maps.js, local exporter |
| Tier 1/2/Potential | Read accepted fields; never recalculate formulas | js/core.js metric registry |
| Observed classes | Preserve supported numeric sample, no-sustained-drop exclusion, censored inclusion, linear percentile interpolation and epsilon tie handling | js/core.js |
| Q(t) | Reuse existing accepted per-section JSON values, smoothing and phase metadata; lazy load/cache | js/charts.js, js/data.js |
| Event and county selection | V3 API client is coupled to FastAPI; replace transport with precomputed static packages | js/data.js, js/app.js |
| Shared selection | One selected ID for Explore, search and both comparison maps | immutable central store |
| County reset fix | Cancel map movement; latest generation wins; no animated fits | js/maps.js |
| Impact B+ | Two area headline values, details on demand, only two available section fields | js/app.js, js/inspector.js |
| Long explanations | Progressive disclosure outside the default map | js/methods.js |

The V3 script tail imports deployment/Assistant configuration, Assistant clients,
actions, chat/window modules and backend event clients. Its old local development
launcher additionally checks/starts model services. None is imported or initialized
by V4. V3 and the backend remain unchanged.

Maps share one fetched geometry object; comparison maps are created lazily. Area
filtering reuses existing layers and cached bounds; it does not reload geometry.
The shared state has one workspace, area, selected ID, inspector tab, layer choices
and experimental PRISM window. Curve requests use a generation check so a stale
response cannot overwrite the currently selected section.

Q(t) is plotted on a linear delivered-clock axis without timezone conversion.
Display-only null separators reveal missing hourly intervals; original Q and
smoothed values are retained. No new observation or smoothed value is synthesized.

PUBLIC_SHOWCASE reads the approved empty public metadata manifest. No analytical
data have been granted redistribution approval for V4 by this task. Appropriate
unavailable states are therefore intentional. LOCAL_RESEARCH_PREVIEW is an
explicit loopback-only mode reading a Git-ignored static package. The public
build also sets public_only=true, overriding a requested local-preview query.

The exporter allowlists fields from the frozen accepted run and reviewed
temperature section table. Geometry coordinates are copied exactly from V3's
accepted map product. Only derived control-section curves are copied, locally;
no raw probe records, full economic ledgers, secrets or credentials are exported.
County economics exist only where the accepted package supplies a county summary;
missing county/section metrics remain unavailable rather than being synthesized.
