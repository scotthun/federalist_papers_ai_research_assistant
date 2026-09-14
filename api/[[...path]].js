// Vercel serverless entrypoint (Story 4.1 deploy walkthrough). Any file under a top-level
// `/api` directory is auto-detected as a Vercel Function regardless of framework preset -- unlike
// the `.listen()`-detection mechanism, which empirically did not pick up NestJS's internal Express
// adapter when tried against this Nx-built bundle.
//
// Named `[[...path]].js` (Vercel's optional catch-all route convention), not `index.js` -- a plain
// `api/index.js` only maps to the exact path `/api` and 404s on every subpath (`/api/papers`,
// `/api/ask`, ...), confirmed live against the deployed app. The optional catch-all matches `/api`
// itself and every path beneath it, forwarding the original URL unchanged so Nest's own router
// still does the real routing.
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
