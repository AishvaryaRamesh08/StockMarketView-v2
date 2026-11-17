/**
 * Appearance: dark or light theme, and the price-colour palette (classic green/red, or a
 * colour-blind-safe blue/orange). Stored in this browser and applied as data attributes on
 * <html>, which the CSS tokens in styles.css key off.
 */
import { useSyncExternalStore } from 'react';
import { load, save } from './storage.ts';

export type Theme = 'dark' | 'light';
export type Palette = 'classic' | 'cb';

export interface Appearance {
  theme: Theme;
  palette: Palette;
}

const KEY = 'smv.appearance';
const DEFAULT: Appearance = { theme: 'dark', palette: 'classic' };

function isAppearance(v: unknown): v is Appearance {
  const a = v as Appearance;
  return !!a && (a.theme === 'dark' || a.theme === 'light') && (a.palette === 'classic' || a.palette === 'cb');
}

let current: Appearance = DEFAULT;
const listeners = new Set<() => void>();

function apply(a: Appearance): void {
  const root = document.documentElement;
  root.dataset.theme = a.theme;
  root.dataset.palette = a.palette;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', a.theme === 'dark' ? '#0b0e14' : '#f5f6f8');
}

/** Call once before the first render so the page never flashes the wrong theme. */
export function initAppearance(): void {
  current = load(KEY, DEFAULT, isAppearance);
  apply(current);
}

export function setAppearance(patch: Partial<Appearance>): void {
  current = { ...current, ...patch };
  apply(current);
  save(KEY, current);
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, () => current);
}

/** Changes whenever colours change; canvas-drawn components re-read their colours on it. */
export function useAppearanceKey(): string {
  const a = useAppearance();
  return `${a.theme}-${a.palette}`;
}

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
