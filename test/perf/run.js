const { spawnSync } = require('node:child_process');
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

const unitPerfFile = path.join(__dirname, 'unit.perf.test.js');
const pgPerfFile = path.join(__dirname, 'postgres.perf.test.js');

const unitStatus = run(process.execPath, ['--test', unitPerfFile]);
if (unitStatus !== 0) {
  process.exit(unitStatus);
}

let pgStatus = 1;
try {
  const upStatus = run('docker', ['compose', 'up', '-d', '--wait']);
  if (upStatus !== 0) {
    pgStatus = upStatus;
  } else {
    pgStatus = run(process.execPath, ['--test', pgPerfFile]);
  }
} finally {
  run('docker', ['compose', 'down', '-v']);
}

process.exit(pgStatus);
