/**
 * Tests for the floating form-field properties editor
 * (lib/form-field-props + components/FloatingFormFieldToolbar):
 * target selection (created fields only), field switching, name
 * validation, and the max-length / font-size input parsers. Also pins
 * the form-field input spacing fix in ElementOverlay (zero internal
 * padding/margin, line height matching the exported appearance) and
 * the toolbar wiring (bound fields get no editor).
 *
 * Run from apps/web: node --experimental-strip-types --loader ./test/loader.mjs --test test/form-field-props.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formFieldEditorTarget,
  parseFontSizeInput,
  parseMaxLengthInput,
  validateFieldName,
} from '../lib/form-field-props.ts';

const DIR = path.dirname(fileURLToPath(import.meta.url));

let seq = 0;
function field(over: Record<string, unknown> = {}) {
  seq += 1;
  return {
    id: `el-${seq}`,
    pageId: 'page-1',
    kind: 'form-field',
    x: 100,
    y: 600,
    rotation: 0,
    fieldType: 'text',
    name: `field${seq}`,
    value: '',
    checked: false,
    required: false,
    maxLength: null,
    fontSize: 12,
    width: 180,
    height: 24,
    fieldOrder: seq - 1,
    ...over,
  } as never;
}

function record(...els: Array<{ id: string }>) {
  const r: Record<string, never> = {};
  for (const el of els) r[el.id] = el as never;
  return r;
}

describe('formFieldEditorTarget (selection)', () => {
  it('binds to the selected created field', () => {
    const a = field({ name: 'fieldA' });
    const elements = record(a);
    const t = formFieldEditorTarget(elements, a.id);
    assert.equal(t?.id, a.id);
    assert.equal(t?.name, 'fieldA');
  });

  it('shows no editor for a bound field (its properties come from the PDF)', () => {
    const b = field({ name: 'FullName', boundField: 'FullName' });
    assert.equal(formFieldEditorTarget(record(b), b.id), null);
  });

  it('shows no editor when nothing or a non-field element is selected', () => {
    const a = field();
    const text = { id: 'txt-1', kind: 'text' } as never;
    assert.equal(formFieldEditorTarget(record(a), null), null);
    assert.equal(formFieldEditorTarget(record(a, text), 'txt-1'), null);
    assert.equal(formFieldEditorTarget(record(a), 'missing-id'), null);
  });

  it('switching the selection switches the edited field', () => {
    const a = field({ name: 'first', fontSize: 12 });
    const b = field({ name: 'second', fontSize: 20, required: true });
    const elements = record(a, b);
    assert.equal(formFieldEditorTarget(elements, a.id)?.name, 'first');
    const t2 = formFieldEditorTarget(elements, b.id);
    assert.equal(t2?.name, 'second');
    assert.equal(t2?.fontSize, 20);
    assert.equal(t2?.required, true);
  });
});

describe('validateFieldName', () => {
  it('accepts a fresh unique name and trims whitespace', () => {
    const a = field({ name: 'field1' });
    const v = validateFieldName(record(a), '  customer_name  ', a.id);
    assert.deepEqual(v, { ok: true, name: 'customer_name' });
  });

  it('accepts keeping the field\u2019s own current name', () => {
    const a = field({ name: 'field1' });
    assert.deepEqual(validateFieldName(record(a), 'field1', a.id), {
      ok: true,
      name: 'field1',
    });
  });

  it('rejects empty and whitespace-only names', () => {
    const a = field();
    assert.equal(validateFieldName(record(a), '', a.id).ok, false);
    const v = validateFieldName(record(a), '   ', a.id);
    assert.equal(v.ok, false);
    if (!v.ok) assert.match(v.error, /cannot be empty/);
  });

  it('rejects a name another field already uses', () => {
    const a = field({ name: 'alpha' });
    const b = field({ name: 'beta' });
    const v = validateFieldName(record(a, b), 'alpha', b.id);
    assert.equal(v.ok, false);
    if (!v.ok) assert.match(v.error, /already used by another field/);
  });

  it('rejects names over the 128-character schema limit', () => {
    const a = field();
    const v = validateFieldName(record(a), 'x'.repeat(129), a.id);
    assert.equal(v.ok, false);
  });
});

describe('parseMaxLengthInput', () => {
  it('empty means no limit', () => assert.equal(parseMaxLengthInput(''), null));
  it('parses a plain limit', () => assert.equal(parseMaxLengthInput('20'), 20));
  it('floors decimals', () => assert.equal(parseMaxLengthInput('3.9'), 3));
  it('clamps zero and negatives up to 1', () => {
    assert.equal(parseMaxLengthInput('0'), 1);
    assert.equal(parseMaxLengthInput('-5'), 1);
  });
  it('non-numeric input clears the limit', () =>
    assert.equal(parseMaxLengthInput('abc'), null));
});

describe('parseFontSizeInput', () => {
  it('parses integer and decimal sizes', () => {
    assert.equal(parseFontSizeInput('18'), 18);
    assert.equal(parseFontSizeInput('12.5'), 12.5);
  });
  it('empty or invalid input yields null (no commit)', () => {
    assert.equal(parseFontSizeInput(''), null);
    assert.equal(parseFontSizeInput('abc'), null);
    assert.equal(parseFontSizeInput('-3'), null);
    assert.equal(parseFontSizeInput('0'), null);
  });
  it('sub-1 sizes clamp to 1', () => assert.equal(parseFontSizeInput('0.5'), 1));
});

describe('form-field input spacing (ElementOverlay source)', () => {
  const src = fs.readFileSync(
    path.join(DIR, '..', 'components', 'ElementOverlay.tsx'),
    'utf8',
  );
  const formFieldInput = src.slice(src.indexOf('function FormFieldInput'));

  it('the field control has zero internal padding and margin', () => {
    assert.match(formFieldInput, /padding:\s*0/);
    assert.match(formFieldInput, /margin:\s*0/);
    assert.ok(
      !formFieldInput.includes("padding: '1px 4px'"),
      'the old 1px/4px internal padding must stay gone',
    );
  });

  it('line height matches the exported appearance (fontSize * 1.2)', () => {
    assert.match(formFieldInput, /lineHeight:\s*1\.2/);
  });

  it('the floating editor is wired for created fields only', () => {
    assert.match(src, /FloatingFormFieldToolbar/);
    assert.match(src, /sel\.kind === 'form-field' && !sel\.boundField/);
  });
});

describe('FloatingFormFieldToolbar (source)', () => {
  const src = fs.readFileSync(
    path.join(DIR, '..', 'components', 'FloatingFormFieldToolbar.tsx'),
    'utf8',
  );

  it('exposes exactly the four property controls with the established undo labels', () => {
    assert.match(src, /'Rename field'/);
    assert.match(src, /'Toggle field required'/);
    assert.match(src, /'Edit max length'/);
    assert.match(src, /'Edit field font size'/);
  });

  it('follows the floating-toolbar pattern (shared positioning + shell)', () => {
    assert.match(src, /useFloatingToolbarPosition/);
    assert.match(src, /useToolbarEvents/);
    assert.match(src, /role="toolbar"/);
  });
});
