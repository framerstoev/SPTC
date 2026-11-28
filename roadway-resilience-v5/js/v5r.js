/* Dashboard presentation. Scientific eligibility and values come from existing records. */
(function (root) {
  "use strict";
  const T = (...args) => V4Inspector.text(...args);
  const labels = ["Very Low", "Low", "Moderate", "High", "Very High"];
  const episodeLabels = {
    observed_clock_supported_onset_and_return: "Threshold return observed",
    row_based_sampling_ambiguous_onset_or_return: "Return not confirmed · observation gaps",
    right_censored_incomplete_decline: "Return not confirmed · slowdown still in progress",
    right_censored_no_supported_return: "Return not confirmed by the end of follow-up",
    baseline_reference_uncertain: "Baseline speed is uncertain",
    preexisting_decline_no_eligible_new_onset: "Earlier slowdown · no new event onset",
    no_eligible_sustained_drop_not_proof_of_no_impact: "No qualifying slowdown identified",
    insufficient_full_trajectory_observations: "Not enough observations to assess slowdown",
    incomplete_event_onset_confirmation: "Slowdown onset not confirmed"
  };
  const decimal = (value, digits = 3) => Number.isFinite(value) ? value.toFixed(digits) : null;
  const percent = value => Number.isFinite(value) ? (100 * value).toFixed(1) + "%" : null;
  const hours = value => Number.isFinite(value) ? value.toLocaleString("en-US") + " h" : null;

  function support(row) {
    const a = row.o1a;
    if (a.primary_qualified) return "Meets data quality requirements";
    if (a.valid_core_Q_count === 0) return "No observation data in the event window";
    if (a.daily_eligibility_uncertain) return "Daily coverage is uncertain across time zones";
    if (!a.G75_only_qualified || !a.D12_qualified) return "Not enough observations";
    if (!a.G12_qualified) return "Observation gap exceeds the data quality limit";
    return "Performance score unavailable for this road";
  }

  function episodeStatus(data, row) {
    if (data.beryl) {
      return episodeLabels[row.o1b.evidence_status] || "Slowdown evidence unavailable for this road";
    }
    const labels = {detected:"Slowdown detected", no_sustained_drop:"No qualifying slowdown identified",
      recovery_endpoint_censored:"Return not confirmed by the end of observation",
      no_observed_support:"No observation data"};
    return labels[row.status] || (row.has_curve ? "Slowdown evidence unavailable for this road" : "No observation data");
  }

  function keyValues(entries) {
    const list = T("dl", "", "v5r-values");
    for (const [label, value] of entries) {
      if (value !== null && value !== undefined) list.append(T("dt", label), T("dd", value));
    }
    return list;
  }

  function docLink(data, label, anchor) {
    const link = T("a", label, "text-action");
    link.href = V4J.methodLink(data, anchor);
    return link;
  }

  function details(title, className) {
    const disclosure = T("details", "", className);
    disclosure.append(T("summary", title));
    return disclosure;
  }

  function standing(fraction) {
    const bottom = fraction <= .5;
    const tail = 100 * (bottom ? fraction : 1 - fraction);
    const direction = bottom ? "Bottom" : "Top";
    if (tail < .1) return direction + " <0.1%";
    const digits = tail < 2 || Math.abs(tail - 20) < .5 || Math.abs(tail - 40) < .5 ? 1 : 0;
    return direction + " " + tail.toFixed(digits) + "%";
  }

  function classCard(name, cls, rank) {
    const badge = T("div", "", "v5s-class");
    const rated = Number.isInteger(cls) && cls >= 1 && cls <= 5 && Number.isFinite(rank);
    const relative = rated ? standing(rank) : null;
    badge.append(T("span", name));
    if (rated) {
      badge.dataset.relativeClass = String(cls);
      badge.style.setProperty("--class-color", V4L.palettes.performance[cls - 1]);
      badge.append(T("strong", "Class " + cls), T("small", labels[cls - 1]),
        T("small", relative, "v5t-percentile"));
    } else {
      badge.append(T("strong", "Not rated", "v5t-unrated"));
    }

    return badge;
  }

  function relativeHeader(host, row, beryl) {
    const id = beryl && row ? String(row.id) : "";
    if (host.dataset.section === id) return;
    host.dataset.section = id;
    host.hidden = !id;
    host.replaceChildren();
    if (!id) return;
    const pair = row.v5p;
    const grid = T("div", "", "v5s-class-pair");
    grid.append(
      classCard("Planning", pair?.planning_class, pair?.percentiles?.[0]),
      classCard("Observed", pair?.observation_class, pair?.percentiles?.[1])
    );
    host.append(grid);
  }

  function januaryPhase(data, row, meta) {
    const core = V4Core;
    const selected = V4Presentation.phaseValid(data,row);
    const evidence = selected ? V4Presentation.recoveryEvidence(data,row,meta) : null;
    const returned = selected && !meta.unavailable && !evidence.status ? core.mapValue(row,"recovery") : null;
    const status = selected ? (Number.isFinite(returned) ? "Slowdown detected · Threshold return recorded" :
      "Slowdown detected · Return not confirmed") : episodeStatus(data,row);
    return {
      selected, status, qualifier: selected ? (meta.unavailable ? "Return evidence unavailable" : evidence.status) : null,
      minimum: selected ? core.value(row,"minimum") : null,
      loss: selected ? core.value(row,"loss") : null,
      returned, onset: meta.onset_time, minTime: meta.min_time
    };
  }

  function stamp(value) {
    return value ? value.slice(0,16).replace("T"," ") + " local" : null;
  }

  function cumulative(value) {
    return Number.isFinite(value) ? decimal(value) + " Q-hours" : null;
  }

  function addObservationCard(cards, label, value, context, metric) {
    if (value === null) return;
    const card = T("div", "", "v5s-stat");
    card.dataset.metric = metric;
    card.append(T("span",label), T("strong",value));
    if (context) card.append(T("small",context));
    cards.append(card);
  }

  function slowdownDetails(phase) {
    const extra = details("Slowdown Details", "v5s-slowdown-details");
    extra.append(keyValues([
      ["Cumulative Speed Loss", cumulative(phase.loss)],
      ["Slowdown Started", stamp(phase.onset)],
      ["Minimum Time", stamp(phase.minTime)],
      ["Evidence", phase.qualifier]
    ]));
    return extra;
  }

  function berylObservation(data, row, host) {
    host.classList.add("v5u-observation");
    const performance = T("section", "", "v5u-performance");
    const heading = T("h3", "Traffic Performance", "evidence-heading");
    heading.id = "beryl-traffic-performance";
    performance.setAttribute("aria-labelledby", heading.id);
    performance.append(heading);
    const peak = percent(data.peakLossById?.get(row.id));
    if (peak === null) {
      performance.append(T("p", data.peakLossById ? "Insufficient data" : "Peak Speed Loss unavailable", "v5r-support"));
    } else {
      const cards = T("div", "", "v5s-observation-cards");
      addObservationCard(cards, "Peak Speed Loss", peak, null, "peak_speed_loss");
      performance.append(cards);
    }
    host.append(performance);
  }

  function observation(data, row, host, meta = {}) {
    if (data.beryl) {
      berylObservation(data, row, host);
      return;
    }
    const phase = januaryPhase(data, row, meta);

    const score = V4Core.value(row, V4J.primary(data));
    host.append(T("h3", "Traffic Performance", "evidence-heading"));
    if (score === null) {
      host.append(T("p", row.has_curve ? "No qualifying performance score" : "No observation data", "v5r-support"));
    }
    const cards = T("div", "", "v5s-observation-cards");
    addObservationCard(cards, "Observed Performance", decimal(score), "Selected slowdown", "observed");
    if (phase.selected) addObservationCard(cards, "Lowest Speed Ratio", decimal(phase.minimum), "Selected slowdown", "minimum");
    addObservationCard(cards, "Threshold Return", hours(phase.returned), "From the selected minimum", "recovery");
    if (cards.childElementCount) host.append(cards);
    host.append(T("p", phase.status, "v5r-status"));
    if (phase.selected) host.append(slowdownDetails(phase));
  }

  function fallback(state) {
    const isOld = key => key === "v5p_relative_planning" || key === "v5p_relative_observed";
    if ([state.layer,state.planningLayer,state.observedLayer].some(isOld)) {
      return {...state, ...V4Metrics.defaults(state.eventId)};
    }
    return state;
  }

  function metricCopy(metric, beryl) {
    const names = {o1b_score:"Slowdown score", o1b_minimum:"Lowest speed ratio",
      o1b_loss:"Cumulative speed loss", o1b_return:"Time to threshold return",
      phase_score:"Historical slowdown score", core_minimum:"Lowest event speed ratio"};
    if (names[metric.key]) metric.label = metric.cardLabel = names[metric.key];
    if (Array.isArray(metric.categories)) {
      metric.categories = metric.categories.map(item => ({...item, label:episodeLabels[item.value] || item.label}));
    }
    const definition = metric.visualMeaning?.[2];
    metric.note = definition || (metric.kind === "category" ? "Slowdown, return and observation support." : metric.label);
    if (metric.key === "gust") metric.note = "Highest modeled gust along the road during the weather window.";
    if (metric.key === "o1a") metric.note = "Average speed performance during the hurricane period, for roads with sufficient data.";
    if (!beryl && metric.key === "observed") metric.note = "Performance during the selected slowdown period.";
    return metric;
  }

  root.V5R = Object.freeze({relativeHeader, observation, episodeStatus,
    support, keyValues, docLink, details, fallback, metricCopy});
})(window);
