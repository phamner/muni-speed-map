import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type { City } from "../../types";
import type { SpeedUnit, DensityMode } from "../../App";

const GRADE_SEPARATION_TOOLTIP = `Classifies how rail tracks interact with surrounding streets and traffic.
• Tunnel / Trench: Tracks run underground or below street level.
• Elevated: Tracks run above street level on viaducts or elevated structures.
• Separated At-Grade: Tracks run at street level but on a dedicated right-of-way separated from cars.
• Mixed Traffic: Tracks run directly in street lanes with car traffic.
• Unknown: Infrastructure type not identified in available data.`;

interface SpeedLegendProps {
  speedUnit: SpeedUnit;
}

export function SpeedLegend({ speedUnit }: SpeedLegendProps) {
  return (
    <div className="map-speed-legend">
      <div className="map-speed-legend-title">
        Speed ({speedUnit === "kmh" ? "km/h" : "mph"})
      </div>
      <div className="map-speed-legend-grid">
        <div className="map-speed-legend-item">
          <span
            className="map-speed-dot"
            style={{ backgroundColor: "#9b2d6b" }}
          ></span>
          <span>≤ {speedUnit === "kmh" ? 8 : 5}</span>
        </div>
        <div className="map-speed-legend-item">
          <span
            className="map-speed-dot"
            style={{ backgroundColor: "#88ff33" }}
          ></span>
          <span>{speedUnit === "kmh" ? "40-56" : "25-35"}</span>
        </div>
        <div className="map-speed-legend-item">
          <span
            className="map-speed-dot"
            style={{ backgroundColor: "#ff3333" }}
          ></span>
          <span>{speedUnit === "kmh" ? "8-16" : "5-10"}</span>
        </div>
        <div className="map-speed-legend-item">
          <span
            className="map-speed-dot"
            style={{ backgroundColor: "#33eebb" }}
          ></span>
          <span>{speedUnit === "kmh" ? "56-80" : "35-50"}</span>
        </div>
        <div className="map-speed-legend-item">
          <span
            className="map-speed-dot"
            style={{ backgroundColor: "#ff9933" }}
          ></span>
          <span>{speedUnit === "kmh" ? "16-24" : "10-15"}</span>
        </div>
        <div className="map-speed-legend-item">
          <span
            className="map-speed-dot"
            style={{ backgroundColor: "#22ccff" }}
          ></span>
          <span>&gt; {speedUnit === "kmh" ? 80 : 50}</span>
        </div>
        <div className="map-speed-legend-item">
          <span
            className="map-speed-dot"
            style={{ backgroundColor: "#ffdd33" }}
          ></span>
          <span>{speedUnit === "kmh" ? "24-40" : "15-25"}</span>
        </div>
        <div className="map-speed-legend-item">
          <span
            className="map-speed-dot"
            style={{ backgroundColor: "#666666" }}
          ></span>
          <span>No data</span>
        </div>
      </div>
    </div>
  );
}

export function SeparationLegend() {
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTouchTooltipMode = () =>
    typeof window !== "undefined" &&
    window.matchMedia("(hover: none), (pointer: coarse)").matches;

  const showTooltip = (e: React.MouseEvent) => {
    const x = e.clientX + 12;
    const y = e.clientY + 12;
    tooltipTimer.current = setTimeout(() => setTooltip({ x, y }), 500);
  };
  const toggleTouchTooltip = (e: {
    currentTarget: EventTarget & HTMLElement;
    preventDefault: () => void;
    stopPropagation: () => void;
  }) => {
    if (!isTouchTooltipMode()) return;
    e.preventDefault();
    e.stopPropagation();
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    tooltipTimer.current = null;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.bottom + 12;
    setTooltip((current) => (current ? null : { x, y }));
  };
  const hideTooltip = () => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    tooltipTimer.current = null;
    setTooltip(null);
  };
  useEffect(() => {
    if (!tooltip || !isTouchTooltipMode()) return;
    const dismissTooltip = () => setTooltip(null);
    document.addEventListener("pointerdown", dismissTooltip);
    return () => {
      document.removeEventListener("pointerdown", dismissTooltip);
    };
  }, [tooltip]);

  return (
    <div className="map-separation-legend">
      <div className="map-separation-legend-title-row">
        <span className="map-separation-legend-title">Grade Separation</span>
        <span
          className="speed-by-line-info-icon map-separation-legend-info"
          onMouseEnter={showTooltip}
          onClick={toggleTouchTooltip}
          onMouseLeave={hideTooltip}
        >
          ⓘ
        </span>
      </div>
      {tooltip &&
        createPortal(
          <div
            className="speed-info-tooltip map-separation-tooltip"
            style={{
              position: "fixed",
              left: tooltip.x,
              top: tooltip.y,
              zIndex: 2147483647,
            }}
          >
            {GRADE_SEPARATION_TOOLTIP}
          </div>,
          document.body,
        )}
      <div className="separation-legend-item">
        <span
          className="separation-legend-line"
          style={{ backgroundColor: "#3b82f6" }}
        ></span>
        <span>Tunnel / Trench</span>
      </div>
      <div className="separation-legend-item">
        <span
          className="separation-legend-line"
          style={{ backgroundColor: "#22c55e" }}
        ></span>
        <span>Elevated</span>
      </div>
      <div className="separation-legend-item">
        <span
          className="separation-legend-line"
          style={{ backgroundColor: "#eab308" }}
        ></span>
        <span>Separated At-Grade</span>
      </div>
      <div className="separation-legend-item">
        <span
          className="separation-legend-line"
          style={{ backgroundColor: "#ef4444" }}
        ></span>
        <span>Mixed Traffic</span>
      </div>
      <div className="separation-legend-item">
        <span
          className="separation-legend-line"
          style={{ backgroundColor: "#6b7280" }}
        ></span>
        <span>Unknown</span>
      </div>
    </div>
  );
}

