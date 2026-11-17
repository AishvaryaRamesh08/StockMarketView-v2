/**
 * Turns the chart canvas into a shareable PNG: the chart (candles, indicators, drawings) under
 * a caption with the stock, timeframe and date. No watermark.
 */
import { cssVar } from './theme.ts';

export interface Caption {
  title: string;
  detail: string;
}

export async function chartPng(chartCanvas: HTMLCanvasElement, caption: Caption): Promise<Blob> {
  // The chart canvas is in device pixels; scale the caption to match.
  const ratio = Math.max(1, Math.round(chartCanvas.width / Math.max(1, chartCanvas.clientWidth || chartCanvas.width / (window.devicePixelRatio || 1))));
  const dpr = Number.isFinite(ratio) ? ratio : window.devicePixelRatio || 1;
  const pad = 16 * dpr;
  const head = 54 * dpr;
  const out = document.createElement('canvas');
  out.width = chartCanvas.width + pad * 2;
  out.height = chartCanvas.height + head + pad;
  const ctx = out.getContext('2d')!;

  ctx.fillStyle = cssVar('--surface-1') || '#11151d';
  ctx.fillRect(0, 0, out.width, out.height);

  const font = cssVar('--font-sans') || 'sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = cssVar('--text-1') || '#e8ecf3';
  ctx.font = `600 ${17 * dpr}px ${font}`;
  ctx.fillText(caption.title, pad, pad + 18 * dpr);
  ctx.fillStyle = cssVar('--text-3') || '#677184';
  ctx.font = `${12.5 * dpr}px ${font}`;
  ctx.fillText(caption.detail, pad, pad + 36 * dpr);
  ctx.textAlign = 'right';
  ctx.fillText('StockMarketView', out.width - pad, pad + 18 * dpr);

  ctx.drawImage(chartCanvas, pad, head);

  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image'))), 'image/png'));
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Copies a PNG to the clipboard. Returns false where the browser does not allow it. */
export async function copyImage(blob: Blob): Promise<boolean> {
  try {
    if (!('ClipboardItem' in window) || !navigator.clipboard?.write) return false;
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}
