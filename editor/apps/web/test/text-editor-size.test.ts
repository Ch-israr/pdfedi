/**
 * Tests for the inline text editor auto-sizing (lib/text-editor-size):
 * the box starts wide enough for its placeholder, grows horizontally
 * with the typed text (clamped to the page boundary), and grows
 * vertically one line step per newline (Shift+Enter).
 *
 * Run from apps/web: node --experimental-strip-types --loader ./test/loader.mjs --test test/text-editor-size.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeEditorSize, EDITOR_LINE_STEP } from '../lib/text-editor-size.ts';

// Deterministic measure: 0.5 * fontSize per character (matches text-hit tests)
const measure = (text: string, font: { fontSize: number }) => text.length * font.fontSize * 0.5;

const base = {
  font: { fontSize: 14, fontFamily: 'Helvetica', bold: false, italic: false },
  zoom: 1,
  maxWidthPx: 1000,
  measure,
};

describe('computeEditorSize', () => {
  it('empty box fits the placeholder text', () => {
    const r = computeEditorSize({ ...base, value: '', placeholder: 'Type your text' });
    // 14 chars * 7px + 16 slack = 114
    assert.equal(Math.round(r.widthPx), 114);
  });

  it('grows horizontally as text is typed', () => {
    const short = computeEditorSize({ ...base, value: 'Hi', placeholder: 'Type your text' });
    const long = computeEditorSize({
      ...base,
      value: 'A much longer line of typed text here',
      placeholder: 'Type your text',
    });
    assert.ok(long.widthPx > short.widthPx, `${long.widthPx} > ${short.widthPx}`);
    assert.ok(long.widthPx < base.maxWidthPx, 'within the boundary');
    assert.equal(long.heightPx, short.heightPx, 'single line: same height');
  });

  it('clamps to the page boundary', () => {
    const r = computeEditorSize({
      ...base,
      value: 'x'.repeat(500),
      placeholder: 'Type your text',
      maxWidthPx: 200,
    });
    assert.equal(r.widthPx, 200);
  });

  it('grows vertically one line step per newline', () => {
    const one = computeEditorSize({ ...base, value: 'First', placeholder: 'Type your text' });
    const two = computeEditorSize({ ...base, value: 'First\nSecond', placeholder: 'Type your text' });
    const three = computeEditorSize({ ...base, value: 'A\nB\nC', placeholder: 'Type your text' });
    assert.ok(Math.abs(two.lineHeightPx - 14 * EDITOR_LINE_STEP) < 0.01);
    assert.ok(Math.abs(two.heightPx - one.heightPx - two.lineHeightPx) < 0.01);
    assert.ok(Math.abs(three.heightPx - one.heightPx - 2 * two.lineHeightPx) < 0.01);
  });

  it('trailing newline counts as a started new line', () => {
    const r = computeEditorSize({ ...base, value: 'First\n', placeholder: 'Type your text' });
    const one = computeEditorSize({ ...base, value: 'First', placeholder: 'Type your text' });
    assert.ok(r.heightPx > one.heightPx, 'Shift+Enter at end of line grows the box');
  });

  it('scales with zoom', () => {
    // Long enough to stay above the minimum-width floor.
    const a = computeEditorSize({ ...base, value: 'Hello world', placeholder: 'Type your text', zoom: 1 });
    const b = computeEditorSize({ ...base, value: 'Hello world', placeholder: 'Type your text', zoom: 2 });
    assert.equal(Math.round(b.widthPx - 16), Math.round((a.widthPx - 16) * 2));
    assert.ok(Math.abs(b.heightPx - 12 - (a.heightPx - 12) * 2) < 1);
  });
});
