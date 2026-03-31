const GOOGLE_2D_TILE_BASE_URL = "https://tile.googleapis.com/v1/2dtiles";

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

  const { session, z, x, y } = req.query;
  if (!session || !z || !x || !y) {
    res.status(400).json({
      error: "Missing required query params: session, z, x, y",
    });
    return;
  }

  const tileUrl = `${GOOGLE_2D_TILE_BASE_URL}/${z}/${x}/${y}?session=${encodeURIComponent(
    session,
  )}&key=${apiKey}`;

  try {
    const response = await fetch(tileUrl);

    if (!response.ok) {
      const details = await response.text();
      res.status(response.status).json({
        error: "Failed to fetch Google tile",
        details,
      });
      return;
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const cacheControl =
      response.headers.get("cache-control") || "public, max-age=3600";
    const arrayBuffer = await response.arrayBuffer();

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", cacheControl);
    res.status(200).send(Buffer.from(arrayBuffer));
  } catch (error: any) {
    res.status(500).json({
      error: "Unexpected error fetching Google tile",
      details: error?.message || "Unknown error",
    });
  }
}
