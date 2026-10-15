/**
 * Tests for the P0 native-edit writability gate (2026-10-15):
 * - the shared WinAnsi encodability helper the commit gate relies on
 * - source guards pinning the gate's wiring: the inline editor refuses
 *   unwritable commits before anything changes, native edits are seeded
 *   from the probe's font reading (not the PDF.js item), and the store's
 *   export path uses the reporting export and surfaces failed edits.
 *
 * Run from apps/web: node --experimental-strip-types --loader ./test/loader.mjs --test test/native-edit-writability.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { findUnencodableChars } from '@pdfeditor/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(here, rel), 'utf8');

describe('findUnencodableChars (shared helper used by the commit gate)', () => {
  it('accepts Latin and accented Latin text', () => {
    assert.deepEqual(findUnencodableChars('Customer Name'), []);
    assert.deepEqual(findUnencodableChars('Café — €100 “paid”'), []);
  });

  it('flags Arabic and Urdu characters', () => {
    assert.ok(findUnencodableChars('Customer عربي').length > 0);
    assert.ok(findUnencodableChars('نام').length > 0);
  });
});

describe('commit gate wiring (source guards)', () => {
  const overlay = read('../components/ElementOverlay.tsx');

  it('the inline editor validates writability before committing', () => {
    assert.match(overlay, /findUnencodableChars\(text\)/);
    assert.match(overlay, /The change was not applied/);
    // The gate must run before the editor state is cleared.
    const gateAt = overlay.indexOf('findUnencodableChars(text)');
    const commitAt = overlay.indexOf("if (et.mode === 'edit')");
    assert.ok(gateAt > -1 && commitAt > -1 && gateAt < commitAt, 'gate precedes commit handling');
  });

  it('native edits are seeded from the probe font reading', () => {
    assert.match(overlay, /probeFontFamily: probe\.fontFamily/);
    assert.match(overlay, /fontFamily: et\.probeFontFamily \?\? item\.fontFamily/);
    assert.match(overlay, /fontSize: et\.probeFontSize \?\? item\.fontSize/);
    assert.match(overlay, /bold: et\.probeBold \?\? item\.bold/);
  });

  it('the direct probe passes the font identity through', () => {
    const probe = read('../lib/direct-probe.ts');
    assert.match(probe, /fontSize: r\.fontSize/);
    assert.match(probe, /fontFamily: r\.fontFamily/);
    assert.match(probe, /fontBaseName: r\.fontBaseName/);
  });

  it('the store exports with a failure report and surfaces it on download', () => {
    const store = read('../store/editor.ts');
    assert.match(store, /exportAnnotatedPdfWithReport/);
    assert.match(store, /lastExportFailures/);
    assert.match(store, /original text was kept in the downloaded file/);
  });
});
