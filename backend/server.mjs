import "dotenv/config";
import cors from "cors";
import express from "express";
import { createClient } from "@supabase/supabase-js";

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

app.listen(port, () => {
  console.log(`REST API running on http://localhost:${port}`);
});
