const DATA_URL = "./data/coldwave_resilience_map.geojson";
const SUMMARY_URL = "./data/coldwave_summary.json";
const CURVE_STATUS_URL = "./data/curve_data_status.json";

const scoreRamp = ["#b2182b", "#ef8a62", "#f7f7f7", "#67a9cf", "#2166ac"];
const timeRamp = ["#d9f0a3", "#78c679", "#41b6c4", "#2c7fb8", "#54278f"];

const methodLabels = {
  Hybrid_potential_observed: "Hybrid: potential + observed",
  Potential_only: "Potential-only"
};

const evidenceLabels = {
  A_hybrid_direct_observed_high_quality: "A: Hybrid + high-quality observed support",
  B_hybrid_direct_observed_lower_quality: "B: Hybrid + lower-quality observed support",
  C_potential_only_no_observed_support: "C: Potential-only, no observed support"
};

const layerConfig = {
  Cold_Wave_Resilience_Score: {
    label: "Cold-Wave Resilience Score",
    type: "score",
    description: "Higher = more resilient.",
    ramp: scoreRamp,
    min: 0,
    max: 1
  },
  Potential_Resilience_Score: {
    label: "Potential Resilience Score",
    type: "score",
    description: "Tier 1/2 potential resilience; higher = better.",
    ramp: scoreRamp,
    min: 0,
    max: 1
  },
  Observed_Resilience_ImpactFocused: {
    label: "Observed Resilience, Impact-focused",
    type: "score",
    description: "Observed resistance, absorption, and recovery where NPMRDS support exists.",
    ramp: scoreRamp,
    min: 0,
    max: 1
  },
  Observed_Recovery_Capacity_Score_v2: {
    label: "Recovery Capacity Score",
    type: "score",
    description: "Recovery speed and completeness; higher = better.",
    ramp: scoreRamp,
    min: 0,
    max: 1
  },
  Time_To_90pct_Baseline_Hours: {
    label: "Time to 90% Baseline",
    type: "time",
    description: "Lower hours = faster recovery.",
    ramp: timeRamp
  },
  Cold_Wave_Resilience_Score_Method: {
    label: "Score Method",
    type: "category",
    colors: {
      Hybrid_potential_observed: "#c84b4b",
      Potential_only: "#9ca3af"
    }
  },
  Score_Evidence_Level: {
    label: "Evidence Level",
    type: "category",
    colors: {
      A_hybrid_direct_observed_high_quality: "#2b8cbe",
      B_hybrid_direct_observed_lower_quality: "#fdae61",
      C_potential_only_no_observed_support: "#9ca3af"
    }
  }
};

let map;
let geojsonData;
let geojsonLayer;
let activeLayer = "Cold_Wave_Resilience_Score";
let selectedLayer = null;
let curveChart = null;
let layerRanges = {};

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmt(value, digits = 3) {
  const n = numberOrNull(value);
  if (n === null) return "-";
  return n.toFixed(digits);
}

function fmtHours(value) {
  const n = numberOrNull(value);
  if (n === null) return "-";
  return `${n.toFixed(1)} h`;
}

function fmtInt(value) {
  const n = numberOrNull(value);
  if (n === null) return "-";
  return Math.round(n).toLocaleString();
}

function displayMethod(value) {
  return methodLabels[value] || value || "-";
}

function displayEvidence(value) {
  return evidenceLabels[value] || value || "-";
}

function displayCounty(props) {
  const raw = props.county_name ?? props.county ?? props.COUNTY ?? "Unknown";
  const text = String(raw || "Unknown").trim();
  if (!text || text === "-" || text.toLowerCase() === "nan" || text.toLowerCase() === "none") return "Unknown";
  if (text.toLowerCase() === "unknown") return "Unknown";
  return text.toUpperCase();
}

function hasObservedSupport(props) {
  return props.Observed_Data_Available === "Yes"
    && props.Cold_Wave_Resilience_Score_Method !== "Potential_only"
    && props.Score_Evidence_Level !== "C_potential_only_no_observed_support";
}

function fmtObserved(props, field, digits = 3) {
  if (!hasObservedSupport(props)) return "N/A";
  const n = numberOrNull(props[field]);
  if (n === null) return "N/A";
  return n.toFixed(digits);
}

function fmtObservedHours(props, field) {
  if (!hasObservedSupport(props)) return "N/A";
  const n = numberOrNull(props[field]);
  if (n === null) return "N/A";
  return `${n.toFixed(1)} h`;
}

function methodClass(value) {
  return value === "Hybrid_potential_observed" ? "hybrid" : "potential";
}

function evidenceClass(value) {
  if (value === "A_hybrid_direct_observed_high_quality") return "evidence-a";
  if (value === "B_hybrid_direct_observed_lower_quality") return "evidence-b";
  return "evidence-c";
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16)
  ];
}

