"""Compares this site's candlestick pattern hits with TA-Lib's on the same candles.
Run export.ts first, then: python compare.py (needs numpy and TA-Lib)."""
from pathlib import Path
import json, numpy as np, talib
d = json.load(open(Path(__file__).with_name('data.json')))
MAP = {
  'bullishEngulfing': ('CDLENGULFING', 1), 'bearishEngulfing': ('CDLENGULFING', -1),
  'hammer': ('CDLHAMMER', 1), 'shootingStar': ('CDLSHOOTINGSTAR', -1), 'doji': ('CDLDOJI', 0),
  'morningStar': ('CDLMORNINGSTAR', 1), 'eveningStar': ('CDLEVENINGSTAR', -1),
  'bullishHarami': ('CDLHARAMI', 1), 'bearishHarami': ('CDLHARAMI', -1),
}
tot = {p: {'ours':0,'talib':0,'both':0} for p in MAP}
samples = {p: {'ours_only':[], 'talib_only':[]} for p in MAP}
bars = 0
for sym, v in d.items():
    c = v['candles']; bars += len(c)
    o,h,l,cl = (np.array([x[k] for x in c], dtype=float) for k in 'ohlc')
    ours = {}
    for hit in v['hits']: ours.setdefault(hit['p'], set()).add(hit['i'])
    for p,(fn,sign) in MAP.items():
        out = getattr(talib, fn)(o,h,l,cl)
        t = set(np.nonzero(out > 0)[0]) if sign == 1 else set(np.nonzero(out < 0)[0]) if sign == -1 else set(np.nonzero(out != 0)[0])
        t = {int(i) for i in t}
        u = ours.get(p, set())
        tot[p]['ours'] += len(u); tot[p]['talib'] += len(t); tot[p]['both'] += len(u & t)
        samples[p]['ours_only'] += [(sym, i) for i in sorted(u - t)[:2]]
        samples[p]['talib_only'] += [(sym, i) for i in sorted(t - u)[:2]]
print(f'{len(d)} stocks, {bars} daily candles, TA-Lib {talib.__version__}')
print(f"{'pattern':18} {'ours':>6} {'talib':>6} {'both':>6} {'agree%':>7} {'ours in TA':>10} {'TA in ours':>10}")
rows=[]
for p,t in tot.items():
    union = t['ours'] + t['talib'] - t['both']
    r = (p, t['ours'], t['talib'], t['both'], 100*t['both']/union if union else 0, 100*t['both']/t['ours'] if t['ours'] else 0, 100*t['both']/t['talib'] if t['talib'] else 0)
    rows.append(r)
    print(f"{r[0]:18} {r[1]:6} {r[2]:6} {r[3]:6} {r[4]:6.0f}% {r[5]:9.0f}% {r[6]:9.0f}%")
json.dump({'rows':rows,'samples':{p:{k:[list(x) for x in v[:4]] for k,v in s.items()} for p,s in samples.items()}}, open(Path(__file__).with_name('result.json'),'w'))
