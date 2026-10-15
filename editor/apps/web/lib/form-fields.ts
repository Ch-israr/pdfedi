/**
 * Form-field helpers: naming, creation order, and placement defaults.
 * No DOM — safe for tests.
 */
import type { EditorElement, FormFieldType } from '@pdfeditor/shared';

export const FORM_TOOL_IDS = ['form-text', 'form-multiline', 'form-checkbox'] as const;
export type FormToolId = (typeof FORM_TOOL_IDS)[number];

export const FORM_FIELD_DEFAULTS: Record<
  FormToolId,
  { fieldType: FormFieldType; width: number; height: number; label: string }
> = {
  'form-text': { fieldType: 'text', width: 180, height: 24, label: 'Text field' },
  'form-multiline': { fieldType: 'multiline', width: 180, height: 72, label: 'Multiline field' },
  'form-checkbox': { fieldType: 'checkbox', width: 18, height: 18, label: 'Checkbox' },
};

function formFieldNames(elements: Record<string, EditorElement>): Set<string> {
  const names = new Set<string>();
  for (const el of Object.values(elements)) {
    if (el.kind === 'form-field') names.add(el.name);
  }
  return names;
}

/**
 * Next default name: field1, field2, … in creation order, skipping any
 * names already taken by form-field elements (created or bound).
 */
export function nextFieldName(elements: Record<string, EditorElement>): string {
  const taken = formFieldNames(elements);
  let max = 0;
  for (const name of taken) {
    const m = /^field(\d+)$/.exec(name);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  let candidate = `field${max + 1}`;
  let guard = 1;
  while (taken.has(candidate) && guard < 10_000) {
    guard++;
    candidate = `field${max + guard}`;
  }
  return candidate;
}

/** Next creation index for keyboard tab order. */
export function nextFieldOrder(elements: Record<string, EditorElement>): number {
  let max = -1;
  for (const el of Object.values(elements)) {
    if (el.kind === 'form-field') max = Math.max(max, el.fieldOrder);
  }
  return max + 1;
}

/** True when `name` is unique among form-field elements other than `exceptId`. */
export function isFieldNameUnique(
  elements: Record<string, EditorElement>,
  name: string,
  exceptId?: string,
): boolean {
  for (const el of Object.values(elements)) {
    if (el.kind !== 'form-field' || el.id === exceptId) continue;
    if (el.name === name) return false;
  }
  return true;
}
