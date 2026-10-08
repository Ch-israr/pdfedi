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

/** Walk up to the nearest node (or self) carrying an opId. */
function findOpNode(node) {
  let n = node;
  while (n) {
    if (n.getAttr && n.getAttr('opId')) return n;
    n = (typeof n.getParent === 'function') ? n.getParent() : null;
  }
  return null;
}

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
    if (e.key === 'Escape') { e.preventDefault(); finish(true); } // cancel, don't commit
  });
  ta.addEventListener('blur', () => {
    // Only commit on blur if there's actual text; otherwise cancel
    // (prevents accidental commits when clicking toolbar)
    if (ta.value.trim()) finish(false);
    else finish(true);
  });
}

registerTool({
  id: 'text',
  name: 'Text',
  icon: 'T',
  cursor: 'text',

  onPointerDown(ctx, evt) {
    if (evt.evt) evt.evt.preventDefault();
    const stage = evt.target.getStage();
    if (!stage) return;

    // Clicked on an existing object? Select it (don't create new).
    // This is the critical move-vs-create distinction.
    if (evt.target !== stage) {
      const opNode = findOpNode(evt.target);
      const clickedOpId = opNode?.getAttr('opId');
      if (clickedOpId) {
        const node = ctx.overlay.findNodeByOpId?.(clickedOpId) || opNode;
        ctx.selectObject(node);
        return;
      }
      // Clicked on something without an opId (e.g. page background rect) — ignore
      return;
    }

    // Empty canvas click — but first check if we clicked NEAR an existing text
    // object (within 10px). If so, select it instead of creating new.
    // This prevents accidental new objects when trying to grab existing text.
    const pos = stage.getPointerPosition();
    const pageIndex = ctx.getPageIndex(stage);
    if (pageIndex < 0) return;

    const layer = ctx.overlay.getLayer(pageIndex);
    if (layer) {
      const nearby = layer.find(node => {
        if (node.getAttr('opId') && node.className === 'Text') {
          const box = node.getClientRect();
          const pad = 10;
          return pos.x >= box.x - pad && pos.x <= box.x + box.width + pad &&
                 pos.y >= box.y - pad && pos.y <= box.y + box.height + pad;
        }
        return false;
      });
      if (nearby.length > 0) {
        ctx.selectObject(nearby[0]);
        return;
      }
    }

    // Truly empty canvas → create new text object
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
          // Do NOT select yet — enter edit mode first.
          // Selection (and draggability) happens after editing completes,
          // then we immediately deselect so the object stays fixed.
          makeEditable(node, stage, (newText) => {
            withId.text = newText;
            // If user left it empty, remove the object
            if (!newText.trim()) {
              ctx.removeManifestOp(withId.id);
              ctx.overlay.removeOp(pageIndex, withId.id);
              ctx.clearSelection();
            } else {
              // Placement complete: ensure node is at final position,
              // NOT draggable, NOT selected — detached from mouse.
              // User switches to Select tool to move it.
              node.draggable(false);
              ctx.clearSelection();
              // Switch back to select tool for natural next action
              ctx.setTool('select');
            }
            ctx.updateStatus();
          });
        }
      },
      undo: () => {
        const last = ctx.manifest.operations[ctx.manifest.operations.length - 1];
        if (last) {
          ctx.removeManifestOp(last.id);
          ctx.overlay.removeOp(pageIndex, last.id);
          // Aggressive cleanup: find any node with this ID across all layers
          const layer = ctx.overlay.getLayer(pageIndex);
          if (layer) {
            layer.find(n => n.getAttr('opId') === last.id).forEach(n => {
              try { n.destroy(); } catch (e) {}
            });
            layer.batchDraw();
          }
        }
        // Also destroy the captured node reference if it exists
        if (nodeRef && !nodeRef.isDestroyed()) {
          try { nodeRef.destroy(); } catch (e) {}
        }
        ctx.clearSelection();
        ctx.updateStatus();
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
