import "dotenv/config";
import { XMLParser } from "fast-xml-parser";
import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";

const DEFAULT_RSS_FEEDS = [
  "https://news.google.com/rss/search?q=shipping+route+disruption+OR+port+closure+OR+maritime+strike&hl=en-US&gl=US&ceid=US:en",
  "https://news.google.com/rss/search?q=canal+blockage+OR+port+congestion+OR+vessel+delay&hl=en-US&gl=US&ceid=US:en",
];

const STOP_WORDS = new Set([
  "port",
  "porto",
  "harbor",
  "harbour",
  "bay",
  "terminal",
  "city",
  "new",
  "old",
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "near",
]);

const EVENT_KEYWORDS = {
  weather: ["storm", "cyclone", "hurricane", "typhoon", "flood", "weather"],
  strike: ["strike", "walkout", "labor action", "dockworker", "union"],
  conflict: ["war", "conflict", "attack", "missile", "military"],
  piracy: ["piracy", "pirate", "hijack"],
  closure: ["closed", "closure", "shutdown", "blocked", "suspended"],
  congestion: ["congestion", "backlog", "queue", "bottleneck", "delay"],
  regulatory: ["sanction", "regulation", "customs", "inspection", "tariff"],
  accident: ["collision", "grounded", "incident", "fire", "spill"],
};

function getConfig(overrides = {}) {
  const feedEnv = process.env.NEWS_RSS_FEEDS?.trim();
  return {
    routesTable: overrides.routesTable ?? process.env.SUPABASE_ROUTES_TABLE?.trim() ?? "routes",
    jobRunsTable: overrides.jobRunsTable ?? process.env.SUPABASE_JOB_RUNS_TABLE?.trim() ?? "job_runs",
    newsTable: overrides.newsTable ?? "news_articles",
    impactsTable: overrides.impactsTable ?? "route_news_impacts",
    feeds:
      overrides.feeds ??
      (feedEnv ? feedEnv.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_RSS_FEEDS),
    maxArticles: Number.parseInt(
      overrides.maxArticles ?? process.env.NEWS_MAX_ARTICLES ?? "40",
      10,
    ),
    minRouteMatchScore: Number.parseFloat(
      overrides.minRouteMatchScore ?? process.env.NEWS_MIN_ROUTE_MATCH_SCORE ?? "2",
    ),
    impactMaxAgeDays: Number.parseInt(
      overrides.impactMaxAgeDays ?? process.env.NEWS_IMPACT_MAX_AGE_DAYS ?? "10",
      10,
    ),
    maxImpactPerArticle: Number.parseFloat(
      overrides.maxImpactPerArticle ?? process.env.NEWS_MAX_IMPACT_PER_ARTICLE ?? "2.8",
    ),
    defaultSourceReliability: Number.parseFloat(
      overrides.defaultSourceReliability ?? process.env.NEWS_DEFAULT_SOURCE_RELIABILITY ?? "0.65",
    ),
    llmEnabled:
      String(
        overrides.llmEnabled ?? process.env.NEWS_LLM_ENABLED ?? "false",
      ).toLowerCase() === "true",
    llmModel: overrides.llmModel ?? process.env.NEWS_LLM_MODEL ?? "gpt-4.1-mini",
    openAiApiKey: overrides.openAiApiKey ?? process.env.OPENAI_API_KEY?.trim() ?? null,
    modelName: overrides.modelName ?? "heuristic-news-v1",
  };
}

