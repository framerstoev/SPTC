const MAP_URL = "./data/data_driven_resilience_map_v0.geojson";
const SUMMARY_URL = "./data/summary.json";

const scoreRamp = ["#b2182b", "#ef8a62", "#f7f7f7", "#67a9cf", "#2166ac"];
const riskRamp = ["#f7fbff", "#c6dbef", "#6baed6", "#fdae61", "#b2182b"];
const durationRamp = ["#edf8fb", "#b2e2e2", "#66c2a4", "#8856a7", "#4d004b"];
const slopeRamp = ["#b2182b", "#ef8a62", "#f7f7f7", "#67a9cf", "#1a9850"];
const scoreClassLabels = ["Very Low", "Low", "Moderate", "High", "Very High"];
const scoreClassColors = ["#b2182b", "#ef8a62", "#f7f7f7", "#67a9cf", "#2166ac"];

const detectionColors = {
  detected: "#0f766e",
  no_sustained_drop: "#b45309",
  recovery_endpoint_censored: "#7c3aed",
  no_observed_support: "#9ca3af",
  too_few_points: "#6b7280",
  q0_unavailable: "#6b7280"
};

const detectionLabels = {
  detected: "Detected phase pattern",
  no_sustained_drop: "No sustained drop detected",
  recovery_endpoint_censored: "Recovery endpoint censored",
  no_observed_support: "No observed NPMRDS support",
  too_few_points: "Too few points",
  q0_unavailable: "Q0 unavailable"
};

const layerConfig = {
  observed_curve_resilience_score_v0: {
    label: "Observed Curve Resilience Score v0",
    type: "scoreClass",
    ramp: scoreClassColors,
    description: "Experimental v0 curve score classes use quantile breaks because fixed breaks are highly imbalanced. Higher = better observed operational resilience."
  },
  q_min: {
    label: "Q_min",
    type: "continuous",
    ramp: scoreRamp,
    min: 0,
    max: 1,
    description: "Minimum smoothed normalized speed performance during detected disruption. Higher = better."
  },
  loss_depth: {
    label: "Loss Depth",
    type: "continuous",
    ramp: riskRamp,
    cap99: true,
    description: "Q0 minus Q_min. Higher = deeper detected performance loss."
  },
  resilience_loss_area: {
    label: "Resilience Loss Area",
    type: "continuous",
    ramp: riskRamp,
    cap99: true,
    description: "Integrated curve loss over the detected phase. Higher = larger depth-duration impact."
  },
  recovery_duration_hours: {
    label: "Recovery Duration",
    type: "continuous",
    ramp: durationRamp,
    cap99: true,
    description: "Hours from minimum point to detected recovery endpoint. Censored values should be interpreted carefully."
  },
  recovery_slope: {
    label: "Recovery Slope",
    type: "continuous",
    ramp: slopeRamp,
    cap99: true,
    description: "Rate of smoothed Q(t) increase during recovery. Higher = faster recovery."
  },
  detection_status: {
    label: "Detection Status / Warning",
    type: "category",
    colors: detectionColors,
    description: "Phase-detection status from the experimental v0 method."
  },
  total_detected_phase_delay_proxy: {
    label: "Supplemental Delay Burden",
    type: "continuous",
    ramp: riskRamp,
    cap99: true,
    description: "Vehicle-hours delay proxy over detected phases. Uses profile demand weighting, not observed event-day volume."
  },
  Potential_Resilience_Score: {
    label: "Tier 1/2 Potential Resilience",
    type: "continuous",
    ramp: scoreRamp,
    min: 0,
    max: 1,
    description: "Potential resilience from Tier 1/2 context. Predictor/context layer, not observed Tier 3 label."
  },
  WEATHER_REI: {
    label: "WEATHER_REI",
    type: "continuous",
    ramp: riskRamp,
    min: 0,
    max: 1,
    description: "Tier 1 weather exposure/vulnerability score. Higher = higher potential disruption risk."
  },
  NETRISK_LITE: {
    label: "NETRISK_LITE",
    type: "continuous",
    ramp: riskRamp,
    min: 0,
    max: 1,
    description: "Tier 2-lite network risk score. Higher = higher potential network risk."
  },
  EVENT_REI: {
    label: "EVENT_REI",
    type: "continuous",
    ramp: riskRamp,
    min: 0,
    max: 1,
    description: "Original potential disruption risk index. Higher = worse; not direct positive resilience."
  }
};

