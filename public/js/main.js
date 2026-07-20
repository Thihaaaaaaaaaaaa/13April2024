/* ==================================================================
   our little garden — the front-of-house.
   gate → garden → book / line / fire. everything soft, nothing loud.
   ================================================================== */

import { CONFIG, dayNumber, msToNextDay, milestoneSet, fmtDate, startMidnight } from './config.js';
import { api, session, state, mediaUrl, startHeartbeat, onPresence } from './api.js';
import { createGarden } from './garden.js';
import { runBurnRitual } from './burn.js';
import { createAmbient } from './ambient.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const el = {
  gate: $('#gate'), gateCard: $('.gate-card'), gateDay: $('#gate-daynum'),
  stepWho: $('#gate-step-who'), stepKey: $('#gate-step-key'), hello: $('#gate-hello'),
  gateForm: $('#gate-form'), gatePass: $('#gate-pass'), gateError: $('#gate-error'),
  gateVisit: $('#gate-visit'), gateBack: $('#gate-back'),
  hud: $('#hud'), hudDay: $('#hud-daynum'), hudCountdown: $('#hud-countdown'),
  hudPresence: $('#hud-presence'), hudSound: $('#hud-sound'), hudLock: $('#hud-lock'), hudMe: $('#hud-me'),
  ghostNote: $('#ghost-note'),
  journal: $('#journal'), bookLeft: $('#book-left'), bookRight: $('#book-right'),
  bookPrev: $('#book-prev'), bookNext: $('#book-next'), bookWhere: $('#book-where'), bookWrite: $('#book-write'),
  bookEl: $('.book'),
  writer: $('#writer'), writerForm: $('#writer-form'), writerDate: $('#writer-date'),
  writerTitle: $('#writer-title'), writerMoods: $('#writer-moods'), writerBody: $('#writer-body'),
  writerAuthor: $('#writer-author'), writerError: $('#writer-error'),
  gallery: $('#gallery'), galleryLines: $('#gallery-lines'), galleryEmpty: $('#gallery-empty'), galleryAdd: $('#gallery-add'),
  uploader: $('#uploader'), drop: $('#drop'), fileInput: $('#file-input'), uploadList: $('#upload-list'),
  uploadCaption: $('#upload-caption'), uploadDate: $('#upload-date'), uploadGo: $('#upload-go'), uploadStatus: $('#upload-status'),
  viewer: $('#viewer'), viewerMedia: $('#viewer-media'), viewerCaption: $('#viewer-caption'),
  viewerBy: $('#viewer-by'), viewerDate: $('#viewer-date'), viewerPrev: $('#viewer-prev'), viewerNext: $('#viewer-next'), viewerBurn: $('#viewer-burn'),
  burnpick: $('#burnpick'), burnGrid: $('#burn-grid'), burnEmpty: $('#burn-empty'),
  ritual: $('#ritual'), ritualCanvas: $('#ritual-canvas'), ritualMatch: $('#ritual-match'),
  ritualHint: $('#ritual-hint'), ritualCancel: $('#ritual-cancel'), ritualDone: $('#ritual-done'),
  tvguide: $('#tvguide'), tvList: $('#tv-list'), tvEmpty: $('#tv-empty'), tvAdd: $('#tv-add'),
  tvControls: $('#tv-controls'), tvcTitle: $('#tvc-title'), tvcPause: $('#tvc-pause'),
  tvcNext: $('#tvc-next'), tvcStop: $('#tvc-stop'),
  toasts: $('#toasts'), loading: $('#loading'), loadingText: $('#loading-text'),
  sceneLabel: $('#scene-label'),
};

let memories = [], pages = [], burnTab = 'photos';
if (session.profile) el.gate.hidden = true;   // returning visitor: no gate flash
const ambient = createAmbient();

