'use strict';
const PALETTE = [
  '#000000','#800000','#008000','#808000',
  '#000080','#800080','#008080','#C0C0C0',
  '#808080','#FF0000','#00FF00','#FFFF00',
  '#0000FF','#FF00FF','#00FFFF','#FFFFFF'
];
const ZOOMS = [1,2,4,8];
const W = 500, H = 500;
const STATUS = { tool:'pencil', color:0, grid:true, minimap:true, sound:true };
const KEY_TO_TOOL = { 'b':'pencil', 'e':'eraser', 'i':'eyedropper', 'h':'hand' };
let zoomIdx = 3;
let camX = 0, camY = 0;
let isPanning = false, panStart = null;
let nextAllowedTs = 0;
let nick = localStorage.getItem('pp95_nick') || ('Guest' + Math.floor(Math.random()*9000+1000));
localStorage.setItem('pp95_nick', nick);
const lastIdKey = 'pp95_last_event_id';
// server-provided user cooldown override (null=default, 0=no cooldown, >0 seconds)
let cooldownOverride = null;

let hover = {x:null, y:null};

const desktop = document.getElementById('desktop');
const win = document.getElementById('win-paint');
const taskPaint = document.getElementById('task-paint');
const screen = document.getElementById('screen'); const sctx = screen.getContext('2d');
const mini = document.getElementById('miniMap'); const mctx = mini.getContext('2d');
const palette = document.getElementById('palette');
const sbPos = document.getElementById('sb-pos');
const sbColor = document.getElementById('sb-color');
const sbTimer = document.getElementById('sb-timer');
const cursorLabel = document.getElementById('cursorLabel');
const chkGrid = document.getElementById('chk-grid');
const chkMini = document.getElementById('chk-minimap');
const chkSound = document.getElementById('chk-sound');

const world = document.createElement('canvas'); world.width=W; world.height=H;
const wctx = world.getContext('2d', { willReadFrequently: true });
wctx.imageSmoothingEnabled = false;

let clockEl = document.getElementById('clock');
setInterval(()=>{ clockEl.textContent = new Date().toLocaleTimeString(); }, 1000);

const sounds = {
  click: new Audio('/assets/sounds/click.wav'),
  error: new Audio('/assets/sounds/error.wav'),
  tick:  new Audio('/assets/sounds/tick.wav'),
};
function play(name) { if (STATUS.sound) { try { sounds[name].currentTime = 0; sounds[name].play(); } catch {} } }

// Window move
const titlebar = document.getElementById('paint-titlebar');
let dragging = false, dragOff = [0,0];
titlebar.addEventListener('mousedown', (e)=>{
  const rect = win.getBoundingClientRect();
  dragging = true; dragOff = [e.clientX-rect.left, e.clientY-rect.top];
});
window.addEventListener('mousemove', (e)=>{ if (!dragging || win.classList.contains('maximized')) return;
  win.style.left = (e.clientX - dragOff[0])+'px';
  win.style.top  = (e.clientY - dragOff[1])+'px';
});
window.addEventListener('mouseup', ()=> dragging=false);

win.querySelector('.btn-close').onclick = ()=>{ win.hidden=true; taskPaint.hidden=true; };
win.querySelector('.btn-min').onclick   = ()=>{ win.hidden=true; taskPaint.hidden=false; };
win.querySelector('.btn-max').onclick   = ()=>{ win.classList.toggle('maximized'); fitScreen(); };
taskPaint.onclick = ()=>{ win.hidden=false; taskPaint.hidden=false; bringToFront(win); };

desktop.addEventListener('dblclick', (e)=>{
  const icon = e.target.closest('.icon');
  if (icon && icon.dataset.app==='paint') openApp();
});
function openApp(){
  win.hidden=false; taskPaint.hidden=false; bringToFront(win); play('click');
}

