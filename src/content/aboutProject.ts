export interface AboutCityNote {
  city: string;
  note: string;
}

export const ABOUT_SECTIONS = {
  title: "Light Rail Analytics Map: about this project",
  whatItIs: {
    intro: [
      "As a San Franciscan frustrated by how slowly our light-rail system often moves—stuck in mixed traffic, waiting at red lights, stopping every few hundred feet—I wanted to understand where and why performance breaks down.",
      "Surprisingly, there was no accessible, localized speed data showing how trains actually move through the system. So I built it myself.",
      "This project ingests live GTFS-RT vehicle positions and combines them with static infrastructure data to calculate real-world operating speeds across entire light-rail networks.",
    ],
    visualizes: [
      "Segment-by-segment speeds",
      "Bottlenecks and delay hotspots",
      "Route geometry and infrastructure constraints",
      "Systemwide performance patterns",
    ],
    goal: "The goal is simple: make light-rail performance measurable, transparent, and easy to explore—in San Francisco and across North American cities.",
  },
  keyDecisions: [
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
  dataMethodology: [
    "Live train positions come from agency GTFS-realtime or equivalent APIs.",
    "Speed is either reported directly by the agency or estimated from consecutive GPS position updates.",
    "Data freshness reflects what is currently in the database; stale periods can occur when live feeds are interrupted.",
    "Route geometry, crossings, switches, and separation overlays come from curated static files and OpenStreetMap data.",
    "Regional/metro overlays are built from GTFS static feeds, filtered to passenger rail services.",
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
