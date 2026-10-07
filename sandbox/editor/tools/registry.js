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

// ---- Text tool ----
registerTool({
  id: 'text',
  name: 'Text',
  icon: 'T',
  cursor: 'text',
  onActivate() {},
  onDeactivate() {},
  onPointerDown(ctx, evt) {
    // Prevent the browser's default mousedown focus behavior, which would
    // instantly blur the textarea we're about to create.
    if (evt.evt) evt.evt.preventDefault();

    const stage = evt.target.getStage();
    if (!stage) return;
    const pos = stage.getPointerPosition();
    const pageIndex = ctx.getPageIndex(stage);
    if (pageIndex < 0) return;

    // Inline text editor: floating textarea positioned at the click point.
    // Replaces the old blocking prompt() for better UX and testability.
    const container = stage.container();
    const ta = document.createElement('textarea');
    ta.placeholder = 'Type text, Enter to place, Esc to cancel';
    ta.style.cssText = `
      position:absolute;left:${pos.x}px;top:${pos.y}px;z-index:10;
      min-width:200px;min-height:40px;font-size:16px;padding:6px 8px;
      border:2px solid #4f46e5;border-radius:6px;outline:none;
      font-family:Helvetica,Arial,sans-serif;resize:both;background:#fff;`;
    container.appendChild(ta);
    // Make container positioning work for the absolute textarea
    const prevPos = container.style.position;
    if (!prevPos || prevPos === 'static') container.style.position = 'relative';
    ta.focus();

    let done = false;
    const finish = (cancelled) => {
      if (done) return;
      done = true;
      const text = ta.value.trim();
      ta.remove();
      if (cancelled || !text) return;

      const [px, py] = ctx.screenToPdf(pos.x, pos.y, pageIndex);
      const op = {
        op: 'add_text', page: pageIndex,
        x: px, y: py, text,
        font: ctx.textDefaults.font,
        size: ctx.textDefaults.size,
        color: ctx.textDefaults.color,
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
    };

    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(false); }
      if (e.key === 'Escape') { finish(true); }
      e.stopPropagation(); // don't trigger editor shortcuts
    });
    // Clicking elsewhere confirms
    const onBlur = () => finish(false);
    ta.addEventListener('blur', onBlur);
  },
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
    if (sr.width < 5 || sr.height < 5) return;

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

// ---- Shapes tool (rect / ellipse / line) ----
registerTool({
  id: 'shapes',
  name: 'Shapes',
  icon: '⬛',
  cursor: 'crosshair',
  shape: 'rect', // rect | ellipse | line — set by UI
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
    } else if (shape === 'line') {
      this._preview = new Konva.Line({
        points: [this._start.x, this._start.y, pos.x, pos.y],
        stroke: '#000000', strokeWidth: 2 * s,
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

    const sr = {
      x: Math.min(x1, pos.x), y: Math.min(y1, pos.y),
      width: Math.abs(pos.x - x1), height: Math.abs(pos.y - y1),
    };
    if (sr.width < 5 || sr.height < 5) return;

    const pr = ctx.screenRectToPdf(sr, pageIndex);
    const op = {
      op: 'add_shape', page: pageIndex, ...pr,
      shape: this.shape, stroke: '#000000', thickness: 2,
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