function normalizeText(text) {
  return String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function tokenizeName(name) {
  return normalizeText(name)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function parsePublishedAt(value) {
  const parsed = new Date(value ?? "");
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

export function classifyEventType(text) {
  for (const [eventType, words] of Object.entries(EVENT_KEYWORDS)) {
    if (words.some((word) => text.includes(word))) return eventType;
  }
  return "other";
}

export function estimateSeverity(text, eventType) {
  let severity = eventType === "conflict" || eventType === "closure" ? 4 : 3;
  if (/\b(severe|major|critical|emergency|indefinite)\b/.test(text)) severity += 1;
  if (/\b(minor|contained|brief)\b/.test(text)) severity -= 1;
  return Math.max(1, Math.min(5, severity));
}

export function freshnessMultiplier(publishedAt) {
  const ageMs = Date.now() - new Date(publishedAt).getTime();
  const ageDays = Math.max(0, ageMs / (24 * 60 * 60 * 1000));
  return Math.exp(-ageDays / 7);
}

export function estimateImpactDirection(text, eventType) {
  const lowerText = normalizeText(text);
  const positiveSignals = [
    "reopen",
    "reopened",
    "resume",
    "resumed",
    "normal",
    "cleared",
    "resolved",
    "agreement",
    "deal reached",
    "operations restored",
  ];
  const negativeSignals = [
    "closed",
    "closure",
    "blocked",
    "strike",
    "attack",
    "delay",
    "backlog",
    "congestion",
    "disruption",
    "shutdown",
  ];

  const positiveScore = positiveSignals.reduce(
    (count, signal) => count + (lowerText.includes(signal) ? 1 : 0),
    0,
  );
  const negativeScore = negativeSignals.reduce(
    (count, signal) => count + (lowerText.includes(signal) ? 1 : 0),
    0,
  );

  if (positiveScore > negativeScore && positiveScore >= 1) return "down";
  if (negativeScore >= positiveScore) return "up";
  if (eventType === "closure" || eventType === "conflict" || eventType === "strike") return "up";
  return "up";
}

export function estimateSourceReliability(sourceName, sourceUrl, fallback = 0.65) {
  const text = normalizeText(`${sourceName ?? ""} ${sourceUrl ?? ""}`);
  if (/\b(reuters|bloomberg|associated press|financial times|lloyd|wsj)\b/.test(text)) return 0.9;
  if (/\b(bbc|cnn|cnbc|nytimes|guardian|al jazeera)\b/.test(text)) return 0.82;
  if (/\bgoogle news|rss|news\b/.test(text)) return 0.72;
  return clamp(fallback, 0.45, 0.9);
}

async function tryLlmClassification(articleText, cfg) {
  if (!cfg.llmEnabled || !cfg.openAiApiKey) return null;

  const inputText = articleText.slice(0, 6000);
  const body = {
    model: cfg.llmModel,
    input: [
      {
        role: "system",
        content:
          "You classify maritime disruption news. Return strict JSON only with keys: eventType, severity, confidence, impactDirection, rationale. eventType must be one of weather,strike,conflict,piracy,closure,congestion,regulatory,accident,other. severity 1-5. confidence 0-1. impactDirection up/down.",
      },
      {
        role: "user",
        content: `Article:\n${inputText}`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "risk_extraction",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            eventType: { type: "string" },
            severity: { type: "number" },
            confidence: { type: "number" },
            impactDirection: { type: "string" },
            rationale: { type: "string" },
          },
          required: ["eventType", "severity", "confidence", "impactDirection", "rationale"],
        },
      },
    },
  };

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.openAiApiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const outputText = payload?.output_text ?? "";
    if (!outputText) return null;
    const parsed = JSON.parse(outputText);
    return {
      eventType: String(parsed.eventType ?? "other"),
      severity: clamp(Number(parsed.severity ?? 3), 1, 5),
      confidence: clamp(Number(parsed.confidence ?? 0.65), 0, 1),
      impactDirection: parsed.impactDirection === "down" ? "down" : "up",
      rationale: String(parsed.rationale ?? "").slice(0, 500),
    };
  } catch {
    return null;
  }
}

export function computeBaseRouteRisk(route, maxDistanceKm) {
  const laneBaseRisk = {
    Major: 58,
    Intermediate: 44,
    Minor: 32,
  };
  const base = laneBaseRisk[route.lane_type] ?? 40;
  const distanceRatio =
    maxDistanceKm > 0 ? clamp(Number(route.distance_km ?? 0) / maxDistanceKm, 0, 1) : 0;
  const distanceComponent = distanceRatio * 30;
  return clamp(Math.round(base + distanceComponent), 1, 99);
}

function hasMaritimeContext(text) {
  return /\b(shipping|maritime|port|harbor|harbour|vessel|canal|freight|cargo|seaborne)\b/.test(
    text,
  );
}

