# Remaining Work — Phase 3, then the Evening-Work Pass

Written 2026-08-24. Picks up where the session left off. **Nothing below has been
started.** Same working discipline as always: one phase at a time, show the diff,
wait for review before the next. No auto-deploy.

## Where things stand (already done, do not redo)

- **Phase 1** (repeat suppression) — shipped as `1.0.22.0`. `seenToday` /
  `recentSeen` / `lastSeenDay` on state, `SCENARIO_COOLDOWN` + `REPEATABLE_SAME_DAY`
  tables, three-tier `pickRandomScenario`, bookkeeping in `loadScenario`, daily clear
  in `advanceDay`, save normalization in `continueGame`.
- **Phase 2** (`find_shelter` double-fire) — done. `onLoad` on the scenario stamps
  `lastShelterPromptDay`; the redundant stamp in the forced branch was left in place
  per spec.
- **Debug lane logger** — in `loadScenario`, active only with `#debug` in the URL.
  Logs eligible-per-lane counts and the chosen scenario id.
- All of the above passes `node test/win-path.test.js` and `node --check game.js`.
- Uncommitted. First task next session: review the working diff and commit
  Phases 1+2 (+ logger) before touching anything else.

---

## STEP A — Phase 3 of `SPEC-picker-and-continuations.md` (chain continuations)

Follow the spec file exactly — it has the full mechanism, the `then` shape, the
wiring table, and the `dmv_travel` template stub. Summary of what it asks:

1. In `makeChoice`, add the `then` dispatch branch (after `customAction` and
   `nextScenario`, before the bare `loadScenario()` fallback). `then` =
   `{ scenarioId, window?: () => bool }`; a false `window` falls through to a
   normal pool draw.
2. Create costed travel-decision stubs (`dmv_travel`, `id_next_step`,
   `clothes_next_step`) — walk / bus $2.75 / transit pass / "Not today", placeholder
   text marked `// TODO: copy`. Walk cost via `timePassed` only (timeModifier
   already handles encumbrance); use the existing `flags.transitPasses`.
3. Wire `then` on the terminal choices of `mail_arrives` (window 9–15),
   `id_arrives` (9–17), `clothes_found` (no window). `bank_account_opened` and
   `boots_bought` get nothing this pass.
4. **Report only, do not fix:** whether `bank_branch` is reachable at all
   (spec suspects it is notRandom with no random entry).
5. Verification per the spec: cert → mail_arrives → travel decision appears
   immediately; each travel option lands in `dmv_visit` with correct time/cash;
   post-15:00 receipt falls through cleanly; `dmv_visit`'s own condition unchanged.
6. No version bump — the whole spec is `1.0.22.0`, already set.
7. Run the full test suite; add nothing to the repo's test file without asking.

**Stop. Show diff. Wait for review.**

---

## STEP B — Evening-Work Pass (new spec, `1.0.23.0`)

Agreed direction from the 2026-08-24 discussion (Opus feedback + code
verification). Core idea: **daytime work costs hours; night work costs your
bed.** Write this up as its own short spec file first if it helps, or execute
directly phase-by-phase. Order below is dependency order.

### B1. Engine: two small `requires` additions

In the choice-render block of `loadScenario` (~line 3387, the `choice.requires`
checks):

- `requires.hygiene` — mirror the existing `health` check exactly:
  disabled when `state.hygiene < value`, message like
  `(They look you over — not tonight)` — allow a per-choice override label
  (`hygieneLabel`) since the generic % message reads wrong for a job interview.
- `requires.check` — generic `() => bool` + `checkLabel` string, for gates the
  existing keys can't express (time-of-day closures). Disabled + label when the
  function returns false.

Rationale on record: the engine's own comment (~line 3375) draws the line —
`hidden` = knowledge you don't have; disabled-`requires` = a door you can see
but can't open. A closed office and a hygiene turn-down are the latter.

### B2. Shelter intake cutoff (the mechanic that makes night work a trade)

