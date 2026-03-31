const GOOGLE_VIEWPORT_URL = "https://tile.googleapis.com/tile/v1/viewport";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.GOOGLE_MAPS_TILE_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Google Map Tiles API key is not configured" });
    return;
  }

  const { session, zoom, north, south, east, west } = req.query;
  if (!session || !zoom || !north || !south || !east || !west) {
    res.status(400).json({
      error: "Missing required query params: session, zoom, north, south, east, west",
    });
    return;
  }

  const viewportUrl =
    `${GOOGLE_VIEWPORT_URL}?session=${encodeURIComponent(session)}` +
    `&zoom=${encodeURIComponent(zoom)}` +
    `&north=${encodeURIComponent(north)}` +
    `&south=${encodeURIComponent(south)}` +
    `&east=${encodeURIComponent(east)}` +
    `&west=${encodeURIComponent(west)}` +
    `&key=${apiKey}`;

  try {
    const response = await fetch(viewportUrl);
    const text = await response.text();

    if (!response.ok) {
      res.status(response.status).json({
        error: "Failed to fetch Google viewport attribution",
        details: text,
      });
      return;
    }

    const data = JSON.parse(text);
    res.setHeader("Cache-Control", "private, max-age=60");
    res.status(200).json({
      copyright: data.copyright || "",
      maxZoomRects: Array.isArray(data.maxZoomRects) ? data.maxZoomRects : [],
    });
  } catch (error: any) {
    res.status(500).json({
      error: "Unexpected error fetching Google viewport attribution",
      details: error?.message || "Unknown error",
    });
  }
}