export function scoreRouteMatch(articleText, route) {
  let score = 0;
  const originName = normalizeText(route.origin_port_name);
  const destName = normalizeText(route.dest_port_name);
  if (originName && articleText.includes(originName)) score += 4;
  if (destName && articleText.includes(destName)) score += 4;

  const tokenSet = new Set([
    ...tokenizeName(route.origin_port_name),
    ...tokenizeName(route.dest_port_name),
  ]);
  for (const token of tokenSet) {
    if (articleText.includes(token)) score += 1;
  }

  return score;
}

async function fetchRssItems(feedUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(feedUrl, {
      signal: controller.signal,
      headers: { "user-agent": "B4G-NewsBot/1.0 (+https://github.com/likithkancharlapalli/B4G)" },
    });
    if (!response.ok) throw new Error(`Feed ${feedUrl} failed: ${response.status}`);
    const xml = await response.text();
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(xml);
    const items = parsed?.rss?.channel?.item ?? [];
    const list = Array.isArray(items) ? items : [items];
    return list
      .map((item) => ({
        source_name: parsed?.rss?.channel?.title ?? "Unknown Source",
        source_url: feedUrl,
        url: item?.link ?? item?.guid ?? null,
        title: item?.title ?? "",
        published_at: parsePublishedAt(item?.pubDate),
        summary: item?.description ? String(item.description).slice(0, 4000) : null,
        content: item?.description ? String(item.description).slice(0, 8000) : null,
        raw_json: item ?? {},
      }))
      .filter((item) => item.url && item.title);
  } finally {
    clearTimeout(timeout);
  }
}

async function upsertArticle(supabase, table, article) {
  const payload = {
    source_name: article.source_name,
    source_url: article.source_url,
    url: article.url,
    title: article.title,
    published_at: article.published_at,
    summary: article.summary,
    content: article.content,
    raw_json: article.raw_json ?? {},
  };

  const { data, error } = await supabase
    .from(table)
    .upsert(payload, { onConflict: "url" })
    .select("id,title,published_at,summary,content,url")
    .single();

  if (error) throw new Error(`Failed article upsert (${article.url}): ${error.message}`);
  return data;
}

async function upsertImpact(supabase, table, impact) {
  const { error } = await supabase
    .from(table)
    .upsert(impact, { onConflict: "route_id,article_id" });
  if (error) throw new Error(`Failed impact upsert: ${error.message}`);
}

async function expireStaleImpacts(supabase, cfg) {
  const days = Math.max(1, Number(cfg.impactMaxAgeDays ?? 10));
  const cutoffIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from(cfg.impactsTable)
    .update({ effective_to: new Date().toISOString() })
    .is("effective_to", null)
    .lt("effective_from", cutoffIso)
    .select("id");

  if (error) throw new Error(`Failed to expire stale impacts: ${error.message}`);
  return (data ?? []).length;
}

async function startJobRunLog(supabase, cfg, jobName) {
  try {
    const { data, error } = await supabase
      .from(cfg.jobRunsTable)
      .insert({
        job_name: jobName,
        status: "running",
        started_at: new Date().toISOString(),
        summary_json: {},
      })
      .select("id")
      .single();
    if (error) return null;
    return data?.id ?? null;
  } catch {
    return null;
  }
}

async function finishJobRunLog(supabase, cfg, jobRunId, status, summary = {}, errorText = null) {
  if (!jobRunId) return;
  try {
    await supabase
      .from(cfg.jobRunsTable)
      .update({
        status,
        ended_at: new Date().toISOString(),
        summary_json: summary,
        error_text: errorText,
      })
      .eq("id", jobRunId);
  } catch {
    // Best effort logging only.
  }
}

