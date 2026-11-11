// One index.json entry per drill (CONTENT-04, D-06, D-16).
//
// Pure: no file system access. The whitelist and key order match the index
// that has shipped since Phase 23, so 2x3 / schema 1.0 drills serialise to the
// same bytes as before. New keys are only ever appended:
//   grid    only when the drill declares a grid other than '2x3'
//   schema  only when the drill's schema is not '1.0'
// Apps that predate grids read a missing grid as 2x3.
export function buildIndexEntry(raw) {
  const { id, name, contributor, difficulty, default_bpm, tags, description, grid } = raw.metadata;
  const entry = description !== undefined
    ? { id, name, contributor, difficulty, default_bpm, tags, description }
    : { id, name, contributor, difficulty, default_bpm, tags };
  if (grid !== undefined && grid !== '2x3') entry.grid = grid;
  if (raw.schema !== undefined && raw.schema !== '1.0') entry.schema = raw.schema;
  return entry;
}
