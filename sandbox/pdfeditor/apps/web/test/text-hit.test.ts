/**
 * Tests for logical text hit-testing (lib/text-hit) — the duplicate guard
 * that routes page clicks near an existing text element to that element
 * instead of minting a new one.
 *
 * Run from apps/web: node --experimental-strip-types --loader ./test/loader.mjs --test test/text-hit.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  textElementBox,
  findTextElementAt,
  findNativeCovering,
  overlapRatio,
} from '../lib/text-hit.ts';

// Deterministic measure: 0.5 * fontSize per character
const measure = (text: string, font: { fontSize: number }) => text.length * font.fontSize * 0.5;

const PAGE_ID = '123e4567-e89b-12d3-a456-426614174000';

function textEl(over = {}) {
  return {
    id: 'aaaaaaaa-1111-4111-8111-111111111111',
    pageId: PAGE_ID,
    kind: 'text',
    x: 100,
    y: 600, // baseline
    rotation: 0,
    text: 'John Smith', // 10 chars * 14 * 0.5 = 70pt wide
    fontSize: 14,
    fontFamily: 'Helvetica',
    color: '#000000',
    bold: false,
    italic: false,
    ...over,
  };
}

function nativeEl(over = {}) {
  return {
    id: 'bbbbbbbb-2222-4222-8222-222222222222',
    pageId: PAGE_ID,
    kind: 'native-text',
    x: 100,
    y: 690,
    rotation: 0,
    originalText: 'Original',
    text: 'Replacement',
    width: 200,
    height: 24,
    baselineOffset: 5,
    fontSize: 16,
    fontFamily: 'Helvetica',
    color: '#000000',
    bold: false,
    italic: false,
    ...over,
  };
}

describe('textElementBox', () => {
  it('text box: baseline + ascent above, descent below', () => {
    const box = textElementBox(textEl() as never, measure);
    assert.equal(box!.x0, 100);
    assert.equal(box!.x1, 170);
    assert.equal(box!.y1, 614); // 600 + 1.0*14
    assert.ok(Math.abs(box!.y0 - (600 - 0.3 * 14)) < 1e-9);
  });

  it('multi-line text extends downward by line steps', () => {
    const box = textElementBox(textEl({ text: 'Line one\nLonger second line' }) as never, measure);
    assert.equal(box!.x1, 100 + 18 * 14 * 0.5);
    assert.ok(Math.abs(box!.y0 - (600 - 1.25 * 14 - 0.3 * 14)) < 1e-9);
  });

  it('native-text box is its mask rect', () => {
    const box = textElementBox(nativeEl() as never, measure);
    assert.deepEqual(box!, { x0: 100, y0: 690, x1: 300, y1: 714 });
  });

  it('non-text kinds return null', () => {
    const shape = { id: 'x', pageId: PAGE_ID, kind: 'shape', shape: 'rect', x: 0, y: 0, rotation: 0, width: 10, height: 10, stroke: '#000', strokeWidth: 1, fill: null };
    assert.equal(textElementBox(shape as never, measure), null);
  });
});

describe('findTextElementAt', () => {
  it('hits inside the glyph box', () => {
    assert.equal(findTextElementAt([textEl()] as never, 150, 605, measure)?.id, textEl().id);
  });

  it('hits within tolerance of the box (halo clicks)', () => {
    // 2pt above the top edge, 2pt right of the right edge
    assert.equal(findTextElementAt([textEl()] as never, 172, 616, measure)?.id, textEl().id);
  });

  it('misses far from the box (genuinely empty area → new text allowed)', () => {
    assert.equal(findTextElementAt([textEl()] as never, 400, 300, measure), null);
    assert.equal(findTextElementAt([textEl()] as never, 150, 500, measure), null);
  });

  it('topmost (last) element wins when boxes overlap', () => {
    const a = textEl({ id: 'aaaaaaaa-1111-4111-8111-111111111111' });
    const b = textEl({ id: 'cccccccc-3333-4333-8333-333333333333', x: 110, y: 602 });
    assert.equal(findTextElementAt([a, b] as never, 150, 605, measure)?.id, b.id);
  });
});

describe('findNativeCovering / overlapRatio', () => {
  it('overlapRatio computes the covered fraction of the fragment', () => {
    const elBox = { x0: 100, y0: 690, x1: 300, y1: 714 };
    const half = { x0: 200, y0: 690, x1: 400, y1: 714 };
    assert.equal(overlapRatio(elBox, half), 0.5);
    assert.equal(overlapRatio(elBox, elBox), 1);
    assert.equal(overlapRatio(elBox, { x0: 500, y0: 690, x1: 600, y1: 714 }), 0);
  });

  it('finds the native element covering a fragment even when x/y differ by more than 1pt', () => {
    // Restored element geometry can drift a few points vs a freshly
    // extracted fragment; the old guard required |dx|<1 and |dy|<1.
    const frag = { x0: 103, y0: 688, x1: 305, y1: 713 };
    assert.equal(findNativeCovering([nativeEl()] as never, frag, measure)?.id, nativeEl().id);
  });

  it('returns null when coverage is minor', () => {
    const frag = { x0: 280, y0: 690, x1: 480, y1: 714 }; // only 20/200 covered
    assert.equal(findNativeCovering([nativeEl()] as never, frag, measure), null);
  });
});
