/* ==================================================================
   the small fire — a ritual for letting go.
   hold the match to strike it, then touch the flame to the paper.
   the burn spreads through value-noise so every fire is its own.
   ================================================================== */

/* ---------- tiny 2D value noise on a canvas-sized grid ---------- */
function makeNoise(w, h, seed = 7) {
  const g = new Float32Array(w * h);
  let s = seed;
  const rnd = () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const oct = (cellsX, cellsY, amp) => {
    const gx = cellsX + 1, gy = cellsY + 1;
    const grid = new Float32Array(gx * gy);
    for (let i = 0; i < grid.length; i++) grid[i] = rnd();
    for (let y = 0; y < h; y++) {
      const fy = (y / h) * cellsY, y0 = Math.floor(fy), ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * cellsX, x0 = Math.floor(fx), tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const a = grid[y0 * gx + x0], b = grid[y0 * gx + x0 + 1];
        const c = grid[(y0 + 1) * gx + x0], d = grid[(y0 + 1) * gx + x0 + 1];
        g[y * w + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      }
    }
  };
  oct(5, 6, 0.5); oct(11, 13, 0.3); oct(23, 27, 0.2);
  return g;
}

function wrapText(ctx, text, x, y, maxW, lineH, maxLines = Infinity) {
  const words = String(text).split(/\s+/);
  let line = '', lines = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + ' ' + words[i] : words[i];
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y); y += lineH; line = words[i];
      if (++lines >= maxLines - 1) { 
        while (i < words.length && ctx.measureText(line + '…').width > maxW) line = line.slice(0, -2);
        ctx.fillText(line + '…', x, y); return y + lineH;
      }
    } else line = test;
  }
  if (line) { ctx.fillText(line, x, y); y += lineH; }
  return y;
}

/* ---------- draw the thing that will burn ---------- */
async function renderArt(item, maxW, maxH) {
  const art = document.createElement('canvas');
  const g = art.getContext('2d');

  if (item.type === 'photo') {
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = item.src;
    }).catch(() => null);

    const iw = img ? img.naturalWidth : 4, ih = img ? img.naturalHeight : 3;
    const border = 16, capH = item.caption ? 64 : 34;
    const availW = maxW - border * 2, availH = maxH - border - capH;
    const s = Math.min(availW / iw, availH / ih, 1.6);
    const pw = Math.round(iw * s), ph = Math.round(ih * s);
    art.width = pw + border * 2; art.height = ph + border + capH;

    g.fillStyle = '#fbf6ec'; g.fillRect(0, 0, art.width, art.height);
    if (img) g.drawImage(img, border, border, pw, ph);
    else { g.fillStyle = '#221b33'; g.fillRect(border, border, pw, ph); }
    if (item.caption) {
      g.fillStyle = '#2e2438'; g.font = '26px "Caveat", cursive'; g.textAlign = 'center';
      g.fillText(item.caption.slice(0, 60), art.width / 2, ph + border + 36);
    }
    g.fillStyle = '#84788f'; g.font = '12px system-ui'; g.textAlign = 'center';
    g.fillText(item.meta || '', art.width / 2, art.height - 10);
  } else {
    const w = Math.min(maxW, 460), h = Math.min(maxH, Math.round(w * 1.28));
    art.width = w; art.height = h;
    g.fillStyle = '#f6ead8'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(216,196,166,.9)';
    for (let y = 86; y < h - 30; y += 30) { g.beginPath(); g.moveTo(26, y); g.lineTo(w - 26, y); g.stroke(); }
    g.fillStyle = '#2e2438'; g.textAlign = 'left';
    g.font = 'italic 600 30px "Cormorant Garamond", Georgia, serif';
    g.fillText((item.title || 'a page').slice(0, 34), 28, 46);
    g.font = '19px "Caveat", cursive'; g.fillStyle = '#ad4a5e';
    g.fillText(item.meta || '', 28, 72);
    g.font = '23px "Caveat", cursive'; g.fillStyle = '#2e2438';
    wrapText(g, item.body || '', 28, 108, w - 56, 30, Math.floor((h - 150) / 30));
    if (item.sign) {
      g.textAlign = 'right'; g.fillText('— ' + item.sign, w - 30, h - 24);
    }
  }
  return art;
}

