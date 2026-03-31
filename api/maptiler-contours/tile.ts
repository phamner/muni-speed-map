const MAPTILER_CONTOURS_TILE_BASE_URL = "https://api.maptiler.com/tiles/contours";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.MAPTILER_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "MapTiler API key is not configured" });
    return;
  }

  const { z, x, y } = req.query;
  if (!z || !x || !y) {
    res.status(400).json({
      error: "Missing required query params: z, x, y",
    });
    return;
  }

  const tileUrl = `${MAPTILER_CONTOURS_TILE_BASE_URL}/${z}/${x}/${y}?key=${apiKey}`;

  try {
    const response = await fetch(tileUrl);

    if (response.status === 204) {
      res.status(204).end();
      return;
    }

    if (!response.ok) {
      const details = await response.text();
      res.status(response.status).json({
        error: "Failed to fetch MapTiler contour tile",
        details,
      });
      return;
    }

    const contentType =
      response.headers.get("content-type") || "application/x-protobuf";
    const cacheControl =
      response.headers.get("cache-control") || "public, max-age=3600";
    const arrayBuffer = await response.arrayBuffer();

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", cacheControl);
    res.status(200).send(Buffer.from(arrayBuffer));
  } catch (error: any) {
    res.status(500).json({
      error: "Unexpected error fetching MapTiler contour tile",
      details: error?.message || "Unknown error",
    });
  }
}
