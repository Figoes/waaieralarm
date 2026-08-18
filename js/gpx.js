export function parseGPX(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Kon dit bestand niet lezen — is het een geldig GPX-bestand?");
  }

  // Consumer GPX exports vary: recorded rides use <trk>/<trkpt>, planned
  // routes often use <rte>/<rtept>, and some tools emit both — checked in
  // that order and we take whichever has points.
  let nodes = Array.from(doc.getElementsByTagName("trkpt"));
  if (nodes.length === 0) nodes = Array.from(doc.getElementsByTagName("rtept"));
  if (nodes.length === 0) nodes = Array.from(doc.getElementsByTagName("wpt"));
  if (nodes.length === 0) {
    throw new Error("Geen routepunten gevonden in dit GPX-bestand.");
  }

  const points = nodes
    .map((node) => {
      const lat = parseFloat(node.getAttribute("lat"));
      const lon = parseFloat(node.getAttribute("lon"));
      const eleNode = node.getElementsByTagName("ele")[0];
      const ele = eleNode ? parseFloat(eleNode.textContent) : null;
      return { lat, lon, ele: Number.isFinite(ele) ? ele : null };
    })
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));

  if (points.length < 2) {
    throw new Error("Dit GPX-bestand heeft minstens twee routepunten nodig.");
  }

  const nameNode = doc.querySelector("trk > name, rte > name, metadata > name");
  const name = nameNode ? nameNode.textContent.trim() : null;

  return { points, name };
}
