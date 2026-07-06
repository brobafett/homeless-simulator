# The Streets — A Survival Simulator

A text-based survival game about homelessness. You wake up on the street with nothing: no money, no ID, no address. Every choice costs something — time, warmth, dignity, or the few dollars you've scraped together — and the systems that are supposed to help have paperwork requirements you can't meet yet.

Built with plain HTML, CSS, and JavaScript. No frameworks, no build step, no dependencies.

## Playing

**[Play it in your browser](https://brobafett.github.io/homeless-simulator/)** — or clone the repo and open `index.html`. That's it.

Progress autosaves to your browser's local storage, on your device only — no cookies, no server, no accounts, no analytics, no tracking of any kind. Dying, winning, or starting a new game erases the save, and the title screen has a delete button if you want it gone sooner.

### Game modes

- **The Way Out (Goal Mode)** — Break the cycle: save $1,200, obtain a state-issued ID, and secure clean clothes to qualify for an apartment lease. The catch: getting an ID requires a birth certificate, which requires a mailing address, which requires knowing where to ask.
- **Endure (Endless Mode)** — Survive as long as you can. Conditions get 8% harsher every day.

### Surviving

You manage six things: **Health**, **Mental**, **Warmth**, **Hunger**, **Hygiene**, and **Cash**. If health, hunger, or mental hit zero — or the cold gets you while you're weak — it's over.

Some things that help:

- **Nightfall is a decision.** Every evening you choose: the underpass, an abandoned building, a shelter bed (free, but keep a hand on your pockets), or a rented room — from an $18 flophouse bunk (with its own risks) to a motel with a door that locks. Six motel nights paid up front buy something rarer than sleep: a real address.
- **Gear compounds.** Decent shoes stop ruining your days. Steel-toe boots unlock construction tickets at the day labor office — steady morning work at real pay. A $20 prepaid phone means the dispatcher texts you the ticket list instead of you walking two hours to read a board. A better backpack means carrying more food, and losing less when things go wrong.
- **Paperwork is survival.** A day center's mail service leads to a birth certificate, which leads to an ID, which opens doors. A night at the shelter gets you the clinic referral that the front desk demands.
- **Pack food while you can.** A $4 to-go meal in your bag is worth a lot at hour eighteen of a bad day.

## Development

The entire game lives in three files: `index.html` (UI shell), `style.css`, and `game.js` (engine + all scenario content). Scenarios are declarative objects in the `scenarios` array — adding content usually means adding an entry there.

Run the test suite (Node, no dependencies):

```
node test/win-path.test.js
```

It drives the full Goal Mode win path against a stubbed DOM and checks scenario gating, the economy, and the once-per-day event triggers.

## A note on tone

The game treats its subject seriously. Obstacles are systemic and mundane — ID catch-22s, three-hour soup kitchen lines, being told to move along — rather than dramatic. Contributions should keep that register: grounded, specific, and empathetic.
