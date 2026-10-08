/**
 * Editor tools registry.
 *
 * Each tool defines:
 *   - id, name, icon, cursor
 *   - onActivate(ctx): called when tool is selected
 *   - onDeactivate(ctx): cleanup
 *   - onPointerDown/Move/Up(ctx, event): handle canvas interaction
 *
 * ctx provides: overlay, history, manifest, assets, getPageIndex(),
 * screenToPdf(), addOp(), selectObject(), etc.
 *
 * Tools create Konva nodes for preview AND manifest ops for finalization.
 * Both are wired through history.execute() so undo/redo stays in sync.
 */

export const TOOLS = {};

export function registerTool(tool) {
  if (!tool.id) throw new Error('Tool must have an id');
  TOOLS[tool.id] = tool;
}

export function getTool(id) {
  return TOOLS[id] || null;
}

// ---- Select tool ----
registerTool({
  id: 'select',
  name: 'Select',
  icon: '➤',
  cursor: 'default',
  onActivate() {},
  onDeactivate() {},
});


// ---- Draw (freehand) tool ----
registerTool({
  id: 'draw',
  name: 'Draw',
  icon: '✏️',
  cursor: 'crosshair',
  onActivate() {},
  onDeactivate(ctx) { this._drawing = null; },
  onPointerDown(ctx, evt) {
    const stage = evt.target.getStage();
    if (!stage) return;
    const pageIndex = ctx.getPageIndex(stage);
    if (pageIndex < 0) return;
    const pos = stage.getPointerPosition();
    this._drawing = { pageIndex, stage, points: [pos.x, pos.y], line: null };

    const layer = ctx.overlay.getLayer(pageIndex);
    this._drawing.line = new Konva.Line({
      points: [pos.x, pos.y],
      stroke: ctx.drawDefaults.color,
      strokeWidth: ctx.drawDefaults.thickness * ctx.overlay.scale,
      lineCap: 'round', lineJoin: 'round',
    });
    layer.add(this._drawing.line);
  },
  onPointerMove(ctx, evt) {
    if (!this._drawing) return;
    const stage = evt.target.getStage();
    const pos = stage.getPointerPosition();
    const pts = this._drawing.line.points().concat([pos.x, pos.y]);
    this._drawing.line.points(pts);
    this._drawing.points.push(pos.x, pos.y);
    ctx.overlay.getLayer(this._drawing.pageIndex).batchDraw();
  },
  onPointerUp(ctx) {
    if (!this._drawing || this._drawing.points.length < 4) {
      this._drawing?.line?.destroy();
      this._drawing = null;
      return;
    }
    const { pageIndex, points } = this._drawing;
    this._drawing.line.destroy();
    this._drawing = null;

    // Convert screen points to PDF points
    const pdfPoints = [];
    for (let i = 0; i < points.length; i += 2) {
      const [px, py] = ctx.screenToPdf(points[i], points[i+1], pageIndex);
      pdfPoints.push(px, py);
    }
    const op = {
      op: 'draw', page: pageIndex, points: pdfPoints,
      color: ctx.drawDefaults.color,
      thickness: ctx.drawDefaults.thickness,
    };
    ctx.history.execute({
      op,
      do: () => {
        const withId = ctx.appendManifestOp(op);
        ctx.overlay.renderOp(pageIndex, withId, ctx.assets);
        this._lastOpId = withId.id;
      },
      undo: () => {
        ctx.removeManifestOp(this._lastOpId);
        ctx.overlay.removeOp(pageIndex, this._lastOpId);
      },
    });
  },
});

