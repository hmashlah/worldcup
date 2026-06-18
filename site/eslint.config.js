import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'functions/**/*.ts'],
    rules: {
      // Enforce no unused variables (matches tsc -b behavior)
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      // Allow explicit `any` in specific cases (e.g. Supabase responses)
      '@typescript-eslint/no-explicit-any': 'warn',
      // No floating promises (catch or await them)
      '@typescript-eslint/no-floating-promises': 'off',
      // Prefer const
      'prefer-const': 'error',
      // No console.log in production code (warn, not error)
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Relax rules for test files
    files: ['src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', '*.config.ts', 'scripts/'],
  },
);
