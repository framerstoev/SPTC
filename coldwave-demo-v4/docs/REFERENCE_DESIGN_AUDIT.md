# Design reference audit

Reference: [TIDE Mapper](https://tidal-tipping.com/), inspected in real isolated
Chrome on 2026-10-16 at 1440×960 and 390×844. Initial guided tour was dismissed;
Overview, Analysis, Layers & Display, Time Series, Forecast and Data & Methods
were opened. Private screenshots and bounded visible-DOM observations were kept
as local QA evidence, not copied into the public product.

| Observed component | Function observed | Adapt? | V4 equivalent |
| --- | --- | --- | --- |
| Desktop icon rail and adjacent content panel | Overview, analysis, layers, time-series, forecast and methods navigation without abandoning the map | Yes, simplify | Three labeled workspaces: Explore, Compare, Methods & Data |
| Dominant Leaflet map | Search, zoom, reset view, region shortcuts; map remains present while panels change | Yes | Texas roadway Canvas map, county filter, section search, reset extent |
| Collapsible display-layer card | Separates observed and forecast layer choices | Pattern only | Explicit Planning, Observed, Mobility and Experimental Weather groups; no forecast layer |
| Legend with hide-category controls and help | Explains layer-specific classes and units | Partly | Contextual unit-aware legend; retain missing-value explanation; no category hiding that could be mistaken for missing coverage |
| Analysis filters and map/table/charts views | Shows result counts and filters while allowing deeper exploration | Partly | Compact event/area controls and support counts; comparison is its own workspace |
| Selected-pixel Time Series panel | Shows an example then allows map-selected pixel series; annual/16-day switches, multiple charts and breakpoint context | Selection pattern only | One selected control section, evidence tabs and lazy Q(t); do not auto-select an unrequested example or copy its charts |
| Forecast timeline at map bottom | Play/year stepping, cumulative and annual views | No forecasting | Bottom space used for compact accepted area impact summary; no invented temporal forecasts |
| Expandable method checks and chart fullscreen controls | Progressive disclosure for detailed evidence | Yes, simplify | Inspector tabs, impact details dialog and separate Methods & Data workspace |
| Sources and documentation panel | Explains methods, provenance and downloads | Yes, with permission boundary | Methods, units, coverage, fixed windows and publication state; no raw or unapproved downloads |
| Mobile bottom navigation and sheet-like content panel | Map navigation remains reachable; long panel content scrolls above bottom navigation | Yes | Bottom workspace navigation, collapsible filters, selected-section bottom sheet |
| Neutral basemap, white cards, restrained accents, compact sans-serif text | Makes overlays readable without removing map context | Principles only | Original ivory/teal/ochre identity, editorial serif headings, original roadway mark and spacing |

Observed tooltips explain controls and thresholds. Selection-specific forecasts,
classifier/SHAP outputs, wetland pixels, logos, images, code and model claims are
not transferred. No claim is made that every reference interaction or touch gesture
was exhaustively tested. Its mobile panel/nav layout and visible behavior were
observed; V4's interactions are tested independently.

## Modular architecture revision

The reference was re-inspected in isolated real Chrome on 2026-10-16. Its visible
header includes Guide and Docs; navigation exposes Overview, Analysis, Layers &
Display, Time Series, Forecast, Data & Methods and About. The documentation link
points to a separate /docs/ location. Desktop/module/mobile screenshots and DOM
observations are retained privately under .local/v4-modular-audit/reference.
The web-reader tool could not access the site; the browser inspection succeeded.

V4 now adapts the persistent seven-module rail, one collapsible contextual panel,
map-first landing, separate Docs, contextual Time Series and guided highlighting.
Its equivalents are Overview, Analysis, Layers, Time Series, Forecast, Data and
About. Unlike the reference's operational forecast controls, V4 Forecast is
explicitly planned, with no model, numerical output, playback or map layer.
The ivory/teal/ochre V4 branding is retained. Original SVG rail symbols are drawn
in V4; no reference source, logos, artwork, model claims or assets are copied.