let map;
let mapData;
let controlLayer;
let activeLayer = "observed_curve_resilience_score_v0";
let selectedLeafletLayer = null;
let selectedProps = null;
let ranges = {};
let scoreClassBreaks = [];
let searchIndex = [];
let layerByCtrl = new Map();
let featureByCtrl = new Map();
let curveChart = null;
let phaseOverlayState = null;

function numberOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmt(value, digits = 3) {
  const n = numberOrNull(value);
  return n === null ? "N/A" : n.toFixed(digits);
}

function fmtInt(value) {
  const n = numberOrNull(value);
  return n === null ? "N/A" : Math.round(n).toLocaleString();
}

function fmtHours(value) {
  const n = numberOrNull(value);
  return n === null ? "N/A" : `${n.toFixed(1)} h`;
}

function fmtDelay(value) {
  const n = numberOrNull(value);
  return n === null ? "N/A" : `${Math.round(n).toLocaleString()} veh-h`;
}

function fmtPct(value) {
  const n = numberOrNull(value);
  return n === null ? "N/A" : `${(n * 100).toFixed(1)}%`;
}

function statusKey(props) {
  return props.detection_status || "no_observed_support";
}

function statusLabel(value) {
  return detectionLabels[value] || String(value || "Unknown");
}

function isNoSustainedDrop(props) {
  return statusKey(props) === "no_sustained_drop";
}

function isCensored(props) {
  return statusKey(props) === "recovery_endpoint_censored";
}

function hasCurve(props) {
  return Boolean(props.curve_file);
}

function percentile(values, p) {
  const arr = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const idx = (arr.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return arr[lo];
  return arr[lo] + (arr[hi] - arr[lo]) * (idx - lo);
}

function computeScoreClassBreaks() {
  const scores = (mapData.features || [])
    .map(feature => feature.properties || {})
    .filter(props => statusKey(props) !== "no_sustained_drop")
    .map(props => numberOrNull(props.observed_curve_resilience_score_v0))
    .filter(v => v !== null)
    .sort((a, b) => a - b);
  if (!scores.length) {
    scoreClassBreaks = [0, 0.25, 0.5, 0.75, 0.9, 1];
    return;
  }
  scoreClassBreaks = [0, 0.2, 0.4, 0.6, 0.8, 1].map(q => percentile(scores, q));
  for (let i = 1; i < scoreClassBreaks.length; i += 1) {
    if (scoreClassBreaks[i] <= scoreClassBreaks[i - 1]) {
      scoreClassBreaks[i] = scoreClassBreaks[i - 1] + 0.000001;
    }
  }
}

function scoreClassIndex(value) {
  const n = numberOrNull(value);
  if (n === null || !scoreClassBreaks.length) return null;
  if (n <= scoreClassBreaks[0]) return 0;
  for (let i = 0; i < scoreClassBreaks.length - 1; i += 1) {
    if (n >= scoreClassBreaks[i] && n <= scoreClassBreaks[i + 1]) return i;
  }
  return scoreClassBreaks.length - 2;
}

function scoreClassInfo(props) {
  if (!hasCurve(props) || isNoSustainedDrop(props)) return null;
  const idx = scoreClassIndex(props.observed_curve_resilience_score_v0);
  if (idx === null) return null;
  return {
    label: scoreClassLabels[idx],
    color: scoreClassColors[idx],
    low: scoreClassBreaks[idx],
    high: scoreClassBreaks[idx + 1]
  };
}

function fmtRange(low, high) {
  return `${fmt(low, 3)}-${fmt(high, 3)}`;
}

function computeRanges() {
  Object.entries(layerConfig).forEach(([field, cfg]) => {
    if (cfg.type !== "continuous") return;
    const values = (mapData.features || [])
      .map(feature => numberOrNull(feature.properties?.[field]))
      .filter(v => v !== null);
    if (!values.length) {
      ranges[field] = { min: 0, max: 1 };
      return;
    }
    let min = cfg.min ?? Math.min(...values);
    let max = cfg.max ?? Math.max(...values);
    if (cfg.cap99) {
      min = percentile(values, 0.01) ?? min;
      max = percentile(values, 0.99) ?? max;
    }
    if (min === max) {
      min -= 0.5;
      max += 0.5;
    }
    ranges[field] = { min, max };
  });
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}

function rgbToHex({ r, g, b }) {
  const toHex = value => Math.round(value).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function interpolateColor(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t
  });
}

