Delete the checklist section that doesn't apply to your PR.

## Drill PR Checklist

- [ ] Drill JSON validates against `drill.schema.json` (CI confirms)
- [ ] Drill loaded and appears in the app Drills tab without errors
- [ ] Drill animates correctly at default BPM (no visual glitches, no stuck markers)
- [ ] Foot sequence is physically coherent (no impossible jumps, no overlapping feet, no teleporting)
- [ ] Ball movement is continuous (any zone change uses ROLL or PUSH with `from`/`to`)
- [ ] Difficulty label feels correct at default BPM (Beginner playable casually; Advanced demands focus)
- [ ] Drill was play-tested on a real device (not just simulator)

## Decision Card PR Checklist (coach review)

- [ ] Coaching accuracy: the best answer is what a qualified youth coach would teach, and every `why` matches its grade
- [ ] Age-appropriate, and `age_band` set as a minimum band (`all`, `U9`, `U12` or `U16`)
- [ ] `role` set (`outfield`, or `keeper` for cards written from the keeper's view)
- [ ] Laws check: offside, back-pass, throw-in vs pass-in, goal-kick retreat line, heading for under-12s
- [ ] Would a parent be happy reading this card?
- [ ] No real names, clubs, brands, handles or links (CI rejects links and domains)
- [ ] Released under CC0 (`license: "CC0"`)
- [ ] Option lengths balanced, so the best answer isn't the longest (CI checks)
- [ ] `rev` bumped if a grade or the card's meaning changed (CI checks grade changes)
- [ ] Ran `node scripts/reorder-card-options.js` and `npm test` locally
- [ ] `reviewed_by` left empty unless a qualified coach reviewed the card

## Contributor notes

(Anything reviewers should know: source of the concept, video reference, intentional design choices.)