/* ---------------- toasts ---------------- */
function toast(msg, err = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  el.toasts.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

/* ---------------- the garden ---------------- */
const garden = createGarden($('#scene'), {
  reducedMotion: reduced,
  labelEl: el.sceneLabel,
  onHotspot: name => openArea(name),
  onReady: () => setTimeout(() => el.loading.classList.add('hidden'), 900),
  onFail: () => {
    el.loading.classList.add('hidden');
    toast('this device could not grow the 3D garden — the book and the line still work', true);
  },
});
garden.setDay(dayNumber(), milestoneSet(dayNumber()));

/* ---------------- day counter ---------------- */
let shownDay = dayNumber();
function paintDay() {
  const d = dayNumber();
  el.gateDay.textContent = d;
  el.hudDay.textContent = d;
  const ms = msToNextDay();
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  el.hudCountdown.textContent = h > 0 ? `${h}h ${m}m` : `${m}m`;
  if (d !== shownDay) {
    shownDay = d;
    garden.setDay(d, milestoneSet(d), true);
    toast(`a new rose just bloomed — day ${d} 🌹`);
    renderBook();
  }
}
paintDay();
setInterval(paintDay, 30 * 1000);

/* ---------------- gate ---------------- */
let pendingProfile = '';

function showGate() {
  el.gate.hidden = false;
  el.gate.classList.remove('leaving');
  el.stepWho.hidden = false;
  el.stepKey.hidden = true;
  // offer a lock if a key is on this device
  let lockBtn = $('#gate-lock');
  if (session.token && !lockBtn) {
    lockBtn = document.createElement('button');
    lockBtn.id = 'gate-lock';
    lockBtn.type = 'button';
    lockBtn.className = 'btn-ghostly small';
    lockBtn.textContent = '🔒 lock the gate on this device';
    lockBtn.addEventListener('click', () => {
      session.token = '';
      lockBtn.remove();
      toast('the gate is locked — you can still look around');
      updateEditingUI();
    });
    el.stepWho.appendChild(lockBtn);
  } else if (!session.token && lockBtn) lockBtn.remove();
}

function closeGate(welcome) {
  el.gate.classList.add('leaving');
  setTimeout(() => { el.gate.hidden = true; }, 850);
  el.hud.hidden = false;
  el.hudMe.textContent = session.profile ? `${CONFIG.profiles[session.profile]?.emoji || ''} ${session.profile}` : 'someone';
  startHeartbeat();
  updateEditingUI();
  if (welcome) toast(welcome);
}

$$('.profile-card').forEach(btn => btn.addEventListener('click', () => {
  pendingProfile = btn.dataset.profile;
  el.hello.textContent = pendingProfile;
  el.stepWho.hidden = true;
  el.stepKey.hidden = false;
  el.gateError.hidden = true;
  setTimeout(() => el.gatePass.focus(), 60);
}));

el.gateBack.addEventListener('click', () => {
  el.stepKey.hidden = true;
  el.stepWho.hidden = false;
});

el.gateVisit.addEventListener('click', () => {
  session.profile = pendingProfile;
  session.token = '';
  closeGate(`welcome, ${pendingProfile} — looking only, touching nothing`);
});

el.gateForm.addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const { token } = await api.login(el.gatePass.value.trim());
    session.token = token;
    session.profile = pendingProfile;
    el.gatePass.value = '';
    const p = CONFIG.profiles[pendingProfile] || {};
    closeGate(`the gate opens for you, ${pendingProfile} ${p.emoji || ''}`);
  } catch (err) {
    el.gateError.textContent = err.message;
    el.gateError.hidden = false;
    el.gateCard.classList.remove('shake');
    void el.gateCard.offsetWidth;
    el.gateCard.classList.add('shake');
  }
});

el.hudLock.addEventListener('click', () => showGate());

el.hudSound.addEventListener('click', async () => {
  const on = await ambient.toggle();
  el.hudSound.textContent = on ? '🔊 sound' : '🔇 sound';
  el.hudSound.setAttribute('aria-pressed', String(on));
});

