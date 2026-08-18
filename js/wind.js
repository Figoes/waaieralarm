// windFromDeg: meteorological convention — direction the wind is blowing FROM.
export function headwindComponent(travelBearingDeg, windFromDeg, windSpeedKmh) {
  const blowingTowardsDeg = (windFromDeg + 180) % 360;
  let diff = blowingTowardsDeg - travelBearingDeg;
  diff = ((diff + 180) % 360 + 360) % 360 - 180; // normalize to [-180, 180]
  const component = windSpeedKmh * Math.cos((diff * Math.PI) / 180);
  return { component, angleDiff: diff };
}

// Within ~55° of a pure tailwind/headwind reads as tail/head; the rest is crosswind.
export function classify(angleDiff) {
  const abs = Math.abs(angleDiff);
  if (abs <= 55) return "tail";
  if (abs >= 125) return "head";
  return "cross";
}

export const CLASS_LABEL = { tail: "Tailwind", cross: "Crosswind", head: "Headwind" };

// Diverging scale: deep red (strong headwind) through amber (neutral) to deep
// green (strong tailwind). Matches the app's --head-red/--cross-amber/--tail-green
// at their respective stops so the legend bar lines up with the badge colors.
const GRADIENT_STOPS = [
  { t: -1, rgb: [178, 39, 62] },
  { t: -0.5, rgb: [214, 94, 66] },
  { t: 0, rgb: [201, 154, 0] },
  { t: 0.5, rgb: [124, 173, 82] },
  { t: 1, rgb: [23, 160, 109] },
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
