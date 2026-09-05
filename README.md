# Sintas AI — Vercel deployment

This build uses an explicit Vercel catch-all function at `api/[...path].js` and a static `public/index.html` landing page.

## Vercel
- Import/upload the **contents of this folder** so `package.json`, `server.js`, `api/`, and `public/` are at the project root.
- No `vercel.json` is required.
- Recommended: set `AI_API_KEY` and `AI_BASE_URL` in Vercel Project Settings → Environment Variables.
- Test `https://YOUR-DOMAIN/api/health` first.
