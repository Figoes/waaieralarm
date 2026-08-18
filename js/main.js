import { parseGPX } from "./gpx.js?v=3";
import { annotateDistances, elevationGainM, sampleRoute, estimateArrivals } from "./route.js?v=3";
import { haversineKm, bearingDeg } from "./geo.js?v=3";
import { headwindComponent, classify, CLASS_LABEL, CLASS_COLORS, compassLabel, beaufort } from "./wind.js?v=3";
import { fetchForecastForSamples, fetchDailyOutlook } from "./weather.js?v=3";
import { initMap, invalidateMapSize, renderPlainRoute, renderForecastRoute, getWindFlowStatus } from "./map.js?v=3";

const $ = (sel) => document.querySelector(sel);
const nl = (n, opts) => n.toLocaleString("nl-NL", opts);
const nlTime = (d) => d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });

const state = { points: null, filename: null };

initMap("map");

// Default departure: next quarter-hour from now, in the format datetime-local expects.
function defaultStart() {
  const d = new Date();
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
$("#start").value = defaultStart();

function showError(msg) {
  const el = $("#errorBanner");
  el.textContent = msg;
  el.hidden = false;
}
function clearError() {
  $("#errorBanner").hidden = true;
}

function setPlotting(isPlotting) {
  const btn = $("#plotBtn");
  btn.disabled = isPlotting || !state.points;
  btn.textContent = isPlotting ? "Berekenen…" : "Verwachting berekenen";
}

function showRouteLoaded(loaded) {
  $("#emptyState").hidden = loaded;
  $("#mainLayout").hidden = !loaded;
}

$("#importBtn").addEventListener("click", () => $("#gpxInput").click());
$("#importBtnEmpty").addEventListener("click", () => $("#gpxInput").click());

$("#gpxInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  clearError();
  try {
    const text = await file.text();
    const { points: raw, name } = parseGPX(text);
    const points = annotateDistances(raw);
    state.points = points;
    state.filename = file.name;

    const total = points[points.length - 1].distanceKm;
    const gain = elevationGainM(points);
    const isLoop = haversineKm(points[0].lat, points[0].lon, points[points.length - 1].lat, points[points.length - 1].lon) < 0.3;
    $("#routeName").textContent = name || file.name;
    $("#routeMeta").textContent = `${nl(total, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km · ${gain} hm${isLoop ? " · lus" : ""}`;

    showRouteLoaded(true);
    $("#mapEmptyHint").hidden = true;
    invalidateMapSize();
    renderPlainRoute(points);
    $("#plotBtn").disabled = false;
    $("#timeline").innerHTML = '<span class="timeline-placeholder">Bereken de verwachting om windgegevens per kilometer te zien</span>';
    $("#mapLegend").hidden = true;
    resetPrevailingWind();
    resetImpactSummary();

    renderOutlookLoading();
    fetchDailyOutlook(points[0].lat, points[0].lon)
      .then((daily) => renderOutlook(daily, points))
      .catch((err) => showError(err.message));
  } catch (err) {
    console.error("GPX import failed:", err);
    showError(err.message || "Kon dit GPX-bestand niet lezen.");
    state.points = null;
    $("#plotBtn").disabled = true;
  } finally {
    e.target.value = "";
  }
});

$("#plotBtn").addEventListener("click", async () => {
  if (!state.points) return;
  clearError();

  const startDate = new Date($("#start").value);
  const pace = parseFloat($("#pace").value) || 25;

  if (Number.isNaN(startDate.getTime())) {
    showError("Kies eerst een vertrekdatum en -tijd.");
    return;
  }
  const now = new Date();
  if (startDate.getTime() < now.getTime() - 3600 * 1000) {
    showError("Vertrek kan niet in het verleden liggen.");
    return;
  }
  if (startDate.getTime() > now.getTime() + 15 * 24 * 3600 * 1000) {
    showError("Voorspellingen zijn maximaal 15 dagen vooruit beschikbaar.");
    return;
  }

  setPlotting(true);
  try {
    const samples = estimateArrivals(sampleRoute(state.points, 10), startDate, pace);
    const withWeather = await fetchForecastForSamples(samples);

    let anyWeather = false;
    withWeather.forEach((s) => {
      if (!s.weather) {
        s.cls = null;
        return;
      }
      anyWeather = true;
      const { angleDiff, component } = headwindComponent(s.bearing, s.weather.windDir, s.weather.windSpeed);
      s.cls = classify(angleDiff);
      s.component = component;
    });

    if (!anyWeather) {
      showError("Voor dit tijdstip was geen voorspelling beschikbaar — probeer een ander vertrek.");
      setPlotting(false);
      return;
    }

    renderForecastRoute(state.points, withWeather);
    renderTimeline(withWeather);
    updatePrevailingWind(withWeather);
    updateImpactSummary(state.points, withWeather);
    $("#mapLegend").hidden = false;
    startFlowDebug();
  } catch (err) {
    showError(err.message || "Kon de verwachting niet ophalen.");
  } finally {
    setPlotting(false);
  }
});

function windArrowSVG(rotateDeg, colorCss = "currentColor") {
  return (
    `<svg viewBox="0 0 16 16" fill="none"><g transform="rotate(${rotateDeg} 8 8)">` +
    `<path d="M8 2.5V13" stroke="${colorCss}" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M4.8 5.8L8 2.5 11.2 5.8" stroke="${colorCss}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></g></svg>`
  );
}

