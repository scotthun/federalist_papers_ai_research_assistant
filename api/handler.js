// Vercel serverless entrypoint (Story 4.1 deploy walkthrough).
//
// Named plainly, not via any bracket convention -- three bracket-based approaches were each tried
// and confirmed live to fail on this "Other"-preset, non-Next.js, custom-Build-Command project:
// - `api/index.js` only maps to the exact path `/api`, 404s on every subpath.
// - `api/[[...path]].js` (Next.js App Router's "optional catch-all") only matched `/api` itself
//   and exactly one segment beneath it -- a second segment (`/api/papers/5`) never reached the
//   Function at all (platform-level `X-Vercel-Error: NOT_FOUND`, not even Nest's own 404 JSON).
// - `api/[...path].js` (Vercel's own documented native catch-all) behaved identically to the
//   above, including after isolating the static Output Directory into its own `public/` folder --
//   ruling out an Output-Directory-shadowing theory too.
// Given all three bracket conventions failed the same way, this project's bracket-based
// file-routing detection is unreliable full stop, independent of depth or output-dir config.
// The robust alternative: a plain, single, unambiguous route (`/api/handler`, matching this
// file's own name with zero inference), with every `/api/*` request funneled to it explicitly via
// `vercel.json`'s `rewrites` instead of relying on any filename convention at all.
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
