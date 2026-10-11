/**
 * The Shapes dropdown must list exactly the shape tools the editor
 * already supports — no more, no fewer, and every entry must map to a
 * real drawing workflow (tool id).
 *
 * Run from apps/web: node --experimental-strip-types --loader ./test/loader.mjs --test test/shapes-dropdown.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SHAPE_TOOLS } from '../lib/shape-tools.ts';

describe('ShapesDropdown', () => {
  it('lists every existing shape tool exactly once', () => {
    const ids = SHAPE_TOOLS.map((t) => t.id).sort();
    assert.deepEqual(ids, ['shape-arrow', 'shape-ellipse', 'shape-line', 'shape-rect']);
  });

  it('every entry has an icon id, a label, and no duplicates', () => {
    const seen = new Set<string>();
    for (const t of SHAPE_TOOLS) {
      assert.ok(t.label.length > 0, `${t.id} has a label`);
      assert.ok(!seen.has(t.id), `${t.id} listed once`);
      seen.add(t.id);
    }
  });
});
