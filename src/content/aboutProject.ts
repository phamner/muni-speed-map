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
  title: "Light Rail Speed Map",

  overview: {
    intro: [
      "As a Bay Area native and huge railfan, I've always loved riding San Francisco's Muni light rail. But I've also been frustrated by how slow it often feels, and I couldn't find any granular data showing where and why trains bog down. So I built this using SFMTA's live vehicle feed as the source, then aggregating repeated observations into a speed map. Once I had a working prototype, I realized the same approach could apply to other cities.",
      "I chose to focus on light rail specifically because it operates in environments where targeted improvements like signal priority, stop consolidation, and lane separation can make a real difference. Light rail in North America often suffers from operating in mixed traffic, signal delays, frequent stops, and constrained infrastructure. By combining fleet-wide observation snapshots with static GTFS and infrastructure overlays, this platform makes it possible to identify systemic slow zones, compare cities, and evaluate infrastructure tradeoffs.",
    ],
    goal: 'The aim is to turn anecdotal complaints about "slow trains" into measurable, actionable insights.',
    snapshotSummaryTitle: "What You're Looking At",
    snapshotSummary:
      "An aggregated snapshot of train speed and location observations collected from repeated weekday sampling sessions in February 2026. This is not live train tracking.",
    dataCollectionTitle: "How the Speed Maps Were Built",
    dataCollection:
      "To capture the train speed data, I queried each transit agency's live vehicle endpoint every 90 seconds over several hours across multiple weekdays in February 2026. Each query returned the latest reported location and speed for the agency's entire active light rail fleet, not just a single train. I collected those system-wide snapshots and aggregated them into a city-level speed map showing where trains tend to move quickly or slow down.",
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
      "Raw Data: Shows individual vehicle position and speed observations from the sampled dataset. Use this to inspect the underlying fleet-wide snapshots that feed the map.",
      "Segment Avg: Displays averaged speeds across 200-meter segments based on the aggregated vehicle observations. Use this to identify persistent slow zones and compare performance across different sections of track.",
      "Speed Limit: Compares actual speeds to posted limits (where available). Gray segments indicate missing speed limit data.",
    ],
    tips: [
      "Hover over route segments to see detailed speed information",
      "Use the layer toggles (bottom-left) to switch between satellite and street views, or enable the population density overlay",
      "The distance scale shows both kilometers and miles",
      "Speed legend updates based on your selected unit (mph/km/h)",
    ],
    infrastructureMarkers: [
      "Grade crossings (X) mark where rail and roads intersect at street level. The type of control (gates, signals, or signs) can affect train speeds.",
      "Track switches (Y) are movable rails at junctions and turnbacks. These often correlate with operational slow zones.",
      "Traffic signals show where trains must interact with street traffic signals.",
    ],
  },

  data: {
    sources: [
      "Vehicle positions come from agency GTFS-Realtime feeds or agency-specific APIs, sampled repeatedly and aggregated into snapshot-based datasets",
      "Speed is either reported directly by the agency or calculated from consecutive GPS position updates",
      "Route geometry, crossings, switches, and separation overlays come from curated static files and OpenStreetMap data",
      "Regional/metro overlays are built from GTFS static feeds, filtered to passenger rail services",
    ],
    populationDensity: [
      "Population density data for US cities comes from the 2020 US Census Bureau, accessed via the TIGERweb REST API. Toronto uses 2021 Canadian Census data from Statistics Canada.",
      "Geographic units are Census tracts, which are small statistical subdivisions that typically contain 1,200 to 8,000 people (averaging around 4,000). Both the US and Canadian census systems use similarly sized tracts, so granularity is consistent across all cities.",
      "Density is calculated as total population divided by land area, converted to people per square kilometer.",
      "Coverage includes all cities in the platform, with county-level or CMA-level coverage listed in each city's sidebar.",
      "The density overlay helps contextualize transit performance. Areas with higher population density often correlate with higher ridership demand and different operating conditions.",
    ],
    segmentAverages: [
      "Route lines are divided into fixed 200-meter segments. Each vehicle position is assigned to the segment it falls within based on distance along the route.",
      "For some cities (currently Los Angeles and Denver), the platform combines speed readings from both directions of travel into unified segment averages. Instead of splitting readings between parallel tracks, all readings contribute to one average per segment, which produces more statistically robust data.",
      "The result is a speed profile that answers 'how fast do trains move through this section' rather than tracking inbound vs outbound separately.",
    ],
    lineStatistics: [
      "The 'Speed by Line' statistics exclude vehicles traveling below 0.5 mph to focus on operational speeds.",
      "This filtering removes trains stopped in yards and maintenance facilities, which would artificially lower averages without reflecting actual in-service performance.",
      "While this approach may exclude some trains stopped at stations during passenger loading, it provides a more accurate picture of how fast trains move when actually in motion on the network.",
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
      "Collects repeated fleet-wide vehicle observations from transit agency feeds and APIs",
      "Matches vehicles to route geometry",
      "Computes segment-level speeds",
      "Aggregates observations into city-level speed snapshots",
      "Visualizes speed distributions and bottlenecks on interactive maps",
    ],
    visualizations: [
      "Speed heatmaps showing performance across entire networks",
      "Grade separation overlays (tunnel, elevated, at-grade, mixed traffic)",
      "Infrastructure markers (grade crossings, traffic signals, track switches)",
      "Regional and commuter rail context for understanding network connections",
      "Comparative statistics across lines and cities",
    ],
  },

  technical: {
    scope: [
      "This project focuses on North American light rail and tram systems.",
      "Speed analytics are derived from repeated fleet-wide observations. Regional and metro overlays provide context but do not include speed analytics.",
      "Freight-only infrastructure is excluded.",
      "Intercity services (e.g., long-distance Amtrak) are excluded.",
    ],
    exclusions: [
      "Heavy rail systems (e.g., New York City, Chicago, Washington DC, Honolulu, Vancouver, Montreal)",
      "Heritage and streetcar-only systems (e.g., New Orleans, SF Cable Cars, Detroit, Kansas City, Cincinnati, Norfolk). If anyone has a good argument for including any of these, I'm open to it.",
      "Systems without public vehicle-position data that can support this snapshot-based methodology (e.g., Dallas DART, Houston METRORail, Sacramento SacRT, St. Louis MetroLink, New Jersey Hudson-Bergen Light Rail, New Jersey River Line, Calgary CTrain, Edmonton LRT, and several Mexican systems)",
      "I have actively tried to add several of these systems (including HBLR, River Line, Calgary, Edmonton, St. Louis, Dallas, and Houston) and will add them if I can find reliable data that supports the same fleet-wide snapshot methodology.",
    ],
    stack: [
      "Frontend: React + TypeScript + MapLibre GL JS",
      "Data Processing: Node.js + GTFS parsing libraries",
      "Storage: Supabase (PostgreSQL)",
      "Mapping: OpenStreetMap data + custom overlays",
    ],
    sourceCode: [
      "GitHub Repository: https://github.com/phamner/muni-speed-map",
    ],
  },

  prospective: {
    intro:
      "These are systems I would like to include because they would add meaningful comparisons for street-running and at-grade light rail. The main blocker for each is access to reliable public vehicle-position data that supports the same fleet-wide snapshot methodology used elsewhere in the project.",
    outro:
      "If I can find usable vehicle-position data for any of these systems, I would love to add them.",
  },
};