function renderTimeline(samples) {
  const el = $("#timeline");
  el.innerHTML = "";
  samples.forEach((s) => {
    const card = document.createElement("div");
    card.className = "wp-card";
    if (!s.weather) {
      card.innerHTML = `
        <div class="wp-top"><span class="wp-dist">${Math.round(s.distanceKm)} km</span></div>
        <div class="wp-weather"><span>Geen voorspelling</span></div>
      `;
      el.appendChild(card);
      return;
    }
    const rotate = (s.weather.windDir + 180) % 360;
    const cls = s.cls || "zij";
    const colors = CLASS_COLORS[cls];
    card.innerHTML = `
      <div class="wp-top">
        <span class="wp-dist">${Math.round(s.distanceKm)} km</span>
        <span class="wp-time">${nlTime(s.eta)}</span>
      </div>
      <div class="wp-wind">
        <span class="badge" style="background:${colors.bg}; color:${colors.text};">${windArrowSVG(rotate)}</span>
        <span class="kmh">${Math.round(s.weather.windSpeed)}</span>
        <span class="unit-inline">km/h</span>
      </div>
      <div class="wp-weather"><span>${Math.round(s.weather.temp)}°C</span><span>${Math.round(s.weather.precipProb)}%</span></div>
      <div class="wp-label" style="color:${colors.text};">${CLASS_LABEL[cls]}</div>
    `;
    el.appendChild(card);
  });
}

function resetPrevailingWind() {
  $("#prevailingKmh").textContent = "–";
  $("#prevailingDir").textContent = "–";
  $("#windRoseArrow").setAttribute("transform", "rotate(0 60 60)");
}

function updatePrevailingWind(samples) {
  const withWeather = samples.filter((s) => s.weather);
  if (withWeather.length === 0) return;
  const first = withWeather[0].weather;
  $("#prevailingKmh").textContent = Math.round(first.windSpeed);
  $("#prevailingDir").textContent = `${compassLabel(first.windDir)} · ${beaufort(first.windSpeed)} Bft`;
  const rotate = (first.windDir + 180) % 360;
  $("#windRoseArrow").setAttribute("transform", `rotate(${rotate} 60 60)`);
}

function resetImpactSummary() {
  $("#impactTegenKm").textContent = "–";
  $("#impactZijKm").textContent = "–";
  $("#impactMeeKm").textContent = "–";
}

function updateImpactSummary(points, samples) {
  const totals = { tegen: 0, zij: 0, mee: 0 };
  let sIdx = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const segKm = points[i + 1].distanceKm - points[i].distanceKm;
    const midDist = (points[i].distanceKm + points[i + 1].distanceKm) / 2;
    while (sIdx < samples.length - 1 && samples[sIdx + 1].distanceKm <= midDist) sIdx++;
    const cls = samples[sIdx].cls || "zij";
    totals[cls] += segKm;
  }
  $("#impactTegenKm").textContent = Math.round(totals.tegen);
  $("#impactZijKm").textContent = Math.round(totals.zij);
  $("#impactMeeKm").textContent = Math.round(totals.mee);
}

function renderOutlookLoading() {
  $("#outlookRow").innerHTML = '<span class="timeline-placeholder">Laden…</span>';
}

function renderOutlook(days, points) {
  const row = $("#outlookRow");
  if (!days.length) {
    row.innerHTML = '<span class="timeline-placeholder">Geen vooruitblik beschikbaar voor deze locatie</span>';
    return;
  }
  const routeBearing = bearingDeg(points[0].lat, points[0].lon, points[points.length - 1].lat, points[points.length - 1].lon);
  const selectedDate = $("#start").value ? $("#start").value.slice(0, 10) : null;

  row.innerHTML = "";
  days.forEach((d) => {
    const { angleDiff } = headwindComponent(routeBearing, d.windDir, d.windSpeed);
    const cls = classify(angleDiff);
    const colors = CLASS_COLORS[cls];
    const rotate = (d.windDir + 180) % 360;
    const dow = new Date(d.date + "T00:00:00").toLocaleDateString("nl-NL", { weekday: "short" }).toLowerCase();

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "outlook-day";
    btn.style.cssText = "background:none;border:none;cursor:pointer;font-family:inherit;padding:0;";
    btn.innerHTML = `
      <span class="dow">${dow}</span>
      <span class="badge" style="background:${colors.bg}; color:${colors.text}; ${d.date === selectedDate ? `outline:2px solid ${colors.text}; outline-offset:2px;` : ""}">${windArrowSVG(rotate)}</span>
      <span class="kmh">${Math.round(d.windSpeed)}</span>
    `;
    btn.addEventListener("click", () => {
      const time = $("#start").value.slice(11) || "08:00";
      $("#start").value = `${d.date}T${time}`;
      renderOutlook(days, points);
    });
    row.appendChild(btn);
  });
}

// Temporary diagnostic readout for the wind-flow animation — shows what's
// actually happening on this device (particle count, frames rendered,
// any error) instead of guessing blind when someone reports "no animation".
let flowDebugInterval = null;
function startFlowDebug() {
  if (flowDebugInterval) clearInterval(flowDebugInterval);
  const el = $("#flowDebug");
  el.hidden = false;
  flowDebugInterval = setInterval(() => {
    const s = getWindFlowStatus();
    if (!s) {
      el.textContent = "wind-flow: geen instantie";
      return;
    }
    el.textContent =
      `wind-flow: draait=${s.running} deeltjes=${s.particleCount} samples=${s.sampleCount} ` +
      `frames=${s.frameCount} laatst-getekend=${s.drawnLastFrame} canvas=${s.canvasSize.join("x")} ` +
      `verminderde-beweging=${s.reducedMotion}${s.lastError ? ` FOUT: ${s.lastError}` : ""}`;
  }, 1000);
}
