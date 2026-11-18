// 건물 그림자를 지도 안에서 GPU로 그린다.
// 건물 모서리마다 "바닥 두 점 + 그림자 끝 두 점" 사각형을 한 번만 올려 두고,
// 시간이 바뀌면 방향·길이 값(유니폼)만 바꾼다. 지도를 움직일 때 드는 계산은 0.
const VS = `
attribute vec3 a;
uniform mat4 m;
uniform vec2 d;
uniform float t;
void main() {
  vec2 p = a.xy + d * min(a.z * t, 1500.0);
  gl_Position = m * vec4(p, 0.0, 1.0);
}`;
const FS = `
precision mediump float;
void main() { gl_FragColor = vec4(1.0); }`;
const VS2 = `
attribute vec2 p;
varying vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const FS2 = `
precision mediump float;
varying vec2 uv;
uniform sampler2D s;
uniform vec4 c;
void main() { float al = texture2D(s, uv).a * c.a; gl_FragColor = vec4(c.rgb * al, al); }`;

function build(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.bindAttribLocation(p, 0, vs === VS ? 'a' : 'p');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

export function createShadowLayer() {
  let gl = null, prog, prog2, vbo, quad, fbo = null, tex = null, fw = 0, fh = 0, count = 0, data = null, dirty = false;
  const st = { ox: 0, oy: 0, k: 1, dx: 0, dy: 0, t: 0, on: false };
  const M = new Float32Array(16), U = {};

  function upload() {
    if (!gl || !data) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    count = data.length / 3; dirty = false;
  }
  function target() {
    const s = (gl.drawingBufferWidth > 1600 || (window.devicePixelRatio || 1) >= 2) ? 0.5 : 1;
    const w = Math.max(2, Math.round(gl.drawingBufferWidth * s)), h = Math.max(2, Math.round(gl.drawingBufferHeight * s));
    if (fbo && w === fw && h === fh) return;
    fw = w; fh = h;
    if (!tex) tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (!fbo) fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  }

  return {
    id: 'bd-shadows', type: 'custom', renderingMode: '2d',
    onAdd(map, g) {
      gl = g; prog = build(gl, VS, FS); prog2 = build(gl, VS2, FS2);
      for (const n of ['m', 'd', 't']) U[n] = gl.getUniformLocation(prog, n);
      for (const n of ['s', 'c']) U[n] = gl.getUniformLocation(prog2, n);
      vbo = gl.createBuffer(); quad = gl.createBuffer(); fbo = null; tex = null; fw = fh = 0;
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      if (data) upload();
    },
    onRemove() { gl = null; count = 0; },
    // rings: [{ h, a: Float32Array [x, y, …] }] (기준점에서 미터, x 동쪽, y 남쪽)
    setBuildings(rings, origin) {
      let n = 0;
      for (const r of rings) n += r.a.length / 2;
      const out = new Float32Array(n * 18); let o = 0;
      for (const r of rings) {
        const a = r.a, len = a.length / 2, h = r.h;
        for (let i = 0; i < len; i++) {
          const j = (i + 1) % len, ax = a[2 * i], ay = a[2 * i + 1], bx = a[2 * j], by = a[2 * j + 1];
          if (ax === bx && ay === by) continue;
          out[o++] = ax; out[o++] = ay; out[o++] = 0; out[o++] = bx; out[o++] = by; out[o++] = 0; out[o++] = bx; out[o++] = by; out[o++] = h;
          out[o++] = ax; out[o++] = ay; out[o++] = 0; out[o++] = bx; out[o++] = by; out[o++] = h; out[o++] = ax; out[o++] = ay; out[o++] = h;
        }
      }
      data = out.subarray(0, o); st.ox = origin.ox; st.oy = origin.oy; st.k = origin.k; dirty = true;
    },
    setSun(az, alt) {
      st.on = alt > 0.3;
      const dir = (az + 180) * Math.PI / 180;
      st.dx = Math.sin(dir); st.dy = -Math.cos(dir);
      st.t = 1 / Math.tan(Math.max(alt, 0.6) * Math.PI / 180);
    },
    prerender(g, m) {
      if (!gl) return;
      if (dirty) upload();
      if (!st.on || !count) return;
      target();
      // 지도 행렬 × 기준점 옮기기 × 미터 단위
      const { ox, oy, k } = st;
      for (let i = 0; i < 4; i++) {
        M[i] = m[i] * k; M[4 + i] = m[4 + i] * k; M[8 + i] = m[8 + i];
        M[12 + i] = m[i] * ox + m[4 + i] * oy + m[12 + i];
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, fw, fh);
      gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST); gl.disable(gl.CULL_FACE);
      gl.colorMask(true, true, true, true);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(U.m, false, M);
      gl.uniform2f(U.d, st.dx, st.dy);
      gl.uniform1f(U.t, st.t);
      gl.drawArrays(gl.TRIANGLES, 0, count);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    },
    render(g) {
      if (!gl || !st.on || !count || !fbo) return;
      gl.useProgram(prog2);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(U.s, 0);
      gl.uniform4f(U.c, 0.16, 0.22, 0.42, 0.27);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
