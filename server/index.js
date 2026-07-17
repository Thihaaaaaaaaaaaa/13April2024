/* ------------------------------------------------------------------ *
 *  our little garden — server                                         *
 *  Express + Postgres (Neon). Photos/videos live as bytea rows,       *
 *  journal pages as text. Editing needs the shared password; the      *
 *  garden seats two people at a time — everyone else visits as a      *
 *  ghost (view only).                                                 *
 * ------------------------------------------------------------------ */

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const EDIT_PASSWORD = process.env.EDIT_PASSWORD || '13424';
const START_DATE = process.env.ANNIVERSARY || '2024-04-13';
const NAMES = (process.env.NAMES || 'Lina,Thiha').split(',').map(s => s.trim());
const MAX_SEATS = 2;
const MAX_UPLOAD = 60 * 1024 * 1024;          // 60 MB per file
const SECRET = process.env.SESSION_SECRET
  || crypto.createHash('sha256').update('garden-salt::' + EDIT_PASSWORD).digest('hex');

const EDIT_TOKEN = crypto.createHmac('sha256', SECRET).update('garden-edit-v1').digest('hex');

/* ---------------------------------------------------------------- */
/*  storage — Postgres when DATABASE_URL is set, otherwise an        */
/*  in-memory demo store so the site can be previewed locally.       */
/* ---------------------------------------------------------------- */

const DATABASE_URL = process.env.DATABASE_URL || '';
let pool = null;
let demo = null;

if (DATABASE_URL) {
  const needsSSL = !/localhost|127\.0\.0\.1/.test(DATABASE_URL);
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: needsSSL ? { rejectUnauthorized: false } : false,
    max: 4,
  });
} else {
  console.warn('[garden] DATABASE_URL not set — running with an in-memory demo store. Nothing will be saved.');
  demo = { memories: [], pages: [], nextMem: 1, nextPage: 1 };
}

