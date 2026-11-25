const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

const integrationDir = __dirname;
const testFiles = fs
  .readdirSync(integrationDir)
  .filter((file) => file.endsWith('.test.js'))
  .sort()
  .map((file) => path.join(integrationDir, file));

if (testFiles.length === 0) {
  console.error('No integration test files found in', integrationDir);
  process.exit(1);
}

let exitCode = 1;
try {
  const upStatus = run('docker', ['compose', 'up', '-d', '--wait']);
  if (upStatus !== 0) {
    exitCode = upStatus;
  } else {
    exitCode = run(process.execPath, ['--test', ...testFiles]);
  }
} finally {
  run('docker', ['compose', 'down', '-v']);
}

process.exit(exitCode);
