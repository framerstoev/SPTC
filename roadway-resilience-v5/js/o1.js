/* Accepted O1-V1 display adapter. No detector, baseline, score or eligibility calculation. */
(function (root) {
  "use strict";
  const statuses = [
    ["observed_clock_supported_onset_and_return", "Strong onset & threshold return", "#247b78"],
    ["row_based_sampling_ambiguous_onset_or_return", "Sampling-ambiguous onset / return", "#d29b35"],
    ["right_censored_incomplete_decline", "Censored · incomplete decline", "#8056a0"],
    ["right_censored_no_supported_return", "Censored · no supported return", "#ad79bb"],
    ["baseline_reference_uncertain", "Baseline-reference uncertain", "#d65c86"],
    ["preexisting_decline_no_eligible_new_onset", "Pre-existing decline · no new onset", "#8e795e"],
    ["no_eligible_sustained_drop_not_proof_of_no_impact", "No eligible decline · not no impact", "#9ba6ae"],
    ["insufficient_full_trajectory_observations", "Insufficient observations", "#d0d5da"],
    ["incomplete_event_onset_confirmation", "Incomplete onset confirmation", "#c86c36"]
  ].map(([value, label, color]) => ({ value, label, color }));
  const status = value => statuses.find(s => s.value === value);
  function metrics(score) {
    const common = { categoryId: "observed", role: "performance", compare: "observed", family: "o1b",
      unit: "index · 0–1", subgroup: "Event-Anchored Decline & Return", direction: "higher = smaller selected-episode deficit", ramp: score,
      population: "943 strong-return cases; 1,464 raw selected episodes", gate: "o1b.qualified_return_evidence",
      note: "Accepted O1-V1 secondary evidence. Native-local onset July 7–9; follow-up July 17 exclusive. Not hurricane causality or physical restoration." };
    return {
      o1a: { ...common, family: "o1a", label: "Event-Core Observed Performance Index", compareLabel: "Score · Event-Core Performance", field: "o1a.primary_qualified_performance_index",
        compareOrder: -3, subgroup: "Event-Core Performance", default: true, gate: "o1a.primary_qualified", range: [0, 1], breaks: [0, .90, .95, .975, .99, 1],
        unit: "Index · 0–1", subtitle: "Supported-hour baseline-relative speed performance · Beryl core",
        direction: "higher = lower positive supported-hour speed deficit", population: "3,097 qualified CS · G75-D12-G12",
        note: "Fixed absolute O1-A classes; distinct from P2 Potential. Supported native-local July 7–9 hours only; not complete resilience. Gray roads lack primary qualification." },
      o1a_deficit: { ...common, family: "o1a", label: "Core Deficit · O1-A", field: "o1a.core_deficit_raw_conditional", compareOrder: -2,
        gate: "o1a.primary_qualified", subgroup: "Event-Core Performance", range: [0, 1], breaks: [0, .01, .025, .05, .10, 1], ramp: [...score].reverse(),
        subtitle: "Positive supported-hour speed deficit · primary-qualified", unit: "deficit fraction · 0–1", direction: "lower = smaller positive deficit",
        population: "3,097 qualified CS", note: "Direct accepted Core Deficit; fixed absolute classes; raw unqualified values are diagnostic only." },
      o1b_score: { ...common, label: "Event-Anchored Episode Score", field: "o1b.qualified_observed_return_episode_score", range: [0, 1], compareOrder: 1, subtitle: "Event-Anchored Decline & Return · qualified secondary Score" },
      o1b_minimum: { ...common, label: "Event-Anchored Minimum Q", field: "o1b.q_min_smoothed", range: [0, 1.5], compareOrder: 2, unit: "Q ratio", subtitle: "Event-Anchored Decline & Return · smoothed minimum" },
      o1b_loss: { ...common, label: "Event-Anchored Loss Area", field: "o1b.raw_observed_row_loss_area", ramp: [...score].reverse(), compareOrder: 3,
        unit: "observed-row Q-hours", direction: "higher = greater observed-row deficit", subtitle: "Event-Anchored Decline & Return · qualified evidence", note: "Sum over observed rows only; not integration across missing elapsed hours and not monetary loss. 943 strong-evidence map values." },
      o1b_return: { ...common, label: "Event-Anchored Threshold Return Time", field: "o1b.minimum_to_endpoint_elapsed_hours", ramp: [...score].reverse(), compareOrder: 4,
        unit: "hours", direction: "minimum to first sustained threshold return", subtitle: "Minimum to first sustained threshold return · hours", note: "943 clock-supported onset/return cases. Censored and ambiguous intervals remain unavailable on this duration map; not physical recovery." },
      o1b_status: { ...common, label: "Event-Anchored Evidence Status", field: "o1b.evidence_status", kind: "category", gate: null,
        compareOrder: 5, categories: statuses, unit: "evidence category", direction: "categorical; no resilience ranking", subtitle: "Event-Anchored Decline & Return · original precedence classes",
        population: "5,763 source classifications", note: "Original accepted precedence classes. Supporting flags can overlap; no eligible decline is not proof of no impact." }
    };
  }
  async function load(rows) {
    const base = "./data/beryl/o1_v1/", m = await V4Data.json(base + "manifest.json");
    if (m.event_id !== "beryl_2024_07" || m.publish_allowed !== false || m.canonical_id_mapping?.count !== 5763) throw Error("Invalid O1-V1 display contract");
    const payload = await V4Data.json(base + "sections.json", document.baseURI, m.file);
    const ids = new Map(rows.map(row => [row.id, row]));
    const seen = new Set();
    for (const record of payload.rows) {
      if (!ids.has(record.id) || seen.has(record.id)) throw Error("O1-V1 CS identity mismatch");
      seen.add(record.id);
      for (const key of ["a", "b"]) {
        if (record[key].length !== payload.columns[key].length) throw Error("O1-V1 field layout mismatch");
        ids.get(record.id)["o1" + key] = Object.fromEntries(payload.columns[key].map((name, i) => [name, record[key][i]]));
      }
    }
    if (seen.size !== 5763 || rows.filter(r => r.o1a.primary_qualified_performance_index !== null).length !== 3097 || rows.filter(r => r.o1b.qualified_observed_return_episode_score !== null).length !== 943) throw Error("O1-V1 support mismatch");
    return m;
  }
  function unavailable(row) {
    const a = row.o1a;
    if (a.primary_qualified) return null;
    if (a.valid_core_Q_count === 0) return { label: "No core Q", color: "#747b83", dash: "1 6" };
    if (a.daily_eligibility_uncertain) return { label: "Mixed-clock qualification uncertain", color: "#967546", dash: "6 3" };
    return { label: a.G75_only_qualified ? "Additional qualification failed" : "Insufficient coverage", color: "#b2b8bd", dash: "3 4" };
  }
  function eventPayload(original, row) {
    const b = row.o1b;
    return { ...original, metadata: { core_start: original.metadata.core_start, core_end: original.metadata.core_end,
      onset_time: b.onset_time_UTC, min_time: b.minimum_time_UTC, recovery_end_time: b.return_or_censor_endpoint_UTC,
      q0: b.baseline_reference_Q0, q0_method: b.baseline_reference_method, method_warning_text: status(b.evidence_status)?.label,
      o1_context: true, followup_exclusive: b.followup_exclusive_UTC_conservative } };
  }
  function docs(sections) {
    const set=(id,title,paragraphs)=>{const old=sections.find(s=>s[0]===id);if(old){old[1]=title;old[2]=paragraphs;}else sections.push([id,title,paragraphs]);};
    set("quick-start","Quick Start",["Beryl opens with Potential Resilience Score in Planning and Event-Core Observed Performance Index (O1-A) in Observation. Use independent view toggles, Layers or map metric dropdowns. Search/click a road for the shared Inspector and Time Series.","O1-B is secondary Event-Anchored Decline & Return evidence. Full-Period Candidate B remains historical/exploratory. January retains its original Candidate B default, scientific values and display behavior."]);
    set("observed","Accepted O1-V1 Observed Evidence",["O1-A Event-Core Observed Performance Index V1: 1 minus mean positive baseline-relative Q deficit over supported finite native-local July 7–9 core hours. Index 0–1, higher means lower positive speed deficit. G75-D12-G12 requires >=75% core support, >=12 observations each assignable day and <=12 consecutive missing expected hours. Exactly 3,097 qualified CSs; raw conditional values on 5,582 supported CSs remain diagnostic outside qualification. Four mixed-clock CSs retain 73-hour union support and daily uncertainty; others use 72 hours.","O1-B Event-Anchored Decline and Threshold-Return Evidence V1 is separately qualified-accepted secondary evidence: onset July 7–9 native local, follow-up July 17 00:00 exclusive. 1,464 selected episodes; 943 strong clock-supported onset/returns; 707 additionally have continuous whole phases. All quantitative secondary maps use the 943 gate. Raw Score, smoothed minimum, observed-row Loss Area and uncertainty remain accessible for selected raw cases.","514 sampling-ambiguous cases, seven raw censored flags and four provisional minima retain original classifications; flags overlap. Evidence Status uses the nine accepted precedence classes, including 4,033 no-eligible-decline cases. No eligible phase does not mean no impact or Score=1; missing is not zero. Censored endpoints are never confirmed return durations.","These are qualified local O1-V1 research products, not a combined resilience score, causal hurricane-damage model or infrastructure restoration measure. O1-A describes supported-hour speed performance, not complete resilience. Missing hours, probe composition and demand affect interpretation; the qualified cohort has more favorable observed-hour performance than lower-coverage roads."]);
    set("compare","Separate Planning and Observation Constructs",["Planning defaults to accepted P2 Potential; Beryl Observation defaults to qualified O1-A. Both use 0–1 values but have different estimands and no numerical calibration. A numeric difference is not prediction error. January Candidate B and O1-A are also not interchangeable.","O1-A map classes are fixed absolute [0, .90, .95, .975, .99, 1], red low to blue high; boundary values belong to the lower interval. County filters do not refit classes or values. Gray/dotted roads lack primary support; brown dashed roads retain mixed-clock uncertainty. Core Deficit is a direct source field with opposite favorable direction.","O1-B Score is secondary on 943 strong cases. Full-Period Candidate B remains available with 3,805 original phases selected over June 17–July 28; only 587 overlap the core. Do not mix O1-B Scores with B4 times or call full-period phase values hurricane-caused losses."]);
    set("curves","Q(t) and Separate Phase Contexts",["Original B4 hourly Q and accepted display-smoothed arrays are reused unchanged and loaded lazily. No Q, baseline, smoothing, phase detection or score is recalculated in the browser. Q=1 is baseline. Missing calendar observations remain gaps.","Event-Anchored Phase and Historical B4 Phase choose separate annotation/card contexts. Event Window shows July 7–9 with nearby visual context; Full Observation retains acquisition through July 28. Jump actions appear only for an existing phase with landmarks outside the current axis. O1-B retains July 17 exclusive follow-up; B4 retains its complete source acquisition.","Onset, smoothed minimum and return/censor endpoint always come from the active phase source. Threshold return means the accepted observational rule, not complete physical restoration. Raw O1-B censored/ambiguous endpoints remain flagged; only strong clock-supported returns receive duration-map colors."]);
    set("coverage","Support and Scientific Limits",["Working/Potential: 5,763; any core Q: 5,582; primary-qualified O1-A: 3,097; unavailable primary O1-A: 2,666; O1-B selected: 1,464; strong: 943; strong/full-continuity: 707; historical B4 phase scores: 3,805. These populations are distinct and flags may overlap.","O1-A primary mean 0.966277 is conditional supported-hour performance, not the resilience of 96.6% of Texas roads. Lower-coverage supported roads have mean conditional deficit 0.069462 versus 0.033723 for the primary cohort. Missing-hour bias remains unknown. No statewide/all-hour, causal, predictive or physical-damage inference is made.","Economic V1, T2A, P2, January, NHC and TxDOT reference routes are unchanged. O1-A/B are not directly numerically calibrated to Potential or January Candidate B. Accepted frozen source fields and source SHA-256s are recorded in the local O1 display mapping manifest."]);
    set("interface","Native V4 Interface",["The existing native V4 shell, Planning/Observation toggles, search, county filters, rail, Inspector, Time Series and economics remain shared. One always-visible Beryl toolbar directly above the two maps holds Map Overlays and Compare on Common Support. No overlay checkbox or control panel remains inside either map. January hides the entire Beryl toolbar.","All Available is the default: Planning Potential supports 5,763 roads and O1-A has 3,097 primary-qualified roads. Compare on Common Support is a display-only intersection of accepted availability flags for the two active numeric metrics in the selected Area. Potential versus O1-A shows n=3,097; O1-B Score shows n=943 on Texas scope. Other roads stay neutral and selectable. Actual n updates with the metric and Area. Categorical Evidence Status disables the numeric support comparison with an explanation.","Both dual maps share the intended center/zoom. Texas View fits the selected roadway Area; Full Track fits accepted NHC geometry. View and extent changes do not change source values, scores or eligibility. Map agreement is not prediction accuracy or numerical calibration."]);
    set("observation-menu","Observation Groups and Score Colors",["The main Beryl dropdown contains six frequent choices in three scientific groups. Primary Performance: Event-Core Performance Index — O1-A (default), Core Deficit — O1-A, Core Mean Q. Event-Anchored Decline & Return: Evidence Status, Threshold Return Time. Historical B4: Full-Period Candidate B Score.","Layers retains all 12 capabilities in these same three groups. Expand Advanced / Details for Event-Anchored Episode Score, Minimum Q and Loss Area, or historical Full-Period Minimum Q, Loss Area and Threshold Return Time. A selected detailed metric also appears in the map dropdown. Source fields and numerical semantics are unchanged.","Beryl Potential, O1-A Index, O1-B Episode Score and historical B4 Score use fixed colors #B2182B, #E87D65, #D49B98, #6FA6CF, #2166AC from low to high score. The midpoint is muted rose, not near-white. Core Deficit reverses this palette so greater deficit remains red. Source breaks, ranks and support remain fixed; categorical evidence, other physical attributes and January retain their own palettes. There is no geographic red override or correlation fitting."]);
    set("version","V5G Local Presentation Review",["V5G organizes the accepted O1-V1 presentation, adds an honest common-support display mask, moves overlays outside the maps and changes only the authorized Beryl score colors. Frozen scientific outputs, all served scientific assets and published January are untouched. This is not a public release or deployment."]);
    const recovery=sections.find(s=>s[0]==="recovery");if(recovery)recovery[1]="Historical B4 Recovery Evidence";
  }
  root.V4O1 = Object.freeze({ statuses, status, metrics, load, unavailable, eventPayload, docs });
})(window);
