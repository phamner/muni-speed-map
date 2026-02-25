export interface AboutCityNote {
  city: string;
  note: string;
}

export interface AboutProspectiveCity {
  city: string;
  system: string;
  value: string;
  blocker: string;
}

export type AboutTab =
  | "overview"
  | "howto"
  | "data"
  | "cities"
  | "prospective"
  | "technical";

export const ABOUT_TABS: { id: AboutTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "howto", label: "How to Use" },
  { id: "data", label: "Data & Methodology" },
  { id: "cities", label: "City Notes" },
  { id: "prospective", label: "Prospective Cities" },
  { id: "technical", label: "Technical Details" },
];

export const ABOUT_SECTIONS = {
  title: "Light Rail Analytics Map",

  overview: {
    intro: [
      "As a Bay Area native and huge railfan, I've always loved riding San Francisco's Muni light rail. But I've also been frustrated by how slow it often feels, and I couldn't find any granular data showing where and why trains bog down. So I built this using SFMTA's live vehicle feed as the source, then aggregating repeated observations into a speed map. Once I had a working prototype, I realized the same approach could apply to other cities.",
      "I chose to focus on light rail specifically because, unlike heavy metro systems or commuter/regional rail, it operates in environments where targeted improvements (signal priority, stop consolidation, lane separation) can make a real difference. Light rail in North America often suffers from operating in mixed traffic, signal delays, frequent stops, and constrained infrastructure. By combining fleet-wide observation snapshots with static GTFS and infrastructure overlays, this platform makes it possible to identify systemic slow zones, compare cities, and evaluate infrastructure tradeoffs.",
    ],
    goal: 'The aim is to turn anecdotal complaints about "slow trains" into measurable, actionable insights.',
    dataCollectionTitle: "How the Speed Maps were Built",
    dataCollection:
      "To capture the train speed data, I queried each transit agency's live vehicle endpoint every 90 seconds over several hours across multiple weekdays in February 2026. Each query returned the latest reported location and speed for the agency's entire active light rail fleet, not just a single train. I collected those system-wide snapshots and aggregated them into a city-level speed map showing where trains tend to move quickly or slow down. The result is an aggregated snapshot of fleet behavior, not live train tracking.",
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
      "Raw Data: Shows individual vehicle position/speed observations from the sampled dataset. Use this to inspect the underlying fleet-wide snapshots and individual observations that feed the map.",
      "Segment Avg: Displays averaged speeds across 200-meter segments based on the aggregated vehicle observations. Use this to identify persistent slow zones and compare performance across different sections of track.",
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
      "Source vehicle positions come from agency GTFS-Realtime feeds or agency-specific APIs, sampled repeatedly and aggregated into snapshot-based datasets",
      "Speed is either reported directly by the agency or calculated from consecutive GPS position updates",
      "Route geometry, crossings, switches, and separation overlays come from curated static files and OpenStreetMap data",
      "Regional/metro overlays are built from GTFS static feeds, filtered to passenger rail services",
    ],
    segmentAverages: [
      "Route lines are divided into fixed 200-meter segments. Each vehicle position is assigned to the segment it falls within based on distance along the route.",
      "For some cities (currently Los Angeles and Denver), the platform combines speed readings from both directions of travel into unified segment averages. This produces more statistically robust data—instead of splitting readings between parallel tracks, all readings contribute to one average per segment.",
      "The result is a speed profile that answers 'how fast do trains move through this section' rather than tracking inbound vs outbound separately.",
    ],
    lineStatistics: [
      "The 'Speed by Line' statistics exclude vehicles traveling below 0.5 mph to focus on operational speeds.",
      "This filtering removes trains stopped in yards and maintenance facilities, which would artificially lower averages without providing meaningful insight into in-service performance.",
      "While this approach may exclude some trains legitimately stopped at stations during passenger loading, it provides a more accurate picture of how fast trains move when actually in motion on the network.",
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
      "Collects repeated fleet-wide vehicle observations from transit agency feeds/APIs",
      "Matches vehicles to route geometry",
      "Computes segment-level speeds",
      "Aggregates observations into city-level speed snapshots",
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
      "This platform focuses on aggregated light rail and tram speed analytics derived from repeated fleet-wide observations. Regional and metro overlays provide context but do not include speed analytics.",
      "Freight-only infrastructure is excluded.",
      "Intercity services (e.g., long-distance Amtrak) are excluded by default to reduce clutter.",
    ],
    exclusions: [
      "Heavy rail systems (e.g., New York City, Chicago, Washington DC, Honolulu, Vancouver, Montreal)",
      "Heritage and streetcar-only systems (e.g., New Orleans, SF Cable Cars, Detroit, Kansas City, Cincinnati, Norfolk)",
      "Systems without public vehicle-position data feeds/APIs that can support this snapshot-based methodology (e.g., Dallas DART, Houston METRORail, Sacramento SacRT, St. Louis MetroLink, New Jersey Hudson-Bergen Light Rail, New Jersey River Line, Calgary CTrain, Edmonton LRT, and several Mexican systems)",
      "I have actively tried to add several of these systems (including HBLR, River Line, Calgary, Edmonton, St. Louis, Dallas, and Houston) and will add them to the project if I can find reliable data that supports the same fleet-wide snapshot methodology.",
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

  prospective: {
    intro:
      "These are systems I would like to include because they would add meaningful comparisons for street-running and at-grade light rail. The main blocker is access to reliable public vehicle-position data that can support the same fleet-wide snapshot methodology used elsewhere in the project.",
    outro:
      "If I can find usable vehicle-position data for any of these systems, I would love to add them.",
  },
};

export const ABOUT_CITY_NOTES: AboutCityNote[] = [
  {
    city: "Baltimore",
    note: "Light RailLink shows gaps in coverage along certain stretches, especially between stations, possibly due to limited GPS reporting frequency or infrastructure constraints. Regional context includes Metro SubwayLink and MARC commuter rail. Speed is calculated from GPS positions, measuring distance traveled between consecutive readings (~90 seconds apart).",
  },
  {
    city: "Boston",
    note: "Green Line branch merges and street-running sections create strong speed variation by branch and by central subway approach. Each branch has distinct operating characteristics worth comparing separately. Speed is provided directly by the transit agency's API for each vehicle observation in the sampled snapshots.",
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
    note: "RTD operates multiple long corridors with different operating profiles. Network-wide averages can hide major segment-level differences between suburban and urban sections, so line-level filtering is useful for interpretation. Speed is provided directly by the transit agency's API for each vehicle observation in the sampled snapshots.",
  },
  {
    city: "Los Angeles",
    note: "Complex areas around major terminals can look choppy because GTFS shape granularity varies by operator. Regional context includes Metrolink commuter rail. Speed is provided directly by the transit agency's API for each vehicle observation in the sampled snapshots.",
  },
  {
    city: "Minneapolis–St. Paul",
    note: "Airport tunnel and grade-separation sections show distinct speed behavior compared with downtown street-running areas. The Blue and Green lines share downtown trackage, so compare individual line performance separately from the shared core. Speed is provided directly by the transit agency's API for each vehicle observation in the sampled snapshots.",
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
    note: "The T transitions between downtown subway and South Hills surface running, creating clear grade-separation and speed regime differences in one corridor. This makes Pittsburgh useful for comparing tunnel vs surface performance. GPS positions derived from the source data appear somewhat offset from the track alignment. I am unsure why, perhaps because of old technology used by the city. Speed is provided directly by the transit agency's API for each vehicle observation in the sampled snapshots.",
  },
  {
    city: "Portland",
    note: "MAX uses downtown transit-mall segments where trains share lanes with buses. Grade-crossing patterns may appear sparse in the core because these differ from conventional at-grade crossings. Speed is provided directly by the transit agency's API for each vehicle observation in the sampled snapshots.",
  },
  {
    city: "Salt Lake City",
    note: "TRAX lines share downtown trackage, so compare individual line speeds separately from the shared core for clearer interpretation. The system includes both street-running and grade-separated segments with distinct performance characteristics. Speed is provided directly by the transit agency's API for each vehicle observation in the sampled snapshots.",
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
    note: "Streetcar corridors run in mixed traffic and typically are not tagged as classic railway grade crossings in OSM, so infrastructure markers may appear sparse. Context layers include TTC subway (heavy rail) and GO Transit (commuter rail). Speed is provided directly by the transit agency's API for each vehicle observation in the sampled snapshots.",
  },
];

export const ABOUT_PROSPECTIVE_CITIES: AboutProspectiveCity[] = [
  {
    city: "New Jersey (NYC metro)",
    system: "Hudson-Bergen Light Rail (HBLR)",
    value:
      "HBLR would be a strong comparison case because it combines dense urban service, multiple branches, and substantial at-grade running in places like Jersey City, Hoboken, and Bayonne.",
    blocker:
      "No public live vehicle-position data.",
  },
  {
    city: "New Jersey / Philadelphia region",
    system: "River Line",
    value:
      "The River Line is valuable because it extends the Philly-region context with a distinct interurban-style light rail corridor between Camden and Trenton.",
    blocker:
      "No public live vehicle-position data.",
  },
  {
    city: "Calgary",
    system: "CTrain",
    value:
      "Calgary is one of North America's busiest light rail systems and includes downtown street-running plus major at-grade segments, making it a high-value comparison city.",
    blocker:
      "No public live light rail vehicle-position data (bus data only).",
  },
  {
    city: "Edmonton",
    system: "Edmonton LRT",
    value:
      "Edmonton's expanding LRT network (Capital, Metro, and Valley lines) would add a useful mix of urban at-grade, elevated, and tunneled operations.",
    blocker:
      "No public live light rail vehicle-position data (bus data only).",
  },
  {
    city: "St. Louis",
    system: "MetroLink",
    value:
      "MetroLink would add another major Midwestern light rail system with at-grade segments and corridor-level speed comparisons that fit the project's focus.",
    blocker:
      "No public live vehicle-position data.",
  },
  {
    city: "Dallas",
    system: "DART Light Rail",
    value:
      "DART is one of the largest light rail networks in North America, so adding it would provide valuable multi-corridor comparisons across a large at-grade system.",
    blocker:
      "No public live vehicle-position data.",
  },
  {
    city: "Houston",
    system: "METRORail",
    value:
      "Houston METRORail is a strong candidate because its at-grade corridors, downtown street-running, and signal interactions are exactly the kinds of operating conditions this map is built to analyze.",
    blocker:
      "No public live vehicle-position data.",
  },
  {
    city: "Sacramento",
    system: "SacRT Light Rail",
    value:
      "Sacramento is valuable because it has downtown street-running and at-grade sections that fit the project's core use case and would add a useful California comparison.",
    blocker:
      "No public live light rail vehicle-position data (bus data only).",
  },
  {
    city: "Guadalajara",
    system: "SITEUR light rail",
    value:
      "Guadalajara would broaden the project beyond the US/Canada and add a valuable comparison with a major Mexican urban rail system and different operating conditions.",
    blocker:
      "No public live light rail vehicle-position data.",
  },
  {
    city: "Mexico City",
    system: "Tren Ligero",
    value:
      "Mexico City's Tren Ligero would add a strong comparison for busy urban light rail operations in a very different street and transit environment.",
    blocker:
      "No public live light rail vehicle-position data.",
  },
  {
    city: "Monterrey",
    system: "Metrorrey",
    value:
      "Monterrey would add another major Mexican metro-area rail comparison and help expand the project's regional coverage beyond the US and Canada.",
    blocker:
      "No public live rail vehicle-position data.",
  },
];