function rampColor(value, cfg, field) {
  const n = numberOrNull(value);
  if (n === null) return "#cbd5e1";
  const range = ranges[field] || { min: 0, max: 1 };
  const t = Math.max(0, Math.min(1, (n - range.min) / (range.max - range.min)));
  const ramp = cfg.ramp || scoreRamp;
  const scaled = t * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(scaled));
  return interpolateColor(ramp[i], ramp[i + 1], scaled - i);
}

function featureColor(props) {
  const cfg = layerConfig[activeLayer];
  if (cfg.type === "scoreClass") {
    if (isNoSustainedDrop(props)) return detectionColors.no_sustained_drop;
    const cls = scoreClassInfo(props);
    return cls ? cls.color : "#9ca3af";
  }
  if (cfg.type === "category") {
    return cfg.colors[props[activeLayer]] || "#9ca3af";
  }
  return rampColor(props[activeLayer], cfg, activeLayer);
}

function featureStyle(feature) {
  const props = feature.properties || {};
  const cfg = layerConfig[activeLayer];
  const hasValue = cfg.type === "category"
    ? Boolean(props[activeLayer])
    : cfg.type === "scoreClass"
      ? Boolean(scoreClassInfo(props)) || isNoSustainedDrop(props)
      : numberOrNull(props[activeLayer]) !== null;
  return {
    color: featureColor(props),
    weight: hasValue ? 1.15 : 0.75,
    opacity: hasValue ? 0.78 : 0.22,
    lineCap: "round"
  };
}

function applySelectedStyle() {
  if (!selectedLeafletLayer) return;
  selectedLeafletLayer.setStyle({
    color: "#111827",
    weight: 4,
    opacity: 1
  });
  if (selectedLeafletLayer.bringToFront) selectedLeafletLayer.bringToFront();
}

function updateLegend() {
  const cfg = layerConfig[activeLayer];
  document.getElementById("layerNote").textContent = cfg.description || "";
  const legend = document.getElementById("legend");
  if (cfg.type === "scoreClass") {
    const rows = scoreClassLabels.map((label, index) => `
      <div class="legend-row"><span class="swatch" style="background:${scoreClassColors[index]}"></span><span>${label}: ${fmtRange(scoreClassBreaks[index], scoreClassBreaks[index + 1])}</span></div>
    `).join("");
    legend.innerHTML = `
      <div class="legend-title">${cfg.label}</div>
      ${rows}
      <div class="legend-row"><span class="swatch" style="background:${detectionColors.no_sustained_drop}"></span><span>No sustained drop detected</span></div>
      <div class="legend-row"><span class="swatch" style="background:#9ca3af"></span><span>Missing / no observed score</span></div>
      <p class="layer-note">Classes are experimental v0 quantiles, not official resilience categories.</p>
    `;
    return;
  }
  if (cfg.type === "category") {
    const rows = Object.entries(cfg.colors).map(([key, color]) => `
      <div class="legend-row"><span class="swatch" style="background:${color}"></span><span>${statusLabel(key)}</span></div>
    `).join("");
    legend.innerHTML = `<div class="legend-title">${cfg.label}</div>${rows}`;
    return;
  }
  const range = ranges[activeLayer] || { min: 0, max: 1 };
  const gradient = cfg.ramp.map((color, i) => `${color} ${(i / (cfg.ramp.length - 1)) * 100}%`).join(", ");
  legend.innerHTML = `
    <div class="legend-title">${cfg.label}</div>
    <div class="ramp" style="background: linear-gradient(90deg, ${gradient});"></div>
    <div class="ramp-labels"><span>${range.min.toFixed(2)}</span><span>${range.max.toFixed(2)}${cfg.cap99 ? " (p99 cap)" : ""}</span></div>
  `;
}

