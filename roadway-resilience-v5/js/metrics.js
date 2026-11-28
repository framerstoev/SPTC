/* Single presentation registry. No scientific values or normalizations are computed. */
(function (root) {
  "use strict";
  const categories = [
    ["planning", "Planning / Potential"], ["hazard", "Tier 1 — Hazard Exposure"],
    ["network", "Tier 2 — Network Context"], ["observed", "Tier 3 — Observed Performance"],
    ["impact", "Mobility Impact"], ["support", "Data Support & Additional Context"]
  ].map(([id, label]) => ({ id, label }));
  const score = ["#b2182b", "#ef8a62", "#f7f7f7", "#67a9cf", "#2166ac"];
  const berylScore = ["#B2182B", "#E87D65", "#D49B98", "#6FA6CF", "#2166AC"];
  const observationGroups = [
    { label: "Additional Traffic Analysis", keys: ["o1a", "observed", "o1b_status"], advanced: [] },
    { label: "Advanced / Research", keys: [], advanced: ["phase_score", "minimum", "loss", "recovery"] }
  ];
  const risk = ["#edf3ed", "#c4d5c2", "#9caf8e", "#c1a569", "#aa7543"];
  const support = ["#eff4f2", "#c9dcd6", "#9ebeb5", "#628f86", "#235e58"];
  const phaseNote = "Selected dominant phase over the full observation period; not necessarily hurricane-induced.";
  const common = {
    potential: { label: "Potential Resilience Score", compareLabel: "Score", categoryId: "planning", role: "planning", unit: "index · 0–1", direction: "higher = lower combined planning concern", range: [0, 1], ramp: score, compare: "planning", compareOrder: 0, default: true },
    weather: { categoryId: "hazard", role: "hazard", unit: "index · 0–1", direction: "higher = greater hazard concern", range: [0, 1], ramp: risk, compare: "planning", compareOrder: 1 },
    network: { label: "Network Risk", field: "NETRISK_LITE", categoryId: "network", role: "planning", unit: "index · 0–1", subtitle: "NETWORK_REI / NETRISK_LITE · original statewide reference", direction: "higher = greater network concern", range: [0, 1], ramp: risk, compare: "planning", compareOrder: 2, compareLabel: "Tier 2 — Network Risk", note: "Original 10,029-CS normalization; fixed network-planning concern, not observed event impact." },
    minimum: { label: "Minimum Q", cardLabel: "Minimum Q", categoryId: "observed", role: "phase", unit: "Q ratio", subtitle: "Selected phase minimum · Q ratio", direction: "higher = smaller selected-phase speed loss", range: [0, 1.5], ramp: score, compare: "observed", requiresPhase: true },
    loss: { label: "Loss Area", cardLabel: "Loss Area", categoryId: "observed", role: "phase", unit: "observed-row Q-hours", subtitle: "Selected phase · observed-row Q-hours", direction: "higher = greater observed-row deficit", ramp: risk, compare: "observed", requiresPhase: true, note: "Source sums observed-row deficits; no integration across missing elapsed hours. Not monetary loss." },
    recovery: { label: "Recovery", cardLabel: "Recovery", categoryId: "observed", role: "phase", unit: "hours", subtitle: "Threshold-return / censor endpoint interval · qualified evidence", direction: "elapsed interval, conditional on endpoint evidence", ramp: risk, compare: "observed", requiresPhase: true, note: "Stored minimum-to-endpoint interval: threshold return, sampling-ambiguous return or last observation if censored. Not confirmed physical recovery." },
    vehicle_delay: { label: "Vehicle Delay Hours", field: "total_vehicle_delay_hours", categoryId: "impact", role: "economic", unit: "vehicle-hours", direction: "higher = greater conditional delay burden", ramp: risk, note: "Frozen expected-demand positive excess travel-time accounting; missing support remains unavailable." },
    mobility_cost: { label: "Expected-Demand Mobility Delay Cost", field: "expected_demand_mobility_delay_cost_2024usd", categoryId: "impact", role: "economic", unit: "2024 USD", direction: "higher = greater conditional delay cost", ramp: risk, money: true, note: "Conditional expected-demand delay valuation; not total economic loss causally attributable to the event." }
  };
  const january = {
    potential: { field: "Potential_Resilience_Score", subtitle: "Accepted January planning representation", note: "Accepted January robust-normalized, direction-reversed planning measure; not predicted traffic performance." },
    weather: { label: "Weather Exposure", field: "WEATHER_REI", subtitle: "WEATHER_REI · precipitation and pavement context", compareLabel: "Tier 1 — Weather Exposure", note: "Precipitation-based, pavement-adjusted exposure. Temperature remains separate." },
    network: {},
    observed: { label: "Observed Resilience Score", cardLabel: "Score", field: "observed_curve_resilience_score_v0", categoryId: "observed", role: "phase", unit: "index · 0–1", subtitle: "Accepted Candidate B selected-phase score", direction: "higher = smaller normalized selected-phase deficit", quantile: true, ramp: score, compare: "observed", compareOrder: 0, compareLabel: "Score", default: true, requiresPhase: true, note: "Original supported event-sample quantiles and score eligibility retained, including eligible censored scores." },
    minimum: { field: "q_min", compareOrder: 1, note: "Minimum smoothed Q in the accepted selected dominant phase." },
    loss: { field: "resilience_loss_area", compareOrder: 2 },
    recovery: { field: "recovery_duration_hours", compareOrder: 3 },
    vehicle_delay: {}, mobility_cost: {},
    q_support: { label: "Observed Q(t) Support", field: "has_curve", categoryId: "support", role: "support", kind: "boolean", unit: "available / unavailable · source flag", subtitle: "Existing curve-availability flag · not a coverage ratio", direction: "source availability only", range: [0, 1], ramp: support, note: "Existing January has_curve flag; no January coverage fraction is fabricated." },
    temp_min: { label: "Minimum Daily Tmin", temp: "minimum_daily_buffer_mean_tmin_c", categoryId: "support", subgroup: "Additional Weather Context", role: "context", unit: "°C", subtitle: "Experimental PRISM · daily buffer means", direction: "physical temperature", ramp: ["#344e86", "#6084a4", "#adc6cd", "#dfd4b8", "#c28c60"], note: "Minimum of daily buffer-mean air Tmin; not pavement temperature or the absolute road minimum." },
    temp_tmin_days: { label: "Tmin < 0°C Days", temp: "tmin_below_zero_days", categoryId: "support", subgroup: "Additional Weather Context", role: "context", unit: "PRISM days", subtitle: "Experimental PRISM · daily buffer means", direction: "count of source days", ramp: ["#e7eff0", "#bcd0d4", "#81a4b5", "#537c9a", "#2f5478"], note: "Count of days with buffer-mean Tmin below zero; not freezing hours or confirmed icing." },
    temp_tmax_days: { label: "Tmax < 0°C Days", temp: "tmax_below_zero_days", categoryId: "support", subgroup: "Additional Weather Context", role: "context", unit: "PRISM days", subtitle: "Experimental PRISM · daily buffer means", direction: "count of source days", ramp: ["#e7eff0", "#bcd0d4", "#81a4b5", "#537c9a", "#2f5478"], note: "Count of days with buffer-mean Tmax below zero; does not establish road icing." },
    precipitation_context: { label: "Six-Day Precipitation", field: "P_SUM6", categoryId: "hazard", role: "context", unit: "mm · Jan 22–27 labels", explore: false },
    aadt_context: { label: "AADT", field: "AADT_CS", categoryId: "network", role: "context", unit: "vehicles/day", explore: false },
    consequence: { label: "Network Consequence", contextField: "CONSEQ_LITE", categoryId: "network", role: "context", unit: "original index · 0–1", explore: false },
    redundancy: { label: "Network Redundancy", contextField: "REDUND_LITE", categoryId: "network", role: "context", unit: "original index · 0–1", explore: false }
  };
  const beryl = {
    potential: { field: "beryl_potential_resilience", subtitle: "Retrospective hurricane planning screen", note: "Accepted P2 output, read unchanged. Higher means lower combined concern; no final stretching or prospective prediction." },
    weather: { label: "Hurricane Hazard Screen", field: "beryl_hazard_screen", subtitle: "Relative rain/gust component · index 0–1", compareLabel: "Tier 1 — Hurricane Hazard", note: "Accepted equal-weight normalized rain/gust screen; not January WEATHER_REI or calibrated physical damage." },
    precipitation: { label: "Accumulated Precipitation", field: "prism_primary_accum_mm", categoryId: "hazard", role: "hazard", unit: "mm", subtitle: "PRISM · mm · 96-hour source window", direction: "physical accumulation", ramp: risk, note: "Four 12 UTC-ending PRISM days, July 7–10 labels; not an hourly rainfall series." },
    wind: { label: "Maximum Modeled Wind", field: "era5_max_wind_mps", categoryId: "hazard", role: "hazard", unit: "m/s", subtitle: "ERA5 · hourly CS line means", direction: "modeled exposure", ramp: risk, note: "Maximum hourly CS line-mean modeled wind on the accepted ERA5 grid; not a road closure threshold." },
    gust: { label: "Maximum Modeled Gust", field: "era5_max_gust_mps", categoryId: "hazard", role: "hazard", unit: "m/s", subtitle: "ERA5 · preceding-hour gust intervals", direction: "modeled exposure", ramp: risk, note: "Maximum CS line-mean modeled gust, retaining source interval-end semantics; resolution differs from PRISM." },
    track_distance: { label: "NHC Track Distance", field: "nhc_min_track_line_distance_km", categoryId: "hazard", role: "hazard", unit: "km", subtitle: "Approximate accepted track-line distance", direction: "geographic distance, not impact severity", ramp: risk, note: "Distance to original track lines, not timed closest approach or road wind." },
    network: {},
    observed: { label: "Core Mean Q", field: "core_mean_q", categoryId: "observed", role: "performance", unit: "Q ratio", subtitle: "July 7–9 native-local event core · primary", direction: "Q=1 baseline; higher = greater relative speed", range: [0, 1.5], breaks: [0, .9, .97, 1.03, 1.1, 1.5], ramp: score, baseline: 1, compare: "observed", compareOrder: 0, default: true, note: "Mean supported core Q. Q=1 is baseline performance; this is not the selected-phase Score." },
    phase_score: { label: "Observed Resilience Score", compareLabel: "Score", cardLabel: "Score", field: "candidate_b.observed_curve_resilience_score_v0", categoryId: "observed", role: "phase", unit: "index · 0–1", subtitle: "Candidate B · selected full-period phase", direction: "higher = smaller normalized selected-phase deficit", range: [0, 1], ramp: score, compare: "observed", compareOrder: -1, default: true, requiresPhase: true, note: "3,805 valid six-week selected-phase scores; only 587 overlap the native hurricane core. Not independently calibrated hurricane-specific impacts." },
    minimum: { field: "candidate_b.q_min", compareOrder: 2, note: phaseNote },
    loss: { field: "candidate_b.resilience_loss_area", compareOrder: 3 },
    recovery: { field: "candidate_b.recovery_duration_hours", compareOrder: 4 },
    vehicle_delay: {}, mobility_cost: {},
    coverage: { label: "Core Observation Coverage", field: "core_Q_coverage_fraction", categoryId: "support", role: "support", unit: "fraction · 0–1", subtitle: "Data availability · native-core clock-hour support", direction: "higher = more observed support, not resilience", range: [0, 1], ramp: support, note: "Observed native-core bins / expected union. A support measure, not an observed-performance outcome." },
    core_minimum: { label: "Core-Window Minimum Q", field: "core_minimum_q", categoryId: "observed", role: "performance", unit: "raw core Q ratio", subtitle: "Core-window raw minimum · distinct from selected smoothed minimum", explore: false },
    consequence: { label: "Consequence", field: "CONSEQ_LITE", categoryId: "network", role: "context", unit: "original Tier 2", explore: false },
    redundancy: { label: "Redundancy", field: "REDUND_LITE", categoryId: "network", role: "context", unit: "original Tier 2", explore: false },
    planning_risk: { label: "Planning Risk", field: "beryl_planning_risk", categoryId: "planning", role: "planning", unit: "concern · 0–1", explore: false },
    phase_evidence: { label: "Phase Evidence", field: "candidate_b.recovery_evidence_class", categoryId: "support", role: "support", kind: "category", unit: "source classification", explore: false },
    normalized_precipitation: {label:"Normalized Precipitation",field:"normalized_precipitation",categoryId:"hazard",role:"context",unit:"accepted P · 0–1",explore:false},
    normalized_gust: {label:"Normalized Gust",field:"normalized_gust",categoryId:"hazard",role:"context",unit:"accepted G · 0–1",explore:false},
    aadt_context: {label:"AADT · fixed network snapshot",contextField:"AADT_CS",categoryId:"network",role:"context",unit:"vehicles/day · mixed source years",explore:false}
  };
  function forEvent(eventId) {
    const isBeryl = eventId === "beryl_2024_07", entries = isBeryl ? { ...beryl, ...root.V4O1.metrics(score) } : january;
    return Object.fromEntries(Object.entries(entries).filter(([key]) => key !== "o1a_deficit").map(([key, item]) => {
      const metric = { key, eventId, available: true, nullSemantics: "Unavailable source support; genuine zero remains zero", population: isBeryl ? "Beryl 5,763-CS working domain; support varies by field" : "January 10,029-CS planning catalog; observed/economic support varies", ...common[key], ...item };
      if (isBeryl && key === "observed") { metric.default = false; metric.subtitle = "July 7–9 native-local core · Q=1 baseline"; }
      if (isBeryl && key === "observed") metric.subtitle = "Beryl event-core traffic performance · Q ratio";
      if (isBeryl && key === "phase_score") {
        metric.default = false; metric.label = "Full-Period Candidate B Score"; metric.compareLabel = "Full-Period Candidate B";
        metric.subtitle = "Selected dominant phase · June 17–July 28 observation period";
      }
      if (isBeryl && key === "recovery") {
        metric.subtitle="Threshold Return Time · hours";
        metric.ramp=["#eff3ff","#bdd7e7","#6baed6","#3182bd","#08519c"];
        metric.note="Clock-supported sustained threshold returns only. Phase may contain gaps. Not physical recovery; other endpoint evidence remains in details.";
        metric.mapEvidence="clock_supported_return";
      }
      if (isBeryl) {
        const group = observationGroups.find(group=>[...group.keys,...group.advanced].includes(key));
        if(group){metric.observationGroup=group.label;metric.advanced=group.advanced.includes(key);metric.subgroup=group.label;}
        if(key==="o1a")metric.compareLabel="Event-Core Performance Index — O1-A";
        if(key==="phase_score")metric.compareLabel="Full-Period Candidate B Score";
        const historicalLabels={minimum:"Full-Period Minimum Q",loss:"Full-Period Loss Area",recovery:"Full-Period Threshold Return Time"};
        if(historicalLabels[key]){metric.label=historicalLabels[key];metric.cardLabel=historicalLabels[key];}
        if(["potential","o1a","o1b_score","phase_score"].includes(key)){
          metric.ramp=[...berylScore];metric.note += " Fixed rose-centered Beryl score palette; source values and class boundaries unchanged.";
        }
        const names={o1a:"Traffic Performance",observed:"Core Average Speed Ratio",o1b_status:"Slowdown Evidence",phase_score:"Original Full-History Score",o1b_score:"Slowdown Score",o1b_minimum:"Lowest Speed Ratio",o1b_loss:"Total Observed Slowdown",o1b_return:"Time to observed threshold return"};
        if(names[key])metric.label=names[key];
        if(key==="o1a")metric.default=false;
        if(key==="o1b_score")metric.default=true;
        if(key==="o1b_return")metric.note="Time from selected minimum to observed threshold return; hours. Only qualified evidence is colored. Not infrastructure repair time or complete recovery.";
        if(key==="o1b_status")metric.categories=metric.categories.map(c=>({...c,label:root.V4H.labels[c.value]}));
      }
      metric.group = categories.find(c => c.id === metric.categoryId).label;
      metric.subtitle ||= metric.unit;
      metric.note ||= metric.role === "phase" ? phaseNote : metric.subtitle;
      if (metric.role === "phase") metric.population = isBeryl ? "3,805 valid full-period selected phases; 587 overlap native core" : "3,473 valid selected-phase scores within 3,842 observed-curve sections";
      if (isBeryl && metric.key === "observed") metric.population = "5,582 core-Q-supported sections of the 5,763-CS study domain";
      root.V4J.metric(metric,isBeryl);
      return [key, metric];
    }));
  }
  function layers(eventId) { const metrics = forEvent(eventId); return categories.map(category => ({ ...category, metrics: Object.values(metrics).filter(m => m.categoryId === category.id && m.explore !== false) })); }
  function compare(eventId, side) { return Object.values(forEvent(eventId)).filter(m => m.compare === side).sort((a, b) => a.compareOrder - b.compareOrder); }
  function phaseKeys(eventId) { return ["minimum", "loss", "recovery", eventId === "beryl_2024_07" ? "phase_score" : "observed"]; }
  function defaults(eventId) { const planning=compare(eventId,"planning").find(metric=>metric.default).key,observed=compare(eventId,"observed").find(metric=>metric.default).key;return {layer:planning,planningLayer:planning,observedLayer:observed}; }
  function raw(row, metric, windowId = "legacy_labels") {
    if (!row) return null;
    if (metric.gate && metric.gate.split(".").reduce((v, key) => v?.[key], row) !== true) return null;
    if (metric.requiresPhase && row.event_id === "beryl_2024_07" && !row.candidate_b?.valid) return null;
    if (metric.key === "observed" && metric.quantile && (!row.has_curve || row.status === "no_sustained_drop")) return null;
    const value = metric.temp ? row.temperature?.[windowId]?.[metric.temp] : metric.field?.split(".").reduce((v, key) => v?.[key], row);
    return metric.kind === "boolean" ? (typeof value === "boolean" ? Number(value) : null) : value ?? null;
  }
  function docs(eventId) { return layers(eventId).map(group => `${group.label}: ${group.metrics.map(m => `${m.label} (${m.subtitle})`).join("; ")}.`); }
  function recoverySupported(row){return Boolean(row?.candidate_b?.valid&&row.observed_threshold_return_evidence===true&&row.candidate_b.recovery_evidence_class==="observed_sustained_threshold_return");}
  function mapRaw(row,metric,windowId="legacy_labels"){
    if(metric.mapEvidence==="clock_supported_return"&&!recoverySupported(row))return null;
    return raw(row,metric,windowId);
  }
  root.V4Metrics = Object.freeze({ categories, observationGroups, forEvent, layers, compare, phaseKeys, defaults, raw, mapRaw, recoverySupported, docs });
})(typeof window !== "undefined" ? window : globalThis);
