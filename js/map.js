import { bearingDeg } from "./geo.js?v=4";
import { gradientColor, rgbCss, classify, CLASS_COLORS } from "./wind.js?v=4";
import { createWindFlow } from "./windflow.js?v=4";

const INK = "#1D3A2E";
const ACCENT = "#E2542B";

let map = null;
let haloLayer = null;
let coloredLayer = null;
let plainLayer = null;
let markersLayer = null;
let directionLayer = null;
let endpointsLayer = null;
let windFlow = null;

export function invalidateMapSize() {
  if (map) map.invalidateSize();
}

export function getWindFlowStatus() {
  return windFlow ? windFlow.getStatus() : null;
}

export function initMap(containerId) {
  map = L.map(containerId, { zoomControl: false });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  map.attributionControl.setPosition("bottomright");
  map.setView([52.05, 5.2], 8);

  windFlow = createWindFlow(map);
  map.on("resize", () => windFlow.resize());
  window.addEventListener("resize", () => windFlow.resize());

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
    L.circleMarker([start.lat, start.lon], { radius: 7, color: INK, weight: 2, fillColor: ACCENT, fillOpacity: 1 }),
    L.circleMarker([end.lat, end.lon], { radius: 7, color: "#ffffff", weight: 2.5, fillColor: INK, fillOpacity: 1 }),
  ]).addTo(map);
}

// Picks a handful of interior points (skipping start/end) evenly spaced by
// distance, so direction chevrons read clearly without crowding the line.
function directionArrowPoints(points, targetCount = 7) {
  const total = points[points.length - 1].distanceKm;
  if (total <= 0) return [];
  const step = total / (targetCount + 1);
  const arrows = [];
  let pi = 0;
  for (let s = 1; s <= targetCount; s++) {
    const targetDist = s * step;
    while (pi < points.length - 2 && points[pi + 1].distanceKm < targetDist) pi++;
    const a = points[pi];
    const b = points[Math.min(pi + 1, points.length - 1)];
    if (a.lat === b.lat && a.lon === b.lon) continue;
    arrows.push({ lat: a.lat, lon: a.lon, bearing: bearingDeg(a.lat, a.lon, b.lat, b.lon) });
  }
  return arrows;
}

function renderDirectionArrows(points) {
  directionLayer = clearLayer(directionLayer);
  directionLayer = L.layerGroup().addTo(map);
  directionArrowPoints(points).forEach((a) => {
    const icon = L.divIcon({
      className: "direction-arrow-icon",
      html:
        `<svg width="16" height="16" viewBox="0 0 24 24">` +
        `<g transform="translate(12,12) rotate(${a.bearing})">` +
        `<path d="M0,-9 L6,7 L0,3 L-6,7 Z" fill="#ffffff" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>` +
        `</g></svg>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
    L.marker([a.lat, a.lon], { icon, interactive: false }).addTo(directionLayer);
  });
}

export function renderPlainRoute(points) {
  haloLayer = clearLayer(haloLayer);
  coloredLayer = clearLayer(coloredLayer);
  plainLayer = clearLayer(plainLayer);
  markersLayer = clearLayer(markersLayer);
  windFlow.stop();

  const latlngs = points.map((p) => [p.lat, p.lon]);
  haloLayer = L.polyline(latlngs, { color: "#ffffff", weight: 8, lineCap: "round" }).addTo(map);
  plainLayer = L.polyline(latlngs, { color: INK, weight: 4, lineCap: "round" }).addTo(map);
  renderDirectionArrows(points);
  addEndpoints(points);
  map.fitBounds(plainLayer.getBounds(), { padding: [30, 30] });
}

function windPillIcon(rotate, cls, kmh) {
  const colors = CLASS_COLORS[cls];
  return L.divIcon({
    className: "wind-pill-icon",
    html:
      `<div class="wind-pill">` +
      `<span class="badge" style="background:${colors.bg}; color:${colors.text};">` +
      `<svg viewBox="0 0 16 16" fill="none"><g transform="rotate(${rotate} 8 8)">` +
      `<path d="M8 2.5V13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>` +
      `<path d="M4.8 5.8L8 2.5 11.2 5.8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` +
      `</g></svg></span>` +
      `<span class="kmh">${Math.round(kmh)}</span>` +
      `</div>`,
    iconSize: [56, 28],
    iconAnchor: [28, 14],
  });
}

export function renderForecastRoute(points, samples) {
  haloLayer = clearLayer(haloLayer);
  coloredLayer = clearLayer(coloredLayer);
  plainLayer = clearLayer(plainLayer);
  markersLayer = clearLayer(markersLayer);

  const latlngs = points.map((p) => [p.lat, p.lon]);
  haloLayer = L.polyline(latlngs, { color: "#ffffff", weight: 10, lineCap: "round", lineJoin: "round" }).addTo(map);

  coloredLayer = L.layerGroup().addTo(map);
  let sIdx = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const midDist = (points[i].distanceKm + points[i + 1].distanceKm) / 2;
    while (sIdx < samples.length - 1 && samples[sIdx + 1].distanceKm <= midDist) sIdx++;
    const component = samples[sIdx].component ?? 0;
    L.polyline(
      [
        [points[i].lat, points[i].lon],
        [points[i + 1].lat, points[i + 1].lon],
      ],
      { color: rgbCss(gradientColor(component)), weight: 5, lineCap: "round" }
    ).addTo(coloredLayer);
  }

  markersLayer = L.layerGroup().addTo(map);
  const showArrows = window.innerWidth > 560;
  if (showArrows) {
    samples.forEach((s) => {
      if (!s.weather) return;
      const rotate = (s.weather.windDir + 180) % 360;
      const cls = s.cls || classify(180);
      L.marker([s.lat, s.lon], { icon: windPillIcon(rotate, cls, s.weather.windSpeed), interactive: false }).addTo(markersLayer);
    });
  }

  renderDirectionArrows(points);
  addEndpoints(points);
  map.fitBounds(L.polyline(latlngs).getBounds(), { padding: [30, 30] });

  windFlow.setSamples(samples);
  windFlow.start();
}