function makePopup(props) {
  const status = statusLabel(statusKey(props));
  const cls = scoreClassInfo(props);
  return `
    <div class="popup-title">${props.ROUTE_KEY || "Route unknown"} | CS ${props.CTRL_SECT_ || props.CTRL_SECT_NORM}</div>
    <div>${props.county_name || props.county || "County unknown"}</div>
    <div class="popup-row"><span>v0 class</span><strong>${cls ? cls.label : "N/A"}</strong></div>
    <div class="popup-row"><span>Curve score</span><strong>${fmt(props.observed_curve_resilience_score_v0)}</strong></div>
    <div class="popup-row"><span>Q_min</span><strong>${fmt(props.q_min)}</strong></div>
    <div class="popup-row"><span>Status</span><strong>${status}</strong></div>
    <div class="popup-row"><span>Curve</span><strong>${hasCurve(props) ? "Available in panel" : "No curve"}</strong></div>
  `;
}

function buildSearchIndex() {
  searchIndex = (mapData.features || []).map(feature => {
    const props = feature.properties || {};
    const key = String(props.CTRL_SECT_NORM ?? props.CTRL_SECT_ ?? props.CTRL_SECT_KEY ?? "").trim();
    const ctrlKey = props.CTRL_SECT_KEY || `CS_${key}`;
    const route = props.ROUTE_KEY || "Route unknown";
    const county = props.county_name || props.county || "County unknown";
    const status = statusLabel(statusKey(props));
    const haystack = [
      key,
      props.CTRL_SECT_,
      props.CTRL_SECT_NORM,
      ctrlKey,
      route,
      county,
      status
    ].filter(Boolean).join(" ").toLowerCase();
    return { key, ctrlKey, route, county, status, feature, haystack };
  });
}

function renderSearchResults(query) {
  const box = document.getElementById("searchResults");
  const q = query.trim().toLowerCase();
  if (!q) {
    box.classList.remove("visible");
    box.innerHTML = "";
    return;
  }
  const matches = searchIndex
    .filter(item => item.haystack.includes(q))
    .slice(0, 10);
  box.classList.add("visible");
  if (!matches.length) {
    box.innerHTML = `<div class="search-empty">No matching control section found.</div>`;
    return;
  }
  box.innerHTML = matches.map(item => `
    <button class="search-result" type="button" data-key="${item.key}">
      <strong>${item.route} | ${item.ctrlKey}</strong>
      <span>${item.county} | ${item.status}</span>
    </button>
  `).join("");
}

async function selectByKey(key) {
  const layer = layerByCtrl.get(String(key));
  const feature = featureByCtrl.get(String(key));
  if (!layer || !feature) return;
  const bounds = layer.getBounds ? layer.getBounds() : null;
  if (bounds && bounds.isValid()) {
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 11 });
  }
  await selectFeature(feature, layer);
  layer.openPopup();
}

function setupSearch() {
  const input = document.getElementById("csSearch");
  const clear = document.getElementById("clearSearch");
  const results = document.getElementById("searchResults");
  input.addEventListener("input", event => renderSearchResults(event.target.value));
  input.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    const first = results.querySelector(".search-result");
    if (first) first.click();
  });
  clear.addEventListener("click", () => {
    input.value = "";
    renderSearchResults("");
    input.focus();
  });
  results.addEventListener("click", event => {
    const button = event.target.closest(".search-result");
    if (!button) return;
    const item = searchIndex.find(candidate => candidate.key === button.dataset.key);
    if (item) {
      input.value = `${item.ctrlKey} ${item.route}`;
      renderSearchResults("");
      selectByKey(item.key);
    }
  });
}

