/**
 * Regression tests for Find & Replace.
 *
 * Verifies that:
 * - findTextMatches returns correct matches
 * - replaceTextMatch creates native-text elements
 * - replaceTextMatch updates existing elements (no duplicates)
 * - Case-sensitive and case-insensitive matching work
 * - Undo/redo work for replacements
 *
 * Run: node --test with the loader (see package.json test script)
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useEditor } from '../store/editor.ts';

function makePage(id, sourceIndex) {
  return {
    id,
    sourceIndex,
    width: 612,
    height: 792,
    rotation: 0,
  };
}

function makeNativeItem(pageId, text, x = 100, y = 200) {
  return {
    id: `nt-${pageId}-${x}`,
    x,
    y,
    width: 150,
    height: 20,
    baselineOffset: 5,
    text,
    fontSize: 14,
    fontFamily: 'Helvetica',
    bold: false,
    italic: false,
  };
}

describe('find & replace', () => {
  beforeEach(() => {
    const page1 = makePage('page-1', 1);
    const page2 = makePage('page-2', 2);
    useEditor.setState((s) => {
      s.pages = [page1, page2];
      s.elements = {};
      s.nativeText = {
        'page-1': [
          makeNativeItem('page-1', 'Quarterly Report Q3 2026', 100, 200),
          makeNativeItem('page-1', 'Revenue grew 18% year over year.', 100, 250),
        ],
        'page-2': [
          makeNativeItem('page-2', 'Quarterly summary for Q3.', 100, 200),
        ],
      };
      s.past = [];
      s.future = [];
      s.selectedId = null;
    });
  });

  it('findTextMatches returns matches across pages', () => {
    const matches = useEditor.getState().findTextMatches('Quarterly', false);
    assert.equal(matches.length, 2, 'Should find 2 matches');
    assert.equal(matches[0].pageId, 'page-1');
    assert.equal(matches[1].pageId, 'page-2');
  });

  it('findTextMatches is case-insensitive by default', () => {
    const matches = useEditor.getState().findTextMatches('quarterly', false);
    assert.equal(matches.length, 2, 'Should find matches ignoring case');
  });

  it('findTextMatches respects case-sensitive flag', () => {
    const matches = useEditor.getState().findTextMatches('quarterly', true);
    assert.equal(matches.length, 0, 'Should find no matches with wrong case');
  });

  it('findTextMatches returns empty for no matches', () => {
    const matches = useEditor.getState().findTextMatches('xyznonexistent', false);
    assert.equal(matches.length, 0);
  });

  it('replaceTextMatch creates a native-text element', () => {
    const state = useEditor.getState();
    const matches = state.findTextMatches('Quarterly', false);
    assert.ok(matches.length > 0);

    const match = matches[0];
    const id = state.replaceTextMatch(match.pageId, match.item, 'Quarterly', 'Annual', false);
    assert.ok(id, 'Should return element ID');

    const el = useEditor.getState().elements[id];
    assert.ok(el, 'Element should exist');
    assert.equal(el.kind, 'native-text');
    assert.ok(el.text.includes('Annual'), 'Text should contain replacement');
    assert.ok(!el.text.includes('Quarterly'), 'Text should not contain query');
  });

  it('replaceTextMatch updates existing element (no duplicate)', () => {
    const state = useEditor.getState();
    const matches = state.findTextMatches('Quarterly', false);
    const match = matches[0];

    // First replacement
    const id1 = state.replaceTextMatch(match.pageId, match.item, 'Quarterly', 'Annual', false);
    const count1 = Object.keys(useEditor.getState().elements).length;

    // Second replacement on same fragment
    const id2 = useEditor.getState().replaceTextMatch(match.pageId, match.item, 'Annual', 'Fiscal', false);
    const count2 = Object.keys(useEditor.getState().elements).length;

    assert.equal(id1, id2, 'Should reuse the same element ID');
    assert.equal(count1, count2, 'Should not create duplicate elements');
    
    const el = useEditor.getState().elements[id2];
    assert.ok(el.text.includes('Fiscal'), 'Text should be updated');
  });

  it('replaceTextMatch is undoable', () => {
    const state = useEditor.getState();
    const matches = state.findTextMatches('Quarterly', false);
    const match = matches[0];

    state.replaceTextMatch(match.pageId, match.item, 'Quarterly', 'Annual', false);
    assert.equal(Object.keys(useEditor.getState().elements).length, 1);

    useEditor.getState().undo();
    assert.equal(Object.keys(useEditor.getState().elements).length, 0, 'Undo should remove the element');
  });

  it('findTextMatches includes existingElementId for already-replaced fragments', () => {
    const state = useEditor.getState();
    let matches = state.findTextMatches('Quarterly', false);
    const match = matches[0];
    assert.equal(match.existingElementId, null, 'No existing element initially');

    state.replaceTextMatch(match.pageId, match.item, 'Quarterly', 'Annual', false);
    
    // Search for the replacement text
    matches = useEditor.getState().findTextMatches('Annual', false);
    // The fragment's original text still contains "Quarterly", but the element has "Annual"
    // findTextMatches searches the nativeText items, not elements
    // So we need to check via the item
    const updatedMatches = useEditor.getState().findTextMatches('Quarterly', false);
    assert.ok(updatedMatches[0].existingElementId, 'Should have existing element ID');
  });
});
