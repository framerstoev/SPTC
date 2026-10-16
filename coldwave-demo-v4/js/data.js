(function (root) {
  "use strict";
  const PUBLIC = "PUBLIC_SHOWCASE", LOCAL = "LOCAL_RESEARCH_PREVIEW";
  const STAGED = "STAGED_RESEARCH_PREVIEW", FULL = "PUBLIC_ANALYTICAL";
  function localHost(host) { return ["localhost", "127.0.0.1", "[::1]"].includes(host); }
  async function json(path, base = document.baseURI, expected = null) {
    const url = new URL(path, base), owner = new URL(base);
    if (url.origin !== owner.origin || !url.pathname.startsWith(owner.pathname.slice(0, owner.pathname.lastIndexOf("/") + 1))) throw new Error("Data path is outside this package");
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`Data file could not be loaded (${response.status})`);
    const bytes = await response.arrayBuffer();
    if (expected) {
      if (bytes.byteLength !== expected.bytes || !/^[a-f0-9]{64}$/.test(expected.sha256)) throw new Error("Invalid file integrity declaration");
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
      if (hash !== expected.sha256) throw new Error("Data integrity mismatch");
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  function validate(geometry, rows, expected) {
    if (geometry.type !== "FeatureCollection" || geometry.features.length !== expected || rows.length !== expected) throw new Error("Geometry or section coverage mismatch");
    const byId = new Map();
    rows.forEach(row => { const id = String(row.id); if (!/^\d+$/.test(id) || byId.has(id)) throw new Error("Invalid or duplicate section key"); byId.set(id, row); });
    const seen = new Set();
    geometry.features.forEach(feature => {
      const id = String(feature.properties.id);
      if (seen.has(id) || !byId.has(id) || !["LineString", "MultiLineString"].includes(feature.geometry.type)) throw new Error("Geometry join failed");
      seen.add(id);
    });
    return byId;
  }
  function label(data) { return data.mode === STAGED ? "Full research staging · not approved for publication" : data.mode === FULL ? "Published research evidence" : data.mode === LOCAL ? "Local research preview" : "Public showcase"; }
  function reviewLabel(data) { return data.mode === FULL ? "Published research release" : `${data.manifest.status || "Unavailable"} / ${data.manifest.approval_status || "NOT_APPROVED"}`; }
  function validatePolicy(policy) {
    if (![STAGED, FULL].includes(policy.mode)) throw new Error("Unsupported full package mode");
    if (policy.mode === STAGED) {
      if (!localHost(location.hostname) || policy.approval_status !== "NOT_APPROVED" || policy.redistribution_approved !== false || policy.publish_allowed !== false) throw new Error("Unapproved staging is restricted to local review");
    } else {
      const approval = policy.approval;
      if (policy.approval_status !== "APPROVED" || policy.redistribution_approved !== true || policy.publish_allowed !== true || !approval?.approved_by || !(approval?.recorded_at || approval?.approved_at) || !approval?.decision_reference || !approval?.rights_reference || !approval?.approved_payload_sha256 || approval.approved_payload_sha256 !== policy.payload_sha256) throw new Error("Public analytical package approval is missing or incomplete");
    }
    if (policy.section_count !== 10029 || policy.curve_count !== 3842 || policy.county_count !== 223 || policy.curves_included !== true || policy.event_id !== "coldwave_2026_01") throw new Error("Full January package coverage mismatch");
    const names = Object.keys(policy.files || {});
    if (names.length !== 3845 || !["geometry.json", "sections.json", "summaries.json"].every(name => policy.files[`data/${name}`])) throw new Error("Incomplete full-package file index");
    if (names.some(name => !/^data\/(?:geometry\.json|sections\.json|summaries\.json|curves\/CS_\d+\.json)$/.test(name))) throw new Error("Unexpected package data file");
  }
  async function load() {
    const policy = await json("./data/public-manifest.json");
    if ([STAGED, FULL].includes(policy.mode)) {
      validatePolicy(policy);
      const get = name => json(`./data/${name}`, document.baseURI, policy.files[`data/${name}`]);
      const [geometry, rows, summaries] = await Promise.all([get("geometry.json"), get("sections.json"), get("summaries.json")]);
      const byId = validate(geometry, rows, policy.section_count);
      const supported = rows.filter(row => row.has_curve);
      if (supported.length !== policy.curve_count || supported.some(row => !policy.files[`data/curves/CS_${row.id}.json`]) || Object.keys(summaries.counties).length !== policy.county_count || !summaries.event) throw new Error("Curve or summary coverage mismatch");
      const counties = [...new Map(rows.map(r => [r.county_fips, { id: r.county_fips, name: r.county_name }])).values()].sort((a, b) => a.name.localeCompare(b.name));
      return { mode: policy.mode, manifest: policy, geometry, rows, byId, counties, eventSummary: summaries.event, countySummaries: summaries.counties, curveCache: new Map(), curveBase: "./data/curves/", note: "" };
    }
    const requested = new URL(location.href).searchParams.get("mode");
    if (requested !== LOCAL || policy.public_only || !localHost(location.hostname)) return { mode: PUBLIC, manifest: policy, rows: [], byId: new Map(), geometry: { type: "FeatureCollection", features: [] }, counties: [], eventSummary: null, countySummaries: {}, curveCache: new Map(), note: requested === LOCAL ? "Local research preview is unavailable in this public environment." : policy.message };
    const manifest = await json("./.local-preview/manifest.json");
    if (manifest.mode !== LOCAL || manifest.status !== "REVIEW_READY" || manifest.approval_status !== "NOT_APPROVED" || manifest.redistribution_approved !== false) throw new Error("Local review package status is not supported");
    const [geometry, rows, summaries] = await Promise.all([json("./.local-preview/geometry.json"), json("./.local-preview/sections.json"), json("./.local-preview/summaries.json")]);
    const byId = validate(geometry, rows, manifest.section_count);
    if (manifest.section_count !== 10029) throw new Error("Unexpected January section coverage");
    const counties = [...new Map(rows.map(r => [r.county_fips, { id: r.county_fips, name: r.county_name }])).values()].sort((a, b) => a.name.localeCompare(b.name));
    return { mode: LOCAL, manifest, geometry, rows, byId, counties, eventSummary: summaries.event, countySummaries: summaries.counties, curveCache: new Map(), curveBase: "./.local-preview/curves/", note: "Local research preview · review-ready results are not approved for publication." };
  }
  async function curve(data, id) {
    if (![LOCAL, STAGED, FULL].includes(data.mode) || !data.byId.get(id)?.has_curve) return null;
    const expected = data.mode === LOCAL ? null : data.manifest.files[`data/curves/CS_${id}.json`];
    if (data.mode !== LOCAL && !expected) throw new Error("Curve is not declared in full package");
    if (!data.curveCache.has(id)) data.curveCache.set(id, json(`${data.curveBase}CS_${id}.json`, document.baseURI, expected).catch(error => { data.curveCache.delete(id); throw error; }));
    return data.curveCache.get(id);
  }
  root.V4Data = Object.freeze({ PUBLIC, LOCAL, STAGED, FULL, localHost, json, validate, validatePolicy, label, reviewLabel, load, curve });
})(window);
