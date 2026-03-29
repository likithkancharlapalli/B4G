import type { RouteItem, RouteRiskHistoryPoint, ThemeColors } from "../types/risk";
import RouteTrendSparkline from "./RouteTrendSparkline";

type RouteDetailPanelProps = {
  T: ThemeColors;
  route: RouteItem | null;
  history: RouteRiskHistoryPoint[];
  formatRelativeTime: (value?: string | null) => string;
  selectedPortFocus: "origin" | "destination" | null;
  onSelectPortFocus: (focus: "origin" | "destination") => void;
  highlightedRecommendedRouteId: number | null;
  onHighlightRecommendedRoute: (routeId: number) => void;
  onClose: () => void;
};

export default function RouteDetailPanel({
  T,
  route,
  history,
  formatRelativeTime,
  selectedPortFocus,
  onSelectPortFocus,
  highlightedRecommendedRouteId,
  onHighlightRecommendedRoute,
  onClose,
}: RouteDetailPanelProps) {
  if (!route) return null;

  const risk = Number.isFinite(route.riskPercentage) ? Number(route.riskPercentage) : null;
  const baseRisk = Number.isFinite(route.baseRiskPercentage)
    ? Number(route.baseRiskPercentage)
    : risk;
  const riskDelta = Number.isFinite(route.riskDelta)
    ? Number(route.riskDelta)
    : (risk !== null && baseRisk !== null ? risk - baseRisk : 0);
  const drivers = Array.isArray(route.riskDrivers) ? route.riskDrivers : [];
  const recommendation = route.recommendedRoute ?? null;
  const updatedAgo = formatRelativeTime(route.riskSnapshotAt);
  const riskColor = risk === null ? T.textDim : risk >= 70 ? T.red : risk >= 40 ? T.yellow : T.green;

  return (
    <div
      className="absolute right-3 top-3 z-10 w-72 rounded-xl p-3"
      style={{
        background: "rgba(22,16,9,0.95)",
        border: `1px solid ${T.borderHi}`,
        backdropFilter: "blur(14px)",
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs heading" style={{ color: T.gold }}>
          Route Intelligence
        </div>
        <button
          onClick={onClose}
          className="text-[10px] px-1.5 py-0.5 rounded"
          style={{ color: T.textDim, border: `1px solid ${T.border}` }}
        >
          Close
        </button>
      </div>
      <div className="text-sm font-semibold truncate" style={{ color: T.text }}>
        {route.routeName ?? `Route ${route.laneId}-${route.id}`}
      </div>
      <div className="text-xs mt-0.5" style={{ color: T.textDim }}>
        {route.laneType} · {Number(route.distanceKm ?? 0).toFixed(1)} km
      </div>
      <div className="text-xs mono mt-2" style={{ color: T.textDim }}>
        Base {baseRisk ?? "N/A"}% {"->"} Final{" "}
        <span style={{ color: riskColor }}>{risk ?? "N/A"}%</span>
        {"  "}Δ {riskDelta > 0 ? "+" : ""}{riskDelta.toFixed(2)}
      </div>
      {updatedAgo && (
        <div className="text-[10px] mt-1" style={{ color: T.textDim }}>
          Updated {updatedAgo}
        </div>
      )}
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <button
          onClick={() => onSelectPortFocus("origin")}
          className="text-xs px-2 py-1 rounded text-left truncate"
          style={{
            color: selectedPortFocus === "origin" ? "#0e0b07" : T.text,
            background: selectedPortFocus === "origin" ? "#66d9ff" : T.panel,
            border: `1px solid ${T.border}`,
          }}
          title={route.originPortName ?? "Origin"}
        >
          O: {route.originPortName ?? "Origin"}
        </button>
        <button
          onClick={() => onSelectPortFocus("destination")}
          className="text-xs px-2 py-1 rounded text-left truncate"
          style={{
            color: selectedPortFocus === "destination" ? "#0e0b07" : T.text,
            background: selectedPortFocus === "destination" ? "#ff8ac6" : T.panel,
            border: `1px solid ${T.border}`,
          }}
          title={route.destPortName ?? "Destination"}
        >
          D: {route.destPortName ?? "Destination"}
        </button>
      </div>
      <div className="mt-2">
        <div className="text-[10px] mono mb-0.5" style={{ color: T.textDim }}>
          30-point risk trend
        </div>
        <RouteTrendSparkline points={history} stroke={riskColor} />
      </div>
      {route.criticalPortExposure && (
        <div
          className="mt-2 rounded-md p-2"
          style={{ background: "rgba(255,138,198,0.08)", border: `1px solid ${T.border}` }}
        >
          <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: T.red }}>
            Critical Port Exposure
          </div>
          <div className="text-xs mt-0.5" style={{ color: T.textMid }}>
            {route.criticalPorts?.length
              ? `At-risk ports: ${route.criticalPorts.join(", ")}`
              : "This lane currently includes at-risk ports."}
          </div>
        </div>
      )}
      {recommendation && (
        <div
          className="mt-2 rounded-md p-2"
          style={{ background: "rgba(59,193,94,0.08)", border: `1px solid ${T.green}55` }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: T.green }}>
              Safer Route Suggested
            </div>
            <button
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={{
                color: highlightedRecommendedRouteId === recommendation.routeId ? "#0e0b07" : T.text,
                background:
                  highlightedRecommendedRouteId === recommendation.routeId ? T.green : "transparent",
                border: `1px solid ${T.green}55`,
              }}
              onClick={() => onHighlightRecommendedRoute(recommendation.routeId)}
            >
              {highlightedRecommendedRouteId === recommendation.routeId ? "Highlighted" : "Highlight"}
            </button>
          </div>
          <div className="text-xs mt-0.5" style={{ color: T.text }}>
            {recommendation.routeName ?? `Route ${recommendation.routeId}`}
          </div>
          <div className="text-[11px]" style={{ color: T.textDim }}>
            Risk {recommendation.riskPercentage ?? "N/A"}%
            {Number.isFinite(recommendation.riskImprovement)
              ? ` · ${recommendation.riskImprovement}% lower`
              : ""}
            {recommendation.source === "gemini" ? " · Gemini-picked" : ""}
            {recommendation.source === "demo" ? " · Demo detour" : ""}
            {Number.isFinite(recommendation.confidence)
              ? ` · ${(Number(recommendation.confidence) * 100).toFixed(0)}% confidence`
              : ""}
          </div>
          {recommendation.reason && (
            <div className="text-[10px] mt-1" style={{ color: T.textDim }}>
              {recommendation.reason}
            </div>
          )}
        </div>
      )}
      {!recommendation && (
        <div
          className="mt-2 rounded-md p-2"
          style={{
            background: route.criticalPortExposure ? "rgba(224,82,82,0.08)" : "rgba(76,175,125,0.08)",
            border: route.criticalPortExposure ? `1px solid ${T.red}55` : `1px solid ${T.green}55`,
          }}
        >
          <div
            className="text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: route.criticalPortExposure ? T.red : T.green }}
          >
            {route.criticalPortExposure ? "No Safer Route Found" : "No Safer Route Needed"}
          </div>
          <div className="text-xs mt-0.5" style={{ color: T.textMid }}>
            {route.noSaferRouteMessage ??
              (route.criticalPortExposure
                ? "No safer route is currently available for the same origin and destination ports."
                : "This corridor is already the safest available option right now.")}
          </div>
        </div>
      )}
      {drivers.length > 0 && (
        <div className="mt-2 space-y-1">
          {drivers.slice(0, 3).map((driver, idx) => (
            <a
              key={`${route.id}-detail-driver-${idx}`}
              href={driver.url ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="block text-xs leading-snug underline-offset-2 hover:underline"
              style={{ color: T.textMid }}
              onClick={(event) => {
                if (!driver.url) event.preventDefault();
                event.stopPropagation();
              }}
            >
              {driver.title ?? driver.reason ?? "News driver"}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
