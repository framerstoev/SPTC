/* Local V5Q presentation. Reads the V5P classes and original observations. */
(function (root) {
  "use strict";
  const maxGap = 1;
  const T = (...args) => V4Inspector.text(...args);
  const hour = 3600000;
  const boundary = label => Date.parse(label + "T00:00:00Z");
  let indexPromise;
  let showConnections = false;
  const chartControls = new Set();
  const missingHover = new WeakSet();
  Chart.Interaction.modes.v5qObservedNearest = (chart, event, options, useFinalPosition) =>
    missingHover.has(chart) ? [] : Chart.Interaction.modes.nearest(chart, event, options, useFinalPosition);

  function gapIndex() {
    if (!indexPromise) {
      indexPromise = V4Data.json("./data/v5q/short-gaps.json", document.baseURI, {"bytes": 119710, "sha256": "9b8c9088a563c417bbebf0a149e4c8e24278865a022d66cd6ee65eacc4f2c4fa"})
        .catch(() => { indexPromise = null; return null; });
    }
    return indexPromise;
  }

  function guideData(row, original, index, times) {
    const q = original.series.q;
    const offsets = row.clock_offsets.split(";").map(Number);
    const start = boundary("2024-06-17") + Math.min(...offsets) * hour;
    const end = boundary("2024-07-29") + Math.max(...offsets) * hour;
    const missing = new Map();
    for (let i = 0; i < q.length;) {
      if (times[i] < start || times[i] >= end || q[i] !== null) { i++; continue; }
      const first = i++;
      while (i < q.length && times[i] < end && q[i] === null && times[i] - times[i - 1] === hour) i++;
      for (let slot = first; slot < i; slot++) missing.set(slot, i - first);
    }
    const connectors = [];
    if (offsets.length !== 1 || ![5, 6].includes(offsets[0]) || original.clock !== "UTC" ||
        index?.axis !== original.raw.time_axis_id) return {missing, connectors};
    for (const [first, length] of index.rows[row.id] || []) {
      if (length > maxGap || missing.get(first) !== length) continue;
      const last = first + length - 1, left = first - 1, right = last + 1;
      if (!Number.isFinite(q[left]) || !Number.isFinite(q[right]) ||
          times[left] < start || times[right] >= end) continue;
      if (times.slice(left + 1, right + 1).every((stamp, i) => stamp - times[left+i] === hour)) {
        connectors.push({first, left, right, length});
      }
    }
    return {missing, connectors};
  }

  function connectionControl(host) {
    const label = T("label", "", "v5q-gap-control");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = showConnections;
    input.disabled = true;
    const key = T("i", "", "v5q-dashed-key");
    key.setAttribute("aria-hidden", "true");
    label.append(input, key, document.createTextNode("Show short-gap connections"));
    host.append(label);
    return {label, input};
  }

  function chartGuides({control, original, row, index, times, min, max}) {
    const {missing, connectors} = guideData(row, original, index, times);
    const visible = connectors.filter(({left,right}) => times[left] >= min && times[right] <= max);
    const visibleSlots = new Set(visible.flatMap(({first,length}) => Array.from({length}, (_,i) => first+i)));
    const q = original.series.q;
    const tooltip = T("output", "", "v5q-gap-tooltip");
    tooltip.hidden = true;
    let refresh;
    const updateControl = chart => {
      control.input.checked = showConnections;
      tooltip.hidden = true;
      chart.draw();
    };
    const onChange = () => {
      showConnections = control.input.checked;
      for (const update of chartControls) update();
    };
    const plugin = {
      id: "v5qVisualGuides",
      afterInit(chart) {
        chart.canvas.parentElement.append(tooltip);
        refresh = () => updateControl(chart);
        chartControls.add(refresh);
        control.input.disabled = !index || !visible.length;
        control.input.checked = showConnections;
        control.label.title = !index ? "Short-gap connections could not be loaded" : visible.length ? "" : "No eligible short gaps in this view";
        control.input.addEventListener("change", onChange);
      },
      beforeEvent(chart, args) {
        const event = args.event;
        const x = chart.scales.x.getValueForPixel(event.x);
        const slot = Math.round((x - times[0]) / hour);
        const length = args.inChartArea && event.type !== "mouseout" ? missing.get(slot) : undefined;
        tooltip.hidden = length === undefined;
        if (length === undefined) { missingHover.delete(chart); return; }
        missingHover.add(chart);
        tooltip.textContent = showConnections && visibleSlots.has(slot) ?
          "Visual connection · no observation" : `Data unavailable · ${length} ${length === 1 ? "hour" : "hours"}`;
      },
      afterDatasetsDraw(chart) {
        if (!showConnections || !visible.length) return;
        const {ctx, chartArea, scales} = chart;
        ctx.save();
        ctx.beginPath();
        ctx.rect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
        ctx.clip();
        ctx.strokeStyle = "#796e60";
        ctx.lineWidth = 1.6;
        ctx.setLineDash([3, 2]);
        for (const {left,right} of visible) {
          ctx.beginPath();
          ctx.moveTo(scales.x.getPixelForValue(times[left]), scales.y.getPixelForValue(q[left]));
          ctx.lineTo(scales.x.getPixelForValue(times[right]), scales.y.getPixelForValue(q[right]));
          ctx.stroke();
        }
        ctx.restore();
      },
      afterDestroy(chart) {
        chartControls.delete(refresh);
        missingHover.delete(chart);
        control.input.removeEventListener("change", onChange);
        tooltip.remove();
      }
    };
    return {plugin, filter: item => item.datasetIndex <= 1,
      label: item => item.datasetIndex === 0 ? `Observed Q: ${item.parsed.y.toFixed(3)}`
        : `Accepted smoothed Q: ${item.parsed.y.toFixed(3)}`};
  }

  root.V5Q = Object.freeze({gapIndex, connectionControl, chartGuides});
})(window);
