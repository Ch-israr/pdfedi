/**
 * Regression tests for native-text deletion masking (Issue #1).
 *
 * Verifies that deleting a native-text replacement converts it to a mask
 * (empty text, position preserved) instead of removing it, so the original
 * source text stays covered. Deleting the mask removes it entirely.
 * Undo/Redo must restore the correct states.
 *
 * Run: node --test with the loader (see package.json test script)
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useEditor } from '../store/editor.ts';

/** Create a minimal native-text element for testing. */
function makeNativeTextElement(overrides = {}) {
  return {
    id: 'test-native-1',
    pageId: 'page-1',
    kind: 'native-text',
    x: 100,
    y: 200,
    rotation: 0,
    originalText: 'Quarterly Report Q3 2026',
    text: 'Audit Test',
    width: 150,
    height: 20,
    baselineOffset: 5,
    fontSize: 14,
    fontFamily: 'Helvetica',
    color: '#000000',
    bold: false,
    italic: false,
    ...overrides,
  };
}

describe('native-text deletion masking', () => {
  beforeEach(() => {
    // Reset store to a clean state with one native-text element
    useEditor.setState((s) => {
      s.elements = { 'test-native-1': makeNativeTextElement() };
      s.past = [];
      s.future = [];
      s.selectedId = null;
    });
  });

  it('deleting a native-text element with text converts it to a mask (not removed)', () => {
    const { deleteElement } = useEditor.getState();
    deleteElement('test-native-1');

    const el = useEditor.getState().elements['test-native-1'];
    assert.ok(el, 'Element should still exist (as mask)');
    assert.equal(el.kind, 'native-text');
    assert.equal(el.text, '', 'Text should be cleared');
    // Position/size preserved for the mask
    assert.equal(el.x, 100);
    assert.equal(el.y, 200);
    assert.equal(el.width, 150);
    assert.equal(el.height, 20);
    assert.equal(el.originalText, 'Quarterly Report Q3 2026');
  });

  it('deleting a mask (empty text) removes it entirely', () => {
    const state = useEditor.getState();
    // First delete converts to mask
    state.deleteElement('test-native-1');
    assert.ok(useEditor.getState().elements['test-native-1'], 'Mask should exist');

    // Second delete removes the mask
    useEditor.getState().deleteElement('test-native-1');
    assert.equal(
      useEditor.getState().elements['test-native-1'],
      undefined,
      'Mask should be removed, revealing original'
    );
  });

  it('undo after delete restores the original element with text', () => {
    const state = useEditor.getState();
    const originalText = state.elements['test-native-1'].text;
    assert.equal(originalText, 'Audit Test');

    state.deleteElement('test-native-1');
    assert.equal(useEditor.getState().elements['test-native-1'].text, '');

    useEditor.getState().undo();
    const restored = useEditor.getState().elements['test-native-1'];
    assert.ok(restored, 'Element should be restored');
    assert.equal(restored.text, 'Audit Test', 'Text should be restored');
  });

  it('redo after undo re-applies the mask', () => {
    const state = useEditor.getState();
    state.deleteElement('test-native-1');
    useEditor.getState().undo();
    assert.equal(useEditor.getState().elements['test-native-1'].text, 'Audit Test');

    useEditor.getState().redo();
    const el = useEditor.getState().elements['test-native-1'];
    assert.ok(el, 'Mask should exist after redo');
    assert.equal(el.text, '', 'Text should be cleared after redo');
  });

  it('deleting a non-native element removes it entirely (unchanged behavior)', () => {
    useEditor.setState((s) => {
      s.elements = {
        'text-1': {
          id: 'text-1',
          pageId: 'page-1',
          kind: 'text',
          x: 50,
          y: 50,
          rotation: 0,
          text: 'Hello',
          fontSize: 14,
          fontFamily: 'Helvetica',
          color: '#000000',
          bold: false,
          italic: false,
        },
      };
      s.past = [];
      s.future = [];
    });

    useEditor.getState().deleteElement('text-1');
    assert.equal(
      useEditor.getState().elements['text-1'],
      undefined,
      'Regular text element should be fully removed'
    );
  });

  it('history records the mask conversion with a clear label', () => {
    useEditor.getState().deleteElement('test-native-1');
    const log = useEditor.getState().historyLog;
    const lastEntry = log[log.length - 1];
    assert.ok(lastEntry, 'History should have an entry');
    assert.match(lastEntry.label, /delete native text/i);
  });
});
