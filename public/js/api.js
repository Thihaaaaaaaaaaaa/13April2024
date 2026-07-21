/* Talking to the garden's server: identity, presence, and the book's contents. */

const LS = window.localStorage;

export const session = {
  get id() {
    let id = LS.getItem('garden.session');
    if (!id) {
      id = 's-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      LS.setItem('garden.session', id);
    }
    return id;
  },
  get profile() { return LS.getItem('garden.profile') || ''; },
  set profile(v) { v ? LS.setItem('garden.profile', v) : LS.removeItem('garden.profile'); },
  get token() { return LS.getItem('garden.token') || ''; },
  set token(v) { v ? LS.setItem('garden.token', v) : LS.removeItem('garden.token'); },
};

export const state = {
  config: null,
  seat: true,
  online: [],
  sitting: false,
  bothSeatedAt: null,   // server-timestamp: when the 2nd logged-in partner sat down (authoritative clock)
  serverNow: null,
  get editing() { return !!session.token && state.seat; },
};

function headers(json = true) {
  const h = { 'x-session-id': session.id };
  if (session.profile) h['x-profile'] = session.profile;
  if (session.token) h['authorization'] = 'Bearer ' + session.token;
  if (json) h['content-type'] = 'application/json';
  return h;
}

async function jfetch(url, opts = {}) {
  const res = await fetch(url, opts);
  let body = null;
  try { body = await res.json(); } catch { /* non-json */ }
  if (!res.ok) {
    const err = new Error((body && body.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}

export const api = {
  config: () => jfetch('/api/config'),
  login: password => jfetch('/api/auth', { method: 'POST', headers: headers(), body: JSON.stringify({ password }) }),
  presence: () => jfetch('/api/presence', {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ sessionId: session.id, profile: session.profile, editing: !!session.token, sitting: !!state.sitting }),
  }),
  memories: () => jfetch('/api/memories'),
  pages: () => jfetch('/api/pages'),
  createPage: p => jfetch('/api/pages', { method: 'POST', headers: headers(), body: JSON.stringify(p) }),
  updatePage: (id, p) => jfetch(`/api/pages/${id}`, { method: 'PATCH', headers: headers(), body: JSON.stringify(p) }),
  burnPage: id => jfetch(`/api/pages/${id}/burn`, { method: 'POST', headers: headers(), body: JSON.stringify({ burned_by: session.profile }) }),
  updateMemory: (id, p) => jfetch(`/api/memories/${id}`, { method: 'PATCH', headers: headers(), body: JSON.stringify(p) }),
  burnMemory: id => jfetch(`/api/memories/${id}/burn`, { method: 'POST', headers: headers(), body: JSON.stringify({ burned_by: session.profile }) }),

  /* multipart upload with progress callback */
  uploadMemory({ file, thumb, caption, takenOn }, onProgress) {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append('file', file, file.name || 'memory');
      if (thumb) fd.append('thumb', thumb, 'thumb.jpg');
      fd.append('caption', caption || '');
      if (takenOn) fd.append('taken_on', takenOn);
      fd.append('uploaded_by', session.profile || '');

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/memories');
      const h = headers(false);
      for (const k of Object.keys(h)) xhr.setRequestHeader(k, h[k]);
      xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        let body = null;
        try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body);
        else reject(new Error((body && body.error) || `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error('Upload failed — the garden could not be reached.'));
      xhr.send(fd);
    });
  },
};

export const mediaUrl = (id, thumb = false) => `/api/media/${id}${thumb ? '?thumb=1' : ''}`;

/* ------------- presence heartbeat ------------- */

const listeners = new Set();
export function onPresence(fn) { listeners.add(fn); return () => listeners.delete(fn); }

let beatTimer = null;
let beating = false;
async function beat() {
  if (beating) return;
  beating = true;
  try {
    const p = await api.presence();
    const seatChanged = state.seat !== p.seat;
    state.seat = p.seat;
    state.online = p.online || [];
    state.bothSeatedAt = p.bothSeatedAt ?? null;
    state.serverNow = p.serverNow ?? Date.now();
    listeners.forEach(fn => fn(state, seatChanged));
  } catch { /* offline; keep last known state */ }
  beating = false;
}
export function startHeartbeat() {
  beat();
  clearInterval(beatTimer);
  beatTimer = setInterval(beat, state.sitting ? 1000 : 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) beat(); });
}
// call right after sitting down or standing up so the other browser learns about it
// within a second, and switch the polling cadence to match
export function pokePresence() {
  clearInterval(beatTimer);
  beatTimer = setInterval(beat, state.sitting ? 1000 : 20000);
  beat();
}
