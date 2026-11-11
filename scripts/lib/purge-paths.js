// Which jsDelivr paths to purge after a push to main (CONTENT-04, D-07).
//
// Pure: no git, no network. index.yml runs scripts/purge-paths.js, which feeds
// git's changed file names in here. Every name is allow-listed before it can
// reach curl, so a contributor-chosen file name can never inject anything.

const DRILL_PATH = /^drills\/[a-z0-9-]+\.json$/;
const SHA = /^[0-9a-f]{40}$/;
const ZERO_SHA = '0'.repeat(40);

// True for a full 40-char lowercase commit SHA. GitHub sends all zeros as
// `before` when a branch is created, which is not a commit.
export function isSha(s) {
  return typeof s === 'string' && SHA.test(s) && s !== ZERO_SHA;
}

// Always index.json, then each allowed drill path once, in input order.
// Added, modified, deleted and renamed drills are all purged: a deleted drill
// should 404 at the edge rather than serve a stale copy.
export function purgePaths(changedNames) {
  const out = ['index.json'];
  for (const raw of changedNames) {
    const name = raw.trim();
    if (DRILL_PATH.test(name) && !out.includes(name)) out.push(name);
  }
  return out;
}
