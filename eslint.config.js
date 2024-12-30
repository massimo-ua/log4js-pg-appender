const globals = require('globals');
const js = require('@eslint/js');
const { FlatCompat } = require('@eslint/eslintrc');

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

module.exports = [{
  ignores: ['**/node_modules/', '**/  coverage/', '**/  dist/', '**/  .nyc_output/'],
}, ...compat.extends('eslint:recommended'), {
  languageOptions: {
    globals: {
      ...globals.node,
      ...globals.commonjs,
      __dirname: 'readonly',
      process: 'readonly',
      require: 'readonly',
      module: 'readonly',
      exports: 'readonly',
    },

    ecmaVersion: 2024,
    sourceType: 'commonjs',
  },

  rules: {
    indent: ['error', 2],
    'linebreak-style': ['error', 'unix'],
    quotes: ['error', 'single'],
    semi: ['error', 'always'],

    'no-unused-vars': ['error', {
      argsIgnorePattern: '^_',
    }],

    'no-console': ['error', {
      allow: ['warn', 'error'],
    }],

    'no-constant-condition': ['error', {
      checkLoops: false,
    }],

    eqeqeq: ['error', 'always'],
    curly: ['error', 'all'],

    'comma-dangle': ['error', {
      arrays: 'always-multiline',
      objects: 'always-multiline',
      imports: 'always-multiline',
      exports: 'always-multiline',
      functions: 'never',
    }],
  },
}, {
  files: ['test/**/*.js'],

  languageOptions: {
    globals: {
      ...globals.node,
      ...globals.commonjs,
    },
  },

  rules: {
    'no-console': 'off',
  },
}];
