import requests
from concurrent.futures import ThreadPoolExecutor, as_completed


def fetch_box(box):
  s, w, n, e = box
  URL = "https://overpass-api.de/api/interpreter"
  HEADERS = {"User-Agent": "route-project/1.0"}

  query = f"""
  [out:json][timeout:90];
  node["harbour"]({s},{w},{n},{e});
  out body;
  """

  try:
    res = requests.post(
      URL,
      data={"data": query},
      headers=HEADERS,
      timeout=120
    )
    res.raise_for_status()
    return res.json()["elements"]
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
  boxes = [
    [-90, -180, 0, 0],
    [-90, 0, 0, 180],
    [0, -180, 90, 0],
    [0, 0, 90, 180]
  ]

  all_points = []

  with ThreadPoolExecutor(max_workers=4) as executor:
    futures = [executor.submit(fetch_box, box) for box in boxes]

    for future in as_completed(futures):
      result = future.result()
      all_points.extend(result)

  unique_points = dedupe_ports(all_points)
  return unique_points