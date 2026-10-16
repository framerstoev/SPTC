(function (root) {
  "use strict";
  // Encode the delivered naive clock on a linear axis; do not convert time zones.
  const clock = stamp => Date.parse(stamp.slice(0, 19) + "Z");
  const clockLabel = value => new Date(value).toISOString().slice(5, 16).replace("T", " ");
  const phaseLines = { id: "phaseLines", afterDatasetsDraw(chart, args, options) {
    const { ctx, chartArea, scales } = chart;
    (options.markers || []).forEach(marker => {
      if (!marker.time) return;
      const x = scales.x.getPixelForValue(clock(marker.time));
      ctx.save(); ctx.strokeStyle = marker.color; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke(); ctx.restore();
    });
  } };
  function draw(canvas, payload, row) {
    const series = payload.series, meta = payload.metadata || {};
    const labels = series.timestamp, times = labels.map(clock);
    const points = values => {
      const result = [];
      times.forEach((x, i) => {
        if (i && x - times[i - 1] > 3600000) result.push({ x: (x + times[i - 1]) / 2, y: null });
        result.push({ x, y: values[i], timestamp: labels[i] });
      });
      return result;
    };
    const markers = row.status === "no_sustained_drop" ? [] : [{ time: meta.onset_time, color: "#ba8b45" }, { time: meta.min_time, color: "#a54f52" }, { time: meta.recovery_end_time, color: "#547da0" }];
    return new Chart(canvas, { type: "line", plugins: [phaseLines], data: { labels, datasets: [
      { label: "Raw Q(t)", data: points(series.q), borderColor: "#a5b2b66b", borderWidth: 1, pointRadius: 0, spanGaps: false },
      { label: "Accepted smoothed Q(t)", data: points(series.q_smoothed), borderColor: "#176663", borderWidth: 2, pointRadius: 0, spanGaps: false },
      { label: "Baseline Q = 1", data: [{ x: times[0], y: 1 }, { x: times.at(-1), y: 1 }], borderColor: "#8b9690", borderWidth: 1, borderDash: [3, 3], pointRadius: 0 },
      { label: "0.90 × Q0", data: [{ x: times[0], y: meta.q0 == null ? null : .9 * meta.q0 }, { x: times.at(-1), y: meta.q0 == null ? null : .9 * meta.q0 }], borderColor: "#b28d57", borderWidth: 1, borderDash: [4, 3], pointRadius: 0 }
    ] }, options: { animation: false, responsive: true, maintainAspectRatio: false, normalized: false, interaction: { mode: "nearest", axis: "x", intersect: false }, plugins: { phaseLines: { markers }, legend: { display: false }, tooltip: { callbacks: { title: points => (points[0].raw.timestamp?.replace("T", " ") || clockLabel(points[0].parsed.x)) + " · delivered TMC-local" } } }, scales: { x: { type: "linear", min: times[0], max: times.at(-1), ticks: { maxTicksLimit: 4, maxRotation: 0, font: { size: 8 }, callback: value => clockLabel(value).slice(0, 5).replace("-", "/") }, grid: { display: false } }, y: { min: 0, suggestedMax: 1.2, title: { display: true, text: "Q(t)", font: { size: 9 } }, ticks: { font: { size: 8 }, maxTicksLimit: 4 }, grid: { color: "#e5e9e4" } } } } });
  }
  root.V4Charts = Object.freeze({ draw });
})(window);
