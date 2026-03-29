import "dotenv/config";
import cors from "cors";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";
import { runNewsRiskIngestion } from "./news-risk-ingest.mjs";
import {
  buildJobStatusResponse,
  buildRiskHistoryResponse,
  buildRoutesApiResponse,
  normalizeJobRun,
} from "./http-contracts.mjs";

const app = express();

app.use(cors());
app.use(express.json());

const port = Number.parseInt(process.env.PORT ?? "4000", 10);
const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ??
  process.env.SUPABASE_ANON_KEY?.trim();
const vendorsTable = process.env.SUPABASE_VENDORS_TABLE?.trim() || "vendors";
const alertsTable = process.env.SUPABASE_ALERTS_TABLE?.trim() || "alerts";
const portsTable = process.env.SUPABASE_PORTS_TABLE?.trim() || "ports";
const routesTable = process.env.SUPABASE_ROUTES_TABLE?.trim() || "routes";
const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
const geminiModel = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
const geminiRouteOptimizerEnabled =
  String(process.env.GEMINI_ROUTE_OPTIMIZER_ENABLED ?? "true").toLowerCase() !== "false" &&
  Boolean(geminiApiKey);
const geminiTimeoutMs = Math.max(
  1000,
  Number.parseInt(process.env.GEMINI_TIMEOUT_MS ?? "6000", 10),
);
const geminiMaxCandidates = Math.max(
  2,
  Number.parseInt(process.env.GEMINI_MAX_CANDIDATES ?? "6", 10),
);
const geminiMaxDecisionsPerRequest = Math.max(
  1,
  Number.parseInt(process.env.GEMINI_MAX_DECISIONS_PER_REQUEST ?? "12", 10),
);
const demoSyntheticSaferRouteEnabled =
  String(process.env.DEMO_SYNTHETIC_SAFER_ROUTE_ENABLED ?? "true").toLowerCase() !== "false";
const newsJobToken = process.env.NEWS_JOB_TOKEN?.trim();
const jobRunsTable = process.env.SUPABASE_JOB_RUNS_TABLE?.trim() || "job_runs";
const newsJobMinIntervalMs = Math.max(
  0,
  Number.parseInt(process.env.NEWS_JOB_MIN_INTERVAL_SEC ?? "90", 10) * 1000,
);
const staleRiskHours = Math.max(
  1,
  Number.parseInt(process.env.NEWS_STALE_THRESHOLD_HOURS ?? "8", 10),
);
let lastNewsJobTriggerAt = 0;
const geminiRouteDecisionCache = new Map();

