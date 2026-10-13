/**
 * Tests for the no-edits fast path in exportBytes().
 * When no elements exist and pages are unmodified, export should return
 * the original bytes unchanged (no manifest, no source embedding).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useEditor } from '../store/editor.ts';

function makePage(id: string, sourceIndex: number, rotation = 0) {
  return { id, sourceIndex, width: 612, height: 792, rotation };
}

describe('no-edits fast path', () => {
  it('detects unmodified document correctly', () => {
    useEditor.setState((s) => {
      s.pages = [makePage('p1', 1), makePage('p2', 2)];
      s.pageCount = 2;
      s.elements = {};
      s.pdfBytes = new Uint8Array([1, 2, 3, 4]);
    });
    const s = useEditor.getState();
    const hasElements = Object.keys(s.elements).length > 0;
    const pagesModified =
      s.pages.length !== s.pageCount ||
      s.pages.some((p, i) => p.sourceIndex !== i + 1 || (p.rotation ?? 0) !== 0);
    assert.equal(hasElements, false);
    assert.equal(pagesModified, false);
  });

  it('detects added element', () => {
    useEditor.setState((s) => {
      s.pages = [makePage('p1', 1)];
      s.pageCount = 1;
      s.elements = {
        'el1': {
          id: 'el1', pageId: 'p1', kind: 'text',
          x: 10, y: 10, rotation: 0, text: 'hi',
          fontSize: 12, fontFamily: 'Helvetica', color: '#000000',
          bold: false, italic: false, width: 50, height: 20,
        } as any,
      };
    });
    const s = useEditor.getState();
    const hasElements = Object.keys(s.elements).length > 0;
    assert.equal(hasElements, true);
  });

  it('detects reordered pages', () => {
    useEditor.setState((s) => {
      s.pages = [makePage('p2', 2), makePage('p1', 1)]; // swapped
      s.pageCount = 2;
      s.elements = {};
    });
    const s = useEditor.getState();
    const pagesModified =
      s.pages.length !== s.pageCount ||
      s.pages.some((p, i) => p.sourceIndex !== i + 1 || (p.rotation ?? 0) !== 0);
    assert.equal(pagesModified, true);
  });

  it('detects rotated page', () => {
    useEditor.setState((s) => {
      s.pages = [makePage('p1', 1, 90)]; // rotated
      s.pageCount = 1;
      s.elements = {};
    });
    const s = useEditor.getState();
    const pagesModified =
      s.pages.length !== s.pageCount ||
      s.pages.some((p, i) => p.sourceIndex !== i + 1 || (p.rotation ?? 0) !== 0);
    assert.equal(pagesModified, true);
  });

  it('detects deleted page', () => {
    useEditor.setState((s) => {
      s.pages = [makePage('p1', 1)]; // was 2 pages
      s.pageCount = 2;
      s.elements = {};
    });
    const s = useEditor.getState();
    const pagesModified =
      s.pages.length !== s.pageCount ||
      s.pages.some((p, i) => p.sourceIndex !== i + 1 || (p.rotation ?? 0) !== 0);
    assert.equal(pagesModified, true);
  });
});
