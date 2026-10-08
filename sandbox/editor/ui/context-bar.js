/**
 * Contextual floating toolbar — professional, focused, per object type.
 *
 * Design principles:
 * - Only show controls that work and are relevant
 * - Clear icons + tooltips on everything
 * - Clean visual grouping
 * - Compact — never larger than needed
 * - Positioned near the object, viewport-safe, zoom-aware
 */

let bar = null;
let currentNode = null;
let currentOp = null;
let callbacks = {};

export function showContextBar(node, op, cb) {
  hideContextBar();
  if (!node || !op) return;
  currentNode = node;
  currentOp = op;
  callbacks = cb;

  bar = document.createElement('div');
  bar.id = 'ctx-bar';
  bar.style.cssText = `
    position:absolute;z-index:30;display:flex;gap:2px;align-items:center;
    background:#fff;border:1px solid #e2e8f0;border-radius:12px;
    box-shadow:0 8px 24px rgba(15,23,42,.16);padding:6px;
    font-family:system-ui,-apple-system,sans-serif;`;

  const builders = {
    add_text: buildTextControls,
    add_shape: buildShapeControls,
    add_image: buildImageControls,
    add_signature: buildImageControls,
    add_link: buildLinkControls,
    add_form_field: buildFieldControls,
    add_stamp: buildStampControls,
  };
  const build = builders[op.op] || buildGenericControls;
  build(bar, node, op, cb);

  const container = node.getStage().container();
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.appendChild(bar);
  positionBar();
}

export function hideContextBar() {
  bar?.remove();
  bar = null;
  currentNode = null;
  currentOp = null;
}

export function refreshContextBar() {
  if (bar && currentNode) positionBar();
}

function positionBar() {
  if (!bar || !currentNode) return;
  const box = currentNode.getClientRect({ relativeTo: currentNode.getStage() });
  const stage = currentNode.getStage();
  const stageW = stage.width();
  const stageH = stage.height();

  // Measure bar (needs to be in DOM)
  const barW = bar.offsetWidth || 280;
  const barH = bar.offsetHeight || 44;

  // Prefer above the object, centered
  let x = box.x + box.width / 2 - barW / 2;
  let y = box.y - barH - 10;

  // If no room above, go below
  if (y < 4) y = box.y + box.height + 10;
  // Clamp horizontally
  x = Math.max(4, Math.min(x, stageW - barW - 4));
  // Clamp vertically (shouldn't happen, but safe)
  y = Math.max(4, Math.min(y, stageH - barH - 4));

  bar.style.left = `${x}px`;
  bar.style.top = `${y}px`;
}

// ---------- building blocks ----------

function btn(label, tooltip, onClick, opts = {}) {
  const b = document.createElement('button');
  b.innerHTML = label;
  b.title = tooltip;
  b.setAttribute('aria-label', tooltip);
  // Prevent button from stealing focus (which can blur the canvas)
  b.setAttribute('tabindex', '-1');
  const active = opts.active;
  b.style.cssText = `
    border:0;border-radius:8px;min-width:32px;height:32px;
    background:${active ? '#eef4ff' : 'transparent'};
    color:${active ? '#2f6bff' : '#334155'};
    font-size:${opts.fontSize || '15px'};font-weight:${opts.bold ? '700' : '400'};
    font-style:${opts.italic ? 'italic' : 'normal'};
    cursor:pointer;display:flex;align-items:center;justify-content:center;
    padding:0 6px;transition:background .12s;`;
  b.onmouseenter = () => { if (!active) b.style.background = '#f1f5f9'; };
  b.onmouseleave = () => { b.style.background = active ? '#eef4ff' : 'transparent'; };
  // Simple click handler — no preventDefault/stopPropagation which can block events
  b.addEventListener('click', () => { try { onClick(b); } catch (err) { console.error('Toolbar button error:', err); } });
  return b;
}

function groupSep() {
  const d = document.createElement('div');
  d.style.cssText = 'width:1px;height:24px;background:#e2e8f0;margin:0 4px;flex-shrink:0;';
  return d;
}

