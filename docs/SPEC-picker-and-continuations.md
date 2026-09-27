# Implementation Spec — Scenario Repeat Suppression + Chain Continuations

Target file: `game.js` (single file, vanilla JS, no build step)
Version bump: `GAME_VERSION` → `'1.0.22.0'` (gameplay feature)

**Working discipline: one phase at a time. Stop after each phase, show the diff, wait
for review before starting the next. Do not auto-deploy. Do not refactor anything not
named in this spec.**

---

## Problem statement (measured, do not re-derive)

Simulation of the current `pickRandomScenario` over 20,000 mid-game days (day 8,
kitted out, ~10 draws/day):

| scenario | share of all draws |
|---|---|
| `bottle_return` | 22.3% |
| `job_day_labor` | 15.1% |
| `rainstorm_sudden` | 11.0% |
| `street_harassment` | 11.0% |
| `soup_kitchen` | 7.4% |
| each Ray/Paul/Shannon/Speedy scene | ~1.8% |

66% of days show some scenario 3+ times; 24% show one 4+ times.

Cause: `CATEGORY_WEIGHTS` is fixed per lane (25/20/20/20/15) while eligible lane depth
varies from 0 to 18. A one-entry lane delivers that single scenario at the lane's full
weight. Empty lanes renormalize their weight onto the thin survivors, compounding it.
There is no same-day suppression, no recency memory, and no per-scenario cooldown.

Target state (verified in simulation of the design below): max 1 occurrence of any
scenario per day, top scenario share ~8%, character content ~4% each, 27 distinct
scenarios served across 6 days.

**Do NOT change `CATEGORY_WEIGHTS`.** Cooldowns empty thin lanes naturally and the
existing renormalization handles it. Depth-weighting was tested and is redundant.

---

## PHASE 1 — Repeat suppression

### 1a. New state fields

Add to the `state` initializer, inside the top-level object (NOT inside `flags`):

```js
    // Repeat suppression. seenToday is an array, not a Set: state is persisted
    // wholesale via JSON.stringify in saveGame, and a Set serializes to {}.
    seenToday: [],        // scenario ids already served today
    recentSeen: [],       // scenario ids, most recent first, capped at 20
    lastSeenDay: {},      // scenario id -> day it last fired
```

**Save compatibility is mandatory.** `continueGame` does `Object.assign(state, saved)`
over the defaults, so a save written before this change will carry `undefined` for all
three. Add defensive normalization in `continueGame`, immediately after the
`Object.assign` and before `recomputeTimeModifier()`:

```js
    // Old saves predate repeat suppression — normalize rather than trust the save
    if (!Array.isArray(state.seenToday)) state.seenToday = [];
    if (!Array.isArray(state.recentSeen)) state.recentSeen = [];
    if (!state.lastSeenDay || typeof state.lastSeenDay !== 'object') state.lastSeenDay = {};
```

### 1b. Cooldown table and repeatable exemptions

Place immediately above `CATEGORY_WEIGHTS` (~line 3186):

```js
// Days that must pass before a scenario is eligible again. Absent = no cooldown,
// but same-day suppression still applies. Tuned against simulation: these values
// cost ~5% of random daily income; do not raise them without re-measuring.
const SCENARIO_COOLDOWN = {
    bottle_return: 2,
    job_day_labor: 1,
    rainstorm_sudden: 2,
    street_harassment: 2,
    bakery_closing: 1,
    library_refuge: 1,
    public_transit: 2,
    stray_dog: 3,
    medical_clinic: 3,
    gym_trial: 3,
    lost_wallet: 6
};

// Scenarios that may legitimately fire more than once in a day. Everything else
// is once-daily. Keep this list short — it is the exception, not the default.
const REPEATABLE_SAME_DAY = new Set(['find_meal', 'idle_time', 'soup_kitchen']);
```

### 1c. Rewrite `pickRandomScenario`

Replace the body. Filtering happens **before** bucketing, so a lane emptied by
suppression drops out of the weight roll entirely.

