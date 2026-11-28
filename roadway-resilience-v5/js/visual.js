/* Shared display semantics and legends. No source values, gates or class breaks change. */
(function (root) {
  "use strict";
  const palettes = Object.freeze({
    performance: ["#B2182B", "#E87D65", "#D49B98", "#6FA6CF", "#2166AC"],
    availability: ["#3B9F92", "#278A92", "#25718F", "#1C5D83", "#164A76"],
    neutral: ["#B07AB7", "#9566AF", "#7D56A4", "#654591", "#4A3179"]
  });
  const evidence = {
    observed_clock_supported_onset_and_return: ["Threshold return observed", "#157D73", null, "Clock-supported onset and threshold return; not physical restoration."],
    row_based_sampling_ambiguous_onset_or_return: ["Return timing uncertain", "#CA8C33", "6 3", "Observed-row onset or return lacks continuous clock-hour confirmation."],
    right_censored_incomplete_decline: ["Censored · decline incomplete", "#934EA7", "2 3", "Decline is incomplete at the observation endpoint; no confirmed return."],
    right_censored_no_supported_return: ["Censored · return not observed", "#6651A5", "8 3", "No supported sustained return before the follow-up endpoint."],
    baseline_reference_uncertain: ["Reference uncertain", "#B04478", "1 4", "Baseline reference is uncertain; this status takes precedence over overlapping censor flags."],
    preexisting_decline_no_eligible_new_onset: ["Earlier slowdown", "#8A632A", "10 3 2 3", "An earlier decline was present without an eligible new event onset."],
    no_eligible_sustained_drop_not_proof_of_no_impact: ["No sustained slowdown detected", "#3C6A92", null, "No eligible sustained decline under the detection rule; not proof of no impact."],
    insufficient_full_trajectory_observations: ["Insufficient observations", "#50634C", "1 5", "Too few observations for full-trajectory detection; distinct from no detected decline."],
    incomplete_event_onset_confirmation: ["Onset not confirmed", "#C45926", "3 3", "Event-onset confirmation is incomplete; not a confirmed new decline."]
  };
  const higherBetter = new Set(["potential", "observed", "phase_score", "minimum", "o1a", "o1b_score", "o1b_minimum"]);
  const higherConcern = new Set(["weather", "network", "precipitation", "wind", "gust", "loss", "recovery", "o1a_deficit", "o1b_loss", "o1b_return", "vehicle_delay", "mobility_cost"]);
  const meanings = {
    potential: ["Lower potential", "Higher potential", "Planning screen combining weather exposure and network context; not predicted traffic performance."],
    weather: ["Lower exposure", "Higher exposure", "Event-specific weather exposure screen; not measured road damage."],
    network: ["Lower risk", "Higher risk", "Fixed network consequence and redundancy context; not observed event impact."],
    precipitation: ["Less rainfall", "More rainfall", "Accumulated precipitation over the source weather window."],
    wind: ["Lower wind", "Higher wind", "Maximum hourly control-section line-mean modeled wind."],
    gust: ["Lower gust", "Higher gust", "Maximum modeled control-section line-mean gust, retaining source interval-end semantics."],
    track_distance: ["Nearer track", "Farther from track", "Distance to the original track line; distance is not a severity measure."],
    observed: ["Lower performance", "Higher performance", "January selected-phase performance; Beryl core average speed ratio when selected in Advanced Analysis."],
    o1a: ["Lower performance", "Higher performance", "One minus average positive baseline-relative speed deficit over qualified observed core hours; not a full recovery score."],
    phase_score: ["Lower performance", "Higher performance", "Historical full-period selected-slowdown score; not an event-core performance index."],
    o1b_score: ["Lower performance", "Higher performance", "Score for the selected event-anchored slowdown, available only with qualified onset and threshold-return evidence."],
    minimum: ["Lower minimum Q", "Higher minimum Q", "Minimum smoothed speed ratio in the original selected slowdown."],
    o1b_minimum: ["Lower minimum Q", "Higher minimum Q", "Minimum smoothed speed ratio in the qualified selected event slowdown."],
    loss: ["Smaller loss", "Greater loss", "Sum of baseline-reference speed deficits over observed rows; not monetary loss or integration across missing hours."],
    o1b_loss: ["Smaller loss", "Greater loss", "Selected-episode observed-row speed deficit; qualified evidence only, with missing-hour gaps preserved."],
    recovery: ["Shorter interval", "Longer interval", "Selected minimum-to-endpoint interval. January may include censored endpoints; only supported Beryl historical returns are colored. It is not physical repair time."],
    o1b_return: ["Shorter return", "Longer return", "Minimum to first sustained threshold return, restricted to qualified return evidence; not physical restoration."],
    o1a_deficit: ["Smaller speed loss", "Greater speed loss", "Average positive speed-ratio deficit over qualified observed core hours."],
    vehicle_delay: ["Less delay", "More delay", "Conditional expected-demand positive excess travel time, summed over supported records."],
    mobility_cost: ["Lower delay cost", "Higher delay cost", "Conditional expected-demand delay valuation in 2024 USD; not total causal disaster loss."],
    coverage: ["Lower coverage", "Higher coverage", "Observed native-core hours divided by expected core hours; availability, not performance."],
    q_support: ["No traffic history", "Traffic history available", "Existing true/false curve-availability flag, not a fabricated coverage fraction. False is distinct from a missing flag."],
    temp_min: ["Lower temperature", "Higher temperature", "Minimum of daily buffer-mean air Tmin, not pavement temperature or absolute road minimum."],
    temp_tmin_days: ["Fewer days", "More days", "Count of PRISM days with buffer-mean Tmin below zero; not freezing hours or confirmed icing."],
    temp_tmax_days: ["Fewer days", "More days", "Count of PRISM days with buffer-mean Tmax below zero; not confirmed road icing."]
  };
  function configure(metric, beryl) {
    if (metric.explore === false) return metric;
    if (metric.kind === "category") {
      metric.displayFamily = "categorical";
      metric.categories = metric.categories.map(item => {
        const display = evidence[item.value];
        if (!display) throw new Error("Unmapped scientific evidence class: " + item.value);
        return { ...item, label: display[0], color: display[1], dash: display[2], description: display[3] };
      });
      return metric;
    }
    metric.displayFamily = higherBetter.has(metric.key) || higherConcern.has(metric.key) ? "performance" : ["coverage", "q_support"].includes(metric.key) ? "availability" : "neutral";
    metric.ramp = [...palettes[metric.displayFamily]];
    if (higherConcern.has(metric.key)) metric.ramp.reverse();
    metric.legendOrder = higherConcern.has(metric.key) ? "descending" : "ascending";
    metric.visualMeaning = meanings[metric.key];
    if (!metric.visualMeaning) throw new Error("Missing metric display semantics: " + metric.key);
    if (metric.key === "observed" && !beryl) metric.visualMeaning = ["Lower performance", "Higher performance", "Normalized performance over the original selected slowdown phase; not a full-event mean. Original supported-sample quantiles are retained."];
    return metric;
  }
  const T = (tag, content = "", className = "") => {
    const node = document.createElement(tag); node.textContent = content; node.className = className; return node;
  };
  function mark(color, dash) {
    const node = T("i", "", "legend-line"); node.style.borderTopColor = color;
    node.style.borderTopStyle = dash ? "dashed" : "solid";
    // SVG preserves the actual dash sequence, including distinct censored states.
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 36 8"); svg.setAttribute("aria-hidden", "true");
    const line = document.createElementNS(svg.namespaceURI, "line");
    for (const [name, value] of Object.entries({ x1: 0, x2: 36, y1: 4, y2: 4, stroke: color, "stroke-width": 3 })) line.setAttribute(name, value);
    if (dash) line.setAttribute("stroke-dasharray", dash);
    svg.append(line); node.append(svg); return node;
  }
  function renderLegend(box, { metric, range, rows, value, maskNote }) {
    const beryl = metric.eventId === "beryl_2024_07";
    const previous = box.querySelector("details"), keepOpen = previous?.open && box.dataset.metric === metric.key && box.dataset.event === metric.eventId;
    box.dataset.metric = metric.key; box.dataset.event = metric.eventId;
    box.classList.toggle("o1-category-legend", metric.kind === "category");
    const details = T("details", "", "legend-details scientific-legend"), summary = T("summary"), body = T("div", "", "legend-expanded");
    details.open = Boolean(keepOpen); summary.setAttribute("aria-label", "Legend details: " + metric.label);
    summary.append(T("span", metric.label, "legend-title"));
    const strip = T("div", "", metric.kind === "category" ? "legend-symbols" : "legend-ramp");
    if (metric.kind === "category") {
      for (const category of metric.categories) {
        const symbol = mark(category.color, category.dash); symbol.title = category.label; strip.append(symbol);
      }
      summary.append(strip, T("span", "Return · uncertainty · data support", "legend-direction"));
      if (!beryl) body.append(T("p", "Scientific evidence categories; colors are not a numerical ranking."));
      for (const category of metric.categories) {
        const row = T("div", "", "legend-category-row"), description = T("div");
        description.append(T("strong", category.label), T("span", category.description));
        row.append(mark(category.color, category.dash), description, T("span", rows.filter(r => value(r) === category.value).length.toLocaleString("en-US"), "legend-count")); body.append(row);
      }
      if (!beryl) body.append(T("p", "No detected decline is distinct from insufficient or missing evidence. Censored and uncertain returns are not confirmed recovery."));
    } else {
      // Reorder paired display classes only; map colors and numeric class indices stay intact.
      const displayClasses = metric.ramp.map((color, index) => ({ color, index }));
      if (metric.legendOrder === "descending") displayClasses.reverse();
      displayClasses.forEach(({ color }) => { const swatch = T("i"); swatch.style.background = color; strip.append(swatch); });
      const [low, high, definition] = metric.visualMeaning;
      const endpoints = T("div", "", "legend-direction legend-endpoints");
      endpoints.append(T("span", metric.legendOrder === "descending" ? high : low), T("span", metric.legendOrder === "descending" ? low : high));
      summary.append(strip, endpoints);
      body.append(T("p", definition), T("p", "Unit: " + metric.unit, "legend-unit-detail"));
      const classes = T("div", "", "legend-intervals");
      displayClasses.forEach(({ color, index: i }) => {
        const row = T("div", "", "legend-interval-row"), interval = `${i === 0 ? "[" : "("}${String(range[i])}, ${String(range[i + 1])}]`;
        row.append(mark(color), T("span", interval)); classes.append(row);
      });
      body.append(classes);
      if (!beryl) {
        body.append(T("p", "Shared boundaries belong to the lower numeric class. Values below the first numeric bound use the first numeric class; above the last numeric bound use the last numeric class.", "legend-boundaries"));
        body.append(T("p", metric.quantile ? "Original supported-event sample quantiles." : metric.breaks ? "Fixed source classification intervals." : "Original range-based classification intervals."));
      }
      const qualification = metric.gate ? metric.family === "o1a" ? "Requires sufficient observed core hours, daily support and observation-gap coverage." : "Requires qualified onset and observed threshold-return evidence; uncertain or censored episodes remain unavailable here." : metric.mapEvidence ? "Requires clock-supported threshold-return evidence." : metric.requiresPhase ? "Requires the original selected-phase support. A censored endpoint is not confirmed recovery." : null;
      if (!beryl) {
        if (qualification) body.append(T("p", qualification));
        body.append(T("p", "Unavailable values have no quantitative stroke. Search, selection and source evidence remain available; unavailable does not mean zero or unaffected."));
      }
    }
    body.append(T("p", `${rows.filter(r => value(r) !== null).length.toLocaleString("en-US")} available / ${rows.length.toLocaleString("en-US")} roads in current view`, "legend-support"));
    if (maskNote) body.append(T("p", beryl ? (maskNote.startsWith("Impact Focus") ? "Impact Focus on" : "Common Support on") : maskNote));
    const link = T("a", "Methods and sources ↗", "text-action"); link.href = `./docs.html${metric.eventId === "beryl_2024_07" ? "?event=beryl_2024_07" : ""}#visual-system`; body.append(link);
    summary.append(T("span", "Details", "legend-details-label"));
    details.append(summary, body); box.replaceChildren(details);
    // Legend actions must not pan or select roads underneath.
    box.onpointerdown = event => event.stopPropagation();
  }
  root.V4L = Object.freeze({ palettes, evidence, configure, renderLegend });
})(window);
