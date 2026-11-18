import { sunPosition, sunTimes, compassName } from './sun.js?v=261118190439';
import { createShadowLayer } from './shadows.js?v=261118190439';
import { createScene } from './scene.js?v=261118190439';
import { declination } from './vendor/wmm.js';

const EL = new Map();
const $ = s => { let e = EL.get(s); if (!e) { e = document.querySelector(s); if (e) EL.set(s, e); } return e; }; // 한 번 찾은 요소는 기억해 둔다
const rad = Math.PI / 180;
const pad = n => String(n).padStart(2, '0');
const hm = d => (d && !isNaN(d)) ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '—';
const mm = m => `${pad(Math.floor(m / 60))}:${pad(Math.round(m) % 60)}`;
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const SUN = '#ff7a1a', PATH_Y = '#ffc94d', GOLD = '#ff9a3d';
const NUM = '"General Sans", Paperlogy, sans-serif';
const APP = 'Sunpath';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const nowMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MERC = 40075016.686;
const mercX = lng => (lng + 180) / 360;
const mercY = lat => (1 - Math.log(Math.tan(Math.PI / 4 + lat * rad / 2)) / Math.PI) / 2;
const bearing = (a, b) => (Math.atan2((b.lng - a.lng) * Math.cos(a.lat * rad), b.lat - a.lat) / rad + 360) % 360;
const distM = (a, b) => Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 111320 * Math.cos(a.lat * rad));

// ───────── 상태 ─────────
const saved = JSON.parse(localStorage.getItem('haegil') || '{}');
const loadList = k => { try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const keep = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const FAVK = 'haegil.favs', RECK = 'haegil.recent';
let favs = loadList(FAVK), recent = loadList(RECK), gotFavs = null;
// 폰으로 보내는 링크는 늘 공개 주소로(이 PC 주소는 폰에서 안 열린다)
const PUBLIC = 'https://ynkiki.github.io/sun/';
const BASE = /^(127\.|localhost|192\.168\.|10\.)/.test(location.hostname) ? PUBLIC : location.origin + location.pathname;
// 고른 자리(핀) = lat · lng. 지도를 밀거나 확대해도 바뀌지 않고, 지도를 누르거나 검색 · 찜 · 내 위치로만 옮겨진다
const state = {
  lat: saved.lat ?? 37.5663, lng: saved.lng ?? 126.9779, zoom: saved.zoom ?? 16.4, place: saved.place ?? null, season: [],
  day: startOfDay(new Date()), min: nowMin(), followNow: true, mode: 'map', rvSub: null, sheetMin: localStorage.getItem('haegil.smin') === '1', spotOpen: false, panelMin: localStorage.getItem('haegil.pmin') === '1',
  times: null, path: [],
  sub: saved.sub && typeof saved.sub.lat === 'number' && typeof saved.sub.lng === 'number' ? saved.sub : null, // 바라볼 곳(피사체 자리)
};
(function readHash() {
  const fm = location.hash.match(/^#favs=([\w-]+)/);
  if (fm) { // 다른 기기에서 보낸 찜 목록
    try {
      const list = JSON.parse(decodeURIComponent(escape(atob(fm[1].replace(/-/g, '+').replace(/_/g, '/')))));
      gotFavs = 0;
      for (const f of list) {
        if (typeof f.lat !== 'number' || typeof f.lng !== 'number' || favs.some(g => distM(g, f) < 15)) continue;
        favs.push({ name: String(f.name || '찜한 곳').slice(0, 60), addr: String(f.addr || '').slice(0, 120), lat: f.lat, lng: f.lng }); gotFavs++;
      }
      keep(FAVK, favs);
    } catch { gotFavs = null; }
    return;
  }
  const m = location.hash.match(/^#(-?[\d.]+),(-?[\d.]+)(?:,([\d.]+))?(?:\/(\d{4}-\d{2}-\d{2}))?(?:\/(\d{2})(\d{2}))?/);
  if (!m) return;
  if (distM({ lat: +m[1], lng: +m[2] }, state) > 15) state.place = null;
  state.lat = +m[1]; state.lng = +m[2]; if (m[3]) state.zoom = +m[3];
  if (m[4]) { const [y, mo, d] = m[4].split('-').map(Number); state.day = new Date(y, mo - 1, d); state.followNow = false; }
  if (m[5]) { state.min = +m[5] * 60 + +m[6]; state.followNow = false; }
})();
const selected = () => new Date(state.day.getTime() + state.min * 60000);
const sunNow = () => sunPosition(selected(), state.lat, state.lng);
const isDark = () => state.mode === 'cmp' || state.mode === 'ar';
// 화면 배치 셋: 넓은 화면(왼쪽 판) · 폰 가로(펴면 왼쪽 좁은 판, 접으면 아래 한 줄) · 폰 세로(아래 시트)
const MQ_WIDE = matchMedia('(min-width: 860px) and (min-height: 521px)'), MQ_LAND = matchMedia('(orientation: landscape) and (max-height: 520px) and (min-width: 540px)');
const wide = () => MQ_WIDE.matches, land = () => MQ_LAND.matches;
const isMin = () => state.sheetMin && !wide();
let landBack = null; // 가로로 눕히면 접어서 열고, 다시 세우면 원래대로
if (land()) { landBack = state.sheetMin; state.sheetMin = true; }

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    localStorage.setItem('haegil', JSON.stringify({ lat: state.lat, lng: state.lng, zoom: state.zoom, place: state.place, sub: state.sub }));
    let h = `#${state.lat.toFixed(5)},${state.lng.toFixed(5)},${state.zoom.toFixed(1)}`;
    if (!state.followNow) h += `/${ymd(state.day)}/${pad(Math.floor(state.min / 60))}${pad(state.min % 60)}`;
    history.replaceState(null, '', h);
  }, 250);
}
let toastTimer;
function toast(text) {
  const t = $('#toast'); t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}
function bodyClass() {
  const c = [`mode-${state.mode}`];
  if (isDark()) c.push('dark');
  if (isMin()) c.push('min');
  if (state.panelMin) c.push('pmin');
  if (state.mode === 'rv' && state.rvSub) c.push(`sub-${state.rvSub}`);
  if (document.body.classList.contains('look')) c.push('look');
  const k = c.join(' ');
  if (document.body.className === k && LAY.done) return; // 그대로면 다시 재지 않는다
  document.body.className = k;
  measure(); LAY.done = true;
}
// 화면 배치 값. 화면 · 시트 크기나 접힘이 바뀔 때만 다시 잰다(그릴 때마다 재면 폰에서 버벅인다)
const LAY = { kind: 'phone', side: 0, rv: 0, bottom: 0, ty: 84, aTop: 206, aBot: 140, lensV: 178 };
function measure() {
  const sh = $('#sheet'), k = wide() ? 'wide' : land() ? 'land' : 'phone', min = isMin(), safeT = $('#safe')?.offsetHeight || 0;
  LAY.kind = k;
  LAY.side = k === 'wide' ? (state.panelMin ? 0 : 444) : k === 'land' && !min ? sh.offsetWidth : 0; // 왼쪽 판이 가리는 폭
  LAY.rv = k === 'wide' ? LAY.side : 0;                                                            // 로드뷰 화면을 가리는 폭(가로 폰은 로드뷰가 판 옆에서 시작해서 0)
  LAY.bottom = k === 'phone' || (k === 'land' && min) ? sh.offsetHeight : 0;                       // 아래 시트가 가리는 높이
  LAY.ty = k === 'wide' ? 44 : (k === 'land' || min ? 30 : 84) + safeT;                             // 로드뷰 방위 자 높이(검색 줄이 숨는 배치는 맨 위로)
  LAY.aTop = k === 'phone' ? LAY.ty + (min ? 142 : 122) : LAY.ty + 64;
  LAY.aBot = k === 'wide' || (k === 'land' && !min) ? 70 : min ? LAY.bottom + 64 : 140;
  LAY.lensV = k === 'wide' ? 170 : k === 'land' ? 62 : 178;
}
// 캔버스 크기는 바뀔 때만 받아 둔다. 그릴 때마다 clientWidth를 읽으면 화면 배치를 통째로 다시 계산하게 돼서 느려진다
const CVS = new Map();
const cvRO = new ResizeObserver(es => {
  for (const e of es) { const c = CVS.get(e.target); if (c) { c.w = e.contentRect.width; c.h = e.contentRect.height; c.dirty = true; } }
  redraw();
});
function cvSize(cv) {
  let c = CVS.get(cv);
  if (!c) { c = { ctx: null, w: cv.clientWidth, h: cv.clientHeight, dpr: 1, dirty: true }; CVS.set(cv, c); cvRO.observe(cv); }
  return c;
}
function resizeCanvas(cv) {
  const c = cvSize(cv);
  c.ctx ??= cv.getContext('2d');
  if (c.dirty) {
    c.dirty = false; c.dpr = Math.min(devicePixelRatio || 1, c.w * c.h > 90000 ? 2 : 3); // 화면을 덮는 큰 캔버스는 2배까지만
    const W = Math.round(c.w * c.dpr), H = Math.round(c.h * c.dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  }
  c.ctx.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
  return c;
}
function redraw() { drawRuler(); drawOverlay(); requestScene(); requestCmp(); drawMini(); }
// 같은 글자를 다시 쓰지 않는다(쓸 때마다 화면 배치가 다시 계산된다)
const PUT = new Map();
function put(sel, v, html) { if (PUT.get(sel) === v) return false; PUT.set(sel, v); const e = $(sel); if (html) e.innerHTML = v; else e.textContent = v; return true; }
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function pill(ctx, x, y, text, { font = `600 12px ${NUM}`, bg = 'rgba(18,18,20,.55)', fg = '#fff', h = 24 } = {}) {
  ctx.font = font; const pw = ctx.measureText(text).width + 18;
  roundRect(ctx, x - pw / 2, y - h / 2, pw, h, h / 2); ctx.fillStyle = bg; ctx.fill();
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 0.5);
}

// ───────── 지도 ─────────
bodyClass();
const sideW = () => LAY.side; // 왼쪽 판이 차지하는 폭(접으면 0)
const mapPadding = () => ({ left: LAY.side, right: 0, top: 0, bottom: LAY.bottom });
const map = new maplibregl.Map({
  container: 'map', style: 'https://tiles.openfreemap.org/styles/positron',
  center: [state.lng, state.lat], zoom: state.zoom, maxPitch: 0, pitchWithRotate: false, dragRotate: false,
  attributionControl: { compact: true }, fadeDuration: 0, pixelRatio: Math.min(devicePixelRatio || 1, 2),
});
map.touchZoomRotate.disableRotation(); map.touchPitch.disable(); map.keyboard.disableRotation();
window.__map = map; window.__sc = () => SC;
let padKey = '';
function syncPadding() {
  const pd = mapPadding(), k = JSON.stringify(pd);
  if (k === padKey) return;
  if (map.isEasing()) { map.once('moveend', syncPadding); return; }
  padKey = k; map.setPadding(pd);
}
syncPadding();
const shadow = createShadowLayer();

map.on('load', () => {
  const paint = (id, k, v) => { try { if (map.getLayer(id)) map.setPaintProperty(id, k, v); } catch { /* 없는 층 */ } };
  let firstBuilding = null;
  for (const l of map.getStyle().layers) {
    if (l.type === 'symbol') {
      const tf = map.getLayoutProperty(l.id, 'text-field');
      if (tf && JSON.stringify(tf).includes('name')) map.setLayoutProperty(l.id, 'text-field', ['coalesce', ['get', 'name:ko'], ['get', 'name']]);
    }
    if (l['source-layer'] === 'building' && l.type === 'fill') {
      firstBuilding ??= l.id;
      paint(l.id, 'fill-color', '#ebe3d3'); paint(l.id, 'fill-outline-color', '#d5cab6'); paint(l.id, 'fill-opacity', 1);
    }
    if (l['source-layer'] === 'water' && l.type === 'fill') paint(l.id, 'fill-color', '#a5d0f0');
    if (l['source-layer'] === 'waterway' && l.type === 'line') paint(l.id, 'line-color', '#a5d0f0');
  }
  paint('background', 'background-color', '#f5f2eb');
  paint('park', 'fill-color', '#cbe6b8'); paint('park', 'fill-opacity', 1);
  paint('landcover_wood', 'fill-color', '#b4d9a4'); paint('landcover_wood', 'fill-opacity', 0.95);
  paint('landuse_residential', 'fill-color', '#f1ede3');
  try {
    map.addLayer({ id: 'lc-grass', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['grass', 'farmland']]], paint: { 'fill-color': '#d6ecc2' } }, map.getLayer('landcover_wood') ? 'landcover_wood' : firstBuilding);
    map.addLayer({ id: 'lc-sand', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'sand'], paint: { 'fill-color': '#f3e7c6' } }, 'lc-grass');
  } catch { /* 색만 덜 입음 */ }
  map.addLayer(shadow, firstBuilding ?? undefined);
  scheduleUpdate();
});

// 지도를 밀고 확대하는 건 보는 것만 바꾼다. 고른 자리는 그대로 붙어 있다
map.on('move', () => { if (state.mode === 'map') drawOverlay(); });
map.on('moveend', () => { if (!SC.active && !SC.hold) { state.zoom = map.getZoom(); save(); } pinChip(); });
// 지도를 한 번 누르면 그 자리로 옮긴다(두 번 눌러 확대할 때는 옮기지 않는다)
let tapT = 0, tapTimer;
map.on('click', e => {
  if (state.mode !== 'map') return;
  const now = performance.now(); clearTimeout(tapTimer);
  if (LP.fired) { LP.fired = false; return; }
  if (DRAG.on || now - DRAG.endT < 420) return;
  if (now - tapT < 330) { tapT = 0; return; }
  tapT = now;
  const pt = e.point, ll = e.lngLat;
  tapTimer = setTimeout(() => {
    const f = favs.find(g => { const q = map.project([g.lng, g.lat]); return Math.hypot(q.x - pt.x, q.y - pt.y) < 18; });
    if (f) setPin(f.lat, f.lng, { place: { name: f.name, addr: f.addr }, center: true }); else setPin(ll.lat, ll.lng, { center: true });
  }, 300);
});
// 가운데 점을 잡고 끌면 자리가 옮겨진다(지도는 그대로 있고 점만 따라온다)
const DRAG = { on: false, what: 'pin', hover: false, moved: false, dx: 0, dy: 0, endT: 0, from: null };
const coarse = () => matchMedia('(pointer: coarse)').matches;
const nearPin = pt => { const p = map.project([state.lng, state.lat]); return Math.hypot(p.x - pt.x, p.y - pt.y) < (coarse() ? 30 : 20); };
const nearSub = pt => { if (!state.sub) return false; const p = map.project([state.sub.lng, state.sub.lat]); return Math.hypot(p.x - pt.x, p.y - pt.y) < (coarse() ? 28 : 16); };
const mapCursor = c => { map.getCanvas().style.cursor = c; };
function dragStart(e) {
  if (state.mode !== 'map' || DRAG.on) return;
  const oe = e.originalEvent;
  if (oe.touches ? oe.touches.length !== 1 : oe.button !== 0) return;
  if (oe.touches) LP.touchT = performance.now(); else if (performance.now() - LP.touchT < 900) return; // 손가락 뒤에 따라오는 가짜 마우스는 넘긴다
  LP.fired = false;
  const what = nearPin(e.point) ? 'pin' : nearSub(e.point) ? 'sub' : '';
  if (!what) { // 빈 곳을 길게 누르면 바라볼 곳을 꽂는다
    if (oe.touches) { lpCancel(); const pt = e.point, ll = e.lngLat; LP.pt = pt; LP.timer = setTimeout(() => { LP.timer = 0; if (performance.now() - LP.at < 900) return; LP.fired = true; setSub(ll); }, 560); }
    return;
  }
  e.preventDefault(); // 지도 밀기 대신 점을 옮긴다
  clearTimeout(tapTimer); map.stop();
  const o = what === 'pin' ? state : state.sub, p = map.project([o.lng, o.lat]);
  Object.assign(DRAG, { on: true, what, moved: false, dx: p.x - e.point.x, dy: p.y - e.point.y, from: { lat: o.lat, lng: o.lng } });
  mapCursor('grabbing'); drawOverlay();
}
function dragMove(e) {
  if (!DRAG.on) {
    if (LP.timer && LP.pt && Math.hypot(e.point.x - LP.pt.x, e.point.y - LP.pt.y) > 9) lpCancel();
    if (!e.originalEvent.touches && state.mode === 'map') { const h = nearPin(e.point) || nearSub(e.point); if (h !== DRAG.hover) { DRAG.hover = h; mapCursor(h ? 'move' : ''); drawOverlay(); } }
    return;
  }
  if (e.originalEvent.touches?.length > 1) { dragEnd(true); return; } // 두 손가락이면 확대로 넘긴다
  const ll = map.unproject([e.point.x + DRAG.dx, e.point.y + DRAG.dy]);
  if (!DRAG.moved && distM({ lat: ll.lat, lng: ll.lng }, DRAG.from) < 0.01) return;
  DRAG.moved = true;
  if (DRAG.what === 'sub') { state.sub = { lat: ll.lat, lng: ll.lng }; spotText(); }
  else { state.lat = ll.lat; state.lng = ll.lng; spotCalc(false); }
  drawOverlay();
}
function dragEnd(cancel) {
  if (!DRAG.on) return;
  DRAG.on = false; DRAG.endT = performance.now(); mapCursor(DRAG.hover ? 'move' : '');
  if (DRAG.what === 'sub') {
    if (cancel === true) state.sub = DRAG.from; else if (!DRAG.moved) { clearSub(); return; } // 그냥 누르면 지운다
    spotText(); drawOverlay(); save(); return;
  }
  if (cancel === true) { state.lat = DRAG.from.lat; state.lng = DRAG.from.lng; SPOT.at = ''; spotCalc(true); drawOverlay(); return; }
  if (DRAG.moved) setPin(state.lat, state.lng, { center: 'fit' }); else drawOverlay();
}
map.on('contextmenu', e => { e.preventDefault(); lpCancel(); if (state.mode !== 'map' || DRAG.on || nearPin(e.point) || performance.now() - LP.at < 900) return; if (coarse()) LP.fired = true; setSub(e.lngLat); });
map.on('mousedown', dragStart); map.on('touchstart', e => { if (e.originalEvent.touches.length > 1) { lpCancel(); if (DRAG.on) dragEnd(true); } else dragStart(e); });
map.on('mousemove', dragMove); map.on('touchmove', dragMove);
map.on('mouseup', dragEnd); map.on('touchend', () => { LP.touchT = performance.now(); lpCancel(); dragEnd(); }); map.on('touchcancel', () => { lpCancel(); dragEnd(true); });
map.on('movestart', () => lpCancel()); map.on('zoomstart', () => lpCancel());
addEventListener('mouseup', () => dragEnd()); addEventListener('blur', () => dragEnd(true));
// 점이 화면 가장자리나 밖에 놓였을 때만 화면이 따라간다
function pinNearEdge() {
  const pd = mapPadding(), c = map.getContainer(), p = map.project([state.lng, state.lat]), m = 56;
  return p.x < pd.left + m || p.x > c.clientWidth - pd.right - m || p.y < pd.top + m || p.y > c.clientHeight - pd.bottom - m;
}
function setPin(lat, lng, o = {}) {
  state.lat = lat; state.lng = lng; state.place = o.place ?? null;
  if (state.sub && distM(state.sub, state) > 5000) state.sub = null; // 다른 동네로 가면 바라볼 곳은 지운다
  SC.off = [0, 0];
  $('#q').value = state.place?.name ?? '';
  recomputeDay();
  if (state.mode === 'map') {
    // 자리가 바뀌면 화면도 그 자리를 가운데로 따라간다(누른 경우는 확대 그대로)
    map.stop();
    if (o.fly) map.flyTo({ center: [lng, lat], zoom: o.zoom ?? Math.max(map.getZoom(), 16.4), duration: 900, padding: mapPadding() });
    else if (o.center === 'fit' ? pinNearEdge() : o.center) map.easeTo({ center: [lng, lat], duration: 450, padding: mapPadding() });
  }
  else {
    map.jumpTo({ center: [lng, lat] }); map.triggerRepaint(); // 3D는 이 둘레 지도 자료로 거리를 만든다
    if (state.mode === 'rv' && state.rvSub === 'photo') setTimeout(openRoadview, 80);
    else if (state.mode === 'rv' && RVW.fell) { RVW.fell = false; setRvSub('photo'); }
  }
  SPOT.at = ''; spotCalc(true); loadWx(); favBtn(); pinChip(); scheduleUpdate(); save();
}
// 고른 자리가 화면 밖으로 나가면 돌아가는 버튼을 띄운다
function pinChip() {
  const el = $('#toPin');
  if (state.mode !== 'map') { el.hidden = true; return; }
  const p = map.project([state.lng, state.lat]), pd = mapPadding(), c = map.getContainer();
  el.hidden = p.x > pd.left + 8 && p.x < c.clientWidth - 8 && p.y > 64 && p.y < c.clientHeight - pd.bottom - 8;
}
$('#toPin').addEventListener('click', () => map.easeTo({ center: [state.lng, state.lat], duration: 600, padding: mapPadding() }));
// 건물 그림자 자료는 지도가 멈췄을 때, 보이는 타일 묶음이 바뀐 경우에만 다시 만든다
let shadowKey = '';
const tileKey = () => {
  if (map.getZoom() < 13.6) return 'far';
  const b = map.getBounds(), n = 1 << 14;
  return [Math.floor(mercX(b.getWest()) * n), Math.floor(mercY(b.getNorth()) * n), Math.floor(mercX(b.getEast()) * n), Math.floor(mercY(b.getSouth()) * n)].join();
};
map.on('idle', () => {
  const k = tileKey();
  if (k !== shadowKey && state.mode === 'map' && (!SC.active || SC.hold)) { shadowKey = k; buildShadows(); }
  if (SC.active && !SC.hold) syncScene();
});

