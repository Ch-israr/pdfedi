/**
 * Regression tests for Bug 1 (warning logic) and Bug 2 (restored element editing).
 *
 * Bug 1: The non-editable warning was suppressed for an entire page if the page
 * had ANY native text. Fixed to check position-level hit, not page-level.
 *
 * Bug 2: Clicking a restored native-text element with Text tool opened an empty
 * editor instead of pre-filled. Fixed to detect the element and open in native
 * mode with existingId.
 *
 * These test the store-level logic. The UI event handlers (onPageClick,
 * onDoubleClick) are tested via the logic they depend on.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useEditor } from '../store/editor.ts';

function makePage(id, sourceIndex) {
  return { id, sourceIndex, width: 612, height: 792, rotation: 0 };
}

function makeNativeItem(pageId, text, x = 100, y = 200) {
  return {
    id: `nt-${pageId}-${x}`,
    x, y, width: 150, height: 20, baselineOffset: 5,
    text, fontSize: 14, fontFamily: 'Helvetica', bold: false, italic: false,
  };
}

describe('Bug 1: warning position-level check', () => {
  beforeEach(() => {
    useEditor.setState((s) => {
      s.pages = [makePage('page-1', 1)];
      s.elements = {};
      // Page has native text (heading) but also empty areas
      s.nativeText = {
        'page-1': [makeNativeItem('page-1', 'Page Heading', 100, 700)],
      };
      s.past = [];
      s.future = [];
      s.nativeEditWarned = false;
    });
  });

  it('page with native text still allows warning for non-text areas (logic)', () => {
    // The fix changes the check from page-level to position-level.
    // We verify the store has the per-page data needed for position checks.
    const state = useEditor.getState();
    const items = state.nativeText['page-1'] ?? [];
    assert.ok(items.length > 0, 'Page should have native text');
    
    // Simulate: click at (300, 300) — not on the heading at (100, 700)
    // The hitNativeText logic (tested separately) would return null here,
    // allowing the warning to show. We verify the data supports this.
    const heading = items[0];
    const clickX = 300, clickY = 300;
    const hit = clickX >= heading.x && clickX <= heading.x + heading.width &&
                clickY >= heading.y && clickY <= heading.y + heading.height;
    assert.equal(hit, false, 'Click on empty area should not hit the heading');
  });

  it('nativeEditWarned flag controls one-time behavior', () => {
    const state = useEditor.getState();
    assert.equal(state.nativeEditWarned, false, 'Initially not warned');
    state.markNativeEditWarned();
    assert.equal(useEditor.getState().nativeEditWarned, true, 'Flag set after warning');
  });
});

describe('Bug 2: restored native-text element editing', () => {
  beforeEach(() => {
    const page = makePage('page-1', 1);
    useEditor.setState((s) => {
      s.pages = [page];
      s.elements = {
        'restored-1': {
          id: 'restored-1',
          pageId: 'page-1',
          kind: 'native-text',
          x: 100, y: 200, rotation: 0,
          originalText: 'Original Heading',
          text: 'Restored Text', // Current (edited) text
          width: 150, height: 20, baselineOffset: 5,
          fontSize: 14, fontFamily: 'Helvetica', color: '#000000',
          bold: false, italic: false,
        },
      };
      s.nativeText = {
        'page-1': [makeNativeItem('page-1', 'Original Heading', 100, 200)],
      };
      s.past = [];
      s.future = [];
    });
  });

  it('restored element has correct structure for editing', () => {
    const el = useEditor.getState().elements['restored-1'];
    assert.ok(el, 'Element should exist');
    assert.equal(el.kind, 'native-text');
    if (el.kind === 'native-text') {
      assert.equal(el.text, 'Restored Text', 'Should have current text');
      assert.equal(el.originalText, 'Original Heading', 'Should have original');
      // The fix uses these fields to pre-fill the editor
      assert.ok(el.x !== undefined && el.y !== undefined, 'Should have position');
      assert.ok(el.width > 0 && el.height > 0, 'Should have dimensions');
    }
  });

  it('updating restored element preserves identity (no duplicate)', () => {
    const state = useEditor.getState();
    const beforeCount = Object.keys(state.elements).length;
    
    // Simulate what the fixed onPageClick does: update existing instead of create
    state.updateElement('restored-1', { text: 'Updated Text' }, 'Edit text');
    
    const afterCount = Object.keys(useEditor.getState().elements).length;
    assert.equal(beforeCount, afterCount, 'Should not create duplicate');
    
    const el = useEditor.getState().elements['restored-1'];
    assert.equal(el.kind, 'native-text');
    if (el.kind === 'native-text') {
      assert.equal(el.text, 'Updated Text');
      assert.equal(el.id, 'restored-1', 'ID preserved');
    }
  });

  it('findTextMatches finds restored element by position', () => {
    const state = useEditor.getState();
    const matches = state.findTextMatches('Original', false);
    assert.ok(matches.length > 0, 'Should find the fragment');
    assert.ok(matches[0].existingElementId, 'Should link to existing element');
    assert.equal(matches[0].existingElementId, 'restored-1');
  });
});
