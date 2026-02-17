/**
 * Rail-context GTFS input feeds by city.
 *
 * This pipeline is intentionally separate from existing light-rail static data.
 * Add metro/regional/commuter/intercity GTFS feeds here as needed.
 */

export const railContextFeeds = {
  SF: [
    "./data/gtfs/sfmta_gtfs.zip",
    "./gtfs_context/bayarea/bart_gtfs.zip",
    "./gtfs_context/bayarea/caltrain_gtfs.zip",
    "./gtfs_context/bayarea/capitol_corridor_gtfs.zip",
    "./gtfs_context/bayarea/smart_gtfs.zip",
    // ACE is omitted until a valid static GTFS URL is available (511 key may be required).
  ],
  LA: [
    "./gtfs_la/gtfs_rail-master/gtfs_rail.zip",
    {
      zipPath: "./gtfs_context/la/metrolink_gtfs.zip",
      // Metrolink feed contains shapes but trips omit shape_id; map routes to known shape_id prefixes.
      routeShapePrefixes: {
        "Antelope Valley Line": ["AV"],
        "Inland Emp.-Orange Co. Line": ["IEOC"],
        "Orange County Line": ["OC"],
        "Riverside Line": ["RIVER"],
        "San Bernardino Line": ["SB"],
        "Ventura County Line": ["VT"],
        "91 Line": ["91"],
      },
    },
  ],
  Seattle: ["./gtfs_seattle/gtfs.zip"],
  Boston: ["./gtfs_boston/gtfs.zip"],
  Portland: ["./gtfs_portland/gtfs.zip"],
  "San Diego": [
    {
      zipPath: "./gtfs_context/sandiego/nctd_gtfs.zip",
      // Keep this feed scoped to Coaster commuter rail only.
      includeRouteIds: ["398", "498"],
      includeRouteLongNames: ["COASTER"],
    },
  ],
  Toronto: [
    "./gtfs_toronto/google_transit.zip",
    "./gtfs_context/toronto/go_gtfs.zip",
  ],
  Philadelphia: [
    "./gtfs_philly/google_rail.zip",
    "./gtfs_philly/google_bus.zip",
    "./gtfs_context/philly/patco_gtfs.zip",
    {
      zipPath: "./gtfs_context/philly/njtransit_rail_gtfs.zip",
      // Keep Philly context focused: include only NJ Transit Atlantic City Line.
      includeRouteShortNames: ["ATLC"],
    },
  ],
  Sacramento: ["./gtfs_sacramento/google_transit.zip"],
  Pittsburgh: ["./gtfs_pittsburgh/gtfs.zip"],
  Dallas: ["./gtfs_dallas/gtfs.zip"],
  Minneapolis: ["./gtfs_minneapolis/gtfs.zip"],
  Denver: ["./gtfs_denver/gtfs.zip"],
  "Salt Lake City": ["./gtfs_slc/gtfs.zip"],
  "San Jose": [
    "./gtfs_vta.zip",
    "./gtfs_context/bayarea/bart_gtfs.zip",
    "./gtfs_context/bayarea/caltrain_gtfs.zip",
    "./gtfs_context/bayarea/capitol_corridor_gtfs.zip",
    "./gtfs_context/bayarea/smart_gtfs.zip",
    // ACE is omitted until a valid static GTFS URL is available (511 key may be required).
  ],
  Phoenix: ["./gtfs_phoenix/gtfs.zip"],
  "Jersey City": [],
  Calgary: ["./gtfs_calgary/gtfs.zip"],
  Edmonton: ["./gtfs_edmonton/gtfs.zip"],
  Cleveland: ["./gtfs_cleveland/gtfs.zip"],
  Charlotte: ["./gtfs_charlotte/gtfs.zip"],
  Baltimore: [
    "./gtfs_context/baltimore/mta_metro_gtfs.zip",
    {
      zipPath: "./gtfs_context/baltimore/mta_marc_gtfs.zip",
      // Baltimore scope: include requested MARC lines only.
      includeRouteLongNames: ["PENN - WASHINGTON", "CAMDEN - WASHINGTON"],
    },
  ],
  Washington: [],
};

export const cityToRailContextPrefix = {
  SF: "sf",
  LA: "la",
  Seattle: "seattle",
  Boston: "boston",
  Portland: "portland",
  "San Diego": "sanDiego",
  Toronto: "toronto",
  Philadelphia: "philly",
  Sacramento: "sacramento",
  Pittsburgh: "pittsburgh",
  Dallas: "dallas",
  Minneapolis: "minneapolis",
  Denver: "denver",
  "Salt Lake City": "slc",
  "San Jose": "vta",
  Phoenix: "phoenix",
  "Jersey City": "hblr",
  Calgary: "calgary",
  Edmonton: "edmonton",
  Cleveland: "cleveland",
  Charlotte: "charlotte",
  Baltimore: "baltimore",
  Washington: "washington",
};
