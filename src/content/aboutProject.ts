export interface AboutCityNote {
  city: string;
  note: string;
}

export type AboutTab =
  | "overview"
  | "howto"
  | "data"
  | "features"
  | "cities"
  | "technical";

export const ABOUT_TABS: { id: AboutTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "howto", label: "How to Use" },
  { id: "data", label: "Data & Methodology" },
  { id: "features", label: "Features" },
  { id: "cities", label: "City Notes" },
  { id: "technical", label: "Technical Details" },
];

export const ABOUT_SECTIONS = {
  title: "Light Rail Analytics Map",

  overview: {
    intro: [
      "As a San Francisco railfan, I was frustrated by how slow Muni's light-rail often feels, but I couldn't find any granular data showing where and why trains bog down. So I built it myself. Once I had a working prototype, I realized the same approach could apply to other cities. I chose to focus on light rail specifically because, unlike heavy metro systems, it operates in environments where targeted improvements—signal priority, stop consolidation, lane separation—can make a real difference.",
      "Light-rail systems in North America often suffer from slow speeds due to mixed traffic, signal delays, frequent stops, and constrained infrastructure. By combining real-time data with static GTFS and infrastructure overlays, the platform makes it possible to identify systemic slow zones, compare cities, and evaluate infrastructure tradeoffs.",
    ],
    goal: 'The aim is to turn anecdotal complaints about "slow trains" into measurable, actionable insights.',
  },

  howto: {
    intro:
      "The map interface provides multiple ways to explore light rail performance:",
    controls: [
      "Select a city from the top menu to load its light rail network",
      "Use the speed filter sliders to focus on specific speed ranges",
      "Toggle individual lines on/off to compare performance",
      "Switch between 'By Line' and 'Separation' views to see infrastructure impacts",
      "Enable infrastructure overlays (crossings, signals, switches) to identify bottlenecks",
      "Click 'Reset All Filters' to return to default view",
    ],
    views: [
      "Raw Data: Shows individual vehicle positions and speeds",
      "Segment Avg: Displays averaged speeds across 200-meter segments",
      "Speed Limit: Compares actual speeds to posted limits (where available)",
    ],
    tips: [
      "Hover over route segments to see detailed speed information",
      "Use the map toggle (bottom-left) to switch between satellite and street views",
      "The distance scale shows both kilometers and miles",
      "Speed legend updates based on your selected unit (mph/km/h)",
    ],
  },

  data: {
    sources: [
      "Live train positions come from agency GTFS-realtime or equivalent APIs",
      "Speed is either reported directly by the agency or estimated from consecutive GPS position updates",
      "Route geometry, crossings, switches, and separation overlays come from curated static files and OpenStreetMap data",
      "Regional/metro overlays are built from GTFS static feeds, filtered to passenger rail services",
    ],
    segmentAverages: [
      "Route lines are divided into fixed 200-meter segments. Each vehicle position is assigned to the segment it falls within based on distance along the route.",
      "For cities with visible parallel tracks (separate inbound and outbound geometries), all vehicle positions are projected onto a single reference geometry. This combines speed readings from both directions into unified segment averages. Currently this applies to Los Angeles and Denver.",
      "Combining bidirectional data produces more statistically robust averages—instead of splitting 10 readings between two parallel segments, all 10 contribute to one average.",
      "For cities with single-track display or where parallel track data is unavailable, segments are calculated independently without bidirectional merging. The visual result is the same, but each segment only reflects vehicles that passed through that specific geometry.",
      "The result is a speed profile that answers 'how fast are trains on this section of the route' rather than 'how fast are inbound vs outbound trains separately.'",
    ],
    limitations: [
      "GPS accuracy varies by agency and can be affected by tunnels, urban canyons, and signal quality",
      "Update frequency differs between cities (typically 10-30 seconds)",
      "Historical data depth varies by city and when collection began",
      "Some cities may have gaps in coverage during service disruptions",
    ],
  },

  features: {
    platformFeatures: [
      "Ingests live GTFS-RT vehicle positions",
      "Matches vehicles to route geometry",
      "Computes segment-level speeds",
      "Stores historical performance data",
      "Visualizes speed distributions and bottlenecks on interactive maps",
    ],
    visualizations: [
      "Speed heatmaps showing performance across entire networks",
      "Grade separation overlays (tunnel, elevated, at-grade, mixed traffic)",
      "Infrastructure markers (grade crossings, traffic signals, track switches)",
      "Regional/commuter rail context for understanding network connections",
      "Comparative statistics across lines and cities",
    ],
    interpretationNotes: [
      "Grade crossings (X) are where rail and roads intersect at street level; control type (gates/signals/signs) can affect speed",
      "Track switches (Y) are movable rails at junctions/turnbacks and often correlate with operational slow zones",
      "In Speed Limit view, gray route segments indicate unknown or missing speed-limit tagging",
    ],
  },

  technical: {
    scope: [
      "Scope is live light-rail/tram analytics first. Regional/metro layers are context only.",
      "Regional & metro overlays are static passenger-rail references, not speed analytics.",
      "Freight-only infrastructure is excluded.",
      "Intercity services (for example, long-distance Amtrak) are excluded by default to reduce clutter.",
    ],
    exclusions: [
      "Heavy rail-only systems: New York City, Chicago, Washington DC, Honolulu, Vancouver, Montreal",
      "Streetcar / Heritage-only systems: New Orleans, SF Cable Cars, Detroit, Kansas City, Cincinnati, Norfolk",
      "No public live data available: Dallas (DART), Houston (METRORail), Sacramento (SacRT), St. Louis (MetroLink), New Jersey (HBLR, River Line, Newark), Mexico City, Guadalajara, Monterrey, Calgary (C-Train), Edmonton",
    ],
    stack: [
      "Frontend: React + TypeScript + MapLibre GL JS",
      "Data Processing: Node.js + GTFS parsing libraries",
      "Storage: Supabase (PostgreSQL)",
      "Mapping: OpenStreetMap data + custom overlays",
    ],
  },
};

