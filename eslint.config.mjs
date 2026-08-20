// eslint.config.mjs — flat config; rules encode docs/build/01-architecture.md §23 (INV-84 … INV-93).
// A disabled rule (`eslint-disable`) touching these is a gate ❌ unless an ADR names it.
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/** @type {import('eslint').Linter.Config[]} */
const config = [
  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'next-env.d.ts',
      'lib/supabase/types.ts',
      'design/**',
      'assets/**',
      'docs/**',
      'supabase/.temp/**',
    ],
  },
  ...nextVitals,
  ...nextTs,

  // Type-aware linting for the app source (needed by no-floating-promises — INV-91).
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts'],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.mjs', 'scripts/*.mjs', 'eslint.config.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // ---- Base invariants (everywhere) ----
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mjs', '**/*.js'],
    rules: {
      // INV-91 / INV-83
      '@typescript-eslint/no-explicit-any': 'error',
      // INV-90 / INV-65
      'react/no-danger': 'error',
      // INV-92 / INV-54, INV-63
      '@next/next/no-img-element': 'error',
      '@next/next/no-page-custom-font': 'error',
      // INV-89 / INV-42 — no console outside lib/log.ts, scripts/**, tests/**
      'no-console': 'error',
      // INV-88 / INV-35 — process.env only in lib/env.ts, lib/env/public.ts, next.config.ts, tests/**, scripts/**
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            'Read environment through lib/env.ts (server) or lib/env/public.ts (client) — 01 INV-35/INV-88.',
        },
      ],
      // INV-93 / INV-68
      'no-restricted-properties': [
        'error',
        {
          property: 'toLocaleString',
          message: 'Format dates in lib/format/*.ts (01 INV-68/INV-93).',
        },
        {
          property: 'toLocaleDateString',
          message: 'Format dates in lib/format/*.ts (01 INV-68/INV-93).',
        },
        {
          property: 'toLocaleTimeString',
          message: 'Format dates in lib/format/*.ts (01 INV-68/INV-93).',
        },
      ],
      // INV-84 / INV-85 / INV-86 / INV-87 — module import fences (defaults; relaxed per-directory below)
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/supabase/admin',
              message:
                'Service-role client only in lib/actions/**, lib/jobs/**, lib/notify/**, lib/files.ts, lib/rate-limit.ts, app/api/** (01 INV-14/INV-84).',
            },
            {
              name: '@supabase/supabase-js',
              message: 'Import Supabase only inside lib/supabase/*.ts (01 INV-13/INV-85).',
            },
            {
              name: '@supabase/ssr',
              message: 'Import Supabase only inside lib/supabase/*.ts (01 INV-13/INV-85).',
            },
            {
              name: '@/lib/supabase/client',
              message:
                'Browser client only in ViewerProvider, CommentThread, GoogleSignInButton (01 INV-85).',
            },
            {
              name: 'react-markdown',
              message: 'Only lib/markdown.ts may import react-markdown (01 INV-86).',
            },
            {
              name: 'remark-gfm',
              message: 'Only lib/markdown.ts may import remark-gfm (01 INV-86).',
            },
            {
              name: 'rehype-sanitize',
              message: 'Only lib/markdown.ts may import rehype-sanitize (01 INV-86).',
            },
            { name: 'rehype-raw', message: 'rehype-raw is banned everywhere (01 INV-65/INV-86).' },
          ],
        },
      ],
    },
  },

  // Type-aware rules only where the project service resolves files (INV-91).
  {
    files: [
      'app/**/*.ts',
      'app/**/*.tsx',
      'lib/**/*.ts',
      'lib/**/*.tsx',
      'components/**/*.tsx',
      'components/**/*.ts',
      'middleware.ts',
      'emails/**/*.tsx',
    ],
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },

  // ---- Per-directory relaxations (the "allowed only in" halves of INV-84–89) ----
  {
    // INV-35/INV-88: env readers, next.config, tests, scripts may read process.env
    files: [
      'lib/env.ts',
      'lib/env/public.ts',
      'next.config.ts',
      'tests/**',
      'scripts/**',
      'vitest.config.ts',
      'playwright.config.ts',
    ],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // INV-42/INV-89: console allowed in the log helper, scripts and tests
    files: ['lib/log.ts', 'scripts/**', 'tests/**'],
    rules: { 'no-console': 'off' },
  },
  {
    // INV-13/INV-85: only lib/supabase/*.ts imports the Supabase packages
    files: ['lib/supabase/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react-markdown', message: 'Only lib/markdown.ts (01 INV-86).' },
            { name: 'remark-gfm', message: 'Only lib/markdown.ts (01 INV-86).' },
            { name: 'rehype-sanitize', message: 'Only lib/markdown.ts (01 INV-86).' },
            { name: 'rehype-raw', message: 'rehype-raw is banned everywhere (01 INV-65/INV-86).' },
          ],
        },
      ],
    },
  },
  {
    // INV-14/INV-84: service-role client allowed here
    files: [
      'lib/actions/**',
      'lib/jobs/**',
      'lib/notify/**',
      'lib/files.ts',
      'lib/rate-limit.ts',
      'app/api/**',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@supabase/supabase-js',
              message: 'Import Supabase only inside lib/supabase/*.ts (01 INV-13/INV-85).',
            },
            {
              name: '@supabase/ssr',
              message: 'Import Supabase only inside lib/supabase/*.ts (01 INV-13/INV-85).',
            },
            {
              name: '@/lib/supabase/client',
              message:
                'Browser client only in ViewerProvider, CommentThread, GoogleSignInButton (01 INV-85).',
            },
            { name: 'react-markdown', message: 'Only lib/markdown.ts (01 INV-86).' },
            { name: 'remark-gfm', message: 'Only lib/markdown.ts (01 INV-86).' },
            { name: 'rehype-sanitize', message: 'Only lib/markdown.ts (01 INV-86).' },
            { name: 'rehype-raw', message: 'rehype-raw is banned everywhere (01 INV-65/INV-86).' },
          ],
        },
      ],
    },
  },
  {
    // 05 §1.3: the test harness (asRole/expectPolicy) builds raw Supabase clients against the local stack
    files: ['tests/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/supabase/client',
              message:
                'Browser client only in ViewerProvider, CommentThread, GoogleSignInButton (01 INV-85).',
            },
            { name: 'react-markdown', message: 'Only lib/markdown.ts (01 INV-86).' },
            { name: 'remark-gfm', message: 'Only lib/markdown.ts (01 INV-86).' },
            { name: 'rehype-sanitize', message: 'Only lib/markdown.ts (01 INV-86).' },
            { name: 'rehype-raw', message: 'rehype-raw is banned everywhere (01 INV-65/INV-86).' },
          ],
        },
      ],
    },
  },
  {
    // INV-09/INV-85: the three browser-client seams
    files: [
      'components/accounts/ViewerProvider.tsx',
      'components/comments/CommentThread.tsx',
      'components/primitives/GoogleSignInButton.tsx',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@/lib/supabase/admin', message: '01 INV-14/INV-84.' },
            {
              name: '@/lib/supabase/server',
              message: 'Client components never import the cookie server client (01 INV-85).',
            },
            {
              name: '@supabase/supabase-js',
              message: 'Import Supabase only inside lib/supabase/*.ts (01 INV-13/INV-85).',
            },
            {
              name: '@supabase/ssr',
              message: 'Import Supabase only inside lib/supabase/*.ts (01 INV-13/INV-85).',
            },
            {
              name: '@/lib/env',
              message: 'Client code imports publicEnv from @/lib/env/public (01 INV-87).',
            },
            { name: 'react-markdown', message: 'Only lib/markdown.ts (01 INV-86).' },
            { name: 'remark-gfm', message: 'Only lib/markdown.ts (01 INV-86).' },
            { name: 'rehype-sanitize', message: 'Only lib/markdown.ts (01 INV-86).' },
            { name: 'rehype-raw', message: 'rehype-raw is banned everywhere (01 INV-65/INV-86).' },
          ],
        },
      ],
    },
  },
  {
    // INV-65/INV-86: lib/markdown.ts is the one markdown importer
    files: ['lib/markdown.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@/lib/supabase/admin', message: '01 INV-14/INV-84.' },
            { name: '@supabase/supabase-js', message: '01 INV-13/INV-85.' },
            { name: '@supabase/ssr', message: '01 INV-13/INV-85.' },
            { name: '@/lib/supabase/client', message: '01 INV-85.' },
            { name: 'rehype-raw', message: 'rehype-raw is banned everywhere (01 INV-65/INV-86).' },
          ],
        },
      ],
    },
  },
  {
    // INV-87 + 03 C-07: components never import server env, server/admin clients, or lib/markdown from client files
    files: ['components/**'],
    ignores: [
      'components/accounts/ViewerProvider.tsx',
      'components/comments/CommentThread.tsx',
      'components/primitives/GoogleSignInButton.tsx',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@/lib/supabase/admin', message: '01 INV-14/INV-84.' },
            {
              name: '@/lib/supabase/server',
              message: 'components/** never import the cookie server client (01 INV-85).',
            },
            {
              name: '@/lib/supabase/client',
              message:
                'Browser client only in ViewerProvider, CommentThread, GoogleSignInButton (01 INV-85).',
            },
            { name: '@supabase/supabase-js', message: '01 INV-13/INV-85.' },
            { name: '@supabase/ssr', message: '01 INV-13/INV-85.' },
            {
              name: '@/lib/env',
              message: 'components import publicEnv from @/lib/env/public (01 INV-87).',
            },
            { name: 'react-markdown', message: 'Only lib/markdown.ts (01 INV-86).' },
            { name: 'remark-gfm', message: 'Only lib/markdown.ts (01 INV-86).' },
            { name: 'rehype-sanitize', message: 'Only lib/markdown.ts (01 INV-86).' },
            { name: 'rehype-raw', message: 'rehype-raw is banned everywhere (01 INV-65/INV-86).' },
          ],
        },
      ],
    },
  },
];

export default config;