// 높이 기록이 없는 건물(지도 기본값 5m)은 바닥 넓이로 어림
const guessH = (h, area) => (h != null && h !== 5) ? Math.max(3, h) : area < 60 ? 6 : area < 150 ? 9 : area < 400 ? 12 : area < 1200 ? 16 : 20;
function buildShadows() {
  const c = map.getCenter(), ox = mercX(c.lng), oy = mercY(c.lat), k = 1 / (MERC * Math.cos(c.lat * rad));
  const rings = [];
  if (map.getZoom() >= 13.6) {
    for (const f of map.querySourceFeatures('openmaptiles', { sourceLayer: 'building' })) {
      const g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const poly of polys) {
        const r = poly[0]; if (!r || r.length < 4) continue;
        const a = new Float32Array(r.length * 2); let ar = 0;
        for (let i = 0; i < r.length; i++) { a[2 * i] = (mercX(r[i][0]) - ox) / k; a[2 * i + 1] = (mercY(r[i][1]) - oy) / k; }
        for (let i = 0; i < r.length - 1; i++) ar += a[2 * i] * a[2 * i + 3] - a[2 * i + 2] * a[2 * i + 1];
        rings.push({ h: guessH(f.properties.render_height, Math.abs(ar) / 2), a });
      }
    }
  }
  shadow.setBuildings(rings, { ox, oy, k });
  Object.assign(SH, { rings, ox, oy, k, rect: rings.length ? tileKey().split(',').map(Number) : null }); SPOT.at = '';
  spotCalc(true);
  map.triggerRepaint();
}
// 지도에서 바로 보는 '이 자리 볕 · 그늘'(건물만 따짐, 높이는 어림)
const SH = { rings: [], ox: 0, oy: 0, k: 1, rect: null }, SPOT = { at: '', N: null, now: null, runs: '' };
function inRing(a, x, y) {
  let on = false;
  for (let i = 0, j = a.length - 2; i < a.length; j = i, i += 2) { if ((a[i + 1] > y) !== (a[j + 1] > y) && x < (a[j] - a[i]) * (y - a[i + 1]) / (a[j + 1] - a[i + 1]) + a[i]) on = !on; }
  return on;
}
function nearRings(lat, lng) {
  if (!SH.rect) return null;
  const mx = mercX(lng), my = mercY(lat), tx = Math.floor(mx * 16384), ty = Math.floor(my * 16384);
  if (tx < SH.rect[0] || tx > SH.rect[2] || ty < SH.rect[1] || ty > SH.rect[3]) return null;
  const px = (mx - SH.ox) / SH.k, py = (my - SH.oy) / SH.k, list = [];
  for (const r of SH.rings) { const a = r.a, dx = a[0] - px, dy = a[1] - py, lim = r.h > 30 ? 1500 : 520; if (dx * dx + dy * dy < lim * lim && !inRing(a, px, py)) list.push(r); }
  return { px, py, list };
}
function shaded(N, az, alt) {
  const dx = Math.sin(az * rad), dy = -Math.cos(az * rad), tn = Math.tan(alt * rad), { px, py } = N;
  for (const r of N.list) {
    const a = r.a, lim = (r.h - 1.6) / tn; if (lim <= 0) continue;
    for (let i = 0; i + 3 < a.length; i += 2) {
      const x1 = a[i] - px, y1 = a[i + 1] - py, ex = a[i + 2] - a[i], ey = a[i + 3] - a[i + 1], den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = (x1 * ey - y1 * ex) / den, u = (x1 * dy - y1 * dx) / den;
      if (t > 0.3 && t < lim && u >= 0 && u <= 1) return true;
    }
  }
  return false;
}
function spotCalc(day) {
  const at = `${state.lat.toFixed(6)},${state.lng.toFixed(6)}`;
  if (SPOT.at !== at) { SPOT.at = at; SPOT.N = nearRings(state.lat, state.lng); day = !DRAG.on; if (DRAG.on) SPOT.runs = ''; }
  const N = SPOT.N, s = sunNow();
  SPOT.now = !N ? null : s.altitude <= 0.5 ? 'night' : shaded(N, s.azimuth, s.altitude) ? 'shade' : 'lit';
  if (N && day) {
    const runs = []; let cur = null, any = false;
    for (const p of state.path) { if (p.alt <= 0.5 || p.m % 8 || p.m >= 1440) continue; any = true; if (!shaded(N, p.az, p.alt)) { if (cur && p.m - cur[1] <= 8) cur[1] = p.m; else runs.push(cur = [p.m, p.m]); } }
    SPOT.runs = !any ? '' : !runs.length ? '종일 건물 그늘' : `볕 ${runs.slice(0, 3).map(r => `${mm(Math.max(r[0] - 4, 0))}–${mm(Math.min(r[1] + 4, 1439))}`).join(' · ')}${runs.length > 3 ? ' …' : ''}`;
  }
  spotText();
}
function spotText() {
  const el = $('#spotLine'), k = SPOT.now;
  if (!k || state.mode !== 'map') { if (!el.hidden) el.hidden = true; }
  else { put('#spotLine', `<b class="${k}">${k === 'lit' ? '이 자리 지금 볕' : k === 'shade' ? '이 자리 지금 건물 그늘' : '이 자리'}</b>${SPOT.runs ? ` · ${SPOT.runs}` : ''}`, true); if (el.hidden) el.hidden = false; }
  const al = $('#aimLine'), sb = state.sub;
  if (!sb || state.mode !== 'map') { if (!al.hidden) al.hidden = true; return; }
  const yaw = bearing(state, sb), s = sunNow(), d = ((s.azimuth - yaw + 540) % 360) - 180, kk = lightOf(Math.abs(d));
  const now = s.altitude <= 0.5 ? '' : kk === '측광' ? ` · 지금 측광(해가 ${d > 0 ? '오른쪽' : '왼쪽'})` : kk === '역광' ? ' · 지금 역광' : ' · 지금 순광';
  const R = lightRuns(yaw), fmt = n => R[n].length ? `${n} ${R[n].map(r => `${mm(r[0])}–${mm(Math.min(r[1] + 4, 1439))}`).join(' · ')}` : '';
  put('#aimLine', `<b>바라보는 쪽 ${Math.round(yaw) % 360}° ${compassName(yaw)}</b>${now}<span>${[fmt('역광'), fmt('순광')].filter(Boolean).join(' / ') || '이 방향엔 역광 · 순광 시간이 없어요'}</span>`, true);
  if (al.hidden) al.hidden = false;
}
// 바라볼 곳(피사체 자리): 길게 누르거나 오른쪽 클릭으로 꽂고, 끌어서 옮기고, 눌러서 지운다
const LP = { timer: 0, pt: null, fired: false, at: 0, touchT: -1e9 };
function setSub(ll) {
  if (state.mode !== 'map' || distM(ll, state) < 3) return;
  state.sub = { lat: ll.lat, lng: ll.lng }; LP.at = performance.now();
  if (!localStorage.getItem('haegil.hintSub')) { localStorage.setItem('haegil.hintSub', '1'); toast('바라볼 곳을 꽂았어요 · 끌면 옮기고 누르면 지워요'); }
  navigator.vibrate?.(12); spotText(); drawOverlay(); save();
}
function clearSub() { state.sub = null; spotText(); drawOverlay(); save(); }
function lpCancel() { clearTimeout(LP.timer); LP.timer = 0; }

