const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

// Mirrors webpack.ingest.config.js's shape, but bundles src/eval-retrieval.ts -- the
// `eval-retrieval` Nx target's one-off, manually-run script -- into its own output directory
// (see project.json's `build-eval-retrieval`/`eval-retrieval` targets). `retrieval-eval-
// dataset.json` is imported directly by eval-retrieval.ts (resolveJsonModule), so it's compiled
// straight into this bundle -- no separate asset-copy step needed.
module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/api-eval-retrieval'),
    clean: true,
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/eval-retrieval.ts',
      tsConfig: './tsconfig.app.json',
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMap: true,
    }),
  ],
};