// Menus
document.querySelectorAll('.menu').forEach(m=>{
  m.addEventListener('mouseenter',()=>m.classList.add('open'));
  m.addEventListener('mouseleave',()=>m.classList.remove('open'));
});
document.querySelectorAll('[data-cmd="help-about"]').forEach(b=>b.onclick=about);
document.querySelectorAll('[data-cmd="file-exit"]').forEach(b=>b.onclick=()=>{win.hidden=true; taskPaint.hidden=true;});
document.querySelectorAll('[data-zoom]').forEach(b=>b.onclick=()=>setZoom(parseFloat(b.dataset.zoom)));
chkGrid.onchange = ()=>{ STATUS.grid = chkGrid.checked; redraw(); };
chkMini.onchange = ()=>{ STATUS.minimap = chkMini.checked; mini.style.display = STATUS.minimap ? 'block':'none'; };
chkSound.onchange = ()=>{ STATUS.sound = chkSound.checked; };

// Palette
function rgbStrFromIndex(i){
  const hex = PALETTE[i];
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `Color: ${r},${g},${b}`;
}
PALETTE.forEach((hex,i)=>{
  const sw = document.createElement('div'); sw.className='sw'; sw.style.background=hex;
  sw.title = hex + ' (#'+i+')';
  sw.onclick = ()=>{ STATUS.color = i; sbColor.textContent = rgbStrFromIndex(i); play('click'); };
  palette.appendChild(sw);
});
sbColor.textContent = rgbStrFromIndex(STATUS.color);

// Tools
document.querySelectorAll('.tool').forEach(btn=>{
  btn.onclick = ()=>{
    const t = btn.dataset.tool;
    if (t==='bucket') { modalError('Paint.exe caused an invalid page fault.'); play('error'); return; }
    setTool(t);
  };
});
setTool('pencil');
function setTool(t){
  STATUS.tool = t;
  document.querySelectorAll('.tool').forEach(b=>b.classList.toggle('active', b.dataset.tool===t));
  screen.style.cursor = (t==='pencil' || t==='eraser' || t==='eyedropper') ? 'crosshair' :
                        (t==='hand' ? 'grab' : (t==='zoom' ? 'zoom-in' : 'default'));
}

// Render
function fitScreen(){
  const wrap = document.getElementById('canvasWrap');
  const pad = 16;
  const ww = wrap.clientWidth - pad*2, hh = wrap.clientHeight - pad*2;
  screen.width = Math.max(320, ww);
  screen.height = Math.max(240, hh);
  sctx.imageSmoothingEnabled = false;
  redraw();
}
window.addEventListener('resize', fitScreen);
fitScreen();

function redraw(){
  sctx.clearRect(0,0,screen.width,screen.height);
  const scale = ZOOMS[zoomIdx];
  const vw = Math.floor(screen.width / scale);
  const vh = Math.floor(screen.height / scale);

  camX = Math.max(0, Math.min(W - vw, camX));
  camY = Math.max(0, Math.min(H - vh, camY));

  sctx.drawImage(world, camX, camY, vw, vh, 0, 0, screen.width, screen.height);

  if (STATUS.grid) {
    sctx.save();
    const a = Math.min(0.35, Math.max(0.08, (scale-1)/8));
    sctx.globalAlpha = a;
    sctx.beginPath();
    for (let x=0; x<=vw; x++){
      const sx = Math.floor(x*scale)+0.5;
      sctx.moveTo(sx,0); sctx.lineTo(sx,screen.height);
    }
    for (let y=0; y<=vh; y++){
      const sy = Math.floor(y*scale)+0.5;
      sctx.moveTo(0,sy); sctx.lineTo(screen.width,sy);
    }
    sctx.strokeStyle = '#000000';
    sctx.stroke();
    sctx.restore();
  }

  // hovered cell highlight
  if (hover.x !== null && hover.y !== null) {
    const sx = (hover.x - camX) * scale;
    const sy = (hover.y - camY) * scale;
    if (sx >= 0 && sy >= 0 && sx < screen.width && sy < screen.height) {
      sctx.save();
      const lw = Math.max(2, Math.floor(scale/2));
      const pad = Math.max(0, Math.floor(scale*0.05));
      sctx.lineWidth = lw;
      sctx.strokeStyle = '#000000';
      sctx.globalAlpha = 0.9;
      sctx.strokeRect(Math.floor(sx)+0.5+pad, Math.floor(sy)+0.5+pad, Math.floor(scale)-lw-2*pad, Math.floor(scale)-lw-2*pad);
      sctx.strokeStyle = '#FFFFFF';
      sctx.globalAlpha = 0.6;
      sctx.strokeRect(Math.floor(sx)+1.5+pad, Math.floor(sy)+1.5+pad, Math.floor(scale)-lw-2*pad-2, Math.floor(scale)-lw-2*pad-2);
      sctx.restore();
    }
  }

  if (STATUS.minimap) {
    mctx.imageSmoothingEnabled = false;
    mctx.clearRect(0,0,mini.width,mini.height);
    mctx.drawImage(world, 0, 0, W, H, 0, 0, mini.width, mini.height);
    const rx = camX / W * mini.width;
    const ry = camY / H * mini.height;
    const rw = (screen.width / scale) / W * mini.width;
    const rh = (screen.height / scale) / H * mini.height;
    mctx.strokeStyle = '#ff00ff';
    mctx.lineWidth = 1;
    mctx.strokeRect(rx, ry, rw, rh);
  }
}

