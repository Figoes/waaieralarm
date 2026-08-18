// windFromDeg: meteorological convention — direction the wind is blowing FROM.
export function headwindComponent(travelBearingDeg, windFromDeg, windSpeedKmh) {
  const blowingTowardsDeg = (windFromDeg + 180) % 360;
  let diff = blowingTowardsDeg - travelBearingDeg;
  diff = ((diff + 180) % 360 + 360) % 360 - 180; // normalize to [-180, 180]
  const component = windSpeedKmh * Math.cos((diff * Math.PI) / 180);
  return { component, angleDiff: diff };
}

// |Δ| ≤ 45° = meewind, 45–135° = zijwind, ≥ 135° = tegenwind.
export function classify(angleDiff) {
  const abs = Math.abs(angleDiff);
  if (abs <= 45) return "mee";
  if (abs >= 135) return "tegen";
  return "zij";
}

export const CLASS_LABEL = { mee: "Meewind", zij: "Zijwind", tegen: "Tegenwind" };

// Flat semantic colors for the 7-day badges, map pills and per-km cards.
export const CLASS_COLORS = {
  tegen: { bg: "#FBE7E4", text: "#C4362C" },
  zij: { bg: "#FBF1DC", text: "#B07C12" },
  mee: { bg: "#DFF3EE", text: "#0E7F6D" },
};

// Continuous scale for the route line and the windimpact summary bar: tegen
// → zij → mee, matching the 4-stop gradient from the Duin house style.
const GRADIENT_STOPS = [
  { t: -1, rgb: [224, 74, 63] }, // #E04A3F
  { t: -0.34, rgb: [232, 179, 60] }, // #E8B33C
  { t: 0.34, rgb: [168, 196, 71] }, // #A8C447
  { t: 1, rgb: [23, 160, 138] }, // #17A08A
];

// component is the signed headwind/tailwind push in km/h from headwindComponent().
// scaleMax is the |component| at which the color reaches full saturation —
// a fixed real-world value so a given shade means the same wind strength on
// every ride, rather than rescaling to whatever the windiest day looked like.
export function gradientColor(component, scaleMax = 22) {
  const t = Math.max(-1, Math.min(1, component / scaleMax));
  for (let i = 0; i < GRADIENT_STOPS.length - 1; i++) {
    const a = GRADIENT_STOPS[i];
    const b = GRADIENT_STOPS[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = (t - a.t) / (b.t - a.t);
      return a.rgb.map((c, idx) => Math.round(c + (b.rgb[idx] - c) * f));
    }
  }
  return GRADIENT_STOPS[GRADIENT_STOPS.length - 1].rgb;
}

export function rgbCss([r, g, b], alpha = 1) {
  return alpha === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const COMPASS_POINTS = [
  "Noord", "Noordnoordoost", "Noordoost", "Oostnoordoost",
  "Oost", "Oostzuidoost", "Zuidoost", "Zuidzuidoost",
  "Zuid", "Zuidzuidwest", "Zuidwest", "Westzuidwest",
  "West", "Westnoordwest", "Noordwest", "Noordnoordwest",
];

// deg is "blowing from" direction, meteorological convention.
export function compassLabel(deg) {
  const idx = Math.round(((deg % 360) / 22.5)) % 16;
  return COMPASS_POINTS[idx];
}

// Beaufort scale from mean wind speed in km/h (standard upper-bound table).
const BEAUFORT_THRESHOLDS = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
export function beaufort(kmh) {
  for (let b = 0; b < BEAUFORT_THRESHOLDS.length; b++) {
    if (kmh < BEAUFORT_THRESHOLDS[b]) return b;
  }
  return 12;
}
