// A lightweight, windy.com-style flowing particle field. Since we only have
// wind forecasts at sparse points along the route (not a full grid), the field
// at any location is an inverse-distance-weighted blend of the nearest samples
// — a reasonable local approximation, not a true meteorological field.
export function createWindFlow(map) {
  // A manually z-indexed sibling element to the map container turned out to
  // stack inconsistently across browsers (rendered fine here, but reported
  // as hidden behind the tiles — only flashing visible mid zoom-transition,
  // a classic symptom of a stacking-context mismatch). Leaflet's own pane
  // system is the browser-tested, correct way to place a custom layer at a
  // specific depth: it lives inside .leaflet-map-pane alongside the tile
  // and overlay panes instead of guessing how it composites against them.
  map.createPane("windFlowPane");
  const pane = map.getPane("windFlowPane");
  pane.style.zIndex = 350; // above tilePane (200), below overlayPane (400) / markerPane (600)
  pane.style.pointerEvents = "none";

  const canvas = document.createElement("canvas");
  canvas.className = "wind-flow-canvas";
  pane.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const PARTICLE_COUNT = window.innerWidth < 560 ? 100 : 200;
  const TRAIL_LENGTH = 10;

  // Pixels per km/h per frame, not a fixed geographic distance — a fixed
  // lat/lon step per frame looks fine zoomed into a short route but becomes
  // imperceptibly slow once you zoom out for a long one, since the same
  // real-world distance covers far fewer pixels.
  const PX_PER_KMH_FRAME = 0.06;
  const MAX_PX_PER_FRAME = 3.2;
  const EDGE_MARGIN = 40; // px of slack around the canvas before a particle respawns

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

  function spawn() {
    const b = map.getBounds();
    const lat = b.getSouth() + Math.random() * (b.getNorth() - b.getSouth());
    const lon = b.getWest() + Math.random() * (b.getEast() - b.getWest());
    const pt = map.latLngToContainerPoint([lat, lon]);
    return { x: pt.x, y: pt.y, trail: [], life: 30 + Math.random() * 90 };
  }

  // Draws one particle's trail as two single strokes (a dark halo pass, then
  // a white pass) using a gradient for the fade, instead of one stroke() call
  // per segment. Trail points are already screen pixels — particles live in
  // pixel space (see step()), not lat/lon, so no per-frame projection needed.
  function strokeTrail(trail) {
    if (trail.length < 2) return;
    const first = trail[0];
    const last = trail[trail.length - 1];

    ctx.beginPath();
    trail.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));

    const halo = ctx.createLinearGradient(first.x, first.y, last.x, last.y);
    halo.addColorStop(0, "rgba(15, 30, 24, 0)");
    halo.addColorStop(1, "rgba(15, 30, 24, 0.5)");
    ctx.strokeStyle = halo;
    ctx.lineWidth = 2.6;
    ctx.stroke();

    const line = ctx.createLinearGradient(first.x, first.y, last.x, last.y);
    line.addColorStop(0, "rgba(255, 255, 255, 0)");
    line.addColorStop(1, "rgba(255, 255, 255, 0.9)");
    ctx.strokeStyle = line;
    ctx.lineWidth = 1.3;
    ctx.stroke();
  }

  function advanceParticle(p, size) {
    // Sample wind at the particle's current geographic position — read
    // only, never written back, so Leaflet's pixel rounding here can't
    // erase the sub-pixel motion accumulated below.
    const latlng = map.containerPointToLatLng([p.x, p.y]);
    const wind = idwWind(latlng.lat, latlng.lng);

    if (wind) {
      const speed = Math.hypot(wind.east, wind.north);
      if (speed) {
        const pxSpeed = Math.min(speed * PX_PER_KMH_FRAME, MAX_PX_PER_FRAME);
        p.x += (wind.east / speed) * pxSpeed;
        p.y -= (wind.north / speed) * pxSpeed; // screen y grows downward; north is "up"
      }
    }

    p.life -= 1;
    const outOfView = p.x < -EDGE_MARGIN || p.x > size.x + EDGE_MARGIN || p.y < -EDGE_MARGIN || p.y > size.y + EDGE_MARGIN;
    if (p.life <= 0 || outOfView || !wind) {
      const fresh = spawn();
      p.x = fresh.x;
      p.y = fresh.y;
      p.trail = [];
      p.life = fresh.life;
      return;
    }

    p.trail.push({ x: p.x, y: p.y });
    if (p.trail.length > TRAIL_LENGTH) p.trail.shift();
    strokeTrail(p.trail);
  }

  function step() {
    try {
      const size = map.getSize();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      particles.forEach((p) => {
        // One bad particle (e.g. a stray NaN) must not take the whole loop
        // down with it — without this, a single thrown error here means
        // the requestAnimationFrame(step) call below never runs again and
        // the animation silently stops forever with no visible sign why.
        try {
          advanceParticle(p, size);
        } catch {
          // skip this particle for this frame
        }
      });
    } catch {
      // skip this frame
    }
    rafId = running ? requestAnimationFrame(step) : null;
  }

  return {
    setSamples(newSamples) {
      samples = newSamples.filter((s) => s.weather);
    },
    start() {
      if (samples.length === 0 || running) return;
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
