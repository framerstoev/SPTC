/* Event overlay on the native V4 Leaflet maps, not another map application. */
(function (root) {
  "use strict";
  const T = (...args) => V4Inspector.text(...args);
  function sync(entries, data, store, fitTexas) {
    entries.forEach((entry, name) => {
      const map = entry.map;
      map.getContainer().closest(".compare-map-shell").dataset.beryl=String(Boolean(data.beryl));
      if (!data.beryl) {
        if (entry.storm) { map.removeLayer(entry.storm); map.closePopup(); }
        entry.storm = null; entry.stormPoints = [];
        return;
      }
      if (!entry.storm) {
        for (const [name, order] of [["nhcLines", 410], ["nhcPoints", 420]]) {
          if (!map.getPane(name)) { map.createPane(name); map.getPane(name).style.zIndex = order; }
        }
        map.getPane("nhcLines").style.pointerEvents = "none";
        const group = L.featureGroup(), points = [];
        L.geoJSON(data.track.lines, { pane: "nhcLines", interactive: false, style: { color: "#fff9eb", weight: 7, opacity: .95 } }).addTo(group);
        L.geoJSON(data.track.lines, { pane: "nhcLines", interactive: false, style: { color: "#a64f21", weight: 3.5, opacity: .95 } }).addTo(group);
        L.geoJSON(data.track.points, {
          pointToLayer: (feature, position) => L.circleMarker(position, { pane: "nhcPoints", renderer: L.svg({ pane: "nhcPoints" }), radius: 5, color: "#7a351c", fillColor: "#f4cf87", fillOpacity: 1, weight: 1.5, className: "nhc-track-point" }),
          onEachFeature(feature, point) {
            const p = feature.properties, host = T("div", "", "nhc-popup");
            host.append(T("strong", "NHC best-track observation"), T("p", p.timestamp_utc + " · UTC"));
            const list = T("dl", "", "coverage-list");
            for (const [label, value] of [["Status", p.STORMTYPE], ["Sustained wind", `${p.INTENSITY ?? "Unavailable"} kt`], ["MSLP", `${p.MSLP ?? "Unavailable"} · source value`], ["Latitude / longitude", `${p.LAT}, ${p.LON}`]]) list.append(T("dt", label), T("dd", value));
            host.append(list, T("p", "Storm-center attributes, not roadway wind. Pressure unit is not declared in the accepted B5 display layer.", "evidence-note"));
            const popupPadding=()=>L.point(matchMedia("(max-width:700px)").matches?10:225,10);
            point.bindPopup(host, { maxWidth: 300, autoPanPaddingBottomRight: popupPadding() }).bindTooltip(p.timestamp_utc + " · " + p.STORMTYPE);
            point.on("popupopen",({popup})=>{
              const padding=popupPadding();
              if(!padding.equals(popup.options.autoPanPaddingBottomRight)){popup.options.autoPanPaddingBottomRight=padding;popup.update();}
            });
            points.push(point);
          }
        }).addTo(group);
        entry.storm = group; entry.stormPoints = points;
      }
      const show = store.get().trackVisible;
      if (show && !map.hasLayer(entry.storm)) entry.storm.addTo(map);
      else if (!show && map.hasLayer(entry.storm)) map.removeLayer(entry.storm);

    });
  }
  root.V4Track = Object.freeze({ sync });
})(window);
