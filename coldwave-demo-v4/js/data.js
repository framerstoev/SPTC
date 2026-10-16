(function (root) {
  "use strict";
  const PUBLIC = "PUBLIC_SHOWCASE", LOCAL = "LOCAL_RESEARCH_PREVIEW";
  function localHost(host) { return ["localhost", "127.0.0.1", "[::1]"].includes(host); }
  async function json(path, base = document.baseURI) {
    const url = new URL(path, base), owner = new URL(base);
    if (url.origin !== owner.origin || !url.pathname.startsWith(owner.pathname.slice(0, owner.pathname.lastIndexOf("/") + 1))) throw new Error("Data path is outside this package");
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`Data file could not be loaded (${response.status})`);
    return response.json();
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
  async function load() {
    const policy = await json("./data/public-manifest.json");
    const requested = new URL(location.href).searchParams.get("mode");
    if (requested !== LOCAL || policy.public_only || !localHost(location.hostname)) {
      return { mode: PUBLIC, manifest: policy, rows: [], byId: new Map(), geometry: { type: "FeatureCollection", features: [] }, counties: [], eventSummary: null, countySummaries: {}, curveCache: new Map(), note: requested === LOCAL ? "Local research preview is unavailable in this public environment." : policy.message };
    }
    const manifest = await json("./.local-preview/manifest.json");
    if (manifest.mode !== LOCAL || manifest.status !== "REVIEW_READY" || manifest.approval_status !== "NOT_APPROVED" || manifest.redistribution_approved !== false) throw new Error("Local review package status is not supported");
    const [geometry, rows, summaries] = await Promise.all([json("./.local-preview/geometry.json"), json("./.local-preview/sections.json"), json("./.local-preview/summaries.json")]);
    const byId = validate(geometry, rows, manifest.section_count);
    if (manifest.section_count !== 10029) throw new Error("Unexpected January section coverage");
    const counties = [...new Map(rows.map(r => [r.county_fips, { id: r.county_fips, name: r.county_name }])).values()].sort((a, b) => a.name.localeCompare(b.name));
    return { mode: LOCAL, manifest, geometry, rows, byId, counties, eventSummary: summaries.event, countySummaries: summaries.counties, curveCache: new Map(), note: "Local research preview · review-ready results are not approved for publication." };
  }
  async function curve(data, id) {
    if (data.mode !== LOCAL || !data.byId.get(id)?.has_curve) return null;
    if (!data.curveCache.has(id)) data.curveCache.set(id, json(`./.local-preview/curves/CS_${id}.json`).catch(error => { data.curveCache.delete(id); throw error; }));
    return data.curveCache.get(id);
  }
  root.V4Data = Object.freeze({ PUBLIC, LOCAL, localHost, json, validate, load, curve });
})(window);
