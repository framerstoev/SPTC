const MAP_URL = "./data/data_driven_resilience_map_v0.geojson";
const SUMMARY_URL = "./data/summary.json";
const ANALYSIS_PANEL_DEFAULT_WIDTH = 420;
const ANALYSIS_PANEL_MIN_WIDTH = 320;
const ANALYSIS_PANEL_MAX_WIDTH = 650;
const MAP_MIN_DESKTOP_WIDTH = 480;
const ANALYSIS_PANEL_KEYBOARD_STEP = 16;

const controlRenderer = L.canvas({
  padding: 0.5,
  tolerance: 8
});

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
let selectedHaloLayer = null;
let selectedCasingLayer = null;
let selectedFeature = null;
let selectedProps = null;
let mapLegendControl = null;
let assistantActionController = null;
let assistantChatController = null;
let ranges = {};
let scoreClassBreaks = [];
let searchIndex = [];
let layerByCtrl = new Map();
let featureByCtrl = new Map();
let curveChart = null;
let phaseOverlayState = null;
let curveRequestId = 0;
let analysisPanelWidth = ANALYSIS_PANEL_DEFAULT_WIDTH;
let analysisResizeFrame = null;
let analysisResizePointerId = null;

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
  return Object.hasOwn(detectionLabels, value) ? detectionLabels[value] : "Unknown";
}

function dataDensityLabel(value) {
  return ["A", "B", "C"].includes(value) ? value : "N/A";
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
  const zoom = map ? map.getZoom() : 6;
  let valueWeight = 1.1;
  let missingWeight = 0.7;
  if (zoom >= 11) {
    valueWeight = 2.2;
    missingWeight = 1.3;
  } else if (zoom >= 8) {
    valueWeight = 1.6;
    missingWeight = 1.0;
  }
  return {
    color: featureColor(props),
    weight: hasValue ? valueWeight : missingWeight,
    opacity: hasValue ? 0.78 : 0.22,
    lineCap: "round"
  };
}

function selectedLineWeights() {
  const zoom = map ? map.getZoom() : 6;
  const core = zoom >= 11 ? 6 : (zoom >= 8 ? 5.5 : 5);
  return { core, casing: core + 3, halo: core + 6 };
}

function clearSelectedMapHighlight() {
  if (selectedLeafletLayer && controlLayer) {
    controlLayer.resetStyle(selectedLeafletLayer);
  }
  if (selectedHaloLayer && map) map.removeLayer(selectedHaloLayer);
  if (selectedCasingLayer && map) map.removeLayer(selectedCasingLayer);
  selectedHaloLayer = null;
  selectedCasingLayer = null;
  selectedLeafletLayer = null;
  selectedProps = null;
  selectedFeature = null;
}

function createSelectedMapHighlight(feature) {
  const weights = selectedLineWeights();
  selectedHaloLayer = L.geoJSON(feature, {
    renderer: controlRenderer,
    interactive: false,
    style: {
      color: "#ffffff",
      weight: weights.halo,
      opacity: 0.94,
      lineCap: "round"
    }
  }).addTo(map);
  selectedCasingLayer = L.geoJSON(feature, {
    renderer: controlRenderer,
    interactive: false,
    style: {
      color: "#0f172a",
      weight: weights.casing,
      opacity: 0.94,
      lineCap: "round"
    }
  }).addTo(map);
}

function applySelectedStyle() {
  if (!selectedLeafletLayer) return;
  const weights = selectedLineWeights();
  selectedHaloLayer?.setStyle({
    color: "#ffffff",
    weight: weights.halo,
    opacity: 0.94
  });
  selectedCasingLayer?.setStyle({
    color: "#0f172a",
    weight: weights.casing,
    opacity: 0.94
  });
  selectedLeafletLayer.setStyle({
    color: featureColor(selectedProps || {}),
    weight: weights.core,
    opacity: 1
  });
  if (selectedHaloLayer?.bringToFront) selectedHaloLayer.bringToFront();
  if (selectedCasingLayer?.bringToFront) selectedCasingLayer.bringToFront();
  if (selectedLeafletLayer.bringToFront) selectedLeafletLayer.bringToFront();
}

