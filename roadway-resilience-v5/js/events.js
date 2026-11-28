/* Native event adapter. Scientific values are read, never recalculated. */
(function (root) {
  "use strict";
  const C = V4Core, D = V4Data;
  const januaryMetrics = V4Metrics.forEvent("coldwave_2026_01"), berylMetrics = V4Metrics.forEvent("beryl_2024_07"), cache = new Map();
  function setMetrics(data) {
    Object.keys(C.metrics).forEach(key => delete C.metrics[key]);
    Object.assign(C.metrics, V4Metrics.forEvent(data.eventId || "coldwave_2026_01"));
  }
  async function loadBeryl() {
    await V4Release.authorize("beryl_2024_07");
    const base = "./data/beryl/", manifest = await D.json(base + "manifest.json");
    if (manifest.event_id !== "beryl_2024_07" || manifest.publish_allowed !== false || manifest.potential_CS !== 5763 || manifest.curve_count !== 5698) throw new Error("Invalid Beryl event contract");
    const get = name => D.json(base + name, document.baseURI, manifest.files[name]);
    const [geometry, rows, summaries, axis, track, evidence] = await Promise.all(["geometry.json", "sections.json", "summaries.json", "time-axis.json", "track.json", "evidence.json"].map(get));
    const byId = D.validate(geometry, rows, 5763);
    const o1Manifest = await root.V4O1.load(rows);
    const focusManifest = await root.V4H.loadFocus(rows);
    if (rows.filter(r => r.core_mean_q !== null).length !== 5582 || rows.filter(r => r.economic_supported).length !== 3318 || track.points.features.length !== 54) throw new Error("Beryl support mismatch");
    if (!Number.isFinite(summaries.event?.expected_demand_mobility_delay_cost_2024usd) || !Number.isFinite(summaries.event?.total_vehicle_delay_hours)) throw new Error("Required Beryl economic totals unavailable");
    const counties = [...new Map(rows.map(r => [r.county_fips, { id: r.county_fips, name: r.county_name }])).values()].sort((a, b) => a.name.localeCompare(b.name));
    return { beryl: true, eventId: manifest.event_id, mode: D.FULL, manifest, geometry, rows, byId, counties,
      eventSummary: summaries.event, countySummaries: summaries.counties, curveCache: new Map(),
      curveBase: base + "curves/", timeAxis: axis.timestamp, track, evidence, o1Manifest, focusManifest, note: "", summaries };
  }
  async function load(id = "coldwave_2026_01") {
    const key = id === "beryl_2024_07" ? id : "coldwave_2026_01";
    await V4Release.authorize(key);
    if (!cache.has(key)) cache.set(key, (key === "beryl_2024_07" ? loadBeryl() : D.load()).then(data => ({ ...data, eventId: key })).catch(error => { cache.delete(key); throw error; }));
    const data={...await cache.get(key)};
    await root.V5P.attach(data);
    if (data.beryl) data.peakLossById = await root.V4PeakLoss.load(data).catch(() => null);
    if(!data.networkContext){const manifest=await D.json("./data/network-context-manifest.json");data.networkContext=await D.json("./data/network-context.json",document.baseURI,manifest.file);}
    return data;
  }
  async function curve(data, id) {
    const row = data.byId.get(id), holder = data.curveCache, axis = data.timeAxis;
    if (!row?.has_curve) return null;
    const expected = data.manifest.files[`curves/CS_${id}.json`];
    if (!expected) throw new Error("Curve absent from Beryl manifest");
    if (!holder.has(id)) holder.set(id, D.json(`${data.curveBase}CS_${id}.json`, document.baseURI, expected).then(payload => {
      if (payload.id !== id || payload.q.length !== axis.length || payload.q_smoothed.length !== axis.length) throw new Error("Beryl curve identity/axis mismatch");
      const offsets = row.clock_offsets.split(";").map(Number), start = `2024-07-07T0${Math.min(...offsets)}:00:00Z`, end = `2024-07-10T0${Math.max(...offsets)}:00:00Z`;
      return { clock: "UTC", series: { timestamp: axis, q: payload.q, q_smoothed: payload.q_smoothed },
        metadata: { ...row.candidate_b, core_start: start, core_end: end }, raw: payload };
    }).catch(error => { holder.delete(id); throw error; }));
    return holder.get(id);
  }
  function phaseLabel(row) {
    const p = row.candidate_b;
    if (!row.has_curve) return "No observed Q support";
    if (!p.valid) return p.recovery_evidence_class === "insufficient_observations" ? "Insufficient phase-detection support" : "No sustained drop detected · not proof of no impact";
    if (p.recovery_evidence_class.includes("censored") || p.method_warning_text?.includes("censored")) return "Selected phase · censored endpoint";
    if (p.recovery_evidence_class.includes("ambiguous")) return "Selected phase · sampling-ambiguous return";
    if (p.recovery_evidence_class.includes("uncertain")) return "Selected phase · Q0 uncertainty";
    return "Selected phase · threshold-return evidence";
  }
  function curveNote(row) {
    const p = row.candidate_b;
    return `${phaseLabel(row)}. ${p.valid ? (p.detected_phase_overlaps_core ? "Selected six-week phase overlaps the native core." : "Selected six-week phase does not overlap the native core.") : "No phase is invented."} UTC axis; source-local offsets ${row.clock_offsets.replaceAll(";", "/")} h added to local. Missing observations remain gaps; threshold return is not confirmed physical recovery.`;
  }
  root.V4Events = Object.freeze({ load, curve, setMetrics, phaseLabel, curveNote, januaryMetrics, berylMetrics });
})(window);
