#!/usr/bin/env node
/* `node --check` on the inject modules individually is not enough:
   inject/terminal.js uses top-level `return`, which is only legal inside the
   IIFE that buildInjectionScript wraps the concatenation in - so that file
   can never be checked on its own, and a syntax error anywhere in the bundle
   only surfaces at runtime as a silently un-themed window.

   assemble the exact script the app injects and check that instead. */
const vm = require('node:vm');
const { buildInjectionScript } = require('../src/shell/injection-bundle');
const { FALLBACK_APP_CONFIG } = require('../src/shell/app-config');

const injectionScript = buildInjectionScript(FALLBACK_APP_CONFIG);
if (injectionScript === null) {
  console.error('check-bundle: could not read one or more inject/*.js sources');
  process.exit(1);
}

try {
  /* compile-only: never runs the bundle, so no DOM is needed. */
  new vm.Script(injectionScript, { filename: 'terminal-injection-bundle.js' });
} catch (error) {
  console.error(`check-bundle: ${error.message}`);
  process.exit(1);
}

console.log(`check-bundle: OK (${injectionScript.length} chars)`);