Currently `resolveShelter` grants a bed at any hour — verified, no time
sensitivity. Change: the downtown-shelter choice in `find_shelter` closes after
~20:00–21:00 (pick one, tune later) — render disabled via the new
`requires.check` with a label like `(Intake closed at 8 PM)`. Flophouse/motel
desks stay open (money always works); rough sleep always available.
This is deliberately *outside* the old spec's "no sleep-system changes" fence —
that fence expired with that spec.

Keep the existing Ray/`shelterFullDay` logic untouched; the cutoff is a second,
independent reason the shelter option dies at night.

### B3. `bottle_return` window trim

`condition` from `7–19` to `7–15` (~line 1111). The comment above it already
says the window was trimmed once to stop it owning the night lane — finish the
job. It never actually provided evening coverage; it just claimed it.

### B4. Three evening work scenarios — mechanics-stubs only, copy is Tom's

All `category: 'work'`. Do NOT ship fewer than two of these — a lone evening
work entry rebuilds the bottle_return monopoly in a new timeslot. Give each a
`SCENARIO_COOLDOWN` entry (suggest teardown 1, dish pit 2, tune later) and it's
fine for the evening lane to sometimes be empty — weights renormalize; "no work
tonight" is a true thing about the world.

1. **`event_teardown`** — the always-available floor. Condition ~16:00–20:00
   draw window. 2–3 hours, ends ~22:00, modest pay, real physical cost
   (health/warmth), no hygiene gate.
2. **`dishpit_closing`** — the prize. Condition ~16:30–19:00 draw. Hygiene-gated
   via new `requires.hygiene` (threshold ~40–50, tune) — this is what makes the
   gym/shower systems load-bearing. Cash at end of night + staff meal (hunger),
   ends ~23:00.
3. **`ray_dishpit_line`** — grapevine variant. `hidden` (per convention: you
   can't see a disabled button for a job you never heard of), gated
   `flags.metRay && streetRep >= 1`. Same kitchen, better terms, no hygiene gate
   — the manager takes you because Ray vouched. The one Tom most wants to write.

**Post-shift flow — two things verified about the engine:**

- A shift drawn pre-19:00 chains through `notRandom` scenes past the force fine;
  when the closing scene's "step outside" calls `loadScenario()` at 22:00–23:00,
  the shelter force fires immediately at that hour. No engine change needed.
- `police_move_on` will NOT fire on the walk home via the random pool (the force
  intercepts first). If the shift should carry a walk-home-in-the-dark hazard,
  roll it explicitly in the shift's closing `customAction` before releasing to
  `loadScenario()`.

With B2 in place the late finish means: shelter door closed, pay for a room or
route into `resolveRough` at the worse tiers. That's the whole trade — do not
add extra punishment on top.

### B5. Quest-closure legibility (small, independent — can ship with B or alone)

17:00+ quest silence stays (offices closing at five is a systemic-obstacle
beat, not a hole). Make the closure *legible* instead of silent: where the
day-center/library walk choice currently doesn't render after hours, show it
disabled via `requires.check` with `(Closed until 9 AM)`. One-line flavor beat
optional. No evening paperwork content — hold that line.

### B6. Verification for the whole pass

- `node --check game.js` + full `node test/win-path.test.js` (pin `state.day`
  to a season for any exact-value assertions, per CLAUDE.md).
- Re-run the lane-depth scan (scratchpad script from 2026-08-24 session — may
  be gone; it's ~60 lines against the stubbed-DOM harness pattern in
  `test/win-path.test.js`, rebuild if needed) and confirm the 16:30–19:00 work
  lane now holds ≥1–2 entries pre-suppression, and post-21:00 isn't a
  one-scenario lane.
- Browser with `#debug`: play an evening into a late shift; confirm the shelter
  force fires at the late hour, the cutoff disables the shelter bed, and the
  disabled buttons read right.
- Version bump to `1.0.23.0` ships with this pass.

---

## Parking lot (discussed, explicitly NOT scheduled)

- Deferred event queue (`dueDay`) — still out of scope, from the old spec.
- Lane depth-weighting — tested, redundant; do not build.
- `bank_branch` reachability fix — pending the Phase 3 report first.
- Whether the `#debug` logger stays in shipped code or gets stripped — ask Tom.
