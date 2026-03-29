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

export async function getRoutes() {
  return requestJson("/api/routes");
}