/* ---------------- presence ---------------- */
let lastSeen = new Set();
onPresence((st, seatChanged) => {
  const others = st.online.filter(o => !o.you && o.profile);
  el.hudPresence.innerHTML = '';
  const seen = new Set();
  for (const o of others) {
    if (seen.has(o.profile)) continue;
    seen.add(o.profile);
    const p = CONFIG.profiles[o.profile] || {};
    const pill = document.createElement('span');
    pill.className = 'presence-pill';
    pill.innerHTML = `<span class="dot"></span>${p.emoji || ''} ${o.profile} is in the garden`;
    el.hudPresence.appendChild(pill);
    if (!lastSeen.has(o.profile)) toast(`${p.emoji || ''} ${o.profile} just walked into the garden`);
  }
  lastSeen = seen;
  el.ghostNote.hidden = st.seat;
  if (seatChanged) updateEditingUI();
});

function updateEditingUI() {
  const editing = state.editing;
  el.bookWrite.hidden = !editing;
  el.galleryAdd.hidden = !editing;
  el.viewerBurn.hidden = !editing;
  el.hudMe.textContent = session.profile ? `${CONFIG.profiles[session.profile]?.emoji || ''} ${session.profile}` : 'someone';
}

/* ---------------- overlays ---------------- */
const areas = { journal: el.journal, gallery: el.gallery, burn: el.burnpick, tv: el.tvguide };
function anyOverlayOpen() {
  return $$('.overlay').some(o => !o.hidden) || !el.ritual.hidden;
}
function closeAllOverlays() {
  $$('.overlay').forEach(o => { o.hidden = true; });
}
function openArea(name) {
  if (!el.gate.hidden) return;
  closeAllOverlays();
  if (name === 'journal') { renderBook(); el.journal.hidden = false; }
  if (name === 'gallery') { renderGallery(); el.gallery.hidden = false; }
  if (name === 'burn') { renderBurnGrid(); el.burnpick.hidden = false; }
  if (name === 'tv') {
    if (garden.tv.state() === 'play') { onTvToggle(); return; }   // tapping the set = pause/resume
    renderTVGuide(); el.tvguide.hidden = false;
  }
}
$$('[data-close]').forEach(b => b.addEventListener('click', () => {
  b.closest('.overlay').hidden = true;
}));
addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (garden.tv.state() === 'play') { garden.tv.stop(); el.tvControls.hidden = true; return; }
    const open = $$('.overlay').filter(o => !o.hidden);
    if (open.length) open[open.length - 1].hidden = true;
  }
});

/* ==================================================================
   the book
   ================================================================== */
const isNarrow = () => matchMedia('(max-width: 680px)').matches;
let spread = -1;   // -1 → newest by default
let mobileIdx = -1;

function sheets() {
  return [{ opening: true }, ...pages];
}

function openingSheetHTML() {
  const d = dayNumber();
  const ms = milestoneSet(d + 500);
  const past = [...ms.entries()].filter(([day]) => day <= d).slice(-4);
  const next = [...ms.entries()].filter(([day]) => day > d).slice(0, 2);
  const dateOf = day => {
    const dt = new Date(startMidnight());
    dt.setDate(dt.getDate() + day - 1);
    return fmtDate(dt);
  };
  const smoke = [
    ...pages.filter(p => p.burned).map(p => ({ what: p.title || 'a page', when: p.burned_at })),
    ...memories.filter(m => m.burned).map(m => ({ what: m.caption || (m.kind === 'video' ? 'a moving picture' : 'a photograph'), when: m.burned_at })),
  ].sort((a, b) => String(b.when).localeCompare(String(a.when))).slice(0, 6);

  return `
    <p class="page-kicker">our story</p>
    <h3 class="page-title">Lina <span class="amp">&amp;</span> Thiha</h3>
    <p class="page-date">since ${fmtDate(startMidnight())} — day ${d} of us</p>
    <p class="page-body">one rose in the garden for every day we've had. this book keeps the rest: the pictures on the line, the pages we write, and the things we chose to let the fire hold.</p>
    <ul class="mile-list">
      ${past.map(([day, m]) => `<li><span class="gold">${m.kind === 'anniv' ? '🌹' : '✦'} ${m.label}</span><span>${dateOf(day)}</span></li>`).join('')}
      ${next.map(([day, m]) => `<li class="soon"><span>${m.kind === 'anniv' ? '🥀' : '◦'} ${m.label}</span><span>${dateOf(day)} · in ${day - d} days</span></li>`).join('')}
    </ul>
    ${smoke.length ? `<p class="page-kicker" style="margin-top:18px">kept in smoke</p>
      <ul class="smoke-list">${smoke.map(s => `<li>${escapeHtml(s.what)} — ${fmtDate(s.when)}</li>`).join('')}</ul>` : ''}
  `;
}

