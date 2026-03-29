import type { AlertItem, ThemeColors, Tier } from "../types/risk";

type AlertsPanelProps = {
  T: ThemeColors;
  TIER_COLOR: Record<Tier, string>;
  sidebarAlerts: AlertItem[];
  pagedAlerts: AlertItem[];
  alertStartIndex: number;
  alertEndIndex: number;
  currentAlertPage: number;
  totalAlertPages: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  onAlertClick: (alert: AlertItem) => void;
};

export default function AlertsPanel({
  T,
  TIER_COLOR,
  sidebarAlerts,
  pagedAlerts,
  alertStartIndex,
  alertEndIndex,
  currentAlertPage,
  totalAlertPages,
  onPrevPage,
  onNextPage,
  onAlertClick,
}: AlertsPanelProps) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div
        className="px-3 py-2 flex items-center justify-between sticky top-0 z-10"
        style={{ background: T.surface, borderBottom: `1px solid ${T.border}` }}
      >
        <span className="text-xs mono" style={{ color: T.textDim }}>
          {sidebarAlerts.length === 0
            ? "0 alerts"
            : `${alertStartIndex + 1}-${alertEndIndex} of ${sidebarAlerts.length}`}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onPrevPage}
            disabled={currentAlertPage === 0}
            className="px-2 py-0.5 text-xs rounded"
            style={{
              color: currentAlertPage === 0 ? T.textDim : T.text,
              border: `1px solid ${T.border}`,
              opacity: currentAlertPage === 0 ? 0.45 : 1,
            }}
          >
            Prev
          </button>
          <button
            onClick={onNextPage}
            disabled={currentAlertPage >= totalAlertPages - 1}
            className="px-2 py-0.5 text-xs rounded"
            style={{
              color: currentAlertPage >= totalAlertPages - 1 ? T.textDim : T.text,
              border: `1px solid ${T.border}`,
              opacity: currentAlertPage >= totalAlertPages - 1 ? 0.45 : 1,
            }}
          >
            Next
          </button>
        </div>
      </div>
      {pagedAlerts.map((a) => (
        <div
          key={a.id}
          onClick={() => onAlertClick(a)}
          className="px-3 py-2.5 cursor-pointer transition-all hover:bg-white/5 flex gap-2"
          style={{ borderBottom: `1px solid ${T.border}` }}
        >
          <div
            className="w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0"
            style={{ background: TIER_COLOR[a.tier] }}
          />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold mb-0.5" style={{ color: TIER_COLOR[a.tier] }}>
              {a.region}
            </div>
            <div className="text-xs leading-snug" style={{ color: T.textMid }}>
              {a.msg}
            </div>
            <div className="text-xs mt-1" style={{ color: T.textDim }}>
              {a.time}
            </div>
            {a.url && (
              <a
                href={a.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs mt-1 inline-block underline-offset-2 hover:underline"
                style={{ color: T.gold }}
                onClick={(event) => event.stopPropagation()}
              >
                Open source
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
