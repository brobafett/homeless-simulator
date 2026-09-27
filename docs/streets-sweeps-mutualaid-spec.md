# The Streets — Implementation Spec: Gear Staging / City Sweeps + Mutual Aid

## Context for you (Claude Code)

`game.js` is a single-file, vanilla-JS text survival game about homelessness. It is
solo-maintained. It is deliberately respectful in tone: **the system is the antagonist,
never the player.** Nothing you add should imply a person is homeless because they played
badly. Losses should feel like the world doing something to the player, not the player
failing a skill check.

The codebase has established conventions. Follow them exactly rather than introducing new
patterns:

- Global mutable `state` object; all persistent booleans live in `state.flags`.
- `scenarios` is a flat array of objects with: `id`, `notRandom`, `weight`, `condition()`,
  `text` (string or function), `effects`, `choices[]`, and optional `onLoad()`.
- Random selection builds a weighted pool from scenarios where `notRandom` is falsy and
  `condition()` passes.
- `applyEffects(effects)` mutates state and advances time. `timePassed` defaults to 1 hour.
- Choices use `requires: { cash, health, hunger, mentalFortitude, flag, notFlag, stash, stashSpace }`
  for gating, and either `effects` + `nextScenario`, or a `customAction()` for branching logic.
- `customAction()` must end by calling `loadScenario(...)` or by rendering its own
  narrative + choice buttons, **and must call `renderStats()` and bail if
  `checkGameStatus() !== "CONTINUE"`** before writing to the DOM.
- Persistence is automatic via `saveGame()` inside `renderStats()`. New flags must be
  read defensively (`state.flags.foo || 0`) so old saves don't break.
- `renderGear()` builds the sidebar gear list. New player-visible possessions belong there.

## Working discipline (non-negotiable)

- **Implement Feature 1 completely, stop, and show me the diff. Do not start Feature 2
  until I approve.** No braiding.
- No new files, no build tooling, no frameworks. Edit `game.js` (and `index.html` /
  `style.css` only if a feature genuinely requires it — Feature 2 does not).
- No auto-running anything. Show diffs; I review every one.
- Keep new code in the same style as its neighbors: same indentation, same comment voice
  (dry, explanatory, occasionally wry — read the existing comments and match them).
- After each feature, list anything you had to guess about, and any tuning constant you
  picked arbitrarily.

---

# FEATURE 1 — Gear Staging and City Sweeps

## The idea

Carrying 40 lbs of gear all day is exhausting and makes you conspicuous, so people
routinely **stash** heavy items (sleeping bag, spare clothes) in a bush, alley, or gap in
a fence, then travel light and retrieve it at night. The risk: a city sanitation sweep
finds the cache and throws it in a garbage truck. You did the rational thing and the city
destroyed your bed for it.

This is the emotional core of the feature. **When a sweep takes the gear, the narration
must not blame the player.** No "you should have known better." The tone is: you made a
reasonable call, and the city has a schedule that doesn't care about you.

## State to add

Add to `state.flags` (all defensive-read):

- `hasSleepingBag` — **initialize to `true`** in the state literal. The sleeping bag is
  currently implicit; make it explicit.
- `gearStashed` — bool. Gear is currently hidden somewhere.
- `stashSpotQuality` — number. `1` = obvious spot (bush by the sidewalk), `2` = a good
  spot learned from a street contact (see Feature 2). Defaults to 1.
- `stashDay` — the `state.day` on which the gear was stashed.
- `lastStashPromptDay` — prevents re-prompting the stash decision multiple times per day.

## Mechanics

**Carrying the bag (default).** No change to today's numbers — this is the status quo, so
it must remain viable. Do not punish the player for *not* stashing.

**Stashing (the gamble).** While `gearStashed` is true:
- Set `state.timeModifier = 0.85` (you move faster unencumbered). Restore it to `1.0` on
  retrieval. **Careful:** `timeModifier` is also set by `shoe_blowout` (1.3) and
  `backpack_breaks` (1.5), and reset to 1.0 by shoe/backpack purchases. Don't clobber
  those. Compute the effective modifier rather than blindly assigning — introduce a small
  helper like `recomputeTimeModifier()` that derives it from the current flags
  (broken shoes, plastic bag, stashed gear) and call it wherever those flags change.
  Refactor the existing `state.timeModifier = 1.0` assignments to use it.
- The `labor_office` construction ticket costs less health (you didn't haul your life to
  the jobsite): reduce that choice's `health` cost by 5 when stashed.

**Retrieval and the sweep roll.** Retrieval happens in the evening. Add a forced scenario
in `loadScenario()`'s pre-checks (near the existing nightfall `find_shelter` hook) —
**it must fire BEFORE the `find_shelter` prompt**, because the sweep outcome changes what
tonight costs:

```
if (!id && state.flags.gearStashed && state.timeHour >= 18 && ...) id = 'retrieve_stash';
```

Sweep probability: base **30%** for `stashSpotQuality === 1`, **15%** for quality 2.
Add **+8% per full day** the gear has been left stashed beyond the first (`state.day - stashDay`),
capped at 55%. (These numbers are my guess — flag them for tuning.)

**On a clean retrieval:** gear recovered, `gearStashed = false`, small mental bump (relief),
`timeModifier` recomputed.

