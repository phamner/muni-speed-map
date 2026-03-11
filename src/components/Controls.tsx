import { useState, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type {
  MuniLine,
  LAMetroLine,
  SeattleLinkLine,
  BostonGreenLine,
  PortlandMaxLine,
  PortlandStreetcarLine,
  SanDiegoTrolleyLine,
  TorontoStreetcarLine,
  PhillyTrolleyLine,
  PittsburghTLine,
  MinneapolisMetroLine,
  DenverRtdLine,
  SlcTraxLine,
  VtaLightRailLine,
  PhoenixLightRailLine,
  ClevelandRtaLine,
  CharlotteLynxLine,
  BaltimoreLightRailLine,
  City,
} from "../types";
import {
  LA_METRO_LINE_INFO,
  SEATTLE_LINK_LINE_INFO,
  BOSTON_GREEN_LINE_INFO,
  PORTLAND_MAX_LINE_INFO,
  PORTLAND_STREETCAR_LINE_INFO,
  SAN_DIEGO_TROLLEY_LINE_INFO,
  TORONTO_STREETCAR_LINE_INFO,
  PHILLY_TROLLEY_LINE_INFO,
  PITTSBURGH_T_LINE_INFO,
  MINNEAPOLIS_METRO_LINE_INFO,
  DENVER_RTD_LINE_INFO,
  SLC_TRAX_LINE_INFO,
  VTA_LIGHT_RAIL_LINE_INFO,
  PHOENIX_LIGHT_RAIL_LINE_INFO,
  CLEVELAND_RTA_LINE_INFO,
  CHARLOTTE_LYNX_LINE_INFO,
  BALTIMORE_LIGHT_RAIL_LINE_INFO,
  getLinesForCity,
} from "../types";
import {
  ABOUT_CITY_NOTES,
  ABOUT_PROSPECTIVE_CITIES,
  ABOUT_SECTIONS,
  ABOUT_TABS,
} from "../content/aboutProject";
import type { AboutTab } from "../content/aboutProject";
import type {
  SpeedFilter,
  ViewMode,
  LineStats,
  RouteLineMode,
  SpeedUnit,
} from "../App";

const CITY_SELECTOR_ITEMS: {
  id: City;
  sortName: string;
  label: string;
  emoji: string;
  tooltip?: string;
}[] = [
  {
    id: "Baltimore",
    sortName: "Baltimore",
    label: "BAL",
    emoji: "🦀",
    tooltip: "MTA Light RailLink",
  },
  { id: "Boston", sortName: "Boston", label: "Boston", emoji: "🦞" },
  {
    id: "Charlotte",
    sortName: "Charlotte",
    label: "CLT",
    emoji: "🏦",
    tooltip: "LYNX Blue Line & Gold Line",
  },
  {
    id: "Cleveland",
    sortName: "Cleveland",
    label: "CLE",
    emoji: "🎸",
    tooltip: "RTA Red, Blue & Green Lines",
  },
  {
    id: "Denver",
    sortName: "Denver",
    label: "Denver",
    emoji: "⛏️",
    tooltip: "Data collection starting soon",
  },
  { id: "LA", sortName: "Los Angeles", label: "LA", emoji: "🌴" },
  {
    id: "Minneapolis",
    sortName: "Minneapolis",
    label: "MSP",
    emoji: "🌲",
    tooltip: "Data collection starting soon",
  },
  {
    id: "Philadelphia",
    sortName: "Philadelphia",
    label: "Philly",
    emoji: "🔔",
  },
  {
    id: "Phoenix",
    sortName: "Phoenix",
    label: "PHX",
    emoji: "🌵",
    tooltip: "Valley Metro Rail",
  },
  {
    id: "Pittsburgh",
    sortName: "Pittsburgh",
    label: "PIT",
    emoji: "🏗️",
    tooltip: "Data collection starting soon",
  },
  { id: "Portland", sortName: "Portland", label: "PDX", emoji: "🚲" },
  {
    id: "Salt Lake City",
    sortName: "Salt Lake City",
    label: "SLC",
    emoji: "🏔️",
    tooltip: "Data collection starting soon",
  },
  {
    id: "San Diego",
    sortName: "San Diego",
    label: "SD",
    emoji: "🌊",
    tooltip: "Waiting for API key",
  },
  {
    id: "San Jose",
    sortName: "San Jose",
    label: "SJ",
    emoji: "💻",
    tooltip: "Data collection starting soon",
  },
  {
    id: "Seattle",
    sortName: "Seattle",
    label: "Seattle",
    emoji: "☕",
    tooltip: "Waiting for API key",
  },
  { id: "SF", sortName: "San Francisco", label: "SF", emoji: "🌉" },
  { id: "Toronto", sortName: "Toronto", label: "Toronto", emoji: "🍁" },
].sort((a, b) => a.sortName.localeCompare(b.sortName)) as {
  id: City;
  sortName: string;
  label: string;
  emoji: string;
  tooltip?: string;
}[];

const OFFICIAL_TRANSIT_MAP_URLS: Record<City, string> = {
  SF: "https://www.sfmta.com/media/33952/download?inline",
  LA: "https://cdn.beta.metro.net/wp-content/uploads/2025/09/19112839/26-0250_blt_GM_MlinkAmtrak_47x47.5_DCR.pdf",
  Seattle:
    "https://www.soundtransit.org/sites/default/files/documents/st-current-service-map.pdf",
  Boston: "https://ontheworldmap.com/usa/city/boston/mbta-subway-map.jpg",
  Portland: "https://trimet.org/maps/img/railsystem.png",
  "San Diego":
    "https://www.sdmts.com/sites/default/files/attachments/trolley-system-map-2025.jpg",
  Toronto:
    "https://cdn.ttc.ca/-/media/Project/TTC/DevProto/Images/Home/Routes-and-Schedules/Landing-page-pdfs/TTC_SubwayStreetcarLightrailMap.pdf?rev=7d8053749e5c4075a1ae81a5d9a5fe86",
  Philadelphia: "",
  Pittsburgh:
    "https://www.rideprt.org/contentassets/063109698b9343de8d10ee531601accc/lrtmap.pdf",
  Minneapolis:
    "https://www.metrotransit.org/Data/Sites/1/media/metro/metro_diagrammap.pdf",
  Denver:
    "https://cdn.rtd-denver.com/image/upload/f_auto,q_auto/v1727299506/RTD_Rail_Map_September_2024_Website_FINAL_ksznbi.jpg",
  "Salt Lake City": "",
  "San Jose":
    "https://www.vta.org/sites/default/files/2026-01/ADA-LR-busconnect-011226.pdf",
  Phoenix:
    "https://i0.wp.com/transitmap.net/wp-content/uploads/2025/07/ValleyMetro-2025.jpg",
  Cleveland:
    "https://www.riderta.com/sites/default/files/pdf/maps/System_Map_Rapid.pdf",
  Charlotte:
    "https://www.charlottenc.gov/files/sharedassets/cats/v/4/cats-images/rtcs-plan-map-28x42-7_29_2025-5-1.jpg",
  Baltimore: "https://www.urbanrail.net/am/balt/baltimore-map.gif",
};

const TRANSIT_MAP_DISPLAY_URLS: Partial<Record<City, string>> = {
  SF: "/maps/sf-sfmta-map-33952.png",
  LA: "/maps/la-metro-map-2025.png",
  Seattle: "/maps/seattle-soundtransit-service-map.png",
  Toronto: "/maps/toronto-ttc-subway-streetcar-lightrail-map.png",
  Philadelphia: "/maps/philly-septa-system-map-v2-2.png",
  Pittsburgh: "/maps/pittsburgh-prt-lrtmap.png",
  Minneapolis: "/maps/minneapolis-metro-diagrammap.png",
  "San Jose": "/maps/san-jose-vta-ada-lr-busconnect-011226.png",
  "Salt Lake City": "/maps/uta-rail-map-nov2025.png",
  Cleveland: "/maps/cleveland-system-map-rapid.png",
  Baltimore: "/maps/baltimore-light-raillink-2.png",
};

const TRANSIT_MAP_SOURCE_URLS: Partial<Record<City, string>> = {
  SF: "https://www.sfmta.com/maps/muni-metro-map",
  LA: "https://www.metro.net/riding/guide/system-maps/",
  Seattle: "https://www.soundtransit.org/get-to-know-us/maps",
  Toronto: "https://www.ttc.ca/routes-and-schedules",
  Philadelphia:
    "https://wwww.septa.org/wp-content/uploads/page/communication/SEPTA_System-Map_v2-2.pdf",
  Pittsburgh:
    "https://www.rideprt.org/inside-Pittsburgh-Regional-Transit/rider-info/how-to-ride/how-to-ride-the-light-rail-system/",
  Minneapolis: "https://www.metrotransit.org/schedules-maps",
  "San Jose": "https://www.vta.org/go/maps",
  Cleveland: "https://www.riderta.com/maps",
  "San Diego": "https://www.sdmts.com/transit-services/trolley",
  Baltimore: "https://www.mta.maryland.gov/schedule/stops/lightrail",
  Phoenix: "https://www.valleymetro.org/",
};

// Official SFMTA colors from GTFS
const MUNI_COLORS: Record<MuniLine, string> = {
  F: "#B49A36",
  J: "#A96614",
  K: "#437C93",
  L: "#942D83",
  M: "#008547",
  N: "#005B95",
  T: "#BF2B45",
};

// Get color for any line
function getLineColor(line: string, city: City): string {
  if (city === "SF") {
    return MUNI_COLORS[line as MuniLine] || "#666";
  } else if (city === "LA") {
    return LA_METRO_LINE_INFO[line as LAMetroLine]?.color || "#666";
  } else if (city === "Seattle") {
    return SEATTLE_LINK_LINE_INFO[line as SeattleLinkLine]?.color || "#666";
  } else if (city === "Boston") {
    return BOSTON_GREEN_LINE_INFO[line as BostonGreenLine]?.color || "#666";
  } else if (city === "Portland") {
    return (
      PORTLAND_MAX_LINE_INFO[line as PortlandMaxLine]?.color ||
      PORTLAND_STREETCAR_LINE_INFO[line as PortlandStreetcarLine]?.color ||
      "#666"
    );
  } else if (city === "San Diego") {
    return (
      SAN_DIEGO_TROLLEY_LINE_INFO[line as SanDiegoTrolleyLine]?.color || "#666"
    );
  } else if (city === "Toronto") {
    return (
      TORONTO_STREETCAR_LINE_INFO[line as TorontoStreetcarLine]?.color ||
      "#ED1C24"
    );
  } else if (city === "Philadelphia") {
    return (
      PHILLY_TROLLEY_LINE_INFO[line as PhillyTrolleyLine]?.color || "#5A960A"
    );
  } else if (city === "Pittsburgh") {
    return PITTSBURGH_T_LINE_INFO[line as PittsburghTLine]?.color || "#666";
  } else if (city === "Minneapolis") {
    return (
      MINNEAPOLIS_METRO_LINE_INFO[line as MinneapolisMetroLine]?.color || "#666"
    );
  } else if (city === "Denver") {
    return DENVER_RTD_LINE_INFO[line as DenverRtdLine]?.color || "#666";
  } else if (city === "Salt Lake City") {
    return SLC_TRAX_LINE_INFO[line as SlcTraxLine]?.color || "#666";
  } else if (city === "San Jose") {
    return VTA_LIGHT_RAIL_LINE_INFO[line as VtaLightRailLine]?.color || "#666";
  } else if (city === "Phoenix") {
    return (
      PHOENIX_LIGHT_RAIL_LINE_INFO[line as PhoenixLightRailLine]?.color ||
      "#E5721A"
    );
  } else if (city === "Cleveland") {
    return CLEVELAND_RTA_LINE_INFO[line as ClevelandRtaLine]?.color || "#666";
  } else if (city === "Charlotte") {
    return CHARLOTTE_LYNX_LINE_INFO[line as CharlotteLynxLine]?.color || "#666";
  } else if (city === "Baltimore") {
    return (
      BALTIMORE_LIGHT_RAIL_LINE_INFO[line as BaltimoreLightRailLine]?.color ||
      "#666"
    );
  }
  return "#666";
}

// Get display label for a line
function getLineLabel(line: string, city: City): string {
  if (city === "SF") {
    return line;
  } else if (city === "LA") {
    return LA_METRO_LINE_INFO[line as LAMetroLine]?.letter || line;
  } else if (city === "Seattle") {
    return SEATTLE_LINK_LINE_INFO[line as SeattleLinkLine]?.letter || line;
  } else if (city === "Boston") {
    return BOSTON_GREEN_LINE_INFO[line as BostonGreenLine]?.letter || line;
  } else if (city === "Portland") {
    return (
      PORTLAND_MAX_LINE_INFO[line as PortlandMaxLine]?.letter ||
      PORTLAND_STREETCAR_LINE_INFO[line as PortlandStreetcarLine]?.letter ||
      line
    );
  } else if (city === "San Diego") {
    return (
      SAN_DIEGO_TROLLEY_LINE_INFO[line as SanDiegoTrolleyLine]?.letter || line
    );
  } else if (city === "Toronto") {
    return (
      TORONTO_STREETCAR_LINE_INFO[line as TorontoStreetcarLine]?.letter || line
    );
  } else if (city === "Philadelphia") {
    return PHILLY_TROLLEY_LINE_INFO[line as PhillyTrolleyLine]?.letter || line;
  } else if (city === "Pittsburgh") {
    return PITTSBURGH_T_LINE_INFO[line as PittsburghTLine]?.letter || line;
  } else if (city === "Minneapolis") {
    return (
      MINNEAPOLIS_METRO_LINE_INFO[line as MinneapolisMetroLine]?.letter || line
    );
  } else if (city === "Denver") {
    return DENVER_RTD_LINE_INFO[line as DenverRtdLine]?.letter || line;
  } else if (city === "Salt Lake City") {
    return SLC_TRAX_LINE_INFO[line as SlcTraxLine]?.letter || line;
  } else if (city === "San Jose") {
    return VTA_LIGHT_RAIL_LINE_INFO[line as VtaLightRailLine]?.letter || line;
  } else if (city === "Phoenix") {
    return (
      PHOENIX_LIGHT_RAIL_LINE_INFO[line as PhoenixLightRailLine]?.letter || line
    );
  } else if (city === "Cleveland") {
    return CLEVELAND_RTA_LINE_INFO[line as ClevelandRtaLine]?.letter || line;
  } else if (city === "Charlotte") {
    return CHARLOTTE_LYNX_LINE_INFO[line as CharlotteLynxLine]?.letter || line;
  } else if (city === "Baltimore") {
    return (
      BALTIMORE_LIGHT_RAIL_LINE_INFO[line as BaltimoreLightRailLine]?.letter ||
      line
    );
  }
  return line;
}

// Get badge width class based on the longest label in each city
function getBadgeWidthClass(city: City): string {
  switch (city) {
    case "Portland":
    case "San Diego":
    case "Pittsburgh":
    case "San Jose": // "Orange", "Green", "Blue"
    case "Salt Lake City": // "Green", "Blue", "Red", "S"
    case "Cleveland": // "Green", "Blue", "Red"
      return "badge-width-word"; // Cities with "Orange", "Green", etc.
    case "Minneapolis":
    case "Charlotte": // "Blue", "Gold"
      return "badge-width-short-word"; // "Blue", "Gold", "Cap", "Met"
    case "Phoenix":
      return "badge-width-letter"; // Single letters (A, B)
    case "Baltimore":
      return "badge-width-3digit"; // "LR" needs more space than single letter
    case "Toronto":
    case "Philadelphia":
      return "badge-width-3digit"; // "501", "102"
    default:
      return "badge-width-letter"; // Single letters (SF, LA, Boston, Seattle, Denver)
  }
}

// Get line info for tooltip
function getLineInfo(line: string, city: City): string | undefined {
  if (city === "LA") {
    return LA_METRO_LINE_INFO[line as LAMetroLine]?.name;
  } else if (city === "Seattle") {
    return SEATTLE_LINK_LINE_INFO[line as SeattleLinkLine]?.name;
  } else if (city === "Boston") {
    return BOSTON_GREEN_LINE_INFO[line as BostonGreenLine]?.name;
  } else if (city === "Portland") {
    return (
      PORTLAND_MAX_LINE_INFO[line as PortlandMaxLine]?.name ||
      PORTLAND_STREETCAR_LINE_INFO[line as PortlandStreetcarLine]?.name
    );
  } else if (city === "San Diego") {
    return SAN_DIEGO_TROLLEY_LINE_INFO[line as SanDiegoTrolleyLine]?.name;
  } else if (city === "Toronto") {
    return TORONTO_STREETCAR_LINE_INFO[line as TorontoStreetcarLine]?.name;
  } else if (city === "Philadelphia") {
    return PHILLY_TROLLEY_LINE_INFO[line as PhillyTrolleyLine]?.name;
  } else if (city === "Pittsburgh") {
    return PITTSBURGH_T_LINE_INFO[line as PittsburghTLine]?.name;
  } else if (city === "Minneapolis") {
    return MINNEAPOLIS_METRO_LINE_INFO[line as MinneapolisMetroLine]?.name;
  } else if (city === "Denver") {
    return DENVER_RTD_LINE_INFO[line as DenverRtdLine]?.name;
  } else if (city === "Salt Lake City") {
    return SLC_TRAX_LINE_INFO[line as SlcTraxLine]?.name;
  } else if (city === "San Jose") {
    return VTA_LIGHT_RAIL_LINE_INFO[line as VtaLightRailLine]?.name;
  } else if (city === "Phoenix") {
    return PHOENIX_LIGHT_RAIL_LINE_INFO[line as PhoenixLightRailLine]?.name;
  } else if (city === "Cleveland") {
    return CLEVELAND_RTA_LINE_INFO[line as ClevelandRtaLine]?.name;
  } else if (city === "Charlotte") {
    return CHARLOTTE_LYNX_LINE_INFO[line as CharlotteLynxLine]?.name;
  } else if (city === "Baltimore") {
    return BALTIMORE_LIGHT_RAIL_LINE_INFO[line as BaltimoreLightRailLine]?.name;
  }
  return undefined;
}

interface ControlsProps {
  city: City;
  setCity: (city: City) => void;
  selectedLines: string[];
  setSelectedLines: (lines: string[]) => void;
  vehicleCount: number;
  speedFilter: SpeedFilter;
  setSpeedFilter: (filter: SpeedFilter) => void;
  showRouteLines: boolean;
  setShowRouteLines: (show: boolean) => void;
  routeLineMode: RouteLineMode;
  setRouteLineMode: (mode: RouteLineMode) => void;
  showStops: boolean;
  setShowStops: (show: boolean) => void;
  showCrossings: boolean;
  setShowCrossings: (show: boolean) => void;
  showTrafficLights: boolean;
  setShowTrafficLights: (show: boolean) => void;
  showSwitches: boolean;
  setShowSwitches: (show: boolean) => void;
  showRailContextHeavy: boolean;
  setShowRailContextHeavy: (show: boolean) => void;
  showRailContextCommuter: boolean;
  setShowRailContextCommuter: (show: boolean) => void;
  showBusRoutesOverlay: boolean;
  setShowBusRoutesOverlay: (show: boolean) => void;
  railContextHeavyCount: number;
  railContextCommuterCount: number;
  busRoutesOverlayCount: number;
  hideStoppedTrains: boolean;
  setHideStoppedTrains: (hide: boolean) => void;
  hideAllTrains: boolean;
  setHideAllTrains: (hide: boolean) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  lineStats: LineStats[];
  speedUnit: SpeedUnit;
  setSpeedUnit: (unit: SpeedUnit) => void;
  isSidebarOpen?: boolean;
  onResetPopulationDensity?: () => void;
}

function CollapsibleSection({
  title,
  isExpanded,
  onToggle,
  children,
  rightElement,
}: {
  title: string;
  isExpanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  rightElement?: ReactNode;
}) {
  return (
    <div className="collapsible-section">
      <div
        className="collapsible-header"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <span className={`collapsible-chevron ${isExpanded ? "expanded" : ""}`}>
          ▶
        </span>
        <span className="collapsible-title">{title}</span>
        {rightElement && (
          <span
            className="collapsible-right"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {rightElement}
          </span>
        )}
      </div>
      {isExpanded && <div className="collapsible-content">{children}</div>}
    </div>
  );
}

export function Controls({
  city,
  setCity,
  selectedLines,
  setSelectedLines,
  vehicleCount,
  speedFilter,
  setSpeedFilter,
  showRouteLines,
  setShowRouteLines,
  routeLineMode,
  setRouteLineMode,
  showStops,
  setShowStops,
  showCrossings,
  setShowCrossings,
  showTrafficLights,
  setShowTrafficLights,
  showSwitches,
  setShowSwitches,
  showRailContextHeavy,
  setShowRailContextHeavy,
  showRailContextCommuter,
  setShowRailContextCommuter,
  showBusRoutesOverlay,
  setShowBusRoutesOverlay,
  railContextHeavyCount,
  railContextCommuterCount,
  busRoutesOverlayCount,
  hideStoppedTrains,
  setHideStoppedTrains,
  hideAllTrains,
  setHideAllTrains,
  viewMode,
  setViewMode,
  lineStats,
  speedUnit,
  setSpeedUnit,
  isSidebarOpen,
  onResetPopulationDensity,
}: ControlsProps) {
  const MIN_TRANSIT_MAP_ZOOM = 1;
  const MAX_TRANSIT_MAP_ZOOM = 4;
  const TRANSIT_MAP_ZOOM_STEP = 0.1;
  const TRANSIT_MAP_BUTTON_ZOOM_STEP = 0.25;
  const TRANSIT_MAP_PAN_STEP = 40;
  const TRANSIT_MAP_PAN_STEP_FAST = 120;

  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showTooltip = (e: React.MouseEvent, text: string) => {
    const x = e.clientX + 12;
    const y = e.clientY + 12;
    tooltipTimer.current = setTimeout(() => {
      setTooltip({ x, y, text });
    }, 500);
  };
  const hideTooltip = () => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    tooltipTimer.current = null;
    setTooltip(null);
  };
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [aboutActiveTab, setAboutActiveTab] = useState<AboutTab>("overview");
  const [showTransitMapModal, setShowTransitMapModal] = useState(false);
  const [transitMapZoom, setTransitMapZoom] = useState(MIN_TRANSIT_MAP_ZOOM);
  const [transitMapPan, setTransitMapPan] = useState({ x: 0, y: 0 });
  const [isTransitMapPanning, setIsTransitMapPanning] = useState(false);
  const [transitMapBaseSize, setTransitMapBaseSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const transitMapViewportRef = useRef<HTMLDivElement | null>(null);
  const transitMapDragRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
  }>({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    startPanX: 0,
    startPanY: 0,
  });

  // Collapsible sections state
  const [sections, setSections] = useState({
    speedView: true,
    linesContext: true,
    infrastructure: true,
  });

  // Allow Escape key to close open informational modals.
  useEffect(() => {
    if (!showAboutModal && !showTransitMapModal) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowAboutModal(false);
        setShowTransitMapModal(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [showAboutModal, showTransitMapModal]);

  const allLines = getLinesForCity(city);

  const toggleLine = (line: string) => {
    if (selectedLines.includes(line)) {
      setSelectedLines(selectedLines.filter((l) => l !== line));
    } else {
      setSelectedLines([...selectedLines, line]);
    }
  };

  const selectAllLines = () => {
    setSelectedLines([...allLines] as string[]);
  };

  const clearAllLines = () => {
    setSelectedLines([]);
  };

  // Speed unit conversion helpers
  const convertSpeed = (mph: number): number => {
    return speedUnit === "kmh" ? mph * 1.60934 : mph;
  };

  const unitLabel = speedUnit === "kmh" ? "km/h" : "mph";
  const unitLabelLower = speedUnit === "kmh" ? "km/h" : "mph";

  // Two-line title: Line 1 = City, Line 2 = System
  const cityNames: Record<string, string> = {
    SF: "San Francisco, CA",
    LA: "Los Angeles, CA",
    Seattle: "Seattle, WA",
    Boston: "Boston, MA",
    Portland: "Portland, OR",
    "San Diego": "San Diego, CA",
    Toronto: "Toronto, ON",
    Philadelphia: "Philadelphia, PA",
    Pittsburgh: "Pittsburgh, PA",
    Minneapolis: "Minneapolis, MN",
    Denver: "Denver, CO",
    "Salt Lake City": "Salt Lake City, UT",
    "San Jose": "San Jose, CA",
    Cleveland: "Cleveland, OH",
    Charlotte: "Charlotte, NC",
    Phoenix: "Phoenix, AZ",
    Baltimore: "Baltimore, MD",
  };
  const systemNames: Record<string, string> = {
    SF: "Muni Speed Map",
    LA: "Metro Speed Map",
    Seattle: "Link Speed Map",
    Boston: "Green Line Speed Map",
    Portland: "MAX Speed Map",
    "San Diego": "Trolley Speed Map",
    Toronto: "Streetcar Speed Map",
    Philadelphia: "Trolley Speed Map",
    Pittsburgh: "The T Speed Map",
    Minneapolis: "Metro Speed Map",
    Denver: "RTD Speed Map",
    "Salt Lake City": "TRAX Speed Map",
    "San Jose": "VTA Speed Map",
    Cleveland: "RTA Speed Map",
    Charlotte: "LYNX Speed Map",
    Phoenix: "Valley Metro Speed Map",
    Baltimore: "RailLink Speed Map",
  };
  const cityLogos: Partial<Record<string, string>> = {
    SF: "/logos/Muni_worm_logo.svg",
    LA: "/logos/LAMetroLogo.svg",
    Seattle: "/logos/Sound_Transit_logo_simplified.svg",
    Boston: "/logos/MBTA.svg",
    Portland: "/logos/TriMet_MAX_logo.svg",
    Philadelphia: "/logos/SEPTA.svg",
    "San Jose": "/logos/VTA_logo_2017_no_text.svg",
    Toronto: "/logos/Logo_of_the_Toronto_Transit_Commission.svg",
    Minneapolis: "/logos/Metro_Minnesota_icon.svg",
    Denver: "/logos/Regional_Transportation_District_logo.svg",
    "Salt Lake City": "/logos/UTA_logo_reformatted.svg",
    Pittsburgh: "/logos/Pittsburgh_Regional_Transit_Logo_no_text.svg",
    Cleveland: "/logos/Cleveland_RTA_logo.svg",
    Phoenix: "/logos/Valley_Metro_logo_no_text.svg",
    Baltimore: "/logos/Baltimore_Light_RailLink_logo (1)_attempt1.svg",
    "San Diego": "/logos/Logo_San_Diego_Metropolitan_Transit_System.svg",
    Charlotte: "/logos/Charlotte_CATS_logo.png",
  };
  const cityLogoHeights: Partial<Record<string, number>> = {
    Phoenix: 20,
    Denver: 20,
    Toronto: 22,
    "San Jose": 22,
    Cleveland: 26,
    Minneapolis: 26,
    Boston: 26,
    LA: 26,
    Pittsburgh: 18,
    Baltimore: 26,
  };
  const cityLine = cityNames[city] || city;
  const systemLine = systemNames[city] || "Speed Map";
  const cityLogo = cityLogos[city];
  const cityLogoHeight = cityLogoHeights[city];
  const slightlySmallTitleCities = ["San Diego"];
  const mlongTitleCities = ["Baltimore"];
  const longTitleCities = ["Boston", "Toronto"];
  const xlongTitleCities = ["Phoenix"];
  const mobileMediumTitleCities = ["Phoenix", "Baltimore", "Toronto"];
  const mobileSmallTitleCities: City[] = [];
  const officialTransitMapUrl = OFFICIAL_TRANSIT_MAP_URLS[city];
  const transitMapDisplayUrl =
    TRANSIT_MAP_DISPLAY_URLS[city] || officialTransitMapUrl;
  const transitMapSourceUrl =
    TRANSIT_MAP_SOURCE_URLS[city] ||
    officialTransitMapUrl ||
    transitMapDisplayUrl;
  const isDisplayedMapPdf =
    !!transitMapDisplayUrl &&
    transitMapDisplayUrl.toLowerCase().split("?")[0].endsWith(".pdf");
  const clampTransitMapZoom = (zoom: number) =>
    Math.min(MAX_TRANSIT_MAP_ZOOM, Math.max(MIN_TRANSIT_MAP_ZOOM, zoom));
  const clampTransitMapPan = (zoom: number, x: number, y: number) => {
    if (!transitMapBaseSize || !transitMapViewportRef.current) {
      return { x: 0, y: 0 };
    }

    const viewport = transitMapViewportRef.current;
    const viewportWidth = viewport.clientWidth;
    const viewportHeight = viewport.clientHeight;
    const contentWidth = transitMapBaseSize.width * zoom;
    const contentHeight = transitMapBaseSize.height * zoom;

    let clampedX = x;
    let clampedY = y;

    if (contentWidth <= viewportWidth) {
      clampedX = (viewportWidth - contentWidth) / 2;
    } else {
      const minX = viewportWidth - contentWidth;
      clampedX = Math.max(minX, Math.min(0, x));
    }

    if (contentHeight <= viewportHeight) {
      clampedY = (viewportHeight - contentHeight) / 2;
    } else {
      const minY = viewportHeight - contentHeight;
      clampedY = Math.max(minY, Math.min(0, y));
    }

    return { x: clampedX, y: clampedY };
  };
  const transitMapCanvasStyle = transitMapBaseSize
    ? {
        width: `${Math.round(transitMapBaseSize.width)}px`,
        height: `${Math.round(transitMapBaseSize.height)}px`,
      }
    : undefined;
  const transitMapImageStyle = transitMapBaseSize
    ? {
        width: `${transitMapBaseSize.width}px`,
        height: `${transitMapBaseSize.height}px`,
        transform: `translate3d(${Math.round(transitMapPan.x)}px, ${Math.round(transitMapPan.y)}px, 0) scale(${transitMapZoom})`,
        transformOrigin: "top left",
      }
    : undefined;

  const applyTransitMapZoom = (
    requestedZoom: number,
    clientX?: number,
    clientY?: number,
  ) => {
    const nextZoom = clampTransitMapZoom(requestedZoom);
    if (nextZoom === transitMapZoom) return;

    if (transitMapBaseSize && transitMapViewportRef.current) {
      const viewport = transitMapViewportRef.current;
      const viewportRect = viewport.getBoundingClientRect();
      const anchorX =
        typeof clientX === "number"
          ? clientX - viewportRect.left
          : viewportRect.width / 2;
      const anchorY =
        typeof clientY === "number"
          ? clientY - viewportRect.top
          : viewportRect.height / 2;

      const imageX = (anchorX - transitMapPan.x) / transitMapZoom;
      const imageY = (anchorY - transitMapPan.y) / transitMapZoom;
      const nextPan = {
        x: anchorX - imageX * nextZoom,
        y: anchorY - imageY * nextZoom,
      };

      setTransitMapZoom(nextZoom);
      setTransitMapPan(clampTransitMapPan(nextZoom, nextPan.x, nextPan.y));
      return;
    }

    setTransitMapZoom(nextZoom);
  };

  const handleTransitMapWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!transitMapBaseSize) return;
    const zoomFactor = Math.exp(-event.deltaY * 0.001);
    applyTransitMapZoom(
      clampTransitMapZoom(transitMapZoom * zoomFactor),
      event.clientX,
      event.clientY,
    );
  };

  const handleTransitMapPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (transitMapZoom <= MIN_TRANSIT_MAP_ZOOM) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const viewport = transitMapViewportRef.current;
    if (!viewport) return;

    transitMapDragRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPanX: transitMapPan.x,
      startPanY: transitMapPan.y,
    };
    setIsTransitMapPanning(true);
    viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handleTransitMapPointerMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const dragState = transitMapDragRef.current;
    if (!dragState.active || dragState.pointerId !== event.pointerId) return;

    const viewport = transitMapViewportRef.current;
    if (!viewport) return;

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    const nextPan = clampTransitMapPan(
      transitMapZoom,
      dragState.startPanX + deltaX,
      dragState.startPanY + deltaY,
    );
    setTransitMapPan(nextPan);
  };

  const handleTransitMapPointerUp = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const dragState = transitMapDragRef.current;
    if (!dragState.active || dragState.pointerId !== event.pointerId) return;

    const viewport = transitMapViewportRef.current;
    if (viewport) {
      try {
        viewport.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore if pointer capture has already been released.
      }
    }
    transitMapDragRef.current.active = false;
    transitMapDragRef.current.pointerId = null;
    setIsTransitMapPanning(false);
  };

  const handleTransitMapKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => {
    const isArrowKey =
      event.key === "ArrowUp" ||
      event.key === "ArrowDown" ||
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight";
    if (!isArrowKey) return;

    // Keep keyboard panning for zoomed-in map states.
    if (transitMapZoom <= MIN_TRANSIT_MAP_ZOOM) return;

    event.preventDefault();
    const panStep = event.shiftKey
      ? TRANSIT_MAP_PAN_STEP_FAST
      : TRANSIT_MAP_PAN_STEP;

    setTransitMapPan((currentPan) => {
      let nextX = currentPan.x;
      let nextY = currentPan.y;

      if (event.key === "ArrowLeft") nextX += panStep;
      if (event.key === "ArrowRight") nextX -= panStep;
      if (event.key === "ArrowUp") nextY += panStep;
      if (event.key === "ArrowDown") nextY -= panStep;

      return clampTransitMapPan(transitMapZoom, nextX, nextY);
    });
  };

  useEffect(() => {
    if (!showTransitMapModal) return;
    setTransitMapZoom(MIN_TRANSIT_MAP_ZOOM);
    setTransitMapPan({ x: 0, y: 0 });
    setTransitMapBaseSize(null);
    setIsTransitMapPanning(false);
    transitMapDragRef.current.active = false;
    transitMapDragRef.current.pointerId = null;
  }, [showTransitMapModal, city, transitMapDisplayUrl]);

  useEffect(() => {
    if (!transitMapBaseSize) return;
    setTransitMapPan((currentPan) =>
      clampTransitMapPan(transitMapZoom, currentPan.x, currentPan.y),
    );
  }, [transitMapZoom, transitMapBaseSize]);

  return (
    <div className={`controls-panel ${isSidebarOpen ? "mobile-open" : ""}`}>
      <div className="app-header">
        <div className="app-title-row">
          <h1
            className={`app-title ${xlongTitleCities.includes(city) ? "app-title-xlong" : longTitleCities.includes(city) ? "app-title-long" : mlongTitleCities.includes(city) ? "app-title-mlong" : slightlySmallTitleCities.includes(city) ? "app-title-slightly-small" : ""} ${mobileMediumTitleCities.includes(city) ? "app-title-mobile-medium" : ""} ${mobileSmallTitleCities.includes(city) ? "app-title-mobile-small" : ""}`}
          >
            {systemLine}
          </h1>
          {cityLogo && (
            <img
              key={city}
              src={cityLogo}
              alt=""
              className="app-title-logo"
              style={
                cityLogoHeight ? { height: `${cityLogoHeight}px` } : undefined
              }
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          )}
        </div>
        <span className="app-city">{cityLine}</span>
      </div>
      <div className="app-header-link-row">
        <button
          className="app-header-link-btn app-header-link-btn-alt"
          onClick={() => setShowAboutModal(true)}
        >
          About project
        </button>
        <button
          className="app-header-link-btn"
          onClick={() => setShowTransitMapModal(true)}
          onMouseEnter={(e) => showTooltip(e, "View rail map")}
          onMouseLeave={hideTooltip}
        >
          View rail map
        </button>
      </div>
      {/* City Selector - alphabetical by city name */}
      <div className="city-selector">
        {CITY_SELECTOR_ITEMS.map(({ id, label, emoji, tooltip }) => (
          <button
            key={id}
            className={`city-btn ${city === id ? "active" : ""}`}
            onClick={() => setCity(id)}
            {...(tooltip && {
              onMouseEnter: (e: React.MouseEvent) => showTooltip(e, tooltip),
              onMouseLeave: hideTooltip,
            })}
          >
            {emoji} {label}
          </button>
        ))}
      </div>

      {/* Data Status */}
      <div className="status-section">
        <div className="status-row">
          <div className="status-row-main">
            <span
              className={`live-indicator ${vehicleCount === 0 ? "loading" : ""}`}
            ></span>
            <span>{vehicleCount.toLocaleString()} data points</span>
          </div>
          <div className="unit-toggle-group status-unit-toggle">
            <button
              className={`unit-toggle-btn ${speedUnit === "mph" ? "active" : ""}`}
              onClick={() => setSpeedUnit("mph")}
            >
              mph
            </button>
            <button
              className={`unit-toggle-btn ${speedUnit === "kmh" ? "active" : ""}`}
              onClick={() => setSpeedUnit("kmh")}
            >
              km/h
            </button>
          </div>
        </div>
      </div>

      {/* Speed View & Filter */}
      <CollapsibleSection
        title="Speed View & Filter"
        isExpanded={sections.speedView}
        onToggle={() => setSections((s) => ({ ...s, speedView: !s.speedView }))}
        rightElement={
          <button
            className={`train-visibility-toggle ${hideAllTrains ? "hidden" : "visible"}`}
            onClick={() => setHideAllTrains(!hideAllTrains)}
          >
            {hideAllTrains ? "Show Trains" : "Hide Trains"}
          </button>
        }
      >
        <div
          className="view-mode-toggle"
          style={{
            opacity: hideAllTrains ? 0.4 : 1,
            pointerEvents: hideAllTrains ? "none" : "auto",
          }}
        >
          <button
            className={`view-mode-btn ${viewMode === "raw" ? "active" : ""}`}
            onClick={() => setViewMode("raw")}
            disabled={hideAllTrains}
          >
            Raw Data
          </button>
          <button
            className={`view-mode-btn ${
              viewMode === "segments" ? "active" : ""
            }`}
            onClick={() => setViewMode("segments")}
            disabled={hideAllTrains}
          >
            200m Avg
          </button>
          <button
            className={`view-mode-btn ${
              viewMode === "segments-500" ? "active" : ""
            }`}
            onClick={() => setViewMode("segments-500")}
            disabled={hideAllTrains}
          >
            500m Avg
          </button>
        </div>
        <div
          className="control-label"
          style={{ opacity: hideAllTrains ? 0.4 : 1 }}
        >
          Speed Filter
        </div>
        <div
          className="speed-filter"
          style={{
            opacity: hideAllTrains ? 0.4 : 1,
            pointerEvents: hideAllTrains ? "none" : "auto",
          }}
        >
          <div className="speed-slider-row">
            <label>
              Min: {Math.round(convertSpeed(speedFilter.minSpeed))}{" "}
              {unitLabelLower}
            </label>
            <input
              type="range"
              min="0"
              max="50"
              value={speedFilter.minSpeed}
              onChange={(e) =>
                setSpeedFilter({
                  ...speedFilter,
                  minSpeed: Math.min(
                    Number(e.target.value),
                    speedFilter.maxSpeed,
                  ),
                })
              }
              className="speed-slider"
              disabled={hideAllTrains}
            />
          </div>
          <div className="speed-slider-row">
            <label>
              Max:{" "}
              {speedFilter.maxSpeed === 50
                ? `${Math.round(convertSpeed(50))}+`
                : Math.round(convertSpeed(speedFilter.maxSpeed))}{" "}
              {unitLabelLower}
            </label>
            <input
              type="range"
              min="0"
              max="50"
              value={speedFilter.maxSpeed}
              onChange={(e) =>
                setSpeedFilter({
                  ...speedFilter,
                  maxSpeed: Math.max(
                    Number(e.target.value),
                    speedFilter.minSpeed,
                  ),
                })
              }
              className="speed-slider"
              disabled={hideAllTrains}
            />
          </div>
        </div>
        <div
          className="route-lines-toggle"
          style={{
            opacity: hideAllTrains ? 0.4 : 1,
            pointerEvents: hideAllTrains ? "none" : "auto",
          }}
        >
          <label>
            <input
              type="checkbox"
              checked={hideStoppedTrains}
              onChange={(e) => setHideStoppedTrains(e.target.checked)}
              disabled={hideAllTrains}
            />
            Hide stopped trains (0 {unitLabelLower})
          </label>
        </div>
      </CollapsibleSection>

      {/* Lines & Regional Context */}
      <CollapsibleSection
        title="Lines & Regional Context"
        isExpanded={sections.linesContext}
        onToggle={() =>
          setSections((s) => ({ ...s, linesContext: !s.linesContext }))
        }
        rightElement={
          <div
            className="toggle-group"
            style={{
              visibility: sections.linesContext ? "visible" : "hidden",
            }}
          >
            <button
              className={`toggle-button ${
                selectedLines.length === allLines.length ? "active" : ""
              }`}
              onClick={selectAllLines}
            >
              All
            </button>
            <button
              className={`toggle-button ${
                selectedLines.length === 0 ? "active" : ""
              }`}
              onClick={clearAllLines}
            >
              None
            </button>
          </div>
        }
      >
        <div
          className={`line-buttons${allLines.length === 4 ? " four-lines" : ""}`}
        >
          {allLines.map((line) => (
            <button
              key={line}
              className={`line-button ${
                selectedLines.includes(line) ? "active" : "inactive"
              }${city === "Toronto" ? " toronto-line-button" : ""}${
                city === "Toronto" && line === "805" ? " line-coming-soon" : ""
              }`}
              style={
                {
                  "--line-color": getLineColor(line, city),
                } as React.CSSProperties
              }
              onClick={() => {
                toggleLine(line);
              }}
              onMouseEnter={(e) =>
                showTooltip(
                  e,
                  city === "Toronto" && line === "805"
                    ? "Line 5 Eglinton - Under Construction (route data from OpenStreetMap)"
                    : getLineInfo(line, city) || "",
                )
              }
              onMouseLeave={hideTooltip}
            >
              {city === "Toronto" ? (
                <>
                  <span className="toronto-line-number">
                    {line === "805" || line === "806"
                      ? TORONTO_STREETCAR_LINE_INFO[
                          line as TorontoStreetcarLine
                        ]?.letter
                      : line}
                  </span>
                  <span className="toronto-line-corridor">
                    {
                      TORONTO_STREETCAR_LINE_INFO[line as TorontoStreetcarLine]
                        ?.corridor
                    }
                    {line === "805" ? " 🚧" : ""}
                  </span>
                </>
              ) : (
                getLineLabel(line, city)
              )}
            </button>
          ))}
        </div>
        <div className="route-lines-section">
          <div className="route-lines-toggle">
            <label>
              <input
                type="checkbox"
                checked={showRouteLines}
                onChange={(e) => setShowRouteLines(e.target.checked)}
              />
              Show route lines
            </label>
          </div>
          <div
            className={`route-line-mode-toggle ${!showRouteLines ? "disabled" : ""}`}
          >
            <button
              className={`route-mode-btn ${
                routeLineMode === "byLine" ? "active" : ""
              }`}
              onClick={() => setRouteLineMode("byLine")}
              disabled={!showRouteLines}
            >
              By Line
            </button>
            {city === "Toronto" ||
            city === "Pittsburgh" ||
            city === "Baltimore" ||
            city === "Phoenix" ||
            city === "Cleveland" ? (
              <button
                className="route-mode-btn"
                style={{ opacity: 0.4, cursor: "not-allowed" }}
                disabled
                onMouseEnter={(e) =>
                  showTooltip(
                    e,
                    "Speed limit data is not available for this city",
                  )
                }
                onMouseLeave={hideTooltip}
              >
                Speed Limit
              </button>
            ) : (
              <button
                className={`route-mode-btn ${
                  routeLineMode === "bySpeedLimit" ? "active" : ""
                }`}
                onClick={() => setRouteLineMode("bySpeedLimit")}
                disabled={!showRouteLines}
              >
                Speed Limit
              </button>
            )}
            <button
              className={`route-mode-btn ${
                routeLineMode === "bySeparation" ? "active" : ""
              }`}
              onClick={() => setRouteLineMode("bySeparation")}
              disabled={!showRouteLines}
            >
              Grade Sep.
            </button>
          </div>
        </div>
        <div className="control-label" style={{ marginTop: 8 }}>
          Regional & Metro Overlay
        </div>
        <div className="route-lines-toggle">
          <label>
            <input
              type="checkbox"
              checked={showRailContextHeavy}
              onChange={(e) => setShowRailContextHeavy(e.target.checked)}
            />
            Metro / Subway ({railContextHeavyCount})
          </label>
        </div>
        <div className="route-lines-toggle">
          <label>
            <input
              type="checkbox"
              checked={showRailContextCommuter}
              onChange={(e) => setShowRailContextCommuter(e.target.checked)}
            />
            Regional / Commuter rail ({railContextCommuterCount})
          </label>
        </div>
        {(city === "SF" ||
          city === "LA" ||
          city === "Baltimore" ||
          city === "Boston" ||
          city === "Toronto" ||
          city === "Denver" ||
          city === "Portland" ||
          city === "San Diego" ||
          city === "San Jose" ||
          city === "Seattle" ||
          city === "Philadelphia" ||
          city === "Minneapolis" ||
          city === "Phoenix" ||
          city === "Salt Lake City" ||
          city === "Charlotte" ||
          city === "Cleveland" ||
          city === "Pittsburgh") && (
          <div className="route-lines-toggle">
            <label>
              <input
                type="checkbox"
                checked={showBusRoutesOverlay}
                onChange={(e) => setShowBusRoutesOverlay(e.target.checked)}
              />
              Bus routes ({busRoutesOverlayCount})
            </label>
          </div>
        )}
      </CollapsibleSection>

      {/* Infrastructure */}
      <CollapsibleSection
        title="Infrastructure"
        isExpanded={sections.infrastructure}
        onToggle={() =>
          setSections((s) => ({ ...s, infrastructure: !s.infrastructure }))
        }
      >
        <div className="route-lines-toggle">
          <label>
            <input
              type="checkbox"
              checked={showStops}
              onChange={(e) => setShowStops(e.target.checked)}
            />
            Show stations ◆
          </label>
        </div>
        <div className="route-lines-toggle">
          {city === "Philadelphia" || city === "Toronto" ? (
            <label
              style={{ opacity: 0.5, cursor: "not-allowed" }}
              onMouseEnter={(e) =>
                showTooltip(
                  e,
                  "Grade crossing data is not available for this city",
                )
              }
              onMouseLeave={hideTooltip}
            >
              <input type="checkbox" checked={false} disabled />
              Show grade crossings <span style={{ color: "#ff9500" }}>✕</span>
            </label>
          ) : (
            <label>
              <input
                type="checkbox"
                checked={showCrossings}
                onChange={(e) => setShowCrossings(e.target.checked)}
              />
              Show grade crossings <span style={{ color: "#ff9500" }}>✕</span>
            </label>
          )}
        </div>
        <div className="route-lines-toggle">
          <label>
            <input
              type="checkbox"
              checked={showTrafficLights}
              onChange={(e) => setShowTrafficLights(e.target.checked)}
            />
            Show traffic lights 🚦
            <span
              className="speed-by-line-info-icon"
              onMouseEnter={(e) =>
                showTooltip(
                  e,
                  "Shows intersections where trains obey traffic signals. Gate-protected crossings excluded.",
                )
              }
              onMouseLeave={hideTooltip}
            >
              ⓘ
            </span>
          </label>
        </div>
        <div className="route-lines-toggle">
          <label>
            <input
              type="checkbox"
              checked={showSwitches}
              onChange={(e) => setShowSwitches(e.target.checked)}
            />
            Show track switches <span style={{ color: "#00d4ff" }}>Y</span>
          </label>
        </div>
      </CollapsibleSection>

      {/* Reset All Filters */}
      <button
        className="reset-filter-btn"
        onClick={() => {
          setSpeedFilter({ minSpeed: 0, maxSpeed: 50, showNoData: true });
          setSelectedLines([...allLines] as string[]);
          setShowRouteLines(true);
          setRouteLineMode("byLine");
          setShowStops(false);
          setShowCrossings(false);
          setShowTrafficLights(false);
          setShowSwitches(false);
          setShowRailContextHeavy(false);
          setShowRailContextCommuter(false);
          setShowBusRoutesOverlay(false);
          setHideStoppedTrains(false);
          setHideAllTrains(false);
          onResetPopulationDensity?.();
        }}
      >
        Reset All Filters
      </button>

      {/* Line Statistics */}
      {lineStats.length > 0 && (
        <div className="control-group">
          <div className="control-label">
            Speed by Line (<span className="unit-text">{unitLabel}</span>)
            <span
              className="speed-by-line-info-icon"
              onMouseEnter={(e) =>
                showTooltip(
                  e,
                  "Excludes vehicles under 0.5 mph (stopped trains, yards) to reflect operational speeds.",
                )
              }
              onMouseLeave={hideTooltip}
            >
              ⓘ
            </span>
          </div>
          <div className="line-stats">
            {[...lineStats]
              .sort((a, b) => b.avgSpeed - a.avgSpeed)
              .map((stat) => (
                <div key={stat.line} className="line-stat-item">
                  <span
                    className={`line-stat-badge ${getBadgeWidthClass(city)}`}
                    style={{ backgroundColor: getLineColor(stat.line, city) }}
                    onMouseEnter={(e) =>
                      showTooltip(e, getLineInfo(stat.line, city) || "")
                    }
                    onMouseLeave={hideTooltip}
                  >
                    {getLineLabel(stat.line, city)}
                  </span>
                  <span className="line-stat-speed">
                    {convertSpeed(stat.avgSpeed).toFixed(1)}
                  </span>
                  <span className="line-stat-label">avg</span>
                  <span className="line-stat-speed">
                    {convertSpeed(stat.medianSpeed).toFixed(1)}
                  </span>
                  <span className="line-stat-label">median</span>
                  <span className="line-stat-count">
                    ({stat.count.toLocaleString()})
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Info */}
      <div className="info-section">
        <p className="data-attribution">
          Grade crossing, switch, speed limit, grade separation, and traffic
          light data from{" "}
          <a
            href="https://www.openrailwaymap.org/"
            target="_blank"
            rel="noopener noreferrer"
          >
            OpenRailwayMap
          </a>{" "}
          (OpenStreetMap)
        </p>
        <p className="data-attribution">
          Train speed/location data from{" "}
          {city === "SF" ? (
            <a
              href="https://511.org/open-data"
              target="_blank"
              rel="noopener noreferrer"
            >
              511.org
            </a>
          ) : city === "LA" ? (
            <a
              href="https://developer.metro.net/"
              target="_blank"
              rel="noopener noreferrer"
            >
              LA Metro API
            </a>
          ) : city === "Seattle" ? (
            <a
              href="https://www.soundtransit.org/help-contacts/business-information/open-transit-data-otd"
              target="_blank"
              rel="noopener noreferrer"
            >
              Sound Transit Open Transit Data
            </a>
          ) : city === "Boston" ? (
            <a
              href="https://api-v3.mbta.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              MBTA V3 API
            </a>
          ) : city === "Portland" ? (
            <a
              href="https://developer.trimet.org/"
              target="_blank"
              rel="noopener noreferrer"
            >
              TriMet API
            </a>
          ) : city === "San Diego" ? (
            <a
              href="https://www.sdmts.com/business-center/app-developers"
              target="_blank"
              rel="noopener noreferrer"
            >
              MTS OneBusAway API
            </a>
          ) : city === "Toronto" ? (
            <a
              href="https://gtfsrt.ttc.ca/"
              target="_blank"
              rel="noopener noreferrer"
            >
              TTC GTFS-RT
            </a>
          ) : city === "Philadelphia" ? (
            <a
              href="https://www3.septa.org/developer/"
              target="_blank"
              rel="noopener noreferrer"
            >
              SEPTA API
            </a>
          ) : city === "Pittsburgh" ? (
            <a
              href="https://www.rideprt.org/business-center/developer-resources/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Pittsburgh Regional Transit API
            </a>
          ) : city === "Minneapolis" ? (
            <a
              href="https://svc.metrotransit.org/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Metro Transit API
            </a>
          ) : city === "Denver" ? (
            <a
              href="https://www.rtd-denver.com/open-records/open-spatial-information"
              target="_blank"
              rel="noopener noreferrer"
            >
              RTD GTFS-RT
            </a>
          ) : city === "Salt Lake City" ? (
            <a
              href="https://maps.rideuta.com/portal/apps/sites/#/uta-open-data"
              target="_blank"
              rel="noopener noreferrer"
            >
              UTA GTFS-RT
            </a>
          ) : city === "San Jose" ? (
            <a
              href="https://511.org/open-data/transit"
              target="_blank"
              rel="noopener noreferrer"
            >
              511.org
            </a>
          ) : city === "Baltimore" ? (
            <a
              href="https://www.mta.maryland.gov/developer-resources"
              target="_blank"
              rel="noopener noreferrer"
            >
              MTA Maryland Developer Resources
            </a>
          ) : city === "Cleveland" ? (
            <a
              href="https://riderta.com/developers"
              target="_blank"
              rel="noopener noreferrer"
            >
              RTA Developer Resources
            </a>
          ) : city === "Phoenix" ? (
            <a
              href="https://www.phoenixopendata.com/dataset/general-transit-feed-specification"
              target="_blank"
              rel="noopener noreferrer"
            >
              Valley Metro GTFS-RT (Phoenix Open Data)
            </a>
          ) : (
            <span>Transit API</span>
          )}
          {city === "Portland" || city === "Boston" ? "" : " GTFS-realtime"}
        </p>
        <p className="data-attribution">
          Population density from{" "}
          {city === "Toronto" ? (
            <a
              href="https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/index.cfm?Lang=E"
              target="_blank"
              rel="noopener noreferrer"
            >
              2021 Canadian Census
            </a>
          ) : (
            <a
              href="https://tigerweb.geo.census.gov/tigerwebmain/TIGERweb_main.html"
              target="_blank"
              rel="noopener noreferrer"
            >
              2020 US Census
            </a>
          )}{" "}
          tracts:{" "}
          {city === "Toronto"
            ? "Toronto CMA"
            : city === "SF"
              ? "San Francisco, San Mateo, Alameda counties"
              : city === "LA"
                ? "Los Angeles, Orange counties"
                : city === "Boston"
                  ? "Suffolk, Middlesex, Norfolk, Essex counties"
                  : city === "Philadelphia"
                    ? "Philadelphia, Delaware, Montgomery, Bucks, Chester (PA); Camden, Burlington, Gloucester, Mercer (NJ)"
                    : city === "Seattle"
                      ? "King, Snohomish, Pierce counties"
                      : city === "Portland"
                        ? "Multnomah, Washington, Clackamas counties"
                        : city === "San Diego"
                          ? "San Diego County"
                          : city === "Denver"
                            ? "Denver, Adams, Arapahoe, Jefferson, Douglas counties"
                            : city === "Baltimore"
                              ? "Baltimore City, Baltimore, Anne Arundel, Howard counties"
                              : city === "Pittsburgh"
                                ? "Allegheny, Washington counties"
                                : city === "Minneapolis"
                                  ? "Hennepin, Ramsey, Dakota counties"
                                  : city === "Salt Lake City"
                                    ? "Salt Lake, Davis, Weber, Utah, Box Elder counties"
                                    : city === "San Jose"
                                      ? "Santa Clara, Alameda, San Mateo counties"
                                      : city === "Phoenix"
                                        ? "Maricopa County"
                                        : city === "Cleveland"
                                          ? "Cuyahoga, Lake, Lorain counties"
                                          : city === "Charlotte"
                                            ? "Mecklenburg, Gaston, Union counties"
                                            : ""}
        </p>
        <p className="data-attribution" style={{ marginTop: "8px" }}>
          Built by Philip Hamner ·{" "}
          <a
            href="https://github.com/phamner/muni-speed-map"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </p>
      </div>

      {/* About Project Modal */}
      {showAboutModal &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="modal-overlay"
            onClick={() => setShowAboutModal(false)}
          >
            <div
              className="modal-content about-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="modal-close-icon"
                onClick={() => setShowAboutModal(false)}
                aria-label="Close about modal"
                title="Close"
              >
                ×
              </button>
              <h2>
                {ABOUT_SECTIONS.title}
                <span
                  style={{
                    fontSize: "0.5em",
                    fontWeight: 400,
                    color: "rgba(255,255,255,0.55)",
                    marginLeft: "12px",
                  }}
                >
                  Built by Philip Hamner ·{" "}
                  <a
                    href="https://github.com/phamner/muni-speed-map"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    GitHub
                  </a>
                </span>
              </h2>

              {/* Tab Navigation */}
              <div className="about-tabs">
                {ABOUT_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    className={`about-tab ${aboutActiveTab === tab.id ? "active" : ""}`}
                    onClick={() => setAboutActiveTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              <div className="about-tab-content">
                {aboutActiveTab === "overview" && (
                  <div className="about-intro">
                    {ABOUT_SECTIONS.overview.intro.map((para, i) => (
                      <p key={i}>{para}</p>
                    ))}
                    <p>{ABOUT_SECTIONS.overview.goal}</p>
                    <h3>{ABOUT_SECTIONS.overview.snapshotSummaryTitle}</h3>
                    <p>{ABOUT_SECTIONS.overview.snapshotSummary}</p>
                    <h3>{ABOUT_SECTIONS.overview.dataCollectionTitle}</h3>
                    <p>{ABOUT_SECTIONS.overview.dataCollection}</p>
                  </div>
                )}

                {aboutActiveTab === "howto" && (
                  <>
                    <p>{ABOUT_SECTIONS.howto.intro}</p>
                    <div className="about-section-block">
                      <h3>Basic Controls</h3>
                      <ul>
                        {ABOUT_SECTIONS.howto.controls.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="about-section-block">
                      <h3>View Modes</h3>
                      <ul>
                        {ABOUT_SECTIONS.howto.views.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="about-section-block">
                      <h3>Understanding Infrastructure Markers</h3>
                      <ul>
                        {ABOUT_SECTIONS.howto.infrastructureMarkers.map(
                          (item) => (
                            <li key={item}>{item}</li>
                          ),
                        )}
                      </ul>
                    </div>
                    <div className="about-section-block">
                      <h3>Tips</h3>
                      <ul>
                        {ABOUT_SECTIONS.howto.tips.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="about-section-block">
                      <h3>Platform Capabilities</h3>
                      <ul>
                        {ABOUT_SECTIONS.features.platformFeatures.map(
                          (item) => (
                            <li key={item}>{item}</li>
                          ),
                        )}
                      </ul>
                    </div>
                    <div className="about-section-block">
                      <h3>Visualizations</h3>
                      <ul>
                        {ABOUT_SECTIONS.features.visualizations.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </>
                )}

                {aboutActiveTab === "data" && (
                  <>
                    <div className="about-section-block">
                      <h3>Data Sources</h3>
                      <ul>
                        {ABOUT_SECTIONS.data.sources.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="about-section-block">
                      <h3>Population Density Overlay</h3>
                      <ul>
                        {ABOUT_SECTIONS.data.populationDensity.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="about-section-block">
                      <h3>How Segment Averages Work</h3>
                      <ul>
                        {ABOUT_SECTIONS.data.segmentAverages.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="about-section-block">
                      <h3>Speed by Line Statistics</h3>
                      <ul>
                        {ABOUT_SECTIONS.data.lineStatistics.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="about-section-block">
                      <h3>Limitations</h3>
                      <ul>
                        {ABOUT_SECTIONS.data.limitations.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </>
                )}

                {aboutActiveTab === "cities" && (
                  <div className="about-section-block">
                    <h3>City-Specific Notes</h3>
                    <ul>
                      {ABOUT_CITY_NOTES.map((cityNote) => (
                        <li key={cityNote.city}>
                          <strong>{cityNote.city}:</strong> {cityNote.note}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {aboutActiveTab === "prospective" && (
                  <>
                    <div className="about-section-block">
                      <h3>Prospective Cities I Want to Add</h3>
                      <p>{ABOUT_SECTIONS.prospective.intro}</p>
                      <p>{ABOUT_SECTIONS.prospective.outro}</p>
                      <div className="about-prospective-list">
                        {[...ABOUT_PROSPECTIVE_CITIES]
                          .sort((a, b) => a.city.localeCompare(b.city))
                          .map((item) => (
                            <div
                              key={`${item.city}-${item.system}`}
                              className="about-prospective-card"
                            >
                              <h4>
                                {item.city} <span>({item.system})</span>
                              </h4>
                              <p>{item.value}</p>
                              <p>
                                <strong>Current blocker:</strong> {item.blocker}
                              </p>
                            </div>
                          ))}
                      </div>
                    </div>
                  </>
                )}

                {aboutActiveTab === "technical" && (
                  <>
                    <div className="about-section-block">
                      <h3>Project Scope</h3>
                      <ul>
                        {ABOUT_SECTIONS.technical.scope.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="about-section-block">
                      <h3>Why Some Cities Are Excluded</h3>
                      <ul>
                        {ABOUT_SECTIONS.technical.exclusions.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="about-section-block">
                      <h3>Technology Stack</h3>
                      <ul>
                        {ABOUT_SECTIONS.technical.stack.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="about-section-block">
                      <h3>Source Code</h3>
                      <ul>
                        <li>
                          GitHub Repository:{" "}
                          <a
                            href="https://github.com/phamner/muni-speed-map"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            https://github.com/phamner/muni-speed-map
                          </a>
                        </li>
                      </ul>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Official Transit Map Modal */}
      {showTransitMapModal &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="modal-overlay"
            onClick={() => setShowTransitMapModal(false)}
          >
            <div
              className="modal-content transit-map-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="modal-close-icon"
                onClick={() => setShowTransitMapModal(false)}
                aria-label="Close transit map modal"
                title="Close"
              >
                X
              </button>
              {/* <h2>{city} Official Rail Map</h2>
            <p>
              {officialTransitMapUrl
                ? "Reference map provided by the local transit agency."
                : "No official rail map URL is configured for this city yet."}
            </p> */}
              {transitMapDisplayUrl ? (
                <>
                  {isDisplayedMapPdf ? (
                    <div className="transit-map-pdf-placeholder">
                      <p>
                        This city map is a PDF. Open it in a new tab for the
                        best viewing experience.
                      </p>
                      {transitMapSourceUrl && (
                        <p className="transit-map-source">
                          Source:{" "}
                          <a
                            className="transit-map-source-link"
                            href={transitMapSourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {transitMapSourceUrl}
                          </a>
                        </p>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="transit-map-frame">
                        <div
                          ref={transitMapViewportRef}
                          className={`transit-map-viewport ${transitMapZoom > MIN_TRANSIT_MAP_ZOOM ? "zoomed" : ""} ${isTransitMapPanning ? "is-panning" : ""}`}
                          tabIndex={0}
                          role="application"
                          aria-label="Rail map. Use scroll to zoom, drag or arrow keys to pan."
                          onWheel={handleTransitMapWheel}
                          onKeyDown={handleTransitMapKeyDown}
                          onDoubleClick={(event) =>
                            applyTransitMapZoom(
                              transitMapZoom + TRANSIT_MAP_ZOOM_STEP,
                              event.clientX,
                              event.clientY,
                            )
                          }
                          onPointerDown={handleTransitMapPointerDown}
                          onPointerMove={handleTransitMapPointerMove}
                          onPointerUp={handleTransitMapPointerUp}
                          onPointerCancel={handleTransitMapPointerUp}
                        >
                          <div
                            className="transit-map-canvas"
                            style={transitMapCanvasStyle}
                          >
                            <img
                              src={transitMapDisplayUrl}
                              alt={`${city} rail map`}
                              className="transit-map-image"
                              style={transitMapImageStyle}
                              onLoad={(event) => {
                                const imageRect =
                                  event.currentTarget.getBoundingClientRect();
                                setTransitMapBaseSize({
                                  width: imageRect.width,
                                  height: imageRect.height,
                                });
                              }}
                            />
                          </div>
                        </div>
                        <div className="transit-map-zoom-controls">
                          <div className="transit-map-zoom-buttons">
                            <button
                              type="button"
                              className="transit-map-zoom-btn"
                              onClick={() =>
                                applyTransitMapZoom(
                                  transitMapZoom - TRANSIT_MAP_BUTTON_ZOOM_STEP,
                                )
                              }
                              disabled={transitMapZoom <= MIN_TRANSIT_MAP_ZOOM}
                              aria-label="Zoom out map"
                            >
                              -
                            </button>
                            <span className="transit-map-zoom-level">
                              {Math.round(transitMapZoom * 100)}%
                            </span>
                            <button
                              type="button"
                              className="transit-map-zoom-btn"
                              onClick={() =>
                                applyTransitMapZoom(
                                  transitMapZoom + TRANSIT_MAP_BUTTON_ZOOM_STEP,
                                )
                              }
                              disabled={transitMapZoom >= MAX_TRANSIT_MAP_ZOOM}
                              aria-label="Zoom in map"
                            >
                              +
                            </button>
                            <button
                              type="button"
                              className="transit-map-zoom-reset"
                              onClick={() =>
                                applyTransitMapZoom(MIN_TRANSIT_MAP_ZOOM)
                              }
                              disabled={transitMapZoom === MIN_TRANSIT_MAP_ZOOM}
                            >
                              Reset
                            </button>
                          </div>
                        </div>
                      </div>
                      {transitMapSourceUrl && (
                        <p className="transit-map-source">
                          Source:{" "}
                          <a
                            className="transit-map-source-link"
                            href={transitMapSourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {transitMapSourceUrl}
                          </a>
                        </p>
                      )}
                    </>
                  )}
                </>
              ) : (
                <div className="transit-map-empty">
                  Add this city to <code>OFFICIAL_TRANSIT_MAP_URLS</code> in{" "}
                  <code>src/components/Controls.tsx</code>.
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
      {tooltip && (
        <div
          className="speed-info-tooltip"
          style={{
            position: "fixed",
            left: tooltip.x,
            top: tooltip.y,
          }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