export const ABOUT_CITY_NOTES: AboutCityNote[] = [
  {
    city: "San Francisco",
    note: "N Judah tunnel speeds may appear clustered at portals due to limited GPS in the Sunset Tunnel. The F-Market & Wharves line is hidden by default to avoid confusing its slower street-running speeds with the faster underground Muni Metro lines.",
  },
  {
    city: "Los Angeles",
    note: "Regional context includes Metrolink. Complex areas (for example, around major terminals) can look choppy because GTFS shape granularity varies by operator.",
  },
  {
    city: "Seattle",
    note: "Link has both tunneled and surface-running segments, so speed patterns can shift quickly at transition points and around major interline sections.",
  },
  {
    city: "Portland",
    note: "MAX uses downtown transit-mall segments, so grade-crossing patterns differ from conventional at-grade crossings and may appear sparse in the core.",
  },
  {
    city: "Boston",
    note: "Green Line branch merges and street-running sections create strong speed variation by branch and by central subway approach segments.",
  },
  {
    city: "Philadelphia",
    note: "Regional/metro context includes SEPTA Regional Rail, SEPTA subway lines, PATCO, and NJ Transit Atlantic City Line. Street-running trolley segments often lack OSM grade-crossing tags, so mixed-traffic behavior is interpreted primarily from speed patterns.",
  },
  {
    city: "San Jose",
    note: "Regional context includes Bay Area commuter and metro lines (for example, BART/Caltrain/Capitol Corridor) that are visible when zoomed out across the broader metro footprint.",
  },
  {
    city: "Toronto",
    note: "Heavy context includes TTC subway and commuter context includes GO rail. Streetcar corridors run in mixed traffic and typically are not tagged as classic railway grade crossings in OSM.",
  },
  {
    city: "Minneapolis–St. Paul",
    note: "Airport tunnel and grade-separation sections can have distinct speed behavior compared with downtown street-running areas.",
  },
  {
    city: "Denver",
    note: "RTD has multiple long corridors with different operating profiles, so network-wide averages can hide major segment-level differences between suburban and urban sections.",
  },
  {
    city: "Salt Lake City",
    note: "TRAX lines share downtown trackage, so compare individual line speeds separately from the shared core for clearer interpretation.",
  },
  {
    city: "Pittsburgh",
    note: "The T transitions between downtown subway and South Hills surface running, creating clear grade-separation and speed regime differences in one corridor.",
  },
  {
    city: "Phoenix",
    note: "Valley Metro is largely surface-running, so intersection effects and corridor traffic conditions are often visible in the lower-speed distribution.",
  },
  {
    city: "Charlotte",
    note: "LYNX includes distinct Blue and Gold service patterns; compare overlap areas separately from end segments for clearer speed interpretation.",
  },
  {
    city: "Baltimore",
    note: "Light RailLink shows gaps in coverage along certain stretches (especially when the trains are not near stations) possibly due to limited GPS reporting frequency or infrastructure constraints. Regional context includes Metro SubwayLink and MARC commuter rail.",
  },
  {
    city: "Cleveland",
    note: "RTA corridor behavior can vary between shared trunk sections and outer branches, so line-level filtering is useful before comparing averages.",
  },
  {
    city: "San Diego",
    note: "Regional context includes NCTD Coaster commuter rail. The Trolley system covers four lines with varying service patterns across the metro area.",
  },
];