/* ---------- crackle audio ---------- */
function makeCrackle() {
  let ctx = null, master = null, timer = null;
  return {
    start() {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain(); master.gain.value = 0.0; master.connect(ctx.destination);
        master.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.4);
        const pop = () => {
          if (!ctx) return;
          const dur = 0.03 + Math.random() * 0.05;
          const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
          const d = buf.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
          const src = ctx.createBufferSource(); src.buffer = buf;
          const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
          bp.frequency.value = 900 + Math.random() * 2600; bp.Q.value = 1.2;
          const gn = ctx.createGain(); gn.gain.value = 0.25 + Math.random() * 0.6;
          src.connect(bp); bp.connect(gn); gn.connect(master);
          src.start();
          timer = setTimeout(pop, 30 + Math.random() * 160);
        };
        pop();
      } catch { /* audio unavailable */ }
    },
    stop() {
      clearTimeout(timer);
      if (master && ctx) master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
      setTimeout(() => { try { ctx && ctx.close(); } catch {} ctx = null; }, 700);
    },
  };
}

/* ================================================================== */

export function runBurnRitual({ canvas, matchBtn, hintEl, doneEl, cancelBtn, item, reduced, audio, doneText }) {
  return new Promise(async resolve => {
    const g = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0;
    const size = () => {
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    const onR = () => size();
    addEventListener('resize', onR);

    const art = await renderArt(item, Math.min(W * 0.72, 540), Math.min(H * 0.6, 560));
    const ax = () => (W - art.width) / 2, ay = () => (H - art.height) / 2 - 20;

    /* burn-time field at reduced resolution */
    const scl = Math.max(1, Math.ceil(Math.max(art.width, art.height) / 210));
    const mw = Math.ceil(art.width / scl), mh = Math.ceil(art.height / scl);
    const noise = makeNoise(mw, mh, (Date.now() % 997) + 3);
    const burnAt = new Float32Array(mw * mh).fill(Infinity);
    const SPEED = (reduced ? 340 : 210) / scl;             // px(field)/s

    const maskC = document.createElement('canvas'); maskC.width = mw; maskC.height = mh;
    const maskG = maskC.getContext('2d');
    const maskImg = maskG.createImageData(mw, mh);
    const glowC = document.createElement('canvas'); glowC.width = mw; glowC.height = mh;
    const glowG = glowC.getContext('2d');
    const glowImg = glowG.createImageData(mw, mh);
    const charC = document.createElement('canvas'); charC.width = mw; charC.height = mh;
    const charG = charC.getContext('2d');
    const charImg = charG.createImageData(mw, mh);
    const comp = document.createElement('canvas'); comp.width = art.width; comp.height = art.height;
    const compG = comp.getContext('2d');

    const ignitions = [];
    function igniteAt(px, py, tNow) {
      const fx = px / scl, fy = py / scl;
      ignitions.push({ fx, fy, t: tNow });
      for (let y = 0; y < mh; y++) {
        for (let x = 0; x < mw; x++) {
          const d = Math.hypot(x - fx, y - fy);
          const n = noise[y * mw + x];
          const t = tNow + (d / SPEED) * (0.55 + n * 1.05);
          const i = y * mw + x;
          if (t < burnAt[i]) burnAt[i] = t;
        }
      }
    }

    /* particles */
    const embers = [], smokes = [], ashes = [];
    const spawnFrom = (now, count, arr, make) => {
      for (let k = 0; k < count; k++) {
        const x = (Math.random() * mw) | 0, y = (Math.random() * mh) | 0;
        const dt = now - burnAt[y * mw + x];
        if (dt > -0.05 && dt < 0.3) arr.push(make(ax() + x * scl, ay() + y * scl));
      }
    };

    const crackle = makeCrackle();
    let state = 'idle', litAt = 0, holdT = null, flame = { x: W / 2, y: H - 120 };
    let finishing = 0, cancelled = false, raf = 0;
    const t0 = performance.now() / 1000;
    const now = () => performance.now() / 1000 - t0;

    hintEl.textContent = 'press and hold the match to strike it';
    doneEl.hidden = true; matchBtn.hidden = false; matchBtn.classList.remove('lit');

    /* ---- interactions ---- */
    const strike = () => {
      matchBtn.classList.add('striking');
      holdT = setTimeout(() => {
        matchBtn.classList.remove('striking');
        matchBtn.classList.add('lit');
        state = 'lit';
        if (audio) crackle.start();
        setTimeout(() => { matchBtn.hidden = true; }, 350);
        hintEl.textContent = 'now — touch the flame to the paper';
      }, reduced ? 250 : 950);
    };
    const unstrike = () => { matchBtn.classList.remove('striking'); clearTimeout(holdT); };
    matchBtn.addEventListener('pointerdown', strike);
    matchBtn.addEventListener('pointerup', unstrike);
    matchBtn.addEventListener('pointerleave', unstrike);

    function tryIgnite(cx, cy) {
      const lx = cx - ax(), ly = cy - ay();
      if (lx >= -6 && ly >= -6 && lx < art.width + 6 && ly < art.height + 6) {
        if (state !== 'burning') { state = 'burning'; hintEl.textContent = ''; }
        igniteAt(Math.max(0, Math.min(art.width - 1, lx)), Math.max(0, Math.min(art.height - 1, ly)), now());
      }
    }
    const onMove = e => {
      flame.x = e.clientX; flame.y = e.clientY;
      if (state === 'lit' && (e.buttons & 1 || e.pointerType === 'touch')) tryIgnite(e.clientX, e.clientY - 26);
    };
    const onDown = e => {
      flame.x = e.clientX; flame.y = e.clientY;
      if (state === 'lit') tryIgnite(e.clientX, e.clientY - 26);
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);

    const onCancel = () => { cancelled = true; };
    cancelBtn.addEventListener('click', onCancel);

    function cleanup() {
      cancelBtn.style.visibility = '';
      cancelAnimationFrame(raf);
      removeEventListener('resize', onR);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      cancelBtn.removeEventListener('click', onCancel);
      matchBtn.removeEventListener('pointerdown', strike);
      matchBtn.removeEventListener('pointerup', unstrike);
      matchBtn.removeEventListener('pointerleave', unstrike);
      crackle.stop();
    }

    /* ---- draw ---- */
    function frame() {
      if (cancelled) { cleanup(); resolve('cancelled'); return; }
      raf = requestAnimationFrame(frame);
      const t = now();

      g.clearRect(0, 0, W, H);
      const vg = g.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, Math.max(W, H) * 0.75);
      vg.addColorStop(0, '#0d0920'); vg.addColorStop(1, '#050310');
      g.fillStyle = vg; g.fillRect(0, 0, W, H);

      /* field → mask/glow/char */
      let burnedPx = 0;
      if (state === 'burning' || finishing) {
        const md = maskImg.data, gd = glowImg.data, cd = charImg.data;
        for (let i = 0; i < mw * mh; i++) {
          const dt = t - burnAt[i];
          const j = i * 4;
          let holeA = 0, glowA = 0, charA = 0;
          if (dt > 0) {
            holeA = Math.min(1, dt / 0.4);
            if (holeA >= 1) burnedPx++;
            charA = Math.max(0, 1 - dt / 0.55);
          }
          if (dt > -0.28 && dt < 0.18) {
            const k = 1 - Math.abs(dt - -0.05) / 0.28;
            glowA = Math.max(0, k);
          }
          md[j] = 0; md[j + 1] = 0; md[j + 2] = 0; md[j + 3] = holeA * 255;
          const hot = glowA * glowA;
          gd[j] = 255; gd[j + 1] = 120 + hot * 120; gd[j + 2] = 40 + hot * 120; gd[j + 3] = glowA * 235;
          cd[j] = 24; cd[j + 1] = 12; cd[j + 2] = 8; cd[j + 3] = charA > 0 && dt > 0 ? Math.min(1, charA + 0.2) * 255 : 0;
        }
        maskG.putImageData(maskImg, 0, 0);
        glowG.putImageData(glowImg, 0, 0);
        charG.putImageData(charImg, 0, 0);
      }

      /* compose the paper */
      compG.globalCompositeOperation = 'source-over';
      compG.clearRect(0, 0, art.width, art.height);
      compG.drawImage(art, 0, 0);
      if (state === 'burning' || finishing) {
        compG.globalCompositeOperation = 'source-atop';
        compG.imageSmoothingEnabled = true;
        compG.drawImage(charC, 0, 0, art.width, art.height);
        compG.globalCompositeOperation = 'destination-out';
        compG.drawImage(maskC, 0, 0, art.width, art.height);
      }

      g.save();
      g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 30; g.shadowOffsetY = 14;
      g.drawImage(comp, ax(), ay());
      g.restore();
      if (state === 'burning' || finishing) {
        g.globalCompositeOperation = 'lighter';
        g.drawImage(glowC, ax(), ay(), art.width, art.height);
        g.globalCompositeOperation = 'source-over';
      }

      /* particles */
      if (!reduced && (state === 'burning')) {
        spawnFrom(t, 6, embers, (x, y) => ({ x, y, vx: (Math.random() - 0.5) * 26, vy: -60 - Math.random() * 90, l: 1 }));
        if (Math.random() < 0.5) spawnFrom(t, 2, smokes, (x, y) => ({ x, y, vx: (Math.random() - 0.5) * 12, vy: -34 - Math.random() * 24, l: 1, r: 6 + Math.random() * 8 }));
        if (Math.random() < 0.35) spawnFrom(t, 1, ashes, (x, y) => ({ x, y, vx: (Math.random() - 0.5) * 20, vy: 26 + Math.random() * 30, l: 1, ph: Math.random() * 9 }));
      }
      const dt = 1 / 60;
      g.globalCompositeOperation = 'lighter';
      for (let i = embers.length - 1; i >= 0; i--) {
        const p = embers[i];
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= 20 * dt; p.l -= dt * 1.1;
        if (p.l <= 0) { embers.splice(i, 1); continue; }
        g.fillStyle = `rgba(255,${140 + (p.l * 100) | 0},60,${p.l})`;
        g.beginPath(); g.arc(p.x, p.y, 1.6 + p.l * 1.6, 0, 7); g.fill();
      }
      g.globalCompositeOperation = 'source-over';
      for (let i = smokes.length - 1; i >= 0; i--) {
        const p = smokes[i];
        p.x += p.vx * dt; p.y += p.vy * dt; p.l -= dt * 0.5; p.r += dt * 16;
        if (p.l <= 0) { smokes.splice(i, 1); continue; }
        g.fillStyle = `rgba(150,140,165,${p.l * 0.22})`;
        g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill();
      }
      for (let i = ashes.length - 1; i >= 0; i--) {
        const p = ashes[i];
        p.x += (p.vx + Math.sin(t * 3 + p.ph) * 16) * dt; p.y += p.vy * dt; p.l -= dt * 0.45;
        if (p.l <= 0 || p.y > H) { ashes.splice(i, 1); continue; }
        g.fillStyle = `rgba(70,62,78,${p.l * 0.8})`;
        g.fillRect(p.x, p.y, 3, 2);
      }

      /* the flame in your hand */
      if (state === 'lit' || (state === 'burning' && t - litAt < 9999)) {
        const fx = flame.x, fy = flame.y - 26;
        const fl = 10 + Math.sin(t * 22) * 2 + Math.sin(t * 51) * 1.4;
        const grd = g.createRadialGradient(fx, fy, 1, fx, fy, 34);
        grd.addColorStop(0, 'rgba(255,220,140,.85)'); grd.addColorStop(1, 'rgba(255,140,50,0)');
        g.fillStyle = grd; g.beginPath(); g.arc(fx, fy, 34, 0, 7); g.fill();
        g.fillStyle = '#ffdf9e';
        g.beginPath();
        g.moveTo(fx, fy - fl * 1.7);
        g.quadraticCurveTo(fx + fl * 0.8, fy - fl * 0.3, fx, fy + fl * 0.55);
        g.quadraticCurveTo(fx - fl * 0.8, fy - fl * 0.3, fx, fy - fl * 1.7);
        g.fill();
        g.fillStyle = '#ff9a3c';
        g.beginPath(); g.arc(fx, fy + 2, fl * 0.42, 0, 7); g.fill();
      }

      /* done? */
      if (state === 'burning' && !finishing) {
        const frac = burnedPx / (mw * mh);
        if (frac > 0.965) {
          finishing = t;
          doneEl.textContent = doneText || 'kept in smoke.';
          doneEl.hidden = false;
          cancelBtn.style.visibility = 'hidden';
          crackle.stop();
        }
      }
      if (finishing && t - finishing > 2.3) {
        cleanup(); resolve('burned'); return;
      }
    }
    frame();
  });
}
