import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const routesTable = process.env.SUPABASE_ROUTES_TABLE?.trim() || "routes";
const sourceSrid = Number.parseInt(process.env.SUPABASE_ROUTES_SRID ?? "3857", 10);
const chunkSize = Number.parseInt(process.env.IMPORT_ROUTES_CHUNK_SIZE ?? "250", 10);
const shouldReplace = process.argv.includes("--replace");

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

function parseNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizePort(port) {
  if (!port || typeof port !== "object") return null;
  return {
    id: parseNumber(port.id),
    name: typeof port.name === "string" ? port.name : null,
    lat: parseNumber(port.lat),
    lon: parseNumber(port.lon),
  };
}

function normalizeGeometry(geometry) {
  if (!Array.isArray(geometry)) return [];
  return geometry
    .map((point) => ({
      lon: parseNumber(point?.lon),
      lat: parseNumber(point?.lat),
    }))
    .filter((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat));
}

function mapRoute(route) {
  const normalizedGeometry = normalizeGeometry(route.geometry);
  const originPort = normalizePort(route.origin_port);
  const destPort = normalizePort(route.dest_port);

  return {
    lane_id: parseNumber(route.lane_id),
    lane_type: typeof route.lane_type === "string" ? route.lane_type : "Major",
    distance_km: parseNumber(route.distance_km) ?? 0,
    geometry: normalizedGeometry,
    origin_port: originPort ?? {},
    dest_port: destPort ?? {},
    source_srid: sourceSrid,
    raw_record: route,
  };
}

async function main() {
  const routesPath = path.resolve(__dirname, "../pre_processing_layer/routes.json");
  const raw = await fs.readFile(routesPath, "utf8");
  const data = JSON.parse(raw);

  if (!Array.isArray(data)) {
    throw new Error("routes.json must contain a JSON array");
  }

  const rows = data.map(mapRoute);
  console.log(`Preparing to import ${rows.length} routes into '${routesTable}'...`);

  if (shouldReplace) {
    const { error: deleteError } = await supabase
      .from(routesTable)
      .delete()
      .not("id", "is", null);
    if (deleteError) {
      console.error("Failed to clear existing routes:", deleteError.message);
      process.exit(1);
    }
    console.log("Cleared existing routes (replace mode).");
  }

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from(routesTable).insert(chunk);

    if (error) {
      console.error(`Chunk ${i / chunkSize + 1} failed:`, error.message);
      process.exit(1);
    }

    console.log(`Imported ${Math.min(i + chunkSize, rows.length)} / ${rows.length}`);
  }

  console.log("Routes import complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
