/* Presentation umbrella only. Source values, gates, classifications and chart data stay event-specific. */
(function (root) {
  "use strict";
  const T = (...args) => V4Inspector.text(...args);
  const side = metric => ["planning", "hazard", "network"].includes(metric.categoryId) && !metric.temp ? "planningLayer" : "observedLayer";
  const primary = data => data.beryl ? "o1a" : "observed";
  const methodLink = (data, anchor = "observed") => `./docs.html${data.beryl ? "?event=beryl_2024_07" : ""}#${anchor}`;
  function metric(metric, beryl) {
    const names = {potential:"Potential Resilience Score", weather:"Storm Exposure", network:"Network Risk", precipitation:"Rainfall", precipitation_context:"Rainfall", gust:"Peak Wind Gust", wind:"Wind Speed", coverage:"Data Availability", q_support:"Data Availability", mobility_cost:"Expected-Demand Delay Cost", vehicle_delay:"Vehicle Delay Hours", aadt_context:"Annual Average Daily Traffic"};
    if (names[metric.key]) metric.label = names[metric.key];
    if (metric.key === (beryl ? "o1a" : "observed")) { metric.label = "Observed Traffic Performance"; metric.cardLabel = metric.label; }
    if (beryl) {
      const aliases = {observed:"Core Average Speed Ratio", o1b_score:"Slowdown Episode Score", o1b_minimum:"Minimum Q", o1b_loss:"Loss Area", o1b_return:"Recovery", o1b_status:"Slowdown Evidence", phase_score:"Original Full-History Score"};
      if (aliases[metric.key]) metric.label = aliases[metric.key];
      if (["o1a", "o1b_score", "observed", "phase_score"].includes(metric.key)) metric.default = metric.key === "o1a";
    }
    return root.V5R.metricCopy(root.V4L.configure(metric,beryl),beryl);
  }
  function title(data, key) {
    if (key === primary(data)) return "Observed Traffic Performance";
    return V4Core.metrics[key].label;
  }
  function status(row, beryl) {
    if (!beryl) return {detected:"Sustained Slowdown Detected",no_sustained_drop:"No Sustained Slowdown Detected",recovery_endpoint_censored:"Return Not Confirmed",no_observed_support:"Limited Traffic Data"}[row.status] || "Traffic Evidence Unavailable";
    const s = row.o1b.evidence_status;
    if (s === "observed_clock_supported_onset_and_return") return "Slowdown Detected · Return Observed";
    if (s === "no_eligible_sustained_drop_not_proof_of_no_impact") return "No Sustained Slowdown Detected";
    if (s === "preexisting_decline_no_eligible_new_onset") return "Earlier Slowdown";
    if (s === "insufficient_full_trajectory_observations") return "Limited Traffic Data";
    if (s === "baseline_reference_uncertain") return "Reference Uncertain";
    if (s === "incomplete_event_onset_confirmation") return "Slowdown Evidence Incomplete";
    return "Slowdown Detected · Return Not Confirmed";
  }
  function layers(data, store, actions) {
    const host = document.getElementById("layerGroups"); host.replaceChildren();
    const used = new Set(), metrics = V4Core.metrics;
    function group(label) { const g = T("fieldset", "", "layer-group"); g.append(T("legend", label)); g.setAttribute("role", "radiogroup"); host.append(g); return g; }
    function add(g, key) {
      if (!metrics[key] || used.has(key)) return; used.add(key);
      const m = metrics[key], button = T("button", "", "layer-option"); button.type = "button"; button.dataset.layer = key;
      button.setAttribute("role", "radio"); button.setAttribute("aria-checked", "false"); button.append(T("span", m.label));
      button.title = m.unit; button.addEventListener("click", () => actions.layer(key)); g.append(button);
    }
    const planning = group("Planning"); ["potential","weather","precipitation","gust","network"].forEach(key => add(planning, key));
    const observation = group("Observation"); add(observation, primary(data)); add(observation, data.beryl ? "coverage" : "q_support");
    const slowdown = T("details", "", "slowdown-layers"); slowdown.append(T("summary", "Slowdown & Recovery")); observation.append(slowdown);
    (data.beryl ? ["o1b_minimum","o1b_loss","o1b_return"] : ["minimum","loss","recovery"]).forEach(key => add(slowdown,key));
    const impact = group("Mobility Impact"); ["mobility_cost","vehicle_delay"].forEach(key => add(impact,key));
    const advanced = group("Advanced Analysis"), details = T("details"); details.append(T("summary", "Additional layers")); advanced.append(details);
    if (data.beryl) add(details,"o1b_score");
    Object.values(metrics).filter(m => m.explore !== false && !used.has(m.key)).forEach(m => add(details,m.key));
    const link = T("a", "Metric definitions ↗", "text-action"); link.href = methodLink(data,"layers"); host.append(link);
  }
  function planning(data, row, host) {
    if (data.beryl) {
      V4H.planning(data, row, host);
      return;
    }
    host.append(T("h3","Planning","evidence-heading"));
    const grid = T("div","","metric-pair planning-main");
    for (const key of ["potential","weather","network","aadt_context","precipitation_context"]) {
      grid.append(V4Presentation.metricCard(data,row,key));
    }
    host.append(grid, root.V5R.docLink(data,"Planning methods","planning"));
  }

  function evidence(data, store, host, row, large, current, receive, rerender, inspector = false) {
    const R = root.V5R;
    const sameRoad = row && host.dataset.evidenceId === row.id;
    const slowdownOpen = sameRoad && host.querySelector(".v5s-slowdown-details")?.open;
    host.dataset.evidenceId = row?.id || "";
    host.replaceChildren();
    if (!row) {
      host.append(T("h2","Choose a road","module-title"),T("p","Click a road or use search to view its traffic history.","panel-lead"));
      return;
    }
    const summary = T("div","","v5s-observation");
    const showSummary = meta => {
      const keepSlowdown = summary.querySelector(".v5s-slowdown-details")?.open ?? slowdownOpen;
      summary.replaceChildren();
      R.observation(data,row,summary,meta);
      const detail = summary.querySelector(".v5s-slowdown-details");
      if (detail) detail.open = Boolean(keepSlowdown);
    };
    if (inspector) {
      host.append(summary);
      // January's phase-reference and warning flags come from the lazy curve payload.
      if (data.beryl || !row.has_curve) showSummary();
    }
    if (!row.has_curve) {
      if (!inspector) host.append(T("p","No traffic history for this road.","curve-status"));
      return;
    }
    const valid = data.beryl ? row.o1b.selected_episode : V4Presentation.phaseValid(data,row);
    if (!large) host.append(T(inspector?"h3":"h2","Traffic Performance Over Time",inspector?"evidence-heading":"module-title"));
    const controls = T("div","","series-ranges");
    for (const [range,label] of [["event",data.beryl?"Hurricane Period":"Event Period"],["full","Full History"]]) {
      const button = T("button",label,"outline-button");
      button.type = "button";
      button.dataset.seriesRange = range;
      button.setAttribute("aria-pressed",String(store.get().seriesRange === range));
      button.addEventListener("click",()=>store.set({seriesRange:range}));
      controls.append(button);
    }
    const wrap = T("div","","chart-wrap"+(large?" expanded-chart":""));
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role","img");
    canvas.setAttribute("aria-label","Traffic Performance Over Time");
    wrap.append(canvas);
    const message = T("p","Loading traffic history…","curve-status");
    message.setAttribute("role","status");
    host.append(controls,wrap,message);
    if (!large) {
      const expand = T("button","Expand Traffic History ↗","outline-button");
      expand.type = "button";
      expand.id = inspector ? "expandInspectorSeries" : "expandSeries";
      expand.addEventListener("click",()=>{
        document.getElementById("seriesDialog").showModal();
        root.v4App.timeSeries.render();
      });
      host.append(expand);
    }
    V4Data.curve(data,row.id).then(original=>{
      if (!current() || !canvas.isConnected) return;
      const payload = data.beryl ? V4O1.eventPayload(original,row) : original;
      const chart = V4Charts.draw(canvas,payload,row,{data,range:store.get().seriesRange,phaseValid:valid});
      chart.options.scales.y.title.text = "Speed Ratio";
      chart.update("none");
      receive(chart);
      if (inspector && !data.beryl) showSummary(payload.metadata || {});
      message.remove();
    }).catch(()=>{
      if (!current()) return;
      wrap.hidden = true;
      message.textContent = "Traffic history could not be loaded.";
      if (inspector && !data.beryl) showSummary({unavailable:true});
    });
  }

  function docs(sections,event) {
    const beryl=event==="beryl_2024_07",set=(id,title,paragraphs)=>{const old=sections.find(s=>s[0]===id);if(old){old[1]=title;old[2]=paragraphs;}else sections.push([id,title,paragraphs]);};
    set("quick-start","Quick Start",["Both maps open with Planning — Potential Resilience Score and Observation — Observed Traffic Performance. Layers opens the shared left-side metric panel; its reset restores event-specific defaults without changing the selected road or camera. Both views and the Layers panel are independently collapsible. Legend details expand on request.","Overview contains event/area selection, the only road search and economic summary with Area details. The shared left-side Layers panel uses the existing registry and selection state; the map headers contain no metric selectors. Existing panel resizing and Inspector dragging/resizing remain available."]);
    set("interface","Interface and Information Hierarchy",["Use Layers to change either map metric. A selected road, camera, county and contextual overlays survive metric changes. Event switching restores each event's defaults.","The Beryl road header shows Planning Class, Observed Class and their percentiles. The Inspector shows Peak Speed Loss and observed traffic history. Slowdown and return metrics remain available in Layers. Keyboard users can navigate layer choices with the arrow keys and close dialogs with Escape."]);
    set("observed","Observed Traffic Performance — Event-Specific Definitions",["The common UI name is a presentation umbrella, not an identical scientific estimand or cross-event numerical calibration. January reads original Candidate B selected-phase observed_curve_resilience_score_v0, a normalized performance-loss score for the selected sustained decline. It is not event-window mean Q. Its original source eligibility and quantile classes remain unchanged.","Beryl defaults to accepted O1-A primary_qualified_performance_index: one minus mean positive baseline-relative speed-ratio deficit over qualified observed July 7–9 native-local core hours. Exactly 3,097 qualified values retain original G75-D12-G12 qualification, mixed-clock uncertainty and missingness. It is not a complete resilience-and-recovery score.","Beryl O1-B remains secondary event-anchored slowdown and threshold-return evidence in Slowdown & Recovery: 1,464 selected episodes, 943 qualified numeric cases, 707 strong full-continuity cases. Its Slowdown Episode Score is in Advanced Analysis; Minimum Q, Loss Area and Recovery remain in Slowdown & Recovery with their existing gates. Recovery is time to observed threshold return, not infrastructure repair. Historical B4 retains 3,805 full-period scores in Advanced."]);
    set("observation-menu","Observation Layers",["Primary Performance uses event-specific accepted fields: January observed_curve_resilience_score_v0; Beryl o1a.primary_qualified_performance_index.","Beryl Slowdown & Recovery uses the event-anchored selected slowdown and qualified return evidence. January's Minimum Q, Loss Area and Recovery keep their original Candidate B sources."]);
    set("compare","Planning and Observation",["Planning Potential and observed traffic measures are different constructs. Differences are not calibrated prediction errors, residuals, or investment recommendations. Neither a common name nor a common palette implies identical equations, event windows, support populations or recovery treatment.","Beryl Impact Focus preserves V5H's 827-member weather/selected-episode screen, including 22 remote rainfall overlaps. Only 485 of those 827 roads have qualified O1-A numeric performance; 342 remain unavailable in the primary performance layer. These differ from the 559 focused O1-B qualified episode values. The existing 943 O1-B total, 3,097 O1-A total and focus population must not be conflated. Common Support is an independent numerical-pairing mask; enabling either mask explicitly turns the other off."]);
    if (beryl) set("peak-speed-loss", "Peak Speed Loss and Road Comparison", [
      "Peak Speed Loss is 100 × max(0, 1 minus the lowest three-hour median speed ratio). Every window requires three consecutive valid observed hours entirely within July 7–9 in the source's local clock. It uses the original hourly ratios, core coverage qualification and one resolved clock. Selected slowdowns and return have separate rules.",
      "The Beryl research comparison pairs Planning Class with Peak-Loss Class on a fixed set of 3,097 roads. Greater peak loss gives lower relative standing, with identical values sharing a midrank. Class Difference is Peak-Loss Class minus Planning Class. The Inspector Observed Class ranks average storm-period performance."
    ]);
    set("curves","Traffic Performance Over Time",["Event Period (January), Hurricane Period (Beryl) and Full History are display viewports only. Original raw Q(t), smoothed arrays and null gaps stay intact. January retains its delivered TMC-local labels. Beryl retains the source UTC axis and native-local onset interpretation.","Beryl charts use the accepted event-anchored onset, minimum and return or censoring endpoint for a selected event episode. Markers are visible within the displayed range. Historical B4 metrics remain in Layers and the research record. January retains its original Candidate B markers."]);
    set("version","V5L Local Visual Review",["V5L continues verified V5K with shared visual semantics and compact scientific legends. Search and area economics live only in Overview; all metric selection uses the shared left Layers panel. The top search row, bottom economic strip and upper-right Layers control are removed. Explicit valid event URLs start collapsed; missing/unknown event requests open Overview with the existing January fallback. Manual panel choices stay open. Existing resizing is preserved. Accepted source fields, science, geometry, eligibility, classifications, weather-focus membership, AADT, economic results, public January V4 and research freezes are unchanged. No publication, deployment or Git mutation is part of this phase."]);
    set("visual-system","Scientific Colors and Legend Details",[
      "Both events use one legend component. Default legends show the metric, color symbols, qualitative direction and Details. Details shows full-precision class intervals, units, availability and qualification. A shared boundary belongs to the lower class; values below/above the outer bounds retain the original first/last class. Fixed classes and original January supported-sample quantiles are not recalculated or aligned across events.",
      "Performance, potential and minimum Q use red for lower values and blue for higher values. Risk, exposure, loss, endpoint intervals and conditional economics reverse that direction: higher concern is red. The five colors are #B2182B, #E87D65, #D49B98, #6FA6CF and #2166AC. January endpoint intervals retain original censoring qualifications and must not all be called confirmed recovery.",
      "Availability uses visible teal-to-blue: #3B9F92, #278A92, #25718F, #1C5D83, #164A76. January availability is the original Boolean history flag, not a coverage estimate. Existing neutral temperature/day-count and track-distance layers use sequential purple: #B07AB7, #9566AF, #7D56A4, #654591, #4A3179; higher values are darker, without a resilience judgment. No new AADT map was added.",
      "All nine original Beryl evidence statuses retain distinct categorical colors and line patterns, including two censored classes, uncertain reference, earlier slowdown, incomplete onset and insufficient observations. These are not a numerical ranking. Unsupported numeric records have no quantitative stroke, but canonical geometry remains searchable and selectable. Gray references outside an active display mask are not declared unaffected. NHC, purple dashed evacuation routes and selected-road highlights retain separate contextual styling.",
      "January primary performance is its original Candidate B selected-phase score. Beryl primary performance is O1-A supported-hour event-core performance. Beryl O1-B Slowdown Episode Score remains a separate qualified 943-CS advanced layer. January does not duplicate its main selected-phase score. Shared labels and palettes do not establish direct numerical comparability.",
      "TAMU structural tokens are Aggie Maroon #500000, Warm Neutral #D6D3C4 and Light Surface #F7F5F2. They style navigation, active controls, panels and focus outlines independently of scientific road colors."
    ]);
    set("sources","Sources and Provenance",["Accepted TxDOT geometry/network context, PRISM weather, NPMRDS-derived traffic and expected-demand economic results retain their original hashes and vintage. Beryl additionally retains ERA5 and NHC context. Raw probe records and economic ledgers are not served. Beryl remains local research preview; January retains its separate public-release record.","PRISM Group, Oregon State University, https://prism.oregonstate.edu. January temperature uses D2 release 8; original precipitation keeps its frozen release. The original access date remains unrecorded in available provenance; none is invented. Fixed AADT is not event-day traffic and uses mixed 2001–2024 inventory years, with per-CS years unavailable."]);
    if(!beryl)set("layers","January Layers and Scientific Aliases",["Observed Traffic Performance reads original January selected-phase Score. Slowdown & Recovery exposes the original Minimum Q, Loss Area and Recovery; Performance Score is the existing primary performance layer. Loss Area is observed-row Q-hours, not monetary loss. Accepted censored scores remain eligible where the original contract allows them; return status remains qualified.","Planning, Storm Exposure, Network Risk, Rainfall, AADT, mobility metrics and experimental temperature keep their original fields, units and classifications. AADT remains a main Planning card. Temperature stays separate from WEATHER_REI."]);
  }
  root.V4J=Object.freeze({side,primary,title,status,metric,layers,planning,evidence,docs,methodLink});
})(window);
