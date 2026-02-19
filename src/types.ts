// Cities supported by the app
export const CITIES = [
  "SF",
  "LA",
  "Seattle",
  "Boston",
  "Portland",
  "San Diego",
  "Toronto",
  "Philadelphia",
  "Sacramento",
  "Pittsburgh",
  "Dallas",
  "Minneapolis",
  "Denver",
  "Salt Lake City",
  "San Jose",
  "Phoenix",
  "Jersey City",
  "Calgary",
  "Edmonton",
  "Cleveland",
  "Charlotte",
  "Baltimore",
  "Washington",
] as const;
export type City = (typeof CITIES)[number];

// San Francisco Muni Metro lines
export const MUNI_LINES = ["F", "J", "K", "L", "M", "N", "T"] as const;
export type MuniLine = (typeof MUNI_LINES)[number];

// LA Metro Rail lines (using route codes as identifiers)
// 801 = A Line (Blue), 802 = B Line (Red), 803 = C Line (Green)
// 804 = E Line (Expo), 805 = D Line (Purple), 807 = K Line (Crenshaw)
// Note: 806 (L Line/Gold) is not in the current GTFS dataset
export const LA_METRO_LINES = [
  "801",
  "802",
  "803",
  "804",
  "805",
  "807",
] as const;
export type LAMetroLine = (typeof LA_METRO_LINES)[number];

// LA Metro line names and colors
export const LA_METRO_LINE_INFO: Record<
  LAMetroLine,
  { name: string; letter: string; color: string }
> = {
  "801": { name: "A Line (Blue)", letter: "A", color: "#0072BC" },
  "802": { name: "B Line (Red)", letter: "B", color: "#EB131B" },
  "803": { name: "C Line (Green)", letter: "C", color: "#58A738" },
  "804": { name: "E Line (Expo)", letter: "E", color: "#FDB913" },
  "805": { name: "D Line (Purple)", letter: "D", color: "#A05DA5" },
  "807": { name: "K Line (Crenshaw)", letter: "K", color: "#E56DB1" },
};

// Seattle Sound Transit Link Light Rail lines
// 100479 = 1 Line (Main), 2LINE = 2 Line (East Link), TLINE = T Line (Tacoma Link)
export const SEATTLE_LINK_LINES = ["100479", "2LINE", "TLINE"] as const;
export type SeattleLinkLine = (typeof SEATTLE_LINK_LINES)[number];

// Seattle Link line names and colors
export const SEATTLE_LINK_LINE_INFO: Record<
  SeattleLinkLine,
  { name: string; letter: string; color: string }
> = {
  "100479": { name: "1 Line", letter: "1", color: "#28813F" },
  "2LINE": { name: "2 Line", letter: "2", color: "#007CAD" },
  TLINE: { name: "T Line (Tacoma)", letter: "T", color: "#F38B00" },
};

// Boston MBTA Green Line branches
export const BOSTON_GREEN_LINE_ROUTES = [
  "Green-B",
  "Green-C",
  "Green-D",
  "Green-E",
] as const;
export type BostonGreenLine = (typeof BOSTON_GREEN_LINE_ROUTES)[number];

// Boston Green Line names and colors
export const BOSTON_GREEN_LINE_INFO: Record<
  BostonGreenLine,
  { name: string; letter: string; color: string }
> = {
  "Green-B": { name: "Green Line B", letter: "B", color: "#00843D" },
  "Green-C": { name: "Green Line C", letter: "C", color: "#00843D" },
  "Green-D": { name: "Green Line D", letter: "D", color: "#00843D" },
  "Green-E": { name: "Green Line E", letter: "E", color: "#00843D" },
};

// Portland TriMet MAX Light Rail lines
// 90 = MAX Red, 100 = MAX Blue, 190 = MAX Yellow, 200 = MAX Green, 290 = MAX Orange
export const PORTLAND_MAX_LINES = ["90", "100", "190", "200", "290"] as const;
export type PortlandMaxLine = (typeof PORTLAND_MAX_LINES)[number];

