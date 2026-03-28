import json
import time
import requests

def fetch_box(box):
  s, w, n, e = box
  URL = "https://overpass-api.de/api/interpreter"
  HEADERS = {"User-Agent": "route-project/1.0"}

  query = f"""
  [out:json][timeout:120];
  node["harbour"]({s},{w},{n},{e});
  out body;
  """

  try:
    print(f"Fetching box: {box}")
    res = requests.post(
      URL,
      headers=HEADERS,
      data={"data": query},
      timeout=150
    )
    res.raise_for_status()
    data = res.json()
    return data["elements"]
  except Exception as e:
    print(f"Error for box {box}: {e}")
    return []

def dedupe_ports(points):
  seen = set()
  unique = []

  for p in points:
    if p["id"] not in seen:
      seen.add(p["id"])
      unique.append(p)

  return unique

def fetch_ports():
  # Quarters
  boxes = [
    [-90, -180, 0, 0],   # SW
    [-90, 0, 0, 180],    # SE
    [0, -180, 90, 0],    # NW
    [0, 0, 90, 180]      # NE
  ]
  all_points = []

  for box in boxes:
    points = fetch_box(box)
    all_points.extend(points)
    time.sleep(1)  # Be polite to the API

  return dedupe_ports(all_points)

def main():
  FETCH_PORTS = True
  FETCH_ROUTES = True
  if FETCH_PORTS:
    try:
      with open("ports.json", "r") as f:
        old_ports = json.load(f)
    except FileNotFoundError:
      old_ports = []
    new_ports = fetch_ports()
    combined_ports = dedupe_ports(old_ports + new_ports)
    with open("ports.json", "w") as f:
      json.dump(combined_ports, f, indent=2)
    print(f"Total unique ports: {len(combined_ports)}")
  if FETCH_ROUTES:
    pass

if __name__ == "__main__":
  main()