// Mouse
screen.addEventListener('mousedown', e=>{
  if (modalOpen()) return;
  const pos = toWorld(e);
  if (STATUS.tool==='hand' || e.button===1) {
    isPanning = true; panStart = { mx:e.clientX, my:e.clientY, sx:camX, sy:camY };
    screen.style.cursor = 'grabbing';
  } else if (STATUS.tool==='zoom') {
    if (e.shiftKey) zoomOut(pos.x, pos.y); else zoomIn(pos.x, pos.y);
  } else if (STATUS.tool==='eyedropper') {
    const idx = getColorIndex(pos.x, pos.y);
    if (idx!==null) { STATUS.color = idx; sbColor.textContent=rgbStrFromIndex(idx); play('click'); }
  } else if (STATUS.tool==='pencil' || STATUS.tool==='eraser') {
    paintAt(pos.x, pos.y, STATUS.tool==='eraser' ? 15 : STATUS.color);
  }
});
screen.addEventListener('mousemove', e=>{
  const pos = toWorld(e);
  sbPos.textContent = `X: ${pos.x} Y: ${pos.y}`;
  moveCursorLabel(e);
  hover.x = pos.x; hover.y = pos.y;
  if (isPanning) {
    const dx = e.clientX - panStart.mx;
    const dy = e.clientY - panStart.my;
    const scale = ZOOMS[zoomIdx];
    camX = panStart.sx - Math.round(dx / scale);
    camY = panStart.sy - Math.round(dy / scale);
  }
  redraw();
});
screen.addEventListener('mouseleave', ()=>{ hover.x = hover.y = null; redraw(); });
window.addEventListener('mouseup', ()=>{ isPanning=false; if (STATUS.tool==='hand') screen.style.cursor='grab'; });

screen.addEventListener('wheel', e=>{
  if (modalOpen()) { e.preventDefault(); return; }
  e.preventDefault();
  const pos = toWorld(e);
  if (e.deltaY < 0) zoomIn(pos.x, pos.y); else zoomOut(pos.x, pos.y);
}, {passive:false});

mini.addEventListener('click', e=>{
  if (!STATUS.minimap || modalOpen()) return;
  const r = mini.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const cx = Math.floor(mx / mini.width * W);
  const cy = Math.floor(my / mini.height * H);
  const scale = ZOOMS[zoomIdx];
  camX = cx - Math.floor(screen.width/scale/2);
  camY = cy - Math.floor(screen.height/scale/2);
  redraw();
});

function toWorld(e){
  const rect = screen.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const scale = ZOOMS[zoomIdx];
  const wx = clamp(Math.floor(sx/scale) + camX, 0, W-1);
  const wy = clamp(Math.floor(sy/scale) + camY, 0, H-1);
  return {x:wx, y:wy};
}
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

function setZoom(z, pivotX=null, pivotY=null){
  const idx = ZOOMS.indexOf(z);
  if (idx === -1) return;
  if (z > 8) { modalError('Out of Memory.'); play('error'); return; }
  const scaleOld = ZOOMS[zoomIdx];
  const scaleNew = z;
  if (pivotX===null){ pivotX = camX + Math.floor(screen.width/scaleOld/2); }
  if (pivotY===null){ pivotY = camY + Math.floor(screen.height/scaleOld/2); }
  zoomIdx = idx;
  camX = pivotX - Math.floor(screen.width/scaleNew/2);
  camY = pivotY - Math.floor(screen.height/scaleNew/2);
  redraw();
}
function zoomIn(px,py){ const ni = Math.min(ZOOMS.length-1, zoomIdx+1); setZoom(ZOOMS[ni], px, py); }
function zoomOut(px,py){ const ni = Math.max(0, zoomIdx-1); setZoom(ZOOMS[ni], px, py); }

