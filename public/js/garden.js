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
function terrainY(x, z) {
  return 0.32 * vnoise(x * 0.09 + 7.3, z * 0.09 - 2.1) + 0.14 * vnoise(x * 0.23, z * 0.23) - 0.2;
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
  renderer.toneMappingExposure = 1.08;
  const useShadows = !isMobile && !reduced;
  renderer.shadowMap.enabled = useShadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x2a1b3d, 36, 150);

  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 400);
  camera.position.set(0, 26, 44);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.7, 0);
  controls.enableDamping = true; controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.minDistance = 8; controls.maxDistance = 36;
  controls.minPolarAngle = 0.4; controls.maxPolarAngle = 1.42;
  controls.autoRotate = !reduced; controls.autoRotateSpeed = 0.22;
  controls.enabled = false;

  /* ------------- lights ------------- */
  scene.add(new THREE.HemisphereLight(0x6b5aa0, 0x2a1f38, 0.6));
  const moonLight = new THREE.DirectionalLight(0xbfc8ff, 0.75);
  moonLight.position.set(-26, 34, -18);
  if (useShadows) {
    moonLight.castShadow = true;
    moonLight.shadow.mapSize.set(1024, 1024);
    const sc = moonLight.shadow.camera;
    sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.far = 90;
    sc.updateProjectionMatrix();
    moonLight.shadow.bias = -0.0015;
  }
  scene.add(moonLight);

  /* ------------- sky, moon, stars ------------- */
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(180, 24, 18),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x161034) },
        mid: { value: new THREE.Color(0x593a63) },
        low: { value: new THREE.Color(0xc9756c) },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 top, mid, low; varying vec3 vP;
        void main(){
          float h = normalize(vP).y;
          vec3 c = mix(low, mid, smoothstep(-0.05, 0.28, h));
          c = mix(c, top, smoothstep(0.22, 0.75, h));
          c += low * 0.16 * pow(1.0 - clamp(abs(h - 0.03) * 4.0, 0.0, 1.0), 2.0);
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
  );
  scene.add(sky);

  {
    const n = 520, pos = new Float32Array(n * 3);
    const rnd = mulberry(42);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, e = Math.asin(0.12 + rnd() * 0.86), r = 172;
      pos[i * 3] = Math.cos(a) * Math.cos(e) * r;
      pos[i * 3 + 1] = Math.sin(e) * r;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({
      size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.85,
      color: 0xfff6e0, map: softCircleTex(), depthWrite: false, fog: false,
    }));
    scene.add(stars);
  }

  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: softCircleTex('#fdf4da', 'rgba(253,244,218,0)'), fog: false, depthWrite: false }));
  moon.scale.setScalar(11); moon.position.set(-52, 46, -92); scene.add(moon);
  const moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softCircleTex('rgba(253,244,218,.4)', 'rgba(253,244,218,0)'), fog: false, depthWrite: false, opacity: 0.5 }));
  moonHalo.scale.setScalar(30); moonHalo.position.copy(moon.position); scene.add(moonHalo);

  /* ------------- the island ------------- */
  const R = 26;
  {
    const g = new THREE.CircleGeometry(R, 72, 0, Math.PI * 2);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    const colors = new Float32Array(p.count * 3);
    const base = new THREE.Color(0x36523a), dark = new THREE.Color(0x27402f), soil = new THREE.Color(0x4a3a30);
    const tmp = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      p.setY(i, terrainY(x, z));
      const r = Math.hypot(x, z);
      const n = vnoise(x * 0.35 + 3, z * 0.35);
      tmp.copy(base).lerp(dark, 0.35 + 0.5 * n).lerp(soil, 1 - Math.min(1, r / 5.5)); // soil heart under the roses
      tmp.lerp(dark, THREE.MathUtils.smoothstep(r, R - 4, R));
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    const ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    ground.receiveShadow = useShadows;
    scene.add(ground);

    const skirt = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R + 2.4, 3.2, 72, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x3a2c26, roughness: 1 })
    );
    skirt.position.y = -1.6; scene.add(skirt);
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(R + 2.4, 72), new THREE.MeshBasicMaterial({ color: 0x12101f }));
    bottom.rotation.x = Math.PI / 2; bottom.position.y = -3.2; scene.add(bottom);
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
      uRoot: { value: new THREE.Color(0x2c4630) },
      uTip: { value: new THREE.Color(0x9dc06a) },
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
  const dummy = new THREE.Object3D();

  function scatterGrass(geo, count, seed, height) {
    const mesh = new THREE.InstancedMesh(geo, grassMaterial(height), count);
    mesh.frustumCulled = false;
    mesh.receiveShadow = useShadows; mesh.castShadow = false;
    const rnd = mulberry(seed);
    let placed = 0, guard = 0;
    while (placed < count && guard++ < count * 40) {
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * (R - 1.6);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
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

  let dayCount = 0, milestones = new Map();
  const roseColor = new THREE.Color();

  function plantRoses(days, ms, animateNew = false) {
    milestones = ms || milestones;
    const prev = dayCount;
    dayCount = Math.min(days, ROSE_MAX);
    glowGroup.clear();
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

      if (milestones.has(n)) {
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
    if (!revealed) for (let n = 1; n <= dayCount; n++) setRoseScale(n, 0.0001);
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
  const hotspots = [
    { group: bookGroup, label: 'open our book', at: new V3(-7.6, 2.4, 5.6), base: new V3(-7.6, 0, 5.6), br: 1.5 },
    { group: lineGroup, label: 'the photographs', at: new V3(7.4, 4.6, -7.6), base: new V3(7.5, 0, -7.5), br: 2.2 },
    { group: fireGroup, label: 'the small fire — for letting go', at: new V3(7.8, 1.8, 6.4), base: new V3(7.8, 0, 6.4), br: 1.4 },
  ];
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
  }, undefined, () => { buildRope(); afterKit(); });

  function afterKit() {
    // scatter the couple's grass meshes with the ported shader
    const loader = new GLTFLoader();
    const counts = isMobile ? [620, 380] : [1500, 900];
    let pending = 2;
    const done = () => { if (--pending === 0) beginIntro(); };
    loader.load('/assets/grass/grass.glb', g => { scatterGrass(normalizeGrass(extractGeometry(g.scene), 0.6), counts[0], 11, 0.6); done(); },
      undefined, () => { scatterGrass(fallbackBlade(0.6), counts[0], 11, 0.6); done(); });
    loader.load('/assets/grass/grass2.glb', g => { scatterGrass(normalizeGrass(extractGeometry(g.scene), 0.48), counts[1], 23, 0.48); done(); },
      undefined, () => { scatterGrass(fallbackBlade(0.48), counts[1], 23, 0.48); done(); });
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
      seed.push({ a: rnd() * Math.PI * 2, r: 6 + rnd() * 15, h: 0.5 + rnd() * 2.2, s: 0.3 + rnd() * 0.7, o: rnd() * 100 });
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
      seed.push({ x: (rnd() - 0.5) * 40, z: (rnd() - 0.5) * 40, y: rnd() * 9 + 1, vy: 0.25 + rnd() * 0.3, ph: rnd() * 9, s: 0.7 + rnd() * 0.8 });
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

  const camFrom = new V3(0, 26, 44), camTo = new V3(0.5, 8.2, 21.5);
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const back = t => { const s = 1.7; t = Math.min(t, 1); return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2); };

  const scaled = new THREE.Matrix4(), tmpM = new THREE.Matrix4();
  function updateIntro(now) {
    const t = now - introStart;
    const ct = Math.min(t / 3.6, 1);
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
      if (k < 0) { setRoseScale(n, 0.0001); allDone = false; }
      else if (k < 1) { setRoseScale(n, Math.max(back(k), 0.0001)); allDone = false; }
      else setRoseScale(n, 1);
    }
    roseHeads.instanceMatrix.needsUpdate = roseStems.instanceMatrix.needsUpdate = true;

    if (ct >= 1 && allDone) {
      introDone = true;
      revealed = true;
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
        if (s.y < 0.05) { s.y = 8 + hash2(i, now % 97) * 3; s.x = (hash2(i, s.y) - 0.5) * 40; s.z = (hash2(s.y, i) - 0.5) * 40; }
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

    renderer.render(scene, camera);
  }
  loop();

  addEventListener('resize', onResize);
  function onResize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight, false);
  }

  return {
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