function setupMapLegendControl() {
  const legendDetails = document.getElementById("mapLegend");
  const legendToggle = document.getElementById("mapLegendToggle");
  legendDetails.open = false;
  legendToggle.setAttribute("aria-expanded", "false");
  legendDetails.addEventListener("toggle", () => {
    legendToggle.setAttribute("aria-expanded", String(legendDetails.open));
  });
  legendDetails.addEventListener("keydown", event => {
    if (event.key !== "Escape" || !legendDetails.open) return;
    event.preventDefault();
    legendDetails.open = false;
    legendToggle.focus();
  });

  mapLegendControl = L.control({ position: "bottomleft" });
  mapLegendControl.onAdd = () => {
    L.DomEvent.disableClickPropagation(legendDetails);
    L.DomEvent.disableScrollPropagation(legendDetails);
    return legendDetails;
  };
  mapLegendControl.addTo(map);
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function makeTooltip(props) {
  const route = escapeHtml(props.ROUTE_KEY || "Route unknown");
  const controlSection = escapeHtml(props.CTRL_SECT_ || props.CTRL_SECT_NORM || "N/A");
  const county = escapeHtml(props.county_name || props.county || "County unknown");
  return `
    <strong>${route} | CS ${controlSection}</strong><br />
    <span>${county}</span>
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
    box.replaceChildren();
    return;
  }
  const matches = searchIndex
    .filter(item => item.haystack.includes(q))
    .slice(0, 10);
  box.classList.add("visible");
  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "search-empty";
    empty.textContent = "No matching control section found.";
    box.replaceChildren(empty);
    return;
  }
  const results = matches.map(item => {
    const button = document.createElement("button");
    const identity = document.createElement("strong");
    const context = document.createElement("span");
    button.className = "search-result";
    button.type = "button";
    button.dataset.key = String(item.key);
    identity.textContent = `${item.route} | ${item.ctrlKey}`;
    context.textContent = `${item.county} | ${item.status}`;
    button.append(identity, context);
    return button;
  });
  box.replaceChildren(...results);
}

async function selectByKey(key) {
  const layer = layerByCtrl.get(String(key));
  const feature = featureByCtrl.get(String(key));
  if (!layer || !feature) return;
  const bounds = layer.getBounds ? layer.getBounds() : null;
  if (bounds && bounds.isValid()) {
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 12 });
  }
  await selectFeature(feature, layer);
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

function metricCard(label, value, className = "", help = "", metricKey = "") {
  const helpHtml = help ? `<div class="metric-help">${help}</div>` : "";
  const metricAttr = metricKey ? ` data-metric="${metricKey}"` : "";
  return `<div class="metric-card small ${className}"${metricAttr}><span>${label}</span><strong>${value}</strong>${helpHtml}</div>`;
}

function phaseValue(props, field, formatter = fmt) {
  if (isNoSustainedDrop(props)) return "N/A";
  return formatter(props[field]);
}

function renderMetrics(props) {
  const noSustained = isNoSustainedDrop(props);
  const censored = isCensored(props);
  document.getElementById("headlineMetrics").hidden = false;
  document.getElementById("curveMetricBlock").hidden = false;
  document.getElementById("selectedTitle").textContent = `${props.ROUTE_KEY || "Route unknown"} | CS ${props.CTRL_SECT_ || props.CTRL_SECT_NORM}`;
  document.getElementById("selectedSub").textContent = `${props.county_name || props.county || "County unknown"} | ${props.event_id || "coldwave_2026_01"}`;

  const status = statusKey(props);
  const badgeClass = status === "detected" ? "detected" : (status === "no_observed_support" ? "missing" : "warning");
  const cls = scoreClassInfo(props);
  document.getElementById("statusBadges").innerHTML = [
    `<span class="badge ${badgeClass}">${statusLabel(status)}</span>`,
    `<span class="badge class-badge">v0 curve score class: ${cls ? cls.label : "N/A"}</span>`,
    `<span class="badge">NPMRDS support: ${hasCurve(props) ? "yes" : "no"}</span>`,
    `<span class="badge">TMCs: ${fmtInt(props.matched_tmc_count)}</span>`
  ].filter(Boolean).join("");

  document.getElementById("topMetrics").innerHTML = [
    metricCard("Score v0", noSustained ? "N/A" : fmt(props.observed_curve_resilience_score_v0), "", "", "score_v0"),
    metricCard("Minimum performance", noSustained ? "N/A" : fmt(props.q_min), "", "", "q_min"),
    metricCard("Loss area", phaseValue(props, "resilience_loss_area"), "", "", "resilience_loss_area"),
    metricCard(
      "Recovery duration",
      phaseValue(props, "recovery_duration_hours", fmtHours),
      censored ? "caution" : "",
      censored ? "Censored; lower-bound/flagged." : "",
      "recovery_duration_hours"
    )
  ].join("");

  const warning = document.getElementById("warningCard");
  warning.setAttribute("aria-label", "Interpretation warning");
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
    metricCard(
      "Recovery duration",
      phaseValue(props, "recovery_duration_hours", fmtHours),
      censored ? "caution" : "",
      censored
        ? "Hours from minimum performance to detected recovery endpoint. Censored; lower-bound/flagged."
        : "Hours from minimum performance to detected recovery endpoint."
    ),
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
    metricCard("Data density", dataDensityLabel(props.data_density_summary), "", "NPMRDS data-density summary for matched observations.")
  ].join("");
}

function buildAssistantContext(props) {
  if (!props) return null;
  const cls = scoreClassInfo(props);
  const status = statusKey(props);
  let warning = null;
  if (status === "no_sustained_drop") {
    warning = "No sustained drop was detected under the current v0 rule.";
  } else if (status === "recovery_endpoint_censored") {
    warning = "Sustained recovery was not fully observed within the available analysis window.";
  } else if (!hasCurve(props)) {
    warning = "No direct NPMRDS Q(t) curve is available for this control section.";
  }
  return {
    route: props.ROUTE_KEY || props.road || null,
    control_section: props.CTRL_SECT_ || props.CTRL_SECT_NORM || props.CTRL_SECT_KEY || null,
    county: props.county_name || props.county || null,
    detection_status: status,
    score_v0: isNoSustainedDrop(props) ? null : numberOrNull(props.observed_curve_resilience_score_v0),
    score_class: cls ? cls.label : null,
    q0: numberOrNull(props.q0),
    q_min: isNoSustainedDrop(props) ? null : numberOrNull(props.q_min),
    loss_depth: isNoSustainedDrop(props) ? null : numberOrNull(props.loss_depth),
    loss_depth_pct: isNoSustainedDrop(props) ? null : numberOrNull(props.loss_depth_pct),
    resilience_loss_area: isNoSustainedDrop(props) ? null : numberOrNull(props.resilience_loss_area),
    recovery_duration_hours: isNoSustainedDrop(props) ? null : numberOrNull(props.recovery_duration_hours),
    recovery_slope: isNoSustainedDrop(props) ? null : numberOrNull(props.recovery_slope),
    onset_time: props.onset_time || null,
    min_time: props.min_time || null,
    recovery_end_time: props.recovery_end_time || null,
    Potential_Resilience_Score: numberOrNull(props.Potential_Resilience_Score),
    WEATHER_REI: numberOrNull(props.WEATHER_REI),
    NETRISK_LITE: numberOrNull(props.NETRISK_LITE),
    EVENT_REI: numberOrNull(props.EVENT_REI),
    AADT_CS: numberOrNull(props.AADT_CS),
    data_density_summary: props.data_density_summary || null,
    matched_tmc_count: numberOrNull(props.matched_tmc_count),
    warning
  };
}

function assistantMetric(value, digits = 3) {
  return value === null ? "N/A" : Number(value).toFixed(digits);
}

function assistantPercent(value) {
  return value === null ? "N/A" : `${(Number(value) * 100).toFixed(1)}%`;
}

function assistantHours(value) {
  return value === null ? "N/A" : `${Number(value).toFixed(1)} hours`;
}

function assistantSectionName(context) {
  const route = context.route || "Route unavailable";
  const controlSection = context.control_section || "control section unavailable";
  return `${route} | ${controlSection}`;
}

function planningContextSentence(context) {
  if (context.Potential_Resilience_Score === null) {
    return "The planning-level Potential Resilience value is unavailable for this selection; Tier 1/2 context remains separate from the observed curve score.";
  }
  return `The planning-level Potential Resilience value is ${assistantMetric(context.Potential_Resilience_Score)}; it is a separate Tier 1/2 context variable and is not part of the observed curve score.`;
}

function buildInitialAssistantInterpretation(context) {
  if (context.detection_status === "no_sustained_drop") {
    return "No sustained below-threshold speed-performance drop was detected under the current v0 rule. This does not prove that the section was unaffected. Short disruptions, smoothing, the selected threshold, or data coverage may influence this result. Phase-dependent curve metrics are therefore shown as unavailable.";
  }

  if (context.detection_status === "no_observed_support") {
    return "This control section does not have direct NPMRDS curve support in the current v0 dataset. Tier 1/2 planning context may still be available, but no observed Q(t)-based performance interpretation is provided.";
  }

  if (context.detection_status === "recovery_endpoint_censored") {
    return `A sustained speed-performance decline was detected during the analysis window, but sustained recovery was not fully observed within the available analysis window. Minimum performance reached approximately ${assistantPercent(context.q_min)} of baseline. The displayed recovery duration and recovery slope should be interpreted as censored or lower-confidence values. ${planningContextSentence(context)}`;
  }

  if (context.q_min === null) {
    return `Direct NPMRDS curve support is present, but phase-dependent metrics are unavailable under the current ${statusLabel(context.detection_status).toLowerCase()} status. No Q(t)-based phase interpretation is generated for unavailable values.`;
  }

  return `A sustained speed-performance decline was detected during the analysis window under the current v0 method. Minimum performance reached approximately ${assistantPercent(context.q_min)} of the baseline level, representing a detected loss depth of ${assistantPercent(context.loss_depth_pct)}. The loss area was ${assistantMetric(context.resilience_loss_area)}; this metric combines the depth and persistence of the detected decline. The detected recovery endpoint occurred approximately ${assistantHours(context.recovery_duration_hours)} after the minimum point. ${planningContextSentence(context)}`;
}

function buildWarningAssistantResponse(context) {
  if (context.detection_status === "no_sustained_drop") {
    return "The current warning means that no sustained below-threshold drop met the v0 detection rule. It does not establish that the section was unaffected; short disruptions, smoothing, threshold selection, or data coverage may influence this status.";
  }
  if (context.detection_status === "recovery_endpoint_censored") {
    return `The current warning means sustained recovery was not fully observed within the available analysis window. The displayed recovery duration of ${assistantHours(context.recovery_duration_hours)} and recovery slope of ${assistantMetric(context.recovery_slope)} are therefore censored or lower-confidence values.`;
  }
  if (context.detection_status === "no_observed_support") {
    return "The current status means this control section has no direct NPMRDS Q(t) curve in the v0 common-support dataset. Tier 1/2 planning context may be displayed, but observed curve metrics are unavailable.";
  }
  if (context.detection_status === "detected") {
    return "The current status is a detected phase pattern. No no-sustained-drop or censored-recovery warning is attached to this section under the current v0 method.";
  }
  return `The current section status is ${statusLabel(context.detection_status)}. No additional warning interpretation is encoded in the displayed dashboard properties.`;
}

function buildPotentialComparisonResponse(context) {
  const observedText = context.score_v0 === null
    ? "The observed curve score v0 is unavailable."
    : `The observed curve score v0 is ${assistantMetric(context.score_v0)}${context.score_class ? `, in the ${context.score_class} runtime class` : ""}; Q_min is ${assistantMetric(context.q_min)}.`;
  return `The Tier 3 observed curve metrics describe speed performance measured during the event analysis window. The Potential Resilience value summarizes Tier 1/2 weather and network context. They measure different concepts and should not be expected to match. ${observedText} The selected Potential Resilience value is ${assistantMetric(context.Potential_Resilience_Score)}, WEATHER_REI is ${assistantMetric(context.WEATHER_REI)}, NETRISK_LITE is ${assistantMetric(context.NETRISK_LITE)}, and EVENT_REI is ${assistantMetric(context.EVENT_REI)}. No causal relationship is assigned by this comparison.`;
}

function buildCurveSummaryResponse(context) {
  if (context.detection_status === "no_observed_support") {
    return "No direct NPMRDS Q(t) curve is available for this control section in the current v0 dataset, so an observed curve summary cannot be generated.";
  }
  if (context.detection_status === "no_sustained_drop") {
    return "The available Q(t) series did not contain a sustained below-threshold drop that met the current v0 rule. Phase onset, minimum, loss area, and recovery metrics are therefore unavailable under this detection result.";
  }
  if (context.q_min === null) {
    return `A Q(t) curve is available, but phase metrics are unavailable under the ${statusLabel(context.detection_status)} status. The prototype does not infer missing onset, minimum, or recovery values.`;
  }
  const phaseTiming = `Detected onset: ${context.onset_time || "N/A"}; minimum point: ${context.min_time || "N/A"}; recovery endpoint: ${context.recovery_end_time || "N/A"}.`;
  const recoveryText = context.detection_status === "recovery_endpoint_censored"
    ? "The recovery endpoint is censored at the available analysis-window boundary."
    : `The detected recovery duration was ${assistantHours(context.recovery_duration_hours)}.`;
  return `Q0 was ${assistantMetric(context.q0)} and Q_min was ${assistantMetric(context.q_min)}, with a loss depth of ${assistantMetric(context.loss_depth)} (${assistantPercent(context.loss_depth_pct)}). The detected loss area was ${assistantMetric(context.resilience_loss_area)}. ${phaseTiming} ${recoveryText}`;
}

function buildReviewNote(context) {
  const observed = context.score_v0 === null
    ? `Observed curve score and phase-dependent metrics are unavailable under the ${statusLabel(context.detection_status)} status.`
    : `Under the current v0 method, the observed curve score is ${assistantMetric(context.score_v0)}, Q_min is ${assistantMetric(context.q_min)}, loss depth is ${assistantPercent(context.loss_depth_pct)}, loss area is ${assistantMetric(context.resilience_loss_area)}, and recovery duration is ${assistantHours(context.recovery_duration_hours)}.`;
  const limitation = context.warning
    ? context.warning
    : "No no-sustained-drop or censored-recovery warning is attached under the current v0 method.";
  return `Section\n${assistantSectionName(context)}, ${context.county || "county unavailable"}. The section has ${context.matched_tmc_count === null ? "N/A" : Math.round(context.matched_tmc_count)} matched TMCs and a data-density summary of ${context.data_density_summary || "N/A"}.\n\nObserved performance\n${observed} These values describe normalized speed performance during the analysis window and do not identify a cause.\n\nPlanning context\nPotential Resilience is ${assistantMetric(context.Potential_Resilience_Score)}, WEATHER_REI is ${assistantMetric(context.WEATHER_REI)}, NETRISK_LITE is ${assistantMetric(context.NETRISK_LITE)}, EVENT_REI is ${assistantMetric(context.EVENT_REI)}, and AADT is ${context.AADT_CS === null ? "N/A" : Math.round(context.AADT_CS).toLocaleString()}. Tier 1/2 context is separate from the observed score.\n\nData/status limitation\n${limitation} Score v0 and its runtime class are experimental and event/method-specific.`;
}

function generatePrototypeAssistantResponse(question, props) {
  const context = buildAssistantContext(props);
  if (!context) {
    return "Select a control section first. The prototype assistant only summarizes metrics attached to the current selection.";
  }

  const normalizedQuestion = String(question || "").trim().toLowerCase();
  if (normalizedQuestion.includes("warning")) {
    return buildWarningAssistantResponse(context);
  }

  if (normalizedQuestion.includes("compare") || normalizedQuestion.includes("potential")) {
    return buildPotentialComparisonResponse(context);
  }

  if (normalizedQuestion.includes("q(t)") || normalizedQuestion.includes("curve")) {
    return buildCurveSummaryResponse(context);
  }

  if (normalizedQuestion.includes("review") || normalizedQuestion.includes("note")) {
    return buildReviewNote(context);
  }

  return buildInitialAssistantInterpretation(context);
}

function normalizedAssistantSectionId(props) {
  if (!props) return null;
  const value = String(
    props.CTRL_SECT_KEY ?? props.CTRL_SECT_NORM ?? props.CTRL_SECT_ ?? ""
  ).trim();
  const digits = value.replace(/^CS_/i, "");
  return /^[1-9][0-9]{0,11}$/.test(digits) ? digits : null;
}

function buildLocalMetricActionText(layerName) {
  const mapping = window.SPTCAssistant?.activeLayerMetrics || {};
  const metricName = Object.prototype.hasOwnProperty.call(mapping, layerName)
    ? mapping[layerName]
    : null;
  if (!metricName) return null;
  return `The current map layer corresponds to the reviewed metric ${metricName}. This result identifies the metric only; it does not assign a preferred direction or interpret the selected section's relative standing.`;
}

function buildAssistantActionSnapshot(props) {
  const context = buildAssistantContext(props);
  return {
    sectionId: normalizedAssistantSectionId(props),
    activeLayer,
    localSectionText: context ? buildInitialAssistantInterpretation(context) : null,
    localMetricText: buildLocalMetricActionText(activeLayer)
  };
}

function resetAssistantForSelection(props) {
  const snapshot = buildAssistantActionSnapshot(props);
  assistantActionController?.setContext(snapshot);
  assistantChatController?.setContext(snapshot);
}

function setupAssistant() {
  if (window.SPTCAssistantActions?.createController) {
    assistantActionController = window.SPTCAssistantActions.createController({ document });
  }
  if (window.SPTCAssistantChat?.createController) {
    assistantChatController = window.SPTCAssistantChat.createController({
      document,
      resetTimelineOnContextChange: false,
      showContextResetNotice: false
    });
  }
  resetAssistantForSelection(null);
}

function setupFloatingAssistant() {
  const launcher = document.getElementById("assistantLauncher");
  const panel = document.getElementById("assistantPanel");
  const close = document.getElementById("assistantClose");

  function setExpanded(expanded, { restoreFocus = false } = {}) {
    launcher.setAttribute("aria-expanded", expanded ? "true" : "false");
    panel.hidden = !expanded;
    panel.setAttribute("aria-hidden", expanded ? "false" : "true");
    if (expanded) {
      close.focus();
    } else if (restoreFocus) {
      launcher.focus();
    }
  }

  launcher.addEventListener("click", () => setExpanded(true));
  launcher.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setExpanded(true);
  });
  close.addEventListener("click", () => setExpanded(false, { restoreFocus: true }));
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || panel.hidden) return;
    event.preventDefault();
    setExpanded(false, { restoreFocus: true });
  });
  setExpanded(false);
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
      ctx.lineWidth = 1.5;
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
  const requestId = ++curveRequestId;
  const card = document.getElementById("curveCard");
  const chartWrap = document.getElementById("curveChartWrap");
  const note = document.getElementById("curveNote");
  const markerLegend = document.getElementById("phaseMarkerLegend");
  if (curveChart) {
    curveChart.destroy();
    curveChart = null;
  }
  phaseOverlayState = null;
  markerLegend.innerHTML = "";
  markerLegend.hidden = true;

  if (!hasCurve(props)) {
    card.style.display = "block";
    chartWrap.hidden = true;
    note.textContent = "No Q(t) curve JSON is available for this control section.";
    return;
  }

  chartWrap.hidden = false;
  note.textContent = "Loading full-window Q(t) curve...";
  const response = await fetch(props.curve_file);
  if (!response.ok) {
    chartWrap.hidden = true;
    note.textContent = "Curve JSON could not be loaded.";
    return;
  }
  const payload = await response.json();
  if (requestId !== curveRequestId) return;
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
    markerLegend.hidden = false;
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
          label: "Raw Q(t) observations",
          data: q,
          borderColor: "rgba(100, 116, 139, 0.42)",
          backgroundColor: "rgba(100, 116, 139, 0.1)",
          borderWidth: 0.9,
          pointRadius: 0,
          tension: 0
        },
        {
          label: "Centered six-observation rolling median",
          data: qSmooth,
          borderColor: "#0f766e",
          borderWidth: 2.5,
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
        legend: {
          display: true,
          labels: {
            boxWidth: 12,
            color: "#465864",
            font: { size: 11 }
          }
        },
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
          grid: { color: "rgba(100, 116, 139, 0.1)" },
          ticks: {
            color: "#62727f",
            font: { size: 11 },
            maxTicksLimit: 6,
            maxRotation: 0,
            minRotation: 0,
            callback: (value, index) => shortDate(labels[index])
          }
        },
        y: {
          min: 0,
          max: Math.min(2, Math.max(1.15, maxQ)),
          title: { display: true, text: "Normalized speed performance Q(t)" },
          grid: { color: "rgba(100, 116, 139, 0.12)" },
          ticks: { color: "#62727f", font: { size: 11 } }
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
  clearSelectedMapHighlight();
  selectedFeature = feature;
  selectedLeafletLayer = layer;
  selectedProps = feature.properties || {};
  createSelectedMapHighlight(selectedFeature);
  applySelectedStyle();
  renderMetrics(selectedProps);
  resetAssistantForSelection(selectedProps);
  await renderCurve(selectedProps);
}

