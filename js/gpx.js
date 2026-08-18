export function parseGPX(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Could not read this file — is it a valid GPX file?");
  }

  let nodes = Array.from(doc.getElementsByTagName("trkpt"));
  if (nodes.length === 0) nodes = Array.from(doc.getElementsByTagName("rtept"));
  if (nodes.length === 0) {
    throw new Error("No track points found in this GPX file.");
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
    throw new Error("This GPX file needs at least two track points.");
  }

  const nameNode = doc.querySelector("trk > name, rte > name, metadata > name");
  const name = nameNode ? nameNode.textContent.trim() : null;

  return { points, name };
}
