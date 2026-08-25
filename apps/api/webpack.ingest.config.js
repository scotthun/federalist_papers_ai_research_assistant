const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

// Mirrors webpack.config.js (the HTTP server's build), but bundles src/ingest.ts -- the
// `ingest` Nx target's one-off script -- into its own output directory, so it can be `node`-run
// directly (see project.json's `build-ingest`/`ingest` targets) without disturbing the server
// bundle.
module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/api-ingest'),
    clean: true,
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/ingest.ts',
      tsConfig: './tsconfig.app.json',
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMap: true,
    }),
  ],
};