function metricCard(label, value, className = "", help = "") {
  const helpHtml = help ? `<div class="metric-help">${help}</div>` : "";
  return `<div class="metric-card small ${className}"><span>${label}</span><strong>${value}</strong>${helpHtml}</div>`;
}

function phaseValue(props, field, formatter = fmt) {
  if (isNoSustainedDrop(props)) return "N/A";
  return formatter(props[field]);
}

function renderMetrics(props) {
  const noSustained = isNoSustainedDrop(props);
  const censored = isCensored(props);
  document.getElementById("selectedTitle").textContent = `${props.ROUTE_KEY || "Route unknown"} | CS ${props.CTRL_SECT_ || props.CTRL_SECT_NORM}`;
  document.getElementById("selectedSub").textContent = `${props.county_name || props.county || "County unknown"} | ${props.event_id || "coldwave_2026_01"}`;

  const status = statusKey(props);
  const badgeClass = status === "detected" ? "detected" : (status === "no_observed_support" ? "missing" : "warning");
  const cls = scoreClassInfo(props);
  document.getElementById("statusBadges").innerHTML = [
    `<span class="badge ${badgeClass}">${statusLabel(status)}</span>`,
    `<span class="badge class-badge">v0 curve score class: ${cls ? cls.label : "N/A"}</span>`,
    censored ? `<span class="badge warning">Censored recovery</span>` : "",
    `<span class="badge">NPMRDS support: ${hasCurve(props) ? "yes" : "no"}</span>`,
    `<span class="badge">TMCs: ${fmtInt(props.matched_tmc_count)}</span>`
  ].filter(Boolean).join("");

  document.getElementById("topMetrics").innerHTML = [
    metricCard("Experimental class", cls ? `${cls.label} (${fmtRange(cls.low, cls.high)})` : "N/A", "", "v0 quantile class, not an official resilience category."),
    metricCard("Score v0", noSustained ? "N/A" : fmt(props.observed_curve_resilience_score_v0), "", "Experimental score based primarily on normalized detected-phase loss area."),
    metricCard("Q_min", noSustained ? "N/A" : fmt(props.q_min), "", "Minimum detected normalized speed performance.")
  ].join("");

  const warning = document.getElementById("warningCard");
  warning.classList.remove("visible");
  warning.innerHTML = "";
  if (noSustained) {
    warning.classList.add("visible");
    warning.textContent = "No sustained drop detected under current v0 rule. This should not be interpreted as fully resilient; phase-dependent metrics are shown as N/A or experimental.";
  } else if (censored) {
    warning.classList.add("visible");
    warning.textContent = "Recovery endpoint censored: recovery was not fully detected within the available analysis window. Recovery duration and slope should be treated as flagged/lower-confidence values.";
  } else if (!hasCurve(props)) {
    warning.classList.add("visible");
    warning.textContent = "No direct NPMRDS Q(t) curve is available for this control section in the v0 common-support sample.";
  }

  document.getElementById("curveMetrics").innerHTML = [
    metricCard("Q0 normal level", fmt(props.q0), "", "Q0 = 1 represents baseline-level speed performance."),
    metricCard("Q_min", phaseValue(props, "q_min"), "", "Minimum detected normalized speed performance."),
    metricCard("Loss depth", phaseValue(props, "loss_depth"), "", "Q0 - Q_min; maximum detected performance drop."),
    metricCard("Loss depth pct", phaseValue(props, "loss_depth_pct", fmtPct), "", "Loss depth divided by Q0."),
    metricCard("Degradation duration", phaseValue(props, "degradation_duration_hours", fmtHours), "", "Hours from detected onset to minimum performance."),
    metricCard("Degradation slope", phaseValue(props, "degradation_slope"), "", "Average rate of decline from Q0 to Q_min. Negative means performance decreased."),
    metricCard("Recovery duration", `${phaseValue(props, "recovery_duration_hours", fmtHours)}${censored ? " lower-bound/flagged" : ""}`, "", "Hours from minimum performance to detected recovery endpoint."),
    metricCard("Recovery slope", phaseValue(props, "recovery_slope"), "", "Average rate of recovery from Q_min to recovery endpoint."),
    metricCard("Time to 80%", phaseValue(props, "time_to_80_hours", fmtHours), "", "Hours from minimum point to Q(t) >= 0.8."),
    metricCard("Time to 90%", phaseValue(props, "time_to_90_hours", fmtHours), "", "Hours from minimum point to Q(t) >= 0.9."),
    metricCard("Loss area", phaseValue(props, "resilience_loss_area"), "", "Sum of max(0, Q0 - Q(t)) over the detected phase; captures depth and duration."),
    metricCard("Curve score v0", noSustained ? "N/A" : fmt(props.observed_curve_resilience_score_v0), "", "Experimental score derived mainly from normalized detected-phase loss area. Higher = smaller performance loss area. Not the stable dashboard score.")
  ].join("");

  document.getElementById("impactMetrics").innerHTML = [
    metricCard("Detected phase delay proxy", phaseValue(props, "total_detected_phase_delay_proxy", fmtDelay), "", "Onset-to-recovery delay proxy. This duplicates the v0 disruption_delay_proxy field by construction."),
    metricCard("Detected recovery-subset delay proxy", phaseValue(props, "recovery_delay_proxy", fmtDelay), "", "Minimum-to-recovery subset of the detected phase."),
    metricCard("V0 disruption-delay field", phaseValue(props, "disruption_delay_proxy", fmtDelay), "", "Legacy v0 field name; currently same as detected phase delay proxy."),
    metricCard("Full-window delay proxy", "N/A", "na", "Not available in this frontend package.")
  ].join("");

  document.getElementById("tierMetrics").innerHTML = [
    metricCard("Potential resilience", fmt(props.Potential_Resilience_Score), "", "Higher = lower potential risk / stronger planning-level resilience."),
    metricCard("WEATHER_REI", fmt(props.WEATHER_REI), "", "Higher = greater weather exposure/risk."),
    metricCard("NETRISK_LITE", fmt(props.NETRISK_LITE), "", "Higher = greater network risk."),
    metricCard("EVENT_REI", fmt(props.EVENT_REI), "", "Higher = greater potential event risk."),
    metricCard("AADT", fmtInt(props.AADT_CS), "", "Control-section traffic context where available."),
    metricCard("Data density", props.data_density_summary || "N/A", "", "NPMRDS data-density summary for matched observations.")
  ].join("");
}

