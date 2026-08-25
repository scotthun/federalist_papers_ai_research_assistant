import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc', '**/.next'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            // AD-6: leaf libs (database, ai, documents) never import from each other.
            // Each may depend on itself and on shared (Zod/DTO) schemas only.
            {
              sourceTag: 'scope:database',
              onlyDependOnLibsWithTags: ['scope:database', 'scope:shared'],
            },
            {
              sourceTag: 'scope:ai',
              onlyDependOnLibsWithTags: ['scope:ai', 'scope:shared'],
            },
            {
              sourceTag: 'scope:documents',
              onlyDependOnLibsWithTags: ['scope:documents', 'scope:shared'],
            },
            // AD-7: retrieval composes database + ai for the read path.
            {
              sourceTag: 'scope:retrieval',
              onlyDependOnLibsWithTags: [
                'scope:retrieval',
                'scope:database',
                'scope:ai',
                'scope:shared',
              ],
            },
            // AD-9: shared is a pure leaf schema lib (Zod/DTOs) — no deps.
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
];
