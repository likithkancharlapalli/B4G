"""
Shipping Route Network via Global Fishing Watch + Zenodo Shipping Lanes
========================================================================
Pipeline:
  1. Download global shipping lane polylines from Zenodo (Benden 2022)
  2. For each lane, query GFW vessel presence along sample points to get a
     traffic density score
  3. Snap ports from ports.json to their nearest lane endpoint
  4. Output routes.json — lanes with density scores + matched port pairs,
     discarding ports that don't snap to any lane

Data sources:
  - Shipping lanes: https://zenodo.org/records/6361763 (CC BY-NC 4.0)
    Polylines with Type attribute: "Major", "Minor", "Intermediate"
  - Vessel presence: GFW 4Wings API (public-global-presence:latest)

Requirements:
  pip install requests numpy geopandas shapely

Usage:
  1. Set GFW_TOKEN below or export GFW_TOKEN=your_token
  2. Run: python shipping_routes.py
"""

import io
import json
import math
import os
import time
import zipfile
import tempfile
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import requests
import geopandas as gpd
from shapely.geometry import LineString

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────

GFW_TOKEN  = os.getenv("GFW_TOKEN", "YOUR_GFW_API_TOKEN_HERE")
PORTS_FILE = "ports.json"

# Only include lanes of these types (remove "Minor" to cut API calls)
LANE_TYPES = {"Major", "Intermediate", "Minor"}

# Number of sample points per lane for GFW density query
SAMPLE_COUNT = 10

# Max distance (degrees) a port can be from a lane endpoint to be snapped
# ~1 degree ≈ 111km at the equator
SNAP_DISTANCE = 1.0

# GFW API
GFW_BASE_URL     = "https://gateway.api.globalfishingwatch.org/v3/4wings/report"
GFW_DATASET      = "public-global-presence:latest"
GFW_RESPONSE_KEY = "public-global-presence:v3.0"
DATE_START       = "2023-01-01"
DATE_END         = "2023-12-31"
API_DELAY        = 0.3   # seconds between calls to respect rate limits

# Zenodo zip download URL (v1.3.1)
ZENODO_URL = (
  "https://zenodo.org/records/6361763/files/"
  "newzealandpaul/Shipping-Lanes-v1.3.1.zip?download=1"
)

OUTPUT_FILE = "routes.json"


# ─────────────────────────────────────────────
# DATA STRUCTURES
# ─────────────────────────────────────────────

@dataclass
class Port:
  id: int
  name: str
  lat: float
  lon: float
  tags: dict = field(default_factory=dict)


@dataclass
class Route:
  lane_id: int
  lane_type: str           # Major / Intermediate / Minor
  geometry: list           # list of (lon, lat) coordinate pairs
  sample_points: list      # (lat, lon) tuples sampled along the lane
  density_values: list     # vessel-hours per sample point (or None on failure)
  mean_density: float
  route_score: float       # 0-1, normalized across all routes
  origin_port: Optional[Port]   # nearest port to lane start point
  dest_port: Optional[Port]     # nearest port to lane end point


# ─────────────────────────────────────────────
# STEP 1 — LOAD SHIPPING LANES
# ─────────────────────────────────────────────

def download_lanes(url: str) -> gpd.GeoDataFrame:
  """
  Download the Zenodo shipping lanes zip and return a GeoDataFrame.
  The zip contains a shapefile with a Type column (Major/Intermediate/Minor).
  """
  print("Downloading shipping lanes from Zenodo...")
  resp = requests.get(url, timeout=60)
  resp.raise_for_status()

  zf = zipfile.ZipFile(io.BytesIO(resp.content))
  shp_names = [n for n in zf.namelist() if n.endswith(".shp")]
  if not shp_names:
    raise FileNotFoundError("No .shp file found in Zenodo zip")

  tmpdir = tempfile.mkdtemp()
  for name in zf.namelist():
    zf.extract(name, tmpdir)

  shp_path = os.path.join(tmpdir, shp_names[0])
  gdf = gpd.read_file(shp_path)
  print(f"Loaded {len(gdf)} lanes. Types: {gdf['Type'].value_counts().to_dict()}")
  return gdf


def filter_lanes(gdf: gpd.GeoDataFrame, types: set) -> gpd.GeoDataFrame:
  """Keep only lanes whose Type is in the allowed set."""
  filtered = gdf[gdf["Type"].isin(types)].reset_index(drop=True)
  print(f"Filtered to {len(filtered)} lanes ({', '.join(sorted(types))})")
  return filtered


# ─────────────────────────────────────────────
# STEP 2 — SAMPLE POINTS ALONG EACH LANE
# ─────────────────────────────────────────────

