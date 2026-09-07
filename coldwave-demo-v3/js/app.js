const MAP_URL = "./data/data_driven_resilience_map_v0.geojson";
const SUMMARY_URL = "./data/summary.json";

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

const analysisLayerConfig = Object.freeze({
  tier1: Object.freeze({
    label: "Tier 1 — Weather Resilience Context",
    shortLabel: "Tier 1 — Weather",
    panelEyebrow: "Tier 1",
    panelHeading: "Weather Resilience Context",
    sourceField: "WEATHER_REI",
    publicMetric: "weather_rei",
    type: "continuous",
    ramp: riskRamp,
    min: 0,
    max: 1,
    description: "Higher values indicate stronger precipitation and pavement-exposure concern for this event."
  }),
  tier2: Object.freeze({
    label: "Tier 2 — Network Resilience Context",
    shortLabel: "Tier 2 — Network",
    panelEyebrow: "Tier 2",
    panelHeading: "Network Resilience Context",
    sourceField: "NETRISK_LITE",
    publicMetric: "network_rei",
    type: "continuous",
    ramp: riskRamp,
    min: 0,
    max: 1,
    description: "Higher values indicate stronger network consequence and constraint concern."
  }),
  potential: Object.freeze({
    label: "Tier 1+2 — Potential Resilience",
    shortLabel: "Tier 1+2 — Potential",
    panelEyebrow: "Tier 1+2",
    panelHeading: "Potential Resilience",
    sourceField: "Potential_Resilience_Score",
    publicMetric: "potential_resilience_score",
    type: "continuous",
    ramp: scoreRamp,
    min: 0,
    max: 1,
    description: "Higher values indicate more favorable combined planning context; this is not observed performance."
  }),
  tier3: Object.freeze({
    label: "Tier 3 — Observed Resilience",
    shortLabel: "Tier 3 — Observed Resilience",
    panelEyebrow: "Tier 3",
    panelHeading: "Observed Resilience",
    sourceField: "observed_curve_resilience_score_v0",
    publicMetric: "observed_resilience_score",
    type: "scoreClass",
    ramp: scoreClassColors,
    description: "Higher values indicate more favorable observed operational resilience for supported sections in this event."
  })
});

