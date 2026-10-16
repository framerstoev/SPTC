/* Standalone presentation utilities; no analytical formulas are recomputed. */
(function (root) {
  "use strict";
  const scoreRamp = ["#b2182b", "#ef8a62", "#f7f7f7", "#67a9cf", "#2166ac"];
  const riskRamp = ["#edf3ed", "#c4d5c2", "#9caf8e", "#c1a569", "#aa7543"];
  const metrics = {
    potential: { label: "Potential Resilience", field: "Potential_Resilience_Score", unit: "index · 0–1", group: "Planning / Potential", range: [0, 1], ramp: scoreRamp, note: "Higher values mean more favorable planning indicators. This is not predicted traffic performance." },
    weather: { label: "Tier 1 · Weather Exposure", field: "WEATHER_REI", unit: "index · 0–1", group: "Planning / Potential", range: [0, 1], ramp: riskRamp, note: "Precipitation-based, pavement-adjusted exposure. Higher means greater weather concern; temperature is separate." },
    network: { label: "Tier 2 · Network Context", field: "NETRISK_LITE", unit: "index · 0–1", group: "Planning / Potential", range: [0, 1], ramp: riskRamp, note: "Traffic, connectivity and redundancy context. Higher means greater network concern." },
    observed: { label: "Observed Resilience · Score", field: "observed_curve_resilience_score_v0", unit: "index · 0–1", group: "Observed / Tier 3", ramp: scoreRamp, quantile: true, note: "Higher means a smaller normalized performance deficit in the detected segment. Event-sample quantiles exclude unavailable and no-sustained-drop scores." },
    minimum: { label: "Minimum Q", field: "q_min", unit: "Q ratio", group: "Observed / Tier 3", range: [0, 1.5], ramp: scoreRamp, note: "Minimum smoothed Q in the detected dominant drop. Q is speed relative to the expected baseline." },
    loss: { label: "Loss Area", field: "resilience_loss_area", unit: "Q-hours", group: "Observed / Tier 3", ramp: riskRamp, note: "Performance deficit over observed rows in the detected phase. Loss Area is not monetary loss." },
    recovery: { label: "Recovery", field: "recovery_duration_hours", unit: "hours", group: "Observed / Tier 3", ramp: riskRamp, note: "Elapsed time from minimum to estimated recovery endpoint. Censored recovery is not confirmed recovery." },
    vehicle_delay: { label: "Vehicle Delay Hours", field: "total_vehicle_delay_hours", unit: "vehicle-hours", group: "Mobility Impact", ramp: riskRamp, note: "Expected/profile-demand vehicle delay hours. Missing support remains unavailable." },
    mobility_cost: { label: "Expected-Demand Mobility Delay Cost", field: "expected_demand_mobility_delay_cost_2024usd", unit: "2024 USD", group: "Mobility Impact", ramp: riskRamp, money: true, note: "Expected-demand delay valuation, not total economic loss." },
    temp_min: { label: "Experimental · Minimum daily Tmin", temp: "minimum_daily_buffer_mean_tmin_c", unit: "°C", group: "Experimental Weather", ramp: ["#344e86", "#6084a4", "#adc6cd", "#dfd4b8", "#c28c60"], note: "Minimum of daily buffer-mean air Tmin. It is not the absolute road minimum or pavement temperature." },
    temp_tmin_days: { label: "Experimental · Tmin < 0°C days", temp: "tmin_below_zero_days", unit: "PRISM days", group: "Experimental Weather", ramp: ["#e7eff0", "#bcd0d4", "#81a4b5", "#537c9a", "#2f5478"], note: "Count of PRISM days with buffer-mean Tmin below zero. This does not measure freezing hours." },
    temp_tmax_days: { label: "Experimental · Tmax < 0°C days", temp: "tmax_below_zero_days", unit: "PRISM days", group: "Experimental Weather", ramp: ["#e7eff0", "#bcd0d4", "#81a4b5", "#537c9a", "#2f5478"], note: "Count of PRISM days with buffer-mean Tmax below zero. It does not confirm road icing." }
  };
  function number(value) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
  function format(value, options = {}) {
    if (number(value) === null) return "Unavailable";
    const prefix = options.money ? "$" : "";
    if (value !== 0 && Math.abs(value) < .001) return `${prefix}<0.001`;
    if (options.compact && Math.abs(value) >= 1e6) return prefix + (value / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 }) + "M";
    if (options.compact && Math.abs(value) >= 1e3) return prefix + (value / 1e3).toLocaleString("en-US", { maximumFractionDigits: 2 }) + "K";
    return prefix + value.toLocaleString("en-US", { maximumFractionDigits: options.digits ?? 3 });
  }
  function percentile(values, p) {
    const arr = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!arr.length) return null;
    const idx = (arr.length - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx);
    return arr[lo] + (arr[hi] - arr[lo]) * (idx - lo);
  }
  function scoreBreaks(rows) {
    const values = rows.filter(p => p.status !== "no_sustained_drop" && p.has_curve).map(p => number(p.observed_curve_resilience_score_v0)).filter(v => v !== null);
    if (!values.length) return [0, .25, .5, .75, .9, 1];
    const breaks = [0, .2, .4, .6, .8, 1].map(q => percentile(values, q));
    for (let i = 1; i < breaks.length; i++) if (breaks[i] <= breaks[i - 1]) breaks[i] = breaks[i - 1] + .000001;
    return breaks;
  }
  function bucket(value, breaks) {
    if (number(value) === null) return null;
    if (value <= breaks[0]) return 0;
    for (let i = 0; i < breaks.length - 1; i++) if (value >= breaks[i] && value <= breaks[i + 1]) return i;
    return breaks.length - 2;
  }
  function value(row, key, windowId = "legacy_labels") {
    const metric = metrics[key];
    if (!row || !metric) return null;
    if (key === "observed" && (!row.has_curve || row.status === "no_sustained_drop")) return null;
    return number(metric.temp ? row.temperature?.[windowId]?.[metric.temp] : row[metric.field]);
  }
  function bounds(features) {
    const out = [[Infinity, Infinity], [-Infinity, -Infinity]];
    const walk = c => {
      if (typeof c[0] === "number") { out[0][0] = Math.min(out[0][0], c[1]); out[0][1] = Math.min(out[0][1], c[0]); out[1][0] = Math.max(out[1][0], c[1]); out[1][1] = Math.max(out[1][1], c[0]); }
      else c.forEach(walk);
    };
    features.forEach(f => walk(f.geometry.coordinates));
    return Number.isFinite(out[0][0]) ? out : [[25.5, -106.7], [36.6, -93.4]];
  }
  function statusLabel(row) {
    return { detected: "Detected phase pattern", no_sustained_drop: "No sustained drop detected", recovery_endpoint_censored: "Recovery endpoint censored", no_observed_support: "No observed support" }[row?.status] || "Observed evidence unavailable";
  }
  function store(initial) {
    let state = Object.freeze({ ...initial });
    const listeners = new Set();
    return { get: () => state, set(patch) { const old = state; state = Object.freeze({ ...state, ...patch }); listeners.forEach(fn => fn(state, old)); }, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
  }
  root.V4Core = Object.freeze({ metrics, number, format, percentile, scoreBreaks, bucket, value, bounds, statusLabel, store });
})(typeof window !== "undefined" ? window : globalThis);
