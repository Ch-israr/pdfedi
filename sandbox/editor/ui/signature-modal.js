/**
 * Signature modal — draw, type, or upload a signature.
 *
 * Per spec §6: proper modal with Draw/Type/Upload tabs, preview,
 * clear/redraw, apply/cancel. Result becomes a Signature Object
 * (movable, resizable, selectable, deletable).
 *
 * PDFEDI design language: brand #2f6bff, rounded corners, clean type.
 */

export function openSignatureModal(onApply) {
  // Build modal DOM
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:200;
    display:flex;align-items:center;justify-content:center;`;

  const modal = document.createElement('div');
  modal.style.cssText = `
    background:#fff;border-radius:16px;padding:24px;width:440px;max-width:92vw;
    box-shadow:0 20px 60px rgba(0,0,0,.25);font-family:system-ui,sans-serif;`;
  modal.innerHTML = `
    <h2 style="margin:0 0 4px;font-size:18px;font-weight:700">Add signature</h2>
    <p style="margin:0 0 16px;font-size:13px;color:#64748b">Draw, type, or upload your signature.</p>
    <div style="display:flex;gap:6px;margin-bottom:14px" id="sigTabs">
      <button data-tab="draw" style="${tabStyle(true)}">Draw</button>
      <button data-tab="type" style="${tabStyle(false)}">Type</button>
      <button data-tab="upload" style="${tabStyle(false)}">Upload</button>
    </div>
    <div id="sigDrawPane">
      <canvas id="sigCanvas" width="392" height="160"
        style="border:2px dashed #cbd5e1;border-radius:10px;cursor:crosshair;width:100%;touch-action:none"></canvas>
      <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
        <label style="font-size:12px">Ink:</label>
        <input type="color" id="sigColor" value="#1e3a8a" style="width:36px;height:28px;padding:2px;border:1px solid #cbd5e1;border-radius:6px">
        <button id="sigClear" style="${btnGhost()}">Clear</button>
      </div>
    </div>
    <div id="sigTypePane" style="display:none">
      <input id="sigTypeInput" placeholder="Type your full name" style="${inputStyle()}">
      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap" id="sigStyles"></div>
    </div>
    <div id="sigUploadPane" style="display:none">
      <div id="sigDrop" style="border:2px dashed #cbd5e1;border-radius:10px;padding:28px;text-align:center;cursor:pointer;font-size:13px;color:#64748b">
        Drop PNG here or click to browse<br><span style="font-size:11px">Transparent PNG works best</span>
        <input type="file" id="sigFile" accept="image/png,image/jpeg" style="display:none">
      </div>
    </div>
    <div id="sigPreviewWrap" style="margin-top:14px;display:none">
      <div style="font-size:12px;font-weight:600;margin-bottom:6px">Preview</div>
      <div id="sigPreview" style="border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:center;min-height:80px;background:#f8fafc"></div>
    </div>
    <div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end">
      <button id="sigCancel" style="${btnGhost()}">Cancel</button>
      <button id="sigApply" style="${btnPrimary()}" disabled>Apply signature</button>
    </div>`;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  let result = null; // { blob, dataUrl, kind }

  const setResult = (r) => {
    result = r;
    document.getElementById('sigApply').disabled = !r;
    const pv = document.getElementById('sigPreview');
    const wrap = document.getElementById('sigPreviewWrap');
    if (r) {
      wrap.style.display = 'block';
      pv.innerHTML = `<img src="${r.dataUrl}" style="max-height:70px;max-width:100%">`;
    } else {
      wrap.style.display = 'none';
      pv.innerHTML = '';
    }
  };

  // Tabs
  const tabs = modal.querySelectorAll('#sigTabs button');
  const panes = { draw: 'sigDrawPane', type: 'sigTypePane', upload: 'sigUploadPane' };
  tabs.forEach(b => b.onclick = () => {
    tabs.forEach(x => x.style.cssText = tabStyle(false));
    b.style.cssText = tabStyle(true);
    Object.entries(panes).forEach(([k, id]) => {
      document.getElementById(id).style.display = k === b.dataset.tab ? 'block' : 'none';
    });
    setResult(null);
  });

  // Draw pane
  const canvas = modal.querySelector('#sigCanvas');
  const g = canvas.getContext('2d');
  let drawing = false, hasDrawn = false;
  const pos = e => {
    const r = canvas.getBoundingClientRect();
    const t = e.touches?.[0] || e;
    return [(t.clientX - r.left) * (canvas.width / r.width),
            (t.clientY - r.top) * (canvas.height / r.height)];
  };
  const start = e => { e.preventDefault(); drawing = true; const [x, y] = pos(e); g.beginPath(); g.moveTo(x, y); };
  const move = e => {
    if (!drawing) return; e.preventDefault();
    const [x, y] = pos(e);
    g.strokeStyle = modal.querySelector('#sigColor').value;
    g.lineWidth = 3; g.lineCap = 'round'; g.lineJoin = 'round';
    g.lineTo(x, y); g.stroke(); hasDrawn = true;
  };
  const end = () => {
    if (!drawing) return; drawing = false;
    if (hasDrawn) {
      canvas.toBlob(b => {
        const url = URL.createObjectURL(b);
        setResult({ blob: b, dataUrl: url, kind: 'draw' });
      }, 'image/png');
    }
  };
  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  canvas.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);
  modal.querySelector('#sigClear').onclick = () => {
    g.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawn = false; setResult(null);
  };

  // Type pane
  const fonts = [
    ['Brush Script MT, cursive', 'Script'],
    ['Georgia, serif', 'Serif'],
    ['"Comic Sans MS", cursive', 'Casual'],
    ['"Courier New", monospace', 'Typewriter'],
  ];
  const styleWrap = modal.querySelector('#sigStyles');
  fonts.forEach(([fam, label]) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = btnGhost() + 'font-family:' + fam;
    b.onclick = () => renderTyped(fam);
    styleWrap.appendChild(b);
  });
  const renderTyped = (fam) => {
    const name = modal.querySelector('#sigTypeInput').value.trim();
    if (!name) return;
    const c = document.createElement('canvas');
    c.width = 400; c.height = 120;
    const gg = c.getContext('2d');
    gg.font = `italic 56px ${fam}`;
    gg.fillStyle = '#1e3a8a';
    gg.fillText(name, 20, 78);
    c.toBlob(b => {
      const url = URL.createObjectURL(b);
      setResult({ blob: b, dataUrl: url, kind: 'type' });
    }, 'image/png');
  };
  modal.querySelector('#sigTypeInput').addEventListener('input', () => renderTyped(fonts[0][0]));

  // Upload pane
  const drop = modal.querySelector('#sigDrop');
  const fileInp = modal.querySelector('#sigFile');
  drop.onclick = () => fileInp.click();
  fileInp.onchange = () => handleSigFile(fileInp.files[0]);
  function handleSigFile(f) {
    if (!f || !f.type.startsWith('image/')) return;
    const url = URL.createObjectURL(f);
    setResult({ blob: f, dataUrl: url, kind: 'upload' });
  }

  // Actions
  const close = () => overlay.remove();
  modal.querySelector('#sigCancel').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  modal.querySelector('#sigApply').onclick = () => {
    if (result) onApply(result);
    close();
  };
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });
}

function tabStyle(active) {
  return `flex:1;padding:9px;border-radius:9px;border:1px solid ${active ? '#2f6bff' : '#e2e8f0'};
    background:${active ? '#eef4ff' : '#fff'};color:${active ? '#2f6bff' : '#475569'};
    font-weight:600;font-size:13px;cursor:pointer;`;
}
function btnPrimary() {
  return `background:#2f6bff;color:#fff;border:0;border-radius:9px;padding:10px 20px;
    font-weight:600;font-size:14px;cursor:pointer;`;
}
function btnGhost() {
  return `background:#fff;color:#334155;border:1px solid #cbd5e1;border-radius:9px;
    padding:9px 14px;font-weight:600;font-size:13px;cursor:pointer;`;
}
function inputStyle() {
  return `width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:9px;
    font-size:15px;box-sizing:border-box;`;
}