function entrySheetHTML(p, idx) {
  if (p.burned) {
    return `<div class="page-ashen"><span class="ash-mark">🕯</span>
      this page was given to the fire${p.burned_by ? ` by ${p.burned_by}` : ''}<br/>on ${fmtDate(p.burned_at)}.<br/><br/>
      <em>${escapeHtml(p.title || '')}</em></div>`;
  }
  const canBurn = state.editing;
  return `
    ${p.mood ? `<span class="page-mood">${p.mood}</span>` : ''}
    <p class="page-kicker">page ${idx}</p>
    ${p.title ? `<h3 class="page-title">${escapeHtml(p.title)}</h3>` : ''}
    <p class="page-date">${fmtDate(p.created_at)}</p>
    <p class="page-body">${escapeHtml(p.body)}</p>
    <p class="page-sign"><span class="who-${p.author}">— ${p.author} ${CONFIG.profiles[p.author]?.emoji || ''}</span></p>
    ${canBurn ? `<div class="page-actions"><button class="page-burnlink" data-burn-page="${p.id}">give this page to the fire</button></div>` : ''}
  `;
}

function renderBook() {
  const sh = sheets();
  if (isNarrow()) {
    if (mobileIdx < 0 || mobileIdx >= sh.length) mobileIdx = sh.length - 1;
    el.bookEl.classList.remove('show-left');
    el.bookRight.innerHTML = sh[mobileIdx].opening ? openingSheetHTML() : entrySheetHTML(sh[mobileIdx], mobileIdx);
    el.bookWhere.textContent = `page ${mobileIdx + 1} of ${sh.length}`;
    el.bookPrev.disabled = mobileIdx <= 0;
    el.bookNext.disabled = mobileIdx >= sh.length - 1;
  } else {
    const nSpreads = Math.max(1, Math.ceil(sh.length / 2));
    if (spread < 0 || spread >= nSpreads) spread = nSpreads - 1;
    const li = spread * 2, ri = spread * 2 + 1;
    el.bookLeft.innerHTML = sh[li] ? (sh[li].opening ? openingSheetHTML() : entrySheetHTML(sh[li], li)) : '';
    el.bookRight.innerHTML = sh[ri] ? (sh[ri].opening ? openingSheetHTML() : entrySheetHTML(sh[ri], ri))
      : `<div class="page-ashen" style="color:#a89a8a"><span class="ash-mark">✒</span>the next page is waiting.</div>`;
    el.bookWhere.textContent = `spread ${spread + 1} of ${nSpreads}`;
    el.bookPrev.disabled = spread <= 0;
    el.bookNext.disabled = spread >= nSpreads - 1;
  }
  $$('[data-burn-page]').forEach(b => b.addEventListener('click', () => {
    const p = pages.find(x => x.id === Number(b.dataset.burnPage));
    if (p) startBurn({ kind: 'page', page: p });
  }));
}
el.bookPrev.addEventListener('click', () => { if (isNarrow()) mobileIdx--; else spread--; renderBook(); });
el.bookNext.addEventListener('click', () => { if (isNarrow()) mobileIdx++; else spread++; renderBook(); });

/* ---- writing ---- */
const MOODS = ['💌', '🌷', '✨', '😌', '🥺', '🔥', '🌧', '🫶'];
let mood = '';
el.bookWrite.addEventListener('click', () => {
  el.writerDate.textContent = fmtDate(new Date());
  el.writerAuthor.textContent = `${session.profile} ${CONFIG.profiles[session.profile]?.emoji || ''}`;
  el.writerTitle.value = ''; el.writerBody.value = ''; mood = '';
  el.writerMoods.innerHTML = MOODS.map(m =>
    `<button type="button" class="mood-chip" role="radio" aria-checked="false" data-mood="${m}">${m}</button>`).join('');
  $$('.mood-chip').forEach(c => c.addEventListener('click', () => {
    mood = mood === c.dataset.mood ? '' : c.dataset.mood;
    $$('.mood-chip').forEach(x => x.setAttribute('aria-checked', String(x.dataset.mood === mood)));
  }));
  el.writerError.hidden = true;
  el.journal.hidden = true;
  el.writer.hidden = false;
  setTimeout(() => el.writerBody.focus(), 80);
});

