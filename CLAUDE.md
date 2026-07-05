# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"The Streets" — a text-based survival simulator about homelessness. Vanilla HTML/CSS/JS with no build system, no dependencies, no package manager, and no tests. To run it, open `index.html` in a browser (e.g. `start index.html` from PowerShell). Refresh the page to pick up changes.

Three files: `index.html` (static UI shell), `style.css` (dark theme via CSS variables in `:root`), `game.js` (all game logic and content).

## Architecture (`game.js`)

Everything hangs off two things: the global `state` object (top of file) and the `scenarios` array (the game's content — the bulk of the file).

**Game loop:** `loadScenario(id?)` renders a scenario — with an `id` it loads that one; without, it picks randomly from scenarios where `notRandom` is false and `condition()` (optional) passes. Clicking a choice calls `makeChoice(choice)` → `applyEffects(choice.effects)` → then `customAction()`, `loadScenario(nextScenario)`, or a new random scenario. `renderStats()` re-renders the sidebar and checks win/loss.

**Scenario schema:**
- `id`, `notRandom` (true = only reachable via `nextScenario`/`loadScenario(id)`, typically outcome/transition scenes)
- `condition: () => bool` — gates random selection (time of day, flags, etc.)
- `text` — string or `() => string` for state-dependent narration
- `effects` — applied on scenario *entry*
- `choices[]` — each with `text`, optional `requires` (`cash`/`mentalFortitude`/etc. — unmet requirements render the button disabled), `effects`, and one of `nextScenario` / `customAction`

**Effects system (`applyEffects`):** mutates stats, then advances time. `timePassed` defaults to 1 hour if omitted; it's multiplied by `state.timeModifier` and drives passive warmth/hunger drain scaled by `state.difficultyMultiplier` (endless mode adds +0.08/day). Stats clamp to 0–100, except warmth which clamps to `state.maxWarmthCapacity` (permanently changed by coat/sleeping-bag scenarios). One-time events use `state.flags` plus a `flags` key in effects.

**Naming trap:** the effect key is `mentalFortitude` but the state field is `state.mental`. `requires` checks also use `mentalFortitude`. Keep using `mentalFortitude` in scenario definitions.

**HTML coupling:** `startGame(mode)` is called from inline `onclick` in `index.html`, and `renderStats`/`endGame` write to hardcoded element IDs (`stat-health`, `narrative-text`, `choices-list`, etc.). Renaming these functions or IDs breaks the other file.

**Modes:** `'goal'` (win at $1200 + `hasID` + `hasCleanClothes`) and `'endless'` (survive; difficulty scales daily). Loss conditions live in `checkGameStatus()` and are duplicated inline in `loadScenario()` — change both if you change death rules.

## Known gap

Goal Mode is currently unwinnable: nothing in any scenario ever sets `state.hasID` or `state.hasCleanClothes` (the ID quest chain `intake_appointment` → `library_research` dead-ends). If adding win-path content, these are the missing hooks.

## Tone

Scenario writing treats homelessness seriously — grounded, empathetic, systemic obstacles (ID catch-22s, shelter lines, being moved along) rather than played for laughs. New content should match that register.
