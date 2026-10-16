# Modular V4 component plan

Baseline: f9edd464ee30c5192ef1d17a8282999c393ee1c4. This plan precedes the UI refactor.

```text
App shell
  Compact header: Explore / Compare, Guide, Docs, preview status
  Persistent seven-module rail
  One collapsible context panel
    Overview: event/area/hazard and current-context summary
    Analysis: three evidence families and direct actions
    Layers: grouped accepted metrics, experimental temperature window
    Time Series: selected accepted Q(t), support, expand chart
    Forecast: planned temporal/spatial research, disabled computation
    Data: actual package coverage, identifiers, methods and provenance
    About: research scope, attribution and limitations
  Persistent workspace
    Explore Canvas map, floating search/legend, compact impact summary
    Compare synchronized Planning-left / Observed-right maps
  Shared floating/bottom section inspector: Weather / Planning / Observed / Impact
  Accessible Guide dialog with highlighted live components
  Independent docs.html: article navigation and optional text filtering
```

| Treatment | Existing component | Change |
| --- | --- | --- |
| Reuse unchanged | core.js, data.js, charts.js, local exporter, research packages, vendored libraries | No numerical or data changes |
| Reorganize | area/event/hazard controls, layers, search, impact actions | Place in contextual modules or floating map controls |
| Minimal refactor | maps.js | Add resize preserving center/zoom; keep Canvas, caching, fit-generation guard and synchronization |
| Minimal refactor | inspector.js | Hide without clearing selection, Time Series action; keep accepted evidence and lazy curves |
| Replace presentation wiring | app.js, HTML, CSS | Shell/panel state, shared selection; original palette retained |
| Remove redundancy | permanent filter sidebar and top Methods workspace | Seven-module context panel and separate user Docs |
| New | navigation.js, timeseries.js, guide.js, docs.html/docs.js | Interface only; no analytical or model implementation |

State adds `panel` and `inspectorOpen` to the existing immutable shared store.
Opening/collapsing a module never changes filters, layers, selection or viewport.
Resize callbacks are coalesced and read current state. Maps are not reconstructed.
Time Series and its expanded dialog reuse the existing curve cache and chart
renderer, with generation checks and chart destruction on hidden views.

Future prediction interface (documentation only): a separately reviewed product
would need event/area/window, model/version, observed-versus-predicted label,
section IDs, temporal support, units, uncertainty definition, validation summary,
provenance and publication approval. No forecast schema is accepted for runtime
loading in this version; no prediction request, model, layer or output exists.

Public build retains an explicit runtime allowlist, now including the new UI and
Docs files. Research packages and screenshots remain outside the public artifact.
