/**
 * Tests for the direct-edit probe cache (lib/direct-probe) — the gate
 * that lets native text editing happen only when the fragment's run can
 * be rewritten directly in the content stream (no masks allowed).
 *
 * Run from apps/web: node --experimental-strip-types --loader ./test/loader.mjs --test test/direct-probe.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { probeDirectEdit, clearDirectProbeCache } from '../lib/direct-probe.ts';

async function makeSource(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Hello World', { x: 100, y: 700, size: 14, font, color: rgb(0.2, 0.3, 0.4) });
  return doc.save();
}

const item = (overrides: Record<string, unknown> = {}) => ({
  id: 'nt-1',
  text: 'Hello World',
  x: 100,
  y: 695.8, // box bottom; baseline = y + baselineOffset = 700
  baselineOffset: 4.2,
  ...overrides,
});

describe('direct-probe', () => {
  it('reports editable for a decodable run at its baseline', async () => {
    clearDirectProbeCache();
    const src = await makeSource();
    const r = await probeDirectEdit(src, 0, item());
    assert.equal(r.editable, true);
    assert.ok(r.colorHex, 'probe returns the run colour');
  });

  it('reports not editable for a fragment that is not there', async () => {
    clearDirectProbeCache();
    const src = await makeSource();
    const r = await probeDirectEdit(src, 0, item({ id: 'nt-2', text: 'Missing text' }));
    assert.equal(r.editable, false);
    assert.ok(r.reason, 'a reason is provided for the UI notice');
  });

  it('reports not editable when no document bytes are available', async () => {
    const r = await probeDirectEdit(null, 0, item());
    assert.equal(r.editable, false);
  });

  it('caches repeated probes for the same fragment', async () => {
    clearDirectProbeCache();
    const src = await makeSource();
    const a = probeDirectEdit(src, 0, item());
    const b = probeDirectEdit(src, 0, item());
    assert.equal(a, b, 'same promise returned for the same fragment');
    assert.equal((await a).editable, true);
    clearDirectProbeCache();
    const c = probeDirectEdit(src, 0, item());
    assert.notEqual(a, c, 'cache cleared → fresh probe');
  });
});
