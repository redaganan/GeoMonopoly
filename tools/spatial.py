"""Tiny spatial utilities for GeoMonopoly
Provides point-in-bbox, haversine distance and run-to-earn conversion.
"""
import math
from typing import Sequence, Tuple

Point = Tuple[float, float]
BBox = Tuple[float, float, float, float]  # minLat, minLon, maxLat, maxLon


def haversine_km(a: Point, b: Point) -> float:
    """Return great-circle distance in kilometers between two (lat, lon) points."""
    R = 6371.0
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    s = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
    return 2 * R * math.atan2(math.sqrt(s), math.sqrt(1 - s))


def point_in_bbox(pt: Point, bbox: BBox) -> bool:
    """Check if point (lat,lon) is inside bbox (minLat,minLon,maxLat,maxLon)."""
    lat, lon = pt
    minLat, minLon, maxLat, maxLon = bbox
    return minLat <= lat <= maxLat and minLon <= lon <= maxLon


def path_passes_bbox(path: Sequence[Point], bbox: BBox) -> bool:
    """Return True if any point in path lies inside bbox."""
    return any(point_in_bbox(p, bbox) for p in path)


def km_to_php(km: float) -> float:
    """Run-to-earn: 1 km = 50 PHP"""
    return km * 50.0


if __name__ == '__main__':
    # small demo
    a = (14.589, 121.001)
    b = (14.591, 121.003)
    print('dist_km=', round(haversine_km(a,b),3))
    print('pass_bbox=', path_passes_bbox([a,b], (14.588,121.0,14.590,121.004)))
    print('php=', km_to_php(haversine_km(a,b)))
