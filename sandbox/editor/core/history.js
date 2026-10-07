/**
 * Undo/redo history — command pattern.
 *
 * Each history entry is a command: { do(), undo(), op }.
 * - do() applies the change to the editor (Konva layer) AND the manifest
 * - undo() reverses both
 * - op is the manifest operation (renderer-agnostic plain data)
 *
 * The history stack and the manifest stay in sync by construction:
 * undo removes the op from the manifest, redo re-appends it.
 *
 * Continuous gestures (drag, resize) coalesce: call beginCoalesce() on
 * pointer-down and endCoalesce() on pointer-up to merge into one entry.
 *
 * Framework-agnostic: no DOM, no Konva imports. The editor wires do/undo.
 */

const MAX_ENTRIES = 100;

export class History {
  constructor(manifest) {
    this.manifest = manifest;
    this.undoStack = [];
    this.redoStack = [];
    this.coalescing = null;
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit() {
    for (const fn of this.listeners) fn(this);
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  /**
   * Execute a command: { op, do(), undo(), coalesceKey? }
   * do/undo are functions that mutate the Konva layer + manifest.
   */
  execute(cmd) {
    if (!cmd || typeof cmd.do !== 'function' || typeof cmd.undo !== 'function') {
      throw new Error('History.execute requires { do, undo }');
    }

    // Coalescing: if we're in a coalesce window and the key matches,
    // just re-run do() without pushing a new entry.
    if (this.coalescing && cmd.coalesceKey &&
        this.coalescing.key === cmd.coalesceKey) {
      cmd.do();
      this.coalescing.lastUndo = cmd.undo;
      this._emit();
      return;
    }

    cmd.do();
    this.undoStack.push(cmd);
    if (this.undoStack.length > MAX_ENTRIES) this.undoStack.shift();
    this.redoStack.length = 0; // new action clears redo
    this._emit();
  }

  beginCoalesce(key) {
    this.coalescing = { key, lastUndo: null };
  }

  endCoalesce() {
    // Patch the last entry's undo to the final coalesced undo
    if (this.coalescing && this.coalescing.lastUndo && this.undoStack.length) {
      const last = this.undoStack[this.undoStack.length - 1];
      last.undo = this.coalescing.lastUndo;
    }
    this.coalescing = null;
    this._emit();
  }

  undo() {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.undo();
    this.redoStack.push(cmd);
    this._emit();
    return true;
  }

  redo() {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.do();
    this.undoStack.push(cmd);
    this._emit();
    return true;
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.coalescing = null;
    this._emit();
  }
}
