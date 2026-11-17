/**
 * Fills the area between two lines (the Ichimoku cloud: Senkou span A and span B). The chart
 * library has no fill-between, so this is a series primitive that paints under the candles.
 * The fill is the "up" colour where A is above B and the "down" colour where it is below.
 */
import type { IChartApi, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, SeriesType, Time } from 'lightweight-charts';

export interface CloudPoint {
  time: Time;
  a: number;
  b: number;
}

export class CloudPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private points: CloudPoint[] = [];
  private upFill = 'rgba(34, 195, 142, 0.14)';
  private downFill = 'rgba(242, 85, 90, 0.14)';

  attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart as IChartApi;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  setData(points: CloudPoint[], upFill: string, downFill: string): void {
    this.points = points;
    this.upFill = upFill;
    this.downFill = downFill;
    this.requestUpdate?.();
  }

  paneViews() {
    return [
      {
        zOrder: () => 'bottom' as const,
        renderer: () => ({
          draw: (target: { useMediaCoordinateSpace: (f: (scope: { context: CanvasRenderingContext2D }) => void) => void }) => {
            const chart = this.chart;
            const series = this.series;
            if (!chart || !series || this.points.length < 2) return;
            const ts = chart.timeScale();
            // Screen positions; a point is skipped when it is off the loaded range.
            const pts = this.points.map((p) => ({ x: ts.timeToCoordinate(p.time), ya: series.priceToCoordinate(p.a), yb: series.priceToCoordinate(p.b), up: p.a >= p.b }));
            target.useMediaCoordinateSpace(({ context: ctx }) => {
              for (let i = 1; i < pts.length; i++) {
                const p = pts[i - 1];
                const q = pts[i];
                if (p.x == null || q.x == null || p.ya == null || p.yb == null || q.ya == null || q.yb == null) continue;
                ctx.beginPath();
                ctx.moveTo(p.x, p.ya);
                ctx.lineTo(q.x, q.ya);
                ctx.lineTo(q.x, q.yb);
                ctx.lineTo(p.x, p.yb);
                ctx.closePath();
                ctx.fillStyle = p.up ? this.upFill : this.downFill;
                ctx.fill();
              }
            });
          },
        }),
      },
    ];
  }
}
