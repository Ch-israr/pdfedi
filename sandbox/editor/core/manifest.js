/**
 * Edit manifest — the core abstraction of the PDF editor.
 *
 * A manifest is an ordered list of typed operations describing every change
 * the user made to the original PDF. All geometry is in PDF points with
 * bottom-left origin (the PDF native coordinate system) — never screen
 * pixels, never CSS pixels.
 *
 * This single structure drives:
 *   1. Konva overlay rendering (editor preview)
 *   2. Undo/redo (each op carries enough data for its inverse)
 *   3. Browser finalization via pdf-lib
 *   4. Backend finalization via a Python manifest interpreter
 *
 * Framework-agnostic: no DOM, no Konva, no pdf-lib imports.
 * Safe to move to production as-is.
 */

export const OP_TYPES = [
  'add_text',
  'add_image',
  'add_shape',      // rect, ellipse, line, arrow
  'draw',           // freehand path
  'add_highlight',
  'add_underline',
  'add_strikeout',
  'add_signature',
  'add_link',       // URL link annotation
  'add_stamp',      // preset text stamp
  'add_form_field', // AcroForm field
  'whiteout',       // visual cover (NOT redaction)
  'redact_rects',   // true redaction (destructive)
  'move_page',
  'rotate_page',
  'delete_page',
  'duplicate_page',
  'move_object',    // reposition an added object
  'resize_object',
  'rotate_object',
  'delete_object',
  'set_property',   // font size, color, opacity, etc.
];

/**
 * Validate a single operation. Returns null if valid, error string if not.
 */
export function validateOp(op) {
  if (!op || typeof op !== 'object') return 'operation must be an object';
  if (!OP_TYPES.includes(op.op)) return `unknown op type: ${op.op}`;

  const needPage = ['add_text','add_image','add_shape','draw','add_highlight',
    'add_underline','add_strikeout','add_signature','add_link','add_stamp',
    'add_form_field','whiteout','redact_rects'];
  if (needPage.includes(op.op)) {
    if (!Number.isInteger(op.page) || op.page < 0)
      return `${op.op}: page must be a non-negative integer`;
  }

  const needRect = ['add_image','add_shape','whiteout'];
  if (needRect.includes(op.op)) {
    for (const k of ['x','y','w','h']) {
      if (typeof op[k] !== 'number' || !isFinite(op[k]))
        return `${op.op}: ${k} must be a finite number`;
    }
    if (op.w <= 0 || op.h <= 0) return `${op.op}: w/h must be positive`;
  }

  if (op.op === 'add_text') {
    if (typeof op.text !== 'string')
      return 'add_text: text must be a string';
    // Empty text allowed during editing (user types after placement).
    // Finalize skips empty text ops.
    if (typeof op.x !== 'number' || typeof op.y !== 'number')
      return 'add_text: x/y must be numbers';
    if (op.size !== undefined && (typeof op.size !== 'number' || op.size <= 0))
      return 'add_text: size must be positive';
  }

  if (op.op === 'draw') {
    if (!Array.isArray(op.points) || op.points.length < 4)
      return 'draw: points must be an array of at least 2 x/y pairs';
  }

  if (op.op === 'redact_rects') {
    if (!Array.isArray(op.rects) || op.rects.length === 0)
      return 'redact_rects: rects must be a non-empty array';
  }

  const pageOps = ['move_page','rotate_page','delete_page','duplicate_page'];
  if (pageOps.includes(op.op)) {
    if (!Number.isInteger(op.from) && !Number.isInteger(op.page))
      return `${op.op}: page index required`;
  }

  return null; // valid
}

/**
 * Create an empty manifest for a source PDF.
 */
export function createManifest(sourceHash, pageCount) {
  return {
    version: 1,
    sourceHash,
    pageCount,
    operations: [],
    assets: {},   // assetId -> { kind: 'image', mime, dataUrl } (held in memory, not serialized)
    createdAt: new Date().toISOString(),
  };
}

/**
 * Append an operation to the manifest (validates first).
 * Returns the operation with an assigned id.
 */
let _opSeq = 0;
export function appendOp(manifest, op) {
  const err = validateOp(op);
  if (err) throw new Error(`Invalid operation: ${err}`);
  const withId = { ...op, id: `op_${Date.now()}_${_opSeq++}` };
  manifest.operations.push(withId);
  return withId;
}

/**
 * Remove an operation by id (used by undo).
 */
export function removeOp(manifest, opId) {
  const idx = manifest.operations.findIndex(o => o.id === opId);
  if (idx >= 0) manifest.operations.splice(idx, 1);
}

/**
 * Serialize manifest for transport (strips in-memory asset data URLs;
 * assets must be sent separately).
 */
export function serializeManifest(manifest) {
  const { assets, ...rest } = manifest;
  return JSON.stringify({
    ...rest,
    assetIds: Object.keys(assets || {}),
  });
}
