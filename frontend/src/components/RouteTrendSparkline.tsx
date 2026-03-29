import type { RouteRiskHistoryPoint } from "../types/risk";

type RouteTrendSparklineProps = {
  points: RouteRiskHistoryPoint[];
  width?: number;
  height?: number;
  stroke?: string;
};

export default function RouteTrendSparkline({
  points,
  width = 150,
  height = 36,
  stroke = "#d4a030",
}: RouteTrendSparklineProps) {
  if (!Array.isArray(points) || points.length < 2) {
    return (
      <div className="text-[10px] mono" style={{ color: "rgba(122,106,78,1)" }}>
        Trend unavailable
      </div>
    );
  }

  const values = points
    .map((point) => Number(point.final_risk_percentage))
    .filter((value) => Number.isFinite(value));
  if (values.length < 2) {
    return (
      <div className="text-[10px] mono" style={{ color: "rgba(122,106,78,1)" }}>
        Trend unavailable
      </div>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 2;
  const span = Math.max(1, max - min);
  const xStep = (width - pad * 2) / Math.max(1, values.length - 1);
  const path = values
    .map((value, index) => {
      const x = pad + index * xStep;
      const y = pad + (height - pad * 2) * (1 - (value - min) / span);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
