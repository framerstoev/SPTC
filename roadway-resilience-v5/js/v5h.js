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
  function planning(data, row, host) {
    host.append(T("h3", "Planning Context", "evidence-heading"));
    const grid = T("div", "", "metric-pair planning-main");
    for (const key of ["weather","network","aadt_context","precipitation","gust"]) {
      const node = V4Presentation.metricCard(data, row, key);
      if (key === "aadt_context") {
        const value = data.networkContext?.[row.id]?.AADT_CS;
        node.querySelector("strong").textContent = fmt(value, 0);
        node.querySelector("small").textContent = "vehicles/day";
        node.dataset.aadtValue = value == null ? "" : String(value);
      }
      grid.append(node);
    }
    host.append(grid, root.V5R.docLink(data,"Planning methods", "planning"));
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
  root.V4H=Object.freeze({primary,labels,status,loadFocus,focusCounts,syncFocus,planning,docs});
})(window);
