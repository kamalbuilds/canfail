# Demo video script

Target length **2:30**. Terminal track is one command: `./scripts/demo-run.sh`. Use the recovered Zalt Kokoro harness for the final narrated cut; keep the terminal readable at 720p and the final MP4 under three minutes.

---

**0:00 - 0:12 -- the contradiction**

> Every test in this fixture passes. But green is not proof that a test can go red. canfail breaks the behavior under test, runs the affected test again, and reports what stayed green.

*(beats 1 and 2: green suite, then scan output)*

**0:12 - 0:28 -- four detector families**

> Three checks are static: tests with no meaningful assertion, mock data reachable from production, and failures reported as success. The mutation probe finds correct-looking tests that still do not constrain the behavior that matters. Thirteen planted defects, all inside a passing suite.

*(beat 2: hold the scan output)*

**0:28 - 0:50 -- UNEARNED: the check no CI runs**

> Every CI checks that a new test passes after the change. canfail prove asks the missing question: would it have failed before the change? Both generated tests pass on the branch. Against the old source, the broad test stays green, so it is UNEARNED. The exact boundary test goes red, so it is EARNED.

*(beat 3: JavaScript prove output)*

**0:50 - 1:02 -- the same invariant in Go**

> prove only needs git history, a recognized test file, and a command whose exit code means pass or fail. Here is the same check running against a real Go module. The static detectors remain honestly scoped to TypeScript and JavaScript.

*(beat 4: Go prove output)*

**1:02 - 1:22 -- real-repository Python proof**

> Now Python, using token-counting behavior from John Crickett's public KiroCrew fork at a pinned commit. The wrapper, boundary change, and tests are generated only for this demo; this is not an upstream finding. Both tests pass after the change. Only the exact-boundary test fails against the base revision.

*(beat 5: KiroCrew-derived Python prove output)*

**1:22 - 1:40 -- verify the verifier**

> A scanner that prints zero is indistinguishable from a broken scanner. The fixture manifest requires all thirteen planted defects and no extras. Then canfail deliberately breaks a detector, proves the gate turns red, restores it, and proves green again.

*(beats 6 and 7: exact fixture verification, then gate-can-fail)*

**1:40 - 1:55 -- real SIGKILL recovery**

> Mutation writes to source files, and SIGKILL cannot be trapped. This integration test kills a real probe mid-mutation, confirms the tree is dirty, then requires the next run to restore every byte from the crash journal.

*(beat 8: crash-recovery integration tests)*

**1:55 - 2:12 -- Kiro is load-bearing**

> The core detector began with seven user stories, thirty-two EARS criteria, and traced implementation tasks. Kiro hooks rerun fixture verification after detector edits, audit requirement traceability, and prove that newly saved tests would have failed on the base revision.

*(beat 9: specs and three hooks)*

**2:12 - 2:28 -- self-scan and close**

> Seventy-eight tests, including thirty-one integration tests. canfail's first self-scan found six surviving mutants and one swallowed import error in its own suite. All were fixed. Offline, deterministic, MIT licensed. Green is not enough. Prove your tests can fail.

*(beat 10: full tests and self-scan)*

---

## Checklist before uploading

- [ ] Terminal font readable at 720p
- [ ] Narration aligned to all ten beats
- [ ] Under 3 minutes
- [ ] YouTube public or unlisted and link-viewable
- [ ] Repository URL in the video description
