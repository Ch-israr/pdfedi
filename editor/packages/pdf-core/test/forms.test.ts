/**
 * Tests for AcroForm form-field support (fill + create):
 * - detectFormFields enumerates existing fields into bound elements
 * - applyFormFills writes bound values onto the source document's form
 * - exportAnnotatedPdf writes created fields as real AcroForm fields and
 *   keeps filled existing fields interactive (rebuilt /AcroForm)
 *
 * Run from packages/pdf-core: node --test test/forms.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName } from 'pdf-lib';
import {
  detectFormFields,
  applyFormFills,
  exportAnnotatedPdf,
} from '../dist/index.js';
import type { EditorElement, FormFieldElement, Page } from '@pdfeditor/shared';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FIX = (n: string) => fs.readFileSync(path.join(DIR, 'fixtures', n));

const PAGE_ID = '123e4567-e89b-12d3-a456-426614174000';
function page(sourceIndex = 1): Page {
  return { id: PAGE_ID, sourceIndex, width: 612, height: 792, rotation: 0 };
}
function createdField(over: Partial<FormFieldElement> = {}): FormFieldElement {
  return {
    id: crypto.randomUUID(),
    pageId: PAGE_ID,
    kind: 'form-field',
    x: 100,
    y: 600,
    rotation: 0,
    fieldType: 'text',
    name: 'field1',
    value: '',
    checked: false,
    required: false,
    maxLength: null,
    fontSize: 12,
    width: 180,
    height: 24,
    fieldOrder: 0,
    ...over,
  };
}

describe('detectFormFields', () => {
  it('finds no fields in a flat form PDF', async () => {
    const { bound, skipped } = await detectFormFields(FIX('flat-form.pdf'), [page()]);
    assert.equal(bound.length, 0);
    assert.equal(skipped, 0);
  });

  it('binds text, dropdown, checkbox and radio widgets', async () => {
    const { bound, skipped } = await detectFormFields(FIX('fillable-form.pdf'), [page()]);
    assert.equal(skipped, 0);
    const byName = new Map(bound.map((e) => [e.name, e]));
    // 5 widgets: FullName, Country, Agree, Gender x2
    assert.equal(bound.length, 5);
    const full = byName.get('FullName')!;
    assert.equal(full.fieldType, 'text');
    assert.equal(full.boundField, 'FullName');
    assert.equal(full.required, true);
    assert.equal(full.maxLength, 50);
    assert.equal(full.pageId, PAGE_ID);
    assert.ok(full.width > 200 && full.height > 10, `rect ${full.width}x${full.height}`);
    const agree = byName.get('Agree')!;
    assert.equal(agree.fieldType, 'checkbox');
    assert.equal(agree.checked, false);
    const country = byName.get('Country')!;
    assert.equal(country.fieldType, 'dropdown');
    assert.deepEqual(country.options, ['UAE', 'UK', 'US']);
    const radios = bound.filter((e) => e.fieldType === 'radio');
    assert.equal(radios.length, 2);
    assert.deepEqual(
      radios.map((r) => r.radioOption).sort(),
      ['Female', 'Male'],
    );
    // element names are unique within the document
    assert.equal(new Set(bound.map((e) => e.name)).size, 5);
  });
});

describe('applyFormFills', () => {
  it('is a passthrough when no bound fields exist', async () => {
    const bytes = FIX('flat-form.pdf');
    const out = await applyFormFills(new Uint8Array(bytes), {});
    assert.deepEqual(Buffer.from(out), Buffer.from(bytes));
  });

  it('writes filled values onto the source form', async () => {
    const { bound } = await detectFormFields(FIX('fillable-form.pdf'), [page()]);
    const elements: Record<string, EditorElement> = {};
    for (const el of bound) {
      if (el.name === 'FullName') el.value = 'John Smith';
      if (el.name === 'Agree') el.checked = true;
      if (el.name === 'Country') el.value = 'UK';
      if (el.fieldType === 'radio' && el.radioOption === 'Female') el.value = 'Female';
      elements[el.id] = el;
    }
    const filled = await applyFormFills(new Uint8Array(FIX('fillable-form.pdf')), elements);
    const doc = await PDFDocument.load(filled);
    const form = doc.getForm();
    assert.equal(form.getTextField('FullName').getText(), 'John Smith');
    assert.equal(form.getCheckBox('Agree').isChecked(), true);
    assert.equal(form.getDropdown('Country').getSelected()[0], 'UK');
    assert.equal(form.getRadioGroup('Gender').getSelected(), 'Female');
  });
});

describe('exportAnnotatedPdf with form fields', () => {
  it('writes created fields as real AcroForm fields with flags', async () => {
    const elements: Record<string, EditorElement> = {};
    const t1 = createdField({
      name: 'field1',
      value: 'John Smith',
      required: true,
      maxLength: 20,
      fontSize: 14,
    });
    const cb = createdField({
      id: crypto.randomUUID(),
      name: 'field2',
      fieldType: 'checkbox',
      checked: true,
      width: 18,
      height: 18,
      x: 100,
      y: 550,
      fieldOrder: 1,
    });
    const ml = createdField({
      id: crypto.randomUUID(),
      name: 'notes',
      fieldType: 'multiline',
      value: 'line1\nline2',
      width: 180,
      height: 72,
      x: 100,
      y: 450,
      fieldOrder: 2,
    });
    for (const e of [t1, cb, ml]) elements[e.id] = e;
    const out = await exportAnnotatedPdf({
      srcBytes: new Uint8Array(FIX('flat-form.pdf')),
      pages: [page()],
      elements,
    });
    const doc = await PDFDocument.load(out);
    const form = doc.getForm();
    const names = form.getFields().map((f) => f.getName());
    assert.deepEqual(names, ['field1', 'field2', 'notes']);
    assert.equal(form.getTextField('field1').getText(), 'John Smith');
    assert.equal(form.getCheckBox('field2').isChecked(), true);
    assert.equal(form.getTextField('notes').getText(), 'line1\nline2');
    // Flags: required + maxLength on field1
    const f1 = form.getTextField('field1');
    assert.equal(f1.isRequired(), true);
    assert.equal(f1.getMaxLength(), 20);
    assert.equal(form.getTextField('notes').isMultiline(), true);
    // Widget rects are sane (bottom-left origin, on the page; pdf-lib
    // expands the rect ~0.5pt per side for the widget border)
    const w = f1.acroField.getWidgets()[0].getRectangle();
    assert.ok(Math.abs(w.x - 100) < 2 && Math.abs(w.y - 600) < 2, JSON.stringify(w));
    assert.ok(Math.abs(w.width - 180) < 2 && Math.abs(w.height - 24) < 2);
  });

  it('exports a created field with the chosen font size in its DA string', async () => {
    const el = createdField({ name: 'field1', value: 'big text', fontSize: 18 });
    const out = await exportAnnotatedPdf({
      srcBytes: new Uint8Array(FIX('flat-form.pdf')),
      pages: [page()],
      elements: { [el.id]: el },
    });
    const doc = await PDFDocument.load(out);
    const da = doc.getForm().getTextField('field1').acroField.getDefaultAppearance();
    assert.ok(da, 'field has a DA entry');
    assert.match(da, /18\s+Tf/, `DA string: ${da}`);
  });

  it('suffixes created names that collide with existing source fields', async () => {
    const elements: Record<string, EditorElement> = {};
    const clash = createdField({ name: 'FullName', value: 'new' });
    elements[clash.id] = clash;
    const out = await exportAnnotatedPdf({
      srcBytes: new Uint8Array(FIX('fillable-form.pdf')),
      pages: [page()],
      elements,
    });
    const doc = await PDFDocument.load(out);
    const names = doc.getForm().getFields().map((f) => f.getName());
    assert.ok(names.includes('FullName'), names.join(','));
    assert.ok(names.includes('FullName-2'), names.join(','));
    assert.equal(doc.getForm().getTextField('FullName-2').getText(), 'new');
  });

  it('keeps filled existing fields interactive with their values', async () => {
    const { bound } = await detectFormFields(FIX('fillable-form.pdf'), [page()]);
    const elements: Record<string, EditorElement> = {};
    for (const el of bound) {
      if (el.name === 'FullName') el.value = 'John Smith';
      if (el.name === 'Agree') el.checked = true;
      elements[el.id] = el;
    }
    const filled = await applyFormFills(new Uint8Array(FIX('fillable-form.pdf')), elements);
    const out = await exportAnnotatedPdf({ srcBytes: filled, pages: [page()], elements });
    const doc = await PDFDocument.load(out);
    const form = doc.getForm();
    // AcroForm survived the page-copy pipeline and stays fillable
    assert.ok(form.getFields().some((f) => f.getName() === 'FullName'));
    assert.equal(form.getTextField('FullName').getText(), 'John Smith');
    assert.equal(form.getCheckBox('Agree').isChecked(), true);
    // Untouched existing fields also survive
    assert.ok(form.getFields().some((f) => f.getName() === 'Country'));
    // And remain editable: fill one more time on the OUTPUT
    form.getTextField('FullName').setText('Jane Doe');
    const again = await PDFDocument.load(await doc.save());
    assert.equal(again.getForm().getTextField('FullName').getText(), 'Jane Doe');
  });

  it('mixed: created + filled-existing fields coexist', async () => {
    const { bound } = await detectFormFields(FIX('fillable-form.pdf'), [page()]);
    const elements: Record<string, EditorElement> = {};
    for (const el of bound) {
      if (el.name === 'FullName') el.value = 'John Smith';
      elements[el.id] = el;
    }
    const created = createdField({ name: 'field1', value: 'extra', x: 100, y: 100 });
    elements[created.id] = created;
    const filled = await applyFormFills(new Uint8Array(FIX('fillable-form.pdf')), elements);
    const out = await exportAnnotatedPdf({ srcBytes: filled, pages: [page()], elements });
    const doc = await PDFDocument.load(out);
    const names = doc.getForm().getFields().map((f) => f.getName()).sort();
    for (const n of ['Agree', 'Country', 'FullName', 'Gender', 'field1']) {
      assert.ok(names.includes(n), `missing ${n} in ${names.join(',')}`);
    }
    assert.equal(doc.getForm().getTextField('FullName').getText(), 'John Smith');
    assert.equal(doc.getForm().getTextField('field1').getText(), 'extra');
    // Catalog has exactly one AcroForm
    assert.ok(doc.catalog.lookup(PDFName.of('AcroForm')));
  });
});