el.writer.querySelector('[data-close]').addEventListener('click', () => {
  setTimeout(() => openArea('journal'), 0);
});

el.writerForm.addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const row = await api.createPage({
      title: el.writerTitle.value.trim(),
      body: el.writerBody.value,
      mood, author: session.profile,
    });
    pages.push(row);
    spread = -1; mobileIdx = -1;
    el.writer.hidden = true;
    openArea('journal');
    toast('pressed into the book ✍️');
  } catch (err) {
    el.writerError.textContent = err.message;
    el.writerError.hidden = false;
  }
});

/* ==================================================================
   the line (gallery)
   ================================================================== */
const visibleMemories = () => memories.filter(m => !m.burned);

function polaroidHTML(m) {
  const media = m.has_thumb
    ? `<img src="${mediaUrl(m.id, true)}" alt="" loading="lazy" />`
    : m.kind === 'image'
      ? `<img src="${mediaUrl(m.id)}" alt="" loading="lazy" />`
      : `<span style="font-size:34px">🎞</span>`;
  return `
    <div class="polaroid-media">${media}${m.kind === 'video' ? '<span class="play-badge">▶</span>' : ''}</div>
    <span class="polaroid-caption">
      <span class="hand">${escapeHtml(m.caption || '')}</span>
      <span class="polaroid-meta">${m.uploaded_by} · ${fmtDate(m.taken_on || m.created_at)}</span>
    </span>`;
}

function renderGallery() {
  const vis = visibleMemories();
  el.galleryEmpty.hidden = vis.length > 0;
  el.galleryLines.innerHTML = '';
  const w = Math.min(innerWidth, 1200);
  const per = w < 560 ? 2 : w < 820 ? 3 : w < 1020 ? 4 : 5;
  for (let i = 0; i < vis.length; i += per) {
    const row = document.createElement('div');
    row.className = 'rope-row';
    for (const m of vis.slice(i, i + per)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'polaroid';
      b.style.setProperty('--tilt', `${((m.id * 47) % 9) - 4}deg`);
      b.style.setProperty('--swayd', `${(m.id % 7) * -0.9}s`);
      b.innerHTML = polaroidHTML(m);
      b.addEventListener('click', () => openViewer(vis.indexOf(m)));
      row.appendChild(b);
    }
    el.galleryLines.appendChild(row);
  }
}

/* ---- viewer ---- */
let viewIdx = 0;
function openViewer(i) {
  const vis = visibleMemories();
  if (!vis.length) return;
  viewIdx = (i + vis.length) % vis.length;
  const m = vis[viewIdx];
  el.viewerMedia.innerHTML = '';
  if (m.kind === 'image') {
    const img = new Image();
    img.src = mediaUrl(m.id);
    img.alt = m.caption || 'a memory';
    el.viewerMedia.appendChild(img);
  } else {
    const v = document.createElement('video');
    v.src = mediaUrl(m.id);
    v.controls = true; v.playsInline = true;
    if (m.has_thumb) v.poster = mediaUrl(m.id, true);
    el.viewerMedia.appendChild(v);
  }
  el.viewerCaption.textContent = m.caption || '';
  el.viewerBy.textContent = `${CONFIG.profiles[m.uploaded_by]?.emoji || ''} ${m.uploaded_by}`;
  el.viewerDate.textContent = fmtDate(m.taken_on || m.created_at);
  el.viewer.hidden = false;
  el.viewerBurn.onclick = () => startBurn({ kind: 'photo', mem: m });
}
el.viewerPrev.addEventListener('click', () => openViewer(viewIdx - 1));
el.viewerNext.addEventListener('click', () => openViewer(viewIdx + 1));
el.galleryAdd.addEventListener('click', () => { resetUploader(); el.uploader.hidden = false; });