// Portland MAX line names and colors
export const PORTLAND_MAX_LINE_INFO: Record<
  PortlandMaxLine,
  { name: string; letter: string; color: string }
> = {
  "90": { name: "MAX Red Line", letter: "Red", color: "#C41F3E" },
  "100": { name: "MAX Blue Line", letter: "Blue", color: "#1359AE" },
  "190": { name: "MAX Yellow Line", letter: "Yellow", color: "#FFC52F" },
  "200": { name: "MAX Green Line", letter: "Green", color: "#008342" },
  "290": { name: "MAX Orange Line", letter: "Orange", color: "#D05F27" },
};

// Portland Streetcar lines
// 193 = NS Line, 194 = A Loop, 195 = B Loop
export const PORTLAND_STREETCAR_LINES = ["193", "194", "195"] as const;
export type PortlandStreetcarLine = (typeof PORTLAND_STREETCAR_LINES)[number];

// Portland Streetcar line names and colors (official GTFS colors)
export const PORTLAND_STREETCAR_LINE_INFO: Record<
  PortlandStreetcarLine,
  { name: string; letter: string; color: string }
> = {
  "193": { name: "NS Line", letter: "NS", color: "#72A130" },
  "194": { name: "A Loop", letter: "A", color: "#D91965" },
  "195": { name: "B Loop", letter: "B", color: "#4650BE" },
};

// Combined Portland rail lines (MAX + Streetcar)
export const PORTLAND_RAIL_LINES = [
  ...PORTLAND_MAX_LINES,
  ...PORTLAND_STREETCAR_LINES,
] as const;
export type PortlandRailLine = PortlandMaxLine | PortlandStreetcarLine;

// San Diego MTS Trolley lines
// 510 = Blue Line, 520 = Orange Line, 530 = Green Line
export const SAN_DIEGO_TROLLEY_LINES = ["510", "520", "530", "535"] as const;
export type SanDiegoTrolleyLine = (typeof SAN_DIEGO_TROLLEY_LINES)[number];

// San Diego Trolley line names and colors
export const SAN_DIEGO_TROLLEY_LINE_INFO: Record<
  SanDiegoTrolleyLine,
  { name: string; letter: string; color: string }
> = {
  "510": { name: "Blue Line", letter: "Blue", color: "#0000FF" },
  "520": { name: "Orange Line", letter: "Orange", color: "#FF6600" },
  "530": { name: "Green Line", letter: "Green", color: "#009900" },
  "535": { name: "Copper Line", letter: "Copper", color: "#B87333" },
};

// Toronto TTC Streetcar and LRT lines
// Main streetcar routes that run frequently, plus new LRT lines
export const TORONTO_STREETCAR_LINES = [
  "501",
  "503",
  "504",
  "505",
  "506",
  "507",
  "508",
  "509",
  "510",
  "511",
  "512",
  "805", // Line 5 Eglinton LRT (not yet open)
  "806", // Line 6 Finch West LRT (opened Dec 2025)
] as const;
export type TorontoStreetcarLine = (typeof TORONTO_STREETCAR_LINES)[number];

// Toronto Streetcar line names and colors
export const TORONTO_STREETCAR_LINE_INFO: Record<
  TorontoStreetcarLine,
  { name: string; letter: string; color: string; corridor: string }
