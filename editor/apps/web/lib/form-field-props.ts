/**
 * Form-field properties-editor logic: which element the floating editor
 * binds to, plus parsing/validation for its four controls (name, required,
 * max length, font size). No DOM — safe for tests. The commit semantics
 * mirror the (unmounted) PropertiesPanel FormFieldSection so behaviour is
 * identical wherever the controls are hosted.
 */
import type { EditorElement, FormFieldElement } from '@pdfeditor/shared';
import { isFieldNameUnique } from '@/lib/form-fields';

type Elements = Record<string, EditorElement>;

/**
 * The element the floating properties editor edits: the current selection,
 * but only when it is a created form field. Bound fields take their name
 * and flags from the source PDF, so they get no editor (null).
 */
export function formFieldEditorTarget(
  elements: Elements,
  selectedId: string | null,
): FormFieldElement | null {
  if (!selectedId) return null;
  const el = elements[selectedId];
  if (!el || el.kind !== 'form-field') return null;
  if (el.boundField) return null;
  return el;
}

export type NameValidation =
  | { ok: true; name: string }
  | { ok: false; error: string };

/** Validate a candidate field name (trimmed, non-empty, ≤128, unique). */
export function validateFieldName(
  elements: Elements,
  raw: string,
  exceptId: string,
): NameValidation {
  const name = raw.trim();
  if (!name) return { ok: false, error: 'Name cannot be empty.' };
  if (name.length > 128) {
    return { ok: false, error: 'Name is too long (128 characters max).' };
  }
  if (!isFieldNameUnique(elements, name, exceptId)) {
    return { ok: false, error: `Name "${name}" is already used by another field.` };
  }
  return { ok: true, name };
}

/**
 * Parse the Max length input: empty means "no limit" (null); otherwise a
 * positive integer (decimals floor, values below 1 clamp to 1, non-numeric
 * input clears the limit — the same semantics the panel used).
 */
export function parseMaxLengthInput(raw: string): number | null {
  if (raw === '') return null;
  const v = Math.max(1, Math.floor(Number(raw)));
  return Number.isNaN(v) ? null : v;
}

/**
 * Parse the Font size input: a finite positive number, or null when the
 * input is empty/invalid (the caller then makes no commit, so a half-typed
 * value can never write a bad size into the model).
 */
export function parseFontSizeInput(raw: string): number | null {
  if (raw.trim() === '') return null;
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.max(1, v);
}
