// Vercel serverless entrypoint (Story 4.1 deploy walkthrough). Any file under a top-level
// `/api` directory is auto-detected as a Vercel Function regardless of framework preset -- unlike
// the `.listen()`-detection mechanism, which empirically did not pick up NestJS's internal Express
// adapter when tried against this Nx-built bundle.
//
// Named `[...path].js` (single bracket -- Vercel's own native Serverless Functions catch-all,
// documented independently of any framework), not `index.js` or `[[...path]].js`. Two things
// confirmed live against the deployed app:
// - `api/index.js` only maps to the exact path `/api` and 404s on every subpath.
// - `[[...path]].js` (double-bracket "optional catch-all") is really a Next.js App Router
//   convention -- on this "Other"-preset, non-Next.js project it only matched `/api` itself and
//   exactly one segment beneath it (`/api/papers`, `/api/ask`); a second segment
//   (`/api/papers/5`, `/api/papers/search`) never reached the Function at all (a platform-level
//   `X-Vercel-Error: NOT_FOUND`, not even Nest's own 404 JSON).
// The single-bracket required catch-all matches every path *beneath* `/api` (one or more
// segments) at any depth, forwarding the original URL unchanged so Nest's own router still does
// the real routing. It does not match bare `/api` itself, which is fine -- apps/web never calls
// that path directly.
//
// Requires the Nx webpack build output directly (`dist/apps/api/main.js`, produced by the
// project's Vercel Build Command: `npx nx build api`) rather than duplicating any application
// code here. `createApp()` is exported from `apps/api/src/main.ts` specifically for this reuse.
//
// The Nest app is created once and cached across warm invocations of this Function -- rebuilding
// the whole Nest dependency graph on every request would be needlessly slow.
const { createApp } = require('../dist/apps/api/main.js');

let cachedHandler;

module.exports = async (req, res) => {
  if (!cachedHandler) {
    const app = await createApp();
    await app.init();
    cachedHandler = app.getHttpAdapter().getInstance();
  }
  return cachedHandler(req, res);
};

// Plain (non-Next.js) Vercel Functions default to a short duration ceiling regardless of the
// Hobby+Fluid-compute 300s maximum -- that raise only applies once a Function explicitly opts in.
// POST /api/ask can involve a real Gemini call observed live (this session) taking 90s+, so without
// this, the request is killed mid-flight with no error, just a silent re-invocation in the logs.
// Mirrors apps/web/src/app/api/ask/route.ts's `export const maxDuration = 300` (Story 4.1). Must
// be set on `module.exports.config` *after* module.exports is (re)assigned above, not before --
// an earlier assignment here would just get overwritten.
module.exports.config = { maxDuration: 300 };
