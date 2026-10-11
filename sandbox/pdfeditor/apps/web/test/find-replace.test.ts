/**
 * Tests for find & replace over native PDF text (store/findTextMatches +
 * replaceTextMatch). Direct editing: replacements only commit when the
 * fragment's run can be rewritten directly in the content stream
 * (no masks); non-editable fragments are SKIPPED with an explanation.
 *
 * Run from apps/web: node --experimental-strip-types --loader ./test/loader.mjs --test test/find-replace.test.ts
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { useEditor } from '../store/editor.ts';
import { clearDirectProbeCache } from '../lib/direct-probe.ts';

const LINE1 = 'Quarterly Report Q3 2026';
const LINE2 = 'Revenue grew 18% year over year.';
const LINE3 = 'Quarterly summary for Q3.';

/** Real bytes whose content runs match the nativeText fixtures below. */
async function makePdfBytes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(LINE1, { x: 100, y: 200, size: 14, font });
  page.drawText(LINE2, { x: 100, y: 250, size: 14, font });
  const page2 = doc.addPage([612, 792]);
  page2.drawText(LINE3, { x: 100, y: 200, size: 14, font });
  return doc.save();
}

function makePage(id, sourceIndex) {
  return {
    id,
    sourceIndex,
    width: 612,
    height: 792,
    rotation: 0,
  };
}

function makeNativeItem(pageId, text, x = 100, baselineY = 200) {
  return {
    id: `nt-${pageId}-${x}-${baselineY}`,
    x,
    y: baselineY - 4.2, // box bottom; baseline = y + baselineOffset
    width: 150,
    height: 20,
    baselineOffset: 4.2,
    text,
    fontSize: 14,
    fontFamily: 'Helvetica',
    bold: false,
    italic: false,
  };
}

describe('find & replace', () => {
  beforeEach(async () => {
    clearDirectProbeCache();
    const pdfBytes = await makePdfBytes();
    const page1 = makePage('page-1', 1);
    const page2 = makePage('page-2', 2);
    useEditor.setState((s) => {
      s.pdfBytes = pdfBytes;
      s.pages = [page1, page2];
      s.elements = {};
      s.nativeText = {
        'page-1': [
          makeNativeItem('page-1', LINE1, 100, 200),
          makeNativeItem('page-1', LINE2, 100, 250),
        ],
        'page-2': [
          makeNativeItem('page-2', LINE3, 100, 200),
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

  it('replaceTextMatch creates a native-text element (directly editable)', async () => {
    const state = useEditor.getState();
    const matches = state.findTextMatches('Quarterly', false);
    assert.ok(matches.length > 0);

    const match = matches[0];
    const id = await state.replaceTextMatch(match.pageId, match.item, 'Quarterly', 'Annual', false);
    assert.ok(id && id !== 'skipped', 'Should return element ID');

    const el = useEditor.getState().elements[id as string];
    assert.ok(el, 'Element should exist');
    assert.equal(el.kind, 'native-text');
    assert.ok(el.text.includes('Annual'), 'Text should contain replacement');
    assert.ok(!el.text.includes('Quarterly'), 'Text should not contain query');
    if (el.kind === 'native-text') {
      assert.equal(el.originX, match.item.x, 'original fragment position pinned');
      assert.equal(el.originY, match.item.y);
    }
  });

  it('replaceTextMatch skips a fragment that cannot be edited directly', async () => {
    const state = useEditor.getState();
    const page = state.pages[0];
    const bogus = makeNativeItem('page-1', 'Text that is not in the document', 400, 400);
    const result = await state.replaceTextMatch(page.id, bogus, 'Text', 'Other', false);
    assert.equal(result, 'skipped', 'non-editable fragment must be skipped, not masked');
    assert.equal(Object.keys(useEditor.getState().elements).length, 0, 'no element created');
  });

  it('replaceTextMatch updates existing element (no duplicate)', async () => {
    const state = useEditor.getState();
    const matches = state.findTextMatches('Quarterly', false);
    const match = matches[0];

    // First replacement
    const id1 = await state.replaceTextMatch(match.pageId, match.item, 'Quarterly', 'Annual', false);
    const count1 = Object.keys(useEditor.getState().elements).length;

    // Second replacement on same fragment
    const id2 = await useEditor.getState().replaceTextMatch(match.pageId, match.item, 'Annual', 'Fiscal', false);
    const count2 = Object.keys(useEditor.getState().elements).length;

    assert.equal(id1, id2, 'Should reuse the same element ID');
    assert.equal(count1, count2, 'Should not create duplicate elements');

    const el = useEditor.getState().elements[id2 as string];
    assert.ok(el.text.includes('Fiscal'), 'Text should be updated');
  });

  it('replaceTextMatch is undoable', async () => {
    const state = useEditor.getState();
    const matches = state.findTextMatches('Quarterly', false);
    const match = matches[0];

    await state.replaceTextMatch(match.pageId, match.item, 'Quarterly', 'Annual', false);
    assert.equal(Object.keys(useEditor.getState().elements).length, 1);

    useEditor.getState().undo();
    assert.equal(Object.keys(useEditor.getState().elements).length, 0, 'Undo should remove the element');
  });

  it('findTextMatches includes existingElementId for already-replaced fragments', async () => {
    const state = useEditor.getState();
    let matches = state.findTextMatches('Quarterly', false);
    const match = matches[0];
    assert.equal(match.existingElementId, null, 'No existing element initially');

    await state.replaceTextMatch(match.pageId, match.item, 'Quarterly', 'Annual', false);

    // Search for the replacement text
    matches = useEditor.getState().findTextMatches('Annual', false);
    // The fragment's original text still contains "Quarterly", but the element has "Annual"
    // findTextMatches searches the nativeText items, not elements
    // So we need to check via the item
    const updatedMatches = useEditor.getState().findTextMatches('Quarterly', false);
    assert.ok(updatedMatches[0].existingElementId, 'Should have existing element ID');
  });

  it('replaceTextMatch on a mask (deleted fragment) restores with replacement', async () => {
    const state = useEditor.getState();
    const matches = state.findTextMatches('Quarterly', false);
    const match = matches[0];

    // Create a mask by deleting (simulating the deletion fix)
    const elId = await state.replaceTextMatch(match.pageId, match.item, 'Quarterly', 'Annual', false);
    assert.ok(elId && elId !== 'skipped');
    // Delete it → becomes mask (empty text)
    state.deleteElement(elId as string);
    const mask = useEditor.getState().elements[elId as string];
    assert.ok(mask, 'Mask should exist');
    assert.equal(mask.kind, 'native-text');
    if (mask.kind === 'native-text') {
      assert.equal(mask.text, '', 'Mask should have empty text');
    }

    // Now Find & Replace on the original query should restore into the mask
    const id2 = await useEditor.getState().replaceTextMatch(
      match.pageId, match.item, 'Quarterly', 'Fiscal', false
    );
    assert.equal(id2, elId, 'Should reuse the mask element');
    const restored = useEditor.getState().elements[elId as string];
    assert.ok(restored && restored.kind === 'native-text');
    if (restored.kind === 'native-text') {
      assert.ok(restored.text.includes('Fiscal'), 'Mask should now contain replacement');
      assert.ok(!restored.text.includes('Quarterly'), 'Original should be replaced');
    }
  });
});
