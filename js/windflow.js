// A lightweight, windy.com-style flowing particle field. Since we only have
// wind forecasts at sparse points along the route (not a full grid), the field
// at any location is an inverse-distance-weighted blend of the nearest samples
// — a reasonable local approximation, not a true meteorological field.
export function createWindFlow(map, containerEl) {
  const canvas = document.createElement("canvas");
  canvas.className = "wind-flow-canvas";
  containerEl.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const PARTICLE_COUNT = window.innerWidth < 560 ? 50 : 90;
  const TRAIL_LENGTH = 6;
  const DEG_PER_KMH_FRAME = 0.0000028;

  let samples = [];
  let particles = [];
  let running = false;
  let rafId = null;

  function resize() {
    const size = map.getSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, size.x * dpr);
    canvas.height = Math.max(1, size.y * dpr);
    canvas.style.width = size.x + "px";
    canvas.style.height = size.y + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function idwWind(lat, lon) {
    if (samples.length === 0) return null;
    let wSum = 0;
    let sx = 0;
    let sy = 0;
    for (const s of samples) {
      if (!s.weather) continue;
      const dLat = lat - s.lat;
      const dLon = lon - s.lon;
      const d2 = dLat * dLat + dLon * dLon;
      const w = 1 / Math.max(d2, 0.0002);
      const rad = (((s.weather.windDir + 180) % 360) * Math.PI) / 180; // "blowing towards"
      sx += w * Math.sin(rad) * s.weather.windSpeed;
      sy += w * -Math.cos(rad) * s.weather.windSpeed;
      wSum += w;
    }
    if (wSum === 0) return null;
    return { vx: sx / wSum, vy: sy / wSum };
  }

  function randomPointInBounds() {
    const b = map.getBounds();
    return {
      lat: b.getSouth() + Math.random() * (b.getNorth() - b.getSouth()),
      lon: b.getWest() + Math.random() * (b.getEast() - b.getWest()),
    };
  }

  function spawn() {
    const p = randomPointInBounds();
    return { lat: p.lat, lon: p.lon, trail: [], life: 30 + Math.random() * 90 };
  }

  function step() {
    const bounds = map.getBounds();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 1.4;
    ctx.lineCap = "round";

    particles.forEach((p) => {
      const wind = idwWind(p.lat, p.lon);
      if (wind) {
        p.lat += wind.vy * DEG_PER_KMH_FRAME;
        p.lon += (wind.vx * DEG_PER_KMH_FRAME) / Math.cos((p.lat * Math.PI) / 180);
      }
      p.trail.push({ lat: p.lat, lon: p.lon });
      if (p.trail.length > TRAIL_LENGTH) p.trail.shift();
      p.life -= 1;

      const outOfView = !bounds.contains([p.lat, p.lon]);
      if (p.life <= 0 || outOfView || !wind) {
        const fresh = spawn();
        p.lat = fresh.lat;
        p.lon = fresh.lon;
        p.trail = [];
        p.life = fresh.life;
        return;
      }

      for (let i = 1; i < p.trail.length; i++) {
        const a = map.latLngToContainerPoint([p.trail[i - 1].lat, p.trail[i - 1].lon]);
        const b = map.latLngToContainerPoint([p.trail[i].lat, p.trail[i].lon]);
        const alpha = (i / p.trail.length) * 0.45;
        ctx.strokeStyle = `rgba(13, 116, 201, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    });

    rafId = running ? requestAnimationFrame(step) : null;
  }

  return {
    setSamples(newSamples) {
      samples = newSamples.filter((s) => s.weather);
    },
    start() {
      if (running || reduceMotion || samples.length === 0) return;
      resize();
      particles = Array.from({ length: PARTICLE_COUNT }, spawn);
      running = true;
      step();
    },
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
    resize,
  };
}
