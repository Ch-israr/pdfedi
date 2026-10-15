/**
 * @pdfeditor/pdf-core — AcroForm form-field support.
 *
 * Two complementary halves:
 *
 *  1. FILL (Phase A): `detectFormFields()` enumerates the AcroForm fields of
 *     an uploaded PDF and turns them into bound `form-field` editor
 *     elements (one per widget). `applyFormFills()` writes the filled
 *     values back onto the SOURCE document's form first; the normal export
 *     pipeline then copies the pages (widgets and their appearance streams
 *     come along), and `attachCopiedFormFields()` rebuilds the /AcroForm
 *     catalog in the output so the result stays a fillable form.
 *
 *  2. CREATE (Phase B): `addCreatedFormFields()` writes editor-created
 *     `form-field` elements (those without `boundField`) as real AcroForm
 *     fields on the output document via pdf-lib's form API.
 *
 * Pure, framework-free — no DOM, no Node APIs.
 */
import {
  PDFDocument,
  PDFName,
  PDFString,
  PDFArray,
  PDFDict,
  PDFRef,
  PDFBool,
  type PDFPage,
} from 'pdf-lib';
import type { EditorElement, Page, FormFieldElement } from '@pdfeditor/shared';

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

function dictOf(doc: PDFDocument, obj: unknown): PDFDict | null {
  try {
    const looked = doc.context.lookup(obj as PDFRef) as PDFDict;
    return looked instanceof PDFDict ? looked : null;
  } catch {
    return null;
  }
}

