const GOOGLE_TILE_SESSION_URL = "https://tile.googleapis.com/v1/createSession";

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

  try {
    const mapType = req.query?.mapType === "terrain" ? "terrain" : "satellite";
    const sessionBody =
      mapType === "terrain"
        ? {
            mapType,
            language: "en-US",
            region: "US",
            layerTypes: ["layerRoadmap"],
          }
        : {
            mapType,
            language: "en-US",
            region: "US",
            imageFormat: "jpeg",
            scale: "scaleFactor1x",
            highDpi: true,
          };
    const response = await fetch(`${GOOGLE_TILE_SESSION_URL}?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sessionBody),
    });

    const text = await response.text();

    if (!response.ok) {
      res.status(response.status).json({
        error: "Failed to create Google tile session",
        details: text,
      });
      return;
    }

    const data = JSON.parse(text);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.status(200).json({
      session: data.session,
      mapType,
      expiry: data.expiry,
      tileWidth: data.tileWidth,
      tileHeight: data.tileHeight,
      imageFormat: data.imageFormat,
    });
  } catch (error: any) {
    res.status(500).json({
      error: "Unexpected error creating Google tile session",
      details: error?.message || "Unknown error",
    });
  }
}
