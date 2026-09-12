#!/usr/bin/env node
'use strict';
/**
 * Browser test runner. Requires Playwright (not a project dependency):
 *   npx playwright install chromium   # once
 *   npm run test:ui
 *
 * Starts a local server that reproduces Vercel's cleanUrls + trailingSlash:false
 * routing, then runs every *.ui.js suite against it.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = process.env.DG_PORT || 8090;
const ROOT = path.join(__dirname, '..', '..');
const suites = fs.readdirSync(__dirname).filter(f => f.endsWith('.ui.js')).sort();

const server = spawn(process.execPath, [path.join(__dirname, 'vercel-server.js'), ROOT, String(PORT)], { stdio: 'ignore' });
process.on('exit', () => server.kill());

function run(file) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(__dirname, file)], {
      stdio: 'inherit',
      env: Object.assign({}, process.env, { DG_BASE: `http://127.0.0.1:${PORT}` })
    });
    child.on('exit', code => resolve(code || 0));
  });
}

(async () => {
  await new Promise(r => setTimeout(r, 1500));
  let failed = 0;
  for (const s of suites) {
    console.log(`\n=== ${s} ===`);
    failed += await run(s);
  }
  server.kill();
  console.log(failed ? `\n${failed} suite(s) failed` : '\nAll UI suites passed');
  process.exit(failed ? 1 : 0);
})();