interface DensityLegendProps {
  mode: DensityMode;
  onModeChange?: (mode: DensityMode) => void;
  city: City;
}

const POP_LEGEND = [
  { color: "#2a5a5a", label: "< 5k" },
  { color: "#5a9a5a", label: "5-12k" },
  { color: "#aacc44", label: "12-18k" },
  { color: "#ffcc00", label: "18-28k" },
  { color: "#ff6600", label: "28-45k" },
  { color: "#ff0066", label: "> 45k" },
];

const JOB_LEGEND = [
  { color: "#1a2a5a", label: "< 1.5k" },
  { color: "#2a3a8a", label: "1.5-3k" },
  { color: "#4a4aaa", label: "3-6k" },
  { color: "#7a5ab0", label: "6-12k" },
  { color: "#bb55aa", label: "12-25k" },
  { color: "#ee5566", label: "25-50k" },
  { color: "#ff3333", label: "> 50k" },
];

const TRANSIT_LEGEND = [
  { color: "#1a3848", label: "< 2%" },
  { color: "#1a6a6a", label: "2-5%" },
  { color: "#22aaaa", label: "5-10%" },
  { color: "#44cccc", label: "10-20%" },
  { color: "#88eeee", label: "20-35%" },
  { color: "#ccffff", label: "> 35%" },
];

export function DensityLegend({ mode, onModeChange, city }: DensityLegendProps) {
  const items = mode === "jobs" ? JOB_LEGEND : mode === "transit" ? TRANSIT_LEGEND : POP_LEGEND;
  const unitLabel = mode === "jobs" ? "jobs/km²" : mode === "transit" ? "% transit commute" : "people/km²";
  const noData = (mode === "jobs" || mode === "transit") && city === "Toronto";

  return (
    <div className="map-density-legend">
      <div className="density-mode-toggle">
        <button
          className={`density-mode-btn ${mode === "population" ? "active" : ""}`}
          onClick={() => onModeChange?.("population")}
        >
          Pop.
        </button>
        <button
          className={`density-mode-btn ${mode === "jobs" ? "active" : ""}`}
          onClick={() => onModeChange?.("jobs")}
        >
          Jobs
        </button>
        <button
          className={`density-mode-btn ${mode === "transit" ? "active" : ""}`}
          onClick={() => onModeChange?.("transit")}
        >
          Transit Use
        </button>
      </div>
      {noData ? (
        <div className="density-no-data">Not available for Toronto</div>
      ) : (
        <>
          <div className="map-density-legend-title">{unitLabel}</div>
          <div className="map-density-legend-scale">
            {items.map((item) => (
              <div className="density-legend-item" key={item.label}>
                <span
                  className="density-legend-swatch"
                  style={{ backgroundColor: item.color }}
                ></span>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

interface DynamicLegendsProps {
  city: City;
  showCrossings: boolean;
  showRailContextHeavy: boolean;
  showRailContextCommuter: boolean;
  showBusRoutesOverlay: boolean;
}

export function DynamicLegends({
  city,
  showCrossings,
  showRailContextHeavy,
  showRailContextCommuter,
  showBusRoutesOverlay,
}: DynamicLegendsProps) {
  const showCrossingLegend =
    false &&
    (showCrossings &&
      ["LA", "San Diego", "Salt Lake City", "Charlotte"].includes(city));
  const showRailContextLegend =
    showRailContextHeavy || showRailContextCommuter || showBusRoutesOverlay;

  if (!showCrossingLegend && !showRailContextLegend) return null;

  return (
    <div className="map-dynamic-legends">
      {showCrossingLegend && (
        <div className="crossing-gate-legend-inline">
          <div className="dynamic-legend-title">Grade Crossings</div>
          <div className="crossing-legend-items">
            <div className="crossing-legend-item">
              <span className="crossing-x other">✕</span>
              <span>Street-level crossing</span>
            </div>
          </div>
        </div>
      )}

      {showRailContextLegend && (
        <div className="rail-context-legend-inline">
          <div className="dynamic-legend-title">Regional & Metro Overlay</div>
          <div
            className={`rail-context-legend-item ${
              showRailContextHeavy ? "" : "disabled"
            }`}
          >
            <span className="rail-context-legend-line heavy"></span>
            <span>Metro / Subway</span>
          </div>
          <div
            className={`rail-context-legend-item ${
              showRailContextCommuter ? "" : "disabled"
            }`}
          >
            <span className="rail-context-legend-line commuter"></span>
            <span>Regional / Commuter</span>
          </div>
          <div
            className={`rail-context-legend-item ${
              showBusRoutesOverlay ? "" : "disabled"
            }`}
          >
            <span
              className="rail-context-legend-line"
              style={{
                borderTopColor: "#ffd34d",
                borderTopWidth: 2,
                borderTopStyle: "solid",
                opacity: 0.9,
              }}
            ></span>
            <span>Bus routes</span>
          </div>
        </div>
      )}
    </div>
  );
}
