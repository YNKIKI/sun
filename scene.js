// 로드뷰 3D: 그 자리에 서서 보는 거리(하늘 · 땅 · 물 · 풀 · 길 · 건물 · 나무 · 그림자 · 해 길)
// 좌표: x 동, y 북, z 위(미터). 눈높이 1.7m.
import earcut from './vendor/earcut.js';

const rad = Math.PI / 180, STRIDE = 11, EYE = 1.7, FAR = 2000;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

class Buf {
  constructor(n, stride) { this.a = new Float32Array(n); this.n = 0; this.s = stride; }
  room(k) { if (this.n + k > this.a.length) { const t = new Float32Array(Math.max(this.a.length * 2, this.n + k)); t.set(this.a); this.a = t; } }
  v(x, y, z, nx, ny, nz, r, g, b, u, w) {
    this.room(11); const a = this.a, n = this.n;
    a[n] = x; a[n + 1] = y; a[n + 2] = z; a[n + 3] = nx; a[n + 4] = ny; a[n + 5] = nz; a[n + 6] = r; a[n + 7] = g; a[n + 8] = b; a[n + 9] = u; a[n + 10] = w;
    this.n = n + 11;
  }
  p(x, y, z) { this.room(3); const a = this.a, n = this.n; a[n] = x; a[n + 1] = y; a[n + 2] = z; this.n = n + 3; }
  q(x, y, z, r, g, b, al) { this.room(7); const a = this.a, n = this.n; a[n] = x; a[n + 1] = y; a[n + 2] = z; a[n + 3] = r; a[n + 4] = g; a[n + 5] = b; a[n + 6] = al; this.n = n + 7; }
  get count() { return this.n / this.s; }
  get data() { return this.a.subarray(0, this.n); }
}

const COL = {
  ground: [0.87, 0.85, 0.79], park: [0.62, 0.80, 0.50], wood: [0.47, 0.70, 0.42], grass: [0.72, 0.85, 0.56],
  water: [0.36, 0.64, 0.90], sand: [0.93, 0.87, 0.70], walk: [0.80, 0.79, 0.75], road: [0.60, 0.61, 0.64], path: [0.84, 0.80, 0.70],
  rail: [0.52, 0.50, 0.48], line: [0.96, 0.78, 0.26], trunk: [0.42, 0.33, 0.25],
};
const ROAD = { motorway: 18, trunk: 16, primary: 14, secondary: 11, tertiary: 8.5, minor: 6, service: 3.6, track: 2.6, path: 2, rail: 2.4, transit: 2.4, busway: 6, raceway: 8, pier: 3 };
const WALK = { trunk: 1, primary: 1, secondary: 1, tertiary: 1 };
const WALLS = [[0.91, 0.88, 0.81], [0.87, 0.85, 0.83], [0.83, 0.80, 0.75], [0.89, 0.83, 0.75], [0.81, 0.83, 0.85], [0.93, 0.91, 0.87], [0.86, 0.78, 0.66], [0.76, 0.70, 0.64], [0.90, 0.86, 0.76]];

// 하늘 · 빛: 해 고도에 따라
const ENV = [
  { a: -12, z: [0.03, 0.05, 0.11], h: [0.08, 0.11, 0.19], am: [0.17, 0.20, 0.30], su: [0, 0, 0] },
  { a: -5, z: [0.10, 0.16, 0.33], h: [0.36, 0.38, 0.52], am: [0.30, 0.33, 0.45], su: [0, 0, 0] },
  { a: -1, z: [0.20, 0.30, 0.52], h: [0.95, 0.60, 0.40], am: [0.42, 0.42, 0.50], su: [0.10, 0.06, 0.03] },
  { a: 3, z: [0.30, 0.47, 0.74], h: [0.99, 0.78, 0.55], am: [0.44, 0.44, 0.52], su: [0.64, 0.40, 0.20] },
  { a: 10, z: [0.27, 0.52, 0.86], h: [0.80, 0.88, 0.95], am: [0.50, 0.53, 0.61], su: [0.56, 0.47, 0.34] },
  { a: 30, z: [0.22, 0.50, 0.88], h: [0.74, 0.86, 0.96], am: [0.53, 0.57, 0.64], su: [0.50, 0.46, 0.39] },
];
function envAt(alt) {
  if (alt <= ENV[0].a) return ENV[0];
  for (let i = 1; i < ENV.length; i++) {
    if (alt <= ENV[i].a) {
      const A = ENV[i - 1], B = ENV[i], t = (alt - A.a) / (B.a - A.a), m = k => A[k].map((v, j) => lerp(v, B[k][j], t));
      return { z: m('z'), h: m('h'), am: m('am'), su: m('su') };
    }
  }
  return ENV[ENV.length - 1];
}