async function initDb() {
  if (!pool) return;
  const ddl = `
    CREATE TABLE IF NOT EXISTS memories (
      id          SERIAL PRIMARY KEY,
      kind        TEXT NOT NULL CHECK (kind IN ('image','video')),
      mime        TEXT NOT NULL,
      data        BYTEA,
      thumb       BYTEA,
      thumb_mime  TEXT,
      caption     TEXT NOT NULL DEFAULT '',
      taken_on    DATE,
      uploaded_by TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      bytes       INTEGER NOT NULL DEFAULT 0,
      burned      BOOLEAN NOT NULL DEFAULT false,
      burned_at   TIMESTAMPTZ,
      burned_by   TEXT
    );
    CREATE TABLE IF NOT EXISTS pages (
      id          SERIAL PRIMARY KEY,
      title       TEXT NOT NULL DEFAULT '',
      body        TEXT NOT NULL DEFAULT '',
      mood        TEXT NOT NULL DEFAULT '',
      author      TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      burned      BOOLEAN NOT NULL DEFAULT false,
      burned_at   TIMESTAMPTZ,
      burned_by   TEXT
    );
  `;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await pool.query(ddl);
      console.log('[garden] database ready');
      return;
    } catch (err) {
      console.error(`[garden] db init attempt ${attempt}/10 failed: ${err.message}`);
      if (attempt === 10) throw err;
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

const memPublic = m => ({
  id: m.id, kind: m.kind, mime: m.mime, caption: m.caption,
  taken_on: m.taken_on, uploaded_by: m.uploaded_by, created_at: m.created_at,
  bytes: m.bytes, burned: m.burned, burned_at: m.burned_at, burned_by: m.burned_by,
  has_thumb: !!(m.thumb_mime || m.has_thumb),
});

const db = {
  async listMemories() {
    if (pool) {
      const { rows } = await pool.query(
        `SELECT id, kind, mime, caption, taken_on, uploaded_by, created_at, bytes,
                burned, burned_at, burned_by, (thumb_mime IS NOT NULL) AS has_thumb
           FROM memories ORDER BY COALESCE(taken_on, created_at::date) DESC, created_at DESC`);
      return rows.map(memPublic);
    }
    return [...demo.memories].sort((a, b) =>
      String(b.taken_on || b.created_at).localeCompare(String(a.taken_on || a.created_at))
    ).map(memPublic);
  },

  async createMemory({ kind, mime, data, thumb, thumbMime, caption, takenOn, uploadedBy }) {
    if (pool) {
      const { rows } = await pool.query(
        `INSERT INTO memories (kind, mime, data, thumb, thumb_mime, caption, taken_on, uploaded_by, bytes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, kind, mime, caption, taken_on, uploaded_by, created_at, bytes,
                   burned, burned_at, burned_by, (thumb_mime IS NOT NULL) AS has_thumb`,
        [kind, mime, data, thumb, thumbMime, caption, takenOn, uploadedBy, data.length]);
      return memPublic(rows[0]);
    }
    const row = {
      id: demo.nextMem++, kind, mime, data, thumb, thumb_mime: thumbMime,
      caption, taken_on: takenOn, uploaded_by: uploadedBy,
      created_at: new Date().toISOString(), bytes: data.length,
      burned: false, burned_at: null, burned_by: null,
    };
    demo.memories.push(row);
    return memPublic(row);
  },

  async getMedia(id, wantThumb) {
    if (pool) {
      const col = wantThumb ? 'thumb' : 'data';
      const mimeCol = wantThumb ? `COALESCE(thumb_mime, mime)` : 'mime';
      const { rows } = await pool.query(
        `SELECT ${col} AS data, ${mimeCol} AS mime, burned FROM memories WHERE id = $1`, [id]);
      return rows[0] || null;
    }
    const m = demo.memories.find(x => x.id === id);
    if (!m) return null;
    return { data: wantThumb ? m.thumb : m.data, mime: wantThumb ? (m.thumb_mime || m.mime) : m.mime, burned: m.burned };
  },

  async updateMemory(id, { caption, takenOn }) {
    if (pool) {
      const { rows } = await pool.query(
        `UPDATE memories SET caption = COALESCE($2, caption), taken_on = COALESCE($3, taken_on)
          WHERE id = $1 AND NOT burned
          RETURNING id, kind, mime, caption, taken_on, uploaded_by, created_at, bytes,
                    burned, burned_at, burned_by, (thumb_mime IS NOT NULL) AS has_thumb`,
        [id, caption, takenOn]);
      return rows[0] ? memPublic(rows[0]) : null;
    }
    const m = demo.memories.find(x => x.id === id && !x.burned);
    if (!m) return null;
    if (caption != null) m.caption = caption;
    if (takenOn != null) m.taken_on = takenOn;
    return memPublic(m);
  },

  async burnMemory(id, by) {
    if (pool) {
      const { rows } = await pool.query(
        `UPDATE memories SET burned = true, burned_at = now(), burned_by = $2,
                data = NULL, thumb = NULL, thumb_mime = NULL
          WHERE id = $1 AND NOT burned
          RETURNING id, kind, mime, caption, taken_on, uploaded_by, created_at, bytes,
                    burned, burned_at, burned_by, false AS has_thumb`, [id, by]);
      return rows[0] ? memPublic(rows[0]) : null;
    }
    const m = demo.memories.find(x => x.id === id && !x.burned);
    if (!m) return null;
    Object.assign(m, { burned: true, burned_at: new Date().toISOString(), burned_by: by, data: null, thumb: null, thumb_mime: null });
    return memPublic(m);
  },

  async listPages() {
    if (pool) {
      const { rows } = await pool.query(
        `SELECT id, title, body, mood, author, created_at, burned, burned_at, burned_by
           FROM pages ORDER BY created_at ASC`);
      return rows;
    }
    return demo.pages.map(p => ({ ...p }));
  },

  async createPage({ title, body, mood, author }) {
    if (pool) {
      const { rows } = await pool.query(
        `INSERT INTO pages (title, body, mood, author) VALUES ($1,$2,$3,$4) RETURNING *`,
        [title, body, mood, author]);
      return rows[0];
    }
    const row = {
      id: demo.nextPage++, title, body, mood, author,
      created_at: new Date().toISOString(), burned: false, burned_at: null, burned_by: null,
    };
    demo.pages.push(row);
    return { ...row };
  },

  async updatePage(id, { title, body, mood }) {
    if (pool) {
      const { rows } = await pool.query(
        `UPDATE pages SET title = COALESCE($2,title), body = COALESCE($3,body), mood = COALESCE($4,mood)
          WHERE id = $1 AND NOT burned RETURNING *`, [id, title, body, mood]);
      return rows[0] || null;
    }
    const p = demo.pages.find(x => x.id === id && !x.burned);
    if (!p) return null;
    if (title != null) p.title = title;
    if (body != null) p.body = body;
    if (mood != null) p.mood = mood;
    return { ...p };
  },

  async burnPage(id, by) {
    if (pool) {
      const { rows } = await pool.query(
        `UPDATE pages SET burned = true, burned_at = now(), burned_by = $2, body = ''
          WHERE id = $1 AND NOT burned RETURNING *`, [id, by]);
      return rows[0] || null;
    }
    const p = demo.pages.find(x => x.id === id && !x.burned);
    if (!p) return null;
    Object.assign(p, { burned: true, burned_at: new Date().toISOString(), burned_by: by, body: '' });
    return { ...p };
  },
};

/* ---------------------------------------------------------------- */
/*  presence — the garden seats two                                  */
/* ---------------------------------------------------------------- */

const sessions = new Map();               // sessionId -> {profile, editing, first, last}
const ACTIVE_MS = 45 * 1000;

function pruneSessions() {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.last > ACTIVE_MS) sessions.delete(id);
}
setInterval(pruneSessions, 15000).unref();

