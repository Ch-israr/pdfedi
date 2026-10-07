/**
 * Text tool v2 — proper inline text editing.
 *
 * Workflow (per spec §5):
 * 1. Select Text tool, click on PDF → Text object created at click point
 * 2. Immediately editable via inline textarea overlay
 * 3. Movable, resizable (font scales), re-editable (double-click), deletable
 * 4. Borderless in final PDF — selection UI exists only in the editor
 */

import { registerTool } from './registry.js';

function makeEditable(textNode, stage, onCommit) {
  // Hide the Konva text, show a textarea at the same position
  const absPos = textNode.getAbsolutePosition();
  const stageBox = stage.container().getBoundingClientRect();

  textNode.hide();

  const ta = document.createElement('textarea');
  ta.value = textNode.text();
  ta.style.cssText = `
    position:absolute;z-index:20;
    left:${absPos.x}px;top:${absPos.y}px;
    width:${Math.max(200, textNode.width())}px;
    min-height:${textNode.height() + 10}px;
    font-family:${textNode.fontFamily()};font-size:${textNode.fontSize()}px;
    font-weight:${textNode.fontStyle().includes('bold') ? 'bold' : 'normal'};
    font-style:${textNode.fontStyle().includes('italic') ? 'italic' : 'normal'};
    color:${textNode.fill()};line-height:1.2;
    border:2px solid #2f6bff;border-radius:4px;outline:none;
    padding:4px 6px;resize:both;overflow:hidden;background:rgba(255,255,255,.95);`;
  stage.container().appendChild(ta);
  // Ensure container is positioned
  if (getComputedStyle(stage.container()).position === 'static') {
    stage.container().style.position = 'relative';
  }
  ta.focus();
  ta.select();

  let done = false;
  const finish = (cancel) => {
    if (done) return;
    done = true;
    const val = ta.value;
    ta.remove();
    textNode.show();
    if (!cancel) {
      textNode.text(val);
      onCommit(val);
    }
    textNode.getLayer()?.batchDraw();
  };

  ta.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(false); }
    if (e.key === 'Escape') finish(true);
  });
  ta.addEventListener('blur', () => finish(false));
}

registerTool({
  id: 'text',
  name: 'Text',
  icon: 'T',
  cursor: 'text',

  onPointerDown(ctx, evt) {
    if (evt.evt) evt.evt.preventDefault();
    const stage = evt.target.getStage();
    if (!stage || evt.target !== stage) return; // only on empty canvas
    const pos = stage.getPointerPosition();
    const pageIndex = ctx.getPageIndex(stage);
    if (pageIndex < 0) return;

    const [px, py] = ctx.screenToPdf(pos.x, pos.y, pageIndex);
    const op = {
      op: 'add_text', page: pageIndex,
      x: px, y: py, text: '',
      font: ctx.textDefaults.font,
      size: ctx.textDefaults.size,
      color: ctx.textDefaults.color,
      bold: false, italic: false, align: 'left',
    };

    let nodeRef = null;
    ctx.history.execute({
      op,
      do: () => {
        const withId = ctx.appendManifestOp(op);
        const node = ctx.overlay.renderOp(pageIndex, withId, ctx.assets);
        if (node) {
          nodeRef = node;
          ctx.selectObject(node);
          // Immediately enter edit mode
          makeEditable(node, stage, (newText) => {
            withId.text = newText;
            ctx.updateStatus();
          });
        }
      },
      undo: () => {
        const last = ctx.manifest.operations[ctx.manifest.operations.length - 1];
        ctx.removeManifestOp(last.id);
        ctx.overlay.removeOp(pageIndex, last.id);
        ctx.clearSelection();
      },
    });
  },

  /** Double-click an existing text object to re-edit it */
  onDblClick(ctx, evt, node) {
    const stage = node.getStage();
    const opId = node.getAttr('opId');
    const op = ctx.manifest.operations.find(o => o.id === opId);
    if (!op || op.op !== 'add_text') return;
    makeEditable(node, stage, (newText) => {
      op.text = newText;
      ctx.updateStatus();
    });
  },
});

/**
 * Apply text styling to a Konva.Text node + its manifest op.
 * Used by the contextual toolbar.
 */
export function styleTextNode(node, op, style) {
  if (style.bold !== undefined) op.bold = style.bold;
  if (style.italic !== undefined) op.italic = style.italic;
  if (style.size !== undefined) { op.size = style.size; }
  if (style.color !== undefined) { op.color = style.color; node.fill(style.color); }
  if (style.align !== undefined) { op.align = style.align; node.align(style.align); }
  if (style.font !== undefined) { op.font = style.font; node.fontFamily(style.font); }

  const parts = [];
  if (op.bold) parts.push('bold');
  if (op.italic) parts.push('italic');
  node.fontStyle(parts.join(' ') || 'normal');
  if (op.size) node.fontSize(op.size * (node.getAttr('_scale') || 1));

  node.getLayer()?.batchDraw();
}