if (!supabaseUrl || !supabaseKey) {
  console.error(
    "Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY in backend/.env",
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function normalizeVendor(row) {
  return {
    id: row.id,
    name: row.name,
    country: row.country,
    flag: row.flag,
    lat: row.lat,
    lng: row.lng,
    material: row.material,
    risk: row.risk,
    leadTime: row.lead_time ?? row.leadTime ?? 0,
    costDelta: row.cost_delta ?? row.costDelta ?? 0,
    status: row.status ?? "Unknown",
    tier: row.tier ?? "green",
    alternatives: Array.isArray(row.alternatives) ? row.alternatives : [],
  };
}

function normalizeAlert(row) {
  return {
    id: row.id,
    vendorId: row.vendor_id ?? row.vendorId,
    tier: row.tier ?? "yellow",
    region: row.region,
    msg: row.msg ?? row.message ?? "",
    time: row.time ?? "",
  };
}

function normalizePort(row) {
  return {
    id: row.osm_id ?? row.id,
    name: row.name ?? "Unnamed Port",
    lat: row.lat,
    lng: row.lon ?? row.lng,
    harbour: row.harbour ?? "yes",
    seamarkType: row.seamark_type ?? row.seamarkType ?? null,
  };
}

function mercatorToLngLat(x, y) {
  const originShift = 20037508.34;
  const lng = (x / originShift) * 180;
  let lat = (y / originShift) * 180;
  lat =
    (180 / Math.PI) *
    (2 * Math.atan(Math.exp((lat * Math.PI) / 180)) - Math.PI / 2);
  return { lng, lat };
}

function normalizeRoutePoint(point, sourceSrid) {
  const x = Number(point?.lon ?? point?.x);
  const y = Number(point?.lat ?? point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  if (sourceSrid === 3857) {
    const converted = mercatorToLngLat(x, y);
    return {
      lng: converted.lng,
      lat: Math.max(-85.0511, Math.min(85.0511, converted.lat)),
    };
  }

  return {
    lng: x,
    lat: y,
  };
}

function normalizeRoute(row) {
  const sourceSrid = Number(row.source_srid ?? 3857);
  const geometry = Array.isArray(row.geometry) ? row.geometry : [];
  const originName =
    row.origin_port_name ??
    row.originPortName ??
    row.origin_port?.name ??
    row.originPort?.name ??
    null;
  const destName =
    row.dest_port_name ??
    row.destPortName ??
    row.dest_port?.name ??
    row.destPort?.name ??
    null;
  const points = geometry
    .map((point) => normalizeRoutePoint(point, sourceSrid))
    .filter((point) => {
      if (!point) return false;
      return (
        Number.isFinite(point.lat) &&
        Number.isFinite(point.lng) &&
        point.lat >= -90 &&
        point.lat <= 90 &&
        point.lng >= -180 &&
        point.lng <= 180
      );
    });

  return {
    id: row.id,
    laneId: row.lane_id,
    laneType: row.lane_type,
    distanceKm: Number(row.distance_km ?? 0),
    originPortName: originName,
    destPortName: destName,
    routeName:
      originName && destName
        ? `${originName} -> ${destName}`
        : `Route ${row.lane_id}-${row.id}`,
    points,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

async function createJobRun(jobName) {
  const { data, error } = await supabase
    .from(jobRunsTable)
    .insert({
      job_name: jobName,
      status: "running",
      started_at: new Date().toISOString(),
      summary_json: {},
    })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to create job run: ${error.message}`);
  return data.id;
}

async function finishJobRun(jobRunId, { status, summary = {}, errorText = null }) {
  const { error } = await supabase
    .from(jobRunsTable)
    .update({
      status,
      ended_at: new Date().toISOString(),
      summary_json: summary,
      error_text: errorText,
    })
    .eq("id", jobRunId);
  if (error) console.warn("[job-runs] failed to update run:", error.message);
}

async function fetchLatestJobRun(jobName) {
  const { data, error } = await supabase
    .from(jobRunsTable)
    .select("id,job_name,started_at,ended_at,status,summary_json,error_text")
    .eq("job_name", jobName)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch latest job run: ${error.message}`);
  return data ?? null;
}

async function fetchLatestJobRunByStatus(jobName, status) {
  const { data, error } = await supabase
    .from(jobRunsTable)
    .select("id,job_name,started_at,ended_at,status,summary_json,error_text")
    .eq("job_name", jobName)
    .eq("status", status)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch ${status} job run: ${error.message}`);
  return data ?? null;
}

function computeRouteRiskPercentage(route, maxDistanceKm) {
  const laneBaseRisk = {
    Major: 58,
    Intermediate: 44,
    Minor: 32,
  };

  const base = laneBaseRisk[route.laneType] ?? 40;
  const distanceRatio =
    maxDistanceKm > 0 ? clamp(route.distanceKm / maxDistanceKm, 0, 1) : 0;
  const distanceComponent = distanceRatio * 30;
  const complexityComponent = clamp((route.points.length - 2) * 0.25, 0, 12);

  return clamp(Math.round(base + distanceComponent + complexityComponent), 1, 99);
}

function normalizePortKey(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function sameRouteEndpoints(currentRoute, candidateRoute) {
  const currentOrigin = normalizePortKey(currentRoute.originPortName);
  const currentDest = normalizePortKey(currentRoute.destPortName);
  const candidateOrigin = normalizePortKey(candidateRoute.originPortName);
  const candidateDest = normalizePortKey(candidateRoute.destPortName);
  if (!currentOrigin || !currentDest || !candidateOrigin || !candidateDest) return false;
  return currentOrigin === candidateOrigin && currentDest === candidateDest;
}

const forcedDemoPairs = [
  {
    origin: "port_6432418656",
    dest: "port de lampaul",
    label: "Port_6432418656 -> Port de Lampaul",
    waypointVariants: [
      [
        { lat: 2.8, lng: -44.5 },
        { lat: 11.2, lng: -40.1 },
        { lat: 18.8, lng: -33.6 },
      ],
      [
        { lat: 0.5, lng: -46.2 },
        { lat: 9.0, lng: -41.9 },
        { lat: 16.4, lng: -35.0 },
      ],
      [
        { lat: 4.1, lng: -43.0 },
        { lat: 12.7, lng: -38.6 },
        { lat: 20.3, lng: -31.7 },
      ],
    ],
  },
  {
    origin: "\u9ec3\u7af9\u89d2\u6d77 wong chuk kok hoi",
    dest: "\u5c0f\u5cf6\u6f01\u6e2f",
    label: "\u9ec3\u7af9\u89d2\u6d77 Wong Chuk Kok Hoi -> \u5c0f\u5cf6\u6f01\u6e2f",
    waypointVariants: [
      [
        { lat: 21.1, lng: 129.8 },
        { lat: 19.6, lng: 135.3 },
        { lat: 23.2, lng: 127.7 },
      ],
      [
        { lat: 20.5, lng: 128.6 },
        { lat: 18.8, lng: 133.4 },
        { lat: 22.8, lng: 126.3 },
      ],
      [
        { lat: 22.0, lng: 130.7 },
        { lat: 20.2, lng: 136.1 },
        { lat: 24.0, lng: 128.2 },
      ],
    ],
  },
];

function getForcedDemoPair(route) {
  const origin = normalizePortKey(route.originPortName);
  const dest = normalizePortKey(route.destPortName);
  return (
    forcedDemoPairs.find((pair) => pair.origin === origin && pair.dest === dest) ?? null
  );
}

function deterministicVariantIndex(route, variantCount) {
  if (variantCount <= 1) return 0;
  const seed = Math.abs(Number(route.id ?? 0) * 31 + Math.round(Number(route.riskPercentage ?? 0) * 10));
  return seed % variantCount;
}

function createDemoSaferRoutePoints(route, forcedDemoPair = null) {
  const points = Array.isArray(route.points) ? route.points : [];
  if (points.length < 2) return [];

  const start = points[0];
  const end = points[points.length - 1];
  const seed = Math.abs(Number(route.id ?? 1)) % 11;

  const normalizeLng = (lng) => {
    let value = Number(lng);
    while (value > 180) value -= 360;
    while (value < -180) value += 360;
    return value;
  };
  const shortestDeltaLng = (fromLng, toLng) => {
    let delta = normalizeLng(toLng) - normalizeLng(fromLng);
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    return delta;
  };
  const lerp = (a, b, t) => a + (b - a) * t;

  const startLat = Number(start.lat);
  const startLng = normalizeLng(start.lng);
  const endLat = Number(end.lat);
  const endLng = normalizeLng(end.lng);
  const deltaLat = endLat - startLat;
  const deltaLng = shortestDeltaLng(startLng, endLng);
  const lineLength = Math.hypot(deltaLat, deltaLng) || 1;
  const perpLat = -deltaLng / lineLength;
  const perpLng = deltaLat / lineLength;

  let controlPoints = [];
  const selectedVariant = Array.isArray(forcedDemoPair?.waypointVariants)
    ? forcedDemoPair.waypointVariants[
        deterministicVariantIndex(route, forcedDemoPair.waypointVariants.length)
      ]
    : null;

  if (Array.isArray(selectedVariant) && selectedVariant.length > 0) {
    controlPoints = [
      { lat: startLat, lng: startLng },
      ...selectedVariant.map((waypoint) => ({
        lat: clamp(Number(waypoint.lat), -80, 80),
        lng: normalizeLng(Number(waypoint.lng)),
      })),
      { lat: endLat, lng: endLng },
    ];
  } else {
    // Stronger demo detour so the safer line is clearly different in presentations.
    const direction = seed % 2 === 0 ? 1 : -1;
    const primaryOffset = clamp(16 + seed * 2.2, 16, 34);
    const secondaryOffset = primaryOffset * 0.85;
    const mid1Lat = lerp(startLat, endLat, 0.34);
    const mid1Lng = normalizeLng(startLng + deltaLng * 0.34);
    const mid2Lat = lerp(startLat, endLat, 0.68);
    const mid2Lng = normalizeLng(startLng + deltaLng * 0.68);

    const waypoint1 = {
      lat: clamp(mid1Lat + perpLat * primaryOffset * direction, -80, 80),
      lng: normalizeLng(mid1Lng + perpLng * primaryOffset * direction),
    };
    const waypoint2 = {
      lat: clamp(mid2Lat - perpLat * secondaryOffset * direction, -80, 80),
      lng: normalizeLng(mid2Lng - perpLng * secondaryOffset * direction),
    };

    controlPoints = [
      { lat: startLat, lng: startLng },
      waypoint1,
      waypoint2,
      { lat: endLat, lng: endLng },
    ];
  }

  const syntheticPoints = [];
  for (let i = 0; i < controlPoints.length - 1; i += 1) {
    const a = controlPoints[i];
    const b = controlPoints[i + 1];
    const legDeltaLng = shortestDeltaLng(a.lng, b.lng);
    const steps = 10;
    for (let step = 0; step <= steps; step += 1) {
      if (i > 0 && step === 0) continue;
      const t = step / steps;
      syntheticPoints.push({
        lat: clamp(lerp(a.lat, b.lat, t), -85, 85),
        lng: normalizeLng(a.lng + legDeltaLng * t),
      });
    }
  }

  // Ensure the synthetic route starts/ends exactly at original selected port endpoints.
  if (syntheticPoints.length >= 2) {
    syntheticPoints[0] = { lat: startLat, lng: startLng };
    syntheticPoints[syntheticPoints.length - 1] = { lat: endLat, lng: endLng };
  }

  return syntheticPoints;
}

function scoreRouteCandidate(route, currentRoute, criticalPorts) {
  if (!sameRouteEndpoints(currentRoute, route)) return Number.POSITIVE_INFINITY;
  const cOrigin = normalizePortKey(route.originPortName);
  const cDest = normalizePortKey(route.destPortName);
  if (criticalPorts.has(cOrigin) || criticalPorts.has(cDest)) return Number.POSITIVE_INFINITY;

  const currentRisk = Number(currentRoute.riskPercentage ?? 0);
  const candidateRisk = Number(route.riskPercentage ?? 0);
  if (candidateRisk >= currentRisk - 5) return Number.POSITIVE_INFINITY;

  const distance = Number(route.distanceKm ?? 0);
  const currentDistance = Number(currentRoute.distanceKm ?? 0);
  const lanePenalty = route.laneType === currentRoute.laneType ? 0 : 6;
  const distancePenalty = Math.abs(distance - currentDistance) * 0.02;
  return candidateRisk + lanePenalty + distancePenalty;
}

function parseGeminiRecommendation(rawText) {
  if (!rawText) return null;
  const trimmed = String(rawText).trim();
  const jsonLike = trimmed.match(/\{[\s\S]*\}/)?.[0] ?? trimmed;
  try {
    const parsed = JSON.parse(jsonLike);
    const routeId = Number(parsed?.routeId);
    if (!Number.isFinite(routeId)) return null;
    return {
      routeId,
      reason: typeof parsed?.reason === "string" ? parsed.reason.trim() : "",
      confidence: Number.isFinite(Number(parsed?.confidence))
        ? Number(parsed.confidence)
        : null,
    };
  } catch {
    return null;
  }
}

async function chooseBestCandidateWithGemini(currentRoute, candidates, criticalPortNames) {
  if (!geminiRouteOptimizerEnabled || !Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const shortlisted = candidates.slice(0, geminiMaxCandidates);
  const cacheKey = JSON.stringify({
    routeId: currentRoute.id,
    risk: currentRoute.riskPercentage,
    candidateIds: shortlisted.map(({ candidate }) => candidate.id),
    candidateRisk: shortlisted.map(({ candidate }) => candidate.riskPercentage),
    criticalPortNames,
  });
  const cached = geminiRouteDecisionCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 10 * 60 * 1000) {
    return cached.value;
  }

  const payload = {
    currentRoute: {
      id: currentRoute.id,
      name: currentRoute.routeName,
      laneType: currentRoute.laneType,
      riskPercentage: currentRoute.riskPercentage,
      distanceKm: currentRoute.distanceKm,
      criticalPorts: criticalPortNames,
    },
    candidates: shortlisted.map(({ candidate }) => ({
      routeId: candidate.id,
      routeName: candidate.routeName,
      laneType: candidate.laneType,
      riskPercentage: candidate.riskPercentage,
      distanceKm: candidate.distanceKm,
      originPortName: candidate.originPortName,
      destPortName: candidate.destPortName,
    })),
    task:
      "Pick the single safest alternative route. Prioritize lower risk first, then similar distance/lane-type. Return only JSON object: {\"routeId\": number, \"reason\": string, \"confidence\": number}",
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), geminiTimeoutMs);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: JSON.stringify(payload) }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json",
          },
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) return null;
    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((part) => part?.text ?? "").join("\n");
    const parsed = parseGeminiRecommendation(text);
    if (!parsed) return null;
    const match = shortlisted.find(({ candidate }) => candidate.id === parsed.routeId);
    if (!match) return null;
    const value = {
      routeId: parsed.routeId,
      reason: parsed.reason || "Gemini selected this route as the safest tradeoff.",
      confidence: parsed.confidence,
    };
    geminiRouteDecisionCache.set(cacheKey, { value, ts: Date.now() });
    return value;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function buildRouteOptimization(routesWithRisk) {
  const portScore = new Map();

  for (const route of routesWithRisk) {
    const routeRisk = Number(route.riskPercentage ?? 0);
    const maxDriverSeverity = Array.isArray(route.riskDrivers)
      ? route.riskDrivers.reduce(
          (max, driver) => Math.max(max, Number(driver?.severity ?? 0)),
          0,
        )
      : 0;
    const contribution = routeRisk / 100 + maxDriverSeverity * 0.35;
    const keys = [normalizePortKey(route.originPortName), normalizePortKey(route.destPortName)].filter(Boolean);
    for (const key of keys) {
      portScore.set(key, (portScore.get(key) ?? 0) + contribution);
    }
  }

  const criticalPorts = new Set(
    [...portScore.entries()]
      .filter(([, score]) => score >= 2.2)
      .map(([portKey]) => portKey),
  );

  const routesWithSuggestions = [];
  let geminiDecisionBudget = geminiMaxDecisionsPerRequest;

  for (const route of routesWithRisk) {
    const originKey = normalizePortKey(route.originPortName);
    const destKey = normalizePortKey(route.destPortName);
    const forcedDemoPair = getForcedDemoPair(route);
    const criticalPortExposure = criticalPorts.has(originKey) || criticalPorts.has(destKey);
    const affectedPorts = [
      criticalPorts.has(originKey) ? route.originPortName : null,
      criticalPorts.has(destKey) ? route.destPortName : null,
    ].filter(Boolean);

    if (forcedDemoPair) {
      const currentRisk = Number(route.riskPercentage ?? 50);
      const syntheticRisk = clamp(Number((currentRisk - 10).toFixed(2)), 1, 99);
      const syntheticDistance = Number((Number(route.distanceKm ?? 0) * 1.08).toFixed(1));
      routesWithSuggestions.push({
        ...route,
        criticalPortExposure: true,
        criticalPorts: [route.originPortName, route.destPortName].filter(Boolean),
        recommendedRoute: {
          routeId: Number(`99${route.id}`),
          routeName: `${route.originPortName ?? "Origin"} -> ${route.destPortName ?? "Destination"} (Safer Detour)`,
          laneType: route.laneType,
          distanceKm: syntheticDistance,
          riskPercentage: syntheticRisk,
          riskImprovement: Number((currentRisk - syntheticRisk).toFixed(2)),
          reason: `Demo detour for ${forcedDemoPair.label}: same endpoints, rerouted through a safer corridor.`,
          confidence: 0.92,
          source: "demo",
          points: createDemoSaferRoutePoints(route, forcedDemoPair),
        },
        noSaferRouteMessage: null,
      });
      continue;
    }

    if (!criticalPortExposure) {
      routesWithSuggestions.push({
        ...route,
        criticalPortExposure: false,
        criticalPorts: [],
        recommendedRoute: null,
        noSaferRouteMessage: null,
      });
      continue;
    }

    const currentRisk = Number(route.riskPercentage ?? 0);

    const candidates = routesWithRisk
      .filter((candidate) => candidate.id !== route.id)
      .map((candidate) => {
        const score = scoreRouteCandidate(candidate, route, criticalPorts);
        return { candidate, score };
      })
      .filter(({ score }) => Number.isFinite(score))
      .sort((a, b) => a.score - b.score);

    let geminiDecision = null;
    if (geminiDecisionBudget > 0) {
      geminiDecisionBudget -= 1;
      geminiDecision = await chooseBestCandidateWithGemini(route, candidates, affectedPorts);
    }

    const geminiChosen = geminiDecision
      ? candidates.find(({ candidate }) => candidate.id === geminiDecision.routeId)?.candidate
      : null;
    const best = geminiChosen ?? candidates[0]?.candidate ?? null;
    if (!best) {
      if (demoSyntheticSaferRouteEnabled) {
        const syntheticRisk = clamp(Number((currentRisk - 8).toFixed(2)), 1, 99);
        const syntheticDistance = Number((Number(route.distanceKm ?? 0) * 1.06).toFixed(1));
        routesWithSuggestions.push({
          ...route,
          criticalPortExposure: true,
          criticalPorts: affectedPorts,
          recommendedRoute: {
            routeId: Number(`9${route.id}`),
            routeName: `${route.originPortName ?? "Origin"} -> ${route.destPortName ?? "Destination"} (Safer Detour)`,
            laneType: route.laneType,
            distanceKm: syntheticDistance,
            riskPercentage: syntheticRisk,
            riskImprovement: Number((currentRisk - syntheticRisk).toFixed(2)),
            reason:
              "Demo detour: avoids active risk zone while keeping the same origin and destination ports.",
            confidence: 0.86,
            source: "demo",
            points: createDemoSaferRoutePoints(route, forcedDemoPair),
          },
          noSaferRouteMessage: null,
        });
        continue;
      }
      routesWithSuggestions.push({
        ...route,
        criticalPortExposure: true,
        criticalPorts: affectedPorts,
        recommendedRoute: null,
        noSaferRouteMessage:
          "No safer route is currently available for the same origin and destination ports.",
      });
      continue;
    }

    const riskDelta = Number((currentRisk - Number(best.riskPercentage ?? 0)).toFixed(2));
    routesWithSuggestions.push({
      ...route,
      criticalPortExposure: true,
      criticalPorts: affectedPorts,
      recommendedRoute: {
        routeId: best.id,
        routeName: best.routeName,
        laneType: best.laneType,
        distanceKm: best.distanceKm,
        riskPercentage: best.riskPercentage,
        riskImprovement: riskDelta,
        reason:
          geminiDecision?.reason ||
          "Avoids currently critical ports while lowering route risk.",
        confidence: geminiDecision?.confidence ?? null,
        source: geminiDecision ? "gemini" : "heuristic",
      },
      noSaferRouteMessage: null,
    });
  }

  return { routesWithSuggestions };
}

app.get("/health", (_, res) => {
  res.json({ ok: true });
});

app.get("/api/vendors", async (_, res) => {
  const { data, error } = await supabase.from(vendorsTable).select("*").order("id");

  if (error) {
    return res.status(500).json({
      message: "Failed to fetch vendors from Supabase",
      details: error.message,
    });
  }

  return res.json((data ?? []).map(normalizeVendor));
});

app.get("/api/alerts", async (_, res) => {
  const { data, error } = await supabase.from(alertsTable).select("*").order("id");

  if (error) {
    return res.status(500).json({
      message: "Failed to fetch alerts from Supabase",
      details: error.message,
    });
  }

  return res.json((data ?? []).map(normalizeAlert));
});

app.get("/api/dashboard", async (_, res) => {
  const { data, error } = await supabase.from(vendorsTable).select("*");

  if (error) {
    return res.status(500).json({
      message: "Failed to fetch dashboard data from Supabase",
      details: error.message,
    });
  }

  const vendors = (data ?? []).map(normalizeVendor);
  const critical = vendors.filter((vendor) => vendor.tier === "red");
  const caution = vendors.filter((vendor) => vendor.tier === "yellow");
  const stable = vendors.filter((vendor) => vendor.tier === "green");
  const totalExposure = critical.reduce(
    (total, vendor) => total + Number(vendor.costDelta || 0) * 80000,
    0,
  );

  return res.json({
    totalVendors: vendors.length,
    criticalCount: critical.length,
    cautionCount: caution.length,
    stableCount: stable.length,
    totalExposure,
  });
});

app.get("/api/ports", async (_, res) => {
  const pageSize = 1000;
  const allRows = [];
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from(portsTable)
      .select("osm_id,name,lat,lon,harbour,seamark_type")
      .order("osm_id")
      .range(from, to);

    if (error) {
      return res.status(500).json({
        message: "Failed to fetch ports from Supabase",
        details: error.message,
      });
    }

    const batch = data ?? [];
    allRows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  const ports = allRows
    .map(normalizePort)
    .filter((port) => Number.isFinite(port.lat) && Number.isFinite(port.lng));

  return res.json(ports);
});

async function handleRoutesRequest(req, res, forcePagination = false, defaultLimit = 1000) {
  const page = parsePositiveInt(req.query.page, 1);
  const limit = Math.min(parsePositiveInt(req.query.limit, defaultLimit), 1000);
  const laneType = typeof req.query.laneType === "string" ? req.query.laneType.trim() : null;
  const minRisk =
    req.query.minRisk === undefined ? null : Number.parseFloat(String(req.query.minRisk));

  const pageSize = 1000;
  const allRows = [];
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    let query = supabase
      .from(routesTable)
      .select("id,lane_id,lane_type,distance_km,geometry,source_srid,origin_port_name,dest_port_name,origin_port,dest_port")
      .order("id")
      .range(from, to);
    if (laneType) query = query.eq("lane_type", laneType);
    const { data, error } = await query;

    if (error) {
      return res.status(500).json({
        message: "Failed to fetch routes from Supabase",
        details: error.message,
      });
    }

    const batch = data ?? [];
    allRows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  const routes = allRows
    .map(normalizeRoute)
    .filter((route) => Array.isArray(route.points) && route.points.length >= 2);

  const maxDistanceKm = routes.reduce(
    (max, route) => Math.max(max, route.distanceKm || 0),
    0,
  );

  const baseRiskByRoute = new Map(
    routes.map((route) => [
      route.id,
      computeRouteRiskPercentage(route, maxDistanceKm),
    ]),
  );

  let currentRiskRows = [];
  if (routes.length > 0) {
    const routeIds = routes.map((route) => route.id);
    const { data, error } = await supabase
      .from("v_route_current_risk")
      .select(
        "route_id,base_risk_percentage,news_delta,final_risk_percentage,explanation,drivers,calculation_version,snapshot_at",
      )
      .in("route_id", routeIds);

    if (!error) {
      currentRiskRows = data ?? [];
    }
  }

  const riskSnapshotByRoute = new Map(
    currentRiskRows.map((row) => [row.route_id, row]),
  );

  const routesWithRisk = routes.map((route) => {
    const snapshot = riskSnapshotByRoute.get(route.id);
    const baseRisk = baseRiskByRoute.get(route.id) ?? 1;
    if (!snapshot) {
      return {
        ...route,
        baseRiskPercentage: baseRisk,
        riskPercentage: baseRisk,
        riskDelta: 0,
        riskDrivers: [],
      };
    }

    const finalRisk = Number(snapshot.final_risk_percentage ?? baseRisk);
    const newsDelta = Number(snapshot.news_delta ?? 0);
    return {
      ...route,
      baseRiskPercentage: Number(snapshot.base_risk_percentage ?? baseRisk),
      riskPercentage: finalRisk,
      riskDelta: Number.isFinite(newsDelta)
        ? Number(newsDelta.toFixed(3))
        : Number((finalRisk - baseRisk).toFixed(3)),
      riskDrivers: Array.isArray(snapshot.drivers) ? snapshot.drivers : [],
      riskExplanation: snapshot.explanation ?? null,
      riskModelVersion: snapshot.calculation_version ?? null,
      riskSnapshotAt: snapshot.snapshot_at ?? null,
    };
  });

  const { routesWithSuggestions } = await buildRouteOptimization(routesWithRisk);

  const riskFiltered = Number.isFinite(minRisk)
    ? routesWithSuggestions.filter((route) => Number(route.riskPercentage ?? 0) >= minRisk)
    : routesWithSuggestions;
  const total = riskFiltered.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * limit;
  const items = riskFiltered.slice(start, start + limit);

  const includePagination =
    forcePagination ||
    req.query.page !== undefined || req.query.limit !== undefined || laneType || Number.isFinite(minRisk);
  return res.json(
    buildRoutesApiResponse({
      items,
      page: currentPage,
      limit,
      total,
      includePagination,
    }),
  );
}

app.get("/api/routes", async (req, res) => {
  return handleRoutesRequest(req, res, false);
});

app.get("/api/routes/:id/risk-history", async (req, res) => {
  const routeId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(routeId)) {
    return res.status(400).json({ message: "Invalid route id" });
  }
  const limit = Math.min(parsePositiveInt(req.query.limit, 30), 365);
  const { data, error } = await supabase
    .from("route_risk_snapshots")
    .select(
      "route_id,snapshot_at,base_risk_percentage,news_delta,final_risk_percentage,explanation,drivers,calculation_version",
    )
    .eq("route_id", routeId)
    .order("snapshot_at", { ascending: false })
    .limit(limit);

  if (error) {
    return res.status(500).json({
      message: "Failed to fetch route risk history",
      details: error.message,
    });
  }

  return res.json(buildRiskHistoryResponse(data));
});

app.get("/api/jobs/news-risk-status", async (_, res) => {
  try {
    const latest = await fetchLatestJobRun("news-risk-ingest");
    const latestSuccess = await fetchLatestJobRunByStatus("news-risk-ingest", "success");
    const latestFailure = await fetchLatestJobRunByStatus("news-risk-ingest", "failed");
    return res.json(
      buildJobStatusResponse({
        latestRun: latest,
        latestSuccessRun: latestSuccess,
        latestFailureRun: latestFailure,
        staleRiskHours,
      }),
    );
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Failed to fetch news risk status",
      details: error.message,
    });
  }
});

app.get("/api/v2/routes", async (req, res) => {
  return handleRoutesRequest(req, res, true, 50);
});

app.post("/api/jobs/news-risk-ingest", async (req, res) => {
  if (!newsJobToken) {
    return res.status(503).json({
      message: "NEWS_JOB_TOKEN not configured on server",
    });
  }

  const token = req.header("x-job-token")?.trim();
  if (!token || token !== newsJobToken) {
    return res.status(401).json({ message: "Unauthorized job token" });
  }
  if (newsJobMinIntervalMs > 0 && Date.now() - lastNewsJobTriggerAt < newsJobMinIntervalMs) {
    const retryAfterSec = Math.ceil(
      (newsJobMinIntervalMs - (Date.now() - lastNewsJobTriggerAt)) / 1000,
    );
    return res.status(429).json({
      message: "News ingest triggered too frequently",
      retryAfterSec,
    });
  }

  let jobRunId = null;
  try {
    jobRunId = await createJobRun("news-risk-ingest");
    lastNewsJobTriggerAt = Date.now();
    const summary = await runNewsRiskIngestion({
      supabase,
      routesTable,
    });
    await finishJobRun(jobRunId, { status: "success", summary });
    const latest = await fetchLatestJobRun("news-risk-ingest");
    return res.json({
      ok: true,
      summary,
      latestRun: normalizeJobRun(latest, staleRiskHours),
    });
  } catch (error) {
    if (jobRunId) {
      await finishJobRun(jobRunId, {
        status: "failed",
        summary: {},
        errorText: error.message,
      });
    }
    return res.status(500).json({
      ok: false,
      message: "News risk ingestion failed",
      details: error.message,
    });
  }
});

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  app.listen(port, () => {
    console.log(`REST API running on http://localhost:${port}`);
  });
}