function getColorIndex(x,y){
  const data = wctx.getImageData(x, y, 1, 1).data;
  const hex = '#' + [data[0],data[1],data[2]].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();
  const idx = PALETTE.indexOf(hex);
  return idx === -1 ? null : idx;
}

async function paintAt(x,y,colorIndex){
  const now = Math.floor(Date.now()/1000);
  // Respect per-user override: if 0 => no local precheck
  if (!(cooldownOverride === 0)) {
    if (now < nextAllowedTs) { modalError('Invalid Operation: Cooldown not finished.'); play('error'); return; }
  }
  try {
    const r = await fetch('/api/paint.php', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({x,y,color:colorIndex})
    });
    const js = await r.json();
    if (!r.ok) {
      if (js && js.error==='cooldown') {
        nextAllowedTs = js.next_allowed_ts || (now + 1);
        modalError('Invalid Operation: Cooldown not finished.'); play('error');
      } else {
        modalError('Error: cannot paint.'); play('error');
      }
    } else {
      if (js.cooldown_seconds === 0) {
        cooldownOverride = 0;
        nextAllowedTs = now; // always 0
      } else if (js.next_allowed_ts) {
        nextAllowedTs = js.next_allowed_ts;
      }
      setPixel(x,y,PALETTE[colorIndex]); redraw();
      play('click');
    }
  } catch {
    modalError('Network error.');
  }
}
function setPixel(x,y,hex){ wctx.fillStyle = hex; wctx.fillRect(x, y, 1, 1); }

function moveCursorLabel(e){
  const r = screen.getBoundingClientRect();
  cursorLabel.textContent = nick;
  cursorLabel.style.left = (e.clientX - r.left + 12) + 'px';
  cursorLabel.style.top  = (e.clientY - r.top  - 18) + 'px';
  cursorLabel.hidden = false;
}

let es = null;
function startSSE(lastId){
  if (es) try { es.close(); } catch {}
  es = new EventSource('/stream.php?last_id=' + (lastId||0));
  es.addEventListener('pixel', (ev)=>{
    const d = JSON.parse(ev.data);
    setPixel(d.x, d.y, PALETTE[d.color]);
    localStorage.setItem(lastIdKey, d.id);
    redraw();
  });
  es.addEventListener('ping', ()=>{});
  es.onerror = ()=>{};
}
function stopSSE(){ if (es) es.close(); es=null; }

async function loadSnapshot(){
  const r = await fetch('/api/snapshot.php', { cache:'no-cache' });
  if (!r.ok) throw new Error('snapshot failed');
  const blob = await r.blob();
  const lastId = parseInt(r.headers.get('X-Last-Event-Id') || '0',10);
  localStorage.setItem(lastIdKey, lastId);
  const bmp = await createImageBitmap(blob);
  wctx.clearRect(0,0,W,H);
  wctx.drawImage(bmp, 0, 0);
  redraw();
  startSSE(lastId);
}

// Ensure backend user session cookie exists; updates cooldownOverride
async function ensureSession(){
  try {
    const r = await fetch('/api/session.php', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({nick})
    });
    const js = await r.json();
    if (js && js.ok) {
      cooldownOverride = js.cooldown_override_seconds;
    }
  } catch {}
}

// Hotkeys
window.addEventListener('keydown', (e)=>{
  if (modalOpen()) {
    if (e.key === 'Escape' || e.key === 'Enter') closeTopModal();
    e.preventDefault(); e.stopPropagation(); return;
  }
  if (e.key==='=' || e.key==='+') { const pos = toWorldFromCenter(); zoomIn(pos.x,pos.y); e.preventDefault(); }
  if (e.key==='-' || e.key==='_') { const pos = toWorldFromCenter(); zoomOut(pos.x,pos.y); e.preventDefault(); }
  if (e.key.toLowerCase()==='g'){ chkGrid.checked=!chkGrid.checked; STATUS.grid=chkGrid.checked; redraw(); }
  const t = KEY_TO_TOOL[e.key.toLowerCase()];
  if (t){ setTool(t); }
});
function toWorldFromCenter(){
  const scale = ZOOMS[zoomIdx];
  return { x: camX + Math.floor(screen.width/scale/2), y: camY + Math.floor(screen.height/scale/2) };
}

