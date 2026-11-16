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
      const aliases = {o1a_deficit:"Average Speed Loss", observed:"Core Average Speed Ratio", o1b_score:"Slowdown Episode Score", o1b_minimum:"Minimum Q", o1b_loss:"Loss Area", o1b_return:"Recovery", o1b_status:"Slowdown Evidence", phase_score:"Original Full-History Score"};
      if (aliases[metric.key]) metric.label = aliases[metric.key];
      if (["o1a", "o1b_score", "observed", "phase_score"].includes(metric.key)) metric.default = metric.key === "o1a";
    }
    return root.V4L.configure(metric,beryl);
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
  function observationSummary(data, store, host, row) {
    const C = V4Core, P = V4Presentation, grid = T("div", "", "metric-pair performance-summary");
    host.append(T("h3", "Observed Traffic Performance", "evidence-heading"));
    grid.append(P.metricCard(data,row,primary(data)));
    if (data.beryl) {
      grid.append(P.metricCard(data,row,"o1a_deficit"));
      grid.append(V4Inspector.card("Data Available", row.o1a.valid_core_Q_count, "of " + row.o1a.expected_core_hour_count + " core hours"));
      const state = T("div","","metric-card"); state.append(T("span","Slowdown Status"),T("strong",status(row,true)));
      const returned = T("div","","metric-card"); returned.append(T("span","Return Status"),T("strong",row.o1b.qualified_return_evidence ? "Observed Threshold Return" : "Return Not Confirmed")); grid.append(state,returned);
      if (["o1b_score","o1b_minimum","o1b_loss","o1b_return"].includes(store.get().observedLayer)) {
        host.append(grid,T("h3","Selected Slowdown & Recovery","evidence-heading"));
        const episode = T("div","","metric-pair episode-summary");
        ["o1b_score","o1b_minimum","o1b_loss","o1b_return"].forEach(key => episode.append(P.metricCard(data,row,key))); host.append(episode); return;
      }
    } else {
      for (const [key,label] of [["minimum","Lowest Performance"],["loss","Observed Loss"],["recovery","Recovery Evidence"]]) { const node=P.metricCard(data,row,key); node.querySelector("span").textContent=label; if(key==="loss")node.querySelector("small").textContent="Observed speed deficit"; grid.append(node); }
      const support=T("div","","metric-card"); support.append(T("span","Data Availability"),T("strong",row.has_curve ? "Traffic History Available" : "Limited Traffic Data"));grid.append(support);
    }
    host.append(grid);
  }
  function planning(data, row, host) {
    if (data.beryl) {
      V4H.planning(data,row,host);
      const details=host.querySelector(".planning-details"); [...host.querySelectorAll(":scope > .evidence-note")].forEach(p=>details.append(p));
      host.querySelector('[data-metric="aadt_context"] small').textContent="vehicles/day · mixed 2001–2024 inventory";
      return;
    }
    host.append(T("h3","Planning","evidence-heading"));const grid=T("div","","metric-pair planning-main");
    for(const [key,label] of [["potential","Planning Score"],["weather","Storm Exposure"],["network","Network Risk"],["aadt_context","Annual Average Daily Traffic"],["precipitation_context","Rainfall"]]){const node=V4Presentation.metricCard(data,row,key);node.querySelector("span").textContent=label;if(key==="aadt_context")node.querySelector("small").textContent="vehicles/day · fixed inventory";grid.append(node);}
    host.append(grid);const details=T("details","","planning-details");details.append(T("summary","How Planning Score Is Calculated"));
    for(const key of ["consequence","redundancy"])details.append(V4Presentation.metricCard(data,row,key));
    details.append(T("p","January reads accepted WEATHER_REI, NETRISK_LITE, EVENT_REI and final robust-normalized Potential. Network Consequence uses .40 normalized endpoint connectivity and .60 normalized log AADT; Network Risk uses .60 Consequence + .40(1 − Redundancy). AADT is a fixed network reference, not observed event demand. No weights or normalization were recalculated.","evidence-note"));host.append(details);
  }
  function evidence(data,store,host,row,large,current,receive,rerender,inspector=false) {
    const sameRoad=row&&host.dataset.evidenceId===row.id,comparisonOpen=sameRoad&&host.querySelector(".episode-comparison")?.open,researchOpen=sameRoad&&host.querySelector(".research-details")?.open;
    host.dataset.evidenceId=row?.id||"";host.replaceChildren();if(!row){host.append(T("h2","Choose a road","module-title"),T("p","Click a road or use search to view its traffic history.","panel-lead"));return;}
    if(inspector)observationSummary(data,store,host,row);
    if(!large)host.append(T(inspector?"h3":"h2","Traffic Performance Over Time",inspector?"evidence-heading":"module-title"));
    const research=T("details","","research-details");research.open=Boolean(researchOpen);research.append(T("summary","Advanced / Methods and Evidence"));
    research.append(T("p",data.beryl?"Primary performance: O1-A primary_qualified_performance_index = one minus the mean positive baseline-relative speed deficit over qualified observed July 7–9 native-local hours. Separate O1-B episode scores retain 943 strong-return values; 1,464 selected episodes and 707 full-continuity cases are distinct. The primary O1-A measure is not complete resilience or recovery.":"Primary performance reads January Candidate B observed_curve_resilience_score_v0 for the original selected sustained slowdown phase. It is not average Q across the entire event window. Original eligibility, eligible censored scores and supported-sample quantiles are retained.","evidence-note"));
    if(data.beryl)V4O1.summary(research,row);
    research.append(T("p",`Source fields and values: ${JSON.stringify(data.beryl?{o1a:row.o1a,o1b:row.o1b,candidate_b:row.candidate_b}:{observed_curve_resilience_score_v0:row.observed_curve_resilience_score_v0,q_min:row.q_min,resilience_loss_area:row.resilience_loss_area,recovery_duration_hours:row.recovery_duration_hours,status:row.status})}`,"source-fields"));
    const docs=T("a","Full methods and sources ↗","text-action");docs.href=methodLink(data);research.append(docs);
    if(!row.has_curve){host.append(T("p","Traffic history unavailable.","evidence-note"),research);return;}
    const which=data.beryl?V4O1.context(store):"b4",valid=data.beryl?V4O1.valid(row,which):V4Presentation.phaseValid(data,row);
    const controls=T("div","","series-ranges");
    for(const [value,label] of [["event",data.beryl?"Hurricane Period":"Event Period"],["full","Full History"]]){const button=T("button",label,"outline-button");button.type="button";button.dataset.seriesRange=value;button.setAttribute("aria-pressed",String(store.get().seriesRange===value));button.addEventListener("click",()=>store.set({seriesRange:value}));controls.append(button);}
    const comparison=T("details","","episode-comparison");comparison.open=Boolean(comparisonOpen);comparison.append(T("summary","Advanced / Compare Episodes"));
    if(data.beryl){const buttons=T("div","","series-ranges");for(const [value,label] of [["o1b","Event Slowdown"],["b4","Historical Slowdown"]]){const button=T("button",label,"outline-button");button.type="button";button.dataset.phaseContext=value;button.disabled=!V4O1.valid(row,value);button.setAttribute("aria-pressed",String(which===value));button.addEventListener("click",()=>store.set({seriesPhaseContext:value,seriesRange:"event"}));buttons.append(button);}comparison.append(buttons,T("p","Event Slowdown: O1-B July 7–9 local onset, July 17 exclusive follow-up. Historical Slowdown: original B4 full-period selection. Viewports do not change either episode.","evidence-note"));}
    else comparison.append(T("p","January uses its original selected Candidate B slowdown across the accepted operational search window. It has no separate Beryl O1-B selection.","evidence-note"));
    const wrap=T("div","","chart-wrap"+(large?" expanded-chart":"")),canvas=document.createElement("canvas");canvas.setAttribute("role","img");canvas.setAttribute("aria-label","Traffic Performance Over Time");wrap.append(canvas);
    const message=T("p","Loading traffic history…","curve-status"),jump=T("button","Show Selected Slowdown ↗","text-action phase-jump");jump.type="button";jump.dataset.phaseJump="true";jump.hidden=true;jump.addEventListener("click",()=>store.set({seriesRange:"phase"}));
    host.append(controls,jump,wrap,message);
    if(!large){const expand=T("button","Expand Traffic History ↗","outline-button");expand.type="button";expand.id=inspector?"expandInspectorSeries":"expandSeries";expand.addEventListener("click",()=>{document.getElementById("seriesDialogTitle").textContent="Traffic Performance Over Time";document.getElementById("seriesDialog").showModal();root.v4App.timeSeries.render();});host.append(expand);}
    host.append(comparison,research);
    V4Data.curve(data,row.id).then(original=>{if(!current()||!canvas.isConnected)return;const payload=data.beryl?V4O1.payload(original,row,which):original;
      const chart=V4Charts.draw(canvas,payload,row,{data,range:store.get().seriesRange||"event",phaseValid:valid});chart.options.scales.y.title.text="Speed Ratio";chart.update("none");receive(chart);
      const meta=payload.metadata||{},times=[meta.onset_time,meta.min_time,meta.recovery_end_time].filter(Boolean).map(V4Charts.clock);jump.hidden=!valid||!times.some(t=>t<chart.options.scales.x.min||t>chart.options.scales.x.max);
      research.append(T("p",`Original clock and phase metadata: ${JSON.stringify(meta)}`,"source-fields"),data.beryl&&which==="o1b"?V4O1.phaseCards(row):V4Presentation.phaseCards(data,row,meta));
      research.append(T("p",data.beryl?V4Events.curveNote(row):"Delivered TMC-local timestamps are not converted. Raw/smoothed Q, Q0/reference fallback and selected-phase boundaries remain original. Missing values are gaps; no sustained slowdown is not proof of no impact. Censored endpoints are not confirmed recovery.","evidence-note"));
      message.textContent=`${payload.series.q.filter(Number.isFinite).length.toLocaleString("en-US")} observations · gaps preserved`;
    }).catch(()=>{if(current()){wrap.hidden=true;message.textContent="Traffic history could not be loaded. Summary values remain available.";}});
  }
  function docs(sections,event) {
    const beryl=event==="beryl_2024_07",set=(id,title,paragraphs)=>{const old=sections.find(s=>s[0]===id);if(old){old[1]=title;old[2]=paragraphs;}else sections.push([id,title,paragraphs]);};
    set("quick-start","Quick Start",["Both maps open with Planning — Potential Resilience Score and Observation — Observed Traffic Performance. Layers opens the shared left-side metric panel; its reset restores event-specific defaults without changing the selected road or camera. Both views and the Layers panel are independently collapsible. Legend details expand on request.","Overview contains event/area selection, the only road search and economic summary with Area details. The shared left-side Layers panel uses the existing registry and selection state; the map headers contain no metric selectors. Existing panel resizing and Inspector dragging/resizing remain available."]);
    set("interface","Interface and Information Hierarchy",["Layers is the only map-metric selection workflow. Planning, Observation, Slowdown & Recovery, Mobility Impact and Advanced Analysis preserve all existing layers. A selected road, camera, county and contextual overlays survive metric changes. Event switching resets metrics to valid event-specific defaults.","Default summaries contain values and short status labels. Advanced/Methods retains source identities, raw diagnostics, qualification, missingness, clock continuity, Q0, formulas and provenance. Docs retain complete scientific caveats. Keyboard users can open Layers, navigate metric radio buttons with arrows, expand native details and close the panel with Escape."]);
    set("observed","Observed Traffic Performance — Event-Specific Definitions",["The common UI name is a presentation umbrella, not an identical scientific estimand or cross-event numerical calibration. January reads original Candidate B selected-phase observed_curve_resilience_score_v0, a normalized performance-loss score for the selected sustained decline. It is not event-window mean Q. Its original source eligibility and quantile classes remain unchanged.","Beryl defaults to accepted O1-A primary_qualified_performance_index: one minus mean positive baseline-relative speed-ratio deficit over qualified observed July 7–9 native-local core hours. Exactly 3,097 qualified values retain original G75-D12-G12 qualification, mixed-clock uncertainty and missingness. It is not a complete resilience-and-recovery score.","Beryl O1-B remains secondary event-anchored slowdown and threshold-return evidence in Slowdown & Recovery: 1,464 selected episodes, 943 qualified numeric cases, 707 strong full-continuity cases. Its Slowdown Episode Score is in Advanced Analysis; Minimum Q, Loss Area and Recovery remain in Slowdown & Recovery with their existing gates. Recovery is time to observed threshold return, not infrastructure repair. Historical B4 retains 3,805 full-period scores in Advanced."]);
    set("observation-menu","Observation Layers",["Primary Performance uses event-specific accepted fields: January observed_curve_resilience_score_v0; Beryl o1a.primary_qualified_performance_index. Advanced Analysis preserves Average Speed Loss in Beryl, reading o1a.core_deficit_raw_conditional with the existing primary qualification; no new loss quantity is calculated for January.","Beryl Slowdown & Recovery reads o1b.qualified_observed_return_episode_score, o1b.q_min_smoothed, o1b.raw_observed_row_loss_area and o1b.minimum_to_endpoint_elapsed_hours, all with qualified_return_evidence. January's Minimum Q, Loss Area and Recovery keep their original Candidate B sources. January's Performance Score is the same primary layer, so it is not duplicated as another radio button."]);
    set("compare","Planning and Observation",["Planning Potential and observed traffic measures are different constructs. Differences are not calibrated prediction errors, residuals, or investment recommendations. Neither a common name nor a common palette implies identical equations, event windows, support populations or recovery treatment.","Beryl Impact Focus preserves V5H's 827-member weather/selected-episode screen, including 22 remote rainfall overlaps. Only 485 of those 827 roads have qualified O1-A numeric performance; 342 remain unavailable in the primary performance layer. These differ from the 559 focused O1-B qualified episode values. The existing 943 O1-B total, 3,097 O1-A total and focus population must not be conflated. Common Support is an independent numerical-pairing mask; enabling either mask explicitly turns the other off."]);
    set("curves","Traffic Performance Over Time",["Event Period (January), Hurricane Period (Beryl) and Full History are display viewports only. Original raw Q(t), smoothed arrays, null gaps, Q0 and phase timestamps are read unchanged using the existing chart renderer. January retains its delivered TMC-local labels; Beryl retains the source UTC axis and native-local onset interpretation.","Advanced / Compare Episodes exposes Beryl Event Slowdown (O1-B July 7–9 onset, July 17 exclusive follow-up) and Historical Slowdown (original B4 full-acquisition selection). January retains its original Candidate B selection. Show Selected Slowdown reveals later endpoints without moving analytical boundaries or inventing returns."]);
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
    if(!beryl)set("layers","January Layers and Scientific Aliases",["Observed Traffic Performance reads original January selected-phase Score. Slowdown & Recovery exposes the original Minimum Q, Loss Area and Recovery; Performance Score is the existing primary performance layer. Loss Area is observed-row Q-hours, not monetary loss. Accepted censored scores remain eligible where the original contract allows them; return status remains qualified.","Planning, Storm Exposure, Network Risk, Rainfall, AADT, mobility metrics and experimental temperature keep their original fields, units and classifications. AADT remains a main Planning card. Temperature stays separate from WEATHER_REI. No standalone Average Speed Loss is fabricated for January."]);
  }
  root.V4J=Object.freeze({side,primary,title,status,metric,layers,observationSummary,planning,evidence,docs,methodLink});
})(window);
