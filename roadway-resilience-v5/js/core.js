/* Standalone presentation utilities; no analytical formulas are recomputed. */
(function (root) {
  "use strict";
  const metrics = root.V4Metrics.forEvent("coldwave_2026_01");
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
    return number(root.V4Metrics.raw(row, metric, windowId));
  }
  function mapValue(row,key,windowId="legacy_labels"){
    const metric=metrics[key];return !row||!metric?null:number(root.V4Metrics.mapRaw(row,metric,windowId));
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
  function statusLabel(row) { return root.V4J.status(row,row?.event_id==="beryl_2024_07"); }
  function store(initial, normalize = value => value) {
    let state = Object.freeze({ ...initial });
    const listeners = new Set();
    return { get: () => state, set(patch) { const old = state; state = Object.freeze(normalize({ ...state, ...patch })); listeners.forEach(fn => fn(state, old)); }, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
  }
  root.V4Core = Object.freeze({ metrics, number, format, percentile, scoreBreaks, bucket, value, mapValue, bounds, statusLabel, store });
})(typeof window !== "undefined" ? window : globalThis);
