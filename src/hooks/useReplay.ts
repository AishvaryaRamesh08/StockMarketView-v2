import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadHistory } from './useHistory.ts';
import { replayRange, replayStart, type ReplayAccount, buyIn, sellOut, newAccount, stepPosition, canTradeAt } from '../lib/replay.ts';
import type { IntervalId } from '../lib/ranges.ts';
import type { Candle, MarketId } from '../lib/types.ts';
import { startIndex } from '../lib/whatIf.ts';

export const REPLAY_SPEEDS = [1, 2, 5, 10];

export interface ReplayApi {
  status: 'loading' | 'ready' | 'error';
  canStepBack: boolean;
  /** False while looking back at earlier candles: trades happen only at the furthest candle reached. */
  canTrade: boolean;
  toLatest: () => void;
  error: string | null;
  /** Candles up to and including the current one: all the chart may show. */
  visible: Candle[];
  current: Candle | null;
  atEnd: boolean;
  /** Changes when a new session starts, so the chart refits. */
  session: number;
  playing: boolean;
  speed: number;
  firstDate: number | null;
  lastDate: number | null;
  account: ReplayAccount;
  startPrice: number | null;
  step: (n: number) => void;
  togglePlay: () => void;
  setSpeed: (s: number) => void;
  jumpTo: (unixSeconds: number) => void;
  buy: (qty: number) => string | null;
  sell: (qty: number) => string | null;
}

/** Bar-by-bar replay of past candles with a practice account that only knows the past. */
export function useReplay(symbol: string, interval: IntervalId, market: MarketId, active: boolean): ReplayApi | null {
  const [data, setData] = useState<{ key: string; candles: Candle[] | null; error: string | null }>({ key: '', candles: null, error: null });
  const key = `${symbol}|${interval}`;
  const [pos, setPos] = useState(0);
  const [startPos, setStartPos] = useState(0);
  const [session, setSession] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [account, setAccount] = useState<ReplayAccount>(() => newAccount(market));

  useEffect(() => {
    if (!active) return;
    let live = true;
    setData({ key, candles: null, error: null });
    loadHistory(symbol, replayRange(interval), interval)
      .then((candles) => {
        if (!live) return;
        setData({ key, candles, error: null });
        const s = replayStart(candles.length, interval);
        setPos(s);
        setStartPos(s);
        setMaxPos(s);
        setAccount(newAccount(market));
        setPlaying(false);
        setSession((x) => x + 1);
      })
      .catch((err: Error) => live && setData({ key, candles: null, error: err.message || "History didn't load" }));
    return () => {
      live = false;
    };
  }, [active, key, symbol, interval, market]);

  const candles = data.key === key ? data.candles : null;
  const n = candles?.length ?? 0;
  const atEnd = !!candles && pos >= n - 1;

  // You can step back to look, but only trade on the furthest candle reached, so nobody can see
  // what happened next, step back and trade on it.
  const [maxPos, setMaxPos] = useState(0);
  useEffect(() => setMaxPos((m) => Math.max(m, pos)), [pos]);
  const step = useCallback((k: number) => setPos((p) => stepPosition(p, k, startPos, n)), [n, startPos]);

  // Playing: one candle per tick until the data runs out.
  const tick = useRef(step);
  tick.current = step;
  useEffect(() => {
    if (!playing || atEnd) {
      if (atEnd) setPlaying(false);
      return;
    }
    const id = setInterval(() => tick.current(1), 1000 / speed);
    return () => clearInterval(id);
  }, [playing, speed, atEnd]);

  const current = candles ? candles[pos] : null;
  const visible = useMemo(() => (candles ? candles.slice(0, pos + 1) : []), [candles, pos]);

  if (!active) return null;
  return {
    canStepBack: pos > startPos,
    canTrade: canTradeAt(pos, maxPos),
    toLatest: () => setPos(maxPos),
    status: data.error && data.key === key ? 'error' : candles ? 'ready' : 'loading',
    error: data.key === key ? data.error : null,
    visible,
    current,
    atEnd,
    session,
    playing,
    speed,
    firstDate: candles?.[Math.min(60, n - 1)]?.t ?? null,
    lastDate: candles?.[n - 2]?.t ?? null,
    account,
    startPrice: candles?.[startPos]?.c ?? null,
    step,
    togglePlay: () => setPlaying((p) => !p),
    setSpeed,
    jumpTo: (t: number) => {
      if (!candles) return;
      const i = Math.max(Math.min(60, n - 2), Math.min(n - 2, startIndex(candles, t) < 0 ? n - 2 : startIndex(candles, t)));
      setPos(i);
      setStartPos(i);
      setMaxPos(i);
      setAccount(newAccount(market));
      setPlaying(false);
      setSession((x) => x + 1);
    },
    buy: (qty: number) => {
      if (!current) return 'No price yet';
      if (!canTradeAt(pos, maxPos)) return 'Go back to the latest candle to trade';
      const r = buyIn(account, qty, current.c, current.t);
      if (typeof r === 'string') return r;
      setAccount(r);
      return null;
    },
    sell: (qty: number) => {
      if (!current) return 'No price yet';
      if (!canTradeAt(pos, maxPos)) return 'Go back to the latest candle to trade';
      const r = sellOut(account, qty, current.c, current.t);
      if (typeof r === 'string') return r;
      setAccount(r);
      return null;
    },
  };
}
