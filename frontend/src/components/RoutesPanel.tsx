import RouteTrendSparkline from "./RouteTrendSparkline";
import type {
  RouteItem,
  RouteRiskHistoryPoint,
  ThemeColors,
} from "../types/risk";

type RoutesPanelProps = {
  T: ThemeColors;
  routesByRisk: RouteItem[];
  routeStartIndex: number;
  routeEndIndex: number;
  currentRoutePage: number;
  totalRoutePages: number;
  pagedRoutes: RouteItem[];
  selectedRouteId: number | null;
  routeSearch: string;
  routeLaneFilter: string;
  routeRecencyHours: number;
  routeMinRiskFilter: number;
  riskHistoryByRoute: Record<string, RouteRiskHistoryPoint[]>;
  formatRelativeTime: (value: string) => string;
  onPrevPage: () => void;
  onNextPage: () => void;
  onSearchChange: (value: string) => void;
  onLaneFilterChange: (value: string) => void;
  onRecencyChange: (value: number) => void;
  onMinRiskChange: (value: number) => void;
  onRouteClick: (routeId: number) => void;
};

export default function RoutesPanel({
  T,
  routesByRisk,
  routeStartIndex,
  routeEndIndex,
  currentRoutePage,
  totalRoutePages,
  pagedRoutes,
  selectedRouteId,
  routeSearch,
  routeLaneFilter,
  routeRecencyHours,
  routeMinRiskFilter,
  riskHistoryByRoute,
  formatRelativeTime,
  onPrevPage,
  onNextPage,
  onSearchChange,
  onLaneFilterChange,
  onRecencyChange,
  onMinRiskChange,
  onRouteClick,
}: RoutesPanelProps) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div
        className="px-3 py-2 flex items-center justify-between sticky top-0 z-10"
        style={{ background: T.surface, borderBottom: `1px solid ${T.border}` }}
      >
        <span className="text-xs mono" style={{ color: T.textDim }}>
          {routesByRisk.length === 0
            ? "0 routes"
            : `${routeStartIndex + 1}-${routeEndIndex} of ${routesByRisk.length}`}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onPrevPage}
            disabled={currentRoutePage === 0}
            className="px-2 py-0.5 text-xs rounded"
            style={{
              color: currentRoutePage === 0 ? T.textDim : T.text,
              border: `1px solid ${T.border}`,
              opacity: currentRoutePage === 0 ? 0.45 : 1,
            }}
          >
            Prev
          </button>
          <button
            onClick={onNextPage}
            disabled={currentRoutePage >= totalRoutePages - 1}
            className="px-2 py-0.5 text-xs rounded"
            style={{
              color: currentRoutePage >= totalRoutePages - 1 ? T.textDim : T.text,
              border: `1px solid ${T.border}`,
              opacity: currentRoutePage >= totalRoutePages - 1 ? 0.45 : 1,
            }}
          >
            Next
          </button>
        </div>
      </div>
      <div className="px-3 py-2 space-y-1.5" style={{ borderBottom: `1px solid ${T.border}` }}>
        <input
          value={routeSearch}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search route or port"
          className="w-full rounded px-2 py-1 text-xs bg-transparent outline-none"
          style={{ border: `1px solid ${T.border}`, color: T.text }}
        />
        <div className="flex gap-1">
          <select
            value={routeLaneFilter}
            onChange={(event) => onLaneFilterChange(event.target.value)}
            className="flex-1 rounded px-1.5 py-1 text-xs bg-transparent outline-none"
            style={{ border: `1px solid ${T.border}`, color: T.text }}
          >
            <option value="all" style={{ background: T.surface }}>All Lanes</option>
            <option value="Major" style={{ background: T.surface }}>Major</option>
            <option value="Intermediate" style={{ background: T.surface }}>Intermediate</option>
            <option value="Minor" style={{ background: T.surface }}>Minor</option>
          </select>
          <select
            value={String(routeRecencyHours)}
            onChange={(event) => onRecencyChange(Number(event.target.value))}
            className="flex-1 rounded px-1.5 py-1 text-xs bg-transparent outline-none"
            style={{ border: `1px solid ${T.border}`, color: T.text }}
          >
            <option value="0" style={{ background: T.surface }}>Any Update</option>
            <option value="6" style={{ background: T.surface }}>{"<="} 6h</option>
            <option value="24" style={{ background: T.surface }}>{"<="} 24h</option>
            <option value="72" style={{ background: T.surface }}>{"<="} 72h</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] mono" style={{ color: T.textDim }}>
            Min Risk {routeMinRiskFilter}
          </span>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={routeMinRiskFilter}
            onChange={(event) => onMinRiskChange(Number(event.target.value))}
            className="flex-1"
          />
        </div>
      </div>
      {pagedRoutes.map((route) => {
        const risk = Number.isFinite(route.riskPercentage) ? route.riskPercentage : null;
        const baseRisk = Number.isFinite(route.baseRiskPercentage)
          ? route.baseRiskPercentage
          : risk;
        const riskDelta = Number.isFinite(route.riskDelta)
          ? route.riskDelta
          : (risk !== null && baseRisk !== null ? risk - baseRisk : 0);
        const hasDelta = Math.abs(riskDelta) > 0.01;
        const riskColor = risk === null
          ? T.textDim
          : risk >= 70
            ? T.red
            : risk >= 40
              ? T.yellow
              : T.green;
        const deltaColor = riskDelta > 0 ? T.red : riskDelta < 0 ? T.green : T.textDim;
        const drivers = Array.isArray(route.riskDrivers) ? route.riskDrivers : [];
        const isSelected = selectedRouteId === route.id;
        const updatedAgo = formatRelativeTime(route.riskSnapshotAt);
        const trendPoints = riskHistoryByRoute[String(route.id)] ?? [];

        return (
          <div
            key={route.id}
            onClick={() => onRouteClick(route.id)}
            className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-all"
            style={{
              borderBottom: `1px solid ${T.border}`,
              background: isSelected ? T.goldFaint : "transparent",
            }}
          >
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: riskColor }} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold truncate flex items-center gap-1" style={{ color: isSelected ? T.gold : T.text }}>
                <span className="truncate">
                  {route.routeName ?? `Route ${route.laneId}-${route.id}`}
                </span>
                {hasDelta && (
                  <span
                    className="px-1 py-[1px] rounded text-[9px] font-bold tracking-wide"
                    style={{ color: "#0e0b07", background: deltaColor, lineHeight: 1.2 }}
                  >
                    AI
                  </span>
                )}
              </div>
              <div className="text-xs truncate" style={{ color: T.textDim }}>
                {route.laneType} · {Number(route.distanceKm ?? 0).toFixed(1)} km
              </div>
              <div className="text-xs mono mt-0.5" style={{ color: T.textDim }}>
                Base {baseRisk ?? "N/A"}% {"->"} Final {risk ?? "N/A"}%
                {hasDelta && (
                  <span style={{ color: deltaColor }}>
                    {" "}(Δ {riskDelta > 0 ? "+" : ""}{riskDelta.toFixed(2)})
                  </span>
                )}
              </div>
              {updatedAgo && (
                <div className="text-[10px] mt-0.5" style={{ color: T.textDim }}>
                  Updated {updatedAgo}
                </div>
              )}
              {isSelected && (
                <div className="mt-1.5">
                  <div className="text-[10px] mono mb-0.5" style={{ color: T.textDim }}>
                    30-point risk trend
                  </div>
                  <RouteTrendSparkline points={trendPoints} stroke={deltaColor === T.textDim ? T.gold : deltaColor} />
                </div>
              )}
              {isSelected && drivers.length > 0 && (
                <div className="mt-1.5 space-y-1">
                  {drivers.slice(0, 2).map((driver, idx) => (
                    <a
                      key={`${route.id}-driver-${idx}`}
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
            <div className="text-right flex-shrink-0">
              <div className="text-xs font-bold mono" style={{ color: riskColor }}>
                {risk === null ? "N/A" : `${risk}%`}
              </div>
              <div className="text-xs mono" style={{ color: T.textDim }}>risk</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
