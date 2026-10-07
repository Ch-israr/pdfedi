/**
 * Unified editor object model.
 *
 * Every editable thing on a page is an EditorObject with consistent behavior:
 * select, move, resize, rotate, delete, duplicate, z-order, opacity.
 *
 * An EditorObject wraps:
 *   - op: the manifest operation (renderer-agnostic, serializable)
 *   - node: the Konva node (rendering + interaction)
 *   - type: object type for contextual controls
 *
 * Framework-agnostic core: no DOM. Konva node is injected.
 */

export const OBJECT_TYPES = [
  'text', 'image', 'signature', 'shape', 'draw',
  'highlight', 'underline', 'strikeout',
  'whiteout', 'redact', 'link', 'stamp', 'form_field',
];

export class EditorObject {
  constructor(op, node, opts = {}) {
    this.op = op;               // manifest operation (has .id, .page, .op)
    this.node = node;           // Konva node
    this.type = opts.type || inferType(op);
    this.locked = false;
    this.onChange = opts.onChange || null; // callback(obj, changeType)
  }

  get id() { return this.op.id; }
  get page() { return this.op.page; }

  select() {
    this.node.setAttr('selected', true);
    this.onChange?.(this, 'select');
  }

  deselect() {
    this.node.setAttr('selected', false);
    this.onChange?.(this, 'deselect');
  }

  move(dx, dy) {
    if (this.locked) return;
    this.node.x(this.node.x() + dx);
    this.node.y(this.node.y() + dy);
    this.syncOpFromNode();
    this.onChange?.(this, 'move');
  }

  delete() {
    this.node.destroy();
    this.onChange?.(this, 'delete');
  }

  duplicate(offsetX = 20, offsetY = 20) {
    const clone = this.node.clone();
    clone.x(clone.x() + offsetX);
    clone.y(clone.y() + offsetY);
    clone.setAttr('opId', null); // new op id assigned on commit
    return clone;
  }

  bringToFront() {
    this.node.moveToTop();
    this.node.getLayer()?.batchDraw();
    this.onChange?.(this, 'zorder');
  }

  sendToBack() {
    this.node.moveToBottom();
    this.node.getLayer()?.batchDraw();
    this.onChange?.(this, 'zorder');
  }

  bringForward() {
    this.node.moveUp();
    this.node.getLayer()?.batchDraw();
    this.onChange?.(this, 'zorder');
  }

  sendBackward() {
    this.node.moveDown();
    this.node.getLayer()?.batchDraw();
    this.onChange?.(this, 'zorder');
  }

  setOpacity(v) {
    this.node.opacity(Math.max(0, Math.min(1, v)));
    this.op.opacity = this.node.opacity();
    this.node.getLayer()?.batchDraw();
    this.onChange?.(this, 'opacity');
  }

  setLocked(locked) {
    this.locked = locked;
    this.node.draggable(!locked);
    this.onChange?.(this, 'lock');
  }

  /**
   * Sync the manifest op from the Konva node's current transform.
   * Called after move/resize/rotate. Converts screen → PDF points.
   * Requires a coordinate converter: (node) => partial op update.
   */
  syncOpFromNode() {
    // Implemented by the editor controller (has access to coordinates)
    this.onChange?.(this, 'transform');
  }

  /** Serialize for debugging / export */
  toJSON() {
    return { type: this.type, op: this.op, locked: this.locked };
  }
}

function inferType(op) {
  const map = {
    add_text: 'text',
    add_image: 'image',
    add_signature: 'signature',
    add_shape: 'shape',
    draw: 'draw',
    add_highlight: 'highlight',
    add_underline: 'underline',
    add_strikeout: 'strikeout',
    whiteout: 'whiteout',
    redact_rects: 'redact',
    add_link: 'link',
    add_stamp: 'stamp',
    add_form_field: 'form_field',
  };
  return map[op.op] || 'unknown';
}

/**
 * Registry of all live EditorObjects, keyed by op id.
 * The editor controller owns one per document.
 */
export class ObjectRegistry {
  constructor() {
    this.objects = new Map();
  }

  add(obj) {
    this.objects.set(obj.id, obj);
  }

  get(id) {
    return this.objects.get(id) || null;
  }

  remove(id) {
    const obj = this.objects.get(id);
    if (obj) {
      obj.delete();
      this.objects.delete(id);
    }
  }

  byPage(pageIndex) {
    return [...this.objects.values()].filter(o => o.page === pageIndex);
  }

  byType(type) {
    return [...this.objects.values()].filter(o => o.type === type);
  }

  clear() {
    for (const obj of this.objects.values()) obj.node.destroy();
    this.objects.clear();
  }

  get count() { return this.objects.size; }
}
