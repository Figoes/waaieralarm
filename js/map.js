const CLASS_COLOR = { tail: "#17a06d", cross: "#c99a00", head: "#d92b4f" };

let map = null;
let plainLayer = null;
let coloredLayer = null;
let markersLayer = null;
let endpointsLayer = null;

export function initMap(containerId) {
  map = L.map(containerId, { zoomControl: false });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  map.attributionControl.setPosition("bottomright");
  map.setView([52.05, 5.2], 8);
  return map;
}

function clearLayer(layer) {
  if (layer) map.removeLayer(layer);
  return null;
}

function addEndpoints(points) {
  endpointsLayer = clearLayer(endpointsLayer);
  const start = points[0];
  const end = points[points.length - 1];
  endpointsLayer = L.layerGroup([
    L.circleMarker([start.lat, start.lon], {
      radius: 7,
      color: "#16181a",
      weight: 3,
      fillColor: "#ffffff",
      fillOpacity: 1,
    }),
    L.circleMarker([end.lat, end.lon], {
      radius: 7,
      color: "#ffffff",
      weight: 3,
      fillColor: "#fc4c02",
      fillOpacity: 1,
    }),
  ]).addTo(map);
}

export function renderPlainRoute(points) {
  plainLayer = clearLayer(plainLayer);
  coloredLayer = clearLayer(coloredLayer);
  markersLayer = clearLayer(markersLayer);

  const latlngs = points.map((p) => [p.lat, p.lon]);
  plainLayer = L.polyline(latlngs, { color: "#0d74c9", weight: 4 }).addTo(map);
  addEndpoints(points);
  map.fitBounds(plainLayer.getBounds(), { padding: [30, 30] });
}

export function renderForecastRoute(points, samples) {
  plainLayer = clearLayer(plainLayer);
  coloredLayer = clearLayer(coloredLayer);
  markersLayer = clearLayer(markersLayer);

  coloredLayer = L.layerGroup().addTo(map);
  let sIdx = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const midDist = (points[i].distanceKm + points[i + 1].distanceKm) / 2;
    while (sIdx < samples.length - 1 && samples[sIdx + 1].distanceKm <= midDist) sIdx++;
    const cls = samples[sIdx].cls || "cross";
    L.polyline(
      [
        [points[i].lat, points[i].lon],
        [points[i + 1].lat, points[i + 1].lon],
      ],
      { color: CLASS_COLOR[cls], weight: 5, lineCap: "round" }
    ).addTo(coloredLayer);
  }

  markersLayer = L.layerGroup().addTo(map);
  const showArrows = window.innerWidth > 560;
  if (showArrows) {
    samples.forEach((s) => {
      if (!s.weather) return;
      const rotate = (s.weather.windDir + 180) % 360;
      const icon = L.divIcon({
        className: "wind-arrow-icon",
        html:
          `<div class="wind-arrow-dot"><svg viewBox="0 0 24 24" width="14" height="14">` +
          `<g transform="translate(12,12) rotate(${rotate})">` +
          `<line x1="0" y1="7" x2="0" y2="-7" stroke="#0d74c9" stroke-width="2.2" stroke-linecap="round"/>` +
          `<path d="M0,-7 L-3.5,-2 L3.5,-2 Z" fill="#0d74c9"/></g></svg></div>` +
          `<div class="wind-arrow-label">${Math.round(s.weather.windSpeed)}</div>`,
        iconSize: [30, 44],
        iconAnchor: [15, 15],
      });
      L.marker([s.lat, s.lon], { icon, interactive: false }).addTo(markersLayer);
    });
  }

  addEndpoints(points);
  map.fitBounds(L.polyline(points.map((p) => [p.lat, p.lon])).getBounds(), { padding: [30, 30] });
}