**On a sweep:** `hasSleepingBag = false`, `gearStashed = false`,
`maxWarmthCapacity -= 20` (matching the existing sleeping-bag-abandonment penalty in
`backpack_breaks` — reuse that number for consistency), mental hit around -20.
Narration: a posted notice you never saw, an empty patch of dirt, a clean-swept alley.
Do not editorialize; let it be flat and awful.

**Recovering afterward.** Losing the bag must not be an unrecoverable death spiral. Add a
way back: a donation/outreach scenario (condition: `!hasSleepingBag`) where a church van or
outreach worker hands out surplus bedrolls — free, but time-expensive and not guaranteed to
be in the pool every day. Restores `hasSleepingBag` and `maxWarmthCapacity += 20`.

## Interaction with the sleep model

If `resolveRough()` / `SLEEP_QUALITY` exist in the file, sleeping rough **without** a
sleeping bag should restore meaningfully less and cost more warmth. If that refactor is not
present, skip this and tell me — do not invent a sleep system.

## Gear panel

`renderGear()` must show the bag's status: carried, stashed (with days stashed), or lost.

---

# FEATURE 2 — Mutual Aid and the Street Grapevine

**Do not begin until Feature 1 is approved.**

## The idea and why it matters

Right now every relationship in the game is player-vs-institution (DMV, shelter, clinic,
cop, security guard, gym desk). The only two *other unhoused people* in the game are a man
who tackles the player over a bag of cans and a thief in a flophouse. That is an accidental
editorial position: it says the people out here are threats. Correct it.

Add a **recurring named street veteran** — call him **Ray** — who has been out here far
longer than the player, is neither a saint nor a victim, and knows things the player
doesn't. He is the source of the "grapevine": knowledge that saves time, walking, and risk.

**The thesis:** the network *is* the infrastructure. Mutual aid isn't a nice moment; it is
materially load-bearing.

## State to add

- `metRay` — bool.
- `streetRep` — integer, starts 0. Increments on decent behavior toward peers.
- `knowsStashSpot` — bool. Set by a Ray tip; sets `stashSpotQuality = 2` (Feature 1 hook).
- `sharedWatch` — bool or a day marker, for the buddy-system night (below).

`streetRep` is **not** shown in the UI. No visible karma meter — a number that goes up when
you're kind turns compassion into a score to farm. It works silently.

## Scenarios

1. **First meeting** (`condition: !metRay`). Ray is sitting with a cart; he asks for
   nothing. Player can share a packed meal (`requires: { stash: 1 }`), share a cigarette
   /nothing but conversation, or move on. Sharing sets `metRay` and `streetRep += 1`.
   **Moving on must not be punished** — no mental penalty, no scolding. It just doesn't
   build anything. (People have nothing to give sometimes. That's not a moral failure.)

2. **Grapevine tips** (`condition: metRay && streetRep >= 1`, low weight, repeatable).
   Ray passes on knowledge, randomized among:
   - "Don't bother with the downtown shelter tonight, they're full by six." → sets a flag
     that makes tonight's shelter attempt fail, saving the player from discovering it the
     expensive way; the tip *is* the value.
   - A safe stash spot → sets `knowsStashSpot`, `stashSpotQuality = 2`.
   - The clinic takes walk-ins on Thursdays without a referral → a one-shot flag letting
     the player bypass the `hasShelterReferral` gate at `clinic_desk` once.

3. **The buddy system** (`condition: metRay && streetRep >= 2`, evening only). Ray offers
   to split the night: you each sleep half, watching both packs. Sets `sharedWatch`.
   Effect: tonight's rough sleep has **no theft risk** and restores somewhat better —
   two people can do what one can't. This is the single best argument the feature makes.

4. **Reciprocity — the unrewarded one** (`condition: metRay && streetRep >= 1`).
   Ray is sick, or has been beaten, or has lost his cart. Helping costs the player real
   resources (cash, hours, a packed meal) and **returns nothing tangible** — no tip, no
   discount, no unlock. `streetRep += 1` and a modest mental gain, and that's it. Refusing
   costs a modest mental hit (you walked past someone who helped you) but is *allowed*, and
   the narration should be unsparing but not cruel about it. Do not add a payoff later.
   The absence of a payoff is the point.

5. **Barter** (`condition: metRay`). Trade a packed meal for a transit pass, or vice versa.
   Small, mundane, humanizing. Uses the existing `foodStash` / `carryCapacity()` system.

## Tone constraints for Ray

- He is competent, funny, and not pitiable. He is not a magical mentor and not a cautionary
  tale. He does not exist to teach the player a lesson.
- He never delivers a speech about homelessness. No monologues. Street talk is practical.
- He can be wrong occasionally. One tip that doesn't pan out makes him a person.

---

## Acceptance criteria (both features)

- Game runs with no console errors; existing saves load without breaking (defensive flag reads).
- No existing scenario's behavior changes except the two explicitly named hooks
  (`labor_office` construction health cost, `clinic_desk` referral bypass).
- `timeModifier` is now derived, not assigned ad hoc, and shoe/backpack/stash states compose
  correctly (e.g. broken shoes + stashed gear).
- A full run is playable in both `goal` and `endless` mode.
- Every new `customAction()` calls `renderStats()` and checks `checkGameStatus()` before
  touching the DOM.
- You list every tuning constant you chose so I can adjust them.
