/**
 * Draws the user's drawings on the price pane and handles placing, selecting and moving them.
 *
 * Rendering is a series primitive, so drawings follow every pan and zoom for free and appear
 * in exported images. Pointer handling listens on the chart's container in the capture phase:
 * when a tool is active or a drawing is grabbed, the event is kept from the chart so it does
 * not pan underneath.
 */
import type { IChartApi, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts';
import {
  TWO_POINT_TOOLS,
  fibPrices,
  fracIndex,
  hitTest,
  medianStep,
  newId,
  timeAtIndex,
  type DrawPoint,
  type DrawTool,
  type Drawing,
  type HitPart,
  type Px,
  type Shape,
} from '../lib/drawings.ts';

export interface TextRequest {
  /** Position inside the chart container, in CSS pixels. */
  x: number;
  y: number;
  point: DrawPoint;
  /** Set when editing an existing note. */
  id?: string;
  initial: string;
}

export interface ControllerEnv {
  chart: IChartApi;
  series: ISeriesApi<'Candlestick'>;
  host: HTMLElement;
  /** Real (unshifted) Unix times of the candles on screen. */
  times: () => number[];
  /** X coordinate of candle `i`, or null before the chart has laid out. */
  barX: (i: number) => number | null;
  colors: () => { line: string; fill: string; text: string; labelBg: string; handle: string };
  formatPrice: (p: number) => string;
  onCommit: (next: Drawing[]) => void;
  onSelect: (id: string | null) => void;
  onToolDone: () => void;
  onTextRequest: (req: TextRequest) => void;
}

interface Drag {
  id: string;
  part: HitPart;
  start: Px;
  orig: Drawing;
  moved: boolean;
}

const FIB_COLORS = ['#9aa4b5', '#f2555a', '#f0b429', '#22c38e', '#2dd4bf', '#5b8cff', '#9aa4b5'];

export class DrawingController {
  private env: ControllerEnv;
  private drawings: Drawing[] = [];
  private tool: DrawTool | null = null;
  private selectedId: string | null = null;
  /** A two-point drawing being placed. */
  private draft: Drawing | null = null;
  private draftStart: Px | null = null;
  /** A drawing being dragged, shown instead of its stored version until released. */
  private live: Drawing | null = null;
  private drag: Drag | null = null;
  private claimed = false;
  private textBoxes = new Map<string, { w: number; h: number }>();
  private requestUpdate: (() => void) | null = null;
  private primitive: ISeriesPrimitive<Time>;

  constructor(env: ControllerEnv) {
    this.env = env;
    this.primitive = {
      attached: (p: SeriesAttachedParameter<Time>) => {
        this.requestUpdate = p.requestUpdate;
      },
      detached: () => {
        this.requestUpdate = null;
      },
      paneViews: () => [
        {
          zOrder: () => 'top' as const,
          renderer: () => ({
            draw: (target: { useMediaCoordinateSpace: (f: (scope: { context: CanvasRenderingContext2D; mediaSize: { width: number; height: number } }) => void) => void }) => {
              target.useMediaCoordinateSpace(({ context, mediaSize }) => this.paint(context, mediaSize.width));
            },
          }),
        },
      ],
    };
    env.series.attachPrimitive(this.primitive);

    const h = env.host;
    h.addEventListener('pointerdown', this.onPointerDown, true);
    h.addEventListener('pointermove', this.onHostMove, true);
    h.addEventListener('mousedown', this.blockIfClaimed, true);
    h.addEventListener('touchstart', this.blockIfClaimed, { capture: true, passive: false });
    h.addEventListener('dblclick', this.onDoubleClick, true);
  }

  destroy(): void {
    const h = this.env.host;
    h.removeEventListener('pointerdown', this.onPointerDown, true);
    h.removeEventListener('pointermove', this.onHostMove, true);
    h.removeEventListener('mousedown', this.blockIfClaimed, true);
    h.removeEventListener('touchstart', this.blockIfClaimed, true);
    h.removeEventListener('dblclick', this.onDoubleClick, true);
    window.removeEventListener('pointermove', this.onWindowMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    h.classList.remove('drawing-tool');
    h.style.touchAction = '';
    try {
      this.env.series.detachPrimitive(this.primitive);
    } catch {
      /* the chart was already removed */
    }
  }

  setState(s: { drawings: Drawing[]; tool: DrawTool | null; selectedId: string | null }): void {
    if (s.tool !== this.tool) {
      this.draft = null;
      this.draftStart = null;
    }
    this.drawings = s.drawings;
    this.tool = s.tool;
    this.selectedId = s.selectedId;
    this.env.host.classList.toggle('drawing-tool', !!s.tool);
    // Without this the browser would turn a touch drag into a page scroll mid-drawing.
    this.env.host.style.touchAction = s.tool || s.selectedId ? 'none' : '';
    this.refresh();
  }

  refresh(): void {
    this.requestUpdate?.();
  }

  /* ------------------------------ coordinates ------------------------------ */

  private paneSize(): { w: number; h: number } {
    return { w: this.env.chart.timeScale().width(), h: this.env.chart.panes()[0]?.getHeight() ?? 0 };
  }

  private spacing(): number {
    return this.env.chart.timeScale().options().barSpacing || 6;
  }

  private xOf(t: number): number | null {
    const times = this.env.times();
    const n = times.length;
    if (n === 0) return null;
    const f = fracIndex(times, t, medianStep(times));
    const x0 = this.env.barX(0);
    const xl = this.env.barX(n - 1);
    if (x0 == null || xl == null) return null;
    if (f <= 0) return x0 + f * this.spacing();
    if (f >= n - 1) return xl + (f - (n - 1)) * this.spacing();
    const i = Math.floor(f);
    const xi = this.env.barX(i);
    const xj = this.env.barX(i + 1);
    if (xi == null || xj == null) return null;
    return xi + (f - i) * (xj - xi);
  }

  /** Fractional bar index under x. */
  private indexAt(x: number): number | null {
    const n = this.env.times().length;
    if (n === 0) return null;
    const x0 = this.env.barX(0);
    const xl = this.env.barX(n - 1);
    if (x0 == null || xl == null) return null;
    if (x <= x0) return (x - x0) / this.spacing();
    if (x >= xl) return n - 1 + (x - xl) / this.spacing();
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((this.env.barX(mid) ?? 0) <= x) lo = mid;
      else hi = mid;
    }
    const xi = this.env.barX(lo) ?? 0;
    const xj = this.env.barX(hi) ?? xi + 1;
    return lo + (x - xi) / (xj - xi);
  }

  /** The price/time under a pixel, with time snapped to the nearest bar. */
  private pointAt(p: Px): DrawPoint | null {
    const f = this.indexAt(p.x);
    const price = this.env.series.coordinateToPrice(p.y);
    if (f == null || price == null) return null;
    const times = this.env.times();
    return { t: Math.round(timeAtIndex(times, Math.round(f), medianStep(times))), p: price };
  }

  private px(pt: DrawPoint): Px | null {
    const x = this.xOf(pt.t);
    const y = this.env.series.priceToCoordinate(pt.p);
    return x == null || y == null ? null : { x, y };
  }

  private shapeOf(d: Drawing): Shape | null {
    const a = this.px(d.a);
    if (!a) return null;
    const b = d.b ? this.px(d.b) : undefined;
    if (d.b && !b) return null;
    const shape: Shape = { tool: d.tool, a, b: b ?? undefined, width: this.paneSize().w, box: this.textBoxes.get(d.id) };
    if (d.tool === 'fib' && d.b) {
      shape.fibYs = fibPrices(d.a.p, d.b.p)
        .map((l) => this.env.series.priceToCoordinate(l.price))
        .filter((y): y is NonNullable<typeof y> => y != null);
    }
    return shape;
  }

  /* --------------------------------- paint --------------------------------- */

  private visible(): Drawing[] {
    const list = this.drawings.map((d) => (this.live && d.id === this.live.id ? this.live : d));
    return this.draft ? [...list, this.draft] : list;
  }

  private paint(ctx: CanvasRenderingContext2D, width: number): void {
    const c = this.env.colors();
    ctx.save();
    ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textBaseline = 'middle';
    for (const d of this.visible()) {
      const s = this.shapeOf(d);
      if (!s) continue;
      const selected = d.id === this.selectedId || d === this.draft;
      ctx.lineWidth = selected ? 2.5 : 2;
      ctx.strokeStyle = c.line;
      ctx.fillStyle = c.fill;
      ctx.setLineDash(d === this.draft ? [5, 4] : []);

      if (d.tool === 'trend' && s.b) {
        ctx.beginPath();
        ctx.moveTo(s.a.x, s.a.y);
        ctx.lineTo(s.b.x, s.b.y);
        ctx.stroke();
      } else if (d.tool === 'hline') {
        ctx.beginPath();
        ctx.moveTo(0, s.a.y);
        ctx.lineTo(width, s.a.y);
        ctx.stroke();
        this.label(ctx, this.env.formatPrice(d.a.p), width - 6, s.a.y - 11, c.line, '#ffffff', 'right');
      } else if (d.tool === 'rect' && s.b) {
        const x = Math.min(s.a.x, s.b.x);
        const y = Math.min(s.a.y, s.b.y);
        const w = Math.abs(s.b.x - s.a.x);
        const h = Math.abs(s.b.y - s.a.y);
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
      } else if (d.tool === 'fib' && s.b && d.b) {
        const x0 = Math.min(s.a.x, s.b.x);
        const x1 = Math.max(s.a.x, s.b.x);
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(s.a.x, s.a.y);
        ctx.lineTo(s.b.x, s.b.y);
        ctx.stroke();
        ctx.restore();
        fibPrices(d.a.p, d.b.p).forEach((l, i) => {
          const y = this.env.series.priceToCoordinate(l.price);
          if (y == null) return;
          ctx.strokeStyle = FIB_COLORS[i % FIB_COLORS.length];
          ctx.lineWidth = selected ? 2 : 1.5;
          ctx.beginPath();
          ctx.moveTo(x0, y);
          ctx.lineTo(x1, y);
          ctx.stroke();
          ctx.fillStyle = FIB_COLORS[i % FIB_COLORS.length];
          ctx.textAlign = 'left';
          ctx.fillText(`${l.level}  ${this.env.formatPrice(l.price)}`, x0 + 4, y - 8);
        });
      } else if (d.tool === 'text') {
        const text = d.text ?? '';
        const w = Math.ceil(ctx.measureText(text).width) + 14;
        const h = 22;
        this.textBoxes.set(d.id, { w, h });
        ctx.setLineDash([]);
        ctx.fillStyle = c.labelBg;
        ctx.strokeStyle = selected ? c.line : c.handle;
        ctx.lineWidth = selected ? 2 : 1;
        ctx.beginPath();
        ctx.roundRect(s.a.x, s.a.y - h / 2, w, h, 5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = c.text;
        ctx.textAlign = 'left';
        ctx.fillText(text, s.a.x + 7, s.a.y + 0.5);
      }

      if (selected && d.tool !== 'text') {
        ctx.setLineDash([]);
        for (const h of d.tool === 'hline' ? [{ x: width / 2, y: s.a.y }] : [s.a, s.b]) {
          if (!h) continue;
          ctx.beginPath();
          ctx.arc(h.x, h.y, 4.5, 0, Math.PI * 2);
          ctx.fillStyle = c.labelBg;
          ctx.fill();
          ctx.strokeStyle = c.line;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  private label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, bg: string, fg: string, align: 'left' | 'right'): void {
    const w = Math.ceil(ctx.measureText(text).width) + 10;
    const left = align === 'right' ? x - w : x;
    ctx.save();
    ctx.setLineDash([]);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(left, y - 9, w, 18, 4);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = 'left';
    ctx.fillText(text, left + 5, y + 0.5);
    ctx.restore();
  }

  /* ------------------------------- interaction ------------------------------- */

  private local(e: { clientX: number; clientY: number }): Px {
    const r = this.env.host.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private inPane(p: Px): boolean {
    const { w, h } = this.paneSize();
    return p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h;
  }

  /** Topmost drawing under the pointer; the selected one wins ties so its handles stay grabbable. */
  private hitAt(p: Px): { d: Drawing; part: HitPart } | null {
    const order = [...this.drawings].reverse();
    const sel = order.find((d) => d.id === this.selectedId);
    for (const d of sel ? [sel, ...order.filter((x) => x !== sel)] : order) {
      const s = this.shapeOf(d);
      const part = s ? hitTest(s, p) : null;
      if (part) return { d, part };
    }
    return null;
  }

  /**
   * Take over this press: the chart must not pan, and preventDefault stops the browser's
   * follow-up mouse events, whose default focus change would otherwise close the note input
   * that a text-tool click just opened.
   */
  private claim(e: PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this.claimed = true;
    window.addEventListener('pointermove', this.onWindowMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
  }

  private blockIfClaimed = (e: Event): void => {
    const inPane = 'clientX' in e ? this.inPane(this.local(e as MouseEvent)) : true;
    if (this.claimed || (this.tool && inPane)) {
      e.stopPropagation();
      if (e.type === 'touchstart' && e.cancelable) e.preventDefault();
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = this.local(e);
    if (!this.inPane(p)) return;

    if (this.tool) {
      const point = this.pointAt(p);
      if (!point) return;
      this.claim(e);
      if (this.tool === 'hline') {
        const d: Drawing = { id: newId(), tool: 'hline', a: point };
        this.env.onCommit([...this.drawings, d]);
        this.env.onSelect(d.id);
        this.env.onToolDone();
      } else if (this.tool === 'text') {
        this.env.onTextRequest({ x: p.x, y: p.y, point, initial: '' });
      } else if (TWO_POINT_TOOLS.has(this.tool)) {
        if (!this.draft) {
          this.draft = { id: newId(), tool: this.tool, a: point, b: point };
          this.draftStart = p;
        } else {
          this.finishDraft(point, p);
        }
      }
      this.refresh();
      return;
    }

    const hit = this.hitAt(p);
    if (hit) {
      this.claim(e);
      if (hit.d.id !== this.selectedId) this.env.onSelect(hit.d.id);
      this.drag = { id: hit.d.id, part: hit.part, start: p, orig: hit.d, moved: false };
    } else if (this.selectedId) {
      this.env.onSelect(null);
    }
  };

  private finishDraft(point: DrawPoint, at: Px): void {
    const draft = this.draft;
    const start = this.draftStart;
    this.draft = null;
    this.draftStart = null;
    if (!draft || !start || Math.hypot(at.x - start.x, at.y - start.y) < 4) return;
    const d: Drawing = { ...draft, b: point };
    this.env.onCommit([...this.drawings, d]);
    this.env.onSelect(d.id);
    this.env.onToolDone();
  }

  /** Preview the second point while placing with click–move–click. */
  private onHostMove = (e: PointerEvent): void => {
    if (!this.draft || this.claimed) return;
    const point = this.pointAt(this.local(e));
    if (!point) return;
    this.draft = { ...this.draft, b: point };
    this.refresh();
  };

  private onWindowMove = (e: PointerEvent): void => {
    const p = this.local(e);
    if (this.draft) {
      const point = this.pointAt(p);
      if (point) this.draft = { ...this.draft, b: point };
      this.refresh();
      return;
    }
    const g = this.drag;
    if (!g) return;
    if (!g.moved && Math.hypot(p.x - g.start.x, p.y - g.start.y) < 3) return;
    g.moved = true;
    const point = this.pointAt(p);
    if (!point) return;
    const o = g.orig;
    if (g.part === 'a') this.live = { ...o, a: point };
    else if (g.part === 'b') this.live = { ...o, b: point };
    else {
      // Move the whole drawing by the same number of bars and the same price difference.
      const times = this.env.times();
      const step = medianStep(times);
      const from = this.pointAt(g.start);
      const fNow = this.indexAt(p.x);
      const fStart = this.indexAt(g.start.x);
      if (!from || fNow == null || fStart == null) return;
      const dBars = o.tool === 'hline' ? 0 : Math.round(fNow - fStart);
      const dPrice = point.p - from.p;
      const move = (q: DrawPoint): DrawPoint => ({ t: Math.round(timeAtIndex(times, Math.round(fracIndex(times, q.t, step)) + dBars, step)), p: q.p + dPrice });
      this.live = { ...o, a: move(o.a), b: o.b ? move(o.b) : undefined };
    }
    this.refresh();
  };

  private onPointerUp = (e: PointerEvent): void => {
    window.removeEventListener('pointermove', this.onWindowMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    // Let the mouse/touch event that follows this pointer event be blocked too.
    setTimeout(() => (this.claimed = false), 0);

    const p = this.local(e);
    if (this.draft && this.draftStart && Math.hypot(p.x - this.draftStart.x, p.y - this.draftStart.y) >= 6) {
      // Press–drag–release placed both points in one gesture.
      const point = this.pointAt(p);
      if (point) this.finishDraft(point, p);
    }
    if (this.drag) {
      const live = this.live;
      const moved = this.drag.moved;
      this.drag = null;
      this.live = null;
      if (moved && live) this.env.onCommit(this.drawings.map((d) => (d.id === live.id ? live : d)));
    }
    this.refresh();
  };

  private onDoubleClick = (e: MouseEvent): void => {
    const p = this.local(e);
    const hit = this.hitAt(p);
    if (!hit || hit.d.tool !== 'text') return;
    e.stopPropagation();
    const at = this.px(hit.d.a);
    this.env.onTextRequest({ x: at?.x ?? p.x, y: at?.y ?? p.y, point: hit.d.a, id: hit.d.id, initial: hit.d.text ?? '' });
  };
}
