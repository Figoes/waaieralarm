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
  const PARTICLE_COUNT = window.innerWidth < 560 ? 140 : 260;
  const TRAIL_LENGTH = 11;

  // Particles move a fixed number of SCREEN PIXELS per km/h per frame, not a
  // fixed geographic distance. A fixed lat/lon step per frame looks fine
  // zoomed into a short route but becomes imperceptibly slow once you zoom
  // out for a long one — the same real-world distance covers far fewer
  // pixels. Pixel-space speed keeps the animation visibly moving at any zoom,
  // which is also how Windy's own flow reads at every zoom level.
  const PX_PER_KMH_FRAME = 0.06;
  const MAX_PX_PER_FRAME = 3.2;

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

  // Returns the local wind as {east, north} km/h components (positive east /
  // positive north), inverse-distance-weighted from the nearest samples.
  function idwWind(lat, lon) {
    if (samples.length === 0) return null;
    let wSum = 0;
    let east = 0;
    let north = 0;
    for (const s of samples) {
      const dLat = lat - s.lat;
      const dLon = lon - s.lon;
      const d2 = dLat * dLat + dLon * dLon;
      const w = 1 / Math.max(d2, 0.0002);
      const rad = (((s.weather.windDir + 180) % 360) * Math.PI) / 180; // "blowing towards", compass bearing
      east += w * Math.sin(rad) * s.weather.windSpeed;
      north += w * Math.cos(rad) * s.weather.windSpeed;
      wSum += w;
    }
    if (!wSum) return null;
    return { east: east / wSum, north: north / wSum };
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

  // Advects a particle by its local wind, in screen-pixel space, and writes
  // the result back as lat/lon (so bounds-checks and IDW sampling — both
  // geographic — keep working, and the motion self-corrects across pan/zoom).
  function advect(p, wind) {
    const speed = Math.hypot(wind.east, wind.north);
    if (!speed) return;
    const pxSpeed = Math.min(speed * PX_PER_KMH_FRAME, MAX_PX_PER_FRAME);
    const pt = map.latLngToContainerPoint([p.lat, p.lon]);
    pt.x += (wind.east / speed) * pxSpeed;
    pt.y -= (wind.north / speed) * pxSpeed; // screen y grows downward; north is "up"
    const next = map.containerPointToLatLng(pt);
    p.lat = next.lat;
    p.lon = next.lng;
  }

  function strokeTrail(trail, alphaScale) {
    for (let i = 1; i < trail.length; i++) {
      const a = map.latLngToContainerPoint([trail[i - 1].lat, trail[i - 1].lon]);
      const b = map.latLngToContainerPoint([trail[i].lat, trail[i].lon]);
      const alpha = (i / trail.length) * alphaScale;
      // Windy-style: a bright white streak with a thin dark outline
      // underneath, so it reads on any basemap tile — light or dark —
      // rather than blending into roads/land the way a single flat color
      // does.
      ctx.strokeStyle = `rgba(15, 30, 24, ${alpha * 0.55})`;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  function step() {
    const bounds = map.getBounds();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = "round";

    particles.forEach((p) => {
      const wind = idwWind(p.lat, p.lon);
      if (wind) advect(p, wind);

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

      strokeTrail(p.trail, 0.9);
    });

    rafId = running ? requestAnimationFrame(step) : null;
  }

  // Respects prefers-reduced-motion by never animating, but still shows a
  // single static frame of short strokes so wind direction reads at a
  // glance instead of the map just looking broken/empty.
  function drawStaticFrame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = "round";
    particles.forEach((p) => {
      const wind = idwWind(p.lat, p.lon);
      if (!wind) return;
      const head = map.latLngToContainerPoint([p.lat, p.lon]);
      const speed = Math.hypot(wind.east, wind.north) || 1;
      const len = TRAIL_LENGTH * MAX_PX_PER_FRAME * 0.7;
      const tailPt = {
        x: head.x - (wind.east / speed) * len,
        y: head.y + (wind.north / speed) * len,
      };
      const tail = map.containerPointToLatLng(tailPt);
      strokeTrail([{ lat: tail.lat, lon: tail.lng }, { lat: p.lat, lon: p.lon }], 0.6);
    });
  }

  return {
    setSamples(newSamples) {
      samples = newSamples.filter((s) => s.weather);
    },
    start() {
      if (samples.length === 0) return;
      resize();
      particles = Array.from({ length: PARTICLE_COUNT }, spawn);
      if (reduceMotion) {
        drawStaticFrame();
        return;
      }
      if (running) return;
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