function seatHolders() {
  pruneSessions();
  return [...sessions.entries()]
    .sort((a, b) => a[1].first - b[1].first)
    .slice(0, MAX_SEATS)
    .map(([id]) => id);
}

function touchSession(sessionId, profile, editing) {
  if (!sessionId) return;
  const now = Date.now();
  const s = sessions.get(sessionId);
  if (s) {
    s.last = now;
    if (profile) s.profile = profile;
    if (editing != null) s.editing = !!editing;
  } else {
    sessions.set(sessionId, { profile: profile || null, editing: !!editing, first: now, last: now });
  }
}

/* ---------------------------------------------------------------- */
/*  tiny media cache so video scrubbing doesn't hammer Neon          */
/* ---------------------------------------------------------------- */

const mediaCache = new Map();             // key -> {buf, mime}
let mediaCacheBytes = 0;
const MEDIA_CACHE_MAX = 64 * 1024 * 1024;

function cacheGet(key) {
  const hit = mediaCache.get(key);
  if (hit) { mediaCache.delete(key); mediaCache.set(key, hit); } // LRU bump
  return hit;
}
function cachePut(key, buf, mime) {
  if (buf.length > MEDIA_CACHE_MAX / 2) return;
  mediaCacheBytes += buf.length;
  mediaCache.set(key, { buf, mime });
  while (mediaCacheBytes > MEDIA_CACHE_MAX && mediaCache.size) {
    const [k, v] = mediaCache.entries().next().value;
    mediaCache.delete(k);
    mediaCacheBytes -= v.buf.length;
  }
}
function cacheDrop(id) {
  for (const key of [...mediaCache.keys()]) {
    if (key.startsWith(id + ':')) {
      mediaCacheBytes -= mediaCache.get(key).buf.length;
      mediaCache.delete(key);
    }
  }
}

/* ---------------------------------------------------------------- */
/*  app                                                              */
/* ---------------------------------------------------------------- */

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD, files: 2 },
});

function timingEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function requireEditor(req, res, next) {
  const auth = req.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!timingEqual(token, EDIT_TOKEN)) {
    return res.status(401).json({ error: 'That key does not open the garden gate.' });
  }
  const sessionId = req.get('x-session-id') || '';
  touchSession(sessionId, req.get('x-profile') || null, true);
  if (!seatHolders().includes(sessionId)) {
    return res.status(423).json({ error: 'The garden seats two, and both chairs are taken. You can look, but not touch, for now.' });
  }
  next();
}

/* -------- meta -------- */

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.get('/api/config', (req, res) => {
  res.json({ startDate: START_DATE, names: NAMES, maxSeats: MAX_SEATS, demo: !pool });
});

app.post('/api/auth', (req, res) => {
  const { password } = req.body || {};
  if (timingEqual(password || '', EDIT_PASSWORD)) {
    return res.json({ token: EDIT_TOKEN });
  }
  res.status(401).json({ error: 'That is not the secret we keep.' });
});

app.post('/api/presence', (req, res) => {
  const { sessionId, profile, editing } = req.body || {};
  if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 64) {
    return res.status(400).json({ error: 'A session id is needed.' });
  }
  touchSession(sessionId, NAMES.includes(profile) ? profile : null, editing);
  const holders = seatHolders();
  const online = [...sessions.entries()].map(([id, s]) => ({
    profile: s.profile, editing: !!s.editing, seated: holders.includes(id), you: id === sessionId,
  }));
  res.json({ seat: holders.includes(sessionId), seats: MAX_SEATS, online });
});

/* -------- memories (photos & videos) -------- */

app.get('/api/memories', async (req, res, next) => {
  try { res.json(await db.listMemories()); } catch (e) { next(e); }
});