function onEachFeature(feature, layer) {
  const props = feature.properties || {};
  const key = String(props.CTRL_SECT_NORM ?? props.CTRL_SECT_ ?? props.CTRL_SECT_KEY ?? "").trim();
  if (key) {
    layerByCtrl.set(key, layer);
    featureByCtrl.set(key, feature);
  }
  layer.bindTooltip(makeTooltip(props), {
    sticky: true,
    direction: "top",
    opacity: 0.96,
    className: "cs-tooltip"
  });
  layer.on({
    click: () => selectFeature(feature, layer),
    mouseover: () => {
      map.getContainer().style.cursor = "pointer";
      if (layer !== selectedLeafletLayer) {
        layer.setStyle({ weight: 4.5, opacity: 1 });
        if (layer.bringToFront) layer.bringToFront();
      }
      applySelectedStyle();
    },
    mouseout: () => {
      map.getContainer().style.cursor = "";
      if (layer !== selectedLeafletLayer && controlLayer) {
        controlLayer.resetStyle(layer);
      }
      applySelectedStyle();
    }
  });
}

function setupCurveDetails() {
  const details = document.getElementById("curveDetails");
  details.addEventListener("toggle", () => {
    if (!details.open || !curveChart) return;
    requestAnimationFrame(() => curveChart?.resize());
  });
}

