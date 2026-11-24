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

  function placeInfo(popup, button) {
    const header = button.closest(".v5s-header").getBoundingClientRect();
    const anchor = button.getBoundingClientRect();
    const edge = 8;
    const viewportWidth = document.documentElement.clientWidth;
    const width = Math.min(248, viewportWidth - 2 * edge);
    popup.style.left = Math.max(edge, Math.min(anchor.right - width, viewportWidth - width - edge)) + "px";
    const below = window.innerHeight - header.bottom - 2 * edge;
    const above = header.top - 2 * edge;
    const useAbove = below < 150 && above > below;
    popup.style.top = useAbove ? "auto" : header.bottom + edge + "px";
    popup.style.bottom = useAbove ? window.innerHeight - header.top + edge + "px" : "auto";
    popup.style.maxHeight = Math.max(0, useAbove ? above : below) + "px";
  }

  function classCard(row, name, title, metric, cls, rank) {
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

    const id = "standing-info-" + metric;
    const button = T("button", "", "v5t-info");
    button.type = "button";
    button.setAttribute("aria-label", "About " + title);
    button.setAttribute("popovertarget", id);
    const mark = T("span", "i");
    mark.setAttribute("aria-hidden", "true");
    button.append(mark);

    const popup = T("div", "", "v5t-standing-info");
    popup.id = id;
    popup.tabIndex = -1;
    popup.setAttribute("popover", "auto");
    popup.setAttribute("autofocus", "");
    popup.setAttribute("role", "group");
    popup.setAttribute("aria-labelledby", id + "-title");
    popup.setAttribute("aria-describedby", id + "-content");
    const heading = T("strong", title);
    heading.id = id + "-title";
    const content = T("div", "");
    content.id = id + "-content";
    const index = decimal(V4Core.value(row, metric));
    content.append(keyValues([
      ["Original index", index ?? "Unavailable"],
      ["Relative standing", relative],
      ["Reference", rated ? "3,097 qualified Beryl roads" : null]
    ]), T("p", rated ? (metric === "potential" ? "Based on storm exposure and network conditions." :
      "Based on average positive speed loss during qualified storm-period hours.") :
      "This road is outside the qualified comparison group."));
    popup.append(heading, content);

    popup.addEventListener("beforetoggle", event => {
      if (event.newState === "open") placeInfo(popup, button);
    });
    badge.append(button, popup);
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
      classCard(row, "Planning", "Planning Potential", "potential", pair?.planning_class, pair?.percentiles?.[0]),
      classCard(row, "Observed", "Observed Traffic Performance", "o1a", pair?.observation_class, pair?.percentiles?.[1])
    );
    host.append(grid, T("span", "Relative standing", "v5s-relative-label"));
  }

  root.addEventListener("resize", () => {
    const popup = document.querySelector(".v5t-standing-info:popover-open");
    if (popup) placeInfo(popup, popup.previousElementSibling);
  });

  function phaseReadout(data, row, which, meta = {}) {
    const core = V4Core;
    if (data.beryl && which === "o1b") {
      const phase = row.o1b;
      const qualified = phase.qualified_return_evidence;
      const selected = phase.selected_episode;
      return {
        selected, qualified,
        status: qualified ? "Slowdown detected · Threshold return observed" :
          selected ? "Slowdown detected · Return not confirmed" : episodeStatus(data,row),
        qualifier: selected && !qualified ? episodeStatus(data,row) : null,
        minimum: selected ? phase.q_min_smoothed : null,
        provisional: Boolean(phase.minimum_provisional_decline_incomplete),
        loss: selected ? phase.raw_observed_row_loss_area : null,
        score: core.value(row,"o1b_score"),
        returned: core.value(row,"o1b_return"),
        onset: phase.onset_time_UTC, minTime: phase.minimum_time_UTC
      };
    }
    const selected = V4Presentation.phaseValid(data,row);
    const phase = data.beryl ? row.candidate_b : meta;
    const evidence = selected ? V4Presentation.recoveryEvidence(data,row,phase) : null;
    const returned = selected && !meta.unavailable && !evidence.status ? core.mapValue(row,"recovery") : null;
    const qualified = Number.isFinite(returned);
    const status = selected ? (qualified ? (data.beryl ?
      "Slowdown detected · Threshold return observed" : "Slowdown detected · Threshold return recorded") :
      "Slowdown detected · Return not confirmed") :
      (data.beryl ? "No qualifying historical slowdown identified" : episodeStatus(data,row));
    return {
      selected, qualified, status, qualifier: selected ? (meta.unavailable ? "Return evidence unavailable" : evidence.status) : null,
      minimum: selected ? core.value(row,"minimum") : null, provisional: false,
      loss: selected ? core.value(row,"loss") : null,
      score: data.beryl ? core.value(row,"phase_score") : null,
      returned, onset: phase?.onset_time, minTime: phase?.min_time
    };
  }

  function stamp(value, beryl) {
    return value ? value.slice(0,16).replace("T"," ") + (beryl ? " UTC" : " local") : null;
  }

  function cumulative(value) {
    return Number.isFinite(value) ? decimal(value) + " Q-hours" : null;
  }

  function addObservationCard(cards, label, value, context, metric) {
    if (value === null) return;
    const card = T("div", "", "v5s-stat");
    card.dataset.metric = metric;
    card.append(T("span",label), T("strong",value), T("small",context));
    cards.append(card);
  }

  function slowdownDetails(phase, beryl, minimum, qualifier) {
    const extra = details("Slowdown Details", "v5s-slowdown-details");
    extra.append(keyValues([
      ["Cumulative Speed Loss", cumulative(phase.loss)],
      ["Slowdown Score", decimal(phase.score)],
      ["Slowdown Started", stamp(phase.onset, beryl)],
      ["Minimum Time", stamp(phase.minTime, beryl)],
      ["Selected Minimum (provisional)", minimum],
      ["Evidence", qualifier]
    ]));
    return extra;
  }

  function berylObservation(row, host, phase) {
    host.classList.add("v5u-observation");
    const performance = T("section", "", "v5u-performance");
    const slowdown = T("section", "", "v5u-slowdown");
    for (const [section, id, title] of [
      [performance, "beryl-traffic-performance", "Traffic Performance"],
      [slowdown, "beryl-slowdown-return", "Slowdown & Return"]
    ]) {
      const heading = T("h3", title, "evidence-heading");
      heading.id = id;
      section.setAttribute("aria-labelledby", id);
      section.append(heading);
    }
    host.append(performance, slowdown);

    const deficit = percent(V4Core.value(row, "o1a_deficit"));
    const hasTraffic = row.full_observed_hours > 0;
    if (deficit === null) {
      performance.append(T("p", hasTraffic ? support(row) : "No valid traffic observations for this road",
        "v5r-support"));
    } else {
      const cards = T("div", "", "v5s-observation-cards");
      addObservationCard(cards, "Average Speed Loss", deficit, "Storm period", "o1a_deficit");
      performance.append(cards);
    }

    slowdown.append(T("p", hasTraffic ? phase.status : "Slowdown evidence unavailable", "v5r-status"));
    if (!phase.selected) {
      if (row.o1b.evidence_status === "no_eligible_sustained_drop_not_proof_of_no_impact") {
        slowdown.append(T("p", "No qualifying episode measurements for this road.", "v5u-episode-note"));
      }
      return;
    }

    // Keep recorded minima visible when independent return evidence fails. An unfinished
    // decline has a provisional minimum and retains its qualifier inside Details.
    const cards = T("div", "", "v5s-observation-cards");
    if (!phase.provisional) {
      addObservationCard(cards, "Lowest Speed Ratio", decimal(phase.minimum), "Selected slowdown", "o1b_minimum");
    }
    addObservationCard(cards, "Threshold Return", hours(phase.returned), "Observed threshold return", "o1b_return");
    if (cards.childElementCount) slowdown.append(cards);
    const evidenceNotes = {
      row_based_sampling_ambiguous_onset_or_return: "Gaps between observations",
      right_censored_incomplete_decline: "Slowdown still in progress at the end of follow-up",
      right_censored_no_supported_return: "Follow-up ended before a supported return"
    };
    slowdown.append(slowdownDetails(phase, true, phase.provisional ? decimal(phase.minimum) : null,
      evidenceNotes[row.o1b.evidence_status] ?? phase.qualifier));
  }

  function observation(data, row, host, meta = {}) {
    const phase = phaseReadout(data, row, data.beryl ? "o1b" : "b4", meta);
    if (data.beryl) {
      berylObservation(row, host, phase);
      return;
    }

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
    if (phase.selected) host.append(slowdownDetails(phase, false, null, phase.qualifier));
  }

  function analysis(data,row,which,meta) {
    const phase = phaseReadout(data,row,which,meta);
    const group = T("section","","v5s-phase-readout");
    group.append(T("p",phase.status,"v5r-status"), keyValues([
      ["Lowest Speed Ratio" + (phase.provisional ? " (provisional)" : ""), decimal(phase.minimum)],
      ["Cumulative Speed Loss", cumulative(phase.loss)],
      ["Threshold Return", hours(phase.returned)],
      ["Slowdown Started", stamp(phase.onset,data.beryl)],
      ["Minimum Time", stamp(phase.minTime,data.beryl)],
      ["Evidence",phase.qualifier]
    ]));
    return group;
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
    if (metric.key === "o1a_deficit") metric.note = "Average speed loss relative to typical speeds in the event window.";
    if (!beryl && metric.key === "observed") metric.note = "Performance during the selected slowdown period.";
    return metric;
  }

  root.V5R = Object.freeze({relativeHeader, observation, analysis, episodeStatus,
    support, keyValues, docLink, details, fallback, metricCopy});
})(window);