async function insertRiskSnapshots(supabase, cfg, routeRows) {
  const { data: impacts, error: impactsError } = await supabase
    .from(cfg.impactsTable)
    .select("route_id,article_id,event_type,severity,confidence,impact_score,impact_direction,source_reliability,reason,model_explanation,effective_from,effective_to")
    .is("effective_to", null);
  if (impactsError) throw new Error(`Failed to read impacts for snapshots: ${impactsError.message}`);

  const impactRows = impacts ?? [];
  const articleIds = [...new Set(impactRows.map((row) => row.article_id).filter(Boolean))];
  let articleMap = new Map();

  if (articleIds.length > 0) {
    const { data: articles, error: articleError } = await supabase
      .from(cfg.newsTable)
      .select("id,title,url,published_at")
      .in("id", articleIds);
    if (articleError) throw new Error(`Failed to read articles for snapshots: ${articleError.message}`);
    articleMap = new Map((articles ?? []).map((article) => [article.id, article]));
  }

  const impactByRoute = new Map();
  for (const impact of impactRows) {
    const article = articleMap.get(impact.article_id);
    const entry = {
      ...impact,
      article,
    };
    const list = impactByRoute.get(impact.route_id) ?? [];
    list.push(entry);
    impactByRoute.set(impact.route_id, list);
  }

  const maxDistanceKm = routeRows.reduce(
    (max, route) => Math.max(max, Number(route.distance_km ?? 0)),
    0,
  );

  const snapshots = routeRows.map((route) => {
    const routeImpacts = impactByRoute.get(route.id) ?? [];
    const scoredImpacts = routeImpacts
      .map((impact) => {
        const freshness = freshnessMultiplier(impact.article?.published_at ?? impact.effective_from);
        return {
          ...impact,
          weightedImpact: Number(impact.impact_score ?? 0) * freshness,
        };
      })
      .sort((a, b) => b.weightedImpact - a.weightedImpact);

    const rawDelta = scoredImpacts.reduce(
      (sum, impact) => sum + Number(impact.weightedImpact ?? 0),
      0,
    );
    const newsDelta = Number((rawDelta * 6).toFixed(3));
    const baseRisk = computeBaseRouteRisk(route, maxDistanceKm);
    const finalRisk = clamp(Math.round(baseRisk + newsDelta), 1, 99);
    const topDrivers = scoredImpacts.slice(0, 3).map((impact) => ({
      eventType: impact.event_type,
      severity: impact.severity,
      confidence: impact.confidence,
      impactScore: Number(impact.impact_score ?? 0),
      weightedImpact: Number((impact.weightedImpact ?? 0).toFixed(3)),
      reason: impact.reason,
      impactDirection: impact.impact_direction ?? "up",
      sourceReliability: Number(impact.source_reliability ?? 0.65),
      modelExplanation: impact.model_explanation ?? null,
      title: impact.article?.title ?? null,
      url: impact.article?.url ?? null,
      publishedAt: impact.article?.published_at ?? null,
    }));

    return {
      route_id: route.id,
      base_risk_percentage: baseRisk,
      news_delta: newsDelta,
      final_risk_percentage: finalRisk,
      explanation:
        topDrivers.length > 0
          ? `Risk adjusted by ${topDrivers.length} recent news driver(s).`
          : "No active route-linked news impacts.",
      drivers: topDrivers,
      calculation_version: cfg.modelName,
      created_by: "news-ingest-job",
    };
  });

  const { error: snapshotError } = await supabase
    .from("route_risk_snapshots")
    .insert(snapshots);
  if (snapshotError) throw new Error(`Failed to insert risk snapshots: ${snapshotError.message}`);

  return snapshots.length;
}

