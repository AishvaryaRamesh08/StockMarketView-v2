# Pattern rules vs TA-Lib

A one-off check of this site's candlestick rules (`src/lib/patterns.ts`) against
[TA-Lib](https://ta-lib.org) 0.8.3, the library v1 used, on the same real candles.

**Sample:** 30 large stocks (15 NIFTY 50, 15 S&P 500), five years of daily candles each,
37,320 candles in total, run on 17 Nov 2026.

| Pattern | This site | TA-Lib | Both | Agreement | Ours also in TA-Lib | TA-Lib's also ours |
|---|---:|---:|---:|---:|---:|---:|
| Bullish engulfing | 1,385 | 1,384 | 1,384 | 100% | 100% | 100% |
| Bearish engulfing | 1,726 | 1,755 | 1,724 | 98% | 100% | 98% |
| Doji | 3,962 | 5,195 | 3,769 | 70% | 95% | 73% |
| Bullish harami | 1,038 | 1,630 | 921 | 53% | 89% | 57% |
| Bearish harami | 827 | 1,343 | 729 | 51% | 88% | 54% |
| Evening star | 149 | 206 | 111 | 45% | 74% | 54% |
| Morning star | 120 | 199 | 90 | 39% | 75% | 45% |
| Shooting star | 538 | 427 | 103 | 12% | 19% | 24% |
| Hammer | 514 | 653 | 112 | 11% | 22% | 17% |

Agreement is the overlap divided by the union of both sets of hits.

## What the differences mean

- **Engulfing** follows TA-Lib's definition and matches it almost exactly. All 31 extra bearish
  hits in TA-Lib follow a perfectly flat candle (open exactly equal to close): TA-Lib counts a
  flat candle as a rising one, this site requires the previous candle to have actually risen.
- **Doji**: TA-Lib calls a body small against the average range of the last 10 candles; this
  site calls a body small against the candle's own range (at most 10% of high minus low). 95% of
  this site's doji are also TA-Lib doji; TA-Lib also flags candles that are small only relative
  to a recent volatile stretch.
- **Harami**: both require a long first body and a small second body inside it. This site also
  requires the second candle to be the opposite colour (a red then green, or green then red),
  as most textbooks do; TA-Lib doesn't. That accounts for 999 of TA-Lib's 1,323 extra harami;
  the rest fail this site's "second body under 60% of the first" limit. 89% of this site's harami
  are also TA-Lib's.
- **Morning / evening star**: both need a long first candle, a small gapped middle one and a
  strong third. This site requires the third candle to close past the **middle** of the first
  body; TA-Lib's default only needs it to close 30% into it, so TA-Lib finds more (75% of this
  site's stars are TA-Lib's).
- **Hammer and shooting star** use different definitions on purpose:
  - This site uses the textbook shape (shadow at least twice the body, the other shadow short)
    **and** requires a prior decline (hammer) or rise (shooting star) over the last 5 candles,
    because the pattern only means something at the end of a move.
  - TA-Lib has no trend check. It compares the shadow with the body (once the body, not twice)
    and requires a hammer's body to sit near the previous candle's low, or a shooting star's
    body to gap up above the previous candle's body.
  - So TA-Lib calls some candles in the middle of a move hammers, and this site calls some
    candles with a longer shadow but no gap shooting stars. Neither is "wrong"; they answer
    slightly different questions.

The site's tooltips describe its own rules, and the pattern track record under each chart
shows how each rule has actually played out on that stock.

## Re-running

```bash
npm run dev                                                   # in one terminal
node --experimental-strip-types scripts/talib-check/export.ts # writes data.json
python scripts/talib-check/compare.py                         # needs numpy and TA-Lib
```