export const ABOUT_CITY_NOTES: AboutCityNote[] = [
  {
    city: "Baltimore",
    note: "Light RailLink has noticeable gaps in coverage between stations. You'll see stretches with no data points, which I think is due to infrequent GPS reporting from the vehicles rather than missing service. The system runs mostly in its own right-of-way, so speeds are generally consistent outside of the downtown core.",
  },
  {
    city: "Boston",
    note: "The Green Line branches show how much grade crossings matter. The D Line runs mostly in reserved right-of-way with far fewer grade crossings than the B, C, or E branches, and it shows up as noticeably faster on the map. The B and E lines, with more street-running and intersections, slow down more. The data becomes pretty patchy downtown, possibly because the routes are underground.",
  },
  {
    city: "Charlotte",
    note: "The Blue Line runs mostly in dedicated right-of-way with wide station spacing, while the Gold Line (CityLYNX) is a short and slow street car system running downtown. Comparing the two on the same map is a good illustration of how much infrastructure type affects speed.",
  },
  {
    city: "Cleveland",
    note: "The Blue and Green lines share surface trackage on the east side. I was surpised at how fast they both operated in the East, despite the fact that there are far more grade crossings than downtown.",
  },
  {
    city: "Denver",
    note: "RTD has a huge light rail network, and the speed variation across it is striking. Only light rail lines are included here; commuter rail (A, B, G, N) is excluded from displaying speed data. The suburban segments run fast, but the downtown core and shared-trackage sections slow down significantly. Line-level filtering is useful because the network-wide average hides a lot. I was a bit baffled by the layout of the network, which seems to have been built haphazardly on existing ROWs.",
  },
  {
    city: "Los Angeles",
    note: "LA Metro is one of the bigger and more interesting maps on the platform. The network covers a huge geographic area, and the distances between lines are striking compared to denser cities like Boston or Philly. The A Line (Blue) to Long Beach is surprisingly fast for a surface-running line. The C Line (Green) runs elevated in a freeway median and moves consistently fast with almost no slowdowns. The B and D lines are subway, but they performed slower than I expected. Perhaps a data quality issue? I'm hoping that the D line extension will allow me to capture some higher quality data as the route gets longer.",
  },
  {
    city: "Minneapolis-St. Paul",
    note: "The Blue and Green lines share downtown trackage, so the core looks like one line. The interesting comparison is the outer segments: the Blue Line picks up speed heading toward the airport, while the Green Line stays slower through the University Avenue corridor.",
  },
  {
    city: "Philadelphia",
    note: "Philly's trolley network is unique on this platform. It's the closest thing to a legacy streetcar system still operating as regular transit. Street-running segments don't show up with grade-crossing markers because OSM doesn't tag them as railway crossings, so the infrastructure overlay looks sparse (use traffic light overlay instead). Read the speed patterns instead. You can clearly see where trolleys are stuck in traffic versus where they have their own lane or subway segment. There is no speed data where the trains go underground, so it creates a clustering effect at the mouth of tunnels, with trains reporting 0-1 mph speeds.",
  },
  {
    city: "Phoenix",
    note: "Valley Metro is almost entirely at-grade and street-running, which makes it a good baseline for what mixed-traffic light rail looks like. You can see the effect of major intersections in the speed data. Compare this with a system like Denver or Charlotte to see how much grade separation matters.",
  },
  {
    city: "Pittsburgh",
    note: "The T has a dramatic speed split between the downtown subway (fast, consistent) and the South Hills surface sections (slower, more variable). The Red line is noticeably slower than the Silver/Blue after the split, with many more at-grade crossings. You'll also notice that GPS positions are slightly offset from the actual track alignment. I think the onboard equipment is older and the GPS accuracy reflects that. The speeds themselves look reasonable though.",
  },
  {
    city: "Portland",
    note: "MAX runs through the downtown transit mall where trains share lanes with buses, and you can see the speed impact clearly. The dataset for the transit mall doesnt include grade crossings, as these trains are considered streetcars.  I believe the Broadway Bridge was closed to MAX service when I collected data, so there's a visible gap in coverage there. The outer segments toward Hillsboro and Clackamas run much faster than the core.",
  },
  {
    city: "Salt Lake City",
    note: "TRAX lines share downtown trackage, so filter by line to compare them individually. The system includes both street-running and grade-separated segments with distinct performance characteristics. I was suprised at how quickly trains run in this system, getting up to nearly 50 mph for miles at a time.",
  },
  {
    city: "San Diego",
    note: "The Trolley has solid data coverage across all four lines. The system includes both street-running and grade-separated segments, and the speed differences between them are very visible.",
  },
  {
    city: "San Francisco",
    note: "This is my home system and the reason I built this project. Most lines converge in the Market Street subway, while surface running on the outer segments. Trains (especially the N and J) noticeably slow down as they are entering the tunnel, a inefficiency that should be improved with the CBTC system that is being installed. The F-Market & Wharves heritage streetcar line is hidden by default because its slow street-running speeds make the underground Muni Metro lines harder to read. Toggle it on if you want to see it, but it's a different kind of service.",
  },
  {
    city: "San Jose",
    note: "VTA light rail runs almost entirely at surface level with a lot of grade crossings, and it shows in the speed data. Compare the different corridor sections to see how much operating conditions vary even within a mostly-surface system.",
  },
  {
    city: "Seattle",
    note: "Link has sharp speed transitions where it moves between tunnel, elevated, and surface-running segments. The Rainier Valley surface section is (famously) slower than the rest of the 1 line. This is one of the clearest examples on the platform of how grade separation directly affects operating speed within a single line.",
  },
  {
    city: "Toronto",
    note: "Toronto's streetcar network runs almost entirely in mixed traffic, so grade-crossing markers look sparse. OSM doesn't tag street-running rail as grade crossings the way it does for dedicated right-of-way. The speed data tells the story instead: you can see intersection-by-intersection slowdowns throughout the corridors.",
  },
];