function textOf(dict: PDFDict, name: string): string | undefined {
  const v = dict.lookup(PDFName.of(name)) as { decodeText?: () => string } | undefined;
  if (v && typeof v.decodeText === 'function') {
    try {
      return v.decodeText();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function num(dict: PDFDict, name: string): number | undefined {
  const v = dict.lookup(PDFName.of(name)) as { asNumber?: () => number } | undefined;
  return v && typeof v.asNumber === 'function' ? v.asNumber() : undefined;
}

function numArray(dict: PDFDict, name: string): number[] | null {
  const arr = dict.lookup(PDFName.of(name)) as PDFArray | undefined;
  if (!(arr instanceof PDFArray)) return null;
  const out: number[] = [];
  for (let i = 0; i < arr.size(); i++) {
    const v = arr.lookup(i) as { asNumber?: () => number };
    if (typeof v?.asNumber !== 'function') return null;
    out.push(v.asNumber());
  }
  return out;
}

/** Follow /Parent chain from a widget annotation to its field root. */
function fieldRootOf(doc: PDFDocument, annotRef: unknown): { dict: PDFDict; ref: unknown } | null {
  let node = dictOf(doc, annotRef);
  if (!node) return null;
  let ref: unknown = annotRef;
  for (let guard = 0; guard < 10; guard++) {
    const parentRef = node.get(PDFName.of('Parent'));
    if (!parentRef) break;
    const parent = dictOf(doc, parentRef);
    if (!parent) break;
    node = parent;
    ref = parentRef;
  }
  return { dict: node, ref };
}

/** Partial /DA parse (font size only) — mirrors annotations.ts parseDa. */
function daFontSize(da: string | undefined): number {
  if (!da) return 12;
  const tf = da.match(/\/[A-Za-z0-9-]+\s+([\d.]+)\s+Tf/);
  return (tf && parseFloat(tf[1])) || 12;
}

/** Unique element id (UUID-shaped, like the store's crypto.randomUUID). */
function newId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ---------------------------------------------------------------------------
// FILL — detect existing AcroForm fields
// ---------------------------------------------------------------------------

export interface DetectSummary {
  bound: FormFieldElement[];
  /** Fields skipped because they have no supported widget / type. */
  skipped: number;
}

/**
 * Enumerate the source PDF's AcroForm fields and produce one bound
 * `form-field` editor element per widget annotation.
 *
 * Supported: text fields (incl. multiline), checkboxes, radio groups,
 * dropdowns/listboxes. Skipped (and counted): signature fields,
 * pushbuttons, fields with no name or no widget rectangle.
 */
export async function detectFormFields(
  srcBytes: Uint8Array,
  pages: Page[],
): Promise<DetectSummary> {
  const doc = await PDFDocument.load(srcBytes, { ignoreEncryption: false });
  const bound: FormFieldElement[] = [];
  let skipped = 0;
  const usedNames = new Set<string>();

  const srcPages = doc.getPages();
  for (let srcIdx = 0; srcIdx < srcPages.length; srcIdx++) {
    const pageId = pages.find((p) => p.sourceIndex === srcIdx + 1)?.id;
    if (!pageId) continue;
    const annots = srcPages[srcIdx].node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const annotRef = annots.get(i);
      const annot = dictOf(doc, annotRef);
      if (!annot) continue;
      if (String(annot.get(PDFName.of('Subtype'))) !== '/Widget') continue;
      const rect = numArray(annot, 'Rect');
      if (!rect || rect.length < 4) {
        skipped++;
        continue;
      }
      const root = fieldRootOf(doc, annotRef);
      if (!root) {
        skipped++;
        continue;
      }
      const fieldDict = root.dict;
      const ft = String(fieldDict.get(PDFName.of('FT')) ?? annot.get(PDFName.of('FT')) ?? '');
      const flags = num(fieldDict, 'Ff') ?? 0;
      let name = textOf(fieldDict, 'T') ?? textOf(annot, 'T');
      if (!name) {
        skipped++;
        continue;
      }
      // Signature fields and pushbuttons are out of scope.
      if (ft === '/Sig' || (ft === '/Btn' && (flags & (1 << 16)) !== 0)) {
        skipped++;
        continue;
      }

      const [x0, y0, x1, y1] = rect;
      const w = Math.abs(x1 - x0);
      const h = Math.abs(y1 - y0);
      if (w <= 0 || h <= 0) {
        skipped++;
        continue;
      }
      let elName = name;
      let dup = 2;
      while (usedNames.has(elName)) elName = `${name}#${dup++}`;
      usedNames.add(elName);

      const required = (flags & 0x2) !== 0;
      const maxLength = num(fieldDict, 'MaxLen') ?? num(annot, 'MaxLen') ?? null;
      const daSize = daFontSize(textOf(fieldDict, 'DA') ?? textOf(annot, 'DA'));
      const base = {
        id: newId(),
        pageId,
        kind: 'form-field' as const,
        x: Math.min(x0, x1),
        y: Math.min(y0, y1),
        rotation: 0,
        name: elName,
        boundField: name,
        required,
        maxLength: maxLength && maxLength > 0 ? Math.floor(maxLength) : null,
        fontSize: daSize,
        width: w,
        height: h,
      };

      if (ft === '/Tx') {
        const value = textOf(fieldDict, 'V') ?? '';
        bound.push({
          ...base,
          fieldType: (flags & 0x1000) !== 0 ? 'multiline' : 'text',
          value,
          checked: false,
          fieldOrder: 0,
        });
      } else if (ft === '/Btn' && (flags & (1 << 15)) !== 0) {
        // Radio group (Radios = field-flags bit 16): one element per
        // widget. Option export values live in the field's /Opt array in
        // kid order; the widget's own appearance on-state is index-based
        // (/0, /1, …), so map kid index -> /Opt entry.
        const kids = fieldDict.lookup(PDFName.of('Kids')) as PDFArray | undefined;
        const optArr = fieldDict.lookup(PDFName.of('Opt')) as PDFArray | undefined;
        const optOf = (k: number): string | undefined => {
          if (optArr instanceof PDFArray && k < optArr.size()) {
            const entry = optArr.lookup(k) as { decodeText?: () => string } | undefined;
            if (entry && typeof entry.decodeText === 'function') return entry.decodeText();
          }
          return undefined;
        };
        const kidList: { ref: string; onState?: string }[] = [];
        if (kids instanceof PDFArray) {
          for (let k = 0; k < kids.size(); k++) {
            const kidRef = kids.get(k);
            const kid = dictOf(doc, kidRef);
            let onState: string | undefined;
            if (kid) {
              const ap = dictOf(doc, kid.lookup(PDFName.of('AP')));
              const n = ap ? dictOf(doc, ap.lookup(PDFName.of('N'))) : null;
              if (n) {
                for (const [key] of n.entries()) {
                  const ks = String(key);
                  if (ks !== '/Off') onState = ks.startsWith('/') ? ks.slice(1) : ks;
                }
              }
            }
            kidList.push({ ref: String(kidRef), onState });
          }
        }
        const options = kidList.map((kid, k) => optOf(k) ?? kid.onState ?? `option${k + 1}`);
        // Group value: /V is the selected kid's on-state name.
        const rawV = fieldDict.lookup(PDFName.of('V'));
        const vName =
          rawV && String(rawV) !== '/Off'
            ? String(rawV).startsWith('/')
              ? String(rawV).slice(1)
              : String(rawV)
            : '';
        const vIndex = kidList.findIndex((kid) => kid.onState === vName);
        const value = vIndex >= 0 ? options[vIndex] : '';
        // Which option does THIS widget represent? Match by widget ref.
        const myIndex = kidList.findIndex((kid) => kid.ref === String(annotRef));
        const radioOption =
          myIndex >= 0 ? options[myIndex] : kidList.length > 0 ? options[0] : undefined;
        bound.push({
          ...base,
          fieldType: 'radio',
          value,
          checked: false,
          options,
          radioOption,
          fieldOrder: 0,
        });
      } else if (ft === '/Btn') {
        // Checkbox.
        const rawV = fieldDict.lookup(PDFName.of('V'));
        const checked = !!rawV && String(rawV) !== '/Off';
        bound.push({ ...base, fieldType: 'checkbox', value: '', checked, fieldOrder: 0 });
      } else if (ft === '/Ch') {
        const value = textOf(fieldDict, 'V') ?? '';
        const optArr = fieldDict.lookup(PDFName.of('Opt')) as PDFArray | undefined;
        const options: string[] = [];
        if (optArr instanceof PDFArray) {
          for (let k = 0; k < optArr.size(); k++) {
            const entry = optArr.lookup(k);
            if (entry instanceof PDFArray && entry.size() > 1) {
              // [exportValue, displayValue] pair — use the display value.
              const disp = entry.lookup(1) as { decodeText?: () => string } | undefined;
              options.push(
                disp && typeof disp.decodeText === 'function' ? disp.decodeText() : String(disp),
              );
            } else {
              const s = entry as { decodeText?: () => string } | undefined;
              options.push(
                s && typeof s.decodeText === 'function' ? s.decodeText() : String(entry),
              );
            }
          }
        }
        bound.push({ ...base, fieldType: 'dropdown', value, checked: false, options, fieldOrder: 0 });
      } else {
        skipped++;
      }
    }
  }
  return { bound, skipped };
}

// ---------------------------------------------------------------------------
// FILL — write bound values onto the source document first
// ---------------------------------------------------------------------------

/**
 * Apply filled values of bound `form-field` elements onto the SOURCE
 * document's AcroForm and return the new bytes. The caller then runs the
 * normal export pipeline on these bytes: page copying carries the widgets
 * (with freshly generated appearances) into the output, and
 * `attachCopiedFormFields()` rebuilds the catalog so the form stays
 * interactive.
 */
export async function applyFormFills(
  srcBytes: Uint8Array,
  elements: Record<string, EditorElement>,
): Promise<Uint8Array> {
  const bound = Object.values(elements).filter(
    (e): e is FormFieldElement =>
      e.kind === 'form-field' && !!(e as FormFieldElement).boundField,
  );
  if (bound.length === 0) return srcBytes;
  const doc = await PDFDocument.load(srcBytes, { ignoreEncryption: false });
  const form = doc.getForm();
  for (const el of bound) {
    const name = el.boundField!;
    try {
      if (el.fieldType === 'checkbox') {
        const f = form.getCheckBox(name);
        if (el.checked) f.check();
        else f.uncheck();
      } else if (el.fieldType === 'radio') {
        // Each radio widget is a bound element sharing the group name:
        // only the element whose option matches the group's current value
        // selects. Others are left alone so sibling widgets never clear
        // each other's selection.
        if (el.value && el.radioOption && el.value === el.radioOption) {
          form.getRadioGroup(name).select(el.value);
        }
      } else if (el.fieldType === 'dropdown') {
        form.getDropdown(name).select(el.value);
      } else {
        form.getTextField(name).setText(el.value ?? '');
      }
    } catch {
      // Field renamed/removed/flattened since detection — skip honestly.
    }
  }
  form.updateFieldAppearances();
  return doc.save();
}

// ---------------------------------------------------------------------------
// CREATE — add editor-created fields as real AcroForm fields on the output
// ---------------------------------------------------------------------------

/**
 * Write created (non-bound) `form-field` elements as AcroForm fields on the
 * output document via pdf-lib's form API. Elements are processed in
 * fieldOrder (creation order). If a created name collides with a field
 * already in the source PDF (or an earlier created field), it is suffixed
 * uniquely ("name-2", "name-3", …) instead of crashing.
 *
 * Returns the final names of the created fields, so the catalog rebuild
 * can skip them (pdf-lib already registered those itself).
 */
export async function addCreatedFormFields(
  out: PDFDocument,
  src: PDFDocument,
  pages: Page[],
  elements: Record<string, EditorElement>,
): Promise<string[]> {
  const created = Object.values(elements)
    .filter(
      (e): e is FormFieldElement =>
        e.kind === 'form-field' &&
        !(e as FormFieldElement).boundField &&
        !(e as unknown as { baked?: boolean }).baked &&
        !(e as unknown as { deleted?: boolean }).deleted,
    )
    .sort((a, b) => a.fieldOrder - b.fieldOrder);
  if (created.length === 0) return [];

  // Names already taken by the source document's own form.
  const taken = new Set<string>();
  try {
    for (const f of src.getForm().getFields()) {
      const n = f.getName();
      if (n) taken.add(n);
    }
  } catch {
    // No readable form on the source — nothing taken.
  }

  const pageById = new Map<string, PDFPage>();
  pages.forEach((p, i) => {
    try {
      pageById.set(p.id, out.getPage(i));
    } catch {
      /* page index out of range — element skipped below */
    }
  });

  const form = out.getForm();
  const finalNames: string[] = [];
  for (const el of created) {
    const page = pageById.get(el.pageId);
    if (!page) continue;
    let name = el.name;
    let n = 2;
    while (taken.has(name)) name = `${el.name}-${n++}`;
    taken.add(name);
    finalNames.push(name);
    const rect = { x: el.x, y: el.y, width: el.width, height: el.height };
    try {
      if (el.fieldType === 'checkbox') {
        const f = form.createCheckBox(name);
        f.addToPage(page, rect);
        if (el.required) f.enableRequired();
        if (el.checked) f.check();
        else f.uncheck();
      } else {
        const f = form.createTextField(name);
        f.addToPage(page, rect);
        if (el.fieldType === 'multiline') f.enableMultiline();
        if (el.maxLength) f.setMaxLength(el.maxLength);
        if (el.required) f.enableRequired();
        f.setFontSize(el.fontSize);
        f.setText(el.value ?? '');
      }
    } catch {
      // One bad field must not fail the whole export.
      taken.delete(name);
      finalNames.pop();
    }
  }
  form.updateFieldAppearances();
  return finalNames;
}

/**
 * Rebuild the /AcroForm catalog in the output document from widget
 * annotations carried over by page copying. pdf-lib's copyPages() copies
 * the widgets (with their updated values/appearances) but not the catalog,
 * so without this step the filled form would be invisible to readers.
 *
 * Fields already registered by pdf-lib itself (created via getForm —
 * `skipNames`) are left alone; their refs are merged into the same
 * /Fields array if a catalog entry already exists.
 */
export function attachCopiedFormFields(out: PDFDocument, skipNames: Set<string>): void {
  const fieldRefs: PDFRef[] = [];
  const seen = new Set<string>();
  for (const page of out.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const annotRef = annots.get(i);
      const annot = dictOf(out, annotRef);
      if (!annot) continue;
      if (String(annot.get(PDFName.of('Subtype'))) !== '/Widget') continue;
      const root = fieldRootOf(out, annotRef);
      if (!root) continue;
      const tObj = root.dict.get(PDFName.of('T'));
      const name =
        tObj && typeof (tObj as unknown as PDFString).decodeText === 'function'
          ? (tObj as unknown as PDFString).decodeText()
          : undefined;
      if (!name || skipNames.has(name)) continue;
      // Resolve the field root to an indirect reference for /Fields.
      let ref: unknown = root.ref;
      if (!(ref instanceof PDFRef)) {
        ref = out.context.register(root.dict);
      }
      const key = String(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      fieldRefs.push(ref as PDFRef);
    }
  }
  if (fieldRefs.length === 0) return;
  const existing = out.catalog.lookup(PDFName.of('AcroForm'));
  if (existing instanceof PDFDict) {
    const current = existing.lookup(PDFName.of('Fields'));
    const fields: PDFArray =
      current instanceof PDFArray ? current : (out.context.obj([]) as PDFArray);
    if (!(current instanceof PDFArray)) existing.set(PDFName.of('Fields'), fields);
    for (const r of fieldRefs) {
      let present = false;
      for (let i = 0; i < fields.size(); i++) {
        if (String(fields.lookup(i)) === String(r)) {
          present = true;
          break;
        }
      }
      if (!present) fields.push(r);
    }
  } else {
    out.catalog.set(
      PDFName.of('AcroForm'),
      out.context.obj({ Fields: fieldRefs, NeedAppearances: PDFBool.False }),
    );
  }
}