// 지도 위 해 길(위에서 내려다본 하늘: 가운데 = 머리 위, 원 = 지평선)
let zoomHintShown = false;
function drawOverlay() {
  const { ctx, w, h } = resizeCanvas($('#fx'));
  ctx.clearRect(0, 0, w, h);
  if (state.mode !== 'map') return;
  const sun = sunNow();
  if (sun.altitude <= 0) { ctx.fillStyle = `rgba(16,22,40,${Math.min(0.34, 0.14 + (-sun.altitude) * 0.02)})`; ctx.fillRect(0, 0, w, h); }
  if (map.getZoom() < 14.5 && !zoomHintShown && sun.altitude > 0) { zoomHintShown = true; toast('건물 그림자는 더 확대하면 보여요'); }

  const pd = mapPadding(), p = map.project([state.lng, state.lat]), night = sun.altitude <= 0;
  const R = Math.max(64, Math.min(w - pd.left - pd.right, h - pd.top - pd.bottom) * 0.37);
  // 찜한 곳
  ctx.font = `600 11.5px ${NUM}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  const names = map.getZoom() >= 12.5;
  for (const f of favs) {
    const q = map.project([f.lng, f.lat]); if (q.x < -40 || q.x > w + 40 || q.y < -20 || q.y > h + 20) continue;
    starPath(ctx, q.x, q.y, 9); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3.4; ctx.stroke(); ctx.fillStyle = SUN; ctx.fill();
    if (names && distM(f, state) > 15) {
      const t = f.name.length > 12 ? f.name.slice(0, 11) + '…' : f.name;
      ctx.lineWidth = 3.4; ctx.strokeStyle = night ? 'rgba(16,22,40,.85)' : 'rgba(255,255,255,.92)'; ctx.strokeText(t, q.x + 13, q.y + 0.5);
      ctx.fillStyle = night ? '#fff' : '#15161a'; ctx.fillText(t, q.x + 13, q.y + 0.5);
    }
  }
  if (p.x > -R - 60 && p.x < w + R + 60 && p.y > -R - 60 && p.y < h + R + 60) paintCompass(ctx, p.x, p.y, R, sun, night);
  // 바라볼 곳: 고른 자리에서 그쪽으로 선을 긋고 방위 · 거리를 적는다
  if (state.sub) {
    const q = map.project([state.sub.lng, state.sub.lat]), dM = distM(state, state.sub);
    ctx.lineCap = 'round'; ctx.strokeStyle = night ? 'rgba(16,22,40,.7)' : 'rgba(255,255,255,.9)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    ctx.strokeStyle = night ? '#fff' : '#15161a'; ctx.lineWidth = 1.8; ctx.setLineDash([1, 6]); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); ctx.setLineDash([]);
    const hot = DRAG.on && DRAG.what === 'sub';
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(q.x, q.y, hot ? 11.5 : 9, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#15161a'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(q.x, q.y, hot ? 9.5 : 7, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#15161a'; ctx.beginPath(); ctx.arc(q.x, q.y, 2.4, 0, Math.PI * 2); ctx.fill();
    pill(ctx, q.x, q.y - 25, `${Math.round(bearing(state, state.sub)) % 360}° · ${dM < 1000 ? Math.round(dM) + 'm' : (dM / 1000).toFixed(1) + 'km'}`, { bg: 'rgba(21,22,26,.86)', h: 22, font: `600 11.5px ${NUM}` });
  }
  // 끄는 동안 그 자리가 볕인지 그늘인지 바로 알려 준다
  if (DRAG.on && DRAG.what === 'pin' && (SPOT.now === 'lit' || SPOT.now === 'shade')) pill(ctx, p.x, p.y - 46, SPOT.now === 'lit' ? '지금 볕' : '지금 그늘', { bg: SPOT.now === 'lit' ? SUN : 'rgba(21,22,26,.86)', h: 26, font: '600 12.5px Paperlogy, sans-serif' });
}
function starPath(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.46 : r; ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  ctx.closePath();
}
// 고른 자리에 붙는 해 길 원(가운데 = 고른 자리 · 머리 위, 원 = 지평선)
function paintCompass(ctx, cx, cy, R, sun, night) {
  const pt = (az, alt) => { const r = R * (1 - Math.max(alt, 0) / 90), th = az * rad; return [cx + r * Math.sin(th), cy - r * Math.cos(th)]; };
  const ink = a => night ? `rgba(255,255,255,${a})` : `rgba(21,22,26,${a})`;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = ink(.2); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let a = 0; a < 360; a += 15) {
    const t = a * rad, r2 = R + (a % 90 ? 4 : 8);
    ctx.strokeStyle = ink(a % 90 ? .22 : .5); ctx.beginPath(); ctx.moveTo(cx + R * Math.sin(t), cy - R * Math.cos(t)); ctx.lineTo(cx + r2 * Math.sin(t), cy - r2 * Math.cos(t)); ctx.stroke();
    if (a % 90 === 0) { ctx.font = `600 12px ${NUM}`; ctx.fillStyle = ink(a ? .55 : .9); ctx.fillText(compassName(a), cx + (R + 20) * Math.sin(t), cy - (R + 20) * Math.cos(t)); }
  }
  const T = state.times;
  if (T?.sunrise && T?.sunset) {
    ctx.setLineDash([3, 5]); ctx.strokeStyle = ink(.34); ctx.lineWidth = 1.2;
    for (const d of [T.sunrise, T.sunset]) { const p = sunPosition(d, state.lat, state.lng), [x, y] = pt(p.azimuth, 0); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  const P = state.path, seg = (keep, col, lw) => {
    ctx.lineWidth = lw; ctx.strokeStyle = col; ctx.beginPath(); let on = false;
    for (const s of P) { if (keep(s)) { const [x, y] = pt(s.az, s.alt); on ? ctx.lineTo(x, y) : ctx.moveTo(x, y); on = true; } else on = false; }
    ctx.stroke();
  };
  seg(s => s.alt > 0, night ? 'rgba(255,255,255,.75)' : '#15161a', 2);
  seg(s => s.alt > 0 && s.alt < 6, GOLD, 4);
  ctx.font = `600 11px ${NUM}`;
  for (const s of P) {
    if (s.m % 60 || s.alt <= 0) continue;
    const [x, y] = pt(s.az, s.alt), t = s.az * rad;
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = s.alt < 6 ? GOLD : '#15161a'; ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ink(.78); ctx.fillText(String(s.m / 60), x - Math.sin(t) * 13, y + Math.cos(t) * 13);
  }
  if (sun.altitude > 0) {
    const [x, y] = pt(sun.azimuth, sun.altitude), [ex, ey] = pt(sun.azimuth, 0), [sx, sy] = pt(sun.azimuth + 180, 90 - Math.min(90, 26 / Math.tan(Math.max(sun.altitude, 1) * rad)));
    ctx.strokeStyle = 'rgba(21,22,26,.5)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(sx, sy); ctx.stroke();
    ctx.strokeStyle = SUN; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = SUN; ctx.beginPath(); ctx.arc(x, y, 9.5, 0, Math.PI * 2); ctx.fill();
  } else {
    const [x, y] = pt(sun.azimuth, 0);
    ctx.strokeStyle = ink(.6); ctx.lineWidth = 1.6; ctx.fillStyle = night ? '#1b2238' : '#fff';
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  // 가운데 점 = 잡고 끄는 손잡이
  const hot = DRAG.on || DRAG.hover;
  ctx.fillStyle = ink(DRAG.on ? .16 : hot ? .12 : .07); ctx.beginPath(); ctx.arc(cx, cy, DRAG.on ? 26 : hot ? 21 : 17, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, 9.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#15161a'; ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill();
}

// ───────── 시간 · 시트 ─────────
const BAND = { night: '#272b37', blue: '#4a6aa3', gold: '#ff9d47', day: '#cfe6f8' };
const RUL = { ppm: 0.92, bands: [], maxAlt: 60, drag: null, v: 0, raf: 0 };
const phaseOf = alt => alt > 6 ? ['낮', 'day'] : alt > -4 ? ['골든아워', 'gold'] : alt > -6 ? ['블루아워', 'blue'] : ['밤', 'night'];

let dayPos = null;
function recomputeDay() {
  dayPos = { lat: state.lat, lng: state.lng };
  const yr = state.day.getFullYear();
  state.season = [['하지', 5, 21], ['동지', 11, 21]].map(([name, mo, dd]) => {
    const day = new Date(yr, mo, dd);
    return { name, day, pts: Array.from({ length: 121 }, (_, i) => { const q = sunPosition(new Date(day.getTime() + i * 12 * 60000), state.lat, state.lng); return { az: q.azimuth, alt: q.altitude }; }) };
  });
  state.times = sunTimes(state.day, state.lat, state.lng);
  const P = [];
  for (let m = 0; m <= 1440; m += 4) {
    const p = sunPosition(new Date(state.day.getTime() + m * 60000), state.lat, state.lng);
    P.push({ m, az: p.azimuth, alt: p.altitude });
  }
  state.path = P;
  const bands = []; let cur = null;
  for (let i = 0; i < P.length - 1; i++) {
    const k = phaseOf((P[i].alt + P[i + 1].alt) / 2)[1];
    if (cur && cur.k === k) cur.m1 = P[i + 1].m; else bands.push(cur = { k, m0: P[i].m, m1: P[i + 1].m });
  }
  RUL.bands = bands; RUL.maxAlt = Math.max(30, ...P.map(p => p.alt));
  renderMoments(); momKey = '';
  if (SC.scene) { SC.scene.setPath(P); litDay(); }
  if (SH.rect) { SPOT.at = ''; spotCalc(true); }
}

const events = () => {
  const T = state.times;
  return [['새벽 블루아워', T.blueStartAm, 'blue'], ['골든아워', T.goldenStartAm, 'gold'], ['일출', T.sunrise, ''], ['골든 끝', T.goldenEndAm, 'gold'],
    ['남중', T.noon, ''], ['골든아워', T.goldenStartPm, 'gold'], ['일몰', T.sunset, ''], ['블루아워', T.goldenEndPm, 'blue'], ['밤', T.blueEndPm, '']]
    .filter(i => i[1] && !isNaN(i[1]));
};
function renderMoments() {
  const box = $('#moments'); box.innerHTML = '';
  for (const [label, d, kind] of events()) {
    const b = document.createElement('button');
    b.className = kind; b.dataset.t = d.getTime();
    b.innerHTML = `<span>${label}</span><b>${hm(d)}</b>`;
    b.onclick = () => { state.followNow = false; state.min = d.getHours() * 60 + d.getMinutes(); scheduleUpdate(); save(); };
    box.appendChild(b);
  }
}
const dur = m => m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}`;
function nextEvent() {
  const t = selected().getTime();
  for (const [name, d] of events()) if (d.getTime() > t + 30000) return `${name === '밤' ? '완전히 어두워질 때' : name}까지 ${dur(Math.round((d - t) / 60000))}`;
  return '오늘 해는 끝났어요';
}
function sayOf(s) {
  if (s.altitude > 0.5) {
    const len = 1 / Math.tan(s.altitude * rad), from = compassName(s.azimuth), to = compassName((s.azimuth + 180) % 360);
    return len > 12 ? `${from}쪽 낮은 해, 그림자가 ${to}쪽으로 길게 누워요` : `${from}에서 비추고, 그림자는 ${to}쪽으로 ${len.toFixed(1)}배`;
  }
  return s.altitude > -6 ? '해는 지평선 아래, 하늘빛만 남아 있어요' : '해가 없는 시간이에요';
}

function drawRuler() {
  const { ctx, w, h } = resizeCanvas($('#rulerCv'));
  ctx.clearRect(0, 0, w, h);
  if (!w || !h) return;
  const over = isMin(), dark = isDark() || over, cx = Math.round(w / 2), ppm = RUL.ppm, X = m => cx + (m - state.min) * ppm, slim = h < 60, top = 10, sh = slim ? 16 : 40; // slim: 접힌 막대 안의 낮은 자, over: 폰에서 접었을 때 화면 위에 뜨는 반투명 자
  const ink = a => dark ? `rgba(245,244,241,${a})` : `rgba(21,22,26,${a})`;
  // 하루 하늘 띠
  ctx.save(); roundRect(ctx, X(0), top, 1440 * ppm, sh, over ? 8 : 11); ctx.clip();
  if (over) ctx.globalAlpha = 0.88;
  for (const b of RUL.bands) { const x0 = X(b.m0), x1 = X(b.m1); if (x1 < 0 || x0 > w) continue; ctx.fillStyle = BAND[b.k]; ctx.fillRect(x0, top, x1 - x0 + 0.6, sh); }
  // 해 높이 곡선
  ctx.beginPath(); let started = false, lastX = 0;
  for (const p of state.path) {
    if (p.alt <= 0) continue; const x = X(p.m); if (x < -12 || x > w + 12) continue;
    const y = top + sh - p.alt / RUL.maxAlt * (sh - (slim ? 4 : 9));
    if (!started) { ctx.moveTo(x, top + sh); started = true; } ctx.lineTo(x, y); lastX = x;
  }
  ctx.globalAlpha = 1;
  if (started) { ctx.lineTo(lastX, top + sh); ctx.closePath(); ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fill(); }
  // 이 자리가 건물 그늘인 시간(로드뷰 3D에서)
  if (state.mode === 'rv' && state.rvSub === '3d') {
    ctx.fillStyle = 'rgba(18,22,36,.5)';
    let m0 = null, m1 = 0;
    const flush = () => { if (m0 != null) ctx.fillRect(X(m0 - 4), top, (m1 - m0 + 8) * ppm, sh); m0 = null; };
    for (const s of SC.samples) { if (!s.lit) { if (m0 == null) m0 = s.m; m1 = s.m; } else flush(); }
    flush();
  }
  // 구름 예보(시간별, 짙을수록 구름 많음)
  if (WX.hours) {
    const t0 = state.day.getTime() / 1000;
    for (let hr = 0; hr < 24; hr++) {
      const v = WX.hours.get(t0 + hr * 3600), x0 = X(hr * 60); if (!v || v[0] == null || x0 > w || x0 + 60 * ppm < 0) continue;
      ctx.fillStyle = `rgba(92,99,112,${(v[0] / 100 * 0.72).toFixed(3)})`; ctx.fillRect(x0, top, 60 * ppm + 0.6, slim ? 4 : 6);
    }
  }
  // 로드뷰에서 보는 쪽 기준: 역광(주황) · 순광(먹색)
  if (state.mode === 'rv' && VIEW.yaw != null) {
    for (const p of state.path) {
      if (p.alt <= 0.5 || p.m >= 1440) continue; const x0 = X(p.m); if (x0 > w || x0 < -8) continue;
      const k = lightOf(Math.abs(((p.az - VIEW.yaw + 540) % 360) - 180)); if (k === '측광') continue;
      ctx.fillStyle = k === '역광' ? SUN : '#15161a'; ctx.fillRect(x0, top + sh - (slim ? 4 : 5), 4 * ppm + 0.6, slim ? 4 : 5);
    }
  }
  ctx.restore();
  // 눈금
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  for (let q = 0; q <= 48; q++) {
    const x = X(q * 30); if (x < -12 || x > w + 12) continue;
    const hr = q / 2, big = q % 12 === 0;
    ctx.fillStyle = ink(q % 2 ? .18 : big ? .7 : .34); ctx.fillRect(Math.round(x) - 0.5, top + sh + 4, 1, q % 2 ? 3 : 5);
    if (q % 2 === 0) { ctx.font = `${big ? 600 : 500} 11.5px ${NUM}`; ctx.fillStyle = ink(big ? .9 : .5); ctx.fillText(String(hr), x, top + sh + (slim ? 19 : 22)); }
  }
  // 지금
  if (ymd(state.day) === ymd(new Date())) { const x = X(nowMin()); if (x > 0 && x < w) { ctx.fillStyle = SUN; ctx.beginPath(); ctx.arc(x, top - 4, 2.6, 0, Math.PI * 2); ctx.fill(); } }
  // 가운데 바늘
  const paper = over ? 'rgba(21,22,26,.8)' : dark ? '#121214' : '#fff';
  ctx.fillStyle = paper; ctx.fillRect(cx - 2.5, top - 3, 5, sh + 9);
  ctx.fillStyle = dark ? '#f5f4f1' : '#15161a'; ctx.fillRect(cx - 1, top - 3, 2, sh + 9);
  ctx.beginPath(); ctx.moveTo(cx - 5.5, top - 9); ctx.lineTo(cx + 5.5, top - 9); ctx.lineTo(cx, top - 1.5); ctx.closePath(); ctx.fill();
}

let timeStr = '', upQ = false, momKey = '';
function scheduleUpdate() { if (!upQ) { upQ = true; requestAnimationFrame(() => { upQ = false; update(); }); } }
function update() {
  const d = selected(), s = sunNow(), t = hm(d);
  if (t !== timeStr) { timeStr = t; $('#tTime').innerHTML = [...t].map(c => c === ':' ? '<i>:</i>' : `<span>${c}</span>`).join(''); }
  const isToday = ymd(state.day) === ymd(new Date());
  put('#tDate', `${state.day.getMonth() + 1}월 ${state.day.getDate()}일 ${WEEK[state.day.getDay()]}요일${isToday ? ' · 오늘' : ''}`);
  if ($('#dateIn').value !== ymd(state.day)) $('#dateIn').value = ymd(state.day);
  put('#sAz', `${Math.round(s.azimuth)}°`);
  put('#sAzName', `방위 · ${compassName(s.azimuth)}`);
  put('#sAlt', `${Math.round(s.altitude)}°`);
  put('#sLen', s.altitude > 0.5 ? `${Math.min(99, 1 / Math.tan(s.altitude * rad)).toFixed(1)}배` : '없음');
  const [pn, pk] = phaseOf(s.altitude), ph = $('#phase'), pc = `phase ${pk}`;
  if (ph.className !== pc) ph.className = pc;
  put('#phase b', pn); put('#phase span', nextEvent());
  put('#sayLine', sayOf(s));
  const wx = wxAt(d.getTime());
  put('#wx', wx && wx[0] != null ? `예보 · 구름 ${Math.round(wx[0])}%${wx[1] != null ? ` · 비 올 확률 ${Math.round(wx[1])}%` : ''}` : WX.hours ? `이 날짜는 구름 예보가 없어요(오늘부터 ${WX.days}일까지 나와요)` : '');
  if (put('#nowBtn', state.followNow ? '실시간' : '지금으로')) $('#nowBtn').classList.toggle('is-now', state.followNow);
  if (!RUL.drag) { $('#ruler').setAttribute('aria-valuenow', state.min); $('#ruler').setAttribute('aria-valuetext', t); }
  const tt = d.getTime(), mk = `${Math.floor(tt / 60000)}`;
  if (mk !== momKey) { // 시각 칩의 지남 · 다음 표시는 분이 바뀔 때만
    momKey = mk; let nextSet = false;
    for (const b of $('#moments').children) { const past = +b.dataset.t <= tt; b.classList.toggle('past', past); const nx = !past && !nextSet; if (nx) nextSet = true; b.classList.toggle('next', nx); }
  }
  drawRuler();
  shadow.setSun(s.azimuth, s.altitude);
  if (state.mode === 'map') { spotCalc(false); map.triggerRepaint(); drawOverlay(); }
  else if (state.mode === 'rv') {
    if (state.rvSub === 'photo') { updateRoadviewSun(); drawMini(); }
    else if (SC.scene) { SC.scene.setSun(s.azimuth, s.altitude); updateSpot(); requestScene(); }
  } else if (state.mode === 'cmp') requestCmp();
}

// 시간 자: 끌어서 · 휠로 · 방향키로
function setMin(m) { m = clamp(Math.round(m), 0, 1439); if (m === state.min && !state.followNow) return; state.followNow = false; state.min = m; scheduleUpdate(); }
{
  const el = $('#ruler'); let acc = 0;
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); cancelAnimationFrame(RUL.raf); RUL.drag = { x: e.clientX, t: e.timeStamp }; RUL.v = 0; acc = state.min; });
  el.addEventListener('pointermove', e => {
    if (!RUL.drag) return;
    const dx = e.clientX - RUL.drag.x, dt = Math.max(1, e.timeStamp - RUL.drag.t);
    RUL.v = RUL.v * 0.5 + (dx / dt) * 0.5; RUL.drag = { x: e.clientX, t: e.timeStamp };
    acc = clamp(acc - dx / RUL.ppm, 0, 1439); setMin(acc);
  });
  const end = e => {
    if (!RUL.drag) return;
    if (e.timeStamp - RUL.drag.t > 90) RUL.v = 0; // 멈췄다 떼면 미끄러지지 않는다
    RUL.drag = null; save(); $('#ruler').setAttribute('aria-valuenow', state.min); $('#ruler').setAttribute('aria-valuetext', mm(state.min));
    let v = clamp(RUL.v, -2.2, 2.2), last = performance.now();
    const glide = now => {
      const dt = now - last; last = now; v *= Math.pow(0.94, dt / 16.7);
      acc = clamp(acc - v * dt / RUL.ppm, 0, 1439); setMin(acc);
      if (Math.abs(v) > 0.03 && acc > 0 && acc < 1439) RUL.raf = requestAnimationFrame(glide); else save();
    };
    if (Math.abs(v) > 0.25) RUL.raf = requestAnimationFrame(glide);
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('wheel', e => { e.preventDefault(); setMin(state.min + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * 0.4); save(); }, { passive: false });
  el.addEventListener('keydown', e => {
    const step = e.shiftKey ? 30 : 5;
    if (e.key === 'ArrowLeft') setMin(state.min - step); else if (e.key === 'ArrowRight') setMin(state.min + step); else return;
    e.preventDefault(); save();
  });
}
// 구름 예보(Open-Meteo, 열쇠 없이 씀): 고른 자리가 바뀌면 다시 받는다
const WX = { key: '', hours: null, days: 16 };
const getWx = async (url, ms = 7000) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); try { const r = await fetch(url, { signal: c.signal }); if (!r.ok) throw new Error(r.status); return await r.json(); } finally { clearTimeout(t); } };
async function loadWx() {
  const key = `${state.lat.toFixed(2)},${state.lng.toFixed(2)}`;
  if (WX.key === key) return;
  WX.key = key; WX.hours = null;
  const la = state.lat.toFixed(2), lo = state.lng.toFixed(2);
  let hours = null, days = 16;
  try {
    const j = await getWx(`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&hourly=cloud_cover,precipitation_probability&forecast_days=16&timeformat=unixtime&timezone=GMT`);
    hours = new Map(j.hourly.time.map((t, i) => [t, [j.hourly.cloud_cover[i], j.hourly.precipitation_probability[i]]]));
  } catch {
    // 예비: 노르웨이 기상청(9일치, 뒤쪽은 6시간 간격이라 그 사이는 앞 값을 잇는다)
    try {
      const j = await getWx(`https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${la}&lon=${lo}`, 9000);
      const ts = j.properties.timeseries; hours = new Map(); days = 9;
      ts.forEach((e, i) => {
        const t = Date.parse(e.time) / 1000, end = Math.min(i + 1 < ts.length ? Date.parse(ts[i + 1].time) / 1000 : t + 3600, t + 6 * 3600);
        const v = [e.data.instant.details.cloud_area_fraction ?? null, e.data.next_1_hours?.details?.probability_of_precipitation ?? e.data.next_6_hours?.details?.probability_of_precipitation ?? null];
        for (let h = t; h < end; h += 3600) hours.set(h, v);
      });
    } catch { hours = null; }
  }
  if (WX.key !== key) return;
  if (!hours) { WX.key = ''; return; }
  WX.hours = hours; WX.days = days;
  scheduleUpdate();
}
const wxAt = ms => WX.hours?.get(Math.floor(ms / 3600e3) * 3600) ?? null;
// 보는 쪽과 해 사이 각으로 빛을 나눈다
const lightOf = d => d < 50 ? '역광' : d > 130 ? '순광' : '측광';
function lightRuns(yaw = VIEW.yaw) {
  const runs = { 역광: [], 순광: [] }; let cur = null, ck = '';
  for (const p of state.path) {
    const k = p.alt > 0.5 && p.m < 1440 ? lightOf(Math.abs(((p.az - yaw + 540) % 360) - 180)) : '';
    if (k !== ck) { cur = null; ck = k; }
    if (runs[k]) { if (cur) cur[1] = p.m; else runs[k].push(cur = [p.m, p.m]); }
  }
  return runs;
}

$('#dateIn').addEventListener('change', e => {
  if (!e.target.value) return;
  const [y, m, d] = e.target.value.split('-').map(Number);
  state.day = new Date(y, m - 1, d); state.followNow = false;
  recomputeDay(); scheduleUpdate(); save(); placeRoadviewPath();
});
$('#nowBtn').addEventListener('click', () => {
  const sameDay = ymd(state.day) === ymd(new Date());
  state.followNow = true; state.day = startOfDay(new Date()); state.min = nowMin();
  if (!sameDay) { recomputeDay(); placeRoadviewPath(); }
  scheduleUpdate(); save();
});
setInterval(() => { if (state.followNow) { const m = nowMin(); if (m !== state.min) { if (m < state.min) { state.day = startOfDay(new Date()); recomputeDay(); } state.min = m; scheduleUpdate(); } } }, 15000);

