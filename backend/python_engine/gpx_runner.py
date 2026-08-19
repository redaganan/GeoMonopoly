import sys, json
sys.path.append('..')
from gpx_analyzer import verify_and_unlock_route

def main():
    inv = json.load(sys.stdin)
    route = inv.get('route')
    territories = inv.get('territories', [])
    unlocked = []
    sqm_total = 0.0
    total_km = 0.0
    cheating = False
    for t in territories:
        tid = str(t.get('id') or t.get('_id'))
        poly = t.get('bbox') or t.get('poly')
        res = json.loads(verify_and_unlock_route(route, poly, tid))
        if res.get('cheating'): cheating = True
        if res.get('valid_run'):
            unlocked += res.get('unlocked_sectors', [])
            sqm_total += float(res.get('sqm') or 0)
        total_km = max(total_km, float(res.get('total_km') or 0))
    out = { 'valid_run': (not cheating) and len(unlocked)>0, 'sqm': round(sqm_total,2), 'unlocked_sectors': list(set(unlocked)), 'total_km': round(total_km,3) }
    if cheating: out['cheating']=True
    sys.stdout.write(json.dumps(out))

if __name__=='__main__':
    main()
