import { describe, expect, it } from 'vitest';
import { fadeEdges } from './useScrollFade.ts';

describe('fadeEdges', () => {
  it('fades the side that hides more content', () => {
    expect(fadeEdges(0, 390, 1033)).toBe('right');
    expect(fadeEdges(300, 390, 1033)).toBe('both');
    expect(fadeEdges(643, 390, 1033)).toBe('left');
  });
  it('shows no fade when everything fits', () => {
    expect(fadeEdges(0, 1200, 1033)).toBe('');
  });
});