// Cooldown timer UI
setInterval(()=>{
  if (cooldownOverride === 0) {
    sbTimer.textContent = 'Next pixel in: —';
    return;
  }
  const now = Math.floor(Date.now()/1000);
  const remain = Math.max(0, nextAllowedTs - now);
  const mm = Math.floor(remain / 60), ss = (remain % 60).toString().padStart(2,'0');
  sbTimer.textContent = `Next pixel in: ${mm}:${ss}`;
}, 250);

// Modal (blocking)
function modalBase(title, html){
  const layer = document.getElementById('modal-layer');
  layer.classList.add('active');
  const backdrop = document.createElement('div'); backdrop.className = 'backdrop'; layer.appendChild(backdrop);
  const dlg = document.createElement('div'); dlg.className='modal';
  dlg.style.left = 'calc(50% - 160px)'; dlg.style.top = '120px';
  dlg.innerHTML = `<div class="title">${title}</div><div class="body">${html}</div><div class="btns"><button class="ok">OK</button></div>`;
  layer.appendChild(dlg);
  const close = ()=>{ try { layer.removeChild(dlg); layer.removeChild(backdrop); } catch {} if (!layer.children.length) layer.classList.remove('active'); };
  dlg.querySelector('.ok').onclick = close;
  setTimeout(()=>{ dlg.querySelector('.ok').focus(); }, 0);
  return { close };
}
function modalError(msg){ modalBase('Error', `<p>${msg}</p>`); }
function about(){ modalBase('About PixelPaint95', `<p><b>PixelPaint95</b> — онлайн пиксель‑холст в духе Windows 95.</p><p>1 пиксель каждые 5 секунд. Реалтайм на чистом PHP (SSE), без WebSocket.</p><p><i>Пасхалка:</i> нажмите <b>G</b> для сетки, попробуйте ведро и максимальный зум.</p>`); }
function modalOpen(){ return document.getElementById('modal-layer').classList.contains('active'); }
function closeTopModal(){ const layer = document.getElementById('modal-layer'); const modals = Array.from(layer.querySelectorAll('.modal')); if (modals.length) { const dlg = modals[modals.length-1]; dlg.querySelector('.ok')?.click(); } }

// Idle screensaver
let idleT = null, saverOn = false, driftV = [0.25, 0.2];
function resetIdle(){ if (saverOn) { saverOn=false; win.style.opacity=1; } if (idleT) clearTimeout(idleT); idleT=setTimeout(startSaver, 120000); }
function startSaver(){ saverOn=true; drift(); }
function drift(){
  if (!saverOn) return;
  const rect = win.getBoundingClientRect();
  let nx = rect.left + driftV[0], ny = rect.top + driftV[1];
  if (nx < 10 || nx > window.innerWidth - rect.width - 10) driftV[0] = -driftV[0];
  if (ny < 10 || ny > window.innerHeight - rect.height - 42) driftV[1] = -driftV[1];
  win.style.left = nx + 'px'; win.style.top = ny + 'px';
  win.style.opacity = 0.9;
  requestAnimationFrame(drift);
}
['mousemove','mousedown','keydown','wheel','touchstart'].forEach(ev=>window.addEventListener(ev, resetIdle));
resetIdle();

function bringToFront(el){ el.style.zIndex = (Date.now()%1e7).toString(); }

async function init(){
  chkGrid.checked = true;
  mini.style.display = STATUS.minimap ? 'block' : 'none';
  fitScreen();
  await ensureSession();   // <-- ensure we have user and cooldown override
  try { await loadSnapshot(); } catch (e) {
    const lid = parseInt(localStorage.getItem(lastIdKey)||'0',10);
    startSSE(lid);
  }
}
init();
// Don't auto-open window; open with double-click on 🎨