// 시트 높이에 맞춰 무대를 다시 잡는다
// 손잡이: 누르면 접고 펴고, 아래 · 위로 쓸어도 된다. 접어 둔 건 다음에 열어도 기억한다
function fold(v) { if (state.sheetMin === v) return; state.sheetMin = v; if (landBack == null) localStorage.setItem('haegil.smin', v ? '1' : '0'); bodyClass(); }
{
  const g = $('#grip'); let y0 = null, done = false;
  g.addEventListener('pointerdown', e => { y0 = e.clientY; done = false; g.setPointerCapture(e.pointerId); });
  g.addEventListener('pointermove', e => { if (y0 == null || done || land()) return; const dy = e.clientY - y0; if (Math.abs(dy) > 22) { done = true; fold(dy > 0); } });
  g.addEventListener('pointerup', () => { if (y0 != null && !done) fold(!state.sheetMin); y0 = null; });
  g.addEventListener('pointercancel', () => { y0 = null; });
  g.addEventListener('click', e => { if (e.detail === 0) fold(!state.sheetMin); }); // 키보드로 누른 때
}
MQ_LAND.addEventListener('change', e => {
  if (e.matches) { landBack = state.sheetMin; state.sheetMin = true; }
  else if (landBack != null) { state.sheetMin = landBack || state.mode === 'rv' || state.mode === 'ar'; landBack = null; }
  bodyClass(); measure();
});
MQ_WIDE.addEventListener('change', () => { bodyClass(); measure(); });
{ // 폰에서 접으면 시각이 작은 알약이 된다. 좌우로 끌면 시간이 바뀌고, 톡 누르면 시트가 펴진다
  const el = $('#tTime'); let d = null;
  el.addEventListener('pointerdown', e => { if (wide() || !state.sheetMin) return; d = { x: e.clientX, m: state.min, moved: false }; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', e => { if (!d) return; const dx = e.clientX - d.x; if (Math.abs(dx) > 6) d.moved = true; if (d.moved) setMin(d.m + dx * 2); });
  const end = e => { if (!d) return; const tap = !d.moved && e.type === 'pointerup'; d = null; if (tap) fold(false); else save(); };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}
function panelBtn() { const b = $('#panelBtn'), t = state.panelMin ? '패널 펼치기' : '패널 접기'; b.title = t; b.setAttribute('aria-label', t); b.querySelector('span').textContent = state.panelMin ? '펼치기' : '접기'; }
$('#panelBtn').addEventListener('click', () => {
  state.panelMin = !state.panelMin; localStorage.setItem('haegil.pmin', state.panelMin ? '1' : '0');
  bodyClass(); panelBtn(); syncPadding(); redraw(); pinChip();
});
panelBtn();
let sheetH = 0;
new ResizeObserver(() => {
  const h = $('#sheet').offsetHeight;
  if (h !== sheetH) { sheetH = h; document.documentElement.style.setProperty('--sheet-h', `${h}px`); }
  measure();
  try { rv?.relayout(); } catch { /* 사진 로드뷰를 아직 안 연 때 */ }
  syncPadding(); redraw(); pinChip();
}).observe($('#sheet'));
addEventListener('resize', () => {
  for (const c of CVS.values()) c.dirty = true; // 확대 배율이 바뀐 때
  measure();
  try { rv?.relayout(); } catch { /* 사진 로드뷰를 아직 안 연 때 */ }
  syncPadding(); redraw(); pinChip();
});

// ───────── 검색 · 찜 · 내 위치 · 보내기 ─────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = async url => { const r = await fetch(url); if (!r.ok) throw new Error(r.status); return r.json(); };
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ROAD_NO = /(\S+(?:로|길))\s+(\d+(?:-\d+)?)$/;
// 붙여 넣은 좌표나 지도 링크(구글 · 카카오 · Sunpath)에서 위치를 읽는다
function parseCoord(q) {
  const ok = c => c && Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180 ? c : null;
  const fix = (a, b) => (Math.abs(a) > 90 || (a > 123 && a < 133 && b > 32 && b < 40)) ? { lat: b, lng: a } : { lat: a, lng: b };
  const m = q.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || q.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (m) return ok({ lat: +m[1], lng: +m[2] });
  const la = q.match(/[?&]lat=(-?\d+\.\d+)/), lo = q.match(/[?&](?:lng|lon)=(-?\d+\.\d+)/);
  if (la && lo) return ok({ lat: +la[1], lng: +lo[1] });
  if (!/^https?:/i.test(q) && !/^[\s\d.,°NSEW+-]+$/i.test(q)) return null;
  const n = (q.match(/-?\d{1,3}\.\d{2,}/g) || []).map(Number);
  return n.length >= 2 ? ok(fix(n[0], n[1])) : null;
}
// "이름, 118, 성수이로, 성수2가3동, 성동구, 서울특별시, 04797, 대한민국" → "서울특별시 성동구 성수2가3동 성수이로 118"
const cleanAddr = (dn, name) => { const p = dn.split(',').map(t => t.trim()).filter(t => t && t !== '대한민국' && !/^\d{5}$/.test(t)); if (p[0] === name) p.shift(); return p.reverse().join(' '); };
const isAddr = q => /(로|길|동|가|리|읍|면)\s*\d|번지|\d+-\d+/.test(q);
async function nominatim(q) {
  const j = await getJSON(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&accept-language=ko&countrycodes=kr&q=${encodeURIComponent(q)}`);
  return j.map(p => { const name = p.name || p.display_name.split(',')[0].trim(); return { name, addr: cleanAddr(p.display_name, name) || name, lat: +p.lat, lng: +p.lon }; });
}
async function photon(q) {
  const j = await getJSON(`https://photon.komoot.io/api/?limit=8&lat=${state.lat.toFixed(2)}&lon=${state.lng.toFixed(2)}&q=${encodeURIComponent(q)}`);
  const all = j.features.map(f => {
    const a = f.properties, [lng, lat] = f.geometry.coordinates, road = [a.street, a.housenumber].filter(Boolean).join(' ');
    return { name: a.name || road || a.city || '', addr: [a.state, a.city, a.district, road].filter((v, i, r) => v && r.indexOf(v) === i).join(' '), lat, lng, cc: a.countrycode };
  }).filter(p => p.name);
  const kr = all.filter(p => p.cc === 'KR');
  return kr.length ? kr : all;
}
function kakaoFind(q) {
  const K = kakao.maps.services;
  const ad = new Promise(res => new K.Geocoder().addressSearch(q, (r, st) => res(st === K.Status.OK ? r.map(p => ({ name: p.road_address?.building_name || p.address_name, addr: p.road_address?.address_name || p.address_name, lat: +p.y, lng: +p.x })) : []), { size: 5 }));
  const kw = new Promise(res => new K.Places().keywordSearch(q, (r, st) => res(st === K.Status.OK ? r.map(p => ({ name: p.place_name, addr: p.road_address_name || p.address_name, lat: +p.y, lng: +p.x })) : []), { size: 8 }));
  return Promise.all([ad, kw]).then(([a, k]) => { const out = []; for (const p of [...a, ...k]) if (!out.some(o => o.name === p.name && distM(o, p) < 20)) out.push(p); return out.slice(0, 8); });
}
// 주소를 찾으면 같은 건물의 가게들이 여럿 나온다 → 한 줄로 묶고 제목을 "길 이름 + 번호"로
function tidy(list, q) {
  const addr = isAddr(q), out = [];
  for (const p of list) {
    if (addr) { const m = p.addr.match(ROAD_NO); if (m) p.name = `${m[1]} ${m[2]}`; else p.near = true; }
    if (out.some(o => distM(o, p) < (addr ? 40 : 8) && (addr || o.name === p.name))) continue;
    out.push(p);
  }
  return out.slice(0, 7);
}
async function findPlaces(q) {
  const c = parseCoord(q);
  if (c) return [{ name: `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`, addr: '붙여 넣은 좌표', lat: c.lat, lng: c.lng, coord: true }];
  if (window.kakao?.maps?.services) { const k = await kakaoFind(q).catch(() => []); if (k.length) return k; }
  let list = await nominatim(q).catch(() => []);
  if (!list.length) list = await photon(q).catch(() => []);
  if (!list.length) {
    // 번지 · 층 · 호수를 떼고 한 번 더(지도 자료에 그 번지가 없는 주소)
    const q2 = q.replace(/\s*\d+\s*(층|호|동)(?=\s|$).*$/, '').replace(/\s+\d+(-\d+)?\s*(번지)?$/, '').trim();
    if (q2 && q2 !== q) { await sleep(1000); list = (await nominatim(q2).catch(() => [])).map(p => ({ ...p, near: true })); }
  }
  return tidy(list, q);
}
// 지금 고른 자리의 이름(찜 · 리포트 제목용)
async function nameHere() {
  const p = await getJSON(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ko&zoom=18&lat=${state.lat.toFixed(6)}&lon=${state.lng.toFixed(6)}`);
  const addr = cleanAddr(p.display_name || '', p.name || ''), m = addr.match(ROAD_NO);
  return { name: p.name || (m ? `${m[1]} ${m[2]}` : addr.split(' ').slice(-2).join(' ')), addr };
}

const ul = $('#results');
const STAR = '<svg viewBox="0 0 24 24"><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8L12 3.6Z"/></svg>';
function row(p, star) {
  const li = document.createElement('li');
  li.innerHTML = `${star ? STAR : ''}<div class="txt"><b>${esc(p.name)}</b><span>${esc((p.near ? '근처 · ' : '') + (p.addr || ''))}</span></div>`;
  li.onclick = () => pick(p);
  return li;
}
function note(title, body, cls = 'info') {
  const li = document.createElement('li'); li.className = cls;
  li.innerHTML = cls === 'head' ? esc(title) : `<div class="txt"><b>${esc(title)}</b>${body ? `<span>${esc(body)}</span>` : ''}</div>`;
  ul.appendChild(li);
}
function pick(p, isFav) {
  ul.hidden = true; $('#q').blur();
  if (!isFav) { recent = [{ name: p.name, addr: p.addr, lat: p.lat, lng: p.lng }, ...recent.filter(r => distM(r, p) > 15)].slice(0, 6); keep(RECK, recent); }
  setPin(p.lat, p.lng, { place: { name: p.name, addr: p.addr || '' }, fly: true, zoom: 17 });
}
// 검색창을 누르면: 찜한 곳 · 최근 찾은 곳
function showSaved() {
  ul.innerHTML = '';
  if (favs.length) {
    note('찜한 곳', '', 'head');
    for (const f of favs) {
      const li = row(f, true); li.onclick = () => pick(f, true);
      const btn = (text, label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'act'; b.textContent = text; b.setAttribute('aria-label', label); b.onclick = e => { e.stopPropagation(); fn(); }; li.appendChild(b); };
      btn('이름', '이름 바꾸기', () => {
        const b = li.querySelector('b'), inp = document.createElement('input'); inp.className = 'rename'; inp.value = f.name; inp.maxLength = 40;
        b.replaceWith(inp); inp.focus(); inp.select(); inp.onclick = e => e.stopPropagation();
        let done = false; const fin = () => { if (done) return; done = true; const v = inp.value.trim(); if (v) { f.name = v; keep(FAVK, favs); } showSaved(); drawOverlay(); };
        inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); fin(); } }; inp.onblur = fin;
      });
      btn('빼기', '찜에서 빼기', () => { favs = favs.filter(g => g !== f); keep(FAVK, favs); favBtn(); drawOverlay(); showSaved(); });
      ul.appendChild(li);
    }
  }
  if (recent.length) { note('최근 찾은 곳', '', 'head'); for (const r of recent) ul.appendChild(row(r)); }
  if (!favs.length && !recent.length) note('찜한 곳이 아직 없어요', '장소를 고르고 검색창 오른쪽 별을 누르면 여기에 모여요');
  ul.hidden = false; $('#menu').hidden = true;
}
let searchSeq = 0;
$('#search').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('#q').value.trim(); if (!q) return;
  $('#q').blur();
  const my = ++searchSeq;
  ul.innerHTML = ''; note('찾는 중이에요'); ul.hidden = false;
  let list = [];
  try { list = await findPlaces(q); } catch { list = []; }
  if (my !== searchSeq) return;
  if (list.length === 1 && list[0].coord) { pick(list[0]); return; }
  ul.innerHTML = '';
  if (!list.length) note('찾는 장소가 없어요', '도로명 주소나 근처 큰 건물 · 역 이름으로 찾아보세요');
  for (const p of list) ul.appendChild(row(p));
  ul.hidden = false;
});
$('#q').addEventListener('focus', () => { showSaved(); setTimeout(() => { if (document.activeElement === $('#q')) $('#q').select(); }, 0); });
$('#q').addEventListener('input', () => { searchSeq++; if (!$('#q').value) showSaved(); else ul.hidden = true; });
document.addEventListener('pointerdown', e => { if (!e.target.closest('#top')) { ul.hidden = true; $('#menu').hidden = true; } });

// 찜: 지금 고른 자리를 별표로 담아 둔다
const favAt = () => favs.findIndex(f => distM(f, state) < 15);
function favBtn() { const on = favAt() >= 0; $('#fav').classList.toggle('on', on); $('#fav').setAttribute('aria-label', on ? '찜에서 빼기' : '이 자리 찜하기'); }
$('#fav').addEventListener('click', async () => {
  const i = favAt();
  if (i >= 0) { const [f] = favs.splice(i, 1); keep(FAVK, favs); toast(`찜에서 뺐어요 · ${f.name}`); }
  else {
    const at = { lat: state.lat, lng: state.lng };
    let name = state.place?.name || '', addr = state.place?.addr || '';
    if (!name || state.place?.addr === '붙여 넣은 좌표') { const r = await nameHere().catch(() => null); name = r?.name || name || `${at.lat.toFixed(4)}, ${at.lng.toFixed(4)}`; addr = r?.addr || ''; }
    favs.unshift({ name, addr, lat: at.lat, lng: at.lng }); keep(FAVK, favs);
    toast(`찜했어요 · ${name}`);
  }
  favBtn(); drawOverlay(); if (!ul.hidden) showSaved();
});

function getPos() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('none'));
    navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude }), rej, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  });
}
$('#locate').addEventListener('click', async () => {
  try { const p = await getPos(); setPin(p.lat, p.lng, { fly: true, zoom: 17 }); if (state.mode === 'cmp') $('#cmpSub').textContent = '내 위치 기준'; }
  catch { toast('위치를 못 가져왔어요. 위치 권한을 확인해 주세요'); }
});

// 보내기 · 저장
$('#share').addEventListener('click', () => { $('#menu').hidden = !$('#menu').hidden; ul.hidden = true; });
async function send(url, text, copied) {
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: APP, text, url });
    else { await navigator.clipboard.writeText(url); toast(copied); }
  } catch { /* 취소 */ }
}
$('#mLink').addEventListener('click', () => {
  $('#menu').hidden = true; clearTimeout(saveTimer);
  const h = `#${state.lat.toFixed(5)},${state.lng.toFixed(5)},${state.zoom.toFixed(1)}/${ymd(state.day)}/${pad(Math.floor(state.min / 60))}${pad(state.min % 60)}`;
  send(BASE + h, `${state.place?.name ? state.place.name + ' · ' : ''}${hm(selected())} 해 방향 ${Math.round(sunNow().azimuth)}° ${compassName(sunNow().azimuth)}`, '링크를 복사했어요. 폰에서 열면 같은 자리 · 시각이 떠요');
});
$('#mFavs').addEventListener('click', () => {
  $('#menu').hidden = true;
  if (!favs.length) { toast('찜한 곳이 아직 없어요'); return; }
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(favs.map(f => ({ name: f.name, addr: f.addr, lat: +f.lat.toFixed(6), lng: +f.lng.toFixed(6) })))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  send(`${BASE}#favs=${b64}`, `${APP} 찜 ${favs.length}곳`, `찜 ${favs.length}곳 링크를 복사했어요. 다른 기기에서 열면 그대로 들어와요`);
});

// 답사 리포트: 자리 · 날짜 · 해 시각 · 그림자 지도 · (로드뷰 3D) · 하루 띠를 한 장으로
function grabScene(a) {
  if (!(state.mode === 'rv' && state.rvSub === '3d' && SC.scene?.S.ready)) return null;
  const gl = $('#sc'), fx = $('#scFx'), w = fx.clientWidth, h = fx.clientHeight, inset = LAY.rv;
  const cw = Math.min(w - inset * 2, h * a), ch = cw / a, sx = w / 2 - cw / 2, sy = h / 2 - ch / 2;
  const c = document.createElement('canvas'); c.width = Math.round(cw * 2); c.height = Math.round(ch * 2);
  const x = c.getContext('2d'), k1 = gl.width / w, k2 = fx.width / w;
  drawSceneFx(SC.scene.draw()); // 방금 그린 그대로 옮긴다
  x.drawImage(gl, sx * k1, sy * k1, cw * k1, ch * k1, 0, 0, c.width, c.height);
  x.drawImage(fx, sx * k2, sy * k2, cw * k2, ch * k2, 0, 0, c.width, c.height);
  return c;
}
async function grabMap(a) {
  const back = { center: map.getCenter(), zoom: map.getZoom() };
  const wait = ev => Promise.race([new Promise(r => map.once(ev, r)), sleep(7000)]);
  SC.hold = true;
  try {
    map.jumpTo({ center: [state.lng, state.lat], zoom: 16.3 }); map.triggerRepaint();
    await wait('idle'); // 지도 자료가 다 오고 그림자 자료까지 다시 만들어진 뒤
    return await new Promise(res => {
      map.once('render', () => {
        const src = map.getCanvas(), W = src.clientWidth, H = src.clientHeight, k = src.width / W, pd = mapPadding(), p = map.project([state.lng, state.lat]);
        const cw = Math.min(W - pd.left - pd.right, (H - pd.bottom) * a, 2 * Math.min(p.x - pd.left, W - p.x)), ch = Math.min(cw / a, 2 * Math.min(p.y, H - pd.bottom - p.y)), cw2 = ch * a;
        const c = document.createElement('canvas'); c.width = Math.round(cw2 * k); c.height = Math.round(ch * k);
        c.getContext('2d').drawImage(src, (p.x - cw2 / 2) * k, (p.y - ch / 2) * k, cw2 * k, ch * k, 0, 0, c.width, c.height);
        res({ c, css: cw2 });
      });
      map.triggerRepaint();
    });
  } finally { map.jumpTo(back); SC.hold = false; }
}
async function makeReport() {
  $('#menu').hidden = true; toast('리포트를 만들고 있어요');
  try { await document.fonts?.ready; } catch { /* 글꼴 없이도 만든다 */ }
  const W = 1920, H = 1080, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'), INK = '#15161a', INK2 = '#63666d', INK3 = '#a3a6ad', LINE = '#e9e6e0', TXT = 'Paperlogy, sans-serif';
  const sun = sunNow(), d = state.day, has3d = state.mode === 'rv' && state.rvSub === '3d' && SC.scene?.S.ready;
  const rx = 716, rw = 1124, iy = 80, ih = 716, gap = 20, mw = has3d ? 470 : rw, sw = rw - mw - gap;
  const shot = has3d ? grabScene(sw / ih) : null, runs = SC.runs, yaw = VIEW.yaw;
  let mapShot = null; try { mapShot = await grabMap(mw / ih); } catch { /* 지도 없이 */ }
  let place = state.place;
  if (!place?.name || place.addr === '붙여 넣은 좌표') { const r = await nameHere().catch(() => null); if (r) place = r; }
  const fit = (text, font, size, max, min = 20) => { let fs = size; do { x.font = font.replace('%', fs); if (x.measureText(text).width <= max) return text; fs -= 2; } while (fs >= min); let t = text; while (t.length > 2 && x.measureText(t + '…').width > max) t = t.slice(0, -1); return t + '…'; };
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.textBaseline = 'alphabetic'; x.textAlign = 'left';
  const L = 80, LW = 560;
  // 왼쪽: 자리 · 날짜 · 고른 시각
  x.fillStyle = INK; x.font = `700 30px ${NUM}`; x.fillText(APP, L, 112);
  x.fillStyle = INK2; x.font = `500 20px ${TXT}`; x.fillText('답사 리포트', L + x.measureText(APP).width + 62, 112);
  x.fillStyle = INK; x.fillText(fit(place?.name || '고른 자리', `800 %px ${TXT}`, 58, LW, 34), L, 214);
  x.fillStyle = INK2; x.font = `500 21px ${TXT}`; if (place?.addr) x.fillText(fit(place.addr, `500 %px ${TXT}`, 21, LW, 17), L, 256);
  x.font = `500 18px ${NUM}`; x.fillStyle = INK3; x.fillText(`${state.lat.toFixed(5)}, ${state.lng.toFixed(5)}`, L, place?.addr ? 288 : 256);
  x.fillStyle = LINE; x.fillRect(L, 322, LW, 2);
  x.fillStyle = INK; x.font = `600 26px ${TXT}`; x.fillText(`${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEK[d.getDay()]}요일`, L, 376);
  x.font = `600 124px ${NUM}`; x.fillText(hm(selected()), L - 4, 502);
  const [pn, pk] = phaseOf(sun.altitude);
  x.fillStyle = BAND[pk] === BAND.day ? '#7fbcec' : BAND[pk]; x.beginPath(); x.arc(L + 392, 420, 8, 0, Math.PI * 2); x.fill();
  x.fillStyle = INK; x.font = `600 24px ${TXT}`; x.fillText(pn, L + 410, 429);
  x.fillStyle = INK2; x.font = `500 20px ${TXT}`;
  x.fillText(`해 방위 ${Math.round(sun.azimuth)}° ${compassName(sun.azimuth)}`, L + 380, 466);
  x.fillText(`고도 ${Math.round(sun.altitude)}° · 그림자 ${sun.altitude > 0.5 ? Math.min(99, 1 / Math.tan(sun.altitude * rad)).toFixed(1) + '배' : '없음'}`, L + 380, 498);
  x.fillStyle = INK; x.font = `500 21px ${TXT}`; x.fillText(fit(sayOf(sun), `500 %px ${TXT}`, 21, LW, 16), L, 556);
  const wx = wxAt(selected().getTime());
  x.fillStyle = INK2; x.font = `500 19px ${TXT}`;
  x.fillText(wx && wx[0] != null ? `예보 · 구름 ${Math.round(wx[0])}%${wx[1] != null ? ` · 비 올 확률 ${Math.round(wx[1])}%` : ''}` : '구름 예보 없음', L, 590);
  x.fillStyle = LINE; x.fillRect(L, 622, LW, 2);
  // 하루 해 시각
  let y = 672;
  for (const [label, t, kind] of events()) {
    const p = sunPosition(t, state.lat, state.lng);
    x.fillStyle = kind === 'gold' ? BAND.gold : kind === 'blue' ? BAND.blue : LINE; x.fillRect(L, y - 19, 4, 24);
    x.fillStyle = INK2; x.font = `500 20px ${TXT}`; x.fillText(label, L + 18, y);
    x.fillStyle = INK; x.font = `600 23px ${NUM}`; x.fillText(hm(t), L + 250, y);
    x.fillStyle = INK2; x.font = `500 19px ${TXT}`; x.fillText(`${Math.round(p.azimuth)}° ${compassName(p.azimuth)}`, L + 362, y);
    y += 37;
  }
  // 오른쪽: 그림자 지도(+ 로드뷰 3D)
  const frame = (img, dx, dw, cap) => {
    x.save(); roundRect(x, dx, iy, dw, ih, 22); x.clip();
    x.fillStyle = '#f5f2eb'; x.fillRect(dx, iy, dw, ih);
    if (img) x.drawImage(img, dx, iy, dw, ih);
    x.restore();
    x.fillStyle = INK2; x.font = `500 19px ${TXT}`; x.textAlign = 'left'; x.fillText(fit(cap, `500 %px ${TXT}`, 19, dw, 14), dx + 4, iy + ih + 34);
  };
  frame(mapShot?.c, rx, mw, `지도 · ${hm(selected())} 건물 그림자와 하루 해 길`);
  if (mapShot) {
    x.save(); roundRect(x, rx, iy, mw, ih, 22); x.clip();
    paintCompass(x, rx + mw / 2, iy + ih / 2, Math.min(mw, ih) * 0.36, sun, false);
    x.restore();
  }
  if (shot) {
    let cap = `로드뷰 3D · ${Math.round(yaw ?? 0) % 360}° ${compassName(yaw ?? 0)} 쪽`;
    if (runs) cap += ` · ${runs}`;
    frame(shot, rx + mw + gap, sw, cap);
  }
  // 하루 띠
  const ty = 872, th = 64, X = m => rx + m / 1440 * rw;
  x.save(); roundRect(x, rx, ty, rw, th, 14); x.clip();
  for (const b of RUL.bands) { x.fillStyle = BAND[b.k]; x.fillRect(X(b.m0), ty, X(b.m1) - X(b.m0) + 1, th); }
  x.beginPath(); let st = false, lx = 0;
  for (const p of state.path) { if (p.alt <= 0) continue; const px = X(p.m), py = ty + th - p.alt / RUL.maxAlt * (th - 12); if (!st) { x.moveTo(px, ty + th); st = true; } x.lineTo(px, py); lx = px; }
  if (st) { x.lineTo(lx, ty + th); x.closePath(); x.fillStyle = 'rgba(255,255,255,.5)'; x.fill(); }
  if (WX.hours) for (let hr = 0; hr < 24; hr++) { const v = WX.hours.get(d.getTime() / 1000 + hr * 3600); if (!v || v[0] == null) continue; x.fillStyle = `rgba(92,99,112,${(v[0] / 100 * 0.72).toFixed(3)})`; x.fillRect(X(hr * 60), ty, rw / 24 + 1, 9); }
  x.restore();
  x.textAlign = 'center'; x.font = `500 17px ${NUM}`;
  for (let hr = 0; hr <= 24; hr += 2) { x.fillStyle = hr % 6 ? INK3 : INK; x.fillText(String(hr), X(hr * 60), ty + th + 28); }
  const nx = X(state.min); x.fillStyle = '#fff'; x.fillRect(nx - 3, ty - 6, 6, th + 12); x.fillStyle = INK; x.fillRect(nx - 1.5, ty - 6, 3, th + 12);
  x.textAlign = 'left'; x.fillStyle = INK3; x.font = `500 15px ${TXT}`;
  x.fillText('해 위치는 NASA 값과 0.01° 안쪽으로 맞춘 계산값 · 건물 높이는 일부 어림값 · 띠 위 회색은 구름 예보 · 지도 © OpenStreetMap', rx, 1010);
  const name = `${APP}_리포트_${(place?.name || '').replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 16)}_${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${hm(selected()).replace(':', '')}.png`;
  window.__report = c;
  c.toBlob(async b => {
    const file = new File([b], name, { type: 'image/png' });
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: APP }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click();
    toast('리포트 이미지를 저장했어요');
  }, 'image/png');
}
$('#mReport').addEventListener('click', makeReport);

// ───────── 모드 ─────────
document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
// 로드뷰 · 나침반이 함께 쓰는 보는 방향(yaw: 북 0 시계 방향, live: 폰 방향을 따라가는 중)
const VIEW = { yaw: null, live: false };
function setMode(m) {
  if (state.mode === m) return;
  const prev = state.mode;
  if (prev === 'rv' && state.rvSub === 'photo' && rv) { try { VIEW.yaw = (rv.getViewpoint().pan % 360 + 360) % 360; } catch { /* 아직 안 열림 */ } }
  if (prev === 'ar') stopAR();
  if (prev === 'cmp') setFollowC(false);
  if (prev === 'rv') { setFollowRV(false); leave3D(); }
  state.mode = m;
  if (!wide() && (m === 'rv' || m === 'ar')) state.sheetMin = true; // 로드뷰 · AR은 접어서 열고, 접힌 채 탭을 바꾸면 접힌 그대로 둔다
  bodyClass();
  document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  $('#rv').hidden = m !== 'rv'; $('#ar').hidden = m !== 'ar'; $('#cmp').hidden = m !== 'cmp';
  if (m === 'rv' && state.sub) { VIEW.yaw = bearing(state, state.sub); if (SC.scene) SC.scene.S.pitch = 4; SC.aim = false; } // 바라볼 곳이 있으면 그쪽을 보며 연다
  if (m === 'rv') { const s = RVW.fell ? 'photo' : state.rvSub ?? 'photo'; RVW.fell = false; setRvSub(s, true); } // 지난번에 사진이 없어 3D로 넘어갔으면 사진부터 다시 해 본다
  if (m === 'ar') { $('#arStart').hidden = false; $('#arHud').hidden = true; }
  if (m === 'cmp') openCompass();
  $('#menu').hidden = true; $('#results').hidden = true; pinChip(); spotText();
  if (m === 'map') { // 로드뷰에서 걸어간 만큼 지도를 맞추고, 밀린 그림자는 돌아온 뒤에 만든다
    if (RVW.moved) { RVW.moved = false; map.jumpTo({ center: [state.lng, state.lat] }); }
    requestAnimationFrame(() => { const k = tileKey(); if (state.mode === 'map' && k !== shadowKey && map.areTilesLoaded()) { shadowKey = k; buildShadows(); } });
  }
  scheduleUpdate();
}

// ───────── 로드뷰: 사진 | 3D ─────────
document.querySelectorAll('.sub button').forEach(b => b.addEventListener('click', () => { RVW.fell = false; setRvSub(b.dataset.sub); }));
function setRvSub(s, force) {
  if (state.rvSub === s && !force) return;
  const was = state.rvSub; setFollowRV(false);
  state.rvSub = s; bodyClass();
  document.querySelectorAll('.sub button').forEach(b => b.classList.toggle('on', b.dataset.sub === s));
  $('#rvPhoto').hidden = s !== 'photo'; $('#rv3d').hidden = s !== '3d';
  if (s === 'photo') {
    leave3D(); $('#rvSpot').hidden = true;
    if (VIEW.yaw != null) RVW.view = { pan: VIEW.yaw, tilt: SC.scene && SC.looked ? -SC.scene.S.pitch : 0 };
    openRoadview();
  } else {
    if (was === 'photo' && rv && SC.scene) { try { const v = rv.getViewpoint(); VIEW.yaw = (v.pan % 360 + 360) % 360; SC.scene.S.pitch = clamp(-v.tilt, -60, 85); } catch { /* 아직 안 열림 */ } }
    enter3D();
  }
  if (VIEW.live) setFollowRV(true);
  drawMini(); scheduleUpdate();
}

// 사진(카카오 로드뷰)
let kakaoLoading = null, rv = null, rvClient = null, rvPath = [], rvSun = null, rvInitTimer;
const RVW = { view: null, autoT: 0, moved: false, key: '', mini: 0, ready: false, fell: false, miniAt: 0, miniT: 0 };
// 카카오 '답사' 앱의 JavaScript 키. 웹페이지에 드러나도 되는 키라 앱에 넣어 둔다. 카카오에 등록한 주소(ynkiki.github.io · 127.0.0.1:8787)에서만 작동한다
const KAKAO_KEY = '1a6a489c4ac3182a870deef58231bd2d';
localStorage.removeItem('haegil.kakao'); // 예전에 따로 넣어 둔 키는 쓰지 않는다. 앱에 든 키만 쓴다
function loadKakao() {
  if (kakaoLoading) return kakaoLoading;
  kakaoLoading = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&autoload=false&libraries=services`;
    s.onload = () => { try { kakao.maps.load(res); } catch (e) { rej(e); } };
    s.onerror = () => { kakaoLoading = null; rej(new Error('load')); };
    document.head.appendChild(s);
  });
  return kakaoLoading;
}
loadKakao().catch(() => {});
// 사진 로드뷰가 안 되면 묻거나 설정을 시키지 않고 바로 3D로 넘긴다. 다음에 로드뷰를 열 때는 사진부터 다시 해 본다
function fallTo3D(text) {
  if (state.mode !== 'rv' || state.rvSub !== 'photo') return;
  toast(text); setRvSub('3d'); RVW.fell = true;
}

async function openRoadview() {
  try { await loadKakao(); } catch { fallTo3D('사진 로드뷰를 못 불러와서 3D로 보여 드려요'); return; }
  if (state.mode !== 'rv' || state.rvSub !== 'photo') return;
  if (!rv) {
    rv = new kakao.maps.Roadview($('#rvView'));
    rvClient = new kakao.maps.RoadviewClient();
    kakao.maps.event.addListener(rv, 'init', () => {
      clearTimeout(rvInitTimer); RVW.ready = true;
      const s = sunNow(), v = RVW.view; RVW.view = null;
      rv.setViewpoint(v ? { pan: v.pan, tilt: clamp(v.tilt, -85, 85), zoom: -3 } : { pan: s.altitude > 0 ? s.azimuth : (state.times?.sunset ? sunPosition(state.times.sunset, state.lat, state.lng).azimuth : 180), tilt: -clamp(s.altitude - 12, 0, 40), zoom: -3 });
      placeRoadviewPath(); drawMini();
    });
    kakao.maps.event.addListener(rv, 'viewpoint_changed', () => {
      if (state.mode !== 'rv' || state.rvSub !== 'photo') return;
      VIEW.yaw = (rv.getViewpoint().pan % 360 + 360) % 360; viewChanged();
      // 작은 나침반은 초당 30번까지만 다시 그리고, 멈추면 마지막 방향으로 한 번 더 그린다
      const now = performance.now();
      if (now - RVW.miniAt > 30 && !RVW.mini) { RVW.miniAt = now; RVW.mini = requestAnimationFrame(() => { RVW.mini = 0; drawMini(); }); }
      clearTimeout(RVW.miniT); RVW.miniT = setTimeout(drawMini, 90);
    });
    kakao.maps.event.addListener(rv, 'position_changed', () => {
      placeRoadviewPath();
      const p = rv.getPosition(); if (!p || state.mode !== 'rv' || state.rvSub !== 'photo') return;
      // 우리가 연 자리(고른 자리에서 가장 가까운 사진)는 핀을 옮기지 않는다. 로드뷰 안에서 걸어간 만큼만 따라간다
      if (performance.now() - RVW.autoT < 1500) return;
      const q = { lat: p.getLat(), lng: p.getLng() };
      if (distM(q, state) > 3) { state.lat = q.lat; state.lng = q.lng; state.place = null; $('#q').value = ''; RVW.moved = true; favBtn(); save(); }
    });
  }
  rv.relayout();
  if (RVW.view) { try { rv.setViewpoint({ pan: RVW.view.pan, tilt: clamp(RVW.view.tilt, -85, 85), zoom: -3 }); } catch { /* 처음 여는 중 */ } }
  const ll = new kakao.maps.LatLng(state.lat, state.lng);
  const at = `${state.lat},${state.lng}`, stale = () => state.mode !== 'rv' || state.rvSub !== 'photo' || at !== `${state.lat},${state.lng}`;
  const open = id => {
    RVW.autoT = performance.now(); rv.setPanoId(id, ll);
    clearTimeout(rvInitTimer);
    if (!RVW.ready) rvInitTimer = setTimeout(() => { if (!RVW.ready) fallTo3D('사진 로드뷰가 열리지 않아 3D로 보여 드려요'); }, 9000); // 처음 열 때만 기다려 본다
  };
  rvClient.getNearestPanoId(ll, 150, id => {
    if (stale()) return;
    if (id != null) { open(id); return; }
    rvClient.getNearestPanoId(ll, 400, id2 => { if (stale()) return; if (id2 != null) open(id2); else fallTo3D('이 근처엔 사진 로드뷰가 없어 3D로 보여 드려요'); }); // 조금 더 넓게 한 번 더
  });
}
function rvPoint(base, az, alt) {
  const R = 400, horiz = R * Math.cos(alt * rad), up = 1.7 + R * Math.sin(alt * rad);
  const lat = base.getLat() + horiz * Math.cos(az * rad) / 111320;
  const lng = base.getLng() + horiz * Math.sin(az * rad) / (111320 * Math.cos(base.getLat() * rad));
  return { ll: new kakao.maps.LatLng(lat, lng), up };
}
function rvOverlay(cls, html, az, alt, base) {
  const el = document.createElement('div'); el.className = cls; el.innerHTML = html;
  const { ll, up } = rvPoint(base, az, alt);
  const ov = new kakao.maps.CustomOverlay({ position: ll, content: el, xAnchor: 0.5, yAnchor: 0.5, map: rv });
  ov.setAltitude?.(up); ov.setRange?.(1000);
  return ov;
}
function placeRoadviewPath() {
  if (!rv || !window.kakao || !RVW.ready) return; // 로드뷰가 다 열리기 전에는 점을 올리지 않는다
  const base = rv.getPosition(); if (!base) return;
  const pts = sampleDay(base.getLat(), base.getLng(), 30).filter(s => s.alt > -1); // 30분 간격: 점이 많으면 폰에서 돌려 볼 때 무겁다
  const spec = s => s.m % 60 === 0 ? ['rv-hour' + (s.alt < 6 ? ' gold' : ''), `<i></i><em>${s.m / 60}시</em>`] : ['rv-dot' + (s.alt < 6 ? ' gold' : ''), '<i></i>'];
  const key = pts.map(s => spec(s).join()).join('|');
  if (key === RVW.key && rvPath.length === pts.length) {
    pts.forEach((s, i) => { const { ll, up } = rvPoint(base, s.az, s.alt), o = rvPath[i]; o.setPosition(ll); o.setAltitude?.(up); });
  } else {
    for (const o of rvPath) o.setMap(null);
    rvPath = pts.map(s => { const [c, h] = spec(s); return rvOverlay(c, h, s.az, s.alt, base); });
    RVW.key = key;
  }
  updateRoadviewSun();
}
function updateRoadviewSun() {
  if (!rv || !window.kakao || !RVW.ready || state.mode !== 'rv' || state.rvSub !== 'photo') return;
  const base = rv.getPosition(); if (!base) return;
  const s = sunPosition(selected(), base.getLat(), base.getLng());
  if (s.altitude < -1) { if (rvSun) rvSun.setMap(null); rvSun = null; return; }
  const html = `<i></i><em>${hm(selected())}</em>`;
  if (!rvSun) { rvSun = rvOverlay('rv-sun', html, s.azimuth, s.altitude, base); return; }
  const { ll, up } = rvPoint(base, s.azimuth, s.altitude);
  rvSun.setPosition(ll); rvSun.setAltitude?.(up); const em = rvSun.getContent().querySelector('em'), tx = hm(selected()); if (em.textContent !== tx) em.textContent = tx;
  if (!rvSun.getMap()) rvSun.setMap(rv);
}
function sampleDay(lat, lng, step) {
  const out = [];
  for (let m = 0; m <= 1440; m += step) { const p = sunPosition(new Date(state.day.getTime() + m * 60000), lat, lng); out.push({ m, az: p.azimuth, alt: p.altitude }); }
  return out;
}

// 3D(직접 그린 거리)
const SC = { scene: null, fail: false, active: false, aim: false, origin: null, full: false, have: null, fitAt: '', back: null, off: [0, 0], hold: false, snapAt: '', raf: 0, last: 0, follow: false, walk: 0, keys: new Set(), samples: [], runs: '', looked: false, mapT: 0, walking: () => SC.walk || SC.keys.size > 0 };
function ensureScene() {
  if (SC.scene || SC.fail) return SC.scene;
  try { SC.scene = createScene($('#sc')); } catch (e) { console.error(e); SC.scene = null; }
  if (!SC.scene) { SC.fail = true; toast('이 기기에서는 3D를 그릴 수 없어요'); return null; }
  SC.scene.setPath(state.path); const s = sunNow(); SC.scene.setSun(s.azimuth, s.altitude);
  return SC.scene;
}
function enter3D() {
  if (!ensureScene()) return;
  SC.active = true;
  const S = SC.scene.S;
  if (!SC.looked) { SC.looked = true; SC.aim = VIEW.yaw == null; const s = sunNow(); S.yaw = s.altitude > 0 ? s.azimuth : 180; S.pitch = VIEW.yaw == null ? clamp(s.altitude * 0.45, 3, 22) : 8; }
  if (VIEW.yaw != null) S.yaw = VIEW.yaw; // 나침반 · 사진에서 보던 방향 그대로
  LENS.fovBack = WIDEST; if (LENS.mm) setTimeout(fitLens, 60); else S.fovLong = WIDEST; // 로드뷰는 늘 가장 넓게 연다
  // 둘레 지도 자료가 이미 있으면 지도를 건드리지 않고 그 자리에서 바로 연다
  const here = SC.origin && distM(state, SC.origin) <= 150;
  if (here && SC.full) { placeEye(); litDay(); updateSpot(); requestScene(); return; }
  const have = haveRect(), full = !!have && inside(needRect(R_NEED), have);
  if (have && inside(needRect(0), have)) { buildScene(full, have); litDay(); updateSpot(); } // 있는 만큼으로 먼저 보여 준다
  else if (!here) { SC.origin = null; S.ready = false; updateSpot(); }
  if (!full) fitJump(); // 모자란 둘레는 받아서 채운다
  requestScene();
}
// 고른 자리 둘레(R_NEED)가 다 들어오는 만큼만 가려진 지도를 옮긴다. 보던 지도는 기억해 둔다
const R_NEED = 600, TN = 1 << 14;
const inside = (a, b) => a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];
const haveRect = () => { if (map.getZoom() < 14 || !map.areTilesLoaded()) return null; const b = map.getBounds(); return [Math.floor(mercX(b.getWest()) * TN), Math.floor(mercY(b.getNorth()) * TN), Math.floor(mercX(b.getEast()) * TN), Math.floor(mercY(b.getSouth()) * TN)]; };
const needRect = r => { const dy = r / 111320, dx = r / (111320 * Math.cos(state.lat * rad)); return [Math.floor(mercX(state.lng - dx) * TN), Math.floor(mercY(state.lat + dy) * TN), Math.floor(mercX(state.lng + dx) * TN), Math.floor(mercY(state.lat - dy) * TN)]; };
function fitJump() {
  if (!SC.back) { const c = map.getCenter(); SC.back = { lng: c.lng, lat: c.lat, zoom: map.getZoom(), pin: { lat: state.lat, lng: state.lng } }; }
  const el = map.getContainer(), z = clamp(Math.log2(78271.517 * Math.cos(state.lat * rad) * Math.min(el.clientWidth, el.clientHeight) / (2.3 * R_NEED)), 14, 16.5);
  SC.fitAt = `${state.lat.toFixed(5)},${state.lng.toFixed(5)}`;
  map.jumpTo({ center: [state.lng, state.lat], zoom: z }); map.triggerRepaint();
}
function leave3D() {
  if (!SC.active) return;
  SC.active = false; SC.walk = 0; SC.keys.clear(); SC.follow = false; cancelAnimationFrame(SC.raf); SC.raf = 0; $('#scWalk').classList.remove('on');
  const b = SC.back; SC.back = null;
  if (b) map.jumpTo(distM(b.pin, state) > 5 ? { center: [state.lng, state.lat], zoom: b.zoom } : { center: [b.lng, b.lat], zoom: b.zoom });
}
function collectScene() {
  const lat0 = state.lat, lng0 = state.lng, ox = mercX(lng0), oy = mercY(lat0), k = 1 / (MERC * Math.cos(lat0 * rad));
  const ring = r => {
    let n = r.length; if (n > 1 && r[0][0] === r[n - 1][0] && r[0][1] === r[n - 1][1]) n--;
    const a = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { a[2 * i] = (mercX(r[i][0]) - ox) / k; a[2 * i + 1] = -(mercY(r[i][1]) - oy) / k; }
    return a;
  };
  const cosL = Math.cos(lat0 * rad);
  const polys = (layer, each, lim) => {
    for (const f of map.querySourceFeatures('openmaptiles', { sourceLayer: layer })) {
      const g = f.geometry, ps = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const p of ps) {
        if (lim) { const c = p[0]?.[0]; if (!c || Math.hypot((c[0] - lng0) * 111320 * cosL, (c[1] - lat0) * 111320) > lim) continue; } // 먼 것은 좌표를 바꾸기 전에 뺀다
        const rings = p.map(ring).filter(r => r.length >= 6); if (rings.length) each(rings, f.properties);
      }
    }
  };
  const d = { buildings: [], water: [], green: [], roads: [] };
  polys('building', (rings, pr) => {
    const p = rings[0]; let ar = 0;
    for (let i = 0, n = p.length / 2; i < n; i++) { const j = (i + 1) % n; ar += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1]; }
    const h = guessH(pr.render_height, Math.abs(ar) / 2);
    if (h < 35 && Math.hypot(p[0], p[1]) > 950) return; // 멀리서는 높은 건물만 남긴다
    d.buildings.push({ h, p });
  }, 1900);
  polys('water', rings => d.water.push({ rings }));
  polys('park', rings => d.green.push({ kind: 'park', rings }));
  polys('landcover', (rings, pr) => { const kind = pr.class === 'wood' ? 'wood' : (pr.class === 'grass' || pr.class === 'farmland') ? 'grass' : pr.class === 'sand' ? 'sand' : null; if (kind) d.green.push({ kind, rings }); });
  for (const f of map.querySourceFeatures('openmaptiles', { sourceLayer: 'transportation' })) {
    const pr = f.properties; if (pr.brunnel === 'tunnel') continue;
    const g = f.geometry, ls = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const l of ls) {
      const a = new Float32Array(l.length * 2);
      for (let i = 0; i < l.length; i++) { a[2 * i] = (mercX(l[i][0]) - ox) / k; a[2 * i + 1] = -(mercY(l[i][1]) - oy) / k; }
      d.roads.push({ cls: pr.class, pts: a });
    }
  }
  return { d, origin: { lat: lat0, lng: lng0 } };
}
// 눈 자리 = 고른 자리(+ 건물 안이면 길 위로 비켜 선 만큼). 핀은 옮기지 않는다
function placeEye() { const o = SC.origin; SC.scene.S.eye = [(state.lng - o.lng) * 111320 * Math.cos(o.lat * rad) + SC.off[0], (state.lat - o.lat) * 111320 + SC.off[1]]; }
function buildScene(full, have) {
  const t0 = performance.now(), { d, origin } = collectScene(), t1 = performance.now();
  SC.scene.setData(d); SC.perf = [Math.round(t1 - t0), Math.round(performance.now() - t1), d.buildings.length];
  SC.origin = origin; SC.full = full; SC.have = have; SC.scene.S.eye = [0, 0]; SC.off = [0, 0];
  // 고른 자리가 건물 안이면 가장 가까운 길 위에 서서 본다(핀은 그대로)
  if (SC.scene.inBuilding(0, 0)) {
    const p = openSpot(d.roads);
    if (p) {
      SC.off = p; SC.scene.S.eye = p;
      const at = `${origin.lat.toFixed(5)},${origin.lng.toFixed(5)}`;
      if (SC.snapAt !== at) { SC.snapAt = at; toast('건물 안이라 가까운 길 위에 서서 봐요'); }
    }
  }
  if (SC.aim && d.roads.length) { SC.aim = false; aimView(d.roads); }
}
function syncScene() {
  if (!SC.active || !SC.scene) return;
  const here = SC.origin && distM(state, SC.origin) <= 150;
  if (here && SC.full) placeEye();
  else {
    const have = haveRect(), need = needRect(R_NEED), full = !!have && inside(need, have);
    const at = `${state.lat.toFixed(5)},${state.lng.toFixed(5)}`;
    if (full) { if (here && SC.have && inside(need, SC.have)) { SC.full = true; placeEye(); } else buildScene(true, have); }
    else if (SC.fitAt !== at) { if (!here && have && inside(needRect(0), have)) buildScene(false, have); fitJump(); requestScene(); return; }
    else buildScene(true, have); // 맞춰 옮겼는데도 모자라면 있는 만큼으로
  }
  litDay(); updateSpot(); requestScene();
}
// 처음 볼 방향: 해가 보이면 해 쪽, 건물에 가리면 길을 따라(해에 가까운 쪽으로)
function aimView(roads) {
  const sc = SC.scene, S = sc.S, s = sunNow(), ex = S.eye[0], ey = S.eye[1];
  if (s.altitude > 1 && !sc.blocked(s.azimuth, s.altitude)) { S.yaw = s.azimuth; S.pitch = clamp(s.altitude * 0.45, 3, 22); return; }
  let bd = 60 * 60, dir = null;
  for (const r of roads) {
    if (r.cls === 'rail' || r.cls === 'transit') continue;
    const a = r.pts;
    for (let i = 0; i + 3 < a.length; i += 2) {
      const ax = a[i] - ex, ay = a[i + 1] - ey, dx = a[i + 2] - a[i], dy = a[i + 3] - a[i + 1], L = dx * dx + dy * dy; if (L < 1) continue;
      const t = clamp(-(ax * dx + ay * dy) / L, 0, 1), x = ax + dx * t, y = ay + dy * t, dd = x * x + y * y;
      if (dd < bd) { bd = dd; dir = Math.atan2(dx, dy) / rad; }
    }
  }
  if (dir == null) return;
  if (Math.abs(((dir - s.azimuth + 540) % 360) - 180) > 90) dir += 180;
  S.yaw = (dir + 360) % 360; S.pitch = 7;
}
function openSpot(roads) {
  const sc = SC.scene, free = (x, y) => !sc.inBuilding(x, y) && !sc.inBuilding(x + 1.5, y) && !sc.inBuilding(x - 1.5, y) && !sc.inBuilding(x, y + 1.5) && !sc.inBuilding(x, y - 1.5);
  let best = null, bd = 1e9;
  for (const r of roads) {
    if (r.cls === 'rail' || r.cls === 'transit') continue;
    const a = r.pts;
    for (let i = 0; i + 3 < a.length; i += 2) {
      const ax = a[i], ay = a[i + 1], dx = a[i + 2] - ax, dy = a[i + 3] - ay, L = dx * dx + dy * dy || 1;
      const t = clamp(-(ax * dx + ay * dy) / L, 0, 1), x = ax + dx * t, y = ay + dy * t, dd = x * x + y * y;
      if (dd < bd && dd < 200 * 200 && free(x, y)) { bd = dd; best = [x, y]; }
    }
  }
  if (best) return best;
  for (let r = 4; r <= 160; r += 4) for (let k = 0; k < 16; k++) { const t = k * Math.PI / 8, x = r * Math.sin(t), y = r * Math.cos(t); if (free(x, y)) return [x, y]; }
  return null;
}
// 이 자리에 볕이 드는 시간(건물만 따짐)
function litDay() {
  const sc = SC.scene;
  if (!sc?.S.ready) { SC.samples = []; SC.runs = ''; return; }
  SC.samples = state.path.filter(p => p.alt > 0.5 && p.m % 8 === 0 && p.m < 1440).map(p => ({ m: p.m, lit: !sc.blocked(p.az, p.alt) }));
  const runs = []; let cur = null;
  for (const s of SC.samples) { if (s.lit) { if (cur && s.m - cur[1] <= 8) cur[1] = s.m; else runs.push(cur = [s.m, s.m]); } }
  SC.runs = !SC.samples.length ? '' : !runs.length ? '오늘은 종일 건물 그늘이에요' : `볕 드는 시간 ${runs.slice(0, 3).map(r => `${mm(Math.max(r[0] - 4, 0))}–${mm(Math.min(r[1] + 4, 1439))}`).join(' · ')}${runs.length > 3 ? ' …' : ''}`;
  drawRuler();
}
function updateSpot() {
  const el = $('#rvSpot'), is3d = state.rvSub === '3d';
  if (state.mode !== 'rv' || (is3d && !SC.scene?.S.ready) || (!is3d && VIEW.yaw == null)) { if (!el.hidden) el.hidden = true; return; }
  const s = sunNow();
  let html = '';
  if (is3d) {
    html = s.altitude <= 0.5 ? '<b>해가 없는 시각</b>' : SC.scene.blocked(s.azimuth, s.altitude) ? '<b class="shade">지금 이 자리는 건물 그늘</b>' : '<b class="lit">지금 이 자리에 볕이 들어요</b>';
    if (SC.runs) html += `<span>${SC.runs}</span>`;
  }
  // 보는 쪽 기준 빛: 역광 · 측광 · 순광
  if (VIEW.yaw != null) {
    const d = ((s.azimuth - VIEW.yaw + 540) % 360) - 180, k = lightOf(Math.abs(d));
    const now = s.altitude <= 0.5 ? '' : k === '측광' ? `지금 측광(해가 ${d > 0 ? '오른쪽' : '왼쪽'})` : k === '역광' ? '지금 역광(해를 마주 봄)' : '지금 순광(해를 등짐)';
    const R = lightRuns(), fmt = n => R[n].length ? `${n} ${R[n].map(r => `${mm(r[0])}–${mm(Math.min(r[1] + 4, 1439))}`).join(' · ')}` : '';
    const both = [fmt('역광'), fmt('순광')].filter(Boolean).join(' / ');
    html += `<span class="lt">보는 쪽 ${Math.round(VIEW.yaw) % 360}° ${compassName(VIEW.yaw)}${now ? ' · ' + now : ''}</span><span>${both || '오늘 이 방향엔 역광 · 순광 시간이 없어요'}</span>`;
  }
  put('#rvSpot', html, true); if (el.hidden) el.hidden = false;
  el.classList.toggle('fold', !wide() && !state.spotOpen);
}
$('#rvSpot').addEventListener('click', () => { if (wide()) return; state.spotOpen = !state.spotOpen; $('#rvSpot').classList.toggle('fold', !state.spotOpen); });
// 보는 방향이 바뀌면 빛 안내와 시간 자를 다시 그린다(잦은 호출은 묶어서)
let vcT = 0;
function viewChanged() { if (vcT) return; vcT = setTimeout(() => { vcT = 0; if (state.mode === 'rv') { updateSpot(); drawRuler(); } }, 120); }

// 렌즈 화각 틀(풀프레임 기준, 가로 16:9 · 세로 9:16)
const WIDEST = 118;
const LENS = { mm: 0, tall: false, list: [0, 24, 35, 50, 85], fovBack: null };
function lensRect(c) { const sw = LENS.tall ? 20.25 : 36, sh = LENS.tall ? 36 : 20.25; return { hw: sw / 2 / LENS.mm * c.fl / c.aspect * c.w / 2, hh: sh / 2 / LENS.mm * c.fl * c.h / 2 }; }
function fitLens() { // 틀이 화면에 다 들어오게 보는 넓이를 맞춘다
  const sc = SC.scene, c = sc?.S.cam; if (!LENS.mm || !c) return;
  const { hw, hh } = lensRect(c);
  const k = Math.min(Math.max(c.w / 2 - LAY.rv - (LAY.kind === 'wide' ? 16 : 14), 60) / hw, Math.max(c.h / 2 - LAY.lensV, 50) / hh);
  sc.S.fovLong = clamp(2 * Math.atan(Math.tan(sc.S.fovLong / 2 * rad) / k) / rad, 24, 118);
  requestScene();
}
function lensUI() { const b = $('#lens'); b.textContent = LENS.mm ? `${LENS.mm}mm` : '화각'; b.classList.toggle('on', !!LENS.mm); }
$('#lens').addEventListener('click', () => {
  const S = SC.scene?.S; if (!S) return;
  if (!LENS.mm) LENS.fovBack = S.fovLong;
  LENS.mm = LENS.list[(LENS.list.indexOf(LENS.mm) + 1) % LENS.list.length];
  if (LENS.mm) fitLens(); else { if (LENS.fovBack) S.fovLong = LENS.fovBack; requestScene(); }
  lensUI();
  if (LENS.mm === LENS.list[1]) toast('틀 안이 찍히는 범위 · 이름표를 누르면 세로');
});

function requestScene() { if (SC.active && !SC.raf) SC.raf = requestAnimationFrame(sceneLoop); }
function sceneLoop(t) {
  SC.raf = 0; if (!SC.active) return;
  const S = SC.scene.S, dt = SC.last ? Math.min((t - SC.last) / 1000, 0.05) : 0.016; SC.last = t;
  if (SC.follow) { const M = oriStep(); if (M) { S.yaw = (camHeading(M) + 360) % 360; S.pitch = clamp(camPitch(M), -60, 85); } }
  const T = SC.turn;
  if (T) {
    const k = clamp((t - (T.t0 ??= t)) / 380, 0, 1), e = 1 - (1 - k) ** 3;
    S.yaw = (T.y0 + T.dy * e + 360) % 360; S.pitch = T.p0 + T.dp * e;
    if (k >= 1) SC.turn = null;
  }
  const moving = SC.walking();
  if (moving && SC.origin) {
    const K = SC.keys, fw = (SC.walk || K.has('KeyW') || K.has('ArrowUp') ? 1 : 0) - (K.has('KeyS') || K.has('ArrowDown') ? 1 : 0), sd = (K.has('KeyD') ? 1 : 0) - (K.has('KeyA') ? 1 : 0);
    if (K.has('ArrowLeft')) S.yaw = (S.yaw - 70 * dt + 360) % 360; if (K.has('ArrowRight')) S.yaw = (S.yaw + 70 * dt) % 360;
    const sp = 7.5 * dt, ps = S.yaw * rad, nx = S.eye[0] + (Math.sin(ps) * fw + Math.cos(ps) * sd) * sp, ny = S.eye[1] + (Math.cos(ps) * fw - Math.sin(ps) * sd) * sp;
    if (!SC.scene.inBuilding(nx, ny)) {
      S.eye = [nx, ny]; SC.off = [0, 0];
      if (state.place) { state.place = null; $('#q').value = ''; }
      state.lat = SC.origin.lat + ny / 111320; state.lng = SC.origin.lng + nx / (111320 * Math.cos(SC.origin.lat * rad));
    }
    if (t - SC.mapT > 500) { SC.mapT = t; updateSpot(); }
  }
  const sz = cvSize($('#scFx')); S.vw = sz.w; S.vh = sz.h;
  S.res = coarse() && (SC.drag || SC.follow || moving || SC.turn) ? 1.5 : 2; // 폰에서 돌려 보는 동안은 조금 낮은 해상도로 그리고, 멈추면 선명하게 다시 그린다
  drawSceneFx(SC.scene.draw());
  if (SC.follow || moving || SC.turn) SC.raf = requestAnimationFrame(sceneLoop); else SC.last = 0;
}
// 해가 화면 가운데 오게 돌아본다
function faceSun() {
  if (!SC.scene) return; const S = SC.scene.S, s = sunNow();
  if (SC.follow) { VIEW.live = false; setFollowRV(false); }
  const p1 = clamp(Math.max(s.altitude, 0) - 3, 2, 80);
  SC.turn = { y0: S.yaw, dy: ((s.azimuth - S.yaw + 540) % 360) - 180, p0: S.pitch, dp: p1 - S.pitch, t0: null };
  requestScene();
}
function walkEnd() { if (SC.walking() || !SC.active) return; map.jumpTo({ center: [state.lng, state.lat] }); litDay(); updateSpot(); favBtn(); save(); }

// 해가 화면 밖일 때: 가장자리에 해 쪽을 가리키는 주황 알약(누르면 해 쪽으로 돈다)
function sunArrow(ctx, w, h, p, text, top = 44, bottom = 44, inset = 0) {
  let ux = p.sx, uy = -p.sy; const n = Math.hypot(ux, uy) || 1; ux /= n; uy /= n;
  ctx.font = `700 14px ${NUM}`;
  const tw = ctx.measureText(text).width, bw = tw + 52, bh = 38;
  const cx = (inset + w) / 2, cy = (top + h - bottom) / 2, hw = (w - inset) / 2 - bw / 2 - 12, hh = (h - top - bottom) / 2 - bh / 2;
  const t = Math.min(Math.abs(hw / (ux || 1e-6)), Math.abs(hh / (uy || 1e-6)));
  const x = cx + ux * t, y = cy + uy * t;
  roundRect(ctx, x - bw / 2 - 1.5, y - bh / 2 + 1, bw + 3, bh + 3, bh / 2 + 1.5); ctx.fillStyle = 'rgba(21,22,26,.2)'; ctx.fill(); // 번짐 그림자 대신 옅은 테(번짐은 폰에서 무겁다)
  roundRect(ctx, x - bw / 2, y - bh / 2, bw, bh, bh / 2); ctx.fillStyle = SUN; ctx.fill();
  const left = ux < 0, ax = left ? x - bw / 2 + 19 : x + bw / 2 - 19;
  ctx.save(); ctx.translate(ax, y); ctx.rotate(Math.atan2(uy, ux));
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.moveTo(1, -5); ctx.lineTo(6, 0); ctx.lineTo(1, 5); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, left ? x + 13 : x - 13, y + 1);
  return { x: x - bw / 2 - 6, y: y - bh / 2 - 6, w: bw + 12, h: bh + 12 };
}
// 해: 하늘에 보이면 흰 테 주황 원 + 빛무리, 건물 뒤면 점선 테로 비쳐 보이게
function sunMark(ctx, x, y, r, hidden) {
  if (!hidden) {
    const g = ctx.createRadialGradient(x, y, r, x, y, r * 3.6);
    g.addColorStop(0, 'rgba(255,170,70,.5)'); g.addColorStop(0.45, 'rgba(255,170,70,.16)'); g.addColorStop(1, 'rgba(255,170,70,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 3.6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = 'rgba(21,22,26,.3)'; ctx.beginPath(); ctx.arc(x, y, r + 5.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = hidden ? 'rgba(255,255,255,.34)' : '#fff'; ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = hidden ? 'rgba(255,122,26,.78)' : SUN; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  if (hidden) {
    ctx.setLineDash([5, 5]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
}
function drawSceneFx(c) {
  const { ctx, w, h } = resizeCanvas($('#scFx'));
  ctx.clearRect(0, 0, w, h);
  SC.sunHit = null;
  if (!c) return;
  const sc = SC.scene, S = sc.S, ty = LAY.ty;
  if (!S.ready) { pill(ctx, w / 2, h * 0.5, '주변 거리를 불러오는 중', { h: 32, font: `600 14px ${NUM}`, bg: 'rgba(18,18,20,.7)' }); return; }
  VIEW.yaw = S.yaw;
  if (SC.lastYaw == null || Math.abs(((S.yaw - SC.lastYaw + 540) % 360) - 180) > 1.5) { SC.lastYaw = S.yaw; viewChanged(); }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // 렌즈 화각 틀: 틀 밖은 어둡게
  SC.lensHit = null;
  if (LENS.mm) {
    const { hw, hh } = lensRect(c), x0 = w / 2 - hw, y0 = h / 2 - hh;
    ctx.fillStyle = 'rgba(12,14,20,.5)'; ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.rect(x0, y0, hw * 2, hh * 2); ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1; ctx.beginPath();
    for (const t of [1 / 3, 2 / 3]) { ctx.moveTo(x0 + hw * 2 * t, y0); ctx.lineTo(x0 + hw * 2 * t, y0 + hh * 2); ctx.moveTo(x0, y0 + hh * 2 * t); ctx.lineTo(x0 + hw * 2, y0 + hh * 2 * t); }
    ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.8; ctx.strokeRect(x0, y0, hw * 2, hh * 2);
    const text = `${LENS.mm}mm · ${LENS.tall ? '세로 9:16' : '가로 16:9'}`, font = `700 12.5px ${NUM}`;
    ctx.font = font; const tw = ctx.measureText(text).width + 18, lx = clamp(w / 2 - tw / 2, 8, w - tw - 8), ly = Math.max(y0 + 8, ty + 58);
    pill(ctx, lx + tw / 2, ly + 13, text, { bg: '#fff', fg: '#15161a', font, h: 26 });
    SC.lensHit = { x: lx - 6, y: ly - 6, w: tw + 12, h: 38 };
  }
  const sun = sunNow(), sp = sc.project(sun.azimuth, Math.max(sun.altitude, 0));
  const onScreen = sp.ok && sp.x > 0 && sp.x < w && sp.y > ty + 30 && sp.y < h - 10;
  const r = clamp(Math.min(w, h) * 0.034, 15, 24);
  // 시각 숫자
  ctx.font = `700 14px ${NUM}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const s of state.path) {
    if (s.m % 60 || s.alt <= 0 || Math.abs(s.m - state.min) < 20) continue;
    const p = sc.project(s.az, s.alt); if (!p.ok || p.x < -20 || p.x > w + 20 || p.y < ty + 20 || p.y > h + 20) continue;
    if (onScreen && Math.abs(p.x - sp.x) < 84 && p.y - 19 > sp.y - r - 46 && p.y - 19 < sp.y + r + 14) continue;
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(15,18,28,.72)'; ctx.strokeText(String(s.m / 60), p.x, p.y - 19);
    ctx.fillStyle = '#fff'; ctx.fillText(String(s.m / 60), p.x, p.y - 19);
  }
  // 고른 시각의 해
  if (onScreen && sun.altitude > -1) {
    const hidden = sun.altitude > 0 && sc.blocked(sun.azimuth, sun.altitude), set = sun.altitude <= 0;
    // 해 바로 아래 지평선까지 내린 선: 해가 선 방위를 땅에서 읽는다
    const fp = sc.project(sun.azimuth, 0);
    if (fp.ok && !hidden && sun.altitude > 2 && fp.y - sp.y > r + 16) {
      const y1 = Math.min(fp.y, h);
      for (const [col, lw] of [['rgba(21,22,26,.34)', 4], ['rgba(255,255,255,.86)', 1.6]]) {
        ctx.setLineDash([2, 7]); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(sp.x, sp.y + r + 8); ctx.lineTo(fp.x, y1); ctx.stroke();
      }
      ctx.setLineDash([]);
      if (fp.y < h - 4) { ctx.fillStyle = 'rgba(21,22,26,.34)'; ctx.beginPath(); ctx.arc(fp.x, fp.y, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(fp.x, fp.y, 3.5, 0, Math.PI * 2); ctx.fill(); }
    }
    sunMark(ctx, sp.x, sp.y, r, hidden || set);
    const label = set ? '해 진 쪽' : hidden ? `${hm(selected())} · 건물 뒤` : hm(selected());
    pill(ctx, clamp(sp.x, 64, w - 64), sp.y - r - 24, label, { bg: hidden || set ? 'rgba(18,18,20,.82)' : SUN, font: `700 14px ${NUM}`, h: 28 });
  } else SC.sunHit = sunArrow(ctx, w, h, sp, sun.altitude > 0 ? `해 ${hm(selected())}` : '해 진 쪽', SC.lensHit && Math.abs(LAY.aTop - SC.lensHit.y - 19) < 36 ? SC.lensHit.y + 57 : LAY.aTop, LAY.aBot, LAY.rv); // 화각 이름표와 겹치면 그 아래로
  // 방위 자
  const tw = LAY.kind === 'land' ? Math.max(160, Math.min(w - 184, 440)) : Math.min(w - 24, 440), cx = w / 2, span = Math.min(c.fovH, 100), ppd = tw / span; // 가로 폰은 오른쪽 위 나침반과 안 겹치게 좁힌다
  roundRect(ctx, cx - tw / 2, ty - 18, tw, 36, 12); ctx.fillStyle = 'rgba(18,18,20,.62)'; ctx.fill();
  ctx.save(); roundRect(ctx, cx - tw / 2, ty - 18, tw, 36, 12); ctx.clip();
  const a0 = Math.floor((S.yaw - span / 2) / 5) * 5;
  for (let a = a0; a <= S.yaw + span / 2 + 5; a += 5) {
    const x = cx + (a - S.yaw) * ppd, an = ((a % 360) + 360) % 360;
    if (an % 45 === 0) { ctx.font = `700 13px ${NUM}`; ctx.fillStyle = '#fff'; ctx.fillText(compassName(an), x, ty + 1); }
    else if (an % 15 === 0) { ctx.font = `500 11px ${NUM}`; ctx.fillStyle = 'rgba(255,255,255,.62)'; ctx.fillText(String(an), x, ty + 1); }
    else { ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fillRect(x - 0.5, ty - 3, 1, 7); }
  }
  let ds = ((sun.azimuth - S.yaw + 540) % 360) - 180;
  if (Math.abs(ds) < span / 2 && sun.altitude > -1) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx + ds * ppd, ty + 12, 5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = SUN; ctx.beginPath(); ctx.arc(cx + ds * ppd, ty + 12, 3.6, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(cx - 5, ty - 18); ctx.lineTo(cx + 5, ty - 18); ctx.lineTo(cx, ty - 11); ctx.closePath(); ctx.fill();
  pill(ctx, cx, ty + 34, `${Math.round(S.yaw) % 360}° ${compassName(S.yaw)}`, { bg: 'rgba(18,18,20,.62)', font: `600 12px ${NUM}`, h: 22 });
  drawMini();
}

// 로드뷰 구석의 작은 나침반: 보는 쪽이 늘 위, 돌아보면 같이 돈다. 누르면 나침반 화면으로
function drawMini() {
  const el = $('#rvMini'); if (state.mode !== 'rv') return;
  const yaw = VIEW.yaw; if (el.hidden !== (yaw == null)) el.hidden = yaw == null; if (yaw == null) return;
  const { ctx, w, h } = resizeCanvas(el), cx = w / 2, cy = h / 2, R = w / 2 - 1; if (R < 4) return;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(21,22,26,.8)'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
  const at = (az, rr) => { const a = (az - yaw) * rad; return [cx + Math.sin(a) * rr, cy - Math.cos(a) * rr]; };
  // 보는 범위
  const fov = (state.rvSub === '3d' && SC.scene?.S.cam?.fovH) || 62, half = Math.min(fov, 120) / 2 * rad;
  ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R - 4, -Math.PI / 2 - half, -Math.PI / 2 + half); ctx.closePath(); ctx.fill();
  // 눈금 · 방위 글자
  ctx.lineCap = 'round';
  for (let a = 0; a < 360; a += 30) { const [x1, y1] = at(a, R - 4), [x2, y2] = at(a, R - (a % 90 ? 7 : 9)); ctx.strokeStyle = a % 90 ? 'rgba(255,255,255,.3)' : 'rgba(255,255,255,.6)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `700 11px ${NUM}`;
  for (const [a, name] of [[0, '북'], [90, '동'], [180, '남'], [270, '서']]) { const [x, y] = at(a, R - 18); ctx.fillStyle = a ? 'rgba(255,255,255,.72)' : '#fff'; ctx.fillText(name, x, y + 0.5); }
  // 일출 · 일몰 쪽
  const T = state.times;
  if (T?.sunrise && T?.sunset) for (const d of [T.sunrise, T.sunset]) { const az = sunPosition(d, state.lat, state.lng).azimuth, [x1, y1] = at(az, R - 2), [x2, y2] = at(az, R - 10); ctx.strokeStyle = GOLD; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  // 해
  const s = sunNow();
  if (s.altitude > -1) {
    const [x, y] = at(s.azimuth, (R - 7) * Math.cos(Math.max(s.altitude, 0) * rad) + 1);
    ctx.strokeStyle = 'rgba(255,122,26,.55)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 6.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = SUN; ctx.beginPath(); ctx.arc(x, y, 4.8, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, 2.6, 0, Math.PI * 2); ctx.fill();
}
$('#rvMini').addEventListener('click', () => setMode('cmp'));

// 3D 조작: 끌어서 둘러보기 · 두 손가락/휠로 당겨 보기 · 걷기
{
  const el = $('#scFx'), ps = new Map();
  let tap = null;
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); ps.set(e.pointerId, { x: e.clientX, y: e.clientY }); tap = ps.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null; SC.turn = null; SC.drag = true; clearTimeout(SC.sharpT); });
  el.addEventListener('pointermove', e => {
    const prev = ps.get(e.pointerId); if (!prev || !SC.scene) return;
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 6) tap = null;
    const S = SC.scene.S, k = (S.cam?.fovV ?? 60) / (cvSize(el).h || el.clientHeight);
    if (ps.size === 2) {
      const [a, b] = [...ps.values()], d0 = Math.hypot(a.x - b.x, a.y - b.y);
      ps.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a2, b2] = [...ps.values()], d1 = Math.hypot(a2.x - b2.x, a2.y - b2.y);
      if (d0 && d1) S.fovLong = clamp(S.fovLong * d0 / d1, 24, 118);
    } else {
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      if (SC.follow && Math.hypot(dx, dy) > 4) { VIEW.live = false; setFollowRV(false); }
      if (!SC.follow) { S.yaw = (S.yaw - dx * k + 360) % 360; S.pitch = clamp(S.pitch + dy * k, -60, 88); }
      ps.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    requestScene();
  });
  for (const ev of ['pointerup', 'pointercancel']) el.addEventListener(ev, e => {
    ps.delete(e.pointerId); SC.drag = ps.size > 0;
    if (!SC.drag) { clearTimeout(SC.sharpT); SC.sharpT = setTimeout(requestScene, 140); } // 손을 떼면 선명하게 한 번 더
  });
  el.addEventListener('pointerup', e => {
    if (!tap || performance.now() - tap.t > 500) return;
    const b = el.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top; tap = null;
    const inside = r => r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    if (inside(SC.lensHit)) { LENS.tall = !LENS.tall; fitLens(); requestScene(); }
    else if (inside(SC.sunHit)) faceSun();
  });
  el.addEventListener('wheel', e => { e.preventDefault(); if (!SC.scene) return; const S = SC.scene.S; S.fovLong = clamp(S.fovLong * (e.deltaY > 0 ? 1.07 : 0.935), 24, 118); requestScene(); }, { passive: false });
  const wb = $('#scWalk');
  wb.addEventListener('pointerdown', e => { e.preventDefault(); wb.setPointerCapture(e.pointerId); SC.walk = 1; wb.classList.add('on'); requestScene(); });
  for (const ev of ['pointerup', 'pointercancel']) wb.addEventListener(ev, () => { SC.walk = 0; wb.classList.remove('on'); walkEnd(); });
  const KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  addEventListener('keydown', e => {
    if (!SC.active || !KEYS.includes(e.code) || e.target.closest?.('input, #ruler')) return;
    e.preventDefault(); SC.keys.add(e.code); requestScene();
  });
  addEventListener('keyup', e => { if (SC.keys.delete(e.code)) walkEnd(); });
  addEventListener('blur', () => { if (SC.keys.size) { SC.keys.clear(); walkEnd(); } });
}

// 둘러보는 동안에는 버튼 · 안내를 옅게 해서 화면을 덜 가린다
{
  let t = 0;
  const on = e => { if (!e.target.closest?.('#rvView, #scFx')) return; clearTimeout(t); document.body.classList.add('look'); };
  const off = () => { clearTimeout(t); t = setTimeout(() => document.body.classList.remove('look'), 420); };
  $('#rv').addEventListener('pointerdown', on, true); $('#rv').addEventListener('touchstart', on, { capture: true, passive: true });
  for (const ev of ['pointerup', 'pointercancel', 'touchend', 'touchcancel']) addEventListener(ev, off, true);
}

// 로드뷰: 폰 따라 보기(사진 · 3D 공통)
const RVF = { on: false, raf: 0, last: 0 };
function loopRV(t) {
  RVF.raf = requestAnimationFrame(loopRV);
  const M = oriStep(); if (!M || !rv || t - RVF.last < 33) return;
  RVF.last = t;
  rv.setViewpoint({ pan: camHeading(M), tilt: clamp(-camPitch(M), -85, 85), zoom: rv.getViewpoint().zoom }); // 카카오 tilt: 위 -, 아래 +
  VIEW.yaw = (camHeading(M) + 360) % 360; drawMini();
}
async function setFollowRV(on) {
  if (on) {
    if (!(await askOrientation())) { toast('나침반 권한이 있어야 해요'); return; }
    if (state.mode !== 'rv') return;
    useOrientation('rv', true); RVF.on = true; VIEW.live = true; SC.turn = null;
    if (state.rvSub === 'photo') { cancelAnimationFrame(RVF.raf); RVF.raf = requestAnimationFrame(loopRV); } else { SC.follow = true; requestScene(); }
  } else if (RVF.on) { RVF.on = false; SC.follow = false; cancelAnimationFrame(RVF.raf); useOrientation('rv', false); }
  $('#rvFollow').classList.toggle('on', RVF.on);
}
$('#rvFollow').addEventListener('click', () => { if (RVF.on) VIEW.live = false; setFollowRV(!RVF.on); });

// ───────── 기기 방향(나침반 · 자이로) 공용 ─────────
const AR = { stream: null, raf: 0, lat: null, lng: null, path: [], offset: +(localStorage.getItem('haegil.offset') || 0), calibrating: false, fovLong: 66 };
const ORI = { target: null, M: null, on: false, users: new Set(), rel: null, relT: 0, d: null, ds: null, dn: 0, bad: 0, absOnly: false, rate: 0, pR: null, pT: 0 };
window.__ori = () => ORI;
const wrap180 = d => ((d % 360) + 540) % 360 - 180;
async function askOrientation() {
  if (!('DeviceOrientationEvent' in window)) return false;
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    try { if (await DeviceOrientationEvent.requestPermission() !== 'granted') return false; } catch { return false; }
  }
  return true;
}
function useOrientation(who, on) {
  if (on) ORI.users.add(who); else ORI.users.delete(who);
  if (ORI.users.size && !ORI.on) {
    ORI.on = true;
    addEventListener('deviceorientation', onOrient);
    if (HAS_ABS) addEventListener('deviceorientationabsolute', onOrientAbs);
  }
  if (!ORI.users.size && ORI.on) {
    removeEventListener('deviceorientation', onOrient); removeEventListener('deviceorientationabsolute', onOrientAbs);
    Object.assign(ORI, { on: false, target: null, M: null, rel: null, d: null, ds: null, dn: 0, bad: 0, absOnly: false, rate: 0, pR: null });
  }
}
// 폰 나침반은 자북 기준이라 그 자리의 자기 편차만큼 돌려 진북(지도 · 해 방위)에 맞춘다
let declC = { k: '', v: 0 };
function magDecl() {
  const la = AR.stream && AR.lat != null ? AR.lat : state.lat, lo = AR.stream && AR.lng != null ? AR.lng : state.lng, k = `${la.toFixed(1)},${lo.toFixed(1)}`;
  if (declC.k !== k) declC = { k, v: declination(la, lo, new Date()) };
  return declC.v;
}
// 폰을 세워 하늘 쪽으로 들면 나침반 값이 180° 뒤집히거나 크게 튄다. 그래서 화면은 자이로 값(부드럽고 안 튐)으로 돌리고,
// 나침반은 '북쪽이 어디인지'만 천천히 알려 주게 한다. 잠깐 튀는 값은 버리고, 1.5초쯤 계속 다르면 그때 받아들인다.
const HAS_ABS = 'ondeviceorientationabsolute' in window;
function northFix(cand, w) { // cand: 자이로 틀을 북쪽에 맞추는 각(도), w: 믿을 만한 정도 0~1
  if (ORI.d == null) { ORI.d = cand; ORI.dn = w > 0.5 ? 1 : 0; return; }
  const err = wrap180(cand - ORI.d);
  if (!ORI.dn) { if (w > 0.5) { ORI.d = cand; ORI.dn = 1; } else ORI.d += err * 0.1; return; }
  w *= clamp((45 - ORI.rate) / 30, 0, 1); // 폰을 돌리는 중(1초에 45° 넘게)엔 나침반이 늦게 따라와 값이 틀리다. 멈춘 뒤에만 북쪽을 고친다
  if (w <= 0) return;
  if (Math.abs(err) > 25) { if (++ORI.bad < 90) return; ORI.d = cand; ORI.bad = 0; return; }
  ORI.bad = Math.max(0, ORI.bad - 2);
  ORI.dn++;
  ORI.d += err * Math.max(0.008, 1 / ORI.dn) * w;
}
function setTarget() {
  const R = ORI.rel; if (!R || ORI.d == null) return;
  // 북쪽 보정값이 바뀌어도 화면은 한 번에 돌리지 않는다. 1초에 12°쯤까지만 따라가서 휙 넘어가는 일이 없게 한다
  if (ORI.ds == null) ORI.ds = ORI.d; else ORI.ds += clamp(wrap180(ORI.d - ORI.ds) * 0.04, -0.2, 0.2);
  const t = (ORI.ds - magDecl() - AR.offset) * rad, c = Math.cos(t), s = Math.sin(t);
  ORI.target = [c * R[0] - s * R[3], c * R[1] - s * R[4], c * R[2] - s * R[5], s * R[0] + c * R[3], s * R[1] + c * R[4], s * R[2] + c * R[5], R[6], R[7], R[8]];
}
function onOrient(e) {
  if (e.alpha == null || e.beta == null) return;
  const R = rotation(e.alpha, e.beta, e.gamma), hc = e.webkitCompassHeading;
  { // 지금 폰이 얼마나 빨리 돌고 있나(도/초). 올라갈 땐 바로, 내려갈 땐 0.3초쯤 걸려 내려온다(나침반이 늦게 따라오는 만큼 기다림)
    const now = performance.now(), P = ORI.pR;
    if (P && !e.absolute) {
      let tr = 0; for (let i = 0; i < 9; i++) tr += P[i] * R[i];
      const dt = clamp((now - ORI.pT) / 1000, 0.004, 0.1), v = Math.acos(clamp((tr - 1) / 2, -1, 1)) / rad / dt;
      ORI.rate = Math.max(v, ORI.rate * 0.94);
    }
    if (!e.absolute) { ORI.pR = R; ORI.pT = now; }
  }
  if (typeof hc === 'number') { // 아이폰: 알파는 자이로 기준, 나침반 값은 폰 윗변이 가리키는 방위
    ORI.rel = R; ORI.relT = performance.now();
    if (hc >= 0 && !(e.webkitCompassAccuracy < 0)) northFix(Math.atan2(R[1], R[4]) / rad - hc, clamp((R[8] - 0.1) / 0.25, 0, 1));
  } else if (e.absolute || !HAS_ABS) { ORI.rel = R; ORI.relT = performance.now(); ORI.d = 0; ORI.dn = 1; } // 이미 북쪽 기준으로 오는 기기
  else { // 안드로이드: 이 값은 자이로 기준, 북쪽은 onOrientAbs가 맞춘다
    if (ORI.absOnly) { ORI.absOnly = false; ORI.d = ORI.ds = null; ORI.dn = 0; ORI.bad = 0; }
    ORI.rel = R; ORI.relT = performance.now();
  }
  setTarget();
}
function onOrientAbs(e) {
  if (e.alpha == null || e.beta == null) return;
  const A = rotation(e.alpha, e.beta, e.gamma), R = ORI.rel, now = performance.now();
  if (!R || ORI.absOnly || now - ORI.relT > 400) { // 자이로 기준 값이 안 오는 기기는 예전처럼 이 값을 그대로 쓴다
    ORI.absOnly = true; ORI.rel = A; ORI.d = 0; ORI.dn = 1; setTarget(); return;
  }
  const q0 = A[0] * R[0] + A[1] * R[1] + A[2] * R[2], q1 = A[0] * R[3] + A[1] * R[4] + A[2] * R[5];
  const q3 = A[3] * R[0] + A[4] * R[1] + A[5] * R[2], q4 = A[3] * R[3] + A[4] * R[4] + A[5] * R[5];
  northFix(Math.atan2(q3 - q1, q0 + q4) / rad, 1);
}
function oriStep() { // 프레임마다 부드럽게 따라가기
  if (!ORI.target) return null;
  if (!ORI.M) ORI.M = ORI.target.slice();
  else {
    let diff = 0; for (let i = 0; i < 9; i++) diff = Math.max(diff, Math.abs(ORI.target[i] - ORI.M[i]));
    const k = clamp(0.1 + diff * 3.5, 0.1, 0.3);
    for (let i = 0; i < 9; i++) ORI.M[i] += (ORI.target[i] - ORI.M[i]) * k;
  }
  return ORI.M;
}
// W3C 기기 방향 → 회전행렬(기기 좌표 → 땅 좌표: x 동, y 북, z 위)
function rotation(a, b, g) {
  a *= rad; b *= rad; g *= rad;
  const cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b), cG = Math.cos(g), sG = Math.sin(g);
  return [cA * cG - sA * sB * sG, -sA * cB, cA * sG + sA * sB * cG,
          sA * cG + cA * sB * sG, cA * cB, sA * sG - cA * sB * cG,
          -cB * sG, sB, cB * cG];
}
const camHeading = M => (Math.atan2(-M[2], -M[5]) / rad + 360) % 360;            // 뒷면 카메라가 보는 방위
const camPitch = M => Math.asin(clamp(-M[8], -1, 1)) / rad;                         // 위로 들면 +
// 나침반이 보는 쪽: 세우면 뒷면 카메라 쪽, 눕히면 화면 위쪽. 둘 사이는 기울기에 따라 이어 붙여서 문턱에서 튀지 않게 한다
function viewHeading(M) {
  const o = (screen.orientation?.angle ?? window.orientation ?? 0) * rad, so = Math.sin(o), co = Math.cos(o), sg = M[8] < 0 ? -1 : 1;
  const tx = sg * (so * M[0] + co * M[1]), ty = sg * (so * M[3] + co * M[4]), tl = Math.hypot(tx, ty) || 1, cl = Math.hypot(M[2], M[5]) || 1;
  const k = clamp((Math.abs(M[8]) - 0.5) / 0.35, 0, 1), w = k * k * (3 - 2 * k);
  return (Math.atan2(w * tx / tl - (1 - w) * M[2] / cl, w * ty / tl - (1 - w) * M[5] / cl) / rad + 360) % 360;
}

