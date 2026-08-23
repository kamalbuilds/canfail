# Demo video script

Target length **3:00**. Terminal track is one command: `./scripts/demo-run.sh` (each beat pauses ~4s for narration; `PAUSE=6` for a slower read).

If you have to cut for time, cut beats 1 and 8. **Do not cut beat 4 (`canfail prove`)** — it is the only part with no prior art, and it carries the innovation score.

Record the terminal at a readable font size. Say the words below in your own voice — do not use a synthetic narrator.

---

**0:00 – 0:22 — the problem, stated as a fact**

> Every test in this suite passes. Coverage looks fine. And this app will tell someone with a nut allergy that an unsafe product is safe.
>
> Coding agents are very good at making tests pass, because that is the instruction. Nothing in that loop requires the test to have been able to fail in the first place.

*(beat 1 on screen: vitest, all green)*

**0:22 – 1:05 — the scan**

> This is canfail. Four detectors. Tests that assert nothing. Mocks reachable from the production entry point. Failures reported as success. And the slow one: it breaks the code your tests cover, re-runs them, and reports what stayed green.
>
> Thirteen findings in a suite that is one hundred percent passing.

*(beat 2: the scan output. Let it sit.)*

**1:05 – 1:35 — the one that matters**

> Here is the function. It decides whether a product is safe for someone with an allergy. canfail inverted that comparison, re-ran the suite, and the suite stayed green — because the only test that ever approached the threshold was marked skip.
>
> That is not low coverage. The line is covered. Nothing depends on it being correct.

*(beat 3)*

**1:35 – 2:05 — the check no CI runs** *(lead with this if you cut anything else)*

> Here is the part I could not find anywhere else. Every CI system enforces that your tests pass on the branch. None of them enforces that a new test would have failed on the base commit.
>
> Same bug, an off-by-one at a threshold. Same fix. Two different tests written alongside it, and both are green. canfail reverts the source to the base commit and runs each test against the old code. One of them fails there, which means it earned its place. The other passes, which means it would never have caught the bug it ships with.
>
> Every CI in the world accepts both. This one exits 1.

*(beat 4)*

**2:05 – 2:30 — proving the tool itself**

> A scanner that prints "zero problems" is indistinguishable from a scanner that is broken. So the fixture ships a manifest of every defect planted in it, and canfail has to find all of them and report nothing else.
>
> And that check has to be able to fail too. This breaks a detector, asserts the gate goes red, restores it, asserts it goes green.

*(beats 4 and 5)*

**2:10 – 2:35 — Kiro**

> This was specified before it was written and the specs are in the repo: seven user stories, twenty-eight EARS acceptance criteria, twenty tasks that each cite the requirement they implement. Steering set the hard constraints — no network calls, no paid APIs. A hook re-runs fixture verification every time a detector changes, because a detector that quietly stops catching things is exactly the failure this project is about.

*(beat 6)*

**2:35 – 2:45 — close**

> Forty-seven tests. The first time I ran canfail on canfail it found six surviving mutants in my own suite and one swallowed error in the import graph. All fixed, and that is why the suite is forty-seven tests instead of twenty-eight.
>
> It is a CLI and a CI gate. MIT. Link in the description.

*(beat 7)*

---

## Checklist before uploading

- [ ] Terminal font large enough to read at 720p
- [ ] Under 3 minutes
- [ ] YouTube, public or unlisted, link-viewable
- [ ] Repo URL in the description