function nearestIndex(labels, timestamp) {
  if (!timestamp) return null;
  const target = String(timestamp).slice(0, 16);
  let exact = labels.findIndex(label => String(label).slice(0, 16) === target);
  if (exact >= 0) return exact;
  const targetMs = Date.parse(timestamp);
  if (!Number.isFinite(targetMs)) return null;
  let best = null;
  let bestDistance = Infinity;
  labels.forEach((label, index) => {
    const ms = Date.parse(label);
    const distance = Math.abs(ms - targetMs);
    if (Number.isFinite(distance) && distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

const phaseOverlayPlugin = {
  id: "phaseOverlayPlugin",
  beforeDatasetsDraw(chart) {
    const state = phaseOverlayState;
    if (!state) return;
    const { ctx, chartArea, scales } = chart;
    const x = scales.x;
    const y = scales.y;
    const onset = nearestIndex(state.labels, state.onset_time);
    const minIdx = nearestIndex(state.labels, state.min_time);
    const recovery = nearestIndex(state.labels, state.recovery_end_time);
    const q0 = numberOrNull(state.q0);

    ctx.save();
    if (onset !== null && recovery !== null && q0 !== null && state.qSmooth?.length) {
      const start = Math.max(0, Math.min(onset, recovery));
      const end = Math.min(state.labels.length - 1, Math.max(onset, recovery));
      ctx.beginPath();
      ctx.moveTo(x.getPixelForValue(start), y.getPixelForValue(q0));
      for (let i = start; i <= end; i += 1) {
        ctx.lineTo(x.getPixelForValue(i), y.getPixelForValue(q0));
      }
      for (let i = end; i >= start; i -= 1) {
        const q = numberOrNull(state.qSmooth[i]);
        const lossValue = q === null ? q0 : Math.min(q0, q);
        ctx.lineTo(x.getPixelForValue(i), y.getPixelForValue(lossValue));
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(185, 28, 28, 0.12)";
      ctx.fill();
    }

    [
      { idx: onset, label: "onset", color: "#b91c1c" },
      { idx: minIdx, label: "min", color: "#7f1d1d" },
      { idx: recovery, label: "recovery", color: "#1d4ed8" }
    ].forEach(marker => {
      if (marker.idx === null) return;
      const px = x.getPixelForValue(marker.idx);
      ctx.save();
      ctx.strokeStyle = marker.color;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(px, chartArea.top);
      ctx.lineTo(px, chartArea.bottom);
      ctx.stroke();
      ctx.restore();
    });
    ctx.restore();
  }
};

Chart.register(phaseOverlayPlugin);

function shortDate(label) {
  const date = new Date(label);
  if (Number.isNaN(date.getTime())) return String(label).slice(5, 16);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:00`;
}

async function renderCurve(props) {
  const card = document.getElementById("curveCard");
  const note = document.getElementById("curveNote");
  const markerLegend = document.getElementById("phaseMarkerLegend");
  if (curveChart) {
    curveChart.destroy();
    curveChart = null;
  }
  phaseOverlayState = null;
  markerLegend.innerHTML = "";

  if (!hasCurve(props)) {
    card.style.display = "block";
    note.textContent = "No Q(t) curve JSON is available for this control section.";
    return;
  }

  note.textContent = "Loading full-window Q(t) curve...";
  const response = await fetch(props.curve_file);
  if (!response.ok) {
    note.textContent = "Curve JSON could not be loaded.";
    return;
  }
  const payload = await response.json();
  const series = payload.series || {};
  const labels = series.timestamp || [];
  const q = series.q || [];
  const qSmooth = series.q_smoothed || [];
  const meta = payload.metadata || {};
  const noSustained = isNoSustainedDrop(props);
  const censored = isCensored(props);

  phaseOverlayState = {
    labels,
    qSmooth,
    q0: meta.q0 ?? props.q0,
    onset_time: noSustained ? null : (meta.onset_time ?? props.onset_time),
    min_time: noSustained ? null : (meta.min_time ?? props.min_time),
    recovery_end_time: noSustained ? null : (meta.recovery_end_time ?? props.recovery_end_time)
  };

  if (!noSustained) {
    markerLegend.innerHTML = `
      <span style="color:#b91c1c"><i></i>Detected onset</span>
      <span style="color:#7f1d1d"><i></i>Minimum Q(t)</span>
      <span style="color:#1d4ed8"><i></i>Recovery endpoint</span>
    `;
  }

  const line = value => labels.map(() => value);
  const maxQ = Math.max(1.2, ...q.filter(Number.isFinite), ...qSmooth.filter(Number.isFinite));
  curveChart = new Chart(document.getElementById("curveChart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Raw hourly Q(t)",
          data: q,
          borderColor: "rgba(100, 116, 139, 0.48)",
          backgroundColor: "rgba(100, 116, 139, 0.12)",
          borderWidth: 1,
          pointRadius: 0,
          tension: 0
        },
        {
          label: "6-hour rolling median",
          data: qSmooth,
          borderColor: "#0f766e",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0
        },
        {
          label: "Q = 1.0",
          data: line(1),
          borderColor: "#111827",
          borderWidth: 1,
          borderDash: [4, 4],
          pointRadius: 0
        },
        {
          label: "Q = 0.9",
          data: line(0.9),
          borderColor: "#f59e0b",
          borderWidth: 1,
          borderDash: [4, 4],
          pointRadius: 0
        },
        {
          label: "Q = 0.8",
          data: line(0.8),
          borderColor: "#dc2626",
          borderWidth: 1,
          borderDash: [4, 4],
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: true, labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            title: items => shortDate(labels[items[0].dataIndex]),
            label: item => `${item.dataset.label}: ${fmt(item.raw)}`
          }
        }
      },
      scales: {
        x: {
          type: "category",
          title: { display: true, text: "Time, Jan 1-Feb 3, 2026" },
          ticks: {
            maxTicksLimit: 6,
            maxRotation: 0,
            minRotation: 0,
            callback: (value, index) => shortDate(labels[index])
          }
        },
        y: {
          min: 0,
          max: Math.min(2, Math.max(1.15, maxQ)),
          title: { display: true, text: "Normalized speed performance Q(t)" }
        }
      }
    }
  });

  if (noSustained) {
    note.textContent = "No sustained drop was detected under the current v0 rule. The curve is shown for review, but phase-dependent metrics are not treated as final.";
  } else if (censored) {
    note.textContent = "Shaded area represents detected-phase normalized performance loss. Recovery endpoint is censored, so recovery metrics are flagged and should be interpreted as experimental.";
  } else {
    note.textContent = "Shaded area represents detected-phase normalized performance loss. Vertical lines mark disruption onset, minimum performance, and recovery endpoint.";
  }
}

async function selectFeature(feature, layer) {
  if (selectedLeafletLayer && controlLayer) {
    controlLayer.resetStyle(selectedLeafletLayer);
  }
  selectedLeafletLayer = layer;
  selectedProps = feature.properties || {};
  applySelectedStyle();
  renderMetrics(selectedProps);
  await renderCurve(selectedProps);
}

function onEachFeature(feature, layer) {
  const props = feature.properties || {};
  const key = String(props.CTRL_SECT_NORM ?? props.CTRL_SECT_ ?? props.CTRL_SECT_KEY ?? "").trim();
  if (key) {
    layerByCtrl.set(key, layer);
    featureByCtrl.set(key, feature);
  }
  layer.bindPopup(makePopup(props));
  layer.on("click", () => selectFeature(feature, layer));
}

async function initMap() {
  map = L.map("map", {
    preferCanvas: true,
    zoomControl: true
  }).setView([31.1, -99.3], 6);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  const [summary, geojson] = await Promise.all([
    fetch(SUMMARY_URL).then(r => r.json()),
    fetch(MAP_URL).then(r => r.json())
  ]);
  mapData = geojson;
  computeScoreClassBreaks();
  computeRanges();
  buildSearchIndex();
  updateLegend();

  document.getElementById("totalSections").textContent = summary.total_control_sections.toLocaleString();
  document.getElementById("curveSections").textContent = summary.sections_with_curve_json.toLocaleString();
  document.getElementById("validDetections").textContent = summary.valid_phase_detections.toLocaleString();
  document.getElementById("censoredCount").textContent = summary.recovery_endpoint_censored.toLocaleString();

  controlLayer = L.geoJSON(mapData, {
    renderer: L.canvas({ padding: 0.5 }),
    style: featureStyle,
    onEachFeature
  }).addTo(map);

  if (controlLayer.getBounds().isValid()) {
    map.fitBounds(controlLayer.getBounds(), { padding: [35, 35] });
  }
  setupSearch();
}

document.getElementById("layerSelect").addEventListener("change", event => {
  activeLayer = event.target.value;
  if (controlLayer) {
    controlLayer.setStyle(featureStyle);
    applySelectedStyle();
  }
  updateLegend();
});

initMap().catch(error => {
  console.error(error);
  document.getElementById("selectedSub").textContent = "Dashboard failed to load. Check local server and data files.";
});
