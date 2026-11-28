/* Read the reviewed Beryl peak-loss values from the original comparison asset. */
(function (root) {
  "use strict";
  const file = { bytes: 510872, sha256: "6f524960ecc59c56fa9e88ac78394e18a37d5523539997cea7966985edd43b6a" };
  let pending;

  async function read(data) {
    const comparison = await V4Data.json("./data/v5v/peak-loss.json", document.baseURI, file);
    if (comparison.schema !== 1 || comparison.reference !== "beryl_o1a_v5t_fixed_3097" ||
        comparison.method !== "beryl_core_three_consecutive_hour_median_v5v_exploratory" ||
        data.rows.length !== 5763 || Object.keys(comparison.rows).length !== data.rows.length) {
      throw Error("Invalid Beryl peak-loss reference");
    }
    const peakById = new Map();
    for (const road of data.rows) {
      const record = comparison.rows[road.id];
      if (record?.length !== 8) throw Error("Road missing in Beryl peak-loss reference");
      const [planning, planningClass, , peak, minimum] = record;
      const qualified = road.o1a.primary_qualified;
      if (planning !== road.beryl_potential_resilience || planningClass !== road.v5p.planning_class ||
          (qualified ? !(Number.isFinite(peak) && peak >= 0 && peak <= 1 && Number.isFinite(minimum)) : peak !== null)) {
        throw Error("Beryl peak-loss record does not match the accepted road catalog");
      }
      if (qualified) peakById.set(road.id, peak);
    }
    if (peakById.size !== 3097) throw Error("Invalid Beryl peak-loss coverage");
    return peakById;
  }

  function load(data) {
    pending ??= read(data).catch(error => { pending = null; throw error; });
    return pending;
  }

  root.V4PeakLoss = Object.freeze({ load });
})(window);
