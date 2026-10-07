/**
 * Contextual floating toolbar — per-object-type controls.
 *
 * Per spec §8: when an object is selected, show only the controls
 * relevant to that object type, positioned near the object.
 * Does not appear in the exported PDF.
 *
 * PDFEDI design: brand #2f6bff, rounded, subtle shadow.
 */

let bar = null;
let currentNode = null;
let callbacks = {};

export function showContextBar(node, op, cb) {
  hideContextBar();
  if (!node) return;
  currentNode = node;
  callbacks = cb;

  bar = document.createElement('div');
  bar.id = 'ctx-bar';
  bar.style.cssText = `
    position:absolute;z-index:30;display:flex;gap:4px;align-items:center;
    background:#fff;border:1px solid #e2e8f0;border-radius:12px;
    box-shadow:0 8px 24px rgba(15,23,42,.14);padding:6px 8px;
    font-family:system-ui,sans-serif;font-size:12px;`;

  const type = node.getAttr('_objType') || op?.op || 'unknown';
  const controls = controlsFor(type, op);
  controls.forEach(c => bar.appendChild(c));

  const container = node.getStage().container();
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.appendChild(bar);
  positionBar(node);
}

export function hideContextBar() {
  bar?.remove();
  bar = null;
  currentNode = null;
}

export function refreshContextBar() {
  if (bar && currentNode) positionBar(currentNode);
}

function positionBar(node) {
  if (!bar) return;
  const box = node.getClientRect();
  const stage = node.getStage();
  const scale = stage.scaleX();
  const barW = bar.offsetWidth || 200;
  let x = box.x + box.width / 2 - barW / 2;
  let y = box.y - 48;
  x = Math.max(8, Math.min(x, stage.width() - barW - 8));
  if (y < 8) y = box.y + box.height + 8;
  bar.style.left = `${x / scale}px`;
  bar.style.top = `${y / scale}px`;
}

// --- control builders ---

function btn(label, title, onClick, active) {
  const b = document.createElement('button');
  b.textContent = label;
  b.title = title;
  b.style.cssText = `
    border:1px solid ${active ? '#2f6bff' : '#e2e8f0'};border-radius:8px;
    background:${active ? '#eef4ff' : '#fff'};color:${active ? '#2f6bff' : '#334155'};
    padding:6px 8px;font-size:12px;font-weight:600;cursor:pointer;min-width:28px;`;
  b.onclick = (e) => { e.stopPropagation(); onClick(b); };
  return b;
}

function colorInput(value, onChange) {
  const c = document.createElement('input');
  c.type = 'color'; c.value = value || '#000000';
  c.title = 'Color';
  c.style.cssText = 'width:30px;height:28px;border:1px solid #e2e8f0;border-radius:8px;padding:2px;cursor:pointer;';
  c.oninput = () => onChange(c.value);
  c.onclick = (e) => e.stopPropagation();
  return c;
}

function select(options, value, onChange) {
  const s = document.createElement('select');
  s.style.cssText = 'border:1px solid #e2e8f0;border-radius:8px;padding:5px 6px;font-size:12px;cursor:pointer;';
  options.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.v; opt.textContent = o.l;
    if (o.v == value) opt.selected = true;
    s.appendChild(opt);
  });
  s.onchange = () => onChange(s.value);
  s.onclick = (e) => e.stopPropagation();
  return s;
}

function sep() {
  const d = document.createElement('div');
  d.style.cssText = 'width:1px;height:22px;background:#e2e8f0;margin:0 2px;';
  return d;
}

// --- per-type control sets ---

function controlsFor(type, op) {
  const out = [];
  const cb = callbacks;

  // Common: duplicate, delete
  const commonEnd = () => {
    out.push(sep());
    out.push(btn('⧉', 'Duplicate', () => cb.onDuplicate?.()));
    out.push(btn('🗑', 'Delete', () => cb.onDelete?.()));
  };

  if (op?.op === 'add_text' || type === 'add_text') {
    out.push(btn('B', 'Bold', (b) => cb.onStyle?.({ bold: !op.bold }, b), op.bold));
    out.push(btn('I', 'Italic', (b) => cb.onStyle?.({ italic: !op.italic }, b), op.italic));
    out.push(select(
      [8,10,12,14,18,24,32,48].map(s => ({ v: s, l: s + 'pt' })),
      op.size || 12, v => cb.onStyle?.({ size: +v })
    ));
    out.push(colorInput(op.color, v => cb.onStyle?.({ color: v })));
    out.push(btn('≡', 'Align: left/center/right', () => {
      const order = ['left', 'center', 'right'];
      const next = order[(order.indexOf(op.align || 'left') + 1) % 3];
      cb.onStyle?.({ align: next });
    }));
    commonEnd();
  } else if (type === 'add_shape' || op?.op === 'add_shape') {
    out.push(colorInput(op.stroke, v => cb.onStyle?.({ stroke: v })));
    out.push(btn('▦', 'Fill color', () => {
      const cur = op.fill ? null : (op.stroke || '#2f6bff');
      cb.onStyle?.({ fill: cur });
    }, !!op.fill));
    out.push(select(
      [1,2,3,4,6,8].map(t => ({ v: t, l: t + 'px' })),
      op.thickness || 2, v => cb.onStyle?.({ thickness: +v })
    ));
    commonEnd();
  } else if (op?.op === 'add_image' || op?.op === 'add_signature') {
    out.push(btn('🔄', 'Replace', () => cb.onReplace?.()));
    out.push(btn('↻', 'Rotate 90°', () => cb.onRotate?.()));
    commonEnd();
  } else if (op?.op === 'add_link') {
    out.push(btn('✎', 'Edit URL', () => {
      const url = prompt('Link URL:', op.url || 'https://');
      if (url) cb.onStyle?.({ url });
    }));
    commonEnd();
  } else {
    // Generic: delete + duplicate
    commonEnd();
  }

  return out;
}
