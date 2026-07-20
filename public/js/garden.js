/* ==================================================================
   the garden — a twilight island where one rose grows per day.
   grass shader ported from the couple's Godot .gdshader
   (root→tip gradient × world-space noise patches) plus wind.
   nature models: Quaternius Ultimate Nature Pack (CC0).
   book model: "Low Poly Book" by Tekila.
   ================================================================== */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const V3 = THREE.Vector3;

/* ---------------- tiny deterministic noise (shared js-side) -------- */
function hash2(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, z) { // smooth value noise
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const GROUND_Y = 6;                           // how high the garden sits above the sea
function terrainY() {
  return GROUND_Y;                            // the plateau top is the ground
}
// the island outline = the plateau's measured waterline (48 angular bins)
const edgeTable = new Float32Array(48).fill(26);
function edgeR(a) {
  const t = (a / (Math.PI * 2) + 0.5) * 48;
  const i0 = ((Math.floor(t) % 48) + 48) % 48, i1 = (i0 + 1) % 48, f = t - Math.floor(t);
  return edgeTable[i0] * (1 - f) + edgeTable[i1] * f;
}
function insideIsland(x, z, pad = 0) {
  return Math.hypot(x, z) < edgeR(Math.atan2(z, x)) - pad;
}
const mulberry = seed => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/* ---------------- canvas texture helpers ---------------- */
function softCircleTex(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 64) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
  gr.addColorStop(0, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function petalTex() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.translate(32, 32); g.rotate(0.4);
  g.fillStyle = '#f0a5b4';
  g.beginPath(); g.ellipse(0, 0, 22, 13, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,.25)';
  g.beginPath(); g.ellipse(-5, -3, 10, 5, 0.3, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function signTex(lines) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = '#8a6a48'; g.fillRect(0, 0, 512, 192);
  for (let i = 0; i < 9; i++) { g.fillStyle = `rgba(60,40,22,${0.05 + 0.05 * hash2(i, 3)})`; g.fillRect(0, i * 22, 512, 3); }
  g.fillStyle = '#f6ead8';
  g.textAlign = 'center';
  g.font = 'italic 600 58px "Cormorant Garamond", Georgia, serif';
  g.fillText(lines[0], 256, 82);
  g.font = '34px "Caveat", cursive';
  g.fillText(lines[1], 256, 142);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ================================================================== */

export function createGarden(canvas, opts = {}) {
  const reduced = !!opts.reducedMotion;
  const isMobile = Math.min(window.innerWidth, window.innerHeight) < 700 || /Mobi|Android/i.test(navigator.userAgent);
  const labelEl = opts.labelEl || null;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, powerPreference: 'high-performance' });
  } catch (e) {
    if (opts.onFail) opts.onFail(e);
    return { setPhotos() {}, setDay() {}, dispose() {} };
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.6 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.16;
  const useShadows = !isMobile && !reduced;
  renderer.shadowMap.enabled = useShadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  let composer = null, bloomPass = null;
  scene.fog = new THREE.Fog(0x241a3e, 95, 800);

  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 1400);
  camera.position.set(0, 34, 86);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, GROUND_Y + 1.7, 0);
  controls.enableDamping = true; controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.minDistance = 5; controls.maxDistance = 240;
  controls.minPolarAngle = 0.02; controls.maxPolarAngle = 1.55;
  controls.autoRotate = !reduced; controls.autoRotateSpeed = 0.22;
  controls.enabled = false;

  /* ------------- lights ------------- */
  if (!isMobile && !reduced) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.55, 0.85);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
  }

  scene.add(new THREE.HemisphereLight(0x7b68ae, 0x33283f, 0.82));
  scene.add(new THREE.AmbientLight(0x4a4066, 0.5));
  const rim = new THREE.DirectionalLight(0xe0906c, 0.5);   // soft glow behind the objects
  rim.position.set(-60, 42, -110);
  scene.add(rim);
  const moonLight = new THREE.DirectionalLight(0xbfc8ff, 0.75);
  moonLight.position.set(-26, 34, -18);
  if (useShadows) {
    moonLight.castShadow = true;
    moonLight.shadow.mapSize.set(2048, 2048);
    const sc = moonLight.shadow.camera;
    sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.far = 90;
    sc.updateProjectionMatrix();
    moonLight.shadow.bias = -0.0004;
    moonLight.shadow.normalBias = 0.06;
    sc.left = -42; sc.right = 42; sc.top = 42; sc.bottom = -42;
    sc.near = 2; sc.far = 160;
    sc.updateProjectionMatrix();
  }
  scene.add(moonLight);

  /* ------------- sky, moon, stars ------------- */
  const skyUniforms = {
    top: { value: new THREE.Color(0x161034) },
    mid: { value: new THREE.Color(0x593a63) },
    low: { value: new THREE.Color(0xc9756c) },
    uCloudLit: { value: new THREE.Color(0xbfa6c9) },
    uCloudShade: { value: new THREE.Color(0x5e4468) },
    uSkyTime: { value: 0 },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(760, 28, 20),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: skyUniforms,
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 top, mid, low, uCloudLit, uCloudShade;
        uniform float uSkyTime;
        varying vec3 vP;
        float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gn(vec2 p){
          vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(gh(i), gh(i+vec2(1,0)), u.x), mix(gh(i+vec2(0,1)), gh(i+vec2(1,1)), u.x), u.y);
        }
        float fbm(vec2 p){
          return gn(p) * 0.55 + gn(p * 2.13 + 4.7) * 0.28 + gn(p * 4.31 + 9.1) * 0.17;
        }
        /* double-sample parallax clouds, as in the couple's sky shader */
        float cloudHeight(vec2 uv, float density, float shapeExp){
          float h = fbm(uv);
          h = clamp((h - (1.0 - density)) / density, 0.0, 1.0);
          return pow(h, shapeExp);
        }
        void main(){
          vec3 dir = normalize(vP);
          float h = dir.y;
          vec3 c = mix(low, mid, smoothstep(-0.05, 0.28, h));
          c = mix(c, top, smoothstep(0.22, 0.75, h));
          c += low * 0.16 * pow(1.0 - clamp(abs(h - 0.03) * 4.0, 0.0, 1.0), 2.0);

          if (dir.y > 0.02) {
            float t = 1.0 / dir.y;                       // hit the cloud plane at y=1
            vec2 wind = vec2(1.0, 0.35) * uSkyTime * 0.006;
            vec2 uv1 = dir.xz * t * 0.16 + wind;
            vec2 uv2 = dir.xz * t * 0.23 + wind * 0.5 + 3.7;
            float h1 = cloudHeight(uv1, 0.62, 2.0);
            float h2 = cloudHeight(uv2, 0.62, 2.0);
            uv1 += dir.xz * h1 * 0.05;                    // fake depth: re-sample pushed uv
            uv2 += dir.xz * h2 * 0.05;
            h1 = cloudHeight(uv1, 0.62, 2.0);
            h2 = cloudHeight(uv2, 0.62, 2.0);
            float cloud = min(h1, h1 * h2);
            cloud *= smoothstep(0.02, 0.22, dir.y);
            vec3 cloudCol = mix(uCloudShade, uCloudLit, clamp(h1 * 1.4 - 0.15, 0.0, 1.0));
            cloudCol = mix(cloudCol, low, 0.25 * pow(1.0 - clamp(dir.y * 2.4, 0.0, 1.0), 2.0));
            c = mix(c, cloudCol, pow(cloud, 0.8) * 0.85);
          }
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
  );
  scene.add(sky);
  const skyProcMat = sky.material;
  function setSky(url) {
    if (!url) { sky.material = skyProcMat; return; }
    new THREE.TextureLoader().load(url, t => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = THREE.RepeatWrapping; t.repeat.x = -1;   // inside-of-sphere view
      sky.material = new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, fog: false, depthWrite: false });
    }, undefined, () => {});                              // keeps the procedural twilight if absent
  }

  {
    const n = 520, pos = new Float32Array(n * 3);
    const rnd = mulberry(42);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, e = Math.asin(0.12 + rnd() * 0.86), r = 700;
      pos[i * 3] = Math.cos(a) * Math.cos(e) * r;
      pos[i * 3 + 1] = Math.sin(e) * r;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({
      size: 1.7, sizeAttenuation: false, transparent: true, opacity: 0.85,
      color: 0xfff6e0, map: softCircleTex(), depthWrite: false, fog: false,
    }));
    scene.add(stars);
  }

  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: softCircleTex('#fdf4da', 'rgba(253,244,218,0)'), fog: false, depthWrite: false }));
  moon.scale.setScalar(38); moon.position.set(-180, 158, -318); scene.add(moon);
  const moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softCircleTex('rgba(253,244,218,.4)', 'rgba(253,244,218,0)'), fog: false, depthWrite: false, opacity: 0.5 }));
  moonHalo.scale.setScalar(102); moonHalo.position.copy(moon.position); scene.add(moonHalo);

  /* ------------- the island: Plateau_winter_001 as the base ------------- */
  const R = 26;
  const edgeTexData = new Uint8Array(48 * 4);
  const edgeTex = new THREE.DataTexture(edgeTexData, 48, 1);
  edgeTex.wrapS = THREE.RepeatWrapping;
  edgeTex.magFilter = edgeTex.minFilter = THREE.LinearFilter;
  function pushEdgeTable() {
    for (let i = 0; i < 48; i++) {
      const b = Math.round(THREE.MathUtils.clamp(edgeTable[i] / 80, 0, 1) * 255);
      edgeTexData[i * 4] = b; edgeTexData[i * 4 + 3] = 255;
    }
    edgeTex.needsUpdate = true;
  }
  pushEdgeTable();

  function fallbackBase() {                    // never a floating garden, even if the model fails
    const disc = new THREE.Mesh(new THREE.CircleGeometry(22, 64),
      new THREE.MeshStandardMaterial({ color: 0x3f5f3a, roughness: 1 }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = GROUND_Y - 0.01;
    disc.receiveShadow = useShadows;
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(22, 23.5, GROUND_Y + 7, 64, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x4a3b31, roughness: 1 }));
    wall.position.y = (GROUND_Y - 7) / 2;
    scene.add(disc, wall);
    edgeTable.fill(22.6); pushEdgeTable();
  }

  function loadBase() {
    new GLTFLoader().load('/assets/mountains/mountains_kit.glb', gltf => {
      const src = gltf.scene.getObjectByName('Plateau_winter_001');
      if (!src) { fallbackBase(); assetDone(); return; }
      const base = src.clone(true);
      base.traverse(o => {
        if (o.isMesh && o.material) {
          o.material = o.material.clone();
          o.material.color = new THREE.Color(0xffffff);   // natural palette, untinted
          o.material.roughness = 1;
          o.receiveShadow = useShadows;
        }
      });
      // measure the flat top at unit scale, then size it to hold the whole garden
      base.updateMatrixWorld(true);
      const v = new THREE.Vector3();
      const collect = (cb) => base.traverse(o => {
        if (!o.isMesh) return;
        const pa = o.geometry.attributes.position;
        for (let k = 0; k < pa.count; k++) { v.fromBufferAttribute(pa, k).applyMatrix4(o.matrixWorld); cb(v); }
      });
      let maxY = -1e9; collect(p => { if (p.y > maxY) maxY = p.y; });
      const capBins = new Float32Array(24).fill(0);
      collect(p => {
        if (p.y > maxY - 0.04) {
          const bi = ((Math.floor((Math.atan2(p.z, p.x) / (Math.PI * 2) + 0.5) * 24) % 24) + 24) % 24;
          const r = Math.hypot(p.x, p.z);
          if (r > capBins[bi]) capBins[bi] = r;
        }
      });
      let rIn = 1e9; for (const r of capBins) if (r > 0.01 && r < rIn) rIn = r;
      if (!isFinite(rIn) || rIn < 0.02) rIn = 0.35;
      const S = THREE.MathUtils.clamp(20.5 / rIn, 20, 120);
      base.scale.setScalar(S);
      base.position.y = GROUND_Y - maxY * S + 0.02;   // flat top lands at GROUND_Y
      base.updateMatrixWorld(true);
      scene.add(base);
      {   // a green lawn over the flat top, cut to the measured cap outline
        const P = 48, inset = 0.3;
        const rims = new Float32Array(P);
        for (let i = 0; i < P; i++) {
          const t = i / P * 24, i0 = Math.floor(t) % 24, i1 = (i0 + 1) % 24, f = t - Math.floor(t);
          rims[i] = Math.max((capBins[i0] * (1 - f) + capBins[i1] * f) * S - inset, 2);
        }
        const lpos = [0, GROUND_Y + 0.015, 0], lcol = [];
        const gA = new THREE.Color(0x4f7f40), gB = new THREE.Color(0x3c6533), soil = new THREE.Color(0x52413a);
        const tmpc = new THREE.Color();
        tmpc.copy(soil); lcol.push(tmpc.r, tmpc.g, tmpc.b);
        for (let i = 0; i <= P; i++) {
          const a = (i % P) / P * Math.PI * 2 - Math.PI;
          const r = rims[i % P];
          lpos.push(Math.cos(a) * r, GROUND_Y + 0.015, Math.sin(a) * r);
          tmpc.copy(gA).lerp(gB, 0.3 + 0.5 * vnoise(Math.cos(a) * 3 + 5, Math.sin(a) * 3));
          lcol.push(tmpc.r, tmpc.g, tmpc.b);
        }
        const idx = [];
        for (let i = 1; i <= P; i++) idx.push(0, i + 1, i);
        const lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.Float32BufferAttribute(lpos, 3));
        lg.setAttribute('color', new THREE.Float32BufferAttribute(lcol, 3));
        lg.setIndex(idx);
        lg.computeVertexNormals();
        const lawn = new THREE.Mesh(lg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
        lawn.receiveShadow = useShadows;
        scene.add(lawn);
      }
      // measure the waterline so the sea foam hugs the real silhouette
      const bins = new Float32Array(48).fill(0);
      collect(p => {
        if (Math.abs(p.y - SEA_Y) < 1.4) {
          const bi = ((Math.floor((Math.atan2(p.z, p.x) / (Math.PI * 2) + 0.5) * 48) % 48) + 48) % 48;
          const r = Math.hypot(p.x, p.z);
          if (r > bins[bi]) bins[bi] = r;
        }
      });
      let last = 0; for (const r of bins) if (r > last) last = r;
      for (let i = 0; i < 48; i++) if (bins[i] < 1) bins[i] = (bins[(i + 47) % 48] || bins[(i + 1) % 48] || last || 24);
      for (let i = 0; i < 48; i++) edgeTable[i] = THREE.MathUtils.clamp(
        (bins[(i + 47) % 48] + bins[i] * 2 + bins[(i + 1) % 48]) / 4, 8, 78);
      pushEdgeTable();
      assetDone();
    }, undefined, () => { fallbackBase(); assetDone(); });
  }

  /* ------------- the sea ------------- */
  const SEA_Y = -1.15;
  const seaUniforms = {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color(0x131b36) },
    uShallow: { value: new THREE.Color(0x2c4a63) },
    uHorizon: { value: new THREE.Color(0x5a4270) },
    uFoam: { value: new THREE.Color(0xe9eff1) },
    uGlint: { value: new THREE.Color(0xffe2b8) },
    uMoonDir: { value: new V3(-180, 158, -318).normalize() },
    uFogColor: { value: scene.fog.color },
    uFogNear: { value: scene.fog.near },
    uFogFar: { value: scene.fog.far },
    uAmp: { value: reduced ? 0.06 : 0.22 },
    uEdgeTex: { value: edgeTex },
  };
  {
    const seg = isMobile ? 120 : 176;
    const g = new THREE.PlaneGeometry(1500, 1500, seg, seg);
    g.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: seaUniforms,
      vertexShader: `
        uniform float uTime, uAmp;
        varying vec3 vW; varying vec3 vN;
        float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gn(vec2 p){
          vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(gh(i), gh(i+vec2(1,0)), u.x), mix(gh(i+vec2(0,1)), gh(i+vec2(1,1)), u.x), u.y);
        }
        float waveH(vec2 p, float t){
          float h = 0.0;
          h += sin(dot(p, vec2(0.16, 0.05)) + t * 0.9) * 0.55;
          h += sin(dot(p, vec2(-0.07, 0.19)) + t * 1.25) * 0.34;
          h += sin(dot(p, vec2(0.045, -0.11)) + t * 0.6) * 0.45;
          h += (gn(p * 0.22 + t * 0.07) - 0.5) * 1.1;
          h += (gn(p * 0.55 - t * 0.05) - 0.5) * 0.45;
          return h;
        }
        void main(){
          vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
          float d = length(wp.xz);
          float damp = clamp(1.0 - d / 260.0, 0.12, 1.0);
          float t = uTime;
          float h = waveH(wp.xz, t) * uAmp * damp;
          float e = 0.9;
          float hx = waveH(wp.xz + vec2(e, 0.0), t) * uAmp * damp;
          float hz = waveH(wp.xz + vec2(0.0, e), t) * uAmp * damp;
          vN = normalize(vec3(h - hx, e, h - hz));
          wp.y += h;
          vW = wp;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime, uFogNear, uFogFar;
        uniform vec3 uDeep, uShallow, uHorizon, uFoam, uGlint, uMoonDir, uFogColor;
        varying vec3 vW; varying vec3 vN;
        float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gn(vec2 p){
          vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(gh(i), gh(i+vec2(1,0)), u.x), mix(gh(i+vec2(0,1)), gh(i+vec2(1,1)), u.x), u.y);
        }
        uniform sampler2D uEdgeTex;
        float edgeR(float a){
          return texture2D(uEdgeTex, vec2(a / 6.2831853 + 0.5, 0.5)).r * 80.0;
        }
        void main(){
          vec3 N = normalize(vN);
          vec3 Vv = cameraPosition - vW;
          float viewDist = length(Vv);
          vec3 V = Vv / viewDist;
          float dC = length(vW.xz);
          float eIsl = edgeR(atan(vW.z, vW.x));

          float shore = smoothstep(eIsl + 16.0, eIsl - 2.0, dC);
          vec3 col = mix(uDeep, uShallow, shore * 0.85 + 0.08);

          float fres = pow(1.0 - clamp(dot(V, N), 0.0, 1.0), 3.0);
          col = mix(col, uHorizon, fres * 0.55);

          /* moonlight on the water */
          vec3 Hh = normalize(uMoonDir + V);
          float spec = pow(clamp(dot(N, Hh), 0.0, 1.0), 260.0);
          float sparkle = step(0.986, gn(vW.xz * 3.1 + uTime * 0.6)) * spec * 8.0;
          col += uGlint * (spec * 1.6 + sparkle);

          /* foam: a breathing ring where the sea meets the island, plus wave crests */
          float ring = smoothstep(eIsl + 3.0, eIsl + 0.5, dC) * smoothstep(eIsl - 1.5, eIsl + 0.6, dC);
          float lap = 0.55 + 0.45 * sin(uTime * 1.4 + gn(vW.xz * 1.7) * 6.2831);
          float foamRing = ring * lap * (0.45 + 0.55 * gn(vW.xz * 2.6 + uTime * 0.32));
          float crest = smoothstep(0.14, 0.30, vW.y + 1.15) * (1.0 - smoothstep(60.0, 200.0, dC)) * 0.4
                      * gn(vW.xz * 1.3 - uTime * 0.22);
          col = mix(col, uFoam, clamp(foamRing + crest, 0.0, 0.85));

          float fogF = smoothstep(uFogNear, uFogFar, viewDist);
          col = mix(col, uFogColor, fogF);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sea = new THREE.Mesh(g, mat);
    sea.position.y = SEA_Y;
    sea.frustumCulled = false;
    scene.add(sea);
  }

  const keepOut = [];                              // {x,z,r} grass/rose exclusion
  const addKeepOut = (x, z, r) => keepOut.push({ x, z, r });
  const blocked = (x, z, pad = 0) => keepOut.some(k => Math.hypot(x - k.x, z - k.z) < k.r + pad);

  /* ------------- grass (their shader, ported) ------------- */
  const grassMats = [];
  function grassMaterial(height) {
    const mat = new THREE.MeshStandardMaterial({ roughness: 1, side: THREE.DoubleSide });
    mat.userData.u = {
      uTime: { value: 0 },
      uHeight: { value: height },
      uWind: { value: reduced ? 0.045 : 0.14 },
      uRoot: { value: new THREE.Color(0x315233) },
      uTip: { value: new THREE.Color(0xa6c973) },
      uNoiseScale: { value: 7.5 },
    };
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, mat.userData.u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime, uHeight, uWind;
          varying float vHF; varying vec2 vWXZ;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float hf = clamp(transformed.y / uHeight, 0.0, 1.0);
          vHF = hf;
          #ifdef USE_INSTANCING
            vec3 iw = (modelMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
          #else
            vec3 iw = (modelMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
          #endif
          vWXZ = iw.xz;
          float ph = iw.x * 0.53 + iw.z * 0.41;
          float sw = sin(uTime * 1.5 + ph) + 0.5 * sin(uTime * 2.6 + ph * 1.7);
          transformed.x += sw * uWind * hf * hf;
          transformed.z += cos(uTime * 1.1 + ph * 1.3) * 0.6 * uWind * hf * hf;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform vec3 uRoot, uTip; uniform float uNoiseScale;
          varying float vHF; varying vec2 vWXZ;
          float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float gn(vec2 p){
            vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
            return mix(mix(gh(i), gh(i+vec2(1,0)), u.x), mix(gh(i+vec2(0,1)), gh(i+vec2(1,1)), u.x), u.y);
          }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float n = gn(vWXZ / uNoiseScale * 4.0);
          vec3 grad = mix(uRoot, uTip, vHF);            /* 1.0-UV.y in the original */
          grad *= mix(0.68, 1.22, n);                    /* × noise patch, as the gdshader did */
          diffuseColor.rgb = grad;`);
    };
    grassMats.push(mat);
    return mat;
  }

  function extractGeometry(root) {
    let geo = null;
    root.traverse(o => { if (!geo && o.isMesh) geo = o.geometry; });
    return geo;
  }
  function normalizeGrass(geo, targetH) {
    geo = geo.clone();
    geo.computeBoundingBox();
    const bb = geo.boundingBox, h = bb.max.y - bb.min.y;
    geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    geo.scale(targetH / h, targetH / h, targetH / h);
    return geo;
  }

  const introItems = []; // {mesh, idx, mat4(final), delay, tilt}

  function makeFallbackAtlas() {
    // guaranteed coverage: hand-drawn blade clumps, used until (unless) the real atlas arrives
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g2 = c.getContext('2d');
    const rnd = mulberry(5);
    for (let t = 0; t < 4; t++) {
      const ox = (t % 2) * 128, oy = (t / 2 | 0) * 128;
      for (let b = 0; b < 7; b++) {
        const bx = ox + 20 + rnd() * 88, lean = (rnd() - 0.5) * 26;
        const h = 70 + rnd() * 50, w = 5 + rnd() * 6;
        const grd = g2.createLinearGradient(0, oy + 128, 0, oy + 128 - h);
        grd.addColorStop(0, 'rgba(255,255,255,1)');
        grd.addColorStop(1, 'rgba(255,255,255,0.25)');
        g2.fillStyle = grd;
        g2.beginPath();
        g2.moveTo(bx - w / 2, oy + 128);
        g2.quadraticCurveTo(bx - w / 2 + lean * 0.4, oy + 128 - h * 0.6, bx + lean, oy + 128 - h);
        g2.quadraticCurveTo(bx + w / 2 + lean * 0.4, oy + 128 - h * 0.6, bx + w / 2, oy + 128);
        g2.closePath(); g2.fill();
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function scatterCardGrass() {
    const count = isMobile ? 850 : 2400;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0);
    const tiles = new Float32Array(count), phases = new Float32Array(count);
    const mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uAtlas: { value: makeFallbackAtlas() },      // covered from frame one
        uWind: { value: reduced ? 0.02 : 0.1 },
      },
      vertexShader: `
        uniform float uTime, uWind;
        attribute float aTile, aPhase;
        varying vec2 vUv; varying float vTile; varying vec2 vWXZ;
        float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gn(vec2 p){
          vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(gh(i), gh(i+vec2(1,0)), u.x), mix(gh(i+vec2(0,1)), gh(i+vec2(1,1)), u.x), u.y);
        }
        void main(){
          vUv = uv; vTile = aTile;
          vec3 iw = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vWXZ = iw.xz;
          float sx = length(instanceMatrix[0].xyz);
          float sy = length(instanceMatrix[1].xyz);
          /* their billboard=true, locked upright: face the camera around Y */
          vec3 toCam = cameraPosition - iw;
          vec3 fwd = normalize(vec3(toCam.x, 0.0, toCam.z) + vec3(0.0001, 0.0, 0.0));
          vec3 right = vec3(fwd.z, 0.0, -fwd.x);
          vec3 wp = iw + right * position.x * sx + vec3(0.0, 1.0, 0.0) * position.y * sy;
          /* their wind: scrolling noise, tips move most */
          float w = gn(iw.xz * 0.03 - uTime * 0.05 - vec2(aPhase));
          wp.xz += (w - 0.5) * 2.0 * uWind * (uv.y * uv.y) * vec2(1.0, 0.65);
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D uAtlas;
        varying vec2 vUv; varying float vTile; varying vec2 vWXZ;
        float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gn(vec2 p){
          vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(gh(i), gh(i+vec2(1,0)), u.x), mix(gh(i+vec2(0,1)), gh(i+vec2(1,1)), u.x), u.y);
        }
        /* their palette_01: 3 stops, clamped ends */
        vec3 palette(float t){
          vec3 a = vec3(0.659, 0.792, 0.345);
          vec3 b = vec3(0.459, 0.655, 0.263);
          vec3 c = vec3(0.275, 0.510, 0.196);
          vec3 col = mix(a, b, smoothstep(0.1667, 0.5, t));
          return mix(col, c, smoothstep(0.5, 0.8333, t));
        }
        void main(){
          float tile = mod(vTile, 4.0);
          vec2 off = vec2(mod(tile, 2.0), floor(tile / 2.0)) * 0.5;
          float a = texture2D(uAtlas, vUv * 0.5 + off).a;
          float alpha = clamp((a - 0.1) / 0.8, 0.0, 1.0);   /* their 0.1–0.9 window */
          if (alpha < 0.1) discard;
          float noiseV = gn(vWXZ * 0.055 + 4.2) * 0.7 + gn(vWXZ * 0.16) * 0.3;
          vec3 c = palette(noiseV) * (0.62 + 0.38 * vUv.y);  /* rooted shading */
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    new THREE.TextureLoader().load('/assets/env/grass_atlas.png',
      t => { t.colorSpace = THREE.SRGBColorSpace; mat.uniforms.uAtlas.value = t; },
      undefined,
      () => {});                                     // fallback atlas simply stays
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.frustumCulled = false;
    const rnd = mulberry(77);
    let placed = 0, guard = 0;
    while (placed < count && guard++ < count * 60) {
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * (R * 1.24);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (!insideIsland(x, z, 1.15)) continue;
      if (rr < 12 && rnd() > 0.14) continue;         // the roses keep their heart
      if (blocked(x, z, 0.4)) continue;
      dummy.position.set(x, terrainY(x, z) - 0.02, z);
      dummy.rotation.set(0, 0, 0);
      const sw = 0.4 + rnd() * 0.35, sh = 0.38 + rnd() * 0.32;
      dummy.scale.set(sw, sh, sw);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);
      tiles[placed] = (rnd() * 4) | 0;
      phases[placed] = rnd() * 9;
      introItems.push({ mesh, idx: placed, m: dummy.matrix.clone(), delay: (rr / R) * 1.5 + rnd() * 0.25 });
      placed++;
    }
    mesh.count = placed;
    geo.setAttribute('aTile', new THREE.InstancedBufferAttribute(tiles, 1));
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    mesh.userData.mat = mat;
    cardGrass = mesh;
    scene.add(mesh);
  }
  let cardGrass = null;
  const dummy = new THREE.Object3D();

  function scatterGrass(geo, count, seed, height) {
    const mesh = new THREE.InstancedMesh(geo, grassMaterial(height), count);
    mesh.frustumCulled = false;
    mesh.receiveShadow = useShadows; mesh.castShadow = false;
    const rnd = mulberry(seed);
    let placed = 0, guard = 0;
    while (placed < count && guard++ < count * 40) {
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * (R * 1.24);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (!insideIsland(x, z, 1.4)) continue;
      const inHeart = rr < 11 ? (rnd() > 0.12) : rr < 15 ? (rnd() > 0.55) : false; // let roses own the heart
      if (inHeart || blocked(x, z, 0.35)) continue;
      dummy.position.set(x, terrainY(x, z) - 0.02, z);
      dummy.rotation.set(0, rnd() * Math.PI * 2, 0);
      const s = 0.65 + rnd() * 0.8;
      dummy.scale.set(s, s * (0.8 + rnd() * 0.5), s);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);
      introItems.push({ mesh, idx: placed, m: dummy.matrix.clone(), delay: (rr / R) * 1.5 + rnd() * 0.25 });
      placed++;
    }
    mesh.count = placed;
    scene.add(mesh);
  }

  /* ------------- roses: one per day ------------- */
  const ROSE = { c: 0.35, jitter: 0.14 };
  const rosePos = n => { // phyllotaxis, day 1 at the very heart
    const ang = n * 2.39996323, r = ROSE.c * Math.sqrt(n);
    const j = ROSE.jitter;
    return {
      x: Math.cos(ang) * r + (hash2(n, 1.7) - 0.5) * j,
      z: Math.sin(ang) * r + (hash2(n, 9.2) - 0.5) * j,
      r,
    };
  };

  function buildRoseGeometries() {
    const head = [];
    const [pw, ph] = isMobile ? [4, 3] : [6, 5];   // petal detail: phones get lighter roses
    const petal = () => new THREE.SphereGeometry(0.16, pw, ph);
    for (let ring = 0; ring < 3; ring++) {
      const k = [5, 4, 3][ring], out = [0.13, 0.075, 0.03][ring], up = [0.0, 0.05, 0.09][ring], s = [1, 0.78, 0.55][ring];
      for (let i = 0; i < k; i++) {
        const p = petal();
        p.scale(s, 0.5 * s, 0.72 * s);
        p.rotateX(-0.5 + ring * 0.28);
        p.translate(0, up, out);
        p.rotateY((i / k) * Math.PI * 2 + ring * 0.55);
        head.push(p);
      }
    }
    const bud = new THREE.SphereGeometry(0.085, pw, ph); bud.scale(1, 1.25, 1); bud.translate(0, 0.1, 0);
    head.push(bud);
    const headGeo = mergeGeometries(head);
    headGeo.translate(0, 0.62, 0);

    const parts = [];
    const stem = new THREE.CylinderGeometry(0.016, 0.028, 0.56, 5); stem.translate(0, 0.28, 0); parts.push(stem);
    const sepal = new THREE.ConeGeometry(0.075, 0.1, 5); sepal.rotateX(Math.PI); sepal.translate(0, 0.585, 0); parts.push(sepal);
    for (const [side, h] of [[1, 0.3], [-1, 0.42]]) {
      const leaf = new THREE.SphereGeometry(0.09, 5, 4);
      leaf.scale(1.5, 0.25, 0.8);
      leaf.rotateZ(side * 0.7);
      leaf.translate(side * 0.12, h, 0);
      parts.push(leaf);
    }
    const stemGeo = mergeGeometries(parts);
    return { headGeo, stemGeo };
  }
  const { headGeo, stemGeo } = buildRoseGeometries();
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x3f6b3a, roughness: 0.9 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62 });

  const ROSE_MAX = 3000;
  const roseHeads = new THREE.InstancedMesh(headGeo, headMat, ROSE_MAX);
  const roseStems = new THREE.InstancedMesh(stemGeo, stemMat, ROSE_MAX);
  roseHeads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  roseStems.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  roseHeads.receiveShadow = roseStems.receiveShadow = useShadows;
  roseHeads.frustumCulled = roseStems.frustumCulled = false;
  scene.add(roseHeads, roseStems);
  let revealed = reduced;   // during the intro, roses stay hidden until the wave reaches them

  const goldGlowTex = softCircleTex('rgba(255,214,140,.9)', 'rgba(255,214,140,0)');
  const glowGroup = new THREE.Group(); scene.add(glowGroup);
  const annivGroup = new THREE.Group(); scene.add(annivGroup);
  let annivSpots = [];

  function refreshAnniversaries() {
    annivGroup.clear();
    annivSpots.sort((a, b) => a.n - b.n);
    annivSpots.forEach((spot, k) => {
      const { x, z } = spot;
      const y = terrainY(x, z);
      const g = new THREE.Group();
      g.position.set(x, y, z);
      // plinth + gold ring
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.1, 20),
        new THREE.MeshStandardMaterial({ color: 0x6b5638, roughness: 0.6, metalness: 0.4 }));
      plinth.position.y = 0.05;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 10, 28),
        new THREE.MeshStandardMaterial({ color: 0xf2c257, roughness: 0.3, metalness: 0.9, emissive: 0x6b4a12, emissiveIntensity: 0.5 }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.1;
      // the rose itself — taller, deeper red, softly lit from within
      const roseMat = new THREE.MeshStandardMaterial({ color: 0xd9455e, roughness: 0.45, emissive: 0x5a1120, emissiveIntensity: 0.9 });
      const head = new THREE.Mesh(headGeo, roseMat);
      const stem = new THREE.Mesh(stemGeo, stemMat);
      const rose = new THREE.Group();
      rose.add(head, stem);
      rose.scale.setScalar(1.45);
      rose.position.y = 0.1;
      // glass dome
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.42, 26, 20),
        new THREE.MeshPhysicalMaterial({ color: 0xcfe4ff, transparent: true, opacity: 0.14, roughness: 0.05, metalness: 0, depthWrite: false }));
      dome.scale.set(1, 1.5, 1);
      dome.position.y = 0.32;
      // drifting sparkles inside
      const sn = 12, spos = new Float32Array(sn * 3), srnd = mulberry(spot.n);
      for (let i = 0; i < sn; i++) {
        spos[i * 3] = (srnd() - 0.5) * 0.5;
        spos[i * 3 + 1] = 0.2 + srnd() * 0.9;
        spos[i * 3 + 2] = (srnd() - 0.5) * 0.5;
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(spos, 3));
      const sparks = new THREE.Points(sg, new THREE.PointsMaterial({
        size: 4, sizeAttenuation: false, map: goldGlowTex, transparent: true,
        depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffd9a8, opacity: 0.9,
      }));
      g.add(plinth, ring, rose, dome, sparks);
      if (k === annivSpots.length - 1) {                  // the newest anniversary carries a light
        const l = new THREE.PointLight(0xffb9c6, 1.0, 4.5, 2);
        l.position.y = 0.9;
        g.add(l);
      }
      g.userData = { rose, sparks, ph: spot.n * 1.618 };
      annivGroup.add(g);
    });
  }

  let dayCount = 0, milestones = new Map();
  const roseColor = new THREE.Color();

  function plantRoses(days, ms, animateNew = false) {
    milestones = ms || milestones;
    const prev = dayCount;
    dayCount = Math.min(days, ROSE_MAX);
    glowGroup.clear();
    annivSpots = [];
    for (let n = 1; n <= dayCount; n++) {
      const { x, z } = rosePos(n);
      const y = terrainY(x, z);
      dummy.position.set(x, y, z);
      dummy.rotation.set((hash2(n, 4.4) - 0.5) * 0.16, hash2(n, 2.2) * Math.PI * 2, (hash2(n, 6.1) - 0.5) * 0.16);
      const s = 0.8 + hash2(n, 8.8) * 0.38;
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      roseHeads.setMatrixAt(n - 1, dummy.matrix);
      roseStems.setMatrixAt(n - 1, dummy.matrix);

      const mst = milestones.get(n);
      if (mst && mst.kind === 'anniv') {
        annivSpots.push({ x, z, n });
        roseColor.setHex(0xd9455e);
      } else if (mst) {
        roseColor.setHex(0xf2c257);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: goldGlowTex, depthWrite: false, transparent: true, opacity: 0.85 }));
        glow.position.set(x, y + 0.78 * s, z); glow.scale.setScalar(0.9);
        glowGroup.add(glow);
      } else {
        const t = hash2(n, 12.3);
        roseColor.setHSL(0.965 + t * 0.035, 0.52 + hash2(n, 5.5) * 0.2, 0.5 + (t - 0.5) * 0.14);
      }
      roseHeads.setColorAt(n - 1, roseColor);
    }
    for (const sp of annivSpots) setRoseScale(sp.n, 0.0001);   // the dome stands where the rose would
    if (!revealed) for (let n = 1; n <= dayCount; n++) setRoseScale(n, 0.0001);
    refreshAnniversaries();
    annivGroup.visible = revealed;
    roseHeads.count = roseStems.count = dayCount;
    roseHeads.instanceMatrix.needsUpdate = roseStems.instanceMatrix.needsUpdate = true;
    if (roseHeads.instanceColor) roseHeads.instanceColor.needsUpdate = true;

    // today's rose — a bud that blooms, softly lit
    const t = rosePos(dayCount);
    todayLight.position.set(t.x, terrainY(t.x, t.z) + 1.1, t.z);
    sparkles.position.set(t.x, terrainY(t.x, t.z) + 0.75, t.z);
    if (animateNew && prev > 0 && dayCount > prev) bloomPulse = 1;
  }

  const todayLight = new THREE.PointLight(0xff9db0, 1.1, 5.5, 2); scene.add(todayLight);
  let bloomPulse = 0;
  const sparkles = (() => {
    const n = 18, pos = new Float32Array(n * 3), rnd = mulberry(7);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (rnd() - 0.5) * 0.9; pos[i * 3 + 1] = rnd() * 1.1; pos[i * 3 + 2] = (rnd() - 0.5) * 0.9;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({
      size: 5, sizeAttenuation: false, map: softCircleTex('rgba(255,220,235,1)', 'rgba(255,220,235,0)'),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9,
    }));
    scene.add(p); return p;
  })();

  /* ------------- hotspot groups ------------- */
  const bookGroup = new THREE.Group(); bookGroup.name = 'journal'; scene.add(bookGroup);
  const lineGroup = new THREE.Group(); lineGroup.name = 'gallery'; scene.add(lineGroup);
  const fireGroup = new THREE.Group(); fireGroup.name = 'burn'; scene.add(fireGroup);
  const tvGroup = new THREE.Group(); tvGroup.name = 'tv'; scene.add(tvGroup);
  const hotspots = [
    { group: bookGroup, label: 'open our book', at: new V3(-7.6, 2.4, 5.6), base: new V3(-7.6, 0, 5.6), br: 1.5 },
    { group: lineGroup, label: 'the photographs', at: new V3(7.4, 4.6, -7.6), base: new V3(7.5, 0, -7.5), br: 2.2 },
    { group: fireGroup, label: 'the small fire — for letting go', at: new V3(7.8, 1.8, 6.4), base: new V3(7.8, 0, 6.4), br: 1.4 },
    { group: tvGroup, label: 'the little cinema', at: new V3(-2.3, 2.3, -13.2), base: new V3(-2.3, 0, -13.2), br: 1.6 },
  ];
  for (const h of hotspots) { h.at.y += GROUND_Y; h.base.y += GROUND_Y; }
  for (const h of hotspots) h.base.y = terrainY(h.base.x, h.base.z) + 0.06;
  const hoverRing = new THREE.Mesh(
    new THREE.RingGeometry(0.82, 1.0, 40),
    new THREE.MeshBasicMaterial({ color: 0xf2c257, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
  );
  hoverRing.rotation.x = -Math.PI / 2;
  scene.add(hoverRing);

  /* ------------- stump, book, lantern ------------- */
  {
    const stump = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.68, 0.62, 10), new THREE.MeshStandardMaterial({ color: 0x6d5138, roughness: 1 }));
    trunk.position.y = 0.31; trunk.castShadow = useShadows;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.04, 10), new THREE.MeshStandardMaterial({ color: 0xc7a877, roughness: 1 }));
    top.position.y = 0.63;
    stump.add(trunk, top);
    stump.position.set(-7.6, terrainY(-7.6, 5.6), 5.6);
    bookGroup.add(stump);
    addKeepOut(-7.6, 5.6, 1.5);

    const bookHolder = new THREE.Group();
    bookHolder.position.set(-7.6, terrainY(-7.6, 5.6) + 0.66, 5.6);
    bookHolder.rotation.y = 0.7;
    bookGroup.add(bookHolder);

    const fallbackBook = () => {
      const g = new THREE.Group();
      const cover = new THREE.MeshStandardMaterial({ color: 0x8a4a56, roughness: 0.8 });
      const pages = new THREE.MeshStandardMaterial({ color: 0xf0e4cc, roughness: 1 });
      const bottom = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 1.5), cover); bottom.position.y = 0.025;
      const block = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.16, 1.4), pages); block.position.y = 0.13;
      const topC = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 1.5), cover); topC.position.y = 0.235;
      g.add(bottom, block, topC);
      g.traverse(o => { if (o.isMesh) o.castShadow = useShadows; });
      return g;
    };

    new FBXLoader().setPath('/assets/book/').load('Book.fbx', fbx => {
      const box = new THREE.Box3().setFromObject(fbx);
      const size = box.getSize(new V3());
      // lay the smallest axis upward
      if (size.z <= size.x && size.z <= size.y) fbx.rotateX(-Math.PI / 2);
      else if (size.x <= size.y && size.x <= size.z) fbx.rotateZ(Math.PI / 2);
      const box2 = new THREE.Box3().setFromObject(fbx);
      const s2 = box2.getSize(new V3());
      const scale = 1.35 / Math.max(s2.x, s2.z);
      fbx.scale.setScalar(scale);
      const box3 = new THREE.Box3().setFromObject(fbx);
      const c = box3.getCenter(new V3());
      fbx.position.sub(c); fbx.position.y -= box3.min.y - c.y;
      new THREE.TextureLoader().load('/assets/book/Book_BaseColor.png', tex => {
        tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = true;
        fbx.traverse(o => {
          if (o.isMesh) {
            o.material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
            o.castShadow = useShadows;
          }
        });
      }, undefined, () => fbx.traverse(o => { if (o.isMesh) { o.castShadow = useShadows; } }));
      bookHolder.add(fbx);
    }, undefined, () => bookHolder.add(fallbackBook()));

    // lantern on a shepherd's pole
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 2.3, 6), new THREE.MeshStandardMaterial({ color: 0x33261f, roughness: 1 }));
    pole.position.set(-9, terrainY(-9, 4.4) + 1.15, 4.4); pole.castShadow = useShadows;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 6), pole.material);
    arm.rotation.z = Math.PI / 2; arm.position.set(-8.7, terrainY(-9, 4.4) + 2.25, 4.4);
    const lantern = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.3, 8),
      new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffb45e, emissiveIntensity: 1.6, roughness: 0.6 }));
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.12, 8), pole.material); cap.position.y = 0.21;
    const baseC = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.05, 8), pole.material); baseC.position.y = -0.17;
    lantern.add(body, cap, baseC);
    lantern.position.set(-8.42, terrainY(-9, 4.4) + 2.02, 4.4);
    const lanternLight = new THREE.PointLight(0xffb066, 1.5, 11, 2);
    lanternLight.position.copy(lantern.position);
    bookGroup.add(pole, arm, lantern, lanternLight);
    bookGroup.userData.lantern = lantern;
    bookGroup.userData.lanternLight = lanternLight;
    addKeepOut(-9, 4.4, 0.6);
  }

  /* ------------- the small fire ------------- */
  const fire = { x: 7.8, z: 6.4 };
  {
    const y0 = terrainY(fire.x, fire.z);
    addKeepOut(fire.x, fire.z, 1.7);
    const emberMat = new THREE.MeshStandardMaterial({ color: 0x3a1f14, emissive: 0xff6a26, emissiveIntensity: 1.4, roughness: 0.9 });
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.85, 6), new THREE.MeshStandardMaterial({ color: 0x4a352a, roughness: 1 }));
      log.rotation.set(Math.PI / 2 - 0.15, 0, (i / 3) * Math.PI);
      log.position.set(fire.x, y0 + 0.1, fire.z);
      log.castShadow = useShadows;
      fireGroup.add(log);
    }
    for (let i = 0; i < 4; i++) {
      const e = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07 + 0.03 * hash2(i, 2), 0), emberMat);
      e.position.set(fire.x + (hash2(i, 5) - 0.5) * 0.4, y0 + 0.12, fire.z + (hash2(i, 8) - 0.5) * 0.4);
      fireGroup.add(e);
    }
    const fireLight = new THREE.PointLight(0xff8a3c, 1.6, 12, 2);
    fireLight.position.set(fire.x, y0 + 0.9, fire.z);
    fireGroup.add(fireLight);
    fireGroup.userData.light = fireLight;

    const smokeTex = softCircleTex('rgba(180,170,190,.5)', 'rgba(180,170,190,0)');
    const smokeBase = new V3(fire.x, y0 + 0.25, fire.z);
    const smokes = [];
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0.4 }));
      s.userData.t = i / 7;
      s.position.copy(smokeBase);
      fireGroup.add(s); smokes.push(s);
    }
    fireGroup.userData.smokes = smokes;
    fireGroup.userData.base = smokeBase;

    const n = 16, pos = new Float32Array(n * 3), seedA = new Float32Array(n);
    const rnd = mulberry(99);
    for (let i = 0; i < n; i++) { seedA[i] = rnd(); pos[i * 3] = fire.x; pos[i * 3 + 1] = y0; pos[i * 3 + 2] = fire.z; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const sparks = new THREE.Points(g, new THREE.PointsMaterial({
      size: 4.5, sizeAttenuation: false, map: softCircleTex('rgba(255,190,110,1)', 'rgba(255,120,40,0)'),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    sparks.userData = { seedA, y0 };
    sparks.frustumCulled = false;
    sparks.visible = !reduced;
    fireGroup.add(sparks);
    fireGroup.userData.sparks = sparks;
  }

  /* ------------- nature kit + clothesline ------------- */
  const kitPlacements = [
    ['MapleTree_1',        -12.5, -8.5, 1.0, 0.4],
    ['MapleTree_4',         13.5, -1.5, 1.1, 2.2],
    ['Bush_Large_Flowers', -13.0,  8.0, 1.5, 0.0],
    ['Bush_Flowers',        -2.5, 15.5, 1.6, 1.2],
    ['Bush_Small_Flowers',  12.0, 11.5, 1.7, 2.6],
    ['Bush_Flowers',       -16.5, -1.5, 1.4, 4.0],
    ['Bush_Large_Flowers',   3.5,-16.0, 1.4, 5.1],
    ['Flower_1_Clump',      -4.8, 11.8, 1.5, 0.0],
    ['Flower_2_Clump',      11.2,  2.8, 1.6, 1.0],
    ['Flower_5_Clump',      -11.2, 0.8, 1.5, 2.0],
    ['Flower_1_Clump',       5.2, 12.8, 1.4, 3.0],
    ['Rock_1',              -5.5, -12.5, 1.1, 0.6],
    ['Rock_3',              15.5,  6.0, 1.0, 1.6],
    ['Rock_5',             -15.0,-11.0, 1.0, 2.9],
    ['Petals_1',            -6.0,  9.0, 1.6, 0.0],
    ['Petals_1',             4.5,  9.5, 1.4, 2.0],
    ['Plant_1',              9.0, -2.0, 1.3, 1.1],
  ];
  const birchA = new V3(4.6, 0, -10.4), birchB = new V3(10.4, 0, -4.6);
  const photosAnchor = new THREE.Group(); lineGroup.add(photosAnchor);
  const photoCards = [];

  /* ============== quick settings ============== */
  const LOAD = { base: true, mountains: true, flowers: true, tv: true, grass: false };  // ← flip to enable/disable
  const SKY_TEXTURE_URL = '/assets/env/sky.jpg';  // ← drop any equirect image there, or call garden.setSky(url)
  /* ============================================ */
  setSky(SKY_TEXTURE_URL);                       // applies your sky if the file exists
  let assetsPending = 5;      // base, nature kit, mountains, flowers, tv
  const assetDone = () => { if (--assetsPending <= 0) beginIntro(); };
  setTimeout(() => { if (!ready) beginIntro(); }, 12000);   // never strand the loader

  LOAD.base ? loadBase() : (fallbackBase(), assetDone());
  LOAD.mountains ? loadMountains() : assetDone();
  LOAD.flowers ? loadFlowers() : assetDone();
  LOAD.tv ? loadTV() : assetDone();

  new GLTFLoader().load('/assets/nature/nature_kit.glb', gltf => {
    const kit = gltf.scene;
    kit.traverse(o => { if (o.isMesh) { o.castShadow = useShadows; o.receiveShadow = false; } });
    const grab = name => {
      const src = kit.getObjectByName(name);
      return src ? src.clone(true) : null;
    };
    const groundSnap = (o, x, z) => {
      o.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(o);
      o.position.y += terrainY(x, z) - bb.min.y - 0.03;
    };
    for (const [name, x, z, s, ry] of kitPlacements) {
      const o = grab(name);
      if (!o) continue;
      o.position.set(x, 0, z);
      o.scale.setScalar(s);
      o.rotation.y = ry;
      groundSnap(o, x, z);
      scene.add(o);
      if (name.includes('Tree')) addKeepOut(x, z, 1.4);
      if (name.includes('Bush')) addKeepOut(x, z, 1.1);
      if (name.includes('Rock')) addKeepOut(x, z, 0.9);
    }
    for (const [pt, name, s, ry] of [[birchA, 'BirchTree_1', 1.15, 0.4], [birchB, 'BirchTree_4', 1.25, 3.6]]) {
      const b = grab(name);
      if (!b) continue;
      b.position.set(pt.x, 0, pt.z);
      b.scale.setScalar(s); b.rotation.y = ry;
      groundSnap(b, pt.x, pt.z);
      lineGroup.add(b);
      addKeepOut(pt.x, pt.z, 1.4);
    }
    buildRope();
    afterKit();
    assetDone();
  }, undefined, () => { buildRope(); afterKit(); assetDone(); });

  function afterKit() {
    if (LOAD.grass) scatterCardGrass();   // their BinbunGrass — with a built-in fallback atlas
  }

  /* ------------- the little cinema ------------- */
  const TV = { state: 'off', mesh: null, mat: null, video: null, tex: null, light: null, onEnded: null };
  const tvStatic = (() => {
    const c = document.createElement('canvas'); c.width = 160; c.height = 120;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return { c, g: c.getContext('2d'), t, last: 0 };
  })();
  function tvSetState(st) {
    TV.state = st;
    if (!TV.mat) return;
    if (st === 'off') { TV.mat.map = null; TV.mat.color.setHex(0x0a0d13); }
    else if (st === 'static') { TV.mat.map = tvStatic.t; TV.mat.color.setHex(0xffffff); }
    else if (st === 'play') { TV.mat.map = TV.tex; TV.mat.color.setHex(0xffffff); }
    TV.mat.needsUpdate = true;
  }
  function loadTV() {
    new GLTFLoader().load('/assets/tv/retro_tv_setup.glb', gltf => {
      const setup = gltf.scene;
      setup.traverse(o => { if (o.isMesh) { o.castShadow = useShadows; } });
      const x = -2.3, z = -13.2;
      setup.scale.setScalar(1.5);
      setup.rotation.y = Math.atan2(0 - x, 0 - z);
      setup.position.set(x, 0, z);
      setup.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(setup);
      setup.position.y = terrainY(x, z) - bb.min.y - 0.01;
      tvGroup.add(setup);
      addKeepOut(x, z, 1.8);
      const scr = setup.getObjectByName('TV_Screen');
      if (scr) {
        TV.mesh = scr;
        TV.mat = new THREE.MeshBasicMaterial({ toneMapped: false, color: 0x0a0d13 });
        scr.material = TV.mat;
      }
      TV.light = new THREE.PointLight(0x9fc4ff, 0, 7, 2);
      const sb = new THREE.Box3().setFromObject(setup);
      TV.light.position.set(x + Math.sin(setup.rotation.y) * 1.4, (sb.min.y + sb.max.y) * 0.62, z + Math.cos(setup.rotation.y) * 1.4);
      tvGroup.add(TV.light);
      // two log seats for the audience of two
      const logMat = new THREE.MeshStandardMaterial({ color: 0x5a4433, roughness: 1 });
      for (const [lx, lz, ry] of [[-1.0, -11.2, 0.5], [-3.6, -11.5, -0.4]]) {
        const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.42, 9), logMat);
        seat.position.set(lx, terrainY(lx, lz) + 0.21, lz);
        seat.rotation.y = ry;
        seat.castShadow = useShadows;
        tvGroup.add(seat);
        addKeepOut(lx, lz, 0.55);
      }
      assetDone();
    }, undefined, () => assetDone());
  }
  function tvPlay(url, onEnded) {
    if (!TV.mat) return false;
    if (!TV.video) {
      TV.video = document.createElement('video');
      TV.video.playsInline = true;
      TV.video.preload = 'auto';
      TV.video.addEventListener('ended', () => {
        tvSetState('static');
        setTimeout(() => { if (TV.state === 'static') tvSetState('off'); }, 550);
        if (TV.onEnded) TV.onEnded();
      });
      TV.tex = new THREE.VideoTexture(TV.video);
      TV.tex.colorSpace = THREE.SRGBColorSpace;
    }
    TV.onEnded = onEnded || null;
    tvSetState('static');
    TV.video.src = url;
    TV.video.currentTime = 0;
    const pr = TV.video.play();
    if (pr && pr.then) pr.then(() => tvSetState('play')).catch(() => tvSetState('off'));
    else tvSetState('play');
    return true;
  }
  function tvToggle() {
    if (!TV.video || TV.state !== 'play') return 'off';
    if (TV.video.paused) { TV.video.play(); return 'playing'; }
    TV.video.pause(); return 'paused';
  }
  function tvStop() {
    if (TV.video) { TV.video.pause(); TV.video.removeAttribute('src'); TV.video.load(); }
    tvSetState('off');
  }

  /* ------------- her mountains ------------- */
  function loadMountains() {
    new GLTFLoader().load('/assets/mountains/mountains_kit.glb', gltf => {
      const kit = gltf.scene;
      kit.traverse(o => {
        if (o.isMesh && o.material) {
          o.material = o.material.clone();
          o.material.color = new THREE.Color(0xd4d9ef);   // moonlit snow tint
          o.material.roughness = 1;
        }
      });
      const grab = n => { const src = kit.getObjectByName(n); return src ? src.clone(true) : null; };
      // [model, azimuth°, distance, height, sink]  — a horseshoe of peaks with a gap for the moon (~210°)
      const ring = [
        ['Mountain_winter_003', 118, 372, 235, 6],
        ['Mountain_winter_007', 141, 340, 198, 5],
        ['Mountain_winter_001', 163, 402, 262, 8],
        ['Mountain_winter_009', 183, 356, 214, 6],
        ['Mountain_winter_005', 236, 388, 246, 7],
        ['Mountain_winter_002', 258, 344, 188, 5],
        ['Mountain_winter_010', 281, 398, 226, 7],
        ['Mountain_winter_004', 305, 352, 172, 5],
        ['Mountain_winter_006',  22, 420, 150, 6],
        ['Mountain_winter_008',  58, 430, 168, 6],
        ['Plateau_winter_001',  205, 442, 120, 10],
      ];
      for (const [name, az, dist, h, sink] of ring) {
        const o = grab(name);
        if (!o) continue;
        const a = az * Math.PI / 180;
        o.position.set(Math.sin(a) * dist, SEA_Y - sink, Math.cos(a) * dist);
        o.scale.setScalar(h);
        o.rotation.y = a + Math.PI + (hash2(az, dist) - 0.5) * 0.7;
        scene.add(o);
      }
      // two snowy islets closer in, rising straight out of the sea
      for (const [name, az, dist, h, sink] of [
        ['Hill_winter_001', 152, 148, 26, 3.5],
        ['Hill_winter_002', 296, 128, 21, 3.0],
      ]) {
        const o = grab(name);
        if (!o) continue;
        const a = az * Math.PI / 180;
        o.position.set(Math.sin(a) * dist, SEA_Y - sink, Math.cos(a) * dist);
        o.scale.setScalar(h);
        o.rotation.y = hash2(az, 7) * Math.PI * 2;
        scene.add(o);
      }
      assetDone();
    }, undefined, () => assetDone());
  }

  /* ------------- her flowers ------------- */
  function loadFlowers() {
    new GLTFLoader().load('/assets/flowers/flowers_kit.glb', gltf => {
      const kit = gltf.scene;
      kit.traverse(o => { if (o.isMesh) { o.castShadow = useShadows; } });
      const grab = n => { const src = kit.getObjectByName(n); return src ? src.clone(true) : null; };
      const put = (name, x, z, sc, ry, tilt = 0) => {
        const o = grab(name);
        if (!o) return null;
        o.position.set(x, 0, z);
        o.scale.setScalar(sc);
        o.rotation.set(0, ry, tilt);
        o.updateMatrixWorld(true);
        const bb = new THREE.Box3().setFromObject(o);
        o.position.y = terrainY(x, z) - bb.min.y - 0.01;
        scene.add(o);
        addKeepOut(x, z, 0.55 * sc + 0.25);
        return o;
      };
      put('FlowerArr_5',  0.9, 12.9, 0.52, 0.6);        // spilling by the sign
      put('FlowerArr_1', -6.3,  6.9, 0.50, 2.1);        // beside the reading stump
      put('FlowerArr_2', -9.8,  5.6, 0.46, 4.0);        // under the lantern
      put('FlowerArr_7',  9.4,  5.1, 0.46, 1.2);        // a safe step from the fire
      put('FlowerArr_4',  3.5, -9.2, 0.50, 5.3);        // at the first birch
      put('FlowerArr_9', 12.6,  9.9, 0.60, 2.8);        // shoreline spill
      put('Dahlia_Stem', 11.8,  1.4, 0.55, 0.9);
      put('Carnation_Stem', -3.9, 12.4, 0.50, 2.4);
      put('Rose_Stem_C', -11.6, 8.9, 0.55, 1.7);
      put('Rose_Stem_A',  3.05, 13.25, 0.5, 0.4, 0.28); // leaning on the sign leg
      // a single rose left lying on the stump, beside the book 🥹
      const laid = grab('Rose_Stem_B');
      if (laid) {
        laid.scale.setScalar(0.46);
        laid.position.set(-7.28, terrainY(-7.6, 5.6) + 0.68, 6.05);
        laid.rotation.set(0, 0.9, Math.PI / 2 - 0.12);
        scene.add(laid);
      }
      assetDone();
    }, undefined, () => assetDone());
  }
  function fallbackBlade(h) {
    const g = new THREE.ConeGeometry(0.05, h, 3);
    g.translate(0, h / 2, 0);
    return g;
  }

  let ropeCurve = null;
  function buildRope() {
    const a = new V3(birchA.x, terrainY(birchA.x, birchA.z) + 4.4, birchA.z);
    const b = new V3(birchB.x, terrainY(birchB.x, birchB.z) + 4.1, birchB.z);
    const mid = a.clone().lerp(b, 0.5); mid.y -= 0.7;
    ropeCurve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const rope = new THREE.Mesh(new THREE.TubeGeometry(ropeCurve, 24, 0.018, 5),
      new THREE.MeshStandardMaterial({ color: 0xbfa98a, roughness: 1 }));
    lineGroup.add(rope);
  }

  const texLoader = new THREE.TextureLoader();
  function setPhotos(list) {
    if (!ropeCurve) { setTimeout(() => setPhotos(list), 600); return; }
    for (const c of photoCards) photosAnchor.remove(c);
    photoCards.length = 0;
    const items = (list || []).slice(0, 5);
    const slots = items.length || 3;
    for (let i = 0; i < slots; i++) {
      const t = 0.5 + (i - (slots - 1) / 2) * (0.68 / Math.max(slots, 3));
      const p = ropeCurve.getPoint(t);
      const card = new THREE.Group();
      card.position.copy(p);
      const facing = Math.atan2(p.x - 0, p.z - 0); // face outward-ish toward camera side
      card.rotation.y = facing + Math.PI;
      card.userData.phase = i * 1.7;

      const clip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.05), new THREE.MeshStandardMaterial({ color: 0xc99b62, roughness: 1 }));
      clip.position.y = -0.06;
      card.add(clip);

      if (items[i]) {
        const frame = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 1.02), new THREE.MeshStandardMaterial({ color: 0xfbf6ec, roughness: 0.9, side: THREE.DoubleSide }));
        frame.position.y = -0.66;
        card.add(frame);
        const photo = new THREE.Mesh(new THREE.PlaneGeometry(0.74, 0.74), new THREE.MeshStandardMaterial({ color: 0x18122b, roughness: 0.9, side: THREE.DoubleSide }));
        photo.position.set(0, -0.575, 0.005);
        card.add(photo);
        texLoader.load(`/api/media/${items[i].id}?thumb=1`, tex => {
          tex.colorSpace = THREE.SRGBColorSpace;
          photo.material.map = tex; photo.material.color.set(0xffffff); photo.material.needsUpdate = true;
        });
      }
      photosAnchor.add(card);
      photoCards.push(card);
    }
  }

  /* ------------- sign at the front ------------- */
  {
    const tex = signTex(['Lina ♥ Thiha', 'walking home together · 13.04.2024']);
    const plank = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.7, 0.08),
      [null, null, null, null, new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }), null]
        .map(m => m || new THREE.MeshStandardMaterial({ color: 0x6d5138, roughness: 1 })));
    const y0 = terrainY(2.2, 13.6);
    plank.position.set(2.2, y0 + 1.06, 13.6);
    plank.rotation.y = 0.16;
    plank.castShadow = useShadows;
    const legMat = new THREE.MeshStandardMaterial({ color: 0x54402f, roughness: 1 });
    const l1 = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 1.15, 6), legMat);
    l1.position.set(1.3, y0 + 0.57, 13.9);
    const l2 = l1.clone(); l2.position.set(3.1, y0 + 0.57, 13.35);
    scene.add(plank, l1, l2);
    addKeepOut(2.2, 13.6, 1.1);
  }

  /* ------------- fireflies & drifting petals ------------- */
  const fireflies = (() => {
    const n = isMobile ? 26 : 46;
    const pos = new Float32Array(n * 3), seed = [];
    const rnd = mulberry(5);
    for (let i = 0; i < n; i++) {
      seed.push({ a: rnd() * Math.PI * 2, r: 6 + rnd() * 15, h: GROUND_Y + 0.5 + rnd() * 2.2, s: 0.3 + rnd() * 0.7, o: rnd() * 100 });
    }
    for (let i = 0; i < n; i++) {
      const s = seed[i];
      pos[i * 3] = Math.cos(s.a) * s.r;
      pos[i * 3 + 1] = s.h;
      pos[i * 3 + 2] = Math.sin(s.a) * s.r;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({
      size: 5, sizeAttenuation: false, map: softCircleTex('rgba(255,230,150,1)', 'rgba(255,190,80,0)'),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9,
    }));
    p.userData.seed = seed;
    p.frustumCulled = false;
    scene.add(p); return p;
  })();

  const petals = (() => {
    const n = isMobile ? 26 : 48;
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.16, 0.11),
      new THREE.MeshBasicMaterial({ map: petalTex(), transparent: true, depthWrite: false, side: THREE.DoubleSide }), n);
    const seed = [];
    const rnd = mulberry(31);
    for (let i = 0; i < n; i++) {
      seed.push({ x: (rnd() - 0.5) * 40, z: (rnd() - 0.5) * 40, y: GROUND_Y + rnd() * 9 + 1, vy: 0.25 + rnd() * 0.3, ph: rnd() * 9, s: 0.7 + rnd() * 0.8 });
    }
    mesh.userData.seed = seed;
    mesh.frustumCulled = false;
    const d0 = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const s = seed[i];
      if (reduced) {
        d0.position.set(s.x * 0.6, terrainY(s.x * 0.6, s.z * 0.6) + 0.03, s.z * 0.6);
        d0.rotation.set(-Math.PI / 2, 0, s.ph);
      } else {
        d0.position.set(s.x, s.y, s.z);
        d0.rotation.set(s.ph, s.ph * 2, 0);
      }
      d0.scale.setScalar(s.s);
      d0.updateMatrix();
      mesh.setMatrixAt(i, d0.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh); return mesh;
  })();

  /* ------------- raycast hotspots + label ------------- */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovered = null, pointerMoved = false, downAt = null;

  function pickHotspot(clientX, clientY) {
    pointer.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    for (const h of hotspots) {
      const hit = raycaster.intersectObject(h.group, true);
      if (hit.length) return h;
    }
    return null;
  }
  canvas.addEventListener('pointermove', e => {
    pointerMoved = true;
    if (e.pointerType === 'touch') return;
    const h = pickHotspot(e.clientX, e.clientY);
    if (h !== hovered) {
      hovered = h;
      canvas.style.cursor = h ? 'pointer' : '';
      if (labelEl) {
        if (h) { labelEl.textContent = h.label; labelEl.hidden = false; }
        else labelEl.hidden = true;
      }
    }
  });
  canvas.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY, performance.now()]; });
  canvas.addEventListener('pointerup', e => {
    if (!downAt) return;
    const [x, y, t] = downAt; downAt = null;
    if (Math.hypot(e.clientX - x, e.clientY - y) > 9 || performance.now() - t > 450) return;
    const h = pickHotspot(e.clientX, e.clientY);
    if (h && opts.onHotspot) opts.onHotspot(h.group.name);
  });

  /* ------------- intro & loop ------------- */
  const ZERO = new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001);
  let introStart = null, introDone = reduced, ready = false;

  function beginIntro() {
    if (ready) return;
    ready = true;
    if (reduced) {
      controls.enabled = true;
      camera.position.set(0.5, 8.2, 21.5);
      if (opts.onReady) opts.onReady();
      return;
    }
    for (const it of introItems) it.mesh.setMatrixAt(it.idx, ZERO);
    for (const it of introItems) it.mesh.instanceMatrix.needsUpdate = true;
    introStart = performance.now() / 1000;
    if (opts.onReady) opts.onReady();
  }

  const camFrom = new V3(0, GROUND_Y + 34, 86), camTo = new V3(0.5, GROUND_Y + 8.2, 21.5);
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const back = t => { const s = 1.7; t = Math.min(t, 1); return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2); };

  const scaled = new THREE.Matrix4(), tmpM = new THREE.Matrix4();
  function updateIntro(now) {
    const t = now - introStart;
    const ct = Math.min(t / 4.4, 1);
    camera.position.lerpVectors(camFrom, camTo, easeOut(ct));
    camera.lookAt(0, 1.7, 0);

    let allDone = true;
    for (const it of introItems) {
      const k = (t - it.delay) / 0.7;
      if (k < 0) { allDone = false; continue; }
      if (k >= 1) { it.mesh.setMatrixAt(it.idx, it.m); continue; }
      allDone = false;
      const s = Math.max(back(k), 0.0001);
      scaled.makeScale(s, s, s);
      tmpM.multiplyMatrices(it.m, scaled);
      it.mesh.setMatrixAt(it.idx, tmpM);
    }
    for (const it of introItems) it.mesh.instanceMatrix.needsUpdate = true;

    // roses ripple out from day 1 at the heart
    const per = Math.min(2.4 / Math.max(dayCount, 1), 0.02);
    for (let n = 1; n <= dayCount; n++) {
      const k = (t - 0.5 - (n - 1) * per) / 0.55;
      const isAnniv = milestones.get(n) && milestones.get(n).kind === 'anniv';
      if (k < 0 || isAnniv) { setRoseScale(n, 0.0001); if (k < 0) allDone = false; }
      else if (k < 1) { setRoseScale(n, Math.max(back(k), 0.0001)); allDone = false; }
      else setRoseScale(n, 1);
    }
    roseHeads.instanceMatrix.needsUpdate = roseStems.instanceMatrix.needsUpdate = true;

    if (ct >= 1 && allDone) {
      introDone = true;
      revealed = true;
      annivGroup.visible = true;
      controls.enabled = true;
      plantRoses(dayCount, milestones); // settle exact matrices
      bloomPulse = 1;
    }
  }
  const baseM = new THREE.Matrix4();
  function setRoseScale(n, s) {
    const { x, z } = rosePos(n);
    const y = terrainY(x, z);
    dummy.position.set(x, y, z);
    dummy.rotation.set((hash2(n, 4.4) - 0.5) * 0.16, hash2(n, 2.2) * Math.PI * 2, (hash2(n, 6.1) - 0.5) * 0.16);
    const base = 0.8 + hash2(n, 8.8) * 0.38;
    dummy.scale.setScalar(base * s);
    dummy.updateMatrix();
    roseHeads.setMatrixAt(n - 1, dummy.matrix);
    roseStems.setMatrixAt(n - 1, dummy.matrix);
  }

  let disposed = false;
  const clock = new THREE.Clock();
  function loop() {
    if (disposed) return;
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    const now = performance.now() / 1000;

    for (const m of grassMats) if (m.userData.u) m.userData.u.uTime.value = now;
    if (!reduced) seaUniforms.uTime.value = now;
    if (!reduced) skyUniforms.uSkyTime.value = now;
    if (cardGrass) cardGrass.userData.mat.uniforms.uTime.value = now;

    if (ready && !introDone && introStart != null) updateIntro(now);
    if (introDone) controls.update();

    // ambient motion
    if (!reduced) {
      const ff = fireflies.userData.seed, fp = fireflies.geometry.attributes.position;
      for (let i = 0; i < ff.length; i++) {
        const s = ff[i];
        const a = s.a + now * 0.08 * s.s;
        fp.setXYZ(i,
          Math.cos(a) * s.r + Math.sin(now * 0.7 + s.o) * 1.2,
          s.h + Math.sin(now * 0.9 + s.o * 2) * 0.5,
          Math.sin(a) * s.r + Math.cos(now * 0.55 + s.o) * 1.2);
      }
      fp.needsUpdate = true;
      fireflies.material.opacity = 0.65 + Math.sin(now * 2.1) * 0.25;

      const ps = petals.userData.seed;
      for (let i = 0; i < ps.length; i++) {
        const s = ps[i];
        s.y -= s.vy * dt;
        const floorY = insideIsland(s.x, s.z) ? GROUND_Y + 0.05 : SEA_Y + 0.05;
        if (s.y < floorY) { s.y = GROUND_Y + 6 + hash2(i, now % 97) * 4; s.x = (hash2(i, s.y) - 0.5) * 40; s.z = (hash2(s.y, i) - 0.5) * 40; }
        dummy.position.set(s.x + Math.sin(now * 0.8 + s.ph) * 1.1, s.y, s.z + Math.cos(now * 0.6 + s.ph) * 0.8);
        dummy.rotation.set(now * 1.2 + s.ph, s.ph, now * 0.9);
        dummy.scale.setScalar(s.s);
        dummy.updateMatrix();
        petals.setMatrixAt(i, dummy.matrix);
      }
      petals.instanceMatrix.needsUpdate = true;

      for (const c of photoCards) c.rotation.z = Math.sin(now * 1.2 + c.userData.phase) * 0.06;
      const lant = bookGroup.userData.lantern;
      if (lant) lant.rotation.z = Math.sin(now * 1.4) * 0.05;
    }

    // fire flicker, smoke, sparks
    const fl = fireGroup.userData.light;
    if (fl) fl.intensity = 1.35 + vnoise(now * 5.5, 3.3) * 0.9;
    const ll = bookGroup.userData.lanternLight;
    if (ll) ll.intensity = 1.4 + vnoise(now * 3.1, 8.8) * 0.35;
    const smokes = fireGroup.userData.smokes || [];
    const base = fireGroup.userData.base;
    for (const s of smokes) {
      s.userData.t = (s.userData.t + dt * 0.14) % 1;
      const k = s.userData.t;
      s.position.set(base.x + Math.sin(k * 9 + 2) * 0.28, base.y + k * 3.1, base.z + Math.cos(k * 7) * 0.25);
      s.scale.setScalar(0.5 + k * 1.7);
      s.material.opacity = 0.34 * (1 - k) * (reduced ? 0.6 : 1);
    }
    const sp = fireGroup.userData.sparks;
    if (sp && !reduced) {
      const pa = sp.geometry.attributes.position, sd = sp.userData.seedA, y0 = sp.userData.y0;
      for (let i = 0; i < sd.length; i++) {
        const life = (now * (0.5 + sd[i] * 0.7) + sd[i] * 9) % 1;
        pa.setXYZ(i,
          fire.x + (hash2(i, 3) - 0.5) * 0.5 * (1 + life),
          y0 + 0.2 + life * 2.2,
          fire.z + (hash2(i, 7) - 0.5) * 0.5 * (1 + life));
      }
      pa.needsUpdate = true;
    }

    // today's rose glow
    todayLight.intensity = 0.9 + Math.sin(now * 1.8) * 0.35 + bloomPulse * 2.2;
    if (bloomPulse > 0) bloomPulse = Math.max(0, bloomPulse - dt * 0.5);
    sparkles.rotation.y = now * 0.5;
    sparkles.material.opacity = 0.55 + Math.sin(now * 2.4) * 0.35;
    if (TV.state === 'static' && now - tvStatic.last > 0.07) {
      tvStatic.last = now;
      const { g: sg2, c } = tvStatic;
      const im = sg2.createImageData(c.width, c.height);
      for (let i = 0; i < im.data.length; i += 4) {
        const v = (Math.random() * 235) | 0;
        im.data[i] = v; im.data[i + 1] = v; im.data[i + 2] = v; im.data[i + 3] = 255;
      }
      sg2.putImageData(im, 0, 0);
      tvStatic.t.needsUpdate = true;
    }
    if (TV.light) {
      const tgt = TV.state === 'play' ? 1.15 + vnoise(now * 7.2, 5.5) * 0.5
                : TV.state === 'static' ? 0.5 + Math.random() * 0.35 : 0;
      TV.light.intensity += (tgt - TV.light.intensity) * 0.2;
    }
    for (const g of annivGroup.children) {
      const u = g.userData;
      if (!reduced) u.rose.rotation.y = now * 0.35 + u.ph;
      u.sparks.rotation.y = -now * 0.4;
      u.sparks.material.opacity = 0.6 + Math.sin(now * 1.8 + u.ph) * 0.3;
    }

    // hover ring + label tracking
    if (hovered) {
      hoverRing.position.copy(hovered.base);
      hoverRing.scale.setScalar(hovered.br * (1 + Math.sin(now * 3.2) * 0.05));
      hoverRing.material.opacity += (0.55 - hoverRing.material.opacity) * 0.15;
    } else {
      hoverRing.material.opacity *= 0.85;
    }
    if (labelEl && hovered && !labelEl.hidden) {
      const p = hovered.at.clone().project(camera);
      labelEl.style.left = `${(p.x * 0.5 + 0.5) * innerWidth}px`;
      labelEl.style.top = `${(-p.y * 0.5 + 0.5) * innerHeight}px`;
    }

    if (composer) composer.render(); else renderer.render(scene, camera);
  }
  loop();

  addEventListener('resize', onResize);
  function onResize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight, false);
    if (composer) composer.setSize(innerWidth, innerHeight);
  }

  return {
    setSky,
    tv: { play: tvPlay, toggle: tvToggle, stop: tvStop, state: () => TV.state },
    setPhotos,
    setDay(days, ms, animateNew = false) {
      plantRoses(days, ms, animateNew);
      if (!ready) { /* intro will pick them up */ }
      else if (introDone) { /* already settled */ }
    },
    dispose() {
      disposed = true;
      removeEventListener('resize', onResize);
      renderer.dispose();
    },
  };
}
