/* Attach original classes and display-only percentiles to the existing section records. */
(function (root) {
  "use strict";
  let pending = null;

  async function readReference() {
    const [reference, percentiles] = await Promise.all([
      V4Data.json("./data/v5p/relative.json", document.baseURI, {"bytes": 160955, "sha256": "bdbe0aa928f9a8d9ed0173a11abb1db85a76a8e711a7c1207e5475d9c0d87833"}),
      V4Data.json("./data/v5t/percentiles.json", document.baseURI, {"bytes": 60808, "sha256": "4666e2f3aeed1c4d88d93864f30512750f2ef3f92b619ce212187e4dec6758f9"})
    ]);
    const count = reference.reference_CS;
    const ids = Object.keys(reference.rows);
    const denominator = percentiles.denominator;
    if (count !== 3097 || ids.length !== count || percentiles.event !== "beryl_2024_07" ||
        percentiles.reference_CS !== count || denominator !== 2 * count ||
        Object.keys(percentiles.rows).length !== count || !ids.every(id => {
          const ranks = percentiles.rows[id];
          return ranks?.length === 2 && ranks.every(n => Number.isInteger(n) && n > 0 && n < denominator);
        })) {
      throw Error("Invalid Beryl percentile reference");
    }
    return { reference, percentiles };
  }

  async function attach(data) {
    if (!data.beryl) return;
    pending ??= readReference();
    const { reference, percentiles } = await pending;
    for (const row of data.rows) {
      const classes = reference.rows[row.id];
      row.v5p = classes ? {
        ...classes, percentiles: percentiles.rows[row.id].map(n => n / percentiles.denominator)
      } : {planning_class:null, observation_class:null};
    }
    data.v5pReference = reference;
  }

  root.V5P = Object.freeze({attach});
})(window);
