# our little garden 🌹

A living memory garden for **Lina 🌸 & Thiha 🌙** — one rose blooms for every
day since **13 April 2024**.

- **The garden** — a twilight island you can orbit. Roses grow in a spiral, one
  per day (day 1 is the very heart). Milestone days bloom gold. Today's rose
  glows pink. Fireflies, drifting petals, wind in the grass — the grass uses
  your own stylized-grass meshes and a port of your Godot grass shader.
- **The book** (tap the book on the stump) — a two-page journal you both write
  in, with moods, signatures, milestones, and a list of what was
  *kept in smoke*.
- **The line** (tap the clothesline between the birches) — photos and videos
  hung like polaroids. Upload from the gallery; the five newest also hang in
  the 3D garden itself.
- **The small fire** (tap the fire) — choose a photo or a page, hold the match
  to strike it, touch the flame to the paper, and let it go. **Burning is
  forever**: the bytes are erased from the database. Only the date stays.
- **Two keys, one secret** — entering the password (default `13424`) unlocks
  editing. Everyone else may only look. At most **two** sessions can hold
  editing seats at once; a third visitor becomes a friendly ghost 👻 (view
  only) until a seat frees up (~45 s after someone leaves).

Stack: Node + Express, Neon Postgres (photos/videos stored as bytea — no S3
needed), vanilla ES modules + Three.js (vendored, no build step).

---

## 1 · Create the database (Neon, free)

1. Go to <https://neon.tech> → sign up → **New project** (any name, region
   near Singapore = `ap-southeast-1`).
2. On the project dashboard press **Connect** and copy the **pooled**
   connection string. It looks like:

   ```
   postgresql://user:password@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```

That's it — tables are created automatically on first boot.

> **How much fits?** Neon's free plan gives ~0.5 GB. Photos are compressed in
> the browser before upload (~150–400 KB each), so that's thousands of photos —
> or roughly a dozen 40 MB videos. Videos are capped at 60 MB each. If you ever
> outgrow it, Neon's paid tier is one click.

## 2 · Put the code on GitHub

```bash
cd our-little-garden
git init
git add .
git commit -m "our little garden"
# create an empty repo on github.com first (Private is fine), then:
git remote add origin https://github.com/YOURNAME/our-little-garden.git
git push -u origin main
```

## 3 · Deploy on Render (free)

1. <https://render.com> → sign in with GitHub.
2. **New +** → **Blueprint** → pick your repo. Render reads `render.yaml`.
3. When asked for environment variables:
   - `DATABASE_URL` → paste the Neon pooled connection string
   - `EDIT_PASSWORD` → `13424` (or change it — see below)
   - `SESSION_SECRET` → generated for you
4. Deploy. In ~2 minutes you'll have
   `https://our-little-garden.onrender.com` (rename the service to change it).

> Free Render instances sleep after 15 idle minutes; the first visit after a
> nap takes ~30 s to wake. The garden shows its loading line while it does.
> Your data lives in Neon, so sleeping loses nothing.

## 4 · Run it on your own machine (optional)

```bash
npm install
DATABASE_URL="postgres://...your-neon-string..." npm start
# → http://localhost:3000
```

No `DATABASE_URL`? It boots in **demo mode** — everything works but nothing is
saved, and the site tells you so.

---

## Changing things

| What | Where |
| --- | --- |
| Password | `EDIT_PASSWORD` env var on Render (Environment tab) → redeploy |
| Anniversary date | `ANNIVERSARY=YYYY-MM-DD` env var (default 2024-04-13) |
| Names | `NAMES=Lina,Thiha` env var, and the avatars/labels in `public/index.html` + `public/js/config.js` |
| Milestone days | `milestoneSet()` in `public/js/config.js` |
| Colors & type | CSS variables at the top of `public/css/style.css` |
| Garden layout | `kitPlacements` (trees/rocks/bushes) and object positions in `public/js/garden.js` |

The rose spiral scales itself: day 826 sits ~10 units from the heart, day 2000
~16 — still inside the island. It's built to keep blooming for years.

## The rules the server enforces

- Reading is open; **writing needs the password** (HMAC token) *and* one of
  the two presence seats.
- Burning nulls the media/page bytes in Postgres in the same statement that
  marks it burned. There is no undo, by design.
- Uploads: images are re-encoded in the browser (max 1600 px JPEG + a small
  thumbnail); videos up to 60 MB with a captured poster frame; served with
  HTTP Range support so scrubbing works.

## Credits

- **Book model** — "Low Poly Book" by **Tekila** (`public/assets/book/LICENSE.txt`)
- **Grass meshes & shader** — yours; the Godot `.gdshader` (root→tip gradient ×
  world-noise patches) was ported into the Three.js material (`public/assets/grass/license.txt`)
- **Trees, bushes, rocks, flowers** — **Quaternius Ultimate Nature Pack**, CC0
  (`public/assets/nature/LICENSE.txt`) — consider supporting them
- **Fonts** — Cormorant Garamond & Caveat (Google Fonts)
- Everything else (roses, terrain, fire, burn ritual, sounds) is generated in
  code — nothing to license, it's all yours.

grown with care, for the two of you. 🌸🌙
