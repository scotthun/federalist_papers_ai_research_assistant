const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

// Mirrors webpack.eval-retrieval.config.js's shape, but bundles src/calibrate-thresholds.ts --
// the `calibrate-thresholds` Nx target's one-off, manually-run script (see project.json's
// `build-calibrate-thresholds`/`calibrate-thresholds` targets). Both
// `retrieval-eval-dataset.json` and `retrieval-eval-dataset-offtopic.json` are imported directly
// (resolveJsonModule), so they're compiled straight into this bundle -- no separate asset-copy
// step needed.
module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/api-calibrate-thresholds'),
    clean: true,
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/calibrate-thresholds.ts',
      tsConfig: './tsconfig.app.json',
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMap: true,
    }),
  ],
};