> = {
  "501": {
    name: "501 Queen",
    letter: "501",
    color: "#ED1C24",
    corridor: "Queen",
  },
  "503": {
    name: "503 Kingston Rd",
    letter: "503",
    color: "#ED1C24",
    corridor: "Kingston Rd",
  },
  "504": {
    name: "504 King",
    letter: "504",
    color: "#ED1C24",
    corridor: "King",
  },
  "505": {
    name: "505 Dundas",
    letter: "505",
    color: "#ED1C24",
    corridor: "Dundas",
  },
  "506": {
    name: "506 Carlton",
    letter: "506",
    color: "#ED1C24",
    corridor: "Carlton",
  },
  "507": {
    name: "507 Long Branch",
    letter: "507",
    color: "#ED1C24",
    corridor: "Long Branch",
  },
  "508": {
    name: "508 Lake Shore",
    letter: "508",
    color: "#ED1C24",
    corridor: "Lake Shore",
  },
  "509": {
    name: "509 Harbourfront",
    letter: "509",
    color: "#ED1C24",
    corridor: "Harbourfront",
  },
  "510": {
    name: "510 Spadina",
    letter: "510",
    color: "#ED1C24",
    corridor: "Spadina",
  },
  "511": {
    name: "511 Bathurst",
    letter: "511",
    color: "#ED1C24",
    corridor: "Bathurst",
  },
  "512": {
    name: "512 St Clair",
    letter: "512",
    color: "#ED1C24",
    corridor: "St. Clair",
  },
  "805": {
    name: "Line 5 Eglinton",
    letter: "5",
    color: "#D18E00", // Official TTC Line 5 orange
    corridor: "Eglinton",
  },
  "806": {
    name: "Line 6 Finch West",
    letter: "6",
    color: "#959595", // Official TTC Line 6 gray
    corridor: "Finch West",
  },
};

// Philadelphia SEPTA Trolley lines
// T1-T5 = Subway-Surface Trolleys, D1-D2 = Media/Sharon Hill, G1 = Girard Ave
export const PHILLY_TROLLEY_LINES = [
  "10",
  "11",
  "13",
  "15",
  "34",
  "36",
  "101",
  "102",
] as const;
export type PhillyTrolleyLine = (typeof PHILLY_TROLLEY_LINES)[number];

// Philadelphia Trolley line names and colors
export const PHILLY_TROLLEY_LINE_INFO: Record<
  PhillyTrolleyLine,
  { name: string; letter: string; color: string }
> = {
  "10": { name: "Route 10", letter: "10", color: "#5A960A" },
  "11": { name: "Route 11", letter: "11", color: "#5A960A" },
  "13": { name: "Route 13", letter: "13", color: "#5A960A" },
  "15": { name: "Route 15 (Girard)", letter: "15", color: "#FFD700" },
  "34": { name: "Route 34", letter: "34", color: "#5A960A" },
  "36": { name: "Route 36", letter: "36", color: "#5A960A" },
  "101": { name: "Route 101 (Media)", letter: "101", color: "#DC2E6B" },
  "102": { name: "Route 102 (Sharon Hill)", letter: "102", color: "#DC2E6B" },
};

// Sacramento SacRT Light Rail lines
// 507 = Gold Line, 533 = Blue Line
export const SACRAMENTO_LIGHT_RAIL_LINES = ["Gold", "Blue"] as const;
export type SacramentoLightRailLine =
  (typeof SACRAMENTO_LIGHT_RAIL_LINES)[number];

// Sacramento Light Rail line names and colors
export const SACRAMENTO_LIGHT_RAIL_LINE_INFO: Record<
  SacramentoLightRailLine,
  { name: string; letter: string; color: string }
> = {
  Gold: { name: "Gold Line", letter: "Gold", color: "#EED211" },
  Blue: { name: "Blue Line", letter: "Blue", color: "#0000FF" },
};

// Pittsburgh Port Authority "The T" Light Rail lines
// Red Line = South Hills Village, Blue Line = Library
export const PITTSBURGH_T_LINES = ["RED", "BLUE", "SLVR"] as const;
export type PittsburghTLine = (typeof PITTSBURGH_T_LINES)[number];

// Pittsburgh T line names and colors
export const PITTSBURGH_T_LINE_INFO: Record<
  PittsburghTLine,
  { name: string; letter: string; color: string }