// ───────── AR ─────────
$('#arGo').addEventListener('click', startAR);
async function startAR() {
  if (!(await askOrientation())) { toast('나침반 권한이 있어야 해요'); return; }
  try {
    if (!navigator.mediaDevices?.getUserMedia) { toast('이 브라우저는 카메라를 못 써요'); return; }
    AR.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  } catch {
    toast(location.protocol === 'https:' || location.hostname === 'localhost' ? '카메라 권한을 확인해 주세요' : 'AR은 https 주소에서만 돼요');
    return;
  }
  const v = $('#arVideo'); v.srcObject = AR.stream; try { await v.play(); } catch { /* 자동 재생 막힘 */ }
  useOrientation('ar', true);
  AR.lat = state.lat; AR.lng = state.lng; AR.path = sampleDay(AR.lat, AR.lng, 4);
  getPos().then(p => { AR.lat = p.lat; AR.lng = p.lng; AR.path = sampleDay(p.lat, p.lng, 4); }).catch(() => toast('위치 권한이 없어 지도 가운데 기준으로 보여요'));
  $('#arStart').hidden = true; $('#arHud').hidden = false;
  AR.raf = requestAnimationFrame(drawAR);
}
function stopAR() {
  cancelAnimationFrame(AR.raf);
  useOrientation('ar', false);
  AR.stream?.getTracks().forEach(t => t.stop()); AR.stream = null;
  AR.calibrating = false; $('#arCal').classList.remove('on'); $('#arCal').textContent = '해에 맞추기';
}
function drawAR() {
  AR.raf = requestAnimationFrame(drawAR);
  const cv = $('#arFx'); const { ctx, w, h } = resizeCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  const M = oriStep();
  if (!M) { pill(ctx, w / 2, h * 0.35, '나침반 기다리는 중', { h: 30, font: `600 14px ${NUM}` }); return; }
  const v = $('#arVideo'), vw = v.videoWidth || 1080, vh = v.videoHeight || 1920;
  const f = (Math.max(vw, vh) / 2) / Math.tan(AR.fovLong / 2 * rad) * Math.max(w / vw, h / vh);
  const o = (screen.orientation?.angle ?? window.orientation ?? 0) * rad, co = Math.cos(o), so = Math.sin(o);
  const cx = w / 2, cy = h / 2;
  const proj = (az, alt) => {
    const wx = Math.sin(az * rad) * Math.cos(alt * rad), wy = Math.cos(az * rad) * Math.cos(alt * rad), wz = Math.sin(alt * rad);
    const dx = M[0] * wx + M[3] * wy + M[6] * wz, dy = M[1] * wx + M[4] * wy + M[7] * wz, dz = M[2] * wx + M[5] * wy + M[8] * wz;
    const sx = dx * co - dy * so, sy = dx * so + dy * co, depth = -dz;
    if (depth < 0.05) return { ok: false, sx, sy };
    return { ok: true, x: cx + f * sx / depth, y: cy - f * sy / depth, sx, sy };
  };
  const vis = p => p.ok && p.x > -40 && p.x < w + 40 && p.y > -40 && p.y < h + 40;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // 지평선과 방위 알약
  ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1.5;
  line(ctx, Array.from({ length: 181 }, (_, i) => proj(i * 2, 0)), w, h);
  for (let a = 0; a < 360; a += 15) {
    const p = proj(a, 0); if (!vis(p)) continue;
    if (a % 45 === 0) pill(ctx, p.x, p.y, compassName(a), { bg: 'rgba(18,18,20,.72)', font: `700 13px ${NUM}`, h: 26 });
    else pill(ctx, p.x, p.y, `${a}°`, { bg: 'rgba(18,18,20,.42)' });
  }
  const sun = sunPosition(selected(), AR.lat, AR.lng);
  const sh = proj(sun.azimuth, 0);
  if (vis(sh)) { ctx.fillStyle = SUN; ctx.beginPath(); ctx.arc(sh.x, sh.y, 7, 0, Math.PI * 2); ctx.fill(); }

  // 하루 해 길
  const pts = AR.path.filter(s => s.alt > -2).map(s => ({ ...s, p: proj(s.az, s.alt) }));
  ctx.globalAlpha = 0.92; ctx.lineWidth = 7;
  ctx.strokeStyle = PATH_Y; segLine(ctx, pts, () => true, w, h);
  ctx.strokeStyle = GOLD; segLine(ctx, pts, s => s.alt < 6, w, h);
  ctx.globalAlpha = 1;
  for (const s of pts) {
    if (s.m % 60 || !vis(s.p) || Math.abs(s.m - state.min) < 25) continue;
    ctx.fillStyle = s.alt < 6 ? GOLD : PATH_Y; ctx.beginPath(); ctx.arc(s.p.x, s.p.y, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#191a1c'; ctx.font = `700 14px ${NUM}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(s.m / 60), s.p.x, s.p.y + 0.5);
  }

  // 고른 시각의 해
  const sp = proj(sun.azimuth, sun.altitude);
  if (sp.ok && sp.x > 0 && sp.x < w && sp.y > 0 && sp.y < h) {
    const g = ctx.createRadialGradient(sp.x, sp.y, 10, sp.x, sp.y, 56);
    g.addColorStop(0, 'rgba(255,122,26,.55)'); g.addColorStop(1, 'rgba(255,122,26,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sp.x, sp.y, 56, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = SUN; ctx.beginPath(); ctx.arc(sp.x, sp.y, 24, 0, Math.PI * 2); ctx.fill();
    pill(ctx, sp.x, sp.y - 44, hm(selected()), { bg: 'rgba(18,18,20,.72)', font: `700 13px ${NUM}`, h: 26 });
  } else sunArrow(ctx, w, h, sp, sun.altitude > 0 ? `해 ${hm(selected())}` : '해 진 시각');

  // 가운데 조준: 방위 · 기울기
  const heading = camHeading(M), pitch = camPitch(M);
  ctx.fillStyle = 'rgba(18,18,20,.42)'; ctx.strokeStyle = AR.calibrating ? SUN : 'rgba(255,255,255,.28)'; ctx.lineWidth = AR.calibrating ? 2 : 1;
  ctx.beginPath(); ctx.arc(cx, cy, 46, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  if (AR.calibrating) { ctx.beginPath(); ctx.moveTo(cx - 60, cy); ctx.lineTo(cx - 30, cy); ctx.moveTo(cx + 30, cy); ctx.lineTo(cx + 60, cy); ctx.moveTo(cx, cy - 60); ctx.lineTo(cx, cy - 30); ctx.moveTo(cx, cy + 30); ctx.lineTo(cx, cy + 60); ctx.stroke(); }
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 16px ${NUM}`; ctx.fillText(`${Math.round(heading)}°`, cx, cy - 9);
  ctx.font = `500 12.5px ${NUM}`; ctx.fillStyle = 'rgba(255,255,255,.78)'; ctx.fillText(`${compassName(heading)} · ${Math.round(pitch)}°`, cx, cy + 12);
  put('#arHeading', `진북 기준${AR.offset ? ` · 보정 ${AR.offset > 0 ? '+' : ''}${Math.round(AR.offset)}°` : ''}`);
}
function line(ctx, ps, w, h) {
  ctx.beginPath(); let on = false;
  for (const p of ps) { if (p.ok && Math.abs(p.x) < w * 4 && Math.abs(p.y) < h * 4) { on ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); on = true; } else on = false; }
  ctx.stroke();
}
function segLine(ctx, pts, keep, w, h) {
  ctx.beginPath(); let on = false;
  for (const s of pts) { const p = s.p; if (keep(s) && p.ok && Math.abs(p.x) < w * 4 && Math.abs(p.y) < h * 4) { on ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); on = true; } else on = false; }
  ctx.stroke();
}
// 해에 맞추기: 가운데 원을 실제 해에 맞추고 한 번 더 누르면 나침반 오차를 고친다
$('#arCal').addEventListener('click', () => {
  if (!AR.calibrating) {
    AR.calibrating = true; $('#arCal').classList.add('on'); $('#arCal').textContent = '맞췄어요';
    toast('가운데 원을 실제 해에 맞추고 버튼을 누르세요'); return;
  }
  AR.calibrating = false; $('#arCal').classList.remove('on'); $('#arCal').textContent = '해에 맞추기';
  if (!ORI.M) return;
  const real = sunPosition(new Date(), AR.lat, AR.lng);
  if (real.altitude < 0) { toast('지금은 해가 없어서 맞출 수 없어요'); return; }
  let d = real.azimuth - camHeading(ORI.M); d = ((d + 540) % 360) - 180;
  AR.offset = ((AR.offset + d + 540) % 360) - 180;
  localStorage.setItem('haegil.offset', AR.offset); ORI.M = null;
  toast(`나침반을 ${d > 0 ? '+' : ''}${Math.round(d)}° 고쳤어요`);
});
// 옆으로 끌어 미세 보정, 두 번 톡 치면 보정 지우기
let dragX = null, lastTap = 0;
$('#arFx').addEventListener('pointerdown', e => {
  dragX = e.clientX;
  const t = Date.now(); if (t - lastTap < 300) { AR.offset = 0; localStorage.setItem('haegil.offset', 0); ORI.M = null; toast('보정을 지웠어요'); } lastTap = t;
});
$('#arFx').addEventListener('pointermove', e => {
  if (dragX == null) return;
  const dx = e.clientX - dragX; dragX = e.clientX;
  AR.offset -= dx * (AR.fovLong * 0.75) / $('#arFx').clientWidth; localStorage.setItem('haegil.offset', AR.offset);
});
addEventListener('pointerup', () => { dragX = null; });
// 사진 저장: 카메라 화면 + 해 길 + 아래 정보 한 줄
$('#arShot').addEventListener('click', () => {
  const v = $('#arVideo'), fx = $('#arFx');
  if (!v.videoWidth) return;
  const c = document.createElement('canvas'); c.width = fx.width; c.height = fx.height;
  const x = c.getContext('2d'), s = Math.max(c.width / v.videoWidth, c.height / v.videoHeight);
  const dw = v.videoWidth * s, dh = v.videoHeight * s;
  x.drawImage(v, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
  x.drawImage(fx, 0, 0);
  const k = c.width / fx.clientWidth, sun = sunPosition(selected(), AR.lat, AR.lng);
  const d = state.day, cap = `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${hm(selected())}  ·  해 ${Math.round(sun.azimuth)}° ${compassName(sun.azimuth)} / 고도 ${Math.round(sun.altitude)}°  ·  ${AR.lat.toFixed(5)}, ${AR.lng.toFixed(5)}`;
  let fs = 13 * k, tw;
  do { x.font = `600 ${fs}px ${NUM}`; tw = x.measureText(cap).width; fs *= 0.94; } while (tw > c.width - 60 * k && fs > 7 * k);
  roundRect(x, 16 * k, c.height - 52 * k, tw + 28 * k, 34 * k, 17 * k); x.fillStyle = 'rgba(18,18,20,.72)'; x.fill();
  x.fillStyle = '#fff'; x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillText(cap, 30 * k, c.height - 35 * k);
  const name = `${APP}_${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${hm(selected()).replace(':', '')}.png`;
  c.toBlob(async b => {
    const file = new File([b], name, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: APP }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click();
    toast('사진을 저장했어요');
  }, 'image/png');
});

// ───────── 나침반: 검은 바탕, 내 자리, 하루 해 ─────────
const CP = { yaw: 180, pitch: 36, dist: 640, follow: false, raf: 0, queued: false, R: 150 };
function requestCmp() {
  if (state.mode !== 'cmp' || CP.queued || CP.follow) return;
  CP.queued = true; requestAnimationFrame(() => { CP.queued = false; drawCmp(); });
}
function loopCmp() { CP.raf = requestAnimationFrame(loopCmp); drawCmp(); }
function drawCmp() {
  const { ctx, w, h } = resizeCanvas($('#cmpCv'));
  if (CP.follow) { const M = oriStep(); if (M) VIEW.yaw = CP.yaw = (viewHeading(M) + 360) % 360; }
  ctx.fillStyle = '#0b0b0c'; ctx.fillRect(0, 0, w, h);
  const left = LAY.side, bottom = LAY.bottom;
  const cx = left + (w - left) / 2, cy = (h - bottom) / 2 + 44;
  const F = Math.min(w - left, h - bottom - 60) * 1.62;
  const R = CP.R, ps = CP.yaw * rad, ph = CP.pitch * rad;
  const f = [Math.sin(ps) * Math.cos(ph), Math.cos(ps) * Math.cos(ph), -Math.sin(ph)];
  const r = [Math.cos(ps), -Math.sin(ps), 0];
  const u = [Math.sin(ps) * Math.sin(ph), Math.cos(ps) * Math.sin(ph), Math.cos(ph)];
  const C = [-f[0] * CP.dist, -f[1] * CP.dist, 26 - f[2] * CP.dist];
  const P = (x, y, z) => {
    const vx = x - C[0], vy = y - C[1], vz = z - C[2], zc = vx * f[0] + vy * f[1] + vz * f[2];
    return [cx + F * (vx * r[0] + vy * r[1]) / zc, cy - F * (vx * u[0] + vy * u[1] + vz * u[2]) / zc, zc];
  };
  const G = (az, rr, z = 0) => P(rr * Math.sin(az * rad), rr * Math.cos(az * rad), z);
  const sun = sunNow(), up = sun.altitude > 0;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // 바닥 원
  ctx.beginPath(); for (let i = 0; i <= 120; i++) { const [x, y] = G(i * 3, R); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath();
  ctx.fillStyle = '#1b1b1e'; ctx.fill(); ctx.strokeStyle = '#4a4a50'; ctx.lineWidth = 1.2; ctx.stroke();
  for (const rr of [R / 3, R * 2 / 3]) { ctx.beginPath(); for (let i = 0; i <= 90; i++) { const [x, y] = G(i * 4, rr); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1; ctx.stroke(); }
  ctx.strokeStyle = '#56565c'; ctx.lineWidth = 1;
  for (let a = 0; a < 360; a += 5) { const [x1, y1] = G(a, R * (a % 15 ? 0.975 : 0.95)), [x2, y2] = G(a, R); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let a = 0; a < 360; a += 15) {
    const [x, y] = G(a, R * 0.875);
    if (a % 90 === 0) { ctx.font = `700 16px ${NUM}`; ctx.fillStyle = a ? '#fff' : SUN; ctx.fillText(compassName(a), x, y); }
    else if (a % 45 === 0) { ctx.font = `600 12px ${NUM}`; ctx.fillStyle = '#a9a9ae'; ctx.fillText(compassName(a), x, y); }
    else { ctx.font = `500 10.5px ${NUM}`; ctx.fillStyle = '#6a6a70'; ctx.fillText(String(a), x, y); }
  }
  // 로드뷰에서 보는 범위(보는 쪽이 늘 화면 위쪽)
  {
    const fov = Math.min(SC.scene?.S.cam?.fovH || 62, 120), [x0, y0] = P(0, 0, 0);
    ctx.beginPath(); ctx.moveTo(x0, y0);
    for (let i = 0; i <= 24; i++) { const [x, y] = G(CP.yaw - fov / 2 + fov * i / 24, R); ctx.lineTo(x, y); }
    ctx.closePath(); ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fill();
    const [ax, ay] = G(CP.yaw, R * 1.035), [bx, by] = G(CP.yaw - 2.6, R * 1.1), [cx2, cy2] = G(CP.yaw + 2.6, R * 1.1);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx2, cy2); ctx.closePath(); ctx.fill();
  }
  // 일출 · 일몰 방향
  const ray = (az, color, width, dash) => { const [x0, y0] = P(0, 0, 0), [x1, y1] = G(az, R); ctx.setLineDash(dash || []); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.setLineDash([]); };
  const T = state.times;
  ctx.font = `600 11px ${NUM}`;
  if (T?.sunrise && T?.sunset) for (const [d, name] of [[T.sunrise, '일출'], [T.sunset, '일몰']]) {
    const az = sunPosition(d, state.lat, state.lng).azimuth; ray(az, 'rgba(255,154,61,.6)', 1.4, [3, 5]);
    const [x, y] = G(az, R * 1.2); ctx.fillStyle = 'rgba(255,190,120,.9)'; ctx.fillText(`${name} ${hm(d)}`, clamp(x, left + 52, w - 52), y + 16);
  }
  // 가운데 막대와 그 그림자: 길이와 방향이 그대로 보인다
  const pole = 30, [ox, oy] = P(0, 0, 0);
  if (sun.altitude > 0.5) {
    const L = Math.min(pole / Math.tan(sun.altitude * rad), R * 0.96), [sx, sy] = G(sun.azimuth + 180, L);
    ctx.strokeStyle = 'rgba(0,0,0,.72)'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(sx, sy); ctx.stroke();
    ray(sun.azimuth, SUN, 2.2);
  }
  // 하지 · 동지 해 길(계절 비교)
  ctx.font = `600 11px ${NUM}`;
  for (const se of state.season) {
    if (Math.abs(se.day - state.day) < 6 * 864e5) continue;
    ctx.setLineDash([2, 6]); ctx.strokeStyle = 'rgba(255,255,255,.36)'; ctx.lineWidth = 1.4; ctx.beginPath(); let on = false, hi = null;
    for (const p of se.pts) {
      if (p.alt <= 0) { on = false; continue; }
      const q = G(p.az, R * Math.cos(p.alt * rad), R * Math.sin(p.alt * rad)); if (q[2] <= 1) { on = false; continue; }
      on ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); on = true; if (!hi || p.alt > hi.alt) hi = { alt: p.alt, q };
    }
    ctx.stroke(); ctx.setLineDash([]);
    if (hi) { ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillText(se.name, hi.q[0], hi.q[1] - 12); }
  }
  // 하늘의 해 길(먼 쪽은 옅게)
  const zc0 = P(0, 0, 0)[2];
  const sky = state.path.filter(s => s.alt > -1).map(s => { const ca = Math.cos(s.alt * rad); return { ...s, q: G(s.az, R * ca, R * Math.sin(s.alt * rad)) }; });
  for (const far of [true, false]) for (const [col, keep] of [[PATH_Y, () => true], [GOLD, s => s.alt < 6]]) {
    ctx.strokeStyle = col; ctx.lineWidth = 3.4; ctx.globalAlpha = far ? 0.6 : 1; ctx.beginPath(); let on = false;
    for (const s of sky) { if (keep(s) && (s.q[2] > zc0) === far && s.q[2] > 1) { on ? ctx.lineTo(s.q[0], s.q[1]) : ctx.moveTo(s.q[0], s.q[1]); on = true; } else on = false; }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.font = `700 12.5px ${NUM}`;
  for (const s of sky) {
    if (s.m % 60 || s.alt <= 0 || s.q[2] <= 1) continue;
    ctx.fillStyle = '#0b0b0c'; ctx.beginPath(); ctx.arc(s.q[0], s.q[1], 5.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = s.alt < 6 ? GOLD : PATH_Y; ctx.beginPath(); ctx.arc(s.q[0], s.q[1], 3.8, 0, Math.PI * 2); ctx.fill();
    if (Math.abs(s.m - state.min) > 40) ctx.fillText(String(s.m / 60), s.q[0], s.q[1] - 14);
  }
  // 막대
  const [tx, ty] = P(0, 0, pole);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(tx, ty); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(tx, ty, 4.5, 0, Math.PI * 2); ctx.fill();
  // 고른 시각의 해
  if (sun.altitude > -1) {
    const ca = Math.cos(sun.altitude * rad), q = G(sun.azimuth, R * ca, R * Math.sin(Math.max(sun.altitude, 0) * rad));
    ctx.strokeStyle = 'rgba(255,201,77,.4)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(q[0], q[1]); ctx.stroke();
    const g = ctx.createRadialGradient(q[0], q[1], 6, q[0], q[1], 44); g.addColorStop(0, 'rgba(255,122,26,.5)'); g.addColorStop(1, 'rgba(255,122,26,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(q[0], q[1], 44, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = SUN; ctx.beginPath(); ctx.arc(q[0], q[1], 15, 0, Math.PI * 2); ctx.fill();
    pill(ctx, q[0], q[1] - 32, hm(selected()), { bg: 'rgba(255,255,255,.16)', font: `700 13px ${NUM}`, h: 26 });
  } else {
    const [x, y] = G(sun.azimuth, R * 1.0);
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.stroke();
    pill(ctx, x, y - 24, '해 진 쪽', { bg: 'rgba(255,255,255,.12)' });
  }
  put('#cmpHead', `${Math.round(CP.yaw) % 360}° ${compassName(CP.yaw)}`);
}
{
  const el = $('#cmpCv'), ps = new Map();
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); ps.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
  el.addEventListener('pointermove', e => {
    const prev = ps.get(e.pointerId); if (!prev) return;
    if (ps.size === 2) {
      const [a, b] = [...ps.values()], d0 = Math.hypot(a.x - b.x, a.y - b.y);
      ps.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a2, b2] = [...ps.values()], d1 = Math.hypot(a2.x - b2.x, a2.y - b2.y);
      if (d0 && d1) CP.dist = clamp(CP.dist * d0 / d1, 320, 1200);
    } else {
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      if (Math.abs(dx) > 3 && CP.follow) { VIEW.live = false; setFollowC(false); }
      if (!CP.follow && dx) VIEW.yaw = CP.yaw = (CP.yaw - dx * 0.35 + 360) % 360;
      CP.pitch = clamp(CP.pitch + dy * 0.25, 10, 86);
      ps.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    requestCmp();
  });
  for (const ev of ['pointerup', 'pointercancel']) el.addEventListener(ev, e => ps.delete(e.pointerId));
  el.addEventListener('wheel', e => { e.preventDefault(); CP.dist = clamp(CP.dist * (e.deltaY > 0 ? 1.08 : 0.93), 320, 1200); requestCmp(); }, { passive: false });
}
async function setFollowC(on, quiet) {
  if (on) {
    if (!(await askOrientation())) { if (!quiet) toast('나침반 권한이 있어야 해요'); return; }
    if (state.mode !== 'cmp') return;
    useOrientation('cmp', true); CP.follow = true; VIEW.live = true; cancelAnimationFrame(CP.raf); loopCmp();
  } else if (CP.follow) { CP.follow = false; cancelAnimationFrame(CP.raf); useOrientation('cmp', false); requestCmp(); }
  $('#cmpFollow').classList.toggle('on', CP.follow);
}
$('#cmpFollow').addEventListener('click', () => { if (CP.follow) VIEW.live = false; setFollowC(!CP.follow); });
function openCompass() {
  $('#cmpSub').textContent = '지도에서 고른 자리 기준 · ◎를 누르면 내 위치';
  if (VIEW.yaw != null) CP.yaw = VIEW.yaw; // 로드뷰에서 보던 방향 그대로
  requestCmp();
  // 폰이면 바로 폰 방향을 따라 돈다(탭을 누른 손짓으로 권한을 받는다. 안 되면 버튼으로). 로드뷰에서 손으로 돌려 본 방향이 있으면 그 방향을 지킨다
  if ((VIEW.yaw == null || VIEW.live) && matchMedia('(pointer: coarse)').matches && 'DeviceOrientationEvent' in window) setFollowC(true, true);
}

// ───────── 시작 ─────────
bodyClass();
$('#q').value = state.place?.name ?? '';
recomputeDay(); update(); save(); loadWx(); favBtn(); lensUI();
if (gotFavs != null) { history.replaceState(null, '', location.pathname); toast(gotFavs ? `찜 ${gotFavs}곳을 받았어요` : '이미 다 들어 있는 찜 목록이에요'); }
else if (!localStorage.getItem('haegil.hint2')) { localStorage.setItem('haegil.hint2', '1'); setTimeout(() => toast('지도를 누르면 그 자리로 · 가운데 점은 끌어서 옮겨요'), 1200); }
else if (!localStorage.getItem('haegil.hint3')) { localStorage.setItem('haegil.hint3', '1'); setTimeout(() => toast(coarse() ? '지도를 길게 누르면 바라볼 곳을 꽂아요' : '지도를 오른쪽 클릭하면 바라볼 곳을 꽂아요'), 1200); }
document.fonts?.ready.then(redraw);
document.fonts?.addEventListener?.('loadingdone', redraw); // 숫자 글꼴은 화면을 막지 않고 뒤늦게 온다
// 로드뷰를 처음 열 때 멈칫하지 않게, 쉬는 틈에 3D 그릴 준비를 미리 해 둔다
(window.requestIdleCallback || (f => setTimeout(f, 2500)))(() => {
  if (SC.scene || SC.fail) return;
  try { SC.scene = createScene($('#sc')); SC.scene.setPath(state.path); const s = sunNow(); SC.scene.setSun(s.azimuth, s.altitude); } catch { SC.scene = null; }
}, { timeout: 4000 });