def sample_lane(geom, n_points: int) -> list[tuple[float, float]]:
  """
  Sample n_points evenly spaced along a Shapely LineString or MultiLineString.
  Returns list of (lat, lon) tuples.
  Note: Shapely stores coordinates as (lon, lat) — we flip on return.
  """
  if geom.geom_type == "MultiLineString":
    coords = [c for line in geom.geoms for c in list(line.coords)]
    geom = LineString(coords)

  if geom.length == 0:
    lon, lat = geom.coords[0]
    return [(lat, lon)] * n_points

  return [
    (geom.interpolate(i / (n_points - 1), normalized=True).y,
     geom.interpolate(i / (n_points - 1), normalized=True).x)
    for i in range(n_points)
  ]


# ─────────────────────────────────────────────
# STEP 3 — QUERY GFW DENSITY
# ─────────────────────────────────────────────

def query_density(
  sample_points: list[tuple[float, float]],
  token: str
) -> list[Optional[float]]:
  """
  POST to GFW 4Wings report endpoint for each sample point.
  Must use POST because we pass a custom GeoJSON polygon — GET only supports
  predefined region-id/region-dataset params per the GFW docs.

  Response structure (from GFW docs Example 11):
    data["entries"][0]["public-global-presence:v3.0"] → list of records
    Each record: { date, flag, hours, lat, lon, vesselIDs }
  We sum hours across all flag records to get total vessel presence.
  """
  headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
  }
  # Query params go in the URL; geometry goes in the POST body
  params = {
    "spatial-resolution": "LOW",
    "temporal-resolution": "YEARLY",
    "format": "JSON",
    "datasets[0]": GFW_DATASET,
    "date-range": f"{DATE_START},{DATE_END}",
  }

  density_values = []
  buf = 0.25  # ~0.5° bounding box around each sample point

  for lat, lon in sample_points:
    body = {
      "geojson": {
        "type": "Feature",
        "geometry": {
          "type": "Polygon",
          "coordinates": [[
            [lon - buf, lat - buf],
            [lon + buf, lat - buf],
            [lon + buf, lat + buf],
            [lon - buf, lat + buf],
            [lon - buf, lat - buf]
          ]]
        }
      }
    }

    try:
      resp = requests.post(
        GFW_BASE_URL,
        headers=headers,
        params=params,
        json=body,
        timeout=15
      )
      if resp.status_code == 200:
        data = resp.json()
        entries = data.get("entries", [{}])
        records = entries[0].get(GFW_RESPONSE_KEY, [])
        total_hours = sum(r.get("hours", 0.0) for r in records)
        density_values.append(total_hours)
      else:
        print(f"  ⚠ GFW {resp.status_code} at ({lat:.3f},{lon:.3f}): {resp.text[:120]}")
        density_values.append(None)
    except requests.RequestException as e:
      print(f"  ⚠ Request failed at ({lat:.3f},{lon:.3f}): {e}")
      density_values.append(None)

    time.sleep(API_DELAY)

  return density_values


# ─────────────────────────────────────────────
# STEP 4 — LOAD PORTS
# ─────────────────────────────────────────────

def load_ports(filepath: str) -> list[Port]:
  """Load ports from OpenStreetMap-format JSON."""
  with open(filepath, "r", encoding="utf-8") as f:
    raw = json.load(f)
  ports = [
    Port(
      id=node["id"],
      name=node.get("tags", {}).get("name", f"Port_{node['id']}"),
      lat=node["lat"],
      lon=node["lon"],
      tags=node.get("tags", {})
    )
    for node in raw
  ]
  print(f"Loaded {len(ports)} ports from {filepath}")
  return ports


# ─────────────────────────────────────────────
# STEP 5 — SNAP PORTS TO LANE ENDPOINTS
# ─────────────────────────────────────────────

def nearest_port(
  lat: float,
  lon: float,
  ports: list[Port],
  max_dist: float
) -> Optional[Port]:
  """Return the closest port within max_dist degrees, or None."""
  best, best_dist = None, float("inf")
  for p in ports:
    d = math.sqrt((p.lat - lat) ** 2 + (p.lon - lon) ** 2)
    if d < best_dist and d <= max_dist:
      best, best_dist = p, d
  return best