> = {
  RED: { name: "Red Line", letter: "Red", color: "#e40d17" },
  BLUE: { name: "Blue Line", letter: "Blue", color: "#5785b1" },
  SLVR: { name: "Silver Line", letter: "Silver", color: "#a7a9ab" },
};

// Dallas DART Light Rail lines
// Routes: Red, Blue, Green, Orange
export const DALLAS_DART_LINES = ["RED", "BLUE", "GREEN", "ORANGE"] as const;
export type DallasDartLine = (typeof DALLAS_DART_LINES)[number];

// Dallas DART line names and colors
export const DALLAS_DART_LINE_INFO: Record<
  DallasDartLine,
  { name: string; letter: string; color: string }
> = {
  RED: { name: "Red Line", letter: "Red", color: "#CE0E2D" },
  BLUE: { name: "Blue Line", letter: "Blue", color: "#0039A6" },
  GREEN: { name: "Green Line", letter: "Green", color: "#009B3A" },
  ORANGE: { name: "Orange Line", letter: "Orange", color: "#F7931E" },
};

// Minneapolis Metro Transit Light Rail lines
// Blue Line (Hiawatha) and Green Line (Central Corridor)
export const MINNEAPOLIS_METRO_LINES = ["Blue", "Green"] as const;
export type MinneapolisMetroLine = (typeof MINNEAPOLIS_METRO_LINES)[number];

// Minneapolis Metro line names and colors
export const MINNEAPOLIS_METRO_LINE_INFO: Record<
  MinneapolisMetroLine,
  { name: string; letter: string; color: string }
> = {
  Blue: { name: "Blue Line", letter: "Blue", color: "#0053A0" },
  Green: { name: "Green Line", letter: "Green", color: "#009E49" },
};

// Denver RTD Light Rail lines
// Lines present in OSM data: A, B, D, E, G, H, L, N, R, W
// C and F are not explicitly tagged in OSM (they share tracks with other lines)
export const DENVER_RTD_LINES = [
  // A,B,G,N are commuter rail
  // "A",
  // "B",
  // "G",
  // "N",
  // The rest are light rail
  "D",
  "E",
  "H",
  "L",
  "R",
  "W",
  // S is unknown, perhaps a specialty line?  Not in our current GTFS.
  // "S",
] as const;
export type DenverRtdLine = (typeof DENVER_RTD_LINES)[number];

// Denver RTD line names and colors (official RTD colors from Brand Elements)
// Only light rail lines - commuter rail (A, B, G, N) excluded
export const DENVER_RTD_LINE_INFO: Record<
  DenverRtdLine,
  { name: string; letter: string; color: string }
> = {
  D: { name: "D Line", letter: "D", color: "#008348" }, // Green
  E: { name: "E Line", letter: "E", color: "#552683" }, // Purple
  H: { name: "H Line", letter: "H", color: "#0075BF" }, // Blue
  L: { name: "L Line", letter: "L", color: "#FDB813" }, // Yellow
  R: { name: "R Line", letter: "R", color: "#8CC63F" }, // Lime Green
  W: { name: "W Line (Golden)", letter: "W", color: "#1C4E9D" }, // Dark Blue
};

// Salt Lake City UTA TRAX Light Rail lines
// Blue, Red, Green lines + S-Line streetcar
export const SLC_TRAX_LINES = ["Blue", "Red", "Green", "S-Line"] as const;
export type SlcTraxLine = (typeof SLC_TRAX_LINES)[number];

// Salt Lake City TRAX line names and colors
export const SLC_TRAX_LINE_INFO: Record<
  SlcTraxLine,
  { name: string; letter: string; color: string }
> = {
  Blue: { name: "Blue Line", letter: "Blue", color: "#0053A0" },
  Red: { name: "Red Line", letter: "Red", color: "#EE3124" },
  Green: { name: "Green Line", letter: "Green", color: "#008144" },
  "S-Line": { name: "S-Line Streetcar", letter: "S", color: "#77777a" },
};

