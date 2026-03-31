const MAPTILER_TOPO_STYLE_ID = "019d452b-cbcd-7652-aaf8-34e89d173128";
const MAPTILER_TOPO_STYLE_URL = `https://api.maptiler.com/maps/${MAPTILER_TOPO_STYLE_ID}/style.json`;

function appendKey(url: string, apiKey: string): string {
  if (url.includes("key=")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}key=${apiKey}`;
}

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

  try {
    const response = await fetch(`${MAPTILER_TOPO_STYLE_URL}?key=${apiKey}`);

    if (!response.ok) {
      const details = await response.text();
      res.status(response.status).json({
        error: "Failed to fetch MapTiler topo style",
        details,
      });
      return;
    }

    const style = await response.json();

    if (typeof style.sprite === "string") {
      style.sprite = appendKey(style.sprite, apiKey);
    }

    if (typeof style.glyphs === "string") {
      style.glyphs = appendKey(style.glyphs, apiKey);
    }

    if (style.sources && typeof style.sources === "object") {
      for (const source of Object.values<any>(style.sources)) {
        if (typeof source?.url === "string") {
          source.url = appendKey(source.url, apiKey);
        }
        if (Array.isArray(source?.tiles)) {
          source.tiles = source.tiles.map((tileUrl: string) =>
            appendKey(tileUrl, apiKey),
          );
        }
      }
    }

    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).json(style);
  } catch (error: any) {
    res.status(500).json({
      error: "Unexpected error fetching MapTiler topo style",
      details: error?.message || "Unknown error",
    });
  }
}
