export type Tier = "red" | "yellow" | "green";

export type ThemeColors = {
  bg: string;
  surface: string;
  panel: string;
  border: string;
  borderHi: string;
  gold: string;
  goldDim: string;
  goldFaint: string;
  text: string;
  textDim: string;
  textMid: string;
  red: string;
  yellow: string;
  green: string;
};

export type RiskDriver = {
  eventType?: string;
  severity?: number;
  confidence?: number;
  impactScore?: number;
  weightedImpact?: number;
  reason?: string;
  title?: string | null;
  url?: string | null;
  publishedAt?: string | null;
  impactDirection?: "up" | "down";
  sourceReliability?: number;
  modelExplanation?: string | null;
};

export type RouteItem = {
  id: number;
  laneId: number;
  laneType: string;
  distanceKm: number;
  originPortName?: string | null;
  destPortName?: string | null;
  routeName?: string | null;
  points?: Array<{ lat: number; lng: number }>;
  baseRiskPercentage?: number;
  riskPercentage?: number;
  riskDelta?: number;
  riskDrivers?: RiskDriver[];
  riskSnapshotAt?: string | null;
  riskExplanation?: string | null;
  riskModelVersion?: string | null;
  criticalPortExposure?: boolean;
  criticalPorts?: string[];
  noSaferRouteMessage?: string | null;
  recommendedRoute?: {
    routeId: number;
    routeName?: string | null;
    laneType?: string;
    distanceKm?: number;
    riskPercentage?: number;
    riskImprovement?: number;
    reason?: string;
    confidence?: number | null;
    source?: "gemini" | "heuristic" | "demo";
    points?: Array<{ lat: number; lng: number }>;
  } | null;
};

export type AlertItem = {
  id: string | number;
  routeId?: number | null;
  vendorId?: number | null;
  tier: Tier;
  region: string;
  msg: string;
  time: string;
  url?: string | null;
  publishedTs?: number;
};

export type RouteRiskHistoryPoint = {
  route_id: number;
  snapshot_at: string;
  base_risk_percentage: number;
  news_delta: number;
  final_risk_percentage: number;
  explanation?: string | null;
  drivers?: RiskDriver[];
  calculation_version?: string | null;
};

export type JobRunStatus = {
  id: number;
  jobName: string;
  startedAt: string;
  endedAt: string | null;
  status: "running" | "success" | "failed";
  summary: Record<string, unknown>;
  errorText: string | null;
  stale: boolean;
  staleThresholdHours: number;
};

export type NewsRiskStatusResponse = {
  ok: boolean;
  latestRun: JobRunStatus | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
};