// San Jose VTA Light Rail lines
// Blue, Green, Orange lines
export const VTA_LIGHT_RAIL_LINES = ["Blue", "Green", "Orange"] as const;
export type VtaLightRailLine = (typeof VTA_LIGHT_RAIL_LINES)[number];

// VTA Light Rail line names and colors (official VTA colors)
export const VTA_LIGHT_RAIL_LINE_INFO: Record<
  VtaLightRailLine,
  { name: string; letter: string; color: string }
> = {
  Blue: { name: "Blue Line", letter: "Blue", color: "#0072CE" },
  Green: { name: "Green Line", letter: "Green", color: "#008752" },
  Orange: { name: "Orange Line", letter: "Orange", color: "#F7931D" },
};

// Jersey City Hudson-Bergen Light Rail lines
export const HBLR_LINES = ["Bayonne Flyer", "Hoboken", "West Side"] as const;
export type HblrLine = (typeof HBLR_LINES)[number];

export const HBLR_LINE_INFO: Record<
  HblrLine,
  { name: string; letter: string; color: string }
> = {
  "Bayonne Flyer": { name: "Bayonne Flyer", letter: "BF", color: "#0072CE" },
  Hoboken: { name: "Hoboken", letter: "HOB", color: "#0072CE" },
  "West Side": { name: "West Side", letter: "WS", color: "#0072CE" },
};

// Calgary CTrain lines
// 201 = Red Line (Somerset-Bridlewood to Tuscany)
// 202 = Blue Line (Saddletowne to 69 Street)
// Note: Green Line is under construction and not yet in service
export const CALGARY_CTRAIN_LINES = ["201", "202"] as const;
export type CalgaryCtrainLine = (typeof CALGARY_CTRAIN_LINES)[number];

export const CALGARY_CTRAIN_LINE_INFO: Record<
  CalgaryCtrainLine,
  { name: string; letter: string; color: string }
> = {
  "201": { name: "Red Line", letter: "Red", color: "#EE3124" },
  "202": { name: "Blue Line", letter: "Blue", color: "#0072CE" },
};

// Edmonton LRT lines
export const EDMONTON_LRT_LINES = ["Capital", "Metro"] as const;
export type EdmontonLrtLine = (typeof EDMONTON_LRT_LINES)[number];

export const EDMONTON_LRT_LINE_INFO: Record<
  EdmontonLrtLine,
  { name: string; letter: string; color: string }
> = {
  Capital: { name: "Capital Line", letter: "Cap", color: "#0072CE" },
  Metro: { name: "Metro Line", letter: "Met", color: "#00A651" },
};

// Cleveland RTA Rapid Transit
// Route IDs: 66 = Red Line, 67 = Blue Line, 68 = Green Line
export const CLEVELAND_RTA_LINES = ["66", "67", "68"] as const;
export type ClevelandRtaLine = (typeof CLEVELAND_RTA_LINES)[number];

export const CLEVELAND_RTA_LINE_INFO: Record<
  ClevelandRtaLine,
  { name: string; letter: string; color: string }
> = {
  "66": { name: "Red Line", letter: "Red", color: "#D7182A" },
  "67": { name: "Blue Line", letter: "Blue", color: "#15BEF0" },
  "68": { name: "Green Line", letter: "Green", color: "#8FB73E" },
};

// Charlotte CATS Light Rail lines
// 501 = LYNX Blue Line, 510 = CityLYNX Gold Line
export const CHARLOTTE_LYNX_LINES = ["501", "510"] as const;
export type CharlotteLynxLine = (typeof CHARLOTTE_LYNX_LINES)[number];

export const CHARLOTTE_LYNX_LINE_INFO: Record<
  CharlotteLynxLine,
  { name: string; letter: string; color: string }
> = {
  "501": { name: "LYNX Blue Line", letter: "Blue", color: "#0169B4" },
  "510": { name: "CityLYNX Gold Line", letter: "Gold", color: "#FFD203" },
};