function fontSelect(op, cb) {
  const fonts = [
    { v: 'Arial', l: 'Arial' },
    { v: 'Helvetica', l: 'Helvetica' },
    { v: 'Times New Roman', l: 'Times' },
    { v: 'Courier New', l: 'Courier' },
    { v: 'Georgia', l: 'Georgia' },
    { v: 'Verdana', l: 'Verdana' },
  ];
  const s = document.createElement('select');
  s.title = 'Font family';
  s.style.cssText = `border:0;border-radius:8px;height:32px;font-size:13px;cursor:pointer;
    background:transparent;color:#334155;max-width:110px;padding:0 4px;`;
  s.onmouseenter = () => s.style.background = '#f1f5f9';
  s.onmouseleave = () => s.style.background = 'transparent';
  fonts.forEach(f => {
    const o = document.createElement('option');
    o.value = f.v; o.textContent = f.l;
    o.style.fontFamily = f.v;
    if ((op.font || 'Arial') === f.v) o.selected = true;
    s.appendChild(o);
  });
  s.onchange = () => cb.onStyle({ font: s.value });
  s.onclick = e => e.stopPropagation();
  return s;
}

function sizeSelect(op, cb) {
  const sizes = [8, 10, 12, 14, 18, 24, 32, 48, 64];
  const s = document.createElement('select');
  s.title = 'Font size';
  s.style.cssText = `border:0;border-radius:8px;height:32px;font-size:13px;cursor:pointer;
    background:transparent;color:#334155;padding:0 4px;`;
  s.onmouseenter = () => s.style.background = '#f1f5f9';
  s.onmouseleave = () => s.style.background = 'transparent';
  sizes.forEach(sz => {
    const o = document.createElement('option');
    o.value = sz; o.textContent = sz;
    if ((op.size || 12) === sz) o.selected = true;
    s.appendChild(o);
  });
  // Allow custom size not in list
  if (!sizes.includes(op.size || 12)) {
    const o = document.createElement('option');
    o.value = op.size; o.textContent = op.size; o.selected = true;
    s.appendChild(o);
  }
  s.onchange = () => cb.onStyle({ size: parseInt(s.value) });
  s.onclick = e => e.stopPropagation();
  return s;
}

function colorBtn(op, cb) {
  const wrap = document.createElement('button');
  wrap.title = 'Text color';
  wrap.setAttribute('aria-label', 'Text color');
  wrap.style.cssText = `border:0;border-radius:8px;width:32px;height:32px;cursor:pointer;
    background:transparent;display:flex;align-items:center;justify-content:center;`;
  wrap.onmouseenter = () => wrap.style.background = '#f1f5f9';
  wrap.onmouseleave = () => wrap.style.background = 'transparent';
  // Show an "A" with color underline
  wrap.innerHTML = `<span style="font-size:16px;font-weight:700;color:${op.color || '#000'};border-bottom:3px solid ${op.color || '#000'};line-height:1;">A</span>`;
  const inp = document.createElement('input');
  inp.type = 'color';
  inp.value = op.color || '#000000';
  inp.style.cssText = 'position:absolute;opacity:0;width:0;height:0;pointer-events:none;';
  wrap.appendChild(inp);
  wrap.onclick = (e) => { e.stopPropagation(); inp.click(); };
  inp.oninput = () => {
    cb.onStyle({ color: inp.value });
    wrap.querySelector('span').style.color = inp.value;
    wrap.querySelector('span').style.borderBottomColor = inp.value;
  };
  return wrap;
}

function deleteBtn(cb) {
  return btn('🗑️', 'Delete object (Del)', () => cb.onDelete(), { fontSize: '15px' });
}

// ---------- per-type toolbars ----------

