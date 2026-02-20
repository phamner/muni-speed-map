export interface AboutCityNote {
  city: string;
  note: string;
}

export const ABOUT_SECTIONS = {
  title: "Light Rail Analytics Map: about this project",
  whatItIs:
    "WHAT PROBLEM IS THIS TRYING TO SOLVE?  I TRIED TO FIND DATA ON SLOW SEGMENTS OF SF MUNI BUT FAILED, AND WANTED TO CREATE THAT RESOURCE.  This app visualizes light-rail and tram performance in North American cities using live vehicle positions and static infrastructure data. The goal is to make speed patterns, bottlenecks, and route characteristics easy to inspect.",
  keyDecisions: [
    "Scope is live light-rail/tram analytics first. Regional/metro layers are context only.",
    "Regional & metro overlays are static passenger-rail references, not speed analytics.",
    "Freight-only infrastructure is excluded.",
    "Intercity services (for example, long-distance Amtrak) are excluded by default to reduce clutter.",
  ],
  inclusionCriteria: [
    "City is in North America.",
    "City has an in-scope light-rail/tram network.",
    "City has a usable live feed for light-rail operations (or clear path to one).",
  ],
  exclusions: [
    "Heavy rail-only systems: New York City, Chicago, Washington DC, Honolulu, Vancouver, Montreal",
    "Streetcar / Heritage-only systems: New Orleans, SF Cable Cars, Detroit, Kansas City, Cincinnati, Norfolk",
    "Live light-rail data either does not exist or are not available to the public: Dallas (DART), Houston (METRORail), Sacramento (SacRT), St. Louis (MetroLink), New Jersey (HBLR, River Line, Newark), Mexico City, Guadalajara, Monterrey, Calgary (C-Train), Edmonton",
  ],
  dataMethodology: [
    "Live train positions come from agency GTFS-realtime or equivalent APIs.",
    "Where agencies do not publish speed directly, speed is estimated from consecutive position updates.",
    "Speed source can vary by city: some cities provide direct speed in API responses, others require GPS-derived estimation.",
    "Data freshness reflects what is currently in the database, including stale periods when live feeds are interrupted.",
    "Route geometry, crossings, switches, and separation overlays use curated static files and OSM-derived data.",
    "Regional/metro overlays are built from GTFS static feeds and filtered to passenger services.",
  ],
  segmentAverages: [
    "Route lines are divided into fixed 200-meter segments. Each vehicle position is assigned to the segment it falls within based on distance along the route.",
    "For cities with visible parallel tracks (separate inbound and outbound geometries), all vehicle positions are projected onto a single reference geometry. This combines speed readings from both directions into unified segment averages. Currently this applies to Los Angeles and Denver.",
    "Combining bidirectional data produces more statistically robust averages—instead of splitting 10 readings between two parallel segments, all 10 contribute to one average.",
    "For cities with single-track display or where parallel track data is unavailable, segments are calculated independently without bidirectional merging. The visual result is the same, but each segment only reflects vehicles that passed through that specific geometry.",
    "The result is a speed profile that answers 'how fast are trains on this section of the route' rather than 'how fast are inbound vs outbound trains separately.'",
  ],
  interpretationNotes: [
    "Grade crossings (X) are where rail and roads intersect at street level; control type (gates/signals/signs) can affect speed.",
    "Track switches (Y) are movable rails at junctions/turnbacks and often correlate with operational slow zones.",
    "In Speed Limit view, gray route segments indicate unknown or missing speed-limit tagging.",
  ],
};

export const ABOUT_CITY_NOTES: AboutCityNote[] = [
  {
    city: "San Francisco",
    note: "N Judah in Sunset Tunnel can show portal clustering because location data is not available there; apparent tunnel speeds represent through-tunnel travel, not dense in-tunnel GPS sampling. F-Wharf and Market crossings are intentionally hidden to avoid confusion with the Market Street subway below. The F-Wharf is turned off by default to avoid confusing its slower street-running speeds with the faster underground sections of the system below Market Street.",
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
    note: "Separation data is curated to avoid unrelated airport people-mover infrastructure. Airport tunnel and grade-separation sections can have distinct speed behavior compared with downtown street-running areas.",
  },
  {
    city: "Denver",
    note: "RTD has multiple long corridors with different operating profiles, so network-wide averages can hide major segment-level differences between suburban and urban sections.",
  },
  {
    city: "Salt Lake City",
    note: "Regional/metro context uses static fallback safeguards to avoid empty overlays caused by loader timing issues.",
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
    note: "Light RailLink analytics are paired with Metro SubwayLink and MARC Penn/Camden context layers from MTA Maryland feeds.",
  },
  {
    city: "Cleveland",
    note: "RTA corridor behavior can vary between shared trunk sections and outer branches, so line-level filtering is useful before comparing averages.",
  },
  {
    city: "San Diego",
    note: "Regional context includes Coaster from NCTD static GTFS. Live trolley coverage can vary when API credentials/feed availability are limited.",
  },
];
