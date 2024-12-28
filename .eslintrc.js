module.exports = {
  env: {
    node: true,
    es2024: true,
    commonjs: true,
  },
  parserOptions: {
    ecmaVersion: 2024,
    sourceType: 'commonjs',
  },
  extends: [
    'eslint:recommended',
  ],
  rules: {
    'indent': ['error', 2],
    'linebreak-style': ['error', 'unix'],
    'quotes': ['error', 'single'],
    'semi': ['error', 'always'],
    'no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],
    'no-console': ['error', { allow: ['warn', 'error'] }],
    'no-constant-condition': ['error', { checkLoops: false }],
    'eqeqeq': ['error', 'always'],
    'curly': ['error', 'all'],
    'comma-dangle': ['error', {
      'arrays': 'always-multiline',
      'objects': 'always-multiline',
      'imports': 'always-multiline',
      'exports': 'always-multiline',
      'functions': 'never',
    }],
  },
  overrides: [
    {
      files: ['test/**/*.js'],
      env: {
        node: true,
        commonjs: true,
        es2024: true,
      },
      rules: {
        'no-console': 'off',
      },
    },
  ],
  globals: {
    '__dirname': 'readonly',
    'process': 'readonly',
    'require': 'readonly',
    'module': 'readonly',
    'exports': 'readonly',
  },
};
