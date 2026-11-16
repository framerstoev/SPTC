/* Event-specific language and exploratory display membership; accepted values are read unchanged. */
(function(root){
  "use strict";
  const primary=[["o1b_score","Score"],["o1b_minimum","Minimum Q"],["o1b_loss","Loss Area"],["o1b_return","Recovery"]];
  const labels={observed_clock_supported_onset_and_return:"Detected Slowdown · Threshold Return Observed",row_based_sampling_ambiguous_onset_or_return:"Detected Slowdown · Observation Gap",right_censored_incomplete_decline:"Return Not Confirmed · Incomplete Decline",right_censored_no_supported_return:"Return Not Confirmed · No Supported Return",baseline_reference_uncertain:"Detected Slowdown · Reference Uncertain",preexisting_decline_no_eligible_new_onset:"Earlier Slowdown · No New Event Onset",no_eligible_sustained_drop_not_proof_of_no_impact:"No Eligible Slowdown Detected",insufficient_full_trajectory_observations:"Limited Traffic Data",incomplete_event_onset_confirmation:"Slowdown Evidence Incomplete"};
  const status=row=>labels[row.o1b.evidence_status]||"Observation Unavailable";
  const T=(...a)=>V4Inspector.text(...a),fmt=(n,d=3)=>V4Core.format(n,{digits:d});
  async function loadFocus(rows){
    const base="./data/beryl/impact_focus/",m=await V4Data.json(base+"manifest.json");
    if(m.rule_version!=="BERYL_V5H_WEATHER25_SELECTED_EPISODE_DISPLAY_V1"||!m.gate?.passed||m.publish_allowed!==false)throw Error("Invalid exploratory focus contract");
    const payload=await V4Data.json(base+"sections.json",document.baseURI,m.file),byId=new Map(rows.map(r=>[r.id,r])),seen=new Set();
    for(const f of payload.rows){const row=byId.get(f.id);if(!row||seen.has(f.id)||f.selected_episode!==row.o1b.selected_episode||f.qualified_return_evidence!==row.o1b.qualified_return_evidence||f.focus!==(f.weather_screen&&f.selected_episode))throw Error("Focus source membership mismatch");seen.add(f.id);row.impactFocus=f;}
    if(seen.size!==5763)throw Error("Incomplete exploratory focus domain");return m;
  }
  function focusCounts(data,store){
    const s=store.get(),rows=data.rows.filter(r=>s.area==="texas"||r.county_fips===s.area),focus=rows.filter(r=>r.impactFocus.focus),metric=V4Core.metrics[s.observedLayer];
    return {focus:focus.length,numeric:focus.filter(r=>V4Metrics.mapRaw(r,metric)!==null).length,source:rows.length};
  }
  function syncFocus(data,store){
    if(!data.beryl)return;const s=store.get(),n=focusCounts(data,store);document.getElementById("impactFocus").checked=s.impactFocus;
    document.getElementById("focusSummary").textContent=s.impactFocus?`${n.focus.toLocaleString("en-US")} highlighted roads` : "All roads";
    document.getElementById("displayModeNotice").textContent=s.displayModeNotice||"";

  }
  function card(label,value,unit,id){const node=V4Inspector.card(label,value,unit);if(id)node.dataset.displayField=id;return node;}
  function observationSummary(host,row){
    const b=row.o1b,a=row.o1a,grid=T("div","","metric-pair road-summary");host.append(T("h3","Observed Slowdown","evidence-heading"));
    grid.append(card("Slowdown Score",b.qualified_observed_return_episode_score,"0–1 · higher = smaller selected slowdown","score"),
      card("Lowest Speed Ratio",b.qualified_return_evidence?b.q_min_smoothed:null,"Smoothed speed ratio · baseline = 1","minimum"),
      card("Total Observed Slowdown",b.qualified_return_evidence?b.raw_observed_row_loss_area:null,"Observed-row speed-deficit units · not money","loss"));
    const returned=card("Time to Threshold Return",b.qualified_return_evidence?b.minimum_to_endpoint_elapsed_hours:null,"Hours from minimum to observed threshold return","return");
    if(!b.qualified_return_evidence)returned.querySelector("strong").textContent="Return Not Confirmed";
    grid.append(returned);host.append(grid,T("p",status(row),"phase-chip"));
    host.append(T("p",`Data Available: ${fmt(a.valid_core_Q_count,0)} / ${fmt(a.expected_core_hour_count,0)} core hours; ${fmt(b.full_supported_Q_hours,0)} full-history observations. Missing observations remain gaps.`,"evidence-note"));
    host.append(card("Traffic Performance",a.primary_qualified_performance_index,"Separate supported-hour core measure · 0–1","performance"));
    host.append(T("p","Selected event slowdown evidence; not a whole-road rating, physical repair time or proof of hurricane causality. No eligible slowdown does not prove no impact.","evidence-note"));
    host.append(T("p",row.impactFocus.focus?"In exploratory Impact Focus: period weather screen + selected event slowdown.":"Outside exploratory Impact Focus; this does not mean unaffected.","evidence-note"));
  }
  function planning(data,row,host){
    host.append(T("h3","Planning Context","evidence-heading"));const grid=T("div","","metric-pair planning-main");
    for(const [key,label] of [["potential","Planning Score"],["weather","Storm Exposure"],["network","Network Risk"],["aadt_context","Annual Average Daily Traffic"],["precipitation","Rainfall"],["gust","Peak Wind Gust"]]){
      const node=V4Presentation.metricCard(data,row,key);node.querySelector("span").textContent=label;
      if(key==="aadt_context"){const value=data.networkContext?.[row.id]?.AADT_CS;node.querySelector("strong").textContent=fmt(value,0);node.querySelector("small").textContent="vehicles/day · fixed inventory reference";node.dataset.aadtValue=value==null?"":String(value);}
      grid.append(node);
    }
    host.append(grid,T("p","AADT uses mixed 2001–2024 inventory source years; per-road source year was not retained. It is a fixed network-planning reference, not vehicles actually observed during Beryl. Economic expected-demand inputs have separate provenance.","evidence-note"));
    host.append(T("p","Storm Exposure is the accepted Planning rain/gust index. The exploratory Impact Focus uses a separate fixed weather-plus-slowdown screen.","evidence-note"));
    const details=T("details","","planning-details");details.append(T("summary","How Planning Score Is Calculated"));const fields=T("div","","metric-pair");
    for(const key of ["normalized_precipitation","normalized_gust","consequence","redundancy","network","planning_risk"])fields.append(V4Presentation.metricCard(data,row,key));
    details.append(fields,T("p","Accepted P2: H = .50P + .50G; Risk = .65H + .35NETRISK_LITE; Potential = 1 − Risk. Tier 2 Consequence = .40 normalized endpoint connectivity + .60 normalized log AADT; Network Risk = .60 Consequence + .40(1 − Redundancy). Redundancy = .50 alternative length + .20 alternative count + .30 alternative routes in original normalized units. Original statewide normalization and weights are unchanged. AADT is not added again as a direct P2 term.","evidence-note"));host.append(details);
  }
  function evidence(data,store,host,row,large,current,receive,rerender,inspector){
    host.replaceChildren();if(!row){host.append(T("h2","Choose a roadway","module-title"),T("p","Select a road to explore its observed traffic history.","panel-lead"));return;}
    if(inspector)observationSummary(host,row);
    if(!large)host.append(T(inspector?"h3":"h2","Traffic Performance Over Time",inspector?"evidence-heading":"module-title"));
    host.append(T("p",`CS_${row.id} · ${row.county_name} County · UTC observations`,"curve-status"));
    const which=V4O1.context(store),valid=V4O1.valid(row,which);
    host.append(T("p",which==="o1b"?"Event Slowdown":"Historical Slowdown","phase-chip"));
    const research=T("details","","research-details");research.append(T("summary","Advanced / Methods and Evidence"));
    V4O1.summary(research,row);const core=T("div","","metric-pair");for(const key of ["observed","core_minimum","coverage"])core.append(V4Presentation.metricCard(data,row,key));research.append(core);
    if(!row.has_curve){host.append(T("p","Limited Traffic Data · no supported curve. Unavailable evidence is not zero resilience.","evidence-note"),research);return;}
    const controls=T("div","","series-ranges");
    for(const [value,label] of [["event","Hurricane Period"],["full","Full History"]]){const button=T("button",label,"outline-button");button.type="button";button.dataset.seriesRange=value;button.setAttribute("aria-pressed",String(store.get().seriesRange===value));button.addEventListener("click",()=>store.set({seriesRange:value}));controls.append(button);}
    const comparison=T("details","","episode-comparison");comparison.append(T("summary","Advanced / Compare Episodes"));const episodeButtons=T("div","","series-ranges");
    for(const [value,label] of [["o1b","Event Slowdown"],["b4","Historical Slowdown"]]){const button=T("button",label,"outline-button");button.type="button";button.dataset.phaseContext=value;button.disabled=!V4O1.valid(row,value);button.setAttribute("aria-pressed",String(which===value));button.addEventListener("click",()=>store.set({seriesPhaseContext:value,seriesRange:"event"}));episodeButtons.append(button);}
    comparison.append(episodeButtons,T("p","Event Slowdown uses accepted July 7–9 onset and July 17 exclusive follow-up. Historical Slowdown is the original full-acquisition selection. Display ranges do not change either selected episode.","evidence-note"));
    const wrap=T("div","","chart-wrap"+(large?" expanded-chart":"")),canvas=document.createElement("canvas");canvas.setAttribute("role","img");canvas.setAttribute("aria-label","Traffic Performance Over Time");wrap.append(canvas);
    const legend=T("p","Observed speed ratio · smoothed speed ratio · baseline = 1 · event period. Selected slowdown/minimum/return or censor markers retain source evidence.","evidence-note");
    const message=T("p","Loading traffic history…","curve-status"),jump=T("button","Show Selected Slowdown ↗","text-action phase-jump");jump.type="button";jump.dataset.phaseJump="true";jump.hidden=true;jump.addEventListener("click",()=>store.set({seriesRange:"phase"}));
    host.append(controls,jump,legend,wrap,message);
    if(!large){const expand=T("button","Expand Traffic History ↗","outline-button");expand.type="button";expand.id=inspector?"expandInspectorSeries":"expandSeries";expand.addEventListener("click",()=>{document.getElementById("seriesDialogTitle").textContent="Traffic Performance Over Time";document.getElementById("seriesDialog").showModal();root.v4App.timeSeries.render();});host.append(expand);}
    host.append(comparison,research);
    V4Data.curve(data,row.id).then(original=>{
      if(!current()||!canvas.isConnected)return;const payload=V4O1.payload(original,row,which),chart=V4Charts.draw(canvas,payload,row,{data,range:store.get().seriesRange||"event",phaseValid:valid});chart.options.scales.y.title.text="Speed Ratio";chart.update("none");receive(chart);
      const meta=payload.metadata||{},times=[meta.onset_time,meta.min_time,meta.recovery_end_time].filter(Boolean).map(V4Charts.clock);jump.hidden=!valid||!times.some(time=>time<chart.options.scales.x.min||time>chart.options.scales.x.max);
      research.append(T("p",which==="o1b"?"Active episode source: accepted O1-B, July 17 exclusive follow-up; right-censored/ambiguous endpoints are not confirmed recovery.":V4Events.curveNote(row),"evidence-note"));
      research.append(T("p",`Onset: ${meta.onset_time||"Unavailable"}; minimum: ${meta.min_time||"Unavailable"}; endpoint: ${meta.recovery_end_time||"Unavailable"}. Baseline reference: ${meta.q0_method||"Unavailable"}. ${meta.method_warning_text||""}`,"evidence-note"),which==="o1b"?V4O1.phaseCards(row):V4Presentation.phaseCards(data,row,meta));
      message.textContent=`${payload.series.q.filter(Number.isFinite).length.toLocaleString("en-US")} observed values; missing hours remain gaps. Use Show Selected Slowdown for later returns outside this display.`;
    }).catch(()=>{if(current()){wrap.hidden=true;message.textContent="Traffic history could not be loaded; source summaries remain available.";}});
  }
  function docs(sections){
    const set=(id,title,paragraphs)=>{const old=sections.find(s=>s[0]===id);if(old){old[1]=title;old[2]=paragraphs;}else sections.push([id,title,paragraphs]);};
    set("quick-start","Quick Start",["Beryl Observation has four familiar primary choices: Score, Minimum Q, Loss Area, Recovery. All use accepted event-anchored O1-B fields with the existing 943 strong-evidence numeric display gate. Score is the UI default; its accepted scientific classification remains secondary episode evidence, not a newly accepted complete resilience measure.","Beryl Impact Focus starts ON: highlight independent period-weather exposure plus an accepted selected event slowdown. All other roads stay visible and selectable. Turn it OFF for full-source metric support. Common Support is a different numerical-eligibility comparison; the two masks are mutually exclusive and the notice explains the active mode."]);
    set("observation-menu","Observation and Additional Traffic Analysis",["The primary four labels reuse January's control structure but not its source episodes. Beryl: o1b.qualified_observed_return_episode_score; q_min_smoothed; raw_observed_row_loss_area; minimum_to_endpoint_elapsed_hours, all under qualified_return_evidence. The 1,464 selected episodes are not promoted to 943-style qualified values. Censored or sampling-ambiguous returns are not confirmed recovery.","Layers → Additional Traffic Analysis exposes Traffic Performance (accepted O1-A primary_qualified_performance_index, 3,097), Average Speed Loss (accepted core_deficit_raw_conditional, primary display gate), Core Average Speed Ratio and Slowdown Evidence. Advanced / Research retains original full-history B4 Score, Minimum Q, Loss Area and threshold-return evidence. Selecting an additional layer shows its own label; it does not add a fifth primary selector option.","Beryl Score colors and all metric-specific breaks retain V5G behavior. January keeps its original Candidate B data, four options, palettes and formulas. No combined score or cross-event calibration is created."]);
    set("compare","Separate Scientific Constructs",["Beryl's default Score describes a selected event-anchored slowdown. O1-A Traffic Performance separately summarizes supported-hour positive speed deficits; P2 Planning combines realized weather and fixed network context. These are different estimands, with no numerical calibration or prediction-error interpretation.","Impact Focus screens period weather plus selected slowdown, including uncertain/censored episodes. Common Support instead matches accepted numerical availability for the two active metrics. Enabling either turns the other off explicitly. Neither changes accepted values, source domains, ranks, phases or eligibility."]);
    set("impact-focus","Exploratory Beryl Impact Focus",["Fixed independent weather rule: accepted ERA5 maximum line-mean gust >=25 m/s OR at least one PRISM source-day line-mean rainfall >=25 mm. Weather bounds are July 6 12Z to July 10 12Z; PRISM July 7–10 labels are 12 UTC-ending source days. Gust is the accepted preceding-hour maximum at original interval ends. No hourly PRISM allocation, arbitrary track buffer, P2/traffic/economic score or desired geographic color enters the weather screen.","1,158 pass gust, 2,071 pass rain, 2,135 pass their union. Four exclusive display cohorts: weather + selected event slowdown 827; weather only 1,308; slowdown only 637; neither demonstrated 2,991. They sum to 5,763. Of 827 focus roads, 559 have qualified numerical Episode Scores and 268 retain detected but unqualified episode evidence. These are separate denominators.","Twenty-two overlap roads are more than 300 km from the available NHC track line, including western rain-screen cases. All are retained under the fixed rule. Period rainfall may be unrelated to Beryl; this is co-occurrence screening, not certified causal hurricane impact or physical damage. Neither demonstrated is not unaffected. NHC radii are temporally incomplete; missing intersection is not proof of no wind. ERA5 gust is not NHC sustained-wind category."]);
    set("planning-volume","AADT and Network Criticality",["Annual Average Daily Traffic remains a main Planning metric in vehicles/day, read from the accepted fixed network AADT_CS. Source inventory years span 2001–2024; per-CS years were not retained. This is not actual traffic observed during July 2024 Beryl, and economic expected-demand profiles have separate provenance.","Accepted Consequence = .40 normalized endpoint connectivity + .60 normalized log AADT. Redundancy = .50 normalized alternative length + .20 alternative count + .30 alternative routes; Network Risk = .60 Consequence + .40(1 − Redundancy). P2 H=.50P+.50G; Risk=.65H+.35NETRISK_LITE; Potential=1−Risk. Original normalization and source values are read unchanged; AADT is not added again to P2."]);
    set("curves","Traffic Performance Over Time",["Hurricane Period and Full History change only the chart viewport. Original B4 raw Q(t), six-observed-row display smoothing, calendar null gaps and 1009 original slots are reused unchanged. Accepted O1-B onset July 7–9 native local and follow-up July 17 exclusive are not recalculated or shortened by the display. Show Selected Slowdown reveals accepted later returns beyond the default core context.","Advanced / Compare Episodes switches Event Slowdown (accepted O1-B selection) and Historical Slowdown (original full-period B4). Separate source markers, timestamps, Score/phase cards and censor qualifications remain in Advanced / Methods and Evidence. Threshold return is observational evidence, not physical road repair or complete recovery."]);
    set("version","V5H Local Presentation Review",["This phase changes display defaults, language and an explicitly exploratory focus mask only. It does not amend O1/P2/economic acceptance, recompute any score or publish data. Original B4/B5/January, frozen research, AADT inputs and economic totals remain unchanged."]);
  }
  root.V4H=Object.freeze({primary,labels,status,loadFocus,focusCounts,syncFocus,planning,observationSummary,evidence,docs});
})(window);