app.post('/api/memories', requireEditor,
  upload.fields([{ name: 'file', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]),
  async (req, res, next) => {
    try {
      const file = req.files && req.files.file && req.files.file[0];
      if (!file) return res.status(400).json({ error: 'No file arrived. Choose a photo or a video first.' });
      const mime = file.mimetype || '';
      const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : null;
      if (!kind) return res.status(415).json({ error: 'Only photos and videos can hang on the line.' });

      const thumbFile = req.files.thumb && req.files.thumb[0];
      const caption = String(req.body.caption || '').slice(0, 500);
      const uploadedBy = NAMES.includes(req.body.uploaded_by) ? req.body.uploaded_by : NAMES[0];
      const takenOn = /^\d{4}-\d{2}-\d{2}$/.test(req.body.taken_on || '') ? req.body.taken_on : null;

      const row = await db.createMemory({
        kind, mime, data: file.buffer,
        thumb: thumbFile ? thumbFile.buffer : null,
        thumbMime: thumbFile ? (thumbFile.mimetype || 'image/jpeg') : null,
        caption, takenOn, uploadedBy,
      });
      res.status(201).json(row);
    } catch (e) { next(e); }
  });

app.get('/api/media/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).end();
    const wantThumb = req.query.thumb === '1';
    const key = `${id}:${wantThumb ? 't' : 'f'}`;

    let entry = cacheGet(key);
    if (!entry) {
      const row = await db.getMedia(id, wantThumb);
      if (!row) return res.status(404).json({ error: 'This memory is not in the book.' });
      if (row.burned || !row.data) return res.status(410).json({ error: 'This memory was given to the fire.' });
      entry = { buf: Buffer.from(row.data), mime: row.mime };
      cachePut(key, entry.buf, entry.mime);
    }

    const buf = entry.buf;
    res.setHeader('Content-Type', entry.mime);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');

    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m) {
        let start = m[1] === '' ? 0 : parseInt(m[1], 10);
        let end = m[2] === '' ? buf.length - 1 : parseInt(m[2], 10);
        if (m[1] === '' && m[2] !== '') { start = Math.max(0, buf.length - parseInt(m[2], 10)); end = buf.length - 1; }
        end = Math.min(end, buf.length - 1);
        if (start > end || start >= buf.length) {
          res.setHeader('Content-Range', `bytes */${buf.length}`);
          return res.status(416).end();
        }
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${buf.length}`);
        res.setHeader('Content-Length', end - start + 1);
        return res.end(buf.subarray(start, end + 1));
      }
    }
    res.setHeader('Content-Length', buf.length);
    res.end(buf);
  } catch (e) { next(e); }
});

app.patch('/api/memories/:id', requireEditor, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const caption = req.body.caption != null ? String(req.body.caption).slice(0, 500) : null;
    const takenOn = /^\d{4}-\d{2}-\d{2}$/.test(req.body.taken_on || '') ? req.body.taken_on : null;
    const row = await db.updateMemory(id, { caption, takenOn });
    if (!row) return res.status(404).json({ error: 'This memory is not in the book.' });
    res.json(row);
  } catch (e) { next(e); }
});

app.post('/api/memories/:id/burn', requireEditor, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const by = NAMES.includes(req.body.burned_by) ? req.body.burned_by : null;
    const row = await db.burnMemory(id, by);
    if (!row) return res.status(404).json({ error: 'This memory is not in the book, or it already met the fire.' });
    cacheDrop(String(id));
    res.json(row);
  } catch (e) { next(e); }
});

/* -------- journal pages -------- */

app.get('/api/pages', async (req, res, next) => {
  try { res.json(await db.listPages()); } catch (e) { next(e); }
});

app.post('/api/pages', requireEditor, async (req, res, next) => {
  try {
    const title = String(req.body.title || '').slice(0, 120);
    const body = String(req.body.body || '').slice(0, 20000);
    const mood = String(req.body.mood || '').slice(0, 8);
    const author = NAMES.includes(req.body.author) ? req.body.author : NAMES[0];
    if (!body.trim()) return res.status(400).json({ error: 'A page needs at least a few words.' });
    res.status(201).json(await db.createPage({ title, body, mood, author }));
  } catch (e) { next(e); }
});

app.patch('/api/pages/:id', requireEditor, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const patch = {
      title: req.body.title != null ? String(req.body.title).slice(0, 120) : null,
      body: req.body.body != null ? String(req.body.body).slice(0, 20000) : null,
      mood: req.body.mood != null ? String(req.body.mood).slice(0, 8) : null,
    };
    const row = await db.updatePage(id, patch);
    if (!row) return res.status(404).json({ error: 'That page is not in the book.' });
    res.json(row);
  } catch (e) { next(e); }
});

app.post('/api/pages/:id/burn', requireEditor, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const by = NAMES.includes(req.body.burned_by) ? req.body.burned_by : null;
    const row = await db.burnPage(id, by);
    if (!row) return res.status(404).json({ error: 'That page is not in the book, or it already met the fire.' });
    res.json(row);
  } catch (e) { next(e); }
});

/* -------- static site -------- */

const pub = path.join(__dirname, '..', 'public');
app.use('/vendor', express.static(path.join(pub, 'vendor'), { maxAge: '7d', immutable: true }));
app.use('/assets', express.static(path.join(pub, 'assets'), { maxAge: '7d', immutable: true }));
app.use(express.static(pub, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
    else res.setHeader('Cache-Control', 'public, max-age=3600');
  },
}));
app.get('/', (req, res) => res.sendFile(path.join(pub, 'index.html')));

/* -------- errors -------- */

app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'That file is heavier than 60 MB. Trim the video a little and try again.' });
  }
  console.error('[garden]', err);
  res.status(500).json({ error: 'The garden could not be reached. Try once more in a moment.' });
});

/* -------- go -------- */

initDb()
  .then(() => app.listen(PORT, () => console.log(`[garden] blooming on http://localhost:${PORT}`)))
  .catch(err => { console.error('[garden] could not reach the database:', err.message); process.exit(1); });
