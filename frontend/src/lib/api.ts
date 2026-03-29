import type {
  NewsRiskStatusResponse,
  RouteItem,
  RouteRiskHistoryPoint,
} from "../types/risk";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000").trim();

async function requestJson(path: string) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`API ${path} failed with ${response.status}`);
  }
  return response.json();
}

export async function getVendors() {
  return requestJson("/api/vendors");
}

export async function getAlerts() {
  return requestJson("/api/alerts");
}

export async function getDashboard() {
  return requestJson("/api/dashboard");
}

export async function getPorts() {
  return requestJson("/api/ports");
}

export async function getRoutes(): Promise<RouteItem[]> {
  return requestJson("/api/routes");
}

export async function getNewsRiskStatus(): Promise<NewsRiskStatusResponse> {
  return requestJson("/api/jobs/news-risk-status");
}

export async function getRouteRiskHistory(
  routeId: number,
  limit = 30,
): Promise<RouteRiskHistoryPoint[]> {
  return requestJson(`/api/routes/${routeId}/risk-history?limit=${limit}`);
}

export async function triggerNewsIngest(jobToken: string) {
  const response = await fetch(`${apiBaseUrl}/api/jobs/news-risk-ingest`, {
    method: "POST",
    headers: {
      "x-job-token": jobToken,
    },
  });
  if (!response.ok) {
    throw new Error(`News ingest failed with ${response.status}`);
  }
  return response.json();
}
