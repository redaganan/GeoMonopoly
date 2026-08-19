import math, json

R=6371000.0

def _h(lat1,lon1,lat2,lon2):
    a=math.radians;dl=a(lat2-lat1);dp=a(lon2-lon1);la=a((lat1+lat2)/2)
    # haversine
    s=math.sin(dl/2)**2 + math.cos(a(lat1))*math.cos(a(lat2))*math.sin(dp/2)**2
    return 2*R*math.asin(min(1,math.sqrt(s)))

# coords: either [minLat,minLng,maxLat,maxLng] or list of 4 [lat,lng]
def calculate_polygon_sqm(coords):
    if not coords: return 0
    if len(coords)==4 and isinstance(coords[0], (int,float)):
        minLat,minLng,maxLat,maxLng=coords
    else:
        lats=[p[0] for p in coords]; lngs=[p[1] for p in coords]
        minLat,minLng,maxLat,maxLng=min(lats),min(lngs),max(lats),max(lngs)
    # width: east-west at minLat, height: north-south at minLng
    w=_h(minLat,minLng,minLat,maxLng)
    h=_h(minLat,minLng,maxLat,minLng)
    return round(w*h,2)

# point-in-polygon (ray casting) expects poly as list of [lat,lng]
def _pip(pt, poly):
    x,y=pt[1],pt[0]
    inside=False
    n=len(poly)
    for i in range(n):
        xi,yi=poly[i][1],poly[i][0]
        xj,yj=poly[(i-1)%n][1],poly[(i-1)%n][0]
        intersect = ((yi>y) != (yj>y)) and (x < (xj-xi)*(y-yi)/(yj-yi+1e-12) + xi)
        if intersect: inside = not inside
    return inside

# route: list of [lat,lng,t_seconds] or [lat,lng]; territory_poly: either bbox or list of 4 [lat,lng]
def verify_and_unlock_route(route, territory_poly, territory_id):
    cheating=False; unlocked=[]; sqm=calculate_polygon_sqm(territory_poly)
    # normalize territory polygon to list of 4 pts
    if len(territory_poly)==4 and isinstance(territory_poly[0], (int,float)):
        minLat,minLng,maxLat,maxLng=territory_poly
        poly=[[minLat,minLng],[minLat,maxLng],[maxLat,maxLng],[maxLat,minLng]]
    else:
        poly=territory_poly
    # check route points for inside and speed
    prev=None
    for p in route:
        if not p: continue
        lat,lng = p[0], p[1]
        t = p[2] if len(p)>2 else None
        if _pip([lat,lng], poly):
            if territory_id not in unlocked: unlocked.append(territory_id)
        if prev and t is not None and prev[2] is not None:
            d=_h(prev[0],prev[1],lat,lng) # meters
            dt = t - prev[2]
            if dt<=0 and d>0: cheating=True
            elif dt>0:
                kmh = (d*3.6)/dt
                if kmh>25: cheating=True
        prev = (lat,lng,t)
    valid = (not cheating) and (len(unlocked)>0)
    out={"valid_run": bool(valid), "sqm": float(sqm), "unlocked_sectors": unlocked}
    if cheating: out['cheating']=True
    out_json = out
    # compute total km of route
    dist=0.0
    prev=None
    for p in route:
        if not p: continue
        lat,lng = p[0], p[1]
        t = p[2] if len(p)>2 else None
        if prev:
            dist += _h(prev[0],prev[1],lat,lng)
        prev = (lat,lng,t)
    out_json['total_km'] = round(dist/1000.0,3)
    return json.dumps(out_json)