function buildTextControls(bar, node, op, cb) {
  // Group 0: Move + Edit
  bar.appendChild(btn('✥', 'Move object (drag)', () => cb.onMoveMode(), { fontSize: '16px' }));
  bar.appendChild(btn('✎', 'Edit text', () => cb.onEditText()));
  bar.appendChild(groupSep());
  // Group 1: B I
  bar.appendChild(btn('<b>B</b>', 'Bold (Ctrl+B)', b => cb.onStyle({ bold: !op.bold }), { active: op.bold }));
  bar.appendChild(btn('<i>I</i>', 'Italic (Ctrl+I)', b => cb.onStyle({ italic: !op.italic }), { active: op.italic }));
  bar.appendChild(groupSep());
  // Group 2: font + size
  bar.appendChild(fontSelect(op, cb));
  bar.appendChild(sizeSelect(op, cb));
  bar.appendChild(groupSep());
  // Group 3: color + align
  bar.appendChild(colorBtn(op, cb));
  const alignIcons = { left: '⇤', center: '⇔', right: '⇥' };
  const alignLabels = { left: 'Align left', center: 'Align center', right: 'Align right' };
  const cur = op.align || 'left';
  bar.appendChild(btn(alignIcons[cur], alignLabels[cur] + ' (click to cycle)', () => {
    const order = ['left', 'center', 'right'];
    cb.onStyle({ align: order[(order.indexOf(cur) + 1) % 3] });
  }));
  bar.appendChild(groupSep());
  // Group 4: delete
  bar.appendChild(deleteBtn(cb));
}

function buildShapeControls(bar, node, op, cb) {
  bar.appendChild(btn('✥', 'Move object (drag)', () => cb.onMoveMode(), { fontSize: '16px' }));
  bar.appendChild(groupSep());
  bar.appendChild(colorBtn({ color: op.stroke }, { onStyle: s => cb.onStyle({ stroke: s.color }) }));
  bar.appendChild(btn('◉', 'Toggle fill', () => cb.onStyle({ fill: op.fill ? null : (op.stroke || '#2f6bff') }), { active: !!op.fill }));
  const sizes = [1, 2, 4, 6, 8];
  const s = document.createElement('select');
  s.title = 'Line width';
  s.style.cssText = 'border:0;border-radius:8px;height:32px;font-size:13px;background:transparent;cursor:pointer;';
  sizes.forEach(w => {
    const o = document.createElement('option');
    o.value = w; o.textContent = w + 'px';
    if ((op.thickness || 2) === w) o.selected = true;
    s.appendChild(o);
  });
  s.onchange = () => cb.onStyle({ thickness: parseInt(s.value) });
  s.onclick = e => e.stopPropagation();
  bar.appendChild(s);
  bar.appendChild(groupSep());
  bar.appendChild(deleteBtn(cb));
}

function buildImageControls(bar, node, op, cb) {
  bar.appendChild(btn('✥', 'Move object (drag)', () => cb.onMoveMode(), { fontSize: '16px' }));
  bar.appendChild(groupSep());
  bar.appendChild(btn('🔄', 'Replace image', () => cb.onReplace()));
  bar.appendChild(btn('↻', 'Rotate 90°', () => cb.onRotate()));
  bar.appendChild(groupSep());
  bar.appendChild(deleteBtn(cb));
}

function buildLinkControls(bar, node, op, cb) {
  bar.appendChild(btn('✎', 'Edit link URL', () => {
    const url = window.prompt('Link URL:', op.url || 'https://');
    if (url && url !== 'https://') cb.onStyle({ url });
  }));
  bar.appendChild(groupSep());
  bar.appendChild(deleteBtn(cb));
}

function buildGenericControls(bar, node, op, cb) {
  bar.appendChild(btn('✥', 'Move object (drag)', () => cb.onMoveMode(), { fontSize: '16px' }));
  bar.appendChild(groupSep());
  bar.appendChild(deleteBtn(cb));
}

function buildFieldControls(bar, node, op, cb) {
  bar.appendChild(btn('✥', 'Move object (drag)', () => cb.onMoveMode(), { fontSize: '16px' }));
  bar.appendChild(btn('✎', 'Edit field name/value', () => cb.onEditField()));
  bar.appendChild(groupSep());
  bar.appendChild(deleteBtn(cb));
}

function buildStampControls(bar, node, op, cb) {
  bar.appendChild(btn('✥', 'Move object (drag)', () => cb.onMoveMode(), { fontSize: '16px' }));
  bar.appendChild(btn('✎', 'Edit stamp text', () => cb.onEditStamp()));
  bar.appendChild(groupSep());
  bar.appendChild(deleteBtn(cb));
}

/** Escape for safe injection into dialog HTML. */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Inline dialog to edit a form field's name and value.
 * Checkbox fields get a toggle; all other types get a text input.
 * Commits through cb.onStyle so the change is undoable.
 */
