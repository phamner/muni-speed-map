import { useEffect, useState } from "react";
import { fetchRidershipData, type RidershipData } from "../lib/supabase";
import "./RidershipModal.css";

interface RidershipModalProps {
  isOpen: boolean;
  onClose: () => void;
  city: string;
  agency: string;
}

type MetricMode = "absolute" | "indexed" | "perMile";

export default function RidershipModal({
  isOpen,
  onClose,
  city,
  agency,
}: RidershipModalProps) {
  const [data, setData] = useState<RidershipData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metricMode, setMetricMode] = useState<MetricMode>("absolute");

  useEffect(() => {
    if (isOpen && agency) {
      loadData();
    }
  }, [isOpen, agency]);

  async function loadData() {
    try {
      setLoading(true);
      setError(null);
      const ridershipData = await fetchRidershipData(agency);
      setData(ridershipData);
    } catch (err) {
      setError("Failed to load ridership data");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) return null;

  const latestData = data[data.length - 1];
  const routeMiles = 71.5; // SF Muni light rail route miles (static for now)

  // Calculate 2019 baseline for indexed mode
  const data2019 = data.filter((d) => d.year === 2019);
  const avg2019 =
    data2019.length > 0
      ? data2019.reduce((sum, d) => sum + d.ridership, 0) / data2019.length
      : 1;

  const getMetricValue = (record: RidershipData) => {
    switch (metricMode) {
      case "absolute":
        return record.ridership;
      case "indexed":
        return (record.ridership / avg2019) * 100;
      case "perMile":
        return record.ridership / routeMiles;
      default:
        return record.ridership;
    }
  };

  const getMetricLabel = () => {
    switch (metricMode) {
      case "absolute":
        return "Monthly Ridership";
      case "indexed":
        return "Indexed (2019 = 100)";
      case "perMile":
        return "Riders per Route Mile";
      default:
        return "Monthly Ridership";
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content ridership-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose}>
          ×
        </button>

        <h2>Ridership - {city}</h2>

        {loading && <div className="loading">Loading ridership data...</div>}

        {error && <div className="error">{error}</div>}

        {!loading && !error && data.length > 0 && (
          <>
            <div className="metric-toggle">
              <button
                className={metricMode === "absolute" ? "active" : ""}
                onClick={() => setMetricMode("absolute")}
              >
                Absolute Riders
              </button>
              <button
                className={metricMode === "indexed" ? "active" : ""}
                onClick={() => setMetricMode("indexed")}
              >
                Indexed (2019 = 100)
              </button>
              <button
                className={metricMode === "perMile" ? "active" : ""}
                onClick={() => setMetricMode("perMile")}
              >
                Riders per Route Mile
              </button>
            </div>

            <div className="ridership-content">
              <div className="chart-container">
                <h3>{getMetricLabel()}</h3>
                <div className="line-chart">
                  <svg
                    viewBox="0 0 1000 400"
                    preserveAspectRatio="xMidYMid meet"
                  >
                    {/* Grid lines */}
                    {[0, 1, 2, 3, 4].map((i) => (
                      <line
                        key={`grid-${i}`}
                        x1="50"
                        y1={50 + i * 75}
                        x2="950"
                        y2={50 + i * 75}
                        className="chart-grid"
                      />
                    ))}

                    {/* Axes */}
                    <line
                      x1="50"
                      y1="50"
                      x2="50"
                      y2="350"
                      className="chart-axis"
                    />
                    <line
                      x1="50"
                      y1="350"
                      x2="950"
                      y2="350"
                      className="chart-axis"
                    />

                    {/* Y-axis labels */}
                    {(() => {
                      const values = data.map(getMetricValue);
                      const maxValue = Math.max(...values);
                      const minValue = Math.min(...values);
                      const range = maxValue - minValue;

                      return [0, 1, 2, 3, 4].map((i) => {
                        const value = maxValue - (i * range) / 4;
                        const displayValue =
                          metricMode === "absolute"
                            ? (value / 1000).toFixed(0) + "K"
                            : metricMode === "indexed"
                              ? value.toFixed(0)
                              : (value / 1000).toFixed(0) + "K";

                        return (
                          <text
                            key={`y-label-${i}`}
                            x="40"
                            y={55 + i * 75}
                            textAnchor="end"
                            className="chart-axis-label"
                          >
                            {displayValue}
                          </text>
                        );
                      });
                    })()}

                    {/* X-axis labels (every 12 months) */}
                    {data
                      .filter((_, i) => i % 12 === 0)
                      .map((record, i) => {
                        const index = data.findIndex((d) => d === record);
                        const x = 50 + (index / (data.length - 1)) * 900;
                        return (
                          <text
                            key={`x-label-${i}`}
                            x={x}
                            y="370"
                            textAnchor="middle"
                            className="chart-axis-label"
                          >
                            {record.year}
                          </text>
                        );
                      })}

                    {/* Line path */}
                    <path
                      d={(() => {
                        const values = data.map(getMetricValue);
                        const maxValue = Math.max(...values);
                        const minValue = Math.min(...values);
                        const range = maxValue - minValue || 1;

                        return data
                          .map((record, i) => {
                            const x = 50 + (i / (data.length - 1)) * 900;
                            const value = getMetricValue(record);
                            const y = 350 - ((value - minValue) / range) * 300;
                            return `${i === 0 ? "M" : "L"} ${x} ${y}`;
                          })
                          .join(" ");
                      })()}
                      className="chart-line"
                    />

                    {/* Data points */}
                    {data.map((record, i) => {
                      const values = data.map(getMetricValue);
                      const maxValue = Math.max(...values);
                      const minValue = Math.min(...values);
                      const range = maxValue - minValue || 1;
                      const value = getMetricValue(record);
                      const x = 50 + (i / (data.length - 1)) * 900;
                      const y = 350 - ((value - minValue) / range) * 300;
                      const displayValue =
                        metricMode === "absolute"
                          ? value.toLocaleString()
                          : metricMode === "indexed"
                            ? value.toFixed(1)
                            : Math.round(value).toLocaleString();

                      return (
                        <circle
                          key={i}
                          cx={x}
                          cy={y}
                          r="3"
                          className="chart-dot"
                        >
                          <title>
                            {record.month} {record.year}: {displayValue}
                          </title>
                        </circle>
                      );
                    })}
                  </svg>
                </div>
              </div>

              <div className="summary-sidebar">
                <div className="summary-block">
                  <h3>System Summary</h3>
                  <div className="summary-grid">
                    <div className="summary-item">
                      <span className="label">Route Miles</span>
                      <span className="value">{routeMiles}</span>
                    </div>
                    <div className="summary-item">
                      <span className="label">Latest Month</span>
                      <span className="value">
                        {latestData.month} {latestData.year}
                      </span>
                    </div>
                    <div className="summary-item">
                      <span className="label">Latest Ridership</span>
                      <span className="value">
                        {latestData.ridership.toLocaleString()}
                      </span>
                    </div>
                    <div className="summary-item">
                      <span className="label">Riders per Mile</span>
                      <span className="value">
                        {Math.round(
                          latestData.ridership / routeMiles,
                        ).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <div className="data-source">
                    Data source: National Transit Database (NTD)
                    <br />
                    Last updated: {latestData.month} {latestData.year}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