def snap_ports_to_routes(
  routes: list[Route],
  ports: list[Port],
  max_dist: float
) -> set[int]:
  """
  For each route, snap the nearest port to the lane's start and end point.
  Mutates routes in-place. Returns set of matched port IDs.
  """
  matched_ids: set[int] = set()
  for route in routes:
    if not route.geometry:
      continue
    # Shapefile coords are (lon, lat) — unpack accordingly
    start_lon, start_lat = route.geometry[0]
    end_lon,   end_lat   = route.geometry[-1]

    route.origin_port = nearest_port(start_lat, start_lon, ports, max_dist)
    route.dest_port   = nearest_port(end_lat,   end_lon,   ports, max_dist)

    if route.origin_port:
      matched_ids.add(route.origin_port.id)
    if route.dest_port:
      matched_ids.add(route.dest_port.id)

  print(f"Snapped {len(matched_ids)} ports to lanes "
        f"({len(ports) - len(matched_ids)} ports discarded — too far from any lane)")
  return matched_ids


# ─────────────────────────────────────────────
# STEP 6 — SCORE AND NORMALIZE
# ─────────────────────────────────────────────

def compute_scores(routes: list[Route]) -> None:
  """Compute mean_density and normalize route_score to 0-1 in-place."""
  for r in routes:
    valid = [v for v in r.density_values if v is not None]
    r.mean_density = float(np.mean(valid)) if valid else 0.0

  max_density = max((r.mean_density for r in routes), default=1.0)
  if max_density > 0:
    for r in routes:
      r.route_score = round(r.mean_density / max_density, 4)


# ─────────────────────────────────────────────
# STEP 7 — OUTPUT
# ─────────────────────────────────────────────

def port_to_dict(p: Optional[Port]) -> Optional[dict]:
  if p is None:
    return None
  return {"id": p.id, "name": p.name, "lat": p.lat, "lon": p.lon}


def save_routes(routes: list[Route], filepath: str) -> None:
  output = sorted([
    {
      "lane_id": r.lane_id,
      "lane_type": r.lane_type,
      "geometry": [{"lon": lon, "lat": lat} for lon, lat in r.geometry],
      "sample_points": [{"lat": lat, "lon": lon} for lat, lon in r.sample_points],
      "density_values": r.density_values,
      "mean_density": r.mean_density,
      "route_score": r.route_score,
      "origin_port": port_to_dict(r.origin_port),
      "dest_port": port_to_dict(r.dest_port),
    }
    for r in routes
  ], key=lambda x: x["route_score"], reverse=True)

  with open(filepath, "w", encoding="utf-8") as f:
    json.dump(output, f, indent=2)
  print(f"✓ Saved {len(output)} routes to {filepath}")


def print_summary(routes: list[Route], top_n: int = 10) -> None:
  print(f"\n{'─'*70}")
  print(f"TOP {top_n} MOST TRAFFICKED LANES")
  print(f"{'─'*70}")
  for r in sorted(routes, key=lambda r: r.route_score, reverse=True)[:top_n]:
    origin = r.origin_port.name if r.origin_port else "no port nearby"
    dest   = r.dest_port.name   if r.dest_port   else "no port nearby"
    print(f"  [{r.lane_type:<14}] {origin:<28} → {dest:<28}  score={r.route_score:.3f}")


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────

if __name__ == "__main__":
  if GFW_TOKEN == "YOUR_GFW_API_TOKEN_HERE":
    print("ERROR: Set your GFW API token in GFW_TOKEN or the GFW_TOKEN env var.")
    exit(1)

  # 1. Download and filter shipping lanes
  gdf   = download_lanes(ZENODO_URL)
  gdf   = filter_lanes(gdf, LANE_TYPES)

  # 2. Load ports
  ports = load_ports(PORTS_FILE)

  # 3. Sample each lane and query GFW for vessel density
  print(f"\nQuerying GFW density for {len(gdf)} lanes × {SAMPLE_COUNT} points each...")
  routes = []
  for i, row in gdf.iterrows():
    lane_type = row.get("Type", "Unknown")
    print(f"  [{i+1}/{len(gdf)}] {lane_type}")

    geom = row.geometry
    coords = (
      [c for line in geom.geoms for c in list(line.coords)]
      if geom.geom_type == "MultiLineString"
      else list(geom.coords)
    )

    sample_pts  = sample_lane(geom, SAMPLE_COUNT)
    density_vals = query_density(sample_pts, GFW_TOKEN)

    routes.append(Route(
      lane_id=int(i),
      lane_type=lane_type,
      geometry=coords,
      sample_points=sample_pts,
      density_values=density_vals,
      mean_density=0.0,
      route_score=0.0,
      origin_port=None,
      dest_port=None,
    ))

  # 4. Score routes
  compute_scores(routes)

  # 5. Snap ports to lane endpoints, discarding unmatched ports
  snap_ports_to_routes(routes, ports, max_dist=SNAP_DISTANCE)

  # 6. Print summary and save
  print_summary(routes)
  save_routes(routes, OUTPUT_FILE)