export function openFieldEditor(op, cb) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:200;
    display:flex;align-items:center;justify-content:center;`;
  const modal = document.createElement('div');
  modal.style.cssText = `background:#fff;border-radius:16px;padding:24px;width:360px;
    box-shadow:0 20px 60px rgba(0,0,0,.25);font-family:system-ui,sans-serif;`;
  const isCheckbox = op.fieldType === 'checkbox';
  modal.innerHTML = `
    <h3 style="margin:0 0 12px;font-size:16px;font-weight:700">Edit form field</h3>
    <label style="display:block;font-size:12px;color:#64748b;margin-bottom:4px">Field name</label>
    <input id="ffName" value="${escapeHtml(op.name)}"
      style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:9px;font-size:14px;box-sizing:border-box;margin-bottom:12px">
    <label style="display:block;font-size:12px;color:#64748b;margin-bottom:4px">Value</label>
    ${isCheckbox
      ? `<label style="display:flex;align-items:center;gap:8px;font-size:14px;margin-bottom:12px;cursor:pointer">
           <input type="checkbox" id="ffValue" ${op.value ? 'checked' : ''} style="width:18px;height:18px"> Checked
         </label>`
      : `<input id="ffValue" value="${escapeHtml(op.value)}"
           style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:9px;font-size:14px;box-sizing:border-box;margin-bottom:12px">`}
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button id="ffCancel" style="background:#fff;border:1px solid #cbd5e1;border-radius:9px;padding:9px 16px;font-weight:600;cursor:pointer">Cancel</button>
      <button id="ffSave" style="background:#2f6bff;color:#fff;border:0;border-radius:9px;padding:9px 16px;font-weight:600;cursor:pointer">Save</button>
    </div>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  const nameInp = modal.querySelector('#ffName');
  const valInp = modal.querySelector('#ffValue');
  const close = () => overlay.remove();
  modal.querySelector('#ffCancel').onclick = close;
  overlay.onclick = e => { if (e.target === overlay) close(); };
  modal.querySelector('#ffSave').onclick = () => {
    const style = { name: nameInp.value.trim() };
    style.value = isCheckbox ? valInp.checked : valInp.value;
    close();
    cb.onStyle(style);
  };
  modal.querySelector('#ffSave').onkeydown = e => {
    if (e.key === 'Enter') modal.querySelector('#ffSave').click();
  };
  nameInp.focus();
  nameInp.select();
}

/**
 * Inline dialog to edit a stamp's text.
 * Commits through cb.onStyle so the change is undoable.
 */
export function openStampEditor(op, cb) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:200;
    display:flex;align-items:center;justify-content:center;`;
  const modal = document.createElement('div');
  modal.style.cssText = `background:#fff;border-radius:16px;padding:24px;width:340px;
    box-shadow:0 20px 60px rgba(0,0,0,.25);font-family:system-ui,sans-serif;`;
  modal.innerHTML = `
    <h3 style="margin:0 0 12px;font-size:16px;font-weight:700">Edit stamp</h3>
    <label style="display:block;font-size:12px;color:#64748b;margin-bottom:4px">Stamp text</label>
    <input id="stText" value="${escapeHtml(op.text)}"
      style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:9px;font-size:14px;box-sizing:border-box;margin-bottom:14px">
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button id="stCancel" style="background:#fff;border:1px solid #cbd5e1;border-radius:9px;padding:9px 16px;font-weight:600;cursor:pointer">Cancel</button>
      <button id="stSave" style="background:#2f6bff;color:#fff;border:0;border-radius:9px;padding:9px 16px;font-weight:600;cursor:pointer">Save</button>
    </div>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  const inp = modal.querySelector('#stText');
  const close = () => overlay.remove();
  modal.querySelector('#stCancel').onclick = close;
  overlay.onclick = e => { if (e.target === overlay) close(); };
  const save = () => {
    const t = inp.value.trim();
    close();
    if (t) cb.onStyle({ text: t.toUpperCase() });
  };
  modal.querySelector('#stSave').onclick = save;
  inp.onkeydown = e => { if (e.key === 'Enter') save(); };
  inp.focus();
  inp.select();
}