// Phoenix Valley Metro Rail lines
// A = East-West (downtown to Mesa), B = Northwest Extension
export const PHOENIX_LIGHT_RAIL_LINES = ["A", "B"] as const;
export type PhoenixLightRailLine = (typeof PHOENIX_LIGHT_RAIL_LINES)[number];

export const PHOENIX_LIGHT_RAIL_LINE_INFO: Record<
  PhoenixLightRailLine,
  { name: string; letter: string; color: string }
> = {
  A: { name: "A Line (East-West)", letter: "A", color: "#1E8ECD" }, // Official blue
  B: { name: "B Line (North-South)", letter: "B", color: "#B76912" }, // Official orange
};

// Baltimore Light RailLink
// Single unified line with branches to Hunt Valley, BWI Airport, Glen Burnie
export const BALTIMORE_LIGHT_RAIL_LINES = ["Light Rail"] as const;
export type BaltimoreLightRailLine =
  (typeof BALTIMORE_LIGHT_RAIL_LINES)[number];

export const BALTIMORE_LIGHT_RAIL_LINE_INFO: Record<
  BaltimoreLightRailLine,
  { name: string; letter: string; color: string }
> = {
  "Light Rail": { name: "Light RailLink", letter: "LR", color: "#007499" }, // MTA teal
};

// Union type for any transit line
export type TransitLine =
  | MuniLine
  | LAMetroLine
  | SeattleLinkLine
  | BostonGreenLine
  | PortlandMaxLine
  | SanDiegoTrolleyLine
  | TorontoStreetcarLine
  | PhillyTrolleyLine
  | SacramentoLightRailLine
  | PittsburghTLine
  | DallasDartLine
  | MinneapolisMetroLine
  | DenverRtdLine
  | SlcTraxLine
  | VtaLightRailLine
  | PhoenixLightRailLine
  | HblrLine
  | CalgaryCtrainLine
  | EdmontonLrtLine
  | ClevelandRtaLine
  | CharlotteLynxLine
  | BaltimoreLightRailLine;

// Get lines for a specific city
export function getLinesForCity(city: City): readonly string[] {
  switch (city) {
    case "SF":
      return MUNI_LINES;
    case "LA":
      return LA_METRO_LINES;
    case "Seattle":
      return SEATTLE_LINK_LINES;
    case "Boston":
      return BOSTON_GREEN_LINE_ROUTES;
    case "Portland":
      return PORTLAND_RAIL_LINES;
    case "San Diego":
      return SAN_DIEGO_TROLLEY_LINES;
    case "Toronto":
      return TORONTO_STREETCAR_LINES;
    case "Philadelphia":
      return PHILLY_TROLLEY_LINES;
    case "Sacramento":
      return SACRAMENTO_LIGHT_RAIL_LINES;
    case "Pittsburgh":
      return PITTSBURGH_T_LINES;
    case "Dallas":
      return DALLAS_DART_LINES;
    case "Minneapolis":
      return MINNEAPOLIS_METRO_LINES;
    case "Denver":
      return DENVER_RTD_LINES;
    case "Salt Lake City":
      return SLC_TRAX_LINES;
    case "San Jose":
      return VTA_LIGHT_RAIL_LINES;
    case "Phoenix":
      return PHOENIX_LIGHT_RAIL_LINES;
    case "Jersey City":
      return HBLR_LINES;
    case "Calgary":
      return CALGARY_CTRAIN_LINES;
    case "Edmonton":
      return EDMONTON_LRT_LINES;
    case "Cleveland":
      return CLEVELAND_RTA_LINES;
    case "Charlotte":
      return CHARLOTTE_LYNX_LINES;
    case "Baltimore":
      return BALTIMORE_LIGHT_RAIL_LINES;
    case "Washington":
      return []; // No light rail data yet
  }
}