const VS_SKY = `attribute vec2 p; varying vec2 v; void main(){ v = p; gl_Position = vec4(p, 0.9999, 1.0); }`;
const FS_SKY = `precision highp float;
varying vec2 v; uniform vec3 uF, uR, uU, uSun, uZen, uHor; uniform vec2 uT; uniform float uOn;
void main(){
  vec3 d = normalize(uF + uR * v.x * uT.x + uU * v.y * uT.y);
  vec3 c = mix(uHor, uZen, pow(max(d.z, 0.0), 0.5));
  float a = length(d - uSun);
  c += vec3(1.0, 0.72, 0.42) * (exp(-a * 5.0) * 0.30 + exp(-a * 26.0) * 0.55) * uOn;
  c = mix(c, vec3(1.0, 0.97, 0.90), smoothstep(0.024, 0.017, a) * uOn);
  gl_FragColor = vec4(c, 1.0);
}`;
const VS_LIT = `attribute vec3 aP; attribute vec3 aN; attribute vec3 aC; attribute vec2 aUV;
uniform mat4 uVP; uniform vec3 uEye; varying vec3 vN; varying vec3 vC; varying vec2 vUV; varying vec3 vR;
void main(){ vN = aN; vC = aC; vUV = aUV; vR = aP - uEye; gl_Position = uVP * vec4(aP, 1.0); }`;
const FS_LIT = `precision highp float;
varying vec3 vN; varying vec3 vC; varying vec2 vUV; varying vec3 vR;
uniform vec3 uSun, uSunCol, uAmb, uFog; uniform float uNight; uniform vec2 uFogR;
void main(){
  float vD = length(vR);
  float l = max(dot(normalize(vN), uSun), 0.0);
  vec3 n = normalize(vN);
  vec3 light = uAmb * (0.86 + 0.14 * n.z) + uSunCol * (l + 0.30 * n.z * (1.0 - l)) + uSunCol * 0.10 * (1.0 - n.z);
  vec3 c = vC * light;
  if (vUV.x > -0.5) {
    float far = 1.0 - smoothstep(90.0, 260.0, vD);
    vec2 g = vec2(vUV.x / 2.6, vUV.y / 3.3), f = fract(g);
    float r = fract(sin(dot(floor(g), vec2(12.9898, 78.233))) * 43758.5453);
    float shop = step(vUV.y, 3.3);
    // 위층 창 · 1층 가게 유리
    float w = step(0.17, f.x) * step(f.x, 0.83) * step(0.30, f.y) * step(f.y, 0.80);
    float s = step(0.06, f.x) * step(f.x, 0.94) * step(0.16, f.y) * step(f.y, 0.84);
    float glass = mix(w, s, shop) * far;
    vec3 gc = mix(vec3(0.17, 0.23, 0.31), uFog * 0.82, 0.30 + 0.38 * r) * (0.55 + 0.45 * length(light));
    c = mix(c, gc, glass * 0.92);
    // 층 사이 줄 · 창틀
    c *= 1.0 - 0.07 * step(f.y, 0.035) * far * (1.0 - shop);
    c = mix(c, vC * light * 1.06, w * step(f.y, 0.335) * (1.0 - shop) * far);
    // 가게 간판 띠
    float sign = shop * step(0.86, f.y) * far;
    vec3 sc = 0.5 + 0.5 * cos(6.2832 * (r + vec3(0.0, 0.33, 0.67)));
    c = mix(c, mix(vec3(0.93, 0.91, 0.86), sc, 0.28) * light, sign * 0.85);
    c += vec3(1.0, 0.76, 0.44) * glass * (step(0.70, r) * (1.0 - shop) + shop * step(0.4, r) * 0.7) * uNight * 0.55;
  }
  gl_FragColor = vec4(mix(c, uFog, smoothstep(uFogR.x, uFogR.y, vD) * 0.84), 1.0);
}`;
const VS_SHD = `attribute vec3 aP; uniform mat4 uVP; uniform vec2 uD; uniform float uT; uniform vec3 uEye; varying vec3 vR;
void main(){ vec2 p = aP.xy + uD * min(aP.z * uT, 1500.0); vR = vec3(p, 0.0) - uEye; gl_Position = uVP * vec4(p, 0.0, 1.0); }`;
const FS_SHD = `precision highp float; varying vec3 vR; uniform vec4 uCol; uniform vec2 uFogR;
void main(){ float vD = length(vR); gl_FragColor = vec4(uCol.rgb, uCol.a * (1.0 - smoothstep(uFogR.x, uFogR.y, vD) * 0.86)); }`;
const VS_OBJ = `attribute vec3 aD; attribute vec4 aC; uniform mat4 uVP; uniform vec3 uEye; varying vec4 vC;
void main(){ vC = aC; gl_Position = uVP * vec4(uEye + aD * ${FAR}.0, 1.0); }`;
const FS_OBJ = `precision mediump float; varying vec4 vC; uniform float uA; void main(){ gl_FragColor = vec4(vC.rgb, vC.a * uA); }`;

