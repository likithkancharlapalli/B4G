"""
Shipping Route Network via GeoJSON (Segmented Routes)
====================================================

Pipeline:
  1. Load shipping lane polylines from GeoJSON
  2. Load ports from ports.json
  3. For each lane:
     - Find ports near the lane
     - Project + sort ports along the lane
     - Split the polyline into segments between ports
  4. Output routes.json with true port-to-port segments

Requirements:
  pip install geopandas shapely pyproj
"""

import json
from dataclasses import dataclass
from typing import Optional, List

import geopandas as gpd
from shapely.geometry import Point
from shapely.ops import substring


# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────

PORTS_FILE = "ports.json"
GEOJSON_PATH = "Shipping_Lanes_v1.geojson"

LANE_TYPES = {"Major", "Intermediate", "Minor"}

# Distance threshold (meters)
SNAP_DISTANCE_METERS = 50000  # 50 km

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
  tags: dict


@dataclass
class Route:
  lane_id: int
  lane_type: str
  geometry: list
  distance_km: float
  origin_port: Optional[Port]
  dest_port: Optional[Port]


# ─────────────────────────────────────────────
# STEP 1 — LOAD LANES (GeoJSON)
# ─────────────────────────────────────────────

def load_lanes(filepath: str) -> gpd.GeoDataFrame:
  print(f"Loading lanes from {filepath}...")
  gdf = gpd.read_file(filepath)

  print(f"Loaded {len(gdf)} lanes")
  print("Columns:", list(gdf.columns))

  # Normalize column name if needed
  if "Type" not in gdf.columns:
    for col in gdf.columns:
      if col.lower() == "type":
        gdf["Type"] = gdf[col]
        break

  if "Type" not in gdf.columns:
    raise ValueError("Could not find a 'Type' column in GeoJSON")

  return gdf


def filter_lanes(gdf: gpd.GeoDataFrame, types: set) -> gpd.GeoDataFrame:
  filtered = gdf[gdf["Type"].isin(types)].reset_index(drop=True)
  print(f"Filtered to {len(filtered)} lanes")
  return filtered


# ─────────────────────────────────────────────
# STEP 2 — LOAD PORTS
# ─────────────────────────────────────────────

def load_ports(filepath: str) -> List[Port]:
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

  print(f"Loaded {len(ports)} ports")
  return ports


# ─────────────────────────────────────────────
# STEP 3 — FIND PORTS NEAR LANE
# ─────────────────────────────────────────────

def ports_near_lane(geom, ports, max_dist):
  nearby = []
  for p in ports:
    point = Point(p.lon, p.lat)
    if geom.distance(point) <= max_dist:
      nearby.append(p)
  return nearby


# ─────────────────────────────────────────────
# STEP 4 — ORDER PORTS ALONG LANE
# ─────────────────────────────────────────────

def order_ports_along_lane(geom, ports):
  projections = []
  for p in ports:
    point = Point(p.lon, p.lat)
    proj = geom.project(point)
    projections.append((proj, p))

  # Sort ports by their position along the line
  projections.sort(key=lambda x: x[0])
  return projections


# ─────────────────────────────────────────────
# STEP 5 — BUILD SEGMENTED ROUTES
# ─────────────────────────────────────────────

def explode_geometry(geom):
  """
  Converts MultiLineString → list of LineStrings
  Leaves LineString unchanged
  """
  if geom.geom_type == "LineString":
    return [geom]
  elif geom.geom_type == "MultiLineString":
    return list(geom.geoms)
  else:
    return []

def build_segmented_routes(lane_id, lane_type, geom, ports, max_dist):
  nearby_ports = ports_near_lane(geom, ports, max_dist)

  # Need at least 2 ports to form a route
  if len(nearby_ports) < 2:
    return []

  projections = order_ports_along_lane(geom, nearby_ports)
  routes = []

  # Create segments between consecutive ports
  for i in range(len(projections) - 1):
    d1, p1 = projections[i]
    d2, p2 = projections[i + 1]

    if d2 <= d1:
      continue

    # Extract sub-line between two distances
    segment = substring(geom, d1, d2)

    coords = list(segment.coords)
    distance_km = segment.length / 1000.0

    routes.append(Route(
      lane_id=lane_id,
      lane_type=lane_type,
      geometry=coords,
      distance_km=round(distance_km, 2),
      origin_port=p1,
      dest_port=p2,
    ))

  return routes


# ─────────────────────────────────────────────
# STEP 6 — OUTPUT
# ─────────────────────────────────────────────

def port_to_dict(p: Optional[Port]):
  if p is None:
    return None
  return {
    "id": p.id,
    "name": p.name,
    "lat": p.lat,
    "lon": p.lon
  }


def save_routes(routes: List[Route], filepath: str):
  output = [
    {
      "lane_id": r.lane_id,
      "lane_type": r.lane_type,
      "distance_km": r.distance_km,
      "geometry": [{"lon": lon, "lat": lat} for lon, lat in r.geometry],
      "origin_port": port_to_dict(r.origin_port),
      "dest_port": port_to_dict(r.dest_port),
    }
    for r in routes
  ]

  with open(filepath, "w", encoding="utf-8") as f:
    json.dump(output, f, indent=2)

  print(f"✓ Saved {len(output)} routes to {filepath}")


def print_summary(routes: List[Route], top_n=10):
  print("\n" + "─" * 70)
  print(f"TOTAL ROUTES: {len(routes)}")
  print("─" * 70)

  for r in routes[:top_n]:
    print(
      f"{r.origin_port.name} → {r.dest_port.name} "
      f"({r.lane_type}, {r.distance_km} km)"
    )


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────

if __name__ == "__main__":
  # 1. Load lanes
  gdf = load_lanes(GEOJSON_PATH)
  gdf = filter_lanes(gdf, LANE_TYPES)

  # Ensure CRS is WGS84, then convert to meters
  if gdf.crs is None:
    gdf.set_crs(epsg=4326, inplace=True)

  gdf = gdf.to_crs(epsg=3857)

  # 2. Load ports
  ports = load_ports(PORTS_FILE)

  # Convert ports into projected coordinate system
  ports_gdf = gpd.GeoDataFrame(
    ports,
    geometry=[Point(p.lon, p.lat) for p in ports],
    crs="EPSG:4326"
  ).to_crs(epsg=3857)

  # Update port coordinates to projected values
  for i, p in enumerate(ports):
    p.lon = ports_gdf.geometry[i].x
    p.lat = ports_gdf.geometry[i].y

  # 3. Build routes
  print("\nBuilding segmented routes...")
  routes = []

  for i, row in gdf.iterrows():
    lane_type = row.get("Type", "Unknown")
    geom = row.geometry

    sub_geometries = explode_geometry(geom)

    for sub_geom in sub_geometries:
      lane_routes = build_segmented_routes(
        lane_id=int(i),
        lane_type=lane_type,
        geom=sub_geom,
        ports=ports,
        max_dist=SNAP_DISTANCE_METERS
      )

      routes.extend(lane_routes)

  # 4. Output
  print_summary(routes)
  save_routes(routes, OUTPUT_FILE)