let map;
let mapData;
let controlLayer;
let activeAnalysisLayer = "tier3";
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
  Object.values(analysisLayerConfig).forEach(cfg => {
    if (cfg.type !== "continuous") return;
    const field = cfg.sourceField;
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
  const cfg = analysisLayerConfig[activeAnalysisLayer];
  if (cfg.type === "scoreClass") {
    if (isNoSustainedDrop(props)) return detectionColors.no_sustained_drop;
    const cls = scoreClassInfo(props);
    return cls ? cls.color : "#9ca3af";
  }
  return rampColor(props[cfg.sourceField], cfg, cfg.sourceField);
}

function featureStyle(feature) {
  const props = feature.properties || {};
  const cfg = analysisLayerConfig[activeAnalysisLayer];
  const hasValue = cfg.type === "scoreClass"
    ? Boolean(scoreClassInfo(props)) || isNoSustainedDrop(props)
    : numberOrNull(props[cfg.sourceField]) !== null;
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
  const cfg = analysisLayerConfig[activeAnalysisLayer];
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
      <p class="layer-note">${cfg.description}</p>
      <p class="layer-note">Classes are runtime quantiles for this release, not official resilience categories.</p>
    `;
    return;
  }
  const range = ranges[cfg.sourceField] || { min: 0, max: 1 };
  const gradient = cfg.ramp.map((color, i) => `${color} ${(i / (cfg.ramp.length - 1)) * 100}%`).join(", ");
  legend.innerHTML = `
    <div class="legend-title">${cfg.label}</div>
    <div class="ramp" style="background: linear-gradient(90deg, ${gradient});"></div>
    <div class="ramp-labels"><span>${range.min.toFixed(2)}</span><span>${range.max.toFixed(2)}</span></div>
    <p class="layer-note">${cfg.description}</p>
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

function renderSelectedIdentity(props) {
  const title = document.getElementById("selectedTitle");
  const subtitle = document.getElementById("selectedSub");
  const badges = document.getElementById("statusBadges");
  const warning = document.getElementById("warningCard");
  if (!props) {
    title.textContent = "No section selected";
    subtitle.textContent = "Click a control section on the map or use search.";
    badges.replaceChildren();
    warning.hidden = true;
    warning.textContent = "";
    return;
  }

  title.textContent = `${props.ROUTE_KEY || "Route unknown"} | CS ${props.CTRL_SECT_ || props.CTRL_SECT_NORM}`;
  subtitle.textContent = `${props.county_name || props.county || "County unknown"} | ${props.event_id || "coldwave_2026_01"}`;
  warning.hidden = true;
  warning.textContent = "";
  if (activeAnalysisLayer !== "tier3") {
    badges.replaceChildren();
    return;
  }

  const status = statusKey(props);
  const badgeClass = status === "detected"
    ? "detected"
    : (status === "no_observed_support" ? "missing" : "warning");
  badges.innerHTML = [
    `<span class="badge ${badgeClass}">${statusLabel(status)}</span>`,
    `<span class="badge">Observed support: ${hasCurve(props) ? "yes" : "no"}</span>`
  ].join("");

  if (isNoSustainedDrop(props)) {
    warning.textContent = "No sustained drop was detected under the current rule; this is not evidence of no impact.";
  } else if (isCensored(props)) {
    warning.textContent = "Recovery is censored at the available analysis boundary; the displayed recovery value requires caution.";
  } else if (!hasCurve(props)) {
    warning.textContent = "No direct observed Q(t) support is available; missing support is not low resilience.";
  }
  warning.hidden = warning.textContent.length === 0;
}

function tierMetricCards(props) {
  if (activeAnalysisLayer === "tier1") {
    return [
      metricCard("WEATHER_REI", fmt(props.WEATHER_REI), "", "Precipitation-related roadway exposure adjusted by pavement/surface susceptibility.", "weather_rei")
    ];
  }
  if (activeAnalysisLayer === "tier2") {
    return [
      metricCard("NETWORK_REI", fmt(props.NETRISK_LITE), "", "Network consequence and local redundancy context.", "network_rei"),
      metricCard("AADT", fmtInt(props.AADT_CS), "", "Vehicles per day; the current aggregation can be non-integer.", "aadt")
    ];
  }
  if (activeAnalysisLayer === "potential") {
    return [
      metricCard("Potential Resilience", fmt(props.Potential_Resilience_Score), "", "More favorable planning context is higher.", "potential_resilience_score"),
      metricCard("Tier 1 — Weather", fmt(props.WEATHER_REI), "", "Higher means stronger weather/pavement exposure concern.", "weather_rei"),
      metricCard("Tier 2 — Network", fmt(props.NETRISK_LITE), "", "Higher means stronger network-context concern.", "network_rei")
    ];
  }

  const noSustained = isNoSustainedDrop(props);
  const censored = isCensored(props);
  return [
    metricCard("Score", noSustained ? "N/A" : fmt(props.observed_curve_resilience_score_v0), "", "", "observed_resilience_score"),
    metricCard("Minimum", noSustained ? "N/A" : fmt(props.q_min), "", "", "q_min"),
    metricCard("Loss Area", phaseValue(props, "resilience_loss_area"), "", "", "resilience_loss_area"),
    metricCard("Recovery", phaseValue(props, "recovery_duration_hours", fmtHours), censored ? "caution" : "", censored ? "Censored at the available boundary." : "", "recovery_duration_hours")
  ];
}

function renderAnalysisPanel(props) {
  const cfg = analysisLayerConfig[activeAnalysisLayer];
  const empty = document.getElementById("tierEmptyState");
  const metrics = document.getElementById("tierMetrics");
  const footnote = document.getElementById("tierFootnote");
  const curvePanel = document.getElementById("curvePanel");
  document.getElementById("tierPanelEyebrow").textContent = cfg.panelEyebrow;
  document.getElementById("tierPanelHeading").textContent = cfg.panelHeading;
  document.getElementById("activeTierChip").textContent = cfg.shortLabel;
  renderSelectedIdentity(props);
  curvePanel.hidden = activeAnalysisLayer !== "tier3";

  if (!props) {
    empty.hidden = false;
    empty.textContent = `Select a control section to view its ${cfg.shortLabel} evidence.`;
    metrics.hidden = true;
    metrics.replaceChildren();
    footnote.hidden = true;
    footnote.textContent = "";
    return;
  }

  empty.hidden = true;
  metrics.innerHTML = tierMetricCards(props).join("");
  metrics.hidden = false;
  const notes = {
    tier1: "Tier 1 is event-specific planning context, not a complete cold-wave hazard model.",
    tier2: "Tier 2 is network-planning context and does not measure observed event performance.",
    potential: "Potential Resilience combines Tier 1 and Tier 2 planning context; it is not Tier 3 observed evidence.",
    tier3: "Observed results apply to the current event, method, and common-support sample."
  };
  footnote.textContent = notes[activeAnalysisLayer];
  footnote.hidden = false;
}

function buildAssistantContext(props) {
  if (!props) return null;
  const cls = scoreClassInfo(props);
  const status = statusKey(props);
  let warning = null;
  if (status === "no_sustained_drop") {
    warning = "No sustained drop was detected under the current method.";
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
    observed_resilience_score: isNoSustainedDrop(props) ? null : numberOrNull(props.observed_curve_resilience_score_v0),
    score_class: cls ? cls.label : null,
    q0: numberOrNull(props.q0),
    q_min: isNoSustainedDrop(props) ? null : numberOrNull(props.q_min),
    loss_depth: isNoSustainedDrop(props) ? null : numberOrNull(props.loss_depth),
    loss_depth_fraction: isNoSustainedDrop(props) ? null : numberOrNull(props.loss_depth_pct),
    resilience_loss_area: isNoSustainedDrop(props) ? null : numberOrNull(props.resilience_loss_area),
    recovery_duration_hours: isNoSustainedDrop(props) ? null : numberOrNull(props.recovery_duration_hours),
    recovery_slope: isNoSustainedDrop(props) ? null : numberOrNull(props.recovery_slope),
    onset_time: props.onset_time || null,
    min_time: props.min_time || null,
    recovery_end_time: props.recovery_end_time || null,
    Potential_Resilience_Score: numberOrNull(props.Potential_Resilience_Score),
    WEATHER_REI: numberOrNull(props.WEATHER_REI),
    network_rei: numberOrNull(props.NETRISK_LITE),
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
    return "The planning-level Potential Resilience value is unavailable for this selection; Tier 1/2 context remains separate from observed performance.";
  }
  return `The planning-level Potential Resilience value is ${assistantMetric(context.Potential_Resilience_Score)}; it is a separate Tier 1/2 context variable and is not part of the observed performance measure.`;
}

function buildInitialAssistantInterpretation(context) {
  if (context.detection_status === "no_sustained_drop") {
    return "No sustained below-threshold speed-performance drop was detected under the current method. This does not prove that the section was unaffected. Short disruptions, smoothing, the selected threshold, or data coverage may influence this result. Phase-dependent curve metrics are therefore shown as unavailable.";
  }

  if (context.detection_status === "no_observed_support") {
    return "This control section does not have direct NPMRDS curve support in the current dataset. Tier 1/2 planning context may still be available, but no observed Q(t)-based performance interpretation is provided.";
  }

  if (context.detection_status === "recovery_endpoint_censored") {
    return `A sustained speed-performance decline was detected during the analysis window, but sustained recovery was not fully observed within the available analysis window. Minimum performance reached approximately ${assistantPercent(context.q_min)} of baseline. The displayed recovery duration and recovery slope should be interpreted as censored or lower-confidence values. ${planningContextSentence(context)}`;
  }

  if (context.q_min === null) {
    return `Direct NPMRDS curve support is present, but phase-dependent metrics are unavailable under the current ${statusLabel(context.detection_status).toLowerCase()} status. No Q(t)-based phase interpretation is generated for unavailable values.`;
  }

  return `A sustained speed-performance decline was detected during the analysis window under the current method. Minimum performance reached approximately ${assistantPercent(context.q_min)} of the baseline level, representing a detected loss depth of ${assistantPercent(context.loss_depth_fraction)}. The loss area was ${assistantMetric(context.resilience_loss_area)}; this metric combines the depth and persistence of the detected decline. The detected recovery endpoint occurred approximately ${assistantHours(context.recovery_duration_hours)} after the minimum point. ${planningContextSentence(context)}`;
}

function buildWarningAssistantResponse(context) {
  if (context.detection_status === "no_sustained_drop") {
    return "The current warning means that no sustained below-threshold drop met the detection rule. It does not establish that the section was unaffected; short disruptions, smoothing, threshold selection, or data coverage may influence this status.";
  }
  if (context.detection_status === "recovery_endpoint_censored") {
    return `The current warning means sustained recovery was not fully observed within the available analysis window. The displayed recovery duration of ${assistantHours(context.recovery_duration_hours)} and recovery slope of ${assistantMetric(context.recovery_slope)} are therefore censored or lower-confidence values.`;
  }
  if (context.detection_status === "no_observed_support") {
    return "The current status means this control section has no direct NPMRDS Q(t) curve in the common-support dataset. Tier 1/2 planning context may be displayed, but observed curve metrics are unavailable.";
  }
  if (context.detection_status === "detected") {
    return "The current status is a detected phase pattern. No no-sustained-drop or censored-recovery warning is attached to this section under the current method.";
  }
  return `The current section status is ${statusLabel(context.detection_status)}. No additional warning interpretation is encoded in the displayed dashboard properties.`;
}

function buildPotentialComparisonResponse(context) {
  const observedText = context.observed_resilience_score === null
    ? "The Tier 3 observed resilience score is unavailable."
    : `The Tier 3 observed resilience score is ${assistantMetric(context.observed_resilience_score)}${context.score_class ? `, in the ${context.score_class} runtime class` : ""}; Minimum is ${assistantMetric(context.q_min)}.`;
  return `Tier 3 metrics describe speed performance measured during the event analysis window. Potential Resilience summarizes Tier 1 and Tier 2 planning context. They measure different concepts and should not be expected to match. ${observedText} The selected Potential Resilience value is ${assistantMetric(context.Potential_Resilience_Score)}, WEATHER_REI is ${assistantMetric(context.WEATHER_REI)}, and NETWORK_REI is ${assistantMetric(context.network_rei)}. No causal relationship is assigned by this comparison.`;
}

function buildCurveSummaryResponse(context) {
  if (context.detection_status === "no_observed_support") {
    return "No direct NPMRDS Q(t) curve is available for this control section in the current dataset, so an observed curve summary cannot be generated.";
  }
  if (context.detection_status === "no_sustained_drop") {
    return "The available Q(t) series did not contain a sustained below-threshold drop that met the current method. Phase onset, minimum, loss area, and recovery metrics are therefore unavailable under this detection result.";
  }
  if (context.q_min === null) {
    return `A Q(t) curve is available, but phase metrics are unavailable under the ${statusLabel(context.detection_status)} status. The prototype does not infer missing onset, minimum, or recovery values.`;
  }
  const phaseTiming = `Detected onset: ${context.onset_time || "N/A"}; minimum point: ${context.min_time || "N/A"}; recovery endpoint: ${context.recovery_end_time || "N/A"}.`;
  const recoveryText = context.detection_status === "recovery_endpoint_censored"
    ? "The recovery endpoint is censored at the available analysis-window boundary."
    : `The detected recovery duration was ${assistantHours(context.recovery_duration_hours)}.`;
  return `Q0 was ${assistantMetric(context.q0)} and Minimum was ${assistantMetric(context.q_min)}, with a loss depth of ${assistantMetric(context.loss_depth)} (${assistantPercent(context.loss_depth_fraction)}). The detected loss area was ${assistantMetric(context.resilience_loss_area)}. ${phaseTiming} ${recoveryText}`;
}

function buildReviewNote(context) {
  const observed = context.observed_resilience_score === null
    ? `The Tier 3 score and phase-dependent metrics are unavailable under the ${statusLabel(context.detection_status)} status.`
    : `Under the current method, the Tier 3 score is ${assistantMetric(context.observed_resilience_score)}, Minimum is ${assistantMetric(context.q_min)}, loss depth is ${assistantPercent(context.loss_depth_fraction)}, loss area is ${assistantMetric(context.resilience_loss_area)}, and recovery duration is ${assistantHours(context.recovery_duration_hours)}.`;
  const limitation = context.warning
    ? context.warning
    : "No no-sustained-drop or censored-recovery warning is attached under the current method.";
  return `Section\n${assistantSectionName(context)}, ${context.county || "county unavailable"}. The section has ${context.matched_tmc_count === null ? "N/A" : Math.round(context.matched_tmc_count)} matched TMCs and a data-density summary of ${context.data_density_summary || "N/A"}.\n\nObserved performance\n${observed} These values describe normalized speed performance during the analysis window and do not identify a cause.\n\nPlanning context\nPotential Resilience is ${assistantMetric(context.Potential_Resilience_Score)}, WEATHER_REI is ${assistantMetric(context.WEATHER_REI)}, NETWORK_REI is ${assistantMetric(context.network_rei)}, and AADT is ${context.AADT_CS === null ? "N/A" : Math.round(context.AADT_CS).toLocaleString()}. Tier 1/2 context is separate from observed performance.\n\nData/status limitation\n${limitation} The Tier 3 score and runtime class are experimental and event/method-specific.`;
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
    activeLayer: activeAnalysisLayer,
    activeTier: activeAnalysisLayer,
    localSectionText: context ? buildInitialAssistantInterpretation(context) : null,
    localMetricText: buildLocalMetricActionText(activeAnalysisLayer)
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
    note.textContent = "No sustained drop was detected under the current method. The curve is shown for review, but phase-dependent metrics are not treated as final.";
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
  renderAnalysisPanel(selectedProps);
  resetAssistantForSelection(selectedProps);
  if (activeAnalysisLayer === "tier3") {
    await renderCurve(selectedProps);
  }
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

function refreshMapStyles() {
  if (controlLayer) {
    controlLayer.setStyle(featureStyle);
    applySelectedStyle();
  }
  updateLegend();
}

function syncTierControlState() {
  document.querySelectorAll("[data-analysis-layer]").forEach(button => {
    const active = button.dataset.analysisLayer === activeAnalysisLayer;
    button.setAttribute("aria-checked", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  });
  const mobileSelect = document.getElementById("tierSelect");
  if (mobileSelect.value !== activeAnalysisLayer) mobileSelect.value = activeAnalysisLayer;
}

async function setActiveAnalysisLayer(nextLayer) {
  if (!Object.prototype.hasOwnProperty.call(analysisLayerConfig, nextLayer)) return;
  const changed = nextLayer !== activeAnalysisLayer;
  activeAnalysisLayer = nextLayer;
  syncTierControlState();

  if (changed) {
    ++curveRequestId;
    refreshMapStyles();
    renderAnalysisPanel(selectedProps);
    resetAssistantForSelection(selectedProps);
  }
  if (activeAnalysisLayer === "tier3" && selectedProps) {
    await renderCurve(selectedProps);
  }
  requestAnimationFrame(() => {
    map?.invalidateSize({ pan: false, debounceMoveend: true });
    curveChart?.resize();
  });
}

function setupTierControls() {
  const control = document.getElementById("analysisTierControl");
  const buttons = Array.from(control.querySelectorAll("[data-analysis-layer]"));
  syncTierControlState();
  control.addEventListener("click", event => {
    const button = event.target.closest("[data-analysis-layer]");
    if (!button) return;
    setActiveAnalysisLayer(button.dataset.analysisLayer);
  });
  control.addEventListener("keydown", event => {
    const currentIndex = buttons.findIndex(button => button.dataset.analysisLayer === activeAnalysisLayer);
    let nextIndex = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % buttons.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = buttons.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    buttons[nextIndex].focus();
    setActiveAnalysisLayer(buttons[nextIndex].dataset.analysisLayer);
  });
  document.getElementById("tierSelect").addEventListener("change", event => {
    setActiveAnalysisLayer(event.target.value);
  });
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

setupFloatingAssistant();
setupAssistant();
setupTierControls();
renderAnalysisPanel(null);

initMap().catch(error => {
  console.error(error);
  document.getElementById("selectedSub").textContent = "Dashboard failed to load. Check local server and data files.";
});