export async function runNewsRiskIngestion({ supabase, ...overrides }) {
  const cfg = getConfig(overrides);
  const expiredImpacts = await expireStaleImpacts(supabase, cfg);

  const { data: routes, error: routeError } = await supabase
    .from(cfg.routesTable)
    .select("id,lane_id,lane_type,distance_km,origin_port_name,dest_port_name")
    .order("id");
  if (routeError) throw new Error(`Failed to load routes: ${routeError.message}`);

  const routeRows = routes ?? [];
  let fetchedArticles = [];
  for (const feedUrl of cfg.feeds) {
    try {
      const items = await fetchRssItems(feedUrl);
      fetchedArticles.push(...items);
    } catch (error) {
      console.warn(`[news-ingest] feed failed: ${feedUrl} :: ${error.message}`);
    }
  }

  const deduped = [];
  const seenUrls = new Set();
  for (const article of fetchedArticles) {
    if (seenUrls.has(article.url)) continue;
    seenUrls.add(article.url);
    deduped.push(article);
  }

  const selectedArticles = deduped
    .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))
    .slice(0, cfg.maxArticles);

  let insertedArticles = 0;
  let insertedImpacts = 0;

  for (const article of selectedArticles) {
    const storedArticle = await upsertArticle(supabase, cfg.newsTable, article);
    insertedArticles += 1;

    const articleText = normalizeText(
      `${storedArticle.title ?? ""} ${storedArticle.summary ?? ""} ${storedArticle.content ?? ""}`,
    );

    let rankedRoutes = routeRows
      .map((route) => ({
        route,
        score: scoreRouteMatch(articleText, route),
      }))
      .filter((entry) => entry.score >= cfg.minRouteMatchScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);

    if (rankedRoutes.length === 0 && hasMaritimeContext(articleText)) {
      rankedRoutes = routeRows
        .filter((route) => route.lane_type === "Major")
        .sort((a, b) => Number(b.distance_km ?? 0) - Number(a.distance_km ?? 0))
        .slice(0, 3)
        .map((route) => ({ route, score: 1 }));
    }

    const eventType = classifyEventType(articleText);
    const severity = estimateSeverity(articleText, eventType);
    const freshness = freshnessMultiplier(storedArticle.published_at);
    const impactDirection = estimateImpactDirection(articleText, eventType);
    const sourceReliability = estimateSourceReliability(
      article.source_name,
      article.source_url,
      cfg.defaultSourceReliability,
    );
    const llmResult = await tryLlmClassification(articleText, cfg);
    const finalEventType = llmResult?.eventType ?? eventType;
    const finalSeverity = clamp(Number(llmResult?.severity ?? severity), 1, 5);
    const finalDirection = llmResult?.impactDirection ?? impactDirection;

    for (const entry of rankedRoutes) {
      const heuristicConfidence = Math.min(0.95, 0.45 + entry.score * 0.08);
      const confidence = clamp(
        Number(llmResult?.confidence ?? heuristicConfidence),
        0.2,
        0.97,
      );
      const signedDirection = finalDirection === "down" ? -1 : 1;
      const rawImpact = signedDirection * finalSeverity * confidence * freshness * sourceReliability;
      const impactScore = Number(
        clamp(rawImpact, -Math.abs(cfg.maxImpactPerArticle), Math.abs(cfg.maxImpactPerArticle)).toFixed(3),
      );
      const reason = `Matched route '${entry.route.origin_port_name ?? "Unknown"} -> ${
        entry.route.dest_port_name ?? "Unknown"
      }' from article keywords and port names.`;
      const modelExplanation =
        llmResult?.rationale ??
        `${finalEventType} event with ${finalDirection === "down" ? "risk-reducing" : "risk-increasing"} signal.`;

      await upsertImpact(supabase, cfg.impactsTable, {
        route_id: entry.route.id,
        article_id: storedArticle.id,
        event_type: finalEventType,
        severity: finalSeverity,
        confidence: Number(confidence.toFixed(3)),
        impact_score: impactScore,
        impact_direction: finalDirection,
        source_reliability: Number(sourceReliability.toFixed(3)),
        reason,
        model_explanation: modelExplanation,
        evidence: [
          {
            type: "article",
            title: storedArticle.title,
            url: storedArticle.url,
            keywordScore: entry.score,
            sourceReliability: Number(sourceReliability.toFixed(3)),
          },
        ],
        model_name: cfg.modelName,
        effective_to: null,
      });
      insertedImpacts += 1;
    }
  }

  const snapshotsInserted = await insertRiskSnapshots(supabase, cfg, routeRows);

  return {
    feedsProcessed: cfg.feeds.length,
    routesConsidered: routeRows.length,
    articlesFetched: fetchedArticles.length,
    articlesUsed: selectedArticles.length,
    articlesUpserted: insertedArticles,
    impactsUpserted: insertedImpacts,
    snapshotsInserted,
    impactsExpired: expiredImpacts,
    llmEnabled: cfg.llmEnabled && Boolean(cfg.openAiApiKey),
  };
}

async function runFromCli() {
  const url = process.env.SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ??
    process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const cfg = getConfig({});
  const jobRunId = await startJobRunLog(supabase, cfg, "news-risk-ingest");
  try {
    const summary = await runNewsRiskIngestion({ supabase });
    await finishJobRunLog(supabase, cfg, jobRunId, "success", summary, null);
    console.log("[news-ingest] complete", summary);
  } catch (error) {
    await finishJobRunLog(supabase, cfg, jobRunId, "failed", {}, error.message);
    throw error;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runFromCli().catch((error) => {
    console.error("[news-ingest] failed", error);
    process.exit(1);
  });
}