```js
function pickRandomScenario() {
    // Three suppression tiers, relaxed in order if the board goes empty. Tier 0 is
    // the intended behavior; 1 and 2 exist so a heavily-gated late-game state can
    // never hand back null and fall through to the find_meal fallback.
    for (let tier = 0; tier <= 2; tier++) {
        const buckets = {};
        scenarios.forEach(s => {
            if (s.notRandom) return;
            if (s.condition && !s.condition()) return;

            // Tier 0-1: no scenario twice in one day (except the exempt few)
            if (tier <= 1 && !REPEATABLE_SAME_DAY.has(s.id) && state.seenToday.includes(s.id)) return;

            // Tier 0 only: recency window and per-scenario cooldown
            if (tier === 0) {
                if (state.recentSeen.slice(0, 10).includes(s.id)) return;
                const cd = SCENARIO_COOLDOWN[s.id] || 0;
                const last = state.lastSeenDay[s.id];
                if (cd && last !== undefined && state.day < last + cd) return;
            }

            const cat = s.category || 'encounter';
            (buckets[cat] = buckets[cat] || []).push(s);
        });

        const cats = Object.keys(buckets);
        if (cats.length === 0) continue; // relax and retry

        let total = 0;
        cats.forEach(c => { total += CATEGORY_WEIGHTS[c] || 10; });
        let roll = Math.random() * total;
        let chosen = cats[cats.length - 1];
        for (const c of cats) {
            roll -= CATEGORY_WEIGHTS[c] || 10;
            if (roll < 0) { chosen = c; break; }
        }

        const pool = [];
        buckets[chosen].forEach(s => {
            const w = s.weight || 1;
            for (let i = 0; i < w; i++) pool.push(s);
        });
        return pool[Math.floor(Math.random() * pool.length)];
    }
    return null;
}
```

### 1d. Record what was served

In `loadScenario`, immediately after the scenario is resolved and before
`if (scenario.onLoad)`:

```js
    // Suppression bookkeeping. notRandom scenarios are forced or linked, never
    // drawn, so they don't participate — recording them would poison the buffer.
    if (!scenario.notRandom) {
        if (!state.seenToday.includes(scenario.id)) state.seenToday.push(scenario.id);
        state.recentSeen.unshift(scenario.id);
        if (state.recentSeen.length > 20) state.recentSeen.pop();
        state.lastSeenDay[scenario.id] = state.day;
    }
```

### 1e. Clear the daily set

In `advanceDay()`, as the first statement after `state.day++`:

```js
    state.seenToday = []; // a new day re-opens everything the old one used up
```

### Phase 1 verification

- Start a new run, play one full day to the shelter prompt. No scenario text repeats.
- Load a pre-existing save from before this change. It must not throw and must not
  wedge — confirm the three fields normalize to empty.
- Play through a season turn (day 12/13) to confirm `advanceDay` clearing works across
  the forced `season_change` path.

---

## PHASE 2 — `find_shelter` double-fire

`find_shelter` is `category: 'hazard'` and eligible from 17:00, but
`state.flags.lastShelterPromptDay` is only stamped by the forced 19:00 branch in
`loadScenario` (~line 3247-3250). A random draw at 17:30 therefore does not suppress
the 19:00 force, and the same prompt fires twice in one evening.

Fix: stamp on load rather than on force. Add to the `find_shelter` scenario object:

```js
        // Stamped here, not in the forced branch, so an early random draw of the
        // shelter prompt also satisfies the evening force
        onLoad: () => { state.flags.lastShelterPromptDay = state.day; },
```

Leave the existing assignment in `loadScenario` in place — it becomes redundant, not
wrong. Do not remove the forced branch.

Note: `rent_room`'s "Too rich for tonight. Reconsider your options." routes back via
`loadScenario('find_shelter')` explicitly, which still works — explicit ids bypass
suppression entirely.

### Phase 2 verification

Force an evening where `find_shelter` is drawn before 19:00 and confirm it does not
re-prompt at 19:00, and that the reconsider loop from `rent_room` still returns.

---

## PHASE 3 — Immediate chain continuations

### The bug

Six handoffs in the ID chain; one continues. `day_center_signed` (~1729) is the working
model — it offers a choice with `nextScenario: 'order_birth_cert'`. Every other terminal
step ends in `nextScenario: null` and drops the player back into the random pool, where
the next chain step is a weight-3 or -4 quest-lane entry behind a tight time window.
Measured: the player frequently never sees `dmv_visit` on the day the certificate lands.

