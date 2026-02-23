export interface AboutCityNote {
  city: string;
  note: string;
}

export type AboutTab =
  | "overview"
  | "howto"
  | "features"
  | "data"
  | "cities"
  | "technical";

export const ABOUT_TABS: { id: AboutTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "howto", label: "How to Use" },
  { id: "features", label: "Features" },
  { id: "data", label: "Data & Methodology" },
  { id: "cities", label: "City Notes" },
  { id: "technical", label: "Technical Details" },
];

export const ABOUT_SECTIONS = {
  title: "Light Rail Analytics Map",

  overview: {
    intro: [
      "As a Bay Area native and huge railfan, I've always loved riding San Francisco's Muni light rail. But I've also been frustrated by how slow it often feels, and I couldn't find any granular data showing where and why trains bog down. So I built it myself, leveraging SFMTA's live location data to map train speeds in real time. Once I had a working prototype, I realized the same approach could apply to other cities.",
      "I chose to focus on light rail specifically because, unlike heavy metro systems or commuter/regional rail, it operates in environments where targeted improvements (signal priority, stop consolidation, lane separation) can make a real difference. Light rail in North America often suffers from operating in mixed traffic, signal delays, frequent stops, and constrained infrastructure. By combining real-time data with static GTFS and infrastructure overlays, this platform makes it possible to identify systemic slow zones, compare cities, and evaluate infrastructure tradeoffs.",
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
      "Raw Data: Shows individual vehicle positions and speeds in real time. Use this to see current train locations and instantaneous speeds.",
      "Segment Avg: Displays averaged speeds across 200-meter segments. Use this to identify persistent slow zones and compare performance across different sections of track.",
      "Speed Limit: Compares actual speeds to posted limits (where available). Gray segments indicate missing speed limit data.",
    ],
    tips: [
      "Hover over route segments to see detailed speed information",
      "Use the map toggle (bottom-left) to switch between satellite and street views",
      "The distance scale shows both kilometers and miles",
      "Speed legend updates based on your selected unit (mph/km/h)",
    ],
    infrastructureMarkers: [
      "Grade crossings (X) are where rail and roads intersect at street level. Control type (gates, signals, or signs) can affect train speeds.",
      "Track switches (Y) are movable rails at junctions and turnbacks. These often correlate with operational slow zones.",
      "Traffic signals show where trains must interact with street traffic signals.",
    ],
  },

  data: {
    sources: [
      "Live train positions come from agency GTFS-Realtime feeds or agency-specific APIs",
      "Speed is either reported directly by the agency or calculated from consecutive GPS position updates",
      "Route geometry, crossings, switches, and separation overlays come from curated static files and OpenStreetMap data",
      "Regional/metro overlays are built from GTFS static feeds, filtered to passenger rail services",
    ],
    segmentAverages: [
      "Route lines are divided into fixed 200-meter segments. Each vehicle position is assigned to the segment it falls within based on distance along the route.",
      "For some cities (currently Los Angeles and Denver), the platform combines speed readings from both directions of travel into unified segment averages. This produces more statistically robust data—instead of splitting readings between parallel tracks, all readings contribute to one average per segment.",
      "The result is a speed profile that answers 'how fast do trains move through this section' rather than tracking inbound vs outbound separately.",
    ],
    limitations: [
      "GPS accuracy varies by agency and can be affected by tunnels, urban canyons, and signal quality",
      "Update frequency differs between cities (typically 10-30 seconds)",
      "Speed calculations depend on GPS accuracy and update frequency, which varies by agency",
      "Historical data depth varies by city and when collection began",
      "Some cities may have gaps in coverage during service disruptions",
    ],
  },

  features: {
    platformFeatures: [
      "Collects real-time train location data from transit agencies",
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
  },

  technical: {
    scope: [
      "This platform focuses on live light rail and tram analytics. Regional and metro overlays provide context but do not include speed analytics.",
      "Freight-only infrastructure is excluded.",
      "Intercity services (e.g., long-distance Amtrak) are excluded by default to reduce clutter.",
    ],
    exclusions: [
      "Heavy rail systems (e.g., New York City, Chicago, Washington DC, Honolulu, Vancouver, Montreal)",
      "Heritage and streetcar-only systems (e.g., New Orleans, SF Cable Cars, Detroit, Kansas City, Cincinnati, Norfolk)",
      "Systems without public live data (e.g., Dallas DART, Houston METRORail, Sacramento SacRT, St. Louis MetroLink, New Jersey systems, Calgary C-Train, Edmonton LRT, and several Mexican systems)",
    ],
    stack: [
      "Frontend: React + TypeScript + MapLibre GL JS",
      "Data Processing: Node.js + GTFS parsing libraries",
      "Storage: Supabase (PostgreSQL)",
      "Mapping: OpenStreetMap data + custom overlays",
    ],
    sourceCode: [
      "GitHub Repository: https://github.com/philiphamner/muni-speed-map",
    ],
  },
};

export const ABOUT_CITY_NOTES: AboutCityNote[] = [
  {
    city: "Baltimore",
    note: "Light RailLink shows gaps in coverage along certain stretches, especially between stations, possibly due to limited GPS reporting frequency or infrastructure constraints. Regional context includes Metro SubwayLink and MARC commuter rail. Speed is calculated from GPS positions, measuring distance traveled between consecutive readings (~90 seconds apart).",
  },
  {
    city: "Boston",
    note: "Green Line branch merges and street-running sections create strong speed variation by branch and by central subway approach. Each branch has distinct operating characteristics worth comparing separately. Speed is provided directly by the transit agency's API, giving accurate real-time readings.",
  },
  {
    city: "Charlotte",
    note: "LYNX Blue and Gold lines have distinct service patterns. Compare overlap areas separately from end segments for clearer speed interpretation, as shared trackage can show different performance than single-line sections. Speed is calculated from GPS positions, measuring distance traveled between consecutive readings (~90 seconds apart).",
  },
  {
    city: "Cleveland",
    note: "RTA corridor behavior varies between shared trunk sections and outer branches. Line-level filtering is useful before comparing averages, as the Red Line operates differently from the Blue and Green lines. Speed is calculated from GPS positions, measuring distance traveled between consecutive readings (~90 seconds apart).",
  },
  {
    city: "Denver",
    note: "RTD operates multiple long corridors with different operating profiles. Network-wide averages can hide major segment-level differences between suburban and urban sections, so line-level filtering is useful for interpretation. Speed is provided directly by the transit agency's API, giving accurate real-time readings.",
  },
  {
    city: "Los Angeles",
    note: "Complex areas around major terminals can look choppy because GTFS shape granularity varies by operator. Regional context includes Metrolink commuter rail. Speed is provided directly by the transit agency's API, giving accurate real-time readings.",
  },
  {
    city: "Minneapolis–St. Paul",
    note: "Airport tunnel and grade-separation sections show distinct speed behavior compared with downtown street-running areas. The Blue and Green lines share downtown trackage, so compare individual line performance separately from the shared core. Speed is provided directly by the transit agency's API, giving accurate real-time readings.",
  },
  {
    city: "Philadelphia",
    note: "Street-running trolley segments often lack OSM grade-crossing tags, so mixed-traffic behavior is interpreted primarily from speed patterns. Regional context includes SEPTA Regional Rail, SEPTA subway lines, PATCO, and NJ Transit Atlantic City Line. Speed is calculated from GPS positions, measuring distance traveled between consecutive readings (~90 seconds apart).",
  },
  {
    city: "Phoenix",
    note: "Valley Metro is largely surface-running with extensive at-grade segments. Intersection effects and corridor traffic conditions are often visible in the speed distribution, making this a good example of mixed-traffic light rail performance. Speed is calculated from GPS positions, measuring distance traveled between consecutive readings (~90 seconds apart).",
  },
  {
    city: "Pittsburgh",
    note: "The T transitions between downtown subway and South Hills surface running, creating clear grade-separation and speed regime differences in one corridor. This makes Pittsburgh useful for comparing tunnel vs surface performance. GPS positions derived from the source data appear somewhat offset from the track alignment. I am unsure why, perhaps because of old technology used by the city. Speed is provided directly by the transit agency's API, giving accurate real-time readings.",
  },
  {
    city: "Portland",
    note: "MAX uses downtown transit-mall segments where trains share lanes with buses. Grade-crossing patterns may appear sparse in the core because these differ from conventional at-grade crossings. Speed is provided directly by the transit agency's API, giving accurate real-time readings.",
  },
  {
    city: "Salt Lake City",
    note: "TRAX lines share downtown trackage, so compare individual line speeds separately from the shared core for clearer interpretation. The system includes both street-running and grade-separated segments with distinct performance characteristics. Speed is provided directly by the transit agency's API, giving accurate real-time readings.",
  },
  {
    city: "San Diego",
    note: "The Trolley system covers four lines with varying service patterns across the metro area. Regional context includes NCTD Coaster commuter rail. The system includes both street-running and grade-separated segments. Speed is calculated from GPS positions, measuring distance traveled between consecutive readings (~90 seconds apart).",
  },
  {
    city: "San Francisco",
    note: "N Judah tunnel speeds may appear clustered at portals due to limited GPS signal in the Sunset Tunnel. The F-Market & Wharves line is hidden by default to avoid confusing its slower street-running speeds with the faster underground Muni Metro lines. Speed is calculated from GPS positions, measuring distance traveled between consecutive readings (~90 seconds apart).",
  },
  {
    city: "San Jose",
    note: "Regional context includes Bay Area commuter and metro lines (BART, Caltrain, Capitol Corridor) visible when zoomed out across the broader metro footprint. VTA light rail operates primarily in surface-running configurations with significant at-grade segments. Speed is calculated from GPS positions, measuring distance traveled between consecutive readings (~90 seconds apart).",
  },
  {
    city: "Seattle",
    note: "Link transitions between tunneled and surface-running segments, so speed patterns can shift quickly at transition points and around major interline sections. Speed is calculated from GPS positions, measuring distance traveled between consecutive readings (~90 seconds apart).",
  },
  {
    city: "Toronto",
    note: "Streetcar corridors run in mixed traffic and typically are not tagged as classic railway grade crossings in OSM, so infrastructure markers may appear sparse. Context layers include TTC subway (heavy rail) and GO Transit (commuter rail). Speed is provided directly by the transit agency's API, giving accurate real-time readings.",
  },
];