/* ==================================================================
   uploading
   ================================================================== */
let queue = [];   // {file, thumb, kind, li}

function resetUploader() {
  queue = [];
  el.uploadList.innerHTML = '';
  el.uploadCaption.value = '';
  el.uploadDate.value = new Date().toISOString().slice(0, 10);
  el.uploadStatus.textContent = '';
  el.uploadGo.disabled = true;
}

function blobFromCanvas(c, q = 0.85) {
  return new Promise(res => c.toBlob(b => res(b), 'image/jpeg', q));
}

async function shrinkImage(file, max = 1600, q = 0.85) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = rej; i.src = url;
    });
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s);
    c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const full = await blobFromCanvas(c, q);
    const ts = Math.min(1, 480 / Math.max(c.width, c.height));
    const tc = document.createElement('canvas');
    tc.width = Math.round(c.width * ts); tc.height = Math.round(c.height * ts);
    tc.getContext('2d').drawImage(c, 0, 0, tc.width, tc.height);
    const thumb = await blobFromCanvas(tc, 0.8);
    return { full: new File([full], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }), thumb };
  } finally { URL.revokeObjectURL(url); }
}

function videoThumb(file) {
  return new Promise(res => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    const fail = () => { URL.revokeObjectURL(url); res(null); };
    const grab = () => {
      try {
        const c = document.createElement('canvas');
        const s = Math.min(1, 480 / Math.max(v.videoWidth || 1, v.videoHeight || 1));
        c.width = Math.round((v.videoWidth || 320) * s);
        c.height = Math.round((v.videoHeight || 240) * s);
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        c.toBlob(b => { URL.revokeObjectURL(url); res(b); }, 'image/jpeg', 0.8);
      } catch { fail(); }
    };
    v.onloadeddata = () => { v.currentTime = Math.min(0.4, (v.duration || 1) / 3); };
    v.onseeked = grab;
    v.onerror = fail;
    setTimeout(fail, 8000);
  });
}

async function addFiles(files) {
  for (const f of files) {
    if (f.type.startsWith('image/')) {
      el.uploadStatus.textContent = 'softening the photo…';
      try {
        const { full, thumb } = await shrinkImage(f);
        pushQueued(full, thumb, 'image');
      } catch { toast(`couldn't read ${f.name}`, true); }
    } else if (f.type.startsWith('video/')) {
      if (f.size > 60 * 1024 * 1024) { toast(`${f.name} is heavier than 60 MB`, true); continue; }
      el.uploadStatus.textContent = 'catching a frame from the video…';
      const thumb = await videoThumb(f);
      pushQueued(f, thumb, 'video');
    } else toast(`${f.name} isn't a photo or a video`, true);
  }
  el.uploadStatus.textContent = queue.length ? `${queue.length} ready to hang` : '';
  el.uploadGo.disabled = queue.length === 0;
}

function pushQueued(file, thumb, kind) {
  const li = document.createElement('li');
  const preview = (thumb || kind === 'image')
    ? `<img src="${URL.createObjectURL(thumb || file)}" alt="" />`
    : `<span style="display:grid;place-items:center;height:100%;font-size:26px">🎞</span>`;
  li.innerHTML = `${preview}<button class="rm" type="button" aria-label="remove">✕</button><span class="bar"></span>`;
  li.querySelector('.rm').addEventListener('click', () => {
    queue = queue.filter(q => q.li !== li);
    li.remove();
    el.uploadGo.disabled = queue.length === 0;
    el.uploadStatus.textContent = queue.length ? `${queue.length} ready to hang` : '';
  });
  el.uploadList.appendChild(li);
  queue.push({ file, thumb, kind, li });
}

