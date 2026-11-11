// Usage: node scripts/purge-paths.js <BEFORE> <AFTER>
//
// Prints the jsDelivr paths to purge, one per line: index.json, then every
// drills/*.json changed between BEFORE and AFTER. If BEFORE is missing, all
// zeros (new branch), malformed or not a commit in this clone, prints
// index.json only. Always exits 0 so a purge problem never fails the rebuild.
// git runs with an argument array (no shell); SHAs are validated first.
import { execFileSync } from 'child_process';
import { isSha, purgePaths } from './lib/purge-paths.js';

const [before, after] = process.argv.slice(2);

// Runs git with an argument array; returns stdout, or null if git fails.
function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function changedDrills() {
  if (!isSha(before) || !isSha(after)) return [];
  if (git(['cat-file', '-e', `${before}^{commit}`]) === null) return [];
  const out = git(['diff', '--name-only', before, after, '--', 'drills/']);
  return out === null ? [] : out.split('\n');
}

for (const p of purgePaths(changedDrills())) {
  console.log(p);
}
