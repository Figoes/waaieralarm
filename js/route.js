import { haversineKm, bearingDeg } from "./geo.js";

export function annotateDistances(points) {
  let cum = 0;
  return points.map((p, i) => {
    if (i > 0) cum += haversineKm(points[i - 1].lat, points[i - 1].lon, p.lat, p.lon);
    return { ...p, distanceKm: cum };
  });
}

export function elevationGainM(points) {
  let gain = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].ele;
    const cur = points[i].ele;
    if (prev != null && cur != null && cur > prev) gain += cur - prev;
  }
  return Math.round(gain);
}

// Picks evenly-spaced points along the route (by distance, not by index)
// so forecast samples land roughly every totalDistance/(targetCount-1) km.
export function sampleRoute(points, targetCount = 10) {
  const total = points[points.length - 1].distanceKm;
  const count = Math.max(2, Math.min(targetCount, points.length));
  const step = total / (count - 1);

  const samples = [];
  let pi = 0;
  for (let s = 0; s < count; s++) {
    const targetDist = s === count - 1 ? total : s * step;
    while (pi < points.length - 1 && points[pi + 1].distanceKm < targetDist) pi++;
    const p = points[pi];
    samples.push({ lat: p.lat, lon: p.lon, distanceKm: targetDist });
  }

  for (let i = 0; i < samples.length; i++) {
    if (i < samples.length - 1) {
      samples[i].bearing = bearingDeg(
        samples[i].lat,
        samples[i].lon,
        samples[i + 1].lat,
        samples[i + 1].lon
      );
    } else {
      samples[i].bearing = samples[i - 1] ? samples[i - 1].bearing : 0;
    }
  }

  return samples;
}

export function estimateArrivals(samples, startDate, paceKmh) {
  return samples.map((s) => ({
    ...s,
    eta: new Date(startDate.getTime() + (s.distanceKm / paceKmh) * 3600000),
  }));
}