el.fileInput.addEventListener('change', () => { addFiles([...el.fileInput.files]); el.fileInput.value = ''; });
['dragover', 'dragenter'].forEach(ev => el.drop.addEventListener(ev, e => { e.preventDefault(); el.drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => el.drop.addEventListener(ev, e => { e.preventDefault(); el.drop.classList.remove('over'); }));
el.drop.addEventListener('drop', e => addFiles([...e.dataTransfer.files]));

el.uploadGo.addEventListener('click', async () => {
  el.uploadGo.disabled = true;
  let ok = 0;
  for (const q of queue) {
    const bar = q.li.querySelector('.bar');
    try {
      const row = await api.uploadMemory(
        { file: q.file, thumb: q.thumb, caption: el.uploadCaption.value.trim(), takenOn: el.uploadDate.value || null },
        p => { bar.style.width = `${Math.round(p * 100)}%`; });
      q.li.classList.add('done');
      memories.unshift(row);
      ok++;
    } catch (err) {
      toast(err.message, true);
      el.uploadGo.disabled = false;
    }
  }
  if (ok) {
    memories.sort((a, b) => String(b.taken_on || b.created_at).localeCompare(String(a.taken_on || a.created_at)));
    renderGallery();
    garden.setPhotos(visibleMemories().filter(m => m.has_thumb || m.kind === 'image').slice(0, 5));
    toast(ok === 1 ? 'hung on the line 🧺' : `${ok} memories hung on the line 🧺`);
    setTimeout(() => { el.uploader.hidden = true; el.gallery.hidden = false; }, 700);
  }
});

/* ==================================================================
   the little cinema
   ================================================================== */
const tvTapes = () => memories.filter(m => m.kind === 'video' && !m.burned);
let tapeIdx = -1;

function renderTVGuide() {
  const tapes = tvTapes();
  el.tvEmpty.hidden = tapes.length > 0;
  el.tvList.innerHTML = '';
  tapes.forEach((m, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tape';
    b.innerHTML = `
      <span class="tape-media">${m.has_thumb ? `<img src="${mediaUrl(m.id, true)}" alt=""/>` : '🎞'}</span>
      <span class="tape-label">${escapeHtml(m.caption || 'untitled tape')}
        <span class="tape-meta">${m.uploaded_by} · ${fmtDate(m.taken_on || m.created_at)}</span></span>`;
    b.addEventListener('click', () => playTape(i));
    el.tvList.appendChild(b);
  });
}

function playTape(i) {
  const tapes = tvTapes();
  if (!tapes.length) return;
  tapeIdx = ((i % tapes.length) + tapes.length) % tapes.length;
  const m = tapes[tapeIdx];
  closeAllOverlays();
  const ok = garden.tv.play(mediaUrl(m.id), () => {
    el.tvControls.hidden = true;
    toast('the tape ran out 📼');
  });
  if (!ok) { toast('the television is still warming up — one moment', true); return; }
  el.tvcTitle.textContent = m.caption || 'untitled tape';
  el.tvcPause.textContent = '⏸';
  el.tvControls.hidden = false;
}

function onTvToggle() {
  const st = garden.tv.toggle();
  if (st === 'off') return;
  el.tvcPause.textContent = st === 'paused' ? '▶' : '⏸';
  el.tvControls.hidden = false;
}
el.tvcPause.addEventListener('click', onTvToggle);
el.tvcStop.addEventListener('click', () => { garden.tv.stop(); el.tvControls.hidden = true; });
el.tvcNext.addEventListener('click', () => playTape(tapeIdx + 1));
el.tvAdd.addEventListener('click', () => { resetUploader(); el.tvguide.hidden = true; el.uploader.hidden = false; });

/* ==================================================================
   the fire
   ================================================================== */
$$('.burn-tab').forEach(t => t.addEventListener('click', () => {
  burnTab = t.dataset.tab;
  $$('.burn-tab').forEach(x => x.classList.toggle('is-on', x === t));
  renderBurnGrid();
}));

function renderBurnGrid() {
  el.burnGrid.innerHTML = '';
  if (!state.editing) {
    el.burnEmpty.textContent = 'only keepers of the secret may light the match. you are welcome to sit by it.';
    el.burnEmpty.hidden = false;
    return;
  }
  let items;
  if (burnTab === 'photos') {
    items = visibleMemories();
    el.burnEmpty.textContent = 'nothing on the line to burn — and maybe that is a good thing.';
  } else {
    items = pages.filter(p => !p.burned);
    el.burnEmpty.textContent = 'no pages in the book yet.';
  }
  el.burnEmpty.hidden = items.length > 0;
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'burn-item';
    if (burnTab === 'photos') {
      const src = it.has_thumb ? mediaUrl(it.id, true) : it.kind === 'image' ? mediaUrl(it.id) : null;
      b.innerHTML = `<span class="bi-media">${src ? `<img src="${src}" alt=""/>` : '🎞'}</span>
        <span class="bi-cap">${escapeHtml(it.caption || fmtDate(it.taken_on || it.created_at))}</span>`;
      b.addEventListener('click', () => startBurn({ kind: 'photo', mem: it }));
    } else {
      b.innerHTML = `<span class="bi-page">${escapeHtml((it.title ? it.title + ' — ' : '') + it.body).slice(0, 110)}</span>
        <span class="bi-cap">${fmtDate(it.created_at)} · ${it.author}</span>`;
      b.addEventListener('click', () => startBurn({ kind: 'page', page: it }));
    }
    el.burnGrid.appendChild(b);
  }
}

async function startBurn(target) {
  if (!state.editing) return;
  const isPhoto = target.kind === 'photo';
  const label = isPhoto
    ? (target.mem.caption || 'this photograph')
    : (target.page.title || 'this page');
  const sure = confirm(`give ${isPhoto ? 'this memory' : 'this page'} to the fire?\n\n“${label}”\n\nonce it burns, it is gone from the book forever. only the date stays, kept in smoke.`);
  if (!sure) return;

  closeAllOverlays();
  el.ritual.hidden = false;

  const item = isPhoto
    ? {
        type: 'photo',
        src: target.mem.kind === 'image' ? mediaUrl(target.mem.id) : mediaUrl(target.mem.id, true),
        caption: target.mem.caption,
        meta: `${target.mem.uploaded_by} · ${fmtDate(target.mem.taken_on || target.mem.created_at)}`,
      }
    : {
        type: 'page',
        title: target.page.title,
        body: target.page.body,
        sign: target.page.author,
        meta: fmtDate(target.page.created_at),
      };

  const result = await runBurnRitual({
    canvas: el.ritualCanvas,
    matchBtn: el.ritualMatch,
    hintEl: el.ritualHint,
    doneEl: el.ritualDone,
    cancelBtn: el.ritualCancel,
    item, reduced,
    audio: ambient.on,
    doneText: `kept in smoke · ${fmtDate(new Date())}`,
  });

  el.ritual.hidden = true;
  if (result !== 'burned') { openArea('burn'); return; }

  try {
    if (isPhoto) {
      const row = await api.burnMemory(target.mem.id);
      Object.assign(target.mem, row);
      renderGallery();
      garden.setPhotos(visibleMemories().filter(m => m.has_thumb || m.kind === 'image').slice(0, 5));
    } else {
      const row = await api.burnPage(target.page.id);
      Object.assign(target.page, row);
    }
    renderBook();
    toast('kept in smoke 🕊');
  } catch (err) {
    toast(`the fire went out — it's still safe in the book. (${err.message})`, true);
  }
}

/* ==================================================================
   boot
   ================================================================== */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function loadData() {
  try {
    const [mem, pg] = await Promise.all([api.memories(), api.pages()]);
    memories = mem; pages = pg;
    garden.setPhotos(visibleMemories().filter(m => m.has_thumb || m.kind === 'image').slice(0, 5));
  } catch {
    toast('the book could not be reached — check the connection', true);
  }
}

(async () => {
  try {
    const cfg = await api.config();
    if (cfg.startDate) CONFIG.startDate = cfg.startDate;
    if (Array.isArray(cfg.names) && cfg.names.length === 2) CONFIG.names = cfg.names;
    if (cfg.demo) toast('demo mode — nothing is saved until a database is connected', true);
    shownDay = dayNumber();
    garden.setDay(shownDay, milestoneSet(shownDay));
    paintDay();
  } catch { /* offline: defaults hold */ }
  await loadData();
  if (session.profile) {
    closeGate(session.token ? `welcome back, ${session.profile} ${CONFIG.profiles[session.profile]?.emoji || ''}` : '');
    el.gate.hidden = true;
  } else {
    showGate();
  }
})();