function inPoly(p, n, x, y) {
  let c = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[2 * i], yi = p[2 * i + 1], xj = p[2 * j], yj = p[2 * j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const dirOf = (az, alt) => { const c = Math.cos(alt * rad); return [Math.sin(az * rad) * c, Math.cos(az * rad) * c, Math.sin(alt * rad)]; };

export function createScene(cv) {
  const gl = cv.getContext('webgl', { antialias: true, stencil: true, alpha: false, depth: true, powerPreference: 'high-performance' });
  if (!gl) return null;

  const mk = (vs, fs, attrs) => {
    const p = gl.createProgram();
    for (const [t, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    attrs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; p.u = n => u[n] ?? (u[n] = gl.getUniformLocation(p, n));
    return p;
  };
  const P_SKY = mk(VS_SKY, FS_SKY, ['p']), P_LIT = mk(VS_LIT, FS_LIT, ['aP', 'aN', 'aC', 'aUV']);
  const P_SHD = mk(VS_SHD, FS_SHD, ['aP']), P_OBJ = mk(VS_OBJ, FS_OBJ, ['aD', 'aC']);
  const B = { tri: gl.createBuffer(), flat: gl.createBuffer(), solid: gl.createBuffer(), shd: gl.createBuffer(), gnd: gl.createBuffer(), path: gl.createBuffer(), sun: gl.createBuffer() };
  gl.bindBuffer(gl.ARRAY_BUFFER, B.tri); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, B.gnd); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-6000, -6000, 0, 6000, -6000, 0, 6000, 6000, 0, -6000, -6000, 0, 6000, 6000, 0, -6000, 6000, 0]), gl.STATIC_DRAW);

  const S = { yaw: 180, pitch: 6, fovLong: 118, eye: [0, 0], az: 180, alt: 30, n: { flat: 0, solid: 0, shd: 0, path: 0, sun: 0 }, list: [], grid: new Map(), ready: false, cam: null };
  const attribs = n => { for (let i = 0; i < 4; i++) i < n ? gl.enableVertexAttribArray(i) : gl.disableVertexAttribArray(i); };

  // ── 자료 → 그릴 덩어리 ──
  function flatPoly(F, rings, c) {
    const flat = [], holes = [];
    for (const r of rings) { if (flat.length) holes.push(flat.length / 2); for (let i = 0; i < r.length; i++) flat.push(r[i]); }
    if (flat.length < 6) return;
    const idx = earcut(flat, holes.length ? holes : undefined);
    for (const i of idx) F.v(flat[2 * i], flat[2 * i + 1], 0, 0, 0, 1, c[0], c[1], c[2], -1, -1);
  }
  function strip(F, pts, hw, c, joints = true) {
    const n = pts.length / 2;
    for (let i = 0; i < n - 1; i++) {
      const ax = pts[2 * i], ay = pts[2 * i + 1], bx = pts[2 * i + 2], by = pts[2 * i + 3];
      const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy); if (len < 0.01) continue;
      const nx = -dy / len * hw, ny = dx / len * hw;
      const q = [ax + nx, ay + ny, ax - nx, ay - ny, bx - nx, by - ny, ax + nx, ay + ny, bx - nx, by - ny, bx + nx, by + ny];
      for (let k = 0; k < 12; k += 2) F.v(q[k], q[k + 1], 0, 0, 0, 1, c[0], c[1], c[2], -1, -1);
    }
    if (!joints) return;
    for (let i = 0; i < n; i++) {
      const x = pts[2 * i], y = pts[2 * i + 1];
      for (let k = 0; k < 6; k++) {
        const a0 = k * 60 * rad, a1 = (k + 1) * 60 * rad;
        F.v(x, y, 0, 0, 0, 1, c[0], c[1], c[2], -1, -1);
        F.v(x + Math.cos(a0) * hw, y + Math.sin(a0) * hw, 0, 0, 0, 1, c[0], c[1], c[2], -1, -1);
        F.v(x + Math.cos(a1) * hw, y + Math.sin(a1) * hw, 0, 0, 0, 1, c[0], c[1], c[2], -1, -1);
      }
    }
  }
  function tri(So, a, b, c, col) { // 면 법선으로 각지게
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const p of [a, b, c]) So.v(p[0], p[1], p[2], nx, ny, nz, col[0], col[1], col[2], -1, -1);
  }
  function tree(So, Sh, x, y, h, r, R) {
    const t = COL.trunk, tw = 0.10 + h * 0.008, th = h * 0.34, rot = R() * 60 * rad;
    for (let k = 0; k < 4; k++) {
      const a0 = k * 90 * rad, a1 = (k + 1) * 90 * rad;
      const p0 = [x + Math.cos(a0) * tw, y + Math.sin(a0) * tw], p1 = [x + Math.cos(a1) * tw, y + Math.sin(a1) * tw];
      tri(So, [p0[0], p0[1], 0], [p1[0], p1[1], 0], [p1[0], p1[1], th], t); tri(So, [p0[0], p0[1], 0], [p1[0], p1[1], th], [p0[0], p0[1], th], t);
      Sh.p(p0[0], p0[1], 0); Sh.p(p1[0], p1[1], 0); Sh.p(p1[0], p1[1], h * 0.55);
      Sh.p(p0[0], p0[1], 0); Sh.p(p1[0], p1[1], h * 0.55); Sh.p(p0[0], p0[1], h * 0.55);
    }
    const mix = R(), warm = R() < 0.14;
    const c0 = warm ? [0.78, 0.66, 0.30] : [lerp(0.33, 0.47, mix), lerp(0.55, 0.68, mix), lerp(0.28, 0.36, mix)];
    const rings = [[0.26, 0.42], [0.50, 1.0], [0.78, 0.70], [1.0, 0.0]], N = 6;
    const pt = (ri, k) => { k %= N; const a = rot + k * (360 / N) * rad, rr = rings[ri][1] * r * (0.9 + 0.2 * ((k * 7 + ri * 3) % 5) / 5); return [x + Math.cos(a) * rr, y + Math.sin(a) * rr, rings[ri][0] * h]; };
    for (let k = 0; k < N; k++) {
      tri(So, [x, y, h * 0.26], pt(0, k + 1), pt(0, k), c0);
      for (let ri = 0; ri < 2; ri++) { tri(So, pt(ri, k), pt(ri, k + 1), pt(ri + 1, k + 1), c0); tri(So, pt(ri, k), pt(ri + 1, k + 1), pt(ri + 1, k), c0); }
      tri(So, pt(2, k), pt(2, k + 1), [x, y, h], c0);
      // 그림자: 잎 덩어리를 눌러 놓은 원
      const a0 = k * 60 * rad, a1 = (k + 1) * 60 * rad, rs = r * 0.92, hz = h * 0.55;
      Sh.p(x, y, hz); Sh.p(x + Math.cos(a0) * rs, y + Math.sin(a0) * rs, hz); Sh.p(x + Math.cos(a1) * rs, y + Math.sin(a1) * rs, hz);
    }
  }

  function setData(d) {
    const F = new Buf(1 << 18, STRIDE), So = new Buf(1 << 20, STRIDE), Sh = new Buf(1 << 18, 3);
    const G = COL.ground;
    for (const [x, y] of [[-6000, -6000], [6000, -6000], [6000, 6000], [-6000, -6000], [6000, 6000], [-6000, 6000]]) F.v(x, y, 0, 0, 0, 1, G[0], G[1], G[2], -1, -1);
    const near = (r, lim) => { let mx = 1e9; for (let i = 0; i < r.length; i += 2) { const q = Math.abs(r[i]) + Math.abs(r[i + 1]); if (q < mx) mx = q; } return mx < lim; };
    for (const g of d.green) if (near(g.rings[0], 1400)) flatPoly(F, g.rings, COL[g.kind]);
    for (const w of d.water) if (near(w.rings[0], 2600)) flatPoly(F, w.rings, COL.water);
    const roads = d.roads.filter(r => ROAD[r.cls] && near(r.pts, 900));
    for (const r of roads) if (WALK[r.cls]) strip(F, r.pts, ROAD[r.cls] / 2 + 1.7, COL.walk);
    for (const r of roads) strip(F, r.pts, ROAD[r.cls] / 2, r.cls === 'path' || r.cls === 'track' || r.cls === 'pier' ? COL.path : r.cls === 'rail' || r.cls === 'transit' ? COL.rail : COL.road);
    for (const r of roads) if (WALK[r.cls] && near(r.pts, 320)) strip(F, r.pts, 0.13, COL.line, false);

    // 건물
    const list = [], grid = new Map();
    for (const b of d.buildings) {
      const p = b.p; let n = p.length / 2; if (n < 3) continue;
      let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, ar = 0;
      for (let i = 0; i < n; i++) { const j = (i + 1) % n, x = p[2 * i], y = p[2 * i + 1]; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; ar += x * p[2 * j + 1] - p[2 * j] * y; }
      const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2, dist = Math.hypot(cx, cy);
      if (dist > 1300 || (dist > 430 && b.h < 18)) continue;
      if (ar < 0) for (let i = 0, j = n - 1; i < j; i++, j--) { const tx = p[2 * i], ty = p[2 * i + 1]; p[2 * i] = p[2 * j]; p[2 * i + 1] = p[2 * j + 1]; p[2 * j] = tx; p[2 * j + 1] = ty; }
      const h = b.h, R = rng((Math.round(p[0] * 7) * 73856093) ^ (Math.round(p[1] * 7) * 19349663));
      let wc = WALLS[Math.floor(R() * WALLS.length)]; if (h < 13 && R() < 0.16) wc = [0.74, 0.54, 0.44];
      const rc = h < 16 && R() < 0.34 ? [0.46, 0.63, 0.52] : [wc[0] * 0.80, wc[1] * 0.80, wc[2] * 0.81];
      let u = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, ax = p[2 * i], ay = p[2 * i + 1], bx = p[2 * j], by = p[2 * j + 1];
        const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy); if (len < 0.05) continue;
        const nx = dy / len, ny = -dx / len, u1 = u + len;
        So.v(ax, ay, 0, nx, ny, 0, wc[0], wc[1], wc[2], u, 0); So.v(bx, by, 0, nx, ny, 0, wc[0], wc[1], wc[2], u1, 0); So.v(bx, by, h, nx, ny, 0, wc[0], wc[1], wc[2], u1, h);
        So.v(ax, ay, 0, nx, ny, 0, wc[0], wc[1], wc[2], u, 0); So.v(bx, by, h, nx, ny, 0, wc[0], wc[1], wc[2], u1, h); So.v(ax, ay, h, nx, ny, 0, wc[0], wc[1], wc[2], u, h);
        Sh.p(ax, ay, 0); Sh.p(bx, by, 0); Sh.p(bx, by, h); Sh.p(ax, ay, 0); Sh.p(bx, by, h); Sh.p(ax, ay, h);
        u = u1;
      }
      const idx = earcut(Array.from(p));
      for (const i of idx) So.v(p[2 * i], p[2 * i + 1], h, 0, 0, 1, rc[0], rc[1], rc[2], -1, -1);
      const it = { h, p, n, cx, cy, r: Math.hypot(maxx - minx, maxy - miny) / 2, minx, maxx, miny, maxy };
      list.push(it);
      if (dist < 470) for (let gx = Math.floor(minx / 40); gx <= Math.floor(maxx / 40); gx++) for (let gy = Math.floor(miny / 40); gy <= Math.floor(maxy / 40); gy++) {
        const k = gx * 4096 + gy; (grid.get(k) || grid.set(k, []).get(k)).push(it);
      }
    }
    S.list = list; S.grid = grid;

    // 나무: 풀 · 숲 안, 큰길 가
    const R = rng(20261118), taken = new Set(); let count = 0;
    const put = (x, y, h, r) => {
      if (count >= 1500 || x * x + y * y > 300 * 300 || x * x + y * y < 9) return;
      const k = Math.round(x / 3.6) * 8192 + Math.round(y / 3.6); if (taken.has(k)) return;
      if (inBuilding(x, y)) return;
      taken.add(k); tree(So, Sh, x, y, h, r, R); count++;
    };
    for (const r of roads) {
      if (!WALK[r.cls]) continue;
      const off = ROAD[r.cls] / 2 + 0.9, pts = r.pts, n = pts.length / 2; let carry = 5;
      for (let i = 0; i < n - 1; i++) {
        const ax = pts[2 * i], ay = pts[2 * i + 1], dx = pts[2 * i + 2] - ax, dy = pts[2 * i + 3] - ay, len = Math.hypot(dx, dy); if (len < 0.5) continue;
        for (let s = carry; s < len; s += 13) for (const side of [1, -1]) put(ax + dx / len * s - dy / len * off * side, ay + dy / len * s + dx / len * off * side, 5.2 + R() * 2, 1.5 + R() * 0.6);
        carry = (carry - len) % 13; if (carry < 0) carry += 13;
      }
    }
    for (const g of d.green) {
      if (g.kind === 'sand') continue;
      const o = g.rings[0], n = o.length / 2; let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
      for (let i = 0; i < n; i++) { minx = Math.min(minx, o[2 * i]); maxx = Math.max(maxx, o[2 * i]); miny = Math.min(miny, o[2 * i + 1]); maxy = Math.max(maxy, o[2 * i + 1]); }
      minx = Math.max(minx, -300); maxx = Math.min(maxx, 300); miny = Math.max(miny, -300); maxy = Math.min(maxy, 300);
      if (maxx <= minx || maxy <= miny) continue;
      const tries = Math.min(900, Math.ceil((maxx - minx) * (maxy - miny) / (g.kind === 'wood' ? 55 : g.kind === 'park' ? 150 : 420)));
      for (let t = 0; t < tries; t++) {
        const x = lerp(minx, maxx, R()), y = lerp(miny, maxy, R());
        if (inPoly(o, n, x, y)) put(x, y, 6.5 + R() * 5, 2.2 + R() * 1.4);
      }
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, B.flat); gl.bufferData(gl.ARRAY_BUFFER, F.data, gl.STATIC_DRAW); S.n.flat = F.count;
    gl.bindBuffer(gl.ARRAY_BUFFER, B.solid); gl.bufferData(gl.ARRAY_BUFFER, So.data, gl.STATIC_DRAW); S.n.solid = So.count;
    gl.bindBuffer(gl.ARRAY_BUFFER, B.shd); gl.bufferData(gl.ARRAY_BUFFER, Sh.data, gl.STATIC_DRAW); S.n.shd = Sh.count;
    S.ready = true; S.trees = count;
  }

  function inBuilding(x, y) {
    const c = S.grid.get(Math.floor(x / 40) * 4096 + Math.floor(y / 40)); if (!c) return false;
    for (const b of c) if (x >= b.minx && x <= b.maxx && y >= b.miny && y <= b.maxy && inPoly(b.p, b.n, x, y)) return true;
    return false;
  }
  // 이 자리에서 해가 건물에 가리는가
  function blocked(az, alt) {
    const ex = S.eye[0], ey = S.eye[1], sx = Math.sin(az * rad), sy = Math.cos(az * rad), tn = Math.tan(alt * rad);
    for (const b of S.list) {
      const dx = b.cx - ex, dy = b.cy - ey, t = dx * sx + dy * sy;
      if (t < -b.r || Math.abs(dx * sy - dy * sx) > b.r || 1.6 + Math.max(t - b.r, 0) * tn > b.h) continue;
      const p = b.p, n = b.n;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, ax = p[2 * i] - ex, ay = p[2 * i + 1] - ey, rx = p[2 * j] - ex - ax, ry = p[2 * j + 1] - ey - ay;
        const den = sx * ry - sy * rx; if (Math.abs(den) < 1e-9) continue;
        const tt = (ax * ry - ay * rx) / den, u = (ax * sy - ay * sx) / den;
        if (tt > 0 && u >= 0 && u <= 1 && 1.6 + tt * tn < b.h) return true;
      }
    }
    return false;
  }

  // ── 하늘의 해 길 ──
  // 원(r0 = 0) 또는 고리(r0 > 0). 고리로 쌓아야 건물 뒤로 비칠 때 색이 탁해지지 않는다
  function disc(Q, d, r, c, seg = 16, r0 = 0) {
    let e1 = [d[1], -d[0], 0]; const l = Math.hypot(e1[0], e1[1]) || 1; e1 = [e1[0] / l, e1[1] / l, 0];
    const e2 = [d[1] * e1[2] - d[2] * e1[1], d[2] * e1[0] - d[0] * e1[2], d[0] * e1[1] - d[1] * e1[0]];
    const at = (a, rr) => [d[0] + (e1[0] * Math.cos(a) + e2[0] * Math.sin(a)) * rr, d[1] + (e1[1] * Math.cos(a) + e2[1] * Math.sin(a)) * rr, d[2] + (e1[2] * Math.cos(a) + e2[2] * Math.sin(a)) * rr];
    const put = v => Q.q(v[0], v[1], v[2], c[0], c[1], c[2], c[3]);
    for (let k = 0; k < seg; k++) {
      const a0 = k / seg * Math.PI * 2, a1 = (k + 1) / seg * Math.PI * 2, p0 = at(a0, r), p1 = at(a1, r);
      if (!r0) { put(d); put(p0); put(p1); continue; }
      const q0 = at(a0, r0), q1 = at(a1, r0);
      put(q0); put(p0); put(p1); put(q0); put(p1); put(q1);
    }
  }
  function setPath(P) {
    const Q = new Buf(1 << 15, 7), hw = 0.0058, Y = [1, 0.76, 0.22, 1], Gd = [1, 0.56, 0.18, 1], DK = [0.07, 0.09, 0.16, 0.34];
    // 어두운 밑줄을 먼저 깔아 밝은 하늘 · 벽 위에서도 길이 또렷하게
    for (const [wd, col] of [[hw * 1.55, DK], [hw, null]]) for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1]; if (a.alt < -0.6 || b.alt < -0.6) continue;
      const d0 = dirOf(a.az, a.alt), d1 = dirOf(b.az, b.alt);
      const t = [d1[0] - d0[0], d1[1] - d0[1], d1[2] - d0[2]];
      let n = [d0[1] * t[2] - d0[2] * t[1], d0[2] * t[0] - d0[0] * t[2], d0[0] * t[1] - d0[1] * t[0]]; const l = Math.hypot(n[0], n[1], n[2]) || 1; n = n.map(v => v / l * wd);
      const c = col || ((a.alt + b.alt) / 2 < 6 ? Gd : Y);
      const v = [[d0[0] + n[0], d0[1] + n[1], d0[2] + n[2]], [d0[0] - n[0], d0[1] - n[1], d0[2] - n[2]], [d1[0] - n[0], d1[1] - n[1], d1[2] - n[2]], [d1[0] + n[0], d1[1] + n[1], d1[2] + n[2]]];
      for (const k of [0, 1, 2, 0, 2, 3]) Q.q(v[k][0], v[k][1], v[k][2], c[0], c[1], c[2], c[3]);
    }
    for (const s of P) {
      if (s.m % 60 || s.alt <= 0) continue;
      const d = dirOf(s.az, s.alt);
      disc(Q, d, 0.0212, DK, 16, 0.018); disc(Q, d, 0.018, [1, 1, 1, 1], 16, 0.0125); disc(Q, d, 0.0125, s.alt < 6 ? Gd : Y);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, B.path); gl.bufferData(gl.ARRAY_BUFFER, Q.data, gl.STATIC_DRAW); S.n.path = Q.count;
  }
  function setSun(az, alt) {
    S.az = az; S.alt = alt;
    const Q = new Buf(1 << 10, 7);
    // 해 원은 화면 위(2D)에서 늘 맨 앞에 그린다: 여기서는 자리만 기억
    gl.bindBuffer(gl.ARRAY_BUFFER, B.sun); gl.bufferData(gl.ARRAY_BUFFER, Q.data, gl.DYNAMIC_DRAW); S.n.sun = Q.count;
  }

  // ── 그리기 ──
  function camera(w, h) {
    const aspect = w / h, fl = aspect >= 1 ? 1 / Math.tan(S.fovLong / 2 * rad) * aspect : 1 / Math.tan(S.fovLong / 2 * rad);
    const ps = S.yaw * rad, ph = S.pitch * rad, cp = Math.cos(ph), sp = Math.sin(ph);
    const f = [Math.sin(ps) * cp, Math.cos(ps) * cp, sp], r = [Math.cos(ps), -Math.sin(ps), 0], u = [-Math.sin(ps) * sp, -Math.cos(ps) * sp, cp];
    const e = [S.eye[0], S.eye[1], EYE], N = 0.4, Fp = 6000;
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const p0 = fl / aspect, p5 = fl, p10 = (Fp + N) / (N - Fp), p14 = 2 * Fp * N / (N - Fp);
    const col = (x, y, z, wv) => [p0 * x, p5 * y, p10 * z + p14 * wv, -z];
    const vp = new Float32Array([...col(r[0], u[0], -f[0], 0), ...col(r[1], u[1], -f[1], 0), ...col(r[2], u[2], -f[2], 0), ...col(-dot(r, e), -dot(u, e), dot(f, e), 1)]);
    return { vp, f, r, u, e, fl, aspect, w, h, fovV: 2 * Math.atan(1 / fl) / rad, fovH: 2 * Math.atan(aspect / fl) / rad };
  }
  function draw() {
    // 크기는 앱이 재서 넘겨 준다(그릴 때마다 화면 배치를 다시 재지 않게). res: 움직이는 동안은 낮은 해상도
    const w = S.vw || cv.clientWidth, h = S.vh || cv.clientHeight; if (!w || !h) return null;
    const dpr = Math.min(devicePixelRatio || 1, S.res || 2), W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const c = S.cam = camera(w, h), env = envAt(S.alt), sun = dirOf(S.az, S.alt), up = S.alt > 0.3;
    gl.viewport(0, 0, W, H);
    gl.depthMask(true); gl.stencilMask(0xff); gl.colorMask(true, true, true, true);
    gl.clearColor(env.h[0], env.h[1], env.h[2], 1); gl.clearDepth(1); gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND); gl.disable(gl.STENCIL_TEST); gl.disable(gl.DEPTH_TEST); gl.depthMask(false);

    // 하늘
    gl.useProgram(P_SKY); gl.bindBuffer(gl.ARRAY_BUFFER, B.tri); attribs(1); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.uniform3fv(P_SKY.u('uF'), c.f); gl.uniform3fv(P_SKY.u('uR'), c.r); gl.uniform3fv(P_SKY.u('uU'), c.u);
    gl.uniform2f(P_SKY.u('uT'), c.aspect / c.fl, 1 / c.fl);
    gl.uniform3fv(P_SKY.u('uSun'), sun); gl.uniform3fv(P_SKY.u('uZen'), env.z); gl.uniform3fv(P_SKY.u('uHor'), env.h);
    gl.uniform1f(P_SKY.u('uOn'), clamp((S.alt + 1.5) / 2.5, 0, 1));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!S.ready) return c;

    // 땅 · 풀 · 물 · 길
    const lit = () => {
      gl.useProgram(P_LIT);
      gl.uniformMatrix4fv(P_LIT.u('uVP'), false, c.vp); gl.uniform3fv(P_LIT.u('uEye'), c.e);
      gl.uniform3fv(P_LIT.u('uSun'), sun); gl.uniform3fv(P_LIT.u('uSunCol'), up ? env.su : [0, 0, 0]); gl.uniform3fv(P_LIT.u('uAmb'), env.am); gl.uniform3fv(P_LIT.u('uFog'), env.h);
      gl.uniform1f(P_LIT.u('uNight'), clamp((1.5 - S.alt) / 6, 0, 1)); gl.uniform2f(P_LIT.u('uFogR'), 160, 1000);
      attribs(4);
    };
    const bindLit = buf => { gl.bindBuffer(gl.ARRAY_BUFFER, buf); const s = STRIDE * 4; gl.vertexAttribPointer(0, 3, gl.FLOAT, false, s, 0); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, s, 12); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, s, 24); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, s, 36); };
    lit(); bindLit(B.flat); gl.drawArrays(gl.TRIANGLES, 0, S.n.flat);

    // 땅 위 그림자: 스텐실에 자리만 찍고 한 번에 어둡게
    if (up && S.n.shd) {
      const dir = (S.az + 180) * rad;
      gl.useProgram(P_SHD); attribs(1);
      gl.uniformMatrix4fv(P_SHD.u('uVP'), false, c.vp); gl.uniform3fv(P_SHD.u('uEye'), c.e); gl.uniform2f(P_SHD.u('uFogR'), 160, 1000);
      gl.uniform2f(P_SHD.u('uD'), Math.sin(dir), Math.cos(dir)); gl.uniform1f(P_SHD.u('uT'), 1 / Math.tan(Math.max(S.alt, 0.6) * rad));
      gl.enable(gl.STENCIL_TEST); gl.stencilFunc(gl.ALWAYS, 1, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE); gl.colorMask(false, false, false, false);
      gl.bindBuffer(gl.ARRAY_BUFFER, B.shd); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, S.n.shd);
      gl.colorMask(true, true, true, true); gl.stencilFunc(gl.EQUAL, 1, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform4f(P_SHD.u('uCol'), 0.07, 0.10, 0.22, 0.40 * clamp(S.alt / 3, 0.25, 1));
      gl.bindBuffer(gl.ARRAY_BUFFER, B.gnd); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.disable(gl.BLEND); gl.disable(gl.STENCIL_TEST);
    }

    // 건물 · 나무
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    lit(); bindLit(B.solid); gl.drawArrays(gl.TRIANGLES, 0, S.n.solid);

    // 해 길: 건물 뒤는 가려지고, 흐리게 한 번 더 그려 위치는 보이게
    gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(P_OBJ); attribs(2);
    gl.uniformMatrix4fv(P_OBJ.u('uVP'), false, c.vp); gl.uniform3fv(P_OBJ.u('uEye'), c.e);
    for (const [buf, n] of [[B.path, S.n.path], [B.sun, S.n.sun]]) {
      if (!n) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
      gl.enable(gl.DEPTH_TEST); gl.uniform1f(P_OBJ.u('uA'), 1); gl.drawArrays(gl.TRIANGLES, 0, n);
      gl.disable(gl.DEPTH_TEST); gl.uniform1f(P_OBJ.u('uA'), 0.42); gl.drawArrays(gl.TRIANGLES, 0, n);
    }
    gl.disable(gl.BLEND);
    return c;
  }
  // 하늘의 한 점(방위·고도) → 화면 자리
  function project(az, alt) {
    const c = S.cam; if (!c) return { ok: false, sx: 0, sy: 0 };
    const d = dirOf(az, alt), x = d[0] * c.r[0] + d[1] * c.r[1] + d[2] * c.r[2], y = d[0] * c.u[0] + d[1] * c.u[1] + d[2] * c.u[2], z = d[0] * c.f[0] + d[1] * c.f[1] + d[2] * c.f[2];
    if (z < 0.02) return { ok: false, sx: x, sy: y };
    return { ok: true, x: c.w / 2 + x / z * c.fl / c.aspect * c.w / 2, y: c.h / 2 - y / z * c.fl * c.h / 2, sx: x, sy: y };
  }

  return { S, setData, setPath, setSun, draw, project, blocked, inBuilding };
}