function desktopAnalysisLayoutActive() {
  return window.matchMedia("(min-width: 981px)").matches;
}

function analysisPanelWidthBounds() {
  const shell = document.querySelector(".app-shell");
  const splitter = document.getElementById("analysisSplitter");
  const shellStyle = window.getComputedStyle(shell);
  const horizontalPadding = Number.parseFloat(shellStyle.paddingLeft || "0")
    + Number.parseFloat(shellStyle.paddingRight || "0");
  const availableWidth = Math.max(0, shell.getBoundingClientRect().width - horizontalPadding);
  const splitterWidth = splitter.getBoundingClientRect().width || 10;
  const dynamicMaximum = availableWidth - splitterWidth - MAP_MIN_DESKTOP_WIDTH;
  return {
    min: ANALYSIS_PANEL_MIN_WIDTH,
    max: Math.max(
      ANALYSIS_PANEL_MIN_WIDTH,
      Math.min(ANALYSIS_PANEL_MAX_WIDTH, dynamicMaximum)
    )
  };
}

function scheduleWorkspaceResize() {
  if (analysisResizeFrame !== null) return;
  analysisResizeFrame = window.requestAnimationFrame(() => {
    analysisResizeFrame = null;
    map?.invalidateSize({ pan: false, debounceMoveend: true });
    curveChart?.resize();
  });
}

