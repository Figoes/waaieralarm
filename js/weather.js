const BASE = "https://api.open-meteo.com/v1/forecast";

// Open-Meteo accepts comma-separated lat/lon lists and returns one object
// per location (in the same order) when more than one point is requested.
export async function fetchForecastForSamples(samples) {
  const lats = samples.map((s) => s.lat.toFixed(4)).join(",");
  const lons = samples.map((s) => s.lon.toFixed(4)).join(",");
  const url =
    `${BASE}?latitude=${lats}&longitude=${lons}` +
    `&hourly=temperature_2m,precipitation_probability,windspeed_10m,winddirection_10m` +
    `&forecast_days=16&timezone=auto`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("The weather service didn't respond — try again in a moment.");
  const data = await res.json();
  const list = Array.isArray(data) ? data : [data];

  return samples.map((s, i) => {
    const loc = list[i];
    if (!loc || !loc.hourly || !loc.hourly.time || loc.hourly.time.length === 0) {
      return { ...s, weather: null };
    }
    const times = loc.hourly.time.map((t) => new Date(t).getTime());
    let bestIdx = 0;
    let bestDiff = Infinity;
    const targetMs = s.eta.getTime();
    for (let ti = 0; ti < times.length; ti++) {
      const diff = Math.abs(times[ti] - targetMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = ti;
      }
    }
    const withinRange = bestDiff < 2 * 3600 * 1000;
    if (!withinRange) return { ...s, weather: null };
    return {
      ...s,
      weather: {
        temp: loc.hourly.temperature_2m[bestIdx],
        precipProb: loc.hourly.precipitation_probability[bestIdx],
        windSpeed: loc.hourly.windspeed_10m[bestIdx],
        windDir: loc.hourly.winddirection_10m[bestIdx],
      },
    };
  });
}

export async function fetchDailyOutlook(lat, lon) {
  const url =
    `${BASE}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&daily=windspeed_10m_max,winddirection_10m_dominant&forecast_days=7&timezone=auto`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("The weather service didn't respond — try again in a moment.");
  const data = await res.json();
  if (!data.daily) return [];
  return data.daily.time.map((date, i) => ({
    date,
    windSpeed: data.daily.windspeed_10m_max[i],
    windDir: data.daily.winddirection_10m_dominant[i],
  }));
}