function rgbToHex(rgb) {
  return `#${rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

function interpolateColor(stops, t) {
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(scaled));
  const local = scaled - idx;
  const a = hexToRgb(stops[idx]);
  const b = hexToRgb(stops[idx + 1]);
  return rgbToHex(a.map((v, i) => v + (b[i] - v) * local));
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function computeRanges() {
  Object.keys(layerConfig).forEach(field => {
    const cfg = layerConfig[field];
    if (cfg.type === "category") return;
    const vals = geojsonData.features
      .map(f => numberOrNull(f.properties[field]))
      .filter(v => v !== null);
    if (!vals.length) {
      layerRanges[field] = { min: 0, max: 1 };
      return;
    }
    if (cfg.type === "score") {
      layerRanges[field] = { min: 0, max: 1 };
    } else {
      const min = Math.max(0, percentile(vals, 0.01) ?? Math.min(...vals));
      const max = percentile(vals, 0.99) ?? Math.max(...vals);
      layerRanges[field] = { min, max: max > min ? max : min + 1 };
    }
  });
}

function getFeatureColor(props) {
  const cfg = layerConfig[activeLayer];
  if (cfg.type === "category") {
    return cfg.colors[props[activeLayer]] || "#cbd5e1";
  }
  const value = numberOrNull(props[activeLayer]);
  if (value === null) return "#cbd5e1";
  const range = layerRanges[activeLayer] || { min: cfg.min ?? 0, max: cfg.max ?? 1 };
  const t = (value - range.min) / (range.max - range.min);
  return interpolateColor(cfg.ramp, t);
}

function styleFeature(feature) {
  const props = feature.properties || {};
  const selected = selectedLayer && selectedLayer.feature && selectedLayer.feature.properties.CTRL_SECT_ === props.CTRL_SECT_;
  return {
    color: selected ? "#111827" : getFeatureColor(props),
    weight: selected ? 6.5 : 3.2,
    opacity: selected ? 1 : 0.88
  };
}

function updateLegend() {
  const cfg = layerConfig[activeLayer];
  const legend = document.getElementById("legend");
  if (!legend) return;
  if (cfg.type === "category") {
    legend.innerHTML = `
      <div class="legend-title">${cfg.label}</div>
      ${Object.entries(cfg.colors).map(([label, color]) => `
        <div class="legend-row"><span class="swatch" style="background:${color}"></span><span>${activeLayer === "Score_Evidence_Level" ? displayEvidence(label) : displayMethod(label)}</span></div>
      `).join("")}
      ${activeLayer === "Score_Evidence_Level" ? `<div class="legend-row">Potential-only does not mean low resilience.</div>` : ""}
    `;
    return;
  }
  const range = layerRanges[activeLayer] || { min: cfg.min ?? 0, max: cfg.max ?? 1 };
  legend.innerHTML = `
    <div class="legend-title">${cfg.label}</div>
    <div class="legend-row">${cfg.description || ""}</div>
    <div class="ramp" style="background:linear-gradient(to right, ${cfg.ramp.join(",")})"></div>
    <div class="ramp-labels"><span>${fmt(range.min, cfg.type === "time" ? 1 : 2)}</span><span>${fmt(range.max, cfg.type === "time" ? 1 : 2)}</span></div>
  `;
}

function popupHtml(props) {
  const observed = hasObservedSupport(props);
  const note = observed && props.curve_file
    ? "Observed curve is available in the side panel."
    : observed
      ? "Observed summary support is available; no hourly curve is available for this section."
      : "No direct NPMRDS observed support. This section is scored using Tier 1/2 potential resilience only.";
  const observedLine = observed
    ? `<div>Observed Impact-focused: ${fmtObserved(props, "Observed_Resilience_ImpactFocused")}</div>`
    : "";
  return `
    <div>
      <div class="popup-title">${props.ROUTE_KEY || props.road || "Control section"}</div>
      <div>CTRL_SECT_: ${props.CTRL_SECT_ ?? "-"}</div>
      <div>County: ${displayCounty(props)}</div>
      <div>Cold-Wave Score: ${fmt(props.Cold_Wave_Resilience_Score)}</div>
      <div>Potential Resilience: ${fmt(props.Potential_Resilience_Score)}</div>
      ${observedLine}
      <div>Evidence: ${displayEvidence(props.Score_Evidence_Level)}</div>
      <div class="popup-note">${note}</div>
    </div>
  `;
}

function drawMap() {
  if (geojsonLayer) map.removeLayer(geojsonLayer);
  geojsonLayer = L.geoJSON(geojsonData, {
    style: styleFeature,
    onEachFeature(feature, layer) {
      layer.bindPopup(popupHtml(feature.properties || {}));
      layer.on("click", () => selectFeature(layer));
      layer.on("mouseover", () => layer.setStyle({ weight: 5.5, opacity: 1 }));
      layer.on("mouseout", () => refreshStyles());
    }
  }).addTo(map);
  map.fitBounds(geojsonLayer.getBounds(), { padding: [24, 24] });
  updateLegend();
}

function refreshStyles() {
  if (!geojsonLayer) return;
  geojsonLayer.eachLayer(layer => {
    if (layer.setStyle && layer.feature) layer.setStyle(styleFeature(layer.feature));
  });
  if (selectedLayer && selectedLayer.bringToFront) selectedLayer.bringToFront();
}

function metric(label, value, digits = 3, full = false) {
  return `<div class="metric ${full ? "full" : ""}"><span>${label}</span><strong>${fmt(value, digits)}</strong></div>`;
}

function metricText(label, value, full = false) {
  return `<div class="metric ${full ? "full" : ""}"><span>${label}</span><strong>${value}</strong></div>`;
}

function updateSelectedPanel(props) {
  document.getElementById("selectedTitle").textContent = props.ROUTE_KEY || props.road || "Control section";
  document.getElementById("selectedSub").textContent = `CTRL_SECT_: ${props.CTRL_SECT_ ?? "-"} | County: ${displayCounty(props)}`;
  document.getElementById("metricGrid").innerHTML = [
    metric("Cold-Wave Score", props.Cold_Wave_Resilience_Score),
    metric("Potential", props.Potential_Resilience_Score),
    metricText("Observed", fmtObserved(props, "Observed_Resilience_ImpactFocused")),
    metricText("Resistance", fmtObserved(props, "Observed_Resistance_Score")),
    metricText("Absorptive", fmtObserved(props, "Observed_Absorptive_Capacity_Score")),
    metricText("Recovery v2", fmtObserved(props, "Observed_Recovery_Capacity_Score_v2")),
    metricText("Time to 80%", fmtObservedHours(props, "Time_To_80pct_Baseline_Hours")),
    metricText("Time to 90%", fmtObservedHours(props, "Time_To_90pct_Baseline_Hours"))
  ].join("");
  document.getElementById("methodCard").innerHTML = `
    <div class="badge-row">
      <span>Score method</span>
      <strong class="badge ${methodClass(props.Cold_Wave_Resilience_Score_Method)}" title="${props.Cold_Wave_Resilience_Score_Method || ""}">${displayMethod(props.Cold_Wave_Resilience_Score_Method)}</strong>
    </div>
    <div class="badge-row">
      <span>Evidence level</span>
      <strong class="badge ${evidenceClass(props.Score_Evidence_Level)}" title="${props.Score_Evidence_Level || ""}">${displayEvidence(props.Score_Evidence_Level)}</strong>
    </div>
  `;
}

function clearChart() {
  if (curveChart) {
    curveChart.destroy();
    curveChart = null;
  }
}

const thresholdLinePlugin = {
  id: "thresholdLinePlugin",
  afterDatasetsDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    [0.8, 0.9].forEach(value => {
      const y = scales.y.getPixelForValue(value);
      ctx.save();
      ctx.strokeStyle = value === 0.9 ? "#116466" : "#b45309";
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(chartArea.left, y);
      ctx.lineTo(chartArea.right, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    });
  }
};

Chart.register(thresholdLinePlugin);

function phaseColor(phase) {
  if (phase === "event") return "#c84b4b";
  if (phase === "recovery") return "#2b8cbe";
  return "#116466";
}

function formatTimestampLabel(timestamp) {
  if (!timestamp) return "";
  return `${timestamp.slice(5, 10)} ${timestamp.slice(11, 13)}h`;
}

function prepareSeries(rawSeries) {
  const grouped = new Map();
  (rawSeries || []).forEach(point => {
    const q = numberOrNull(point.q);
    if (!point.timestamp || q === null) return;
    const key = point.timestamp;
    const existing = grouped.get(key) || { timestamp: key, qSum: 0, count: 0, phaseCounts: {} };
    existing.qSum += q;
    existing.count += 1;
    const phase = point.phase || "unknown";
    existing.phaseCounts[phase] = (existing.phaseCounts[phase] || 0) + 1;
    grouped.set(key, existing);
  });

  let series = Array.from(grouped.values())
    .map(item => {
      const phase = Object.entries(item.phaseCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown";
      return {
        timestamp: item.timestamp,
        q: item.qSum / item.count,
        phase
      };
    })
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const maxPoints = 300;
  if (series.length > maxPoints) {
    const sampled = [];
    const step = (series.length - 1) / (maxPoints - 1);
    for (let i = 0; i < maxPoints; i += 1) {
      sampled.push(series[Math.round(i * step)]);
    }
    series = sampled;
  }
  return series;
}

function renderCurve(curve) {
  clearChart();
  const canvas = document.getElementById("curveChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const series = prepareSeries(curve.series || []);
  if (!series.length) {
    document.getElementById("chartCard").style.display = "none";
    return;
  }
  document.getElementById("chartCard").style.display = "block";
  const phases = Array.from(new Set(series.map(d => d.phase))).filter(Boolean);
  document.getElementById("curvePhaseBadges").innerHTML = phases.map(phase => `<span class="phase-badge ${phase}">${phase}</span>`).join("");
  curveChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: series.map(d => formatTimestampLabel(d.timestamp)),
      datasets: [{
        label: "Q(t)",
        data: series.map(d => d.q),
        borderColor: "#116466",
        backgroundColor: "rgba(17,100,102,0.12)",
        pointRadius: 0,
        borderWidth: 2,
        tension: 0.12,
        segment: {
          borderColor: ctx => phaseColor(series[ctx.p1DataIndex]?.phase)
        }
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      normalized: true,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          type: "category",
          ticks: {
            maxTicksLimit: 6,
            autoSkip: true
          },
          title: { display: true, text: "Time" }
        },
        y: {
          min: 0,
          max: 1.2,
          title: { display: true, text: "Q(t) = speed / baseline speed" }
        }
      },
      plugins: {
        legend: { display: true },
        tooltip: {
          mode: "index",
          intersect: false,
          callbacks: {
            title(items) {
              const item = series[items[0].dataIndex];
              return item ? item.timestamp.replace("T", " ") : "";
            },
            label(item) {
              const point = series[item.dataIndex];
              return `Q=${fmt(point.q, 3)} | ${point.phase}`;
            }
          }
        }
      }
    }
  });
}

async function loadCurve(props) {
  const note = document.getElementById("supportNote");
  if (!hasObservedSupport(props) || !props.curve_file) {
    clearChart();
    document.getElementById("chartCard").style.display = "none";
    document.getElementById("curvePhaseBadges").innerHTML = "";
    note.className = "support-note";
    note.textContent = hasObservedSupport(props)
      ? "No direct NPMRDS hourly curve available for this control section. Score uses available observed summary metrics."
      : "No direct NPMRDS hourly support is available. Observed performance components are not available for this section. The Cold-Wave Score is based on Tier 1/2 potential resilience only.";
    return;
  }
  clearChart();
  document.getElementById("chartCard").style.display = "none";
  note.className = "support-note ok";
  note.textContent = "Loading curve...";
  try {
    const resp = await fetch(props.curve_file);
    if (!resp.ok) throw new Error("Curve file not found");
    const curve = await resp.json();
    note.className = "support-note ok";
    note.textContent = "Direct NPMRDS hourly support is available. The curve shows normalized speed performance relative to the baseline profile.";
    renderCurve(curve);
  } catch (err) {
    clearChart();
    document.getElementById("chartCard").style.display = "none";
    document.getElementById("curvePhaseBadges").innerHTML = "";
    note.className = "support-note";
    note.textContent = "Curve data could not be loaded for this section.";
    console.warn(err);
  }
}

function selectFeature(layer) {
  selectedLayer = layer;
  const props = layer.feature.properties || {};
  updateSelectedPanel(props);
  loadCurve(props);
  refreshStyles();
}

function updateSummary(summary) {
  document.getElementById("totalSections").textContent = fmtInt(summary.total_control_sections);
  document.getElementById("hybridSections").textContent = fmtInt(summary.hybrid_sections);
  document.getElementById("potentialOnlySections").textContent = fmtInt(summary.potential_only_sections);
  document.getElementById("meanScore").textContent = fmt(summary.mean_final_score, 3);
}

function wireUI() {
  document.getElementById("layerSelect").addEventListener("change", event => {
    activeLayer = event.target.value;
    updateLegend();
    refreshStyles();
  });
}

async function init() {
  map = L.map("map", { zoomControl: true, minZoom: 5, maxZoom: 14 }).setView([31.0, -99.2], 6);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    maxZoom: 19
  }).addTo(map);

  wireUI();

  const [summaryResp, geoResp] = await Promise.all([fetch(SUMMARY_URL), fetch(DATA_URL)]);
  if (summaryResp.ok) updateSummary(await summaryResp.json());
  if (!geoResp.ok) throw new Error("Failed to load coldwave_resilience_map.geojson");
  geojsonData = await geoResp.json();
  computeRanges();
  drawMap();

  fetch(CURVE_STATUS_URL).then(resp => resp.ok ? resp.json() : null).then(status => {
    if (status && status.curve_available === false) {
      console.warn("Curve data unavailable:", status.reason);
    }
  }).catch(() => {});
}

init().catch(err => {
  console.error(err);
  alert("Failed to load the cold-wave demo data. Use a local web server and confirm the data folder is present.");
});
