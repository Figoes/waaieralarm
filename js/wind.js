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
export const CLASS_COLOR_VAR = { tail: "--tail-green", cross: "--cross-amber", head: "--head-red" };
