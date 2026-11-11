// Tests for the jsDelivr purge path list (D-07): scripts/lib/purge-paths.js
// (pure) and the scripts/purge-paths.js CLI that index.yml runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { purgePaths, isSha } from '../scripts/lib/purge-paths.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const ZERO = '0'.repeat(40);

function runCli(...args) {
  return spawnSync(process.execPath, ['scripts/purge-paths.js', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function git(...args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

test('no changed files purges only index.json', () => {
  assert.deepEqual(purgePaths([]), ['index.json']);
});

test('only allow-listed drill paths pass, deduped in input order', () => {
  assert.deepEqual(
    purgePaths([
      'drills/a-b.json',
      'cards/x.json',
      'drills/a-b.json',
      'drills/Bad Name.json',
      'drills/sub/x.json',
      'drills/$(rm).json',
    ]),
    ['index.json', 'drills/a-b.json'],
  );
});

test('blank lines and surrounding whitespace are ignored', () => {
  assert.deepEqual(purgePaths(['', '  ', 'drills/x1.json']), ['index.json', 'drills/x1.json']);
});

test('isSha accepts 40 lowercase hex and rejects zeros, short and junk', () => {
  assert.equal(isSha(ZERO), false);
  assert.equal(isSha('abc'), false);
  assert.equal(isSha('a'.repeat(39) + 'G'), false);
  assert.equal(isSha(undefined), false);
  assert.equal(isSha(''), false);
  assert.equal(isSha('0123456789abcdef0123456789abcdef01234567'), true);
});

test('CLI with an all-zero BEFORE prints only index.json', () => {
  const r = runCli(ZERO, git('rev-parse', 'HEAD'));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'index.json\n');
});

test('CLI with a missing BEFORE prints only index.json', () => {
  const r = runCli('', git('rev-parse', 'HEAD'));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'index.json\n');
});

test('CLI with a BEFORE that is not a local commit prints only index.json', () => {
  const r = runCli('1234567890abcdef1234567890abcdef12345678', git('rev-parse', 'HEAD'));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'index.json\n');
});

test('CLI over a real range that touched drills/ lists those drills', (t) => {
  if (git('rev-parse', '--is-shallow-repository') === 'true') {
    t.skip('shallow clone: no history to diff');
    return;
  }
  const sha = git('log', '--format=%H', '-n', '1', '--', 'drills/');
  let parent;
  try {
    parent = git('rev-parse', `${sha}~1`);
  } catch {
    t.skip('drill commit has no parent');
    return;
  }
  const changed = git('diff', '--no-renames', '--name-only', parent, sha, '--', 'drills/')
    .split('\n')
    .filter((f) => /^drills\/[a-z0-9-]+\.json$/.test(f));
  const r = runCli(parent, sha);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines[0], 'index.json');
  assert.ok(lines.length > 1, 'expected at least one drill path');
  assert.deepEqual(lines.slice(1), [...new Set(changed)]);
});

test('CLI purges both the old and the new path of a renamed drill', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'purge-rename-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  g('init', '-q');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  g('config', 'commit.gpgsign', 'false');
  mkdirSync(join(dir, 'drills'));
  writeFileSync(join(dir, 'drills', 'old-name.json'), '{"schema":"1.0","metadata":{"id":"old-name"}}\n');
  g('add', '.');
  g('commit', '-q', '-m', 'add');
  const before = g('rev-parse', 'HEAD');
  g('mv', 'drills/old-name.json', 'drills/new-name.json');
  g('commit', '-q', '-m', 'rename');
  const after = g('rev-parse', 'HEAD');

  const r = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'purge-paths.js'), before, after], {
    cwd: dir,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines[0], 'index.json');
  assert.deepEqual([...lines.slice(1)].sort(), ['drills/new-name.json', 'drills/old-name.json']);
});