function applyAnalysisPanelWidth(requestedWidth) {
  if (!desktopAnalysisLayoutActive()) return analysisPanelWidth;
  const shell = document.querySelector(".app-shell");
  const splitter = document.getElementById("analysisSplitter");
  const bounds = analysisPanelWidthBounds();
  analysisPanelWidth = Math.round(Math.min(bounds.max, Math.max(bounds.min, requestedWidth)));
  shell.style.setProperty("--analysis-panel-width", `${analysisPanelWidth}px`);
  splitter.setAttribute("aria-valuemin", String(bounds.min));
  splitter.setAttribute("aria-valuemax", String(Math.round(bounds.max)));
  splitter.setAttribute("aria-valuenow", String(analysisPanelWidth));
  splitter.setAttribute("aria-valuetext", `${analysisPanelWidth} pixels`);
  scheduleWorkspaceResize();
  return analysisPanelWidth;
}

function finishAnalysisResize(splitter) {
  document.body.classList.remove("is-analysis-resizing");
  if (
    analysisResizePointerId !== null
    && splitter.hasPointerCapture?.(analysisResizePointerId)
  ) {
    splitter.releasePointerCapture(analysisResizePointerId);
  }
  analysisResizePointerId = null;
  scheduleWorkspaceResize();
}

function setupAnalysisSplitter() {
  const shell = document.querySelector(".app-shell");
  const splitter = document.getElementById("analysisSplitter");

  splitter.addEventListener("pointerdown", event => {
    if (!desktopAnalysisLayoutActive() || event.button !== 0) return;
    analysisResizePointerId = event.pointerId;
    splitter.setPointerCapture?.(event.pointerId);
    document.body.classList.add("is-analysis-resizing");
    event.preventDefault();
  });

  window.addEventListener("pointermove", event => {
    if (analysisResizePointerId !== event.pointerId || !desktopAnalysisLayoutActive()) return;
    const shellLeft = shell.getBoundingClientRect().left
      + Number.parseFloat(window.getComputedStyle(shell).paddingLeft || "0");
    applyAnalysisPanelWidth(event.clientX - shellLeft);
    event.preventDefault();
  });

  window.addEventListener("pointerup", event => {
    if (analysisResizePointerId !== event.pointerId) return;
    finishAnalysisResize(splitter);
  });
  window.addEventListener("pointercancel", event => {
    if (analysisResizePointerId !== event.pointerId) return;
    finishAnalysisResize(splitter);
  });

  splitter.addEventListener("keydown", event => {
    if (!desktopAnalysisLayoutActive()) return;
    const bounds = analysisPanelWidthBounds();
    let nextWidth = null;
    if (event.key === "ArrowLeft") {
      nextWidth = analysisPanelWidth - ANALYSIS_PANEL_KEYBOARD_STEP;
    } else if (event.key === "ArrowRight") {
      nextWidth = analysisPanelWidth + ANALYSIS_PANEL_KEYBOARD_STEP;
    } else if (event.key === "Home") {
      nextWidth = bounds.min;
    } else if (event.key === "End") {
      nextWidth = bounds.max;
    }
    if (nextWidth === null) return;
    event.preventDefault();
    applyAnalysisPanelWidth(nextWidth);
  });

  window.addEventListener("resize", () => {
    if (desktopAnalysisLayoutActive()) {
      applyAnalysisPanelWidth(analysisPanelWidth);
    } else {
      finishAnalysisResize(splitter);
      scheduleWorkspaceResize();
    }
  });

  applyAnalysisPanelWidth(ANALYSIS_PANEL_DEFAULT_WIDTH);
}

async function initMap() {
  map = L.map("map", {
    preferCanvas: true,
    zoomControl: true
  }).setView([31.1, -99.3], 6);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    className: "resilience-basemap-tile",
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  setupMapLegendControl();

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
    renderer: controlRenderer,
    style: featureStyle,
    onEachFeature
  }).addTo(map);

  map.on("zoomend", () => {
    if (controlLayer) {
      controlLayer.setStyle(featureStyle);
      applySelectedStyle();
    }
  });

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
  resetAssistantForSelection(selectedProps);
});

setupFloatingAssistant();
setupAssistant();
setupCurveDetails();
setupAnalysisSplitter();

initMap().catch(error => {
  console.error(error);
  document.getElementById("selectedSub").textContent = "Dashboard failed to load. Check local server and data files.";
});