// ---- Highlight tool ----
registerTool({
  id: 'highlight',
  name: 'Highlight',
  icon: '🖍️',
  cursor: 'crosshair',
  onActivate() {},
  onDeactivate(ctx) { this._start = null; this._preview = null; },
  onPointerDown(ctx, evt) {
    const stage = evt.target.getStage();
    if (!stage) return;
    const pageIndex = ctx.getPageIndex(stage);
    if (pageIndex < 0) return;
    const pos = stage.getPointerPosition();
    this._start = { pageIndex, x: pos.x, y: pos.y };
  },
  onPointerMove(ctx, evt) {
    if (!this._start) return;
    const stage = evt.target.getStage();
    const pos = stage.getPointerPosition();
    const layer = ctx.overlay.getLayer(this._start.pageIndex);
    this._preview?.destroy();
    this._preview = new Konva.Rect({
      x: Math.min(this._start.x, pos.x),
      y: Math.min(this._start.y, pos.y),
      width: Math.abs(pos.x - this._start.x),
      height: Math.abs(pos.y - this._start.y),
      fill: '#ffff00', opacity: 0.4,
    });
    layer.add(this._preview);
    layer.batchDraw();
  },
  onPointerUp(ctx, evt) {
    if (!this._start) return;
    const stage = evt.target.getStage();
    const pos = stage.getPointerPosition();
    const { pageIndex, x: x1, y: y1 } = this._start;
    this._preview?.destroy();
    this._preview = null;
    this._start = null;

    const sr = {
      x: Math.min(x1, pos.x), y: Math.min(y1, pos.y),
      width: Math.abs(pos.x - x1), height: Math.abs(pos.y - y1),
    };
    // For lines/arrows, only the length matters (they're 1D)
    const isLine = this.shape === 'line' || this.shape === 'arrow';
    const minDim = isLine
      ? Math.hypot(sr.width, sr.height)
      : Math.min(sr.width, sr.height);
    if (minDim < 5) return;

    const pr = ctx.screenRectToPdf(sr, pageIndex);
    const op = { op: 'add_highlight', page: pageIndex, ...pr, color: '#ffff00' };
    ctx.history.execute({
      op,
      do: () => {
        const withId = ctx.appendManifestOp(op);
        ctx.overlay.renderOp(pageIndex, withId, ctx.assets);
        this._lastOpId = withId.id;
      },
      undo: () => {
        ctx.removeManifestOp(this._lastOpId);
        ctx.overlay.removeOp(pageIndex, this._lastOpId);
      },
    });
  },
});

/** Inline stamp picker (no prompt()). */
function showStampPicker(onPick) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:200;
    display:flex;align-items:center;justify-content:center;`;
  const modal = document.createElement('div');
  modal.style.cssText = `background:#fff;border-radius:16px;padding:24px;width:340px;
    box-shadow:0 20px 60px rgba(0,0,0,.25);font-family:system-ui,sans-serif;`;
  modal.innerHTML = `
    <h3 style="margin:0 0 12px;font-size:16px;font-weight:700">Choose stamp</h3>
    <div style="display:grid;gap:8px;margin-bottom:14px" id="stBtns"></div>
    <input id="stCustom" placeholder="Or type custom text…"
      style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:9px;font-size:14px;box-sizing:border-box;margin-bottom:14px">
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button id="stCancel" style="background:#fff;border:1px solid #cbd5e1;border-radius:9px;padding:9px 16px;font-weight:600;cursor:pointer">Cancel</button>
      <button id="stUse" style="background:#2f6bff;color:#fff;border:0;border-radius:9px;padding:9px 16px;font-weight:600;cursor:pointer">Use custom</button>
    </div>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const btnWrap = modal.querySelector('#stBtns');
  STAMPS.forEach(s => {
    const b = document.createElement('button');
    b.innerHTML = `<span style="font-weight:700;color:${s.color}">${s.text}</span>`;
    b.style.cssText = `text-align:left;padding:10px 12px;border-radius:9px;cursor:pointer;
      border:2px solid ${s.color};background:#fff;font-size:14px;`;
    b.onclick = () => { overlay.remove(); onPick(s.text, s.color); };
    btnWrap.appendChild(b);
  });
  modal.querySelector('#stUse').onclick = () => {
    const t = modal.querySelector('#stCustom').value.trim().toUpperCase();
    if (t) { overlay.remove(); onPick(t, '#dc2626'); }
  };
  modal.querySelector('#stCancel').onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
}

