const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

// Mirrors webpack.config.js (the HTTP server's build), but bundles src/migrate.ts -- the
// `migrate` Nx target's one-off script -- into its own output directory, so it can be
// `node`-run directly (see project.json's `build-migrate`/`migrate` targets) without disturbing
// the server bundle.
module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/api-migrate'),
    clean: true,
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/migrate.ts',
      tsConfig: './tsconfig.app.json',
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMap: true,
    }),
  ],
};
