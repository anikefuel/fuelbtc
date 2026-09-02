// https://docs.expo.dev/guides/using-eslint/
// eslint.config.js — CommonJS (devkit-lint expects CJS)
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, module */
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
]);
