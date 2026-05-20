## Drill PR Checklist

- [ ] Drill JSON validates against `drill.schema.json` (CI confirms)
- [ ] Drill loaded and appears in the app Drills tab without errors
- [ ] Drill animates correctly at default BPM (no visual glitches, no stuck markers)
- [ ] Foot sequence is physically coherent (no impossible jumps, no overlapping feet, no teleporting)
- [ ] Ball movement is continuous (any zone change uses ROLL or PUSH with `from`/`to`)
- [ ] Difficulty label feels correct at default BPM (Beginner playable casually; Advanced demands focus)
- [ ] Drill was play-tested on a real device (not just simulator)

## Contributor notes

(Anything reviewers should know: source of the concept, video reference, intentional design choices.)
