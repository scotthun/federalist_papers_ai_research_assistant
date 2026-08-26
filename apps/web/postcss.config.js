// Tailwind v4's CSS-first config (no tailwind.config.js) needs only its PostCSS plugin wired up
// here. No `@ts-check`/JSDoc type annotation -- `postcss-load-config`'s types aren't resolvable
// as a direct dependency, and this file is simple enough not to need it.
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

module.exports = config;