// ---- Link tool ----
registerTool({
  id: 'link',
  name: 'Link',
  icon: '🔗',
  cursor: 'crosshair',
  onActivate() {},
  onDeactivate(ctx) { this._start = null; this._preview = null; },
  onPointerDown(ctx, evt) {
    const stage = evt.target.getStage();
    if (!stage) return;
    const pageIndex = ctx.getPageIndex(stage);
    if (pageIndex < 0) return;
    const pos = stage.getPointerPosition();
    this._start = { pageIndex, x: pos.x, y: pos.y };
  },
  onPointerMove(ctx, evt) {
    if (!this._start) return;
    const stage = evt.target.getStage();
    const pos = stage.getPointerPosition();
    const layer = ctx.overlay.getLayer(this._start.pageIndex);
    this._preview?.destroy();
    this._preview = new Konva.Rect({
      x: Math.min(this._start.x, pos.x), y: Math.min(this._start.y, pos.y),
      width: Math.abs(pos.x - this._start.x), height: Math.abs(pos.y - this._start.y),
      stroke: '#2f6bff', strokeWidth: 1.5, dash: [6, 4],
      fill: 'rgba(47,107,255,0.06)',
    });
    layer.add(this._preview);
    layer.batchDraw();
  },
  onPointerUp(ctx, evt) {
    if (!this._start) return;
    const stage = evt.target.getStage();
    const pos = stage.getPointerPosition();
    const { pageIndex, x: x1, y: y1 } = this._start;
    this._preview?.destroy();
    this._preview = null;
    this._start = null;

    const sr = {
      x: Math.min(x1, pos.x), y: Math.min(y1, pos.y),
      width: Math.abs(pos.x - x1), height: Math.abs(pos.y - y1),
    };
    if (sr.width < 10 || sr.height < 10) return;

    showLinkDialog((url) => {
      if (!url) return;
      const pr = ctx.screenRectToPdf(sr, pageIndex);
      const op = { op: 'add_link', page: pageIndex, ...pr, url };
      ctx.history.execute({
        op,
        do: () => {
          const withId = ctx.appendManifestOp(op);
          ctx.overlay.renderOp(pageIndex, withId, ctx.assets);
        },
        undo: () => {
          const last = ctx.manifest.operations[ctx.manifest.operations.length - 1];
          ctx.removeManifestOp(last.id);
          ctx.overlay.removeOp(pageIndex, last.id);
        },
      });
      ctx.setTool('select');
    });
  },
});

/** Inline link URL dialog (no prompt()). */
function showLinkDialog(onPick) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:200;
    display:flex;align-items:center;justify-content:center;`;
  const modal = document.createElement('div');
  modal.style.cssText = `background:#fff;border-radius:16px;padding:24px;width:360px;
    box-shadow:0 20px 60px rgba(0,0,0,.25);font-family:system-ui,sans-serif;`;
  modal.innerHTML = `
    <h3 style="margin:0 0 12px;font-size:16px;font-weight:700">Add link</h3>
    <input id="lkUrl" placeholder="https://example.com" value="https://"
      style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:9px;font-size:14px;box-sizing:border-box;margin-bottom:14px">
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button id="lkCancel" style="background:#fff;border:1px solid #cbd5e1;border-radius:9px;padding:9px 16px;font-weight:600;cursor:pointer">Cancel</button>
      <button id="lkAdd" style="background:#2f6bff;color:#fff;border:0;border-radius:9px;padding:9px 16px;font-weight:600;cursor:pointer">Add link</button>
    </div>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  const inp = modal.querySelector('#lkUrl');
  inp.focus(); inp.select();
  const done = (val) => { overlay.remove(); onPick(val); };
  modal.querySelector('#lkAdd').onclick = () => {
    const v = inp.value.trim();
    if (v && v !== 'https://') done(v);
  };
  modal.querySelector('#lkCancel').onclick = () => done(null);
  overlay.onclick = e => { if (e.target === overlay) done(null); };
  inp.onkeydown = e => { if (e.key === 'Enter') modal.querySelector('#lkAdd').click(); };
}

