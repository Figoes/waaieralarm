import { parseGPX } from "./gpx.js";
import { annotateDistances, elevationGainM, sampleRoute, estimateArrivals } from "./route.js";
import { headwindComponent, classify, CLASS_LABEL } from "./wind.js";
import { fetchForecastForSamples, fetchDailyOutlook } from "./weather.js";
import { initMap, renderPlainRoute, renderForecastRoute } from "./map.js";

const $ = (sel) => document.querySelector(sel);

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
  btn.textContent = isPlotting ? "Plotting…" : "Plot forecast";
}

$("#importBtn").addEventListener("click", () => $("#gpxInput").click());

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
    $("#routeName").textContent = name || file.name;
    $("#routeStats").textContent = `${total.toFixed(1)} km · ${gain} m elevation`;

    $("#mapEmptyHint").hidden = true;
    renderPlainRoute(points);
    $("#plotBtn").disabled = false;
    $("#timeline").innerHTML = '<span class="timeline-placeholder">Plot the forecast to see wind and weather along your ride</span>';
    $("#windChip").hidden = true;

    renderOutlookLoading();
    fetchDailyOutlook(points[0].lat, points[0].lon)
      .then(renderOutlook)
      .catch((err) => showError(err.message));
  } catch (err) {
    showError(err.message || "Could not read this GPX file.");
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
    showError("Pick a departure date and time first.");
    return;
  }
  const now = new Date();
  if (startDate.getTime() < now.getTime() - 3600 * 1000) {
    showError("Departure can't be in the past.");
    return;
  }
  if (startDate.getTime() > now.getTime() + 15 * 24 * 3600 * 1000) {
    showError("Forecasts are only available up to 15 days ahead.");
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
      const { angleDiff } = headwindComponent(s.bearing, s.weather.windDir, s.weather.windSpeed);
      s.cls = classify(angleDiff);
    });

    if (!anyWeather) {
      showError("No forecast data was available for that time — try a different departure.");
      setPlotting(false);
      return;
    }

    renderForecastRoute(state.points, withWeather);
    renderTimeline(withWeather);
    updatePrevailingWind(withWeather);
  } catch (err) {
    showError(err.message || "Could not fetch the forecast.");
  } finally {
    setPlotting(false);
  }
});

function windArrowSVG(rotateDeg, colorVar = "var(--wind-blue)") {
  return (
    `<svg viewBox="0 0 24 24"><g transform="translate(12,12) rotate(${rotateDeg})">` +
    `<line x1="0" y1="8" x2="0" y2="-8" stroke="${colorVar}" stroke-width="2.5" stroke-linecap="round"/>` +
    `<path d="M0,-8 L-4,-2 L4,-2 Z" fill="${colorVar}"/></g></svg>`
  );
}

function renderTimeline(samples) {
  const el = $("#timeline");
  el.innerHTML = "";
  samples.forEach((s) => {
    const card = document.createElement("div");
    card.className = "card wp-card";
    if (!s.weather) {
      card.innerHTML = `
        <div class="wp-top"><span class="wp-dist">${s.distanceKm.toFixed(0)} km</span></div>
        <div class="wp-weather"><span>No forecast</span></div>
      `;
      el.appendChild(card);
      return;
    }
    const rotate = (s.weather.windDir + 180) % 360;
    const cls = s.cls || "cross";
    card.innerHTML = `
      <div class="wp-top">
        <span class="wp-dist">${s.distanceKm.toFixed(0)} km</span>
        <span class="wp-eta">${s.eta.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <div class="wp-wind">
        <span class="arrow-badge">${windArrowSVG(rotate)}</span>
        <span class="speed">${Math.round(s.weather.windSpeed)}<small> km/h</small></span>
      </div>
      <div class="wp-weather"><span>${Math.round(s.weather.temp)}°C</span><span>${Math.round(s.weather.precipProb)}%</span></div>
      <span class="wp-badge ${cls}">${CLASS_LABEL[cls]}</span>
    `;
    el.appendChild(card);
  });
}

function updatePrevailingWind(samples) {
  const withWeather = samples.filter((s) => s.weather);
  if (withWeather.length === 0) return;
  const first = withWeather[0].weather;
  const chip = $("#windChip");
  chip.hidden = false;
  $("#windChipValue").textContent = `${Math.round(first.windSpeed)} km/h`;
  $("#windChipArrow").setAttribute("transform", `translate(12,12) rotate(${(first.windDir + 180) % 360})`);
}

function renderOutlookLoading() {
  $("#outlookBody").innerHTML = '<span class="outlook-placeholder">Loading…</span>';
}

function renderOutlook(days) {
  const body = $("#outlookBody");
  if (!days.length) {
    body.innerHTML = '<span class="outlook-placeholder">No outlook available for this location</span>';
    return;
  }
  const selectedDate = $("#start").value ? $("#start").value.slice(0, 10) : null;

  const row = document.createElement("div");
  row.className = "outlook-row";
  days.forEach((d) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "outlook-day" + (d.date === selectedDate ? " selected" : "");
    const dow = new Date(d.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "narrow" });
    const rotate = (d.windDir + 180) % 360;
    const arrowColor = d.date === selectedDate ? "#ffffff" : "var(--ink-soft)";
    btn.innerHTML = `
      <span class="dow">${dow}</span>
      <span class="cell">${windArrowSVG(rotate, arrowColor)}</span>
      <span class="kmh">${Math.round(d.windSpeed)}</span>
    `;
    btn.addEventListener("click", () => {
      const time = $("#start").value.slice(11) || "08:00";
      $("#start").value = `${d.date}T${time}`;
      renderOutlook(days);
    });
    row.appendChild(btn);
  });

  body.innerHTML = "";
  body.appendChild(row);
}
