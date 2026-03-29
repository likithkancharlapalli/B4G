import "dotenv/config";
import fs from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CHUNK_SIZE = 500;

function toBool(v) {
  if (v === "yes") return true;
  if (v === "no") return false;
  return null;
}

function mapRow(r) {
  const t = r.tags ?? {};
  return {
    osm_id: r.id,
    osm_type: r.type ?? "node",
    lat: r.lat,
    lon: r.lon,
    name: t.name ?? null,
    harbour: t.harbour ?? "yes",
    seamark_type: t["seamark:type"] ?? null,
    seamark_harbour_category: t["seamark:harbour:category"] ?? null,
    leisure: t.leisure ?? null,
    operator: t.operator ?? null,
    website: t.website ?? null,
    phone: t.phone ?? null,
    source: t.source ?? null,
    port_of_entry: toBool(t.port_of_entry),
    cargo: t.cargo ?? null,
    tags: t,
    raw_record: r,
  };
}

async function main() {
  const raw = await fs.readFile("../pre_processing_layer/ports.json", "utf8");
  const data = JSON.parse(raw);
  const rows = data.map(mapRow);

  console.log(`Preparing to import ${rows.length} ports...`);

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase
      .from("ports")
      .upsert(chunk, { onConflict: "osm_id" });

    if (error) {
      console.error(`Chunk ${i / CHUNK_SIZE + 1} failed:`, error.message);
      process.exit(1);
    }

    console.log(`Imported ${Math.min(i + CHUNK_SIZE, rows.length)} / ${rows.length}`);
  }

  console.log("Import complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});