// ---- Form field tool ----
const FIELD_TYPES = [
  { id: 'text', label: 'Text field' },
  { id: 'multiline', label: 'Multiline text' },
  { id: 'checkbox', label: 'Checkbox' },
  { id: 'radio', label: 'Radio group' },
  { id: 'dropdown', label: 'Dropdown' },
];

/** Inline field-type picker modal (no prompt()). */
function showFieldTypePicker(onPick, toolRef) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:200;
    display:flex;align-items:center;justify-content:center;`;
  const modal = document.createElement('div');
  modal.style.cssText = `background:#fff;border-radius:16px;padding:24px;width:360px;
    box-shadow:0 20px 60px rgba(0,0,0,.25);font-family:system-ui,sans-serif;`;
  modal.innerHTML = `
    <h3 style="margin:0 0 12px;font-size:16px;font-weight:700">Add form field</h3>
    <div style="display:grid;gap:8px;margin-bottom:14px" id="fftBtns"></div>
    <input id="fftName" placeholder="Field name (e.g. Full Name)"
      style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:9px;font-size:14px;box-sizing:border-box;margin-bottom:14px">
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button id="fftCancel" style="background:#fff;border:1px solid #cbd5e1;border-radius:9px;padding:9px 16px;font-weight:600;cursor:pointer">Cancel</button>
    </div>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const btnWrap = modal.querySelector('#fftBtns');
  FIELD_TYPES.forEach((f, i) => {
    const b = document.createElement('button');
    b.textContent = f.label;
    b.style.cssText = `text-align:left;padding:10px 12px;border-radius:9px;cursor:pointer;font-size:14px;
      border:1px solid ${i === 0 ? '#2f6bff' : '#e2e8f0'};
      background:${i === 0 ? '#eef4ff' : '#fff'};
      color:${i === 0 ? '#2f6bff' : '#334155'};font-weight:${i === 0 ? '700' : '400'};`;
    b.onclick = () => {
      const name = modal.querySelector('#fftName').value.trim() || f.label;
      overlay.remove();
      onPick(f.id, name);
    };
    btnWrap.appendChild(b);
  });
  modal.querySelector('#fftCancel').onclick = () => { overlay.remove(); onPick(null); };
  overlay.onclick = e => { if (e.target === overlay) { overlay.remove(); onPick(null); } };
}
registerTool({
  id: 'formfield',
  name: 'Form field',
  icon: '📝',
  cursor: 'crosshair',
  onActivate() {
    // Show an inline field-type picker instead of prompt()
    showFieldTypePicker((fieldType, fieldName) => {
      if (fieldType) {
        this._fieldType = fieldType;
        this._fieldLabel = fieldName || fieldType;
        this._pendingName = fieldName;
      } else {
        // User cancelled — switch back to select
        setTimeout(() => this._ctx?.setTool?.('select'), 0);
      }
    }, this);
  },
  onDeactivate(ctx) { this._start = null; this._preview = null; },
  onPointerDown(ctx, evt) {
    const stage = evt.target.getStage();
    if (!stage) return;
    const pageIndex = ctx.getPageIndex(stage);
    if (pageIndex < 0) return;
    const pos = stage.getPointerPosition();
    this._start = { pageIndex, x: pos.x, y: pos.y };
  },
  onPointerMove(ctx, evt) {
    if (!this._start) return;
    const stage = evt.target.getStage();
    const pos = stage.getPointerPosition();
    const layer = ctx.overlay.getLayer(this._start.pageIndex);
    this._preview?.destroy();
    this._preview = new Konva.Rect({
      x: Math.min(this._start.x, pos.x), y: Math.min(this._start.y, pos.y),
      width: Math.abs(pos.x - this._start.x), height: Math.abs(pos.y - this._start.y),
      fill: '#eef4ff', stroke: '#2f6bff', strokeWidth: 1.5, cornerRadius: 4,
    });
    layer.add(this._preview);
    layer.batchDraw();
  },
  onPointerUp(ctx, evt) {
    if (!this._start) return;
    const stage = evt.target.getStage();
    const pos = stage.getPointerPosition();
    const { pageIndex, x: x1, y: y1 } = this._start;
    this._preview?.destroy();
    this._preview = null;
    this._start = null;

    const sr = {
      x: Math.min(x1, pos.x), y: Math.min(y1, pos.y),
      width: Math.abs(pos.x - x1), height: Math.abs(pos.y - y1),
    };
    if (sr.width < 20 || sr.height < 16) return;

    const pr = ctx.screenRectToPdf(sr, pageIndex);
    const op = {
      op: 'add_form_field', page: pageIndex, ...pr,
      fieldType: this._fieldType || 'text',
      name: this._pendingName || this._fieldLabel || 'Field',
    };
    ctx.history.execute({
      op,
      do: () => {
        const withId = ctx.appendManifestOp(op);
        const node = ctx.overlay.renderOp(pageIndex, withId, ctx.assets);
        if (node) ctx.selectObject(node);
      },
      undo: () => {
        const last = ctx.manifest.operations[ctx.manifest.operations.length - 1];
        ctx.removeManifestOp(last.id);
        ctx.overlay.removeOp(pageIndex, last.id);
        ctx.clearSelection();
      },
    });
    ctx.setTool('select');
  },
});
registerTool({
  id: 'shapes',
  name: 'Shapes',
  icon: '⬛',
  cursor: 'crosshair',
  shape: 'rect', // rect | ellipse | line | arrow — set by UI
  onActivate() {},
  onDeactivate(ctx) { this._start = null; this._preview = null; },
  onPointerDown(ctx, evt) {
    const stage = evt.target.getStage();
    if (!stage) return;
    const pageIndex = ctx.getPageIndex(stage);
    if (pageIndex < 0) return;
    const pos = stage.getPointerPosition();
    this._start = { pageIndex, x: pos.x, y: pos.y };
  },
  onPointerMove(ctx, evt) {
    if (!this._start) return;
    const stage = evt.target.getStage();
    const pos = stage.getPointerPosition();
    const layer = ctx.overlay.getLayer(this._start.pageIndex);
    this._preview?.destroy();
    const s = ctx.overlay.scale;
    const shape = this.shape;
    if (shape === 'ellipse') {
      this._preview = new Konva.Ellipse({
        x: (this._start.x + pos.x) / 2, y: (this._start.y + pos.y) / 2,
        radiusX: Math.abs(pos.x - this._start.x) / 2,
        radiusY: Math.abs(pos.y - this._start.y) / 2,
        stroke: '#000000', strokeWidth: 2 * s, fill: null,
      });
    } else if (shape === 'line' || shape === 'arrow') {
      this._preview = new Konva.Arrow({
        points: [this._start.x, this._start.y, pos.x, pos.y],
        stroke: '#000000', strokeWidth: 2 * s,
        pointerLength: shape === 'arrow' ? 12 * s : 0,
        pointerWidth: shape === 'arrow' ? 10 * s : 0,
        fill: '#000000',
      });
    } else {
      this._preview = new Konva.Rect({
        x: Math.min(this._start.x, pos.x), y: Math.min(this._start.y, pos.y),
        width: Math.abs(pos.x - this._start.x), height: Math.abs(pos.y - this._start.y),
        stroke: '#000000', strokeWidth: 2 * s, fill: null,
      });
    }
    layer.add(this._preview);
    layer.batchDraw();
  },
  onPointerUp(ctx, evt) {
    if (!this._start) return;
    const stage = evt.target.getStage();
    const pos = stage.getPointerPosition();
    const { pageIndex, x: x1, y: y1 } = this._start;
    this._preview?.destroy();
    this._preview = null;
    this._start = null;

    const isLineShape = this.shape === 'line' || this.shape === 'arrow';
    let op;
    if (isLineShape) {
      // Free-angle line/arrow: the user controls the exact start and end
      // points. Store both endpoints explicitly — never force horizontal,
      // vertical, straighten, or snap the angle.
      if (Math.hypot(pos.x - x1, pos.y - y1) < 5) return;
      const [px1, py1] = ctx.screenToPdf(x1, y1, pageIndex);
      const [px2, py2] = ctx.screenToPdf(pos.x, pos.y, pageIndex);
      op = {
        op: 'add_shape', page: pageIndex,
        shape: this.shape, x: px1, y: py1, x2: px2, y2: py2,
        w: Math.abs(px2 - px1), h: Math.abs(py2 - py1), // bounding box (compat)
        stroke: '#000000', thickness: 2,
      };
    } else {
      const sr = {
        x: Math.min(x1, pos.x), y: Math.min(y1, pos.y),
        width: Math.abs(pos.x - x1), height: Math.abs(pos.y - y1),
      };
      if (Math.min(sr.width, sr.height) < 5) return;

      const pr = ctx.screenRectToPdf(sr, pageIndex);
      op = {
        op: 'add_shape', page: pageIndex, ...pr,
        shape: this.shape, stroke: '#000000', thickness: 2,
      };
    }
    let createdOp = null; // the op with ID, captured for undo/redo
    const doCreate = () => {
      if (createdOp) {
        // Redo: restore the same op with original ID (not a duplicate)
        const { restoreOp } = ctx; // available via editorCtx?
        // Fallback: use appendManifestOp but it generates new ID - we need restore
        // For now, manually push with preserved ID
        const manifest = ctx.manifest;
        const existing = manifest.operations.findIndex(o => o.id === createdOp.id);
        if (existing < 0) manifest.operations.push({ ...createdOp });
        ctx.overlay.renderOp(pageIndex, createdOp, ctx.assets);
      } else {
        // First do: create new
        createdOp = ctx.appendManifestOp(op);
        ctx.overlay.renderOp(pageIndex, createdOp, ctx.assets);
      }
      ctx.updateStatus();
    };
    const undoCreate = () => {
      if (createdOp) {
        ctx.removeManifestOp(createdOp.id);
        ctx.overlay.removeOp(pageIndex, createdOp.id);
        const layer = ctx.overlay.getLayer(pageIndex);
        if (layer) {
          try { layer.clear(); } catch (e) {}
          try { layer.batchDraw(); } catch (e) {}
        }
      }
      ctx.updateStatus();
    };
    ctx.history.execute({
      op,
      do: doCreate,
      undo: undoCreate,
      redo: doCreate,
    });
  },
});