export const ABOUT_PROSPECTIVE_CITIES: AboutProspectiveCity[] = [
  {
    city: "New Jersey (NYC metro)",
    system: "Hudson-Bergen Light Rail (HBLR)",
    value:
      "HBLR, operated by NJ Transit, runs through the dense urban waterfront cities of Jersey City, Hoboken, and Bayonne in the New York metropolitan area. The line has multiple branches, closely spaced stations, and a mix of street-running, dedicated right-of-way, and former freight alignments along the Hudson waterfront. I really like how urban this system feels compared with most North American light rail, and it would be a great addition as the project’s only rail line from the NYC metro area.",
    blocker: "No public live vehicle-position data.",
  },
  {
    city: "New Jersey / Philadelphia region",
    system: "River Line",
    value:
      "River Line, operated by NJ Transit, runs along the Delaware River between Camden and Trenton. The line has a more interurban-style alignment, with long stretches of dedicated right-of-way and relatively wide station spacing. Adding the River Line to the Philadelphia map would extend the regional context across the river and bring in an important rail corridor on the New Jersey side of the metro area.",
    blocker: "No public live vehicle-position data.",
  },
  {
    city: "Calgary",
    system: "CTrain",
    value:
      "Calgary Transit operates the CTrain, one of the busiest light-rail systems in North America, carrying very high ridership for a metro area its size. The network combines a downtown transit mall with street-running segments and long outer corridors that operate largely in dedicated at-grade right-of-way, producing a wide range of operating conditions across the system. This mix of dense urban running and fast suburban segments makes Calgary a valuable comparison city for analyzing how speeds vary across different types of light-rail infrastructure. I wanted more Canadian cities in the project, and I was impressed with the network the city has built.",
    blocker: "No public live light rail vehicle-position data (bus data only).",
  },
  {
    city: "Edmonton",
    system: "Edmonton LRT",
    value:
      "Edmonton Transit Service operates the Edmonton LRT, which has evolved from an early grade-separated light-metro style system into a multi-line network that now includes tunneled downtown segments, elevated sections, and newer surface-running corridors. With the addition of the Valley Line, the network now spans a wide range of infrastructure types within a single system. This mix provides a useful look at how a historically grade-separated light rail system has expanded over time, adding newer surface-running lines while retaining its original tunneled core.",
    blocker: "No public live light rail vehicle-position data (bus data only).",
  },
  {
    city: "St. Louis",
    system: "MetroLink",
    value:
      "MetroLink, operated by Bi-State Development Agency, runs through St. Louis and nearby suburbs largely in exclusive right-of-way with relatively wide station spacing. Although technically light rail, the system behaves more like light metro or regional rail, with long uninterrupted segments and very little street running. That makes it an interesting addition, showing how much faster a North American light-rail system can operate when it’s built mostly separated from traffic.",
    blocker: "No public live vehicle-position data.",
  },
  {
    city: "Dallas",
    system: "DART Light Rail",
    value:
      "Dallas Area Rapid Transit (DART) operates the largest light-rail network in the United States, with 90+ miles of track spread across four lines. Much of the system runs in dedicated right-of-way along freight corridors or highway medians, with relatively little mixed-traffic street running. This makes it a useful contrast to more urban systems like SF Muni or LA Metro, which include more tunnels and street segments. Adding DART would allow comparisons across a large, mostly at-grade suburban light-rail network, highlighting how operating speeds vary between downtown trunk segments and long outer corridors.",
    blocker: "No public live vehicle-position data.",
  },
  {
    city: "Houston",
    system: "METRORail",
    value:
      "Houston METRORail's at-grade corridors, downtown street-running, and signal interactions are exactly the kinds of operating conditions this map is built to analyze.",
    blocker: "No public live vehicle-position data.",
  },
  {
    city: "Sacramento",
    system: "SacRT Light Rail",
    value:
      "Sacramento Regional Transit District operates the SacRT Light Rail, a large mostly at-grade network serving Sacramento and the surrounding suburbs. The system includes downtown street-running segments along K Street as well as long suburban corridors with widely spaced stations. Its combination of urban street-running and extended surface alignments would make it useful for examining how speeds change between dense downtown segments and longer suburban sections within the same system.",
    blocker: "No public live light rail vehicle-position data (bus data only).",
  },
  {
    city: "Guadalajara",
    system: "SITEUR light rail",
    value:
      "Sistema de Tren Eléctrico Urbano operates the SITEUR light rail, a network that combines older surface-running light rail with newer fully grade-separated lines such as SITEUR Line 3. This creates an interesting mix of street-running corridors and modern metro-style infrastructure within the same system.",
    blocker: "No public live light rail vehicle-position data.",
  },
  {
    city: "Mexico City",
    system: "Tren Ligero",
    value:
      "The Tren Ligero, operated by Servicio de Transportes Eléctricos, is one of the busiest light-rail corridors in Latin America. Running through dense southern districts of Mexico City, it functions as a major feeder to the metro network and carries heavy ridership along a largely surface-running alignment.",
    blocker: "No public live light rail vehicle-position data.",
  },
  {
    city: "Monterrey",
    system: "Metrorrey",
    value:
      "Sistema de Transporte Colectivo Metrorrey operates the Metrorrey, a predominantly elevated urban rail system running above major arterial roads in Monterrey. Its long elevated segments and widely spaced stations create operating conditions that differ significantly from typical street-running light-rail networks.",
    blocker: "No public live rail vehicle-position data.",
  },
];
