/**
 * Squarified treemap layout (Bruls, Huizing & van Wijk): splits a rectangle into tiles whose
 * areas are proportional to their values, keeping tiles as close to square as possible so
 * labels fit.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Tile<T> extends Rect {
  item: T;
}

/** Worst aspect ratio in a row of areas laid along a side of length `side`. */
function worst(row: number[], side: number): number {
  const sum = row.reduce((a, b) => a + b, 0);
  const max = Math.max(...row);
  const min = Math.min(...row);
  const s2 = side * side;
  const sum2 = sum * sum;
  return Math.max((s2 * max) / sum2, sum2 / (s2 * min));
}

export function squarify<T>(items: T[], value: (item: T) => number, rect: Rect): Tile<T>[] {
  const entries = items.map((item) => ({ item, v: Math.max(0, value(item)) })).filter((e) => e.v > 0);
  entries.sort((a, b) => b.v - a.v);
  const total = entries.reduce((a, e) => a + e.v, 0);
  if (!total || rect.w <= 0 || rect.h <= 0) return [];
  const scale = (rect.w * rect.h) / total;
  const areas = entries.map((e) => e.v * scale);

  const out: Tile<T>[] = [];
  let { x, y, w, h } = rect;
  let i = 0;
  while (i < areas.length) {
    const side = Math.min(w, h);
    const row = [areas[i]];
    let j = i + 1;
    while (j < areas.length && worst([...row, areas[j]], side) <= worst(row, side)) row.push(areas[j++]);

    const rowSum = row.reduce((a, b) => a + b, 0);
    if (w >= h) {
      // Lay the row down the left edge as a column.
      const colW = rowSum / h;
      let yy = y;
      row.forEach((a, k) => {
        const th = a / colW;
        out.push({ item: entries[i + k].item, x, y: yy, w: colW, h: th });
        yy += th;
      });
      x += colW;
      w -= colW;
    } else {
      // Lay the row along the top edge.
      const rowH = rowSum / w;
      let xx = x;
      row.forEach((a, k) => {
        const tw = a / rowH;
        out.push({ item: entries[i + k].item, x: xx, y, w: tw, h: rowH });
        xx += tw;
      });
      y += rowH;
      h -= rowH;
    }
    i = j;
  }
  return out;
}