// ---- Stamp tool ----
const STAMPS = [
  { text: 'APPROVED', color: '#16a34a' },
  { text: 'CONFIDENTIAL', color: '#dc2626' },
  { text: 'DRAFT', color: '#d97706' },
  { text: 'REVIEWED', color: '#2f6bff' },
  { text: 'REJECTED', color: '#991b1b' },
];
registerTool({
  id: 'stamp',
  name: 'Stamp',
  icon: '🏷️',
  cursor: 'crosshair',
  stampIndex: 0,
  onActivate() {
    showStampPicker((text, color) => {
      if (text) {
        this._text = text;
        this._color = color;
      }
    });
  },
  onDeactivate() {},
  onPointerDown(ctx, evt) {
    if (evt.evt) evt.evt.preventDefault();
    const stage = evt.target.getStage();
    if (!stage || evt.target !== stage) return;
    const pos = stage.getPointerPosition();
    const pageIndex = ctx.getPageIndex(stage);
    if (pageIndex < 0) return;

    const [px, py] = ctx.screenToPdf(pos.x, pos.y, pageIndex);
    const op = {
      op: 'add_stamp', page: pageIndex,
      x: px, y: py, w: 120, h: 36,
      text: this._text || 'APPROVED',
      color: this._color || '#dc2626',
    };
    ctx.history.execute({
      op,
      do: () => {
        const withId = ctx.appendManifestOp(op);
        const node = ctx.overlay.renderOp(pageIndex, withId, ctx.assets);
        if (node) ctx.selectObject(node);
      },
      undo: () => {
        const last = ctx.manifest.operations[ctx.manifest.operations.length - 1];
        ctx.removeManifestOp(last.id);
        ctx.overlay.removeOp(pageIndex, last.id);
        ctx.clearSelection();
      },
    });
    ctx.setTool('select');
  },
});