### Mechanism

Add a `then` field, honored in `makeChoice`. Immediate only — **no deferred queue in
this pass.**

In `makeChoice`, replace the dispatch block:

```js
function makeChoice(choice) {
    if (choice.effects) applyEffects(choice.effects);

    if (choice.customAction) {
        choice.customAction();
    } else if (choice.nextScenario) {
        loadScenario(choice.nextScenario);
    } else if (choice.then) {
        // A quest step that continues rather than dissolving back into the pool.
        // Guarded so a closed window (DMV after 15:00) falls through to the pool
        // instead of jumping into a scenario whose own condition is false.
        const target = scenarios.find(s => s.id === choice.then.scenarioId);
        const open = target && (!choice.then.window || choice.then.window());
        loadScenario(open ? choice.then.scenarioId : undefined);
    } else {
        loadScenario();
    }
}
```

`then` shape:

```js
{ then: { scenarioId: 'dmv_travel', window: () => state.timeHour >= 9 && state.timeHour <= 15 } }
```

`window` is optional. When it returns false, the choice behaves exactly as today.

### Wiring — mechanism only

Wire `then` on the terminal choices of these scenarios. **The continuation targets are
new scenarios whose copy the author is writing separately — create them as stubs with
the mechanics below and placeholder one-line text marked `// TODO: copy`.** Do not write
final prose.

| source (line) | terminal choice | `then` target | window |
|---|---|---|---|
| `mail_arrives` (~1766) | "Tuck it somewhere safe. Next stop: the DMV." | `dmv_travel` | 9:00–15:00 |
| `id_arrives` (~1820) | "Step outside, standing a little taller." | `id_next_step` | 9:00–17:00 |
| `clothes_found` (~1927) | terminal choice | `clothes_next_step` | none |
| `bank_account_opened` (~1904) | terminal choice | none this pass | — |
| `boots_bought` (~1975) | terminal choice | none this pass | — |

Also confirm during this phase: `bank_branch` is `notRandom: true` and has no random
entry point. Report how (or whether) the player can currently reach it. Do not fix it in
this pass — report only.

### Costed-decision stubs

Each continuation target is a **decision about whether and how to travel**, not the
destination itself. Shape for `dmv_travel` (the template — build the others to match):

```js
{
    id: 'dmv_travel',
    notRandom: true,
    text: "// TODO: copy",
    choices: [
        // Walk: free, expensive in hours, scales with encumbrance via timeModifier
        { text: "Walk it.", effects: { timePassed: 0.75, warmth: -8, hunger: -8 }, nextScenario: 'dmv_visit' },
        // Bus: costs fare or a pass, cheap in hours
        { text: "Take the bus ($2.75).", requires: { cash: 2.75 },
          effects: { cash: -2.75, timePassed: 0.25 }, nextScenario: 'dmv_visit' },
        { text: "Use a transit pass.", requires: { flag: 'transitPasses', flagLabel: '(No passes)' },
          customAction: () => { state.flags.transitPasses--; applyEffects({ timePassed: 0.25 }); loadScenario('dmv_visit'); } },
        { text: "Not today.", nextScenario: null }
    ]
}
```

Notes for the implementer:
- Walk cost is charged through `timePassed`, so `state.timeModifier` already makes a
  torn sole or a plastic bag hurt. Do not hand-roll an encumbrance penalty.
- `transitPasses` already exists on `state.flags` — use it, don't add a new field.
- "Not today" must remain a real option with no penalty beyond lost time.

### Phase 3 verification

- Order and receive the birth certificate; confirm the DMV travel decision appears
  immediately after `mail_arrives` and that each of the three travel options lands in
  `dmv_visit` with the right time and cash charged.
- Receive the certificate after 15:00 and confirm the `window` guard falls through to a
  normal pool draw with no error.
- Confirm `dmv_visit`'s own `condition` is unchanged and it remains reachable from the
  random pool as a backstop.

---

## Out of scope for this pass

Do not build, even if it seems natural: the deferred event queue (`dueDay`), lane
depth-weighting, new scenario copy, new characters, protagonist backstory, any change
to `CATEGORY_WEIGHTS`, any change to sleep/theft/season systems.
