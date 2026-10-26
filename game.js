// Build version, shown on the title screen (initTitleScreen). Scheme 1.0.x.y:
// bump x for a gameplay/content feature, y for a fix or tuning pass.
const GAME_VERSION = '1.0.28.0';

// Signing a lease costs this much up front: first month, deposit, and the
// application fees nobody warns you about. Paid in lease_signing; shown in the
// sidebar checklist; the title-screen copy in index.html states the same number.
const WIN_CASH_GOAL = 2400;

// State
let state = {
    mode: null,
    health: 100,
    mental: 100,
    warmth: 100,
    hunger: 100,
    hygiene: 100,
    foodStash: 0,
    cash: 0.00,
    timeHour: 8, // Starts at 8:00 AM
    day: 1,
    maxWarmthCapacity: 100,
    timeModifier: 1.0,
    difficultyMultiplier: 1.0,
    // Repeat suppression. seenToday is an array, not a Set: state is persisted
    // wholesale via JSON.stringify in saveGame, and a Set serializes to {}.
    seenToday: [],        // scenario ids already served today
    recentSeen: [],       // scenario ids, most recent first, capped at 20
    lastSeenDay: {},      // scenario id -> day it last fired
    // Letters addressed to the player, in send order. Plain data only — the
    // behavior for each kind lives in LETTER_KINDS (scenarios.js). See sendLetter.
    mailbox: [],
    // Tickets the player owes on. Plain data; see issueCitation / processCitations.
    citations: [],
    // Rental applications. Plain data; see submitApplication. The outcome is
    // rolled at apply time and stays hidden until the decision letter is read.
    applications: [],
    hasID: false,
    hasCleanClothes: false,
    flags: {
        hasPhone: false,
        phoneExpiryDay: 0,
        coffeeHoursRemaining: 0,
        motelDaysRemaining: 0, // active prepaid motel nights; doubles as proof of residency
        idOrdered: false,
        idArrivesDay: 0,
        returned_wallet: false,
        // Gear staging. Footwear, pack, and the sleeping bag are not listed here on
        // purpose: missing means the default (worn shoes, worn pack, bag owned) —
        // see footwear() / packState() / ownsSleepingBag() and flags.lostSleepingBag
        gearStashed: false,
        stashSpotQuality: 1, // 1 = a spot anyone would check; 2 = one somebody showed you
        stashDay: 0,
        gearAtMotel: false, // gear left in a paid-up motel room — a stash with a lock on it
        gearAtDesk: false, // checkout-morning favor: the clerk holds your pack until evening
        // Mutual aid: Ray, the grapevine, and a reputation that deliberately never shows in the UI
        metRay: false,
        streetRep: 0,
        knowsStashSpot: false,
        // Shannon: a neighbor, not a mechanic — no tips, no meter, no arc
        metShannon: false,
        // Seasons: which season turn has been announced (epoch = day / SEASON_LENGTH)
        seasonNoticedEpoch: 0,
        // Paul: Ray in ten years without the network. His scams only ever cost
        // cash and hours — never papers, never quest progress
        metPaul: false,
        transitPasses: 0,
        // Speedy: Paul is desperation with a script; Speedy is what's left when
        // the addiction does the driving. Same hard rule as Paul — he only ever
        // costs cash, food, and hours, never papers or quest progress. Ray's
        // warning is the counter-scam: the network defends you from him.
        metSpeedy: false,
        speedyWarned: false,
        // The bank: pocket cash is what a thief can reach; the checking balance
        // is what they can't. Opens with the ID — the system protects the documented
        hasBankAccount: false,
        bankBalance: 0
    }
};

// --- Save system: progress lives only in this browser's localStorage.
// No cookies, no server, no tracking — see the notice on the title screen.
const SAVE_KEY = 'the-streets-save';

function saveGame() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
}

function loadSave() {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}

function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* storage unavailable */ }
}

function deleteSave() {
    clearSave();
    document.getElementById('continue-area').style.display = 'none';
}

// Saves from before v1.0.23.2 tracked gear as overlapping booleans. Fold them
// into the single-valued flags once, then drop the old keys so nothing can
// read them by accident.
function migrateLegacyFlags(flags) {
    if (flags.footwear === undefined) {
        if (flags.hasWorkBoots) flags.footwear = 'boots';
        else if (flags.hasNewShoes) flags.footwear = 'sneakers';
        else if (flags.shoeBroken) flags.footwear = 'broken';
    }
    if (flags.pack === undefined) {
        if (flags.hasSturdyBackpack) flags.pack = 'sturdy';
        else if (flags.backpackBroken) flags.pack = flags.luggingPlasticBag ? 'plastic' : 'broken';
    }
    if (flags.hasSleepingBag === false) flags.lostSleepingBag = true;
    for (const k of ['hasWorkBoots', 'hasNewShoes', 'shoeBroken', 'hasSturdyBackpack', 'backpackBroken', 'luggingPlasticBag', 'hasSleepingBag']) {
        delete flags[k];
    }
}

function continueGame() {
    const saved = loadSave();
    if (!saved || !saved.mode) return;

    Object.assign(state, saved); // merge over defaults so old saves survive new fields
    migrateLegacyFlags(state.flags);

    // Old saves predate repeat suppression — normalize rather than trust the save
    if (!Array.isArray(state.seenToday)) state.seenToday = [];
    if (!Array.isArray(state.recentSeen)) state.recentSeen = [];
    if (!state.lastSeenDay || typeof state.lastSeenDay !== 'object') state.lastSeenDay = {};
    if (!Array.isArray(state.mailbox)) state.mailbox = []; // saves before 1.0.25.0 have no mail queue
    if (!Array.isArray(state.citations)) state.citations = []; // saves before 1.0.26.0 have no citations
    if (!Array.isArray(state.applications)) state.applications = []; // saves before 1.0.27.0 have no applications

    recomputeTimeModifier();     // timeModifier is derived from flags, never trusted from the save

    document.getElementById('title-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'flex';

    if (state.mode === 'goal') {
        document.getElementById('housing-checklist').style.display = 'block';
    } else if (state.mode === 'endless') {
        document.getElementById('endless-counter').style.display = 'block';
    }

    renderStats();
    loadScenario();
}

// A prepaid phone only helps while there are minutes on it.
// Old saves and test resets may lack the phone flags, so read them defensively.
function phoneActive() {
    return !!state.flags.hasPhone && state.day <= (state.flags.phoneExpiryDay || 0);
}

// The walk home from a job passes the corner store — nudge harder when the phone is about to die
function walkHomeStoreLine() {
    const route = " The route back into downtown passes the corner convenience store, its lights already on.";
    if (state.flags.hasPhone && !phoneActive()) {
        return route + ` <span style="color: var(--accent-color);">Your phone has been dead for days — no minutes means no dispatch texts tomorrow.</span>`;
    }
    if (state.flags.hasPhone) {
        const daysLeft = (state.flags.phoneExpiryDay || 0) - state.day;
        if (daysLeft <= 1) {
            return route + ` <span style="color: var(--accent-color);">Your phone is down to its last minutes — it goes dark ${daysLeft <= 0 ? 'tonight' : 'tomorrow'} unless you top it up.</span>`;
        }
    }
    return route;
}

// How many packed meals your current bag can hold
// Gear that has more than two states is one flag holding a string, not a
// pile of overlapping booleans — so "boots with a torn sole" can't exist.
// Missing = the default you start the game with.
function footwear() { return state.flags.footwear || 'worn'; }   // 'broken' | 'worn' | 'sneakers' | 'boots'
function hasWorkBoots() { return footwear() === 'boots'; }
function hasDecentShoes() { return footwear() === 'sneakers' || footwear() === 'boots'; }
function packState() { return state.flags.pack || 'worn'; }      // 'broken' | 'plastic' | 'worn' | 'sturdy'
function packBroken() { return packState() === 'broken' || packState() === 'plastic'; }

function carryCapacity() {
    if (packState() === 'sturdy') return 4;
    if (packBroken()) return 1; // loose bundle or plastic grocery bag
    return 2; // worn or scavenged backpack
}

// Walking speed is a fact of circumstance, not a stat: a flapping sole, a life
// carried in a grocery bag, or the rare relief of moving without forty pounds on
// your back. Derived from flags so the states compose instead of clobbering each
// other — applyEffects recomputes this after every flag change.
function recomputeTimeModifier() {
    let m = 1.0;
    if (footwear() === 'broken') m *= 1.3;       // limping on a torn sole
    if (packState() === 'plastic') m *= 1.5;     // everything you own in one hand
    if (state.flags.gearStashed) m *= 0.85;      // traveling light, for once
    state.timeModifier = m;
}

// Old saves predate the flag, so "undefined" means the bag you always had
// You start with a sleeping bag, so the flag records the exception (losing it)
// rather than the default — no inverted "missing means owned" boolean.
function ownsSleepingBag() {
    return !state.flags.lostSleepingBag;
}

// Owning a sleeping bag doesn't help if it's under a bush across town
function sleepingBagTonight() {
    return ownsSleepingBag() && !state.flags.gearStashed;
}

function startGame(mode) {
    state.mode = mode;
    document.getElementById('title-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'flex';
    
    if (mode === 'goal') {
        document.getElementById('housing-checklist').style.display = 'block';
    } else if (mode === 'endless') {
        document.getElementById('endless-counter').style.display = 'block';
    }
    
    renderStats();
    loadScenario();
}

function checkGameStatus() {
    // 1. Check for Loss. An empty stomach doesn't kill on its own — starvation
    // drains health in applyEffects, so the fatal blow still lands through health.
    if (state.health <= 0 || (state.warmth <= 0 && state.health < 50) || state.mental <= 0) {
        let reason = "You succumbed to the elements.";
        if (state.health <= 0 && state.hunger <= 0) reason = "Starvation has overtaken you.";
        if (state.mental <= 0) reason = "Your spirit broke.";
        return "GAME OVER: " + reason + " You survived " + state.day + " days.";
    }

    // 2. Check for Win (Only in Goal Mode). Money, ID, and clothes are gates on
    // the signing scene (lease_signing); only a signed lease ends the game.
    if (state.mode === "goal" && state.flags.signedLease) {
        return "VICTORY: You secured a lease on a small apartment. You broke the cycle.";
    }

    return "CONTINUE";
}

function advanceDay() {
    state.day++;
    state.seenToday = []; // a new day re-opens everything the old one used up
    if ((state.flags.motelDaysRemaining || 0) > 0) state.flags.motelDaysRemaining--;
    processMailDeadlines();
    processCitations();
    if (state.mode === "endless") {
        state.difficultyMultiplier += 0.08; // Every day gets 8% harder
    }
}

// Mail: letters that land at the player's mailing address on a future day,
// often with a response deadline. Items are plain data in state.mailbox:
//   { id, kind, address, sentDay, arriveDay, deadlineDay, status, missed }
// status is 'in_transit' | 'read' | 'resolved'; "arrived" is derived
// (in_transit and state.day >= arriveDay). Per-kind behavior — travel time,
// response window, pickup scene, what a missed deadline costs — lives in
// LETTER_KINDS in scenarios.js. Deadlines run whether or not the letter has
// been read: the system doesn't wait for you to check your mail.
// ref ties a letter to the thing it's about (a citation id); one unresolved
// letter per kind AND ref, so two tickets get two notices.
function sendLetter(kind, ref = null) {
    if (!Array.isArray(state.mailbox)) state.mailbox = [];
    if (state.mailbox.some(l => l.kind === kind && (l.ref === undefined ? null : l.ref) === ref && l.status !== 'resolved')) return;
    const def = LETTER_KINDS[kind];
    const arriveDay = state.day + def.travelDays;
    state.mailbox.push({
        // The ref suffix keeps ids unique when two notices go out the same day
        id: `${kind}_${state.day}` + (ref === null ? '' : `_${ref}`),
        kind,
        ref,
        address: 'hopewell',
        sentDay: state.day,
        arriveDay,
        deadlineDay: def.respondDays === null || def.respondDays === undefined ? null : arriveDay + def.respondDays,
        status: 'in_transit',
        missed: false
    });
}

// Called from advanceDay(): a passed deadline fires its consequence exactly once
function processMailDeadlines() {
    if (!Array.isArray(state.mailbox)) return;
    for (const letter of state.mailbox) {
        if (letter.deadlineDay === null || letter.status === 'resolved' || letter.missed) continue;
        if (state.day > letter.deadlineDay) {
            letter.missed = true;
            const def = LETTER_KINDS[letter.kind];
            if (def && def.onMissed) def.onMissed(letter);
        }
    }
}

// Oldest letter that has landed at this address and hasn't been picked up
function arrivedUnreadAt(address) {
    if (!Array.isArray(state.mailbox)) return null;
    let oldest = null;
    for (const l of state.mailbox) {
        if (l.address !== address || l.status !== 'in_transit' || state.day < l.arriveDay) continue;
        if (!oldest || l.arriveDay < oldest.arriveDay) oldest = l;
    }
    return oldest;
}

// Most recently sent letter of this kind, in any status
function findLetter(kind) {
    if (!Array.isArray(state.mailbox)) return null;
    for (let i = state.mailbox.length - 1; i >= 0; i--) {
        if (state.mailbox[i].kind === kind) return state.mailbox[i];
    }
    return null;
}

// Citations: civil/infraction tickets with the due date printed on them. Miss it
// and a late penalty lands plus a delinquency notice (mailed only if there's an
// address to mail it to); miss the second date and it goes to collections.
// amount is what's really owed; knownAmount is what the player last saw.
const CITATION_DUE_DAYS = 10;
const CITATION_LATE_PENALTY = 100;
const CITATION_COLLECTIONS_DAYS = 14;   // after going delinquent
const CITATION_COLLECTIONS_RATE = 0.20; // added on referral

function roundCents(x) { return Math.round(x * 100) / 100; }

function issueCitation(source, label, amount) {
    if (!Array.isArray(state.citations)) state.citations = [];
    let id = `${source}_${state.day}`;
    // Same source twice in one day would collide — payCitation looks up by id
    for (let n = 2; state.citations.some(c => c.id === id); n++) id = `${source}_${state.day}_${n}`;
    const c = {
        id, source, label,
        baseAmount: amount, amount, knownAmount: amount,
        issuedDay: state.day, dueDay: state.day + CITATION_DUE_DAYS, collectionsDay: null,
        status: 'open', reducedOnce: false
    };
    state.citations.push(c);
    return c;
}

// Called from advanceDay(), right after processMailDeadlines(). One step per
// citation per day: open -> delinquent -> collections, each exactly once.
function processCitations() {
    if (!Array.isArray(state.citations)) return;
    for (const c of state.citations) {
        if (c.status === 'open' && state.day > c.dueDay) {
            c.status = 'delinquent';
            c.amount = roundCents(c.amount + CITATION_LATE_PENALTY);
            c.collectionsDay = state.day + CITATION_COLLECTIONS_DAYS;
            if (state.flags.hasMailingAddress) sendLetter('citation_delinquent', c.id);
        } else if (c.status === 'delinquent' && state.day > c.collectionsDay) {
            c.status = 'collections';
            c.amount = roundCents(c.amount * (1 + CITATION_COLLECTIONS_RATE));
            state.flags.hasCollections = true;
        }
    }
}

function findCitation(id) {
    return (state.citations || []).find(c => c.id === id) || null;
}

// Unpaid citations, oldest first
function unpaidCitations() {
    return (state.citations || []).filter(c => c.status !== 'paid')
        .sort((a, b) => a.issuedDay - b.issuedDay);
}

// The citation a picked-up letter is about (flags._letterId, set at the mail bin)
function letterCitation() {
    const letter = (state.mailbox || []).find(l => l.id === state.flags._letterId);
    return letter ? findCitation(letter.ref) : null;
}

// What the ticket itself said: the face amount, or half of it after a granted
// reduction (only possible while open, so this is the pre-penalty amount)
function citationTicketAmount(c) {
    return c.reducedOnce ? roundCents(c.baseAmount / 2) : c.baseAmount;
}

function payCitation(id) {
    const c = findCitation(id);
    if (!c || c.status === 'paid') return;
    payWithFunds(c.amount);
    c.status = 'paid';
    c.knownAmount = 0;
    for (const l of (state.mailbox || [])) {
        if (l.ref === id) l.status = 'resolved';
    }
    state.flags.hasCollections = state.citations.some(x => x.status === 'collections');
}

// Rental applications: the Goal-mode endgame. Each tier is a landlord with its
// own screening; scoreApplication turns what the player has (a job, pay stubs,
// references, a collections record) into a chance, rolled once at apply time.
// The outcome rides in the mail (application_decision) and is hidden until read.
// Scoring constants were set by design — don't tune.
const APPLICATION_TIERS = {
    managed: { label: 'Riverside Commons', fee: 55, cardOnly: true },
    smallLandlord: { label: 'the walk-up on Alder', fee: 35, cardOnly: false }
};

function referenceCount() {
    return (state.flags.hasPamelaReference ? 1 : 0) + (state.flags.returned_wallet ? 1 : 0);
}

function scoreApplication(tier) {
    const reasons = [];
    const stubs = state.flags.payStubs || 0;
    const employed = !!state.flags.hasJob;
    let chance;
    if (tier === 'managed') {
        if (!employed || stubs < 2) {
            chance = 0;
            reasons.push('income');
        } else {
            chance = 0.85;
            if (state.flags.hasCollections) { chance -= 0.50; reasons.push('collections'); }
            if (referenceCount() === 0) { chance -= 0.15; reasons.push('references'); }
        }
    } else {
        if (employed && stubs >= 1) {
            chance = 0.60;
        } else {
            chance = 0.15;
            reasons.push('income');
        }
        if (state.flags.hasCollections) { chance -= 0.20; reasons.push('collections'); }
        chance += 0.15 * referenceCount();
    }
    return { chance: Math.max(0, Math.min(0.95, chance)), reasons };
}

function findApplication(id) {
    return (state.applications || []).find(a => a.id === id) || null;
}

// The decision letter for an application, if one was sent
function applicationLetter(app) {
    return (state.mailbox || []).find(l => l.ref === app.id) || null;
}

// An application still in play at this tier: pending, or approved and unsigned
function activeApplication(tier) {
    return (state.applications || []).find(a => a.tier === tier && (a.status === 'pending' || a.status === 'approved')) || null;
}

// An approval the player has read and can still act on
function approvedApplication() {
    return (state.applications || []).find(a => {
        if (a.status !== 'approved') return false;
        const l = applicationLetter(a);
        return !(l && l.missed);
    }) || null;
}

// Pays the fee, rolls the decision, mails it. Returns the application, or null
// if one is already pending or approved at that tier (no fee charged).
function submitApplication(tier) {
    if (!Array.isArray(state.applications)) state.applications = [];
    if (activeApplication(tier)) return null;
    const def = APPLICATION_TIERS[tier];
    if (def.cardOnly) {
        state.flags.bankBalance = roundCents((state.flags.bankBalance || 0) - def.fee);
    } else {
        state.cash = roundCents(state.cash - def.fee);
    }
    const { chance, reasons } = scoreApplication(tier);
    const approved = Math.random() < chance;
    let id = `${tier}_${state.day}`;
    for (let n = 2; state.applications.some(a => a.id === id); n++) id = `${tier}_${state.day}_${n}`;
    const app = {
        id, tier,
        appliedDay: state.day,
        outcome: approved ? 'approved' : 'denied',
        reasons: approved ? [] : reasons,
        status: 'pending',
        extensionAsked: false // one ask for more time per application
    };
    state.applications.push(app);
    sendLetter('application_decision', id);
    return app;
}

// Asking for more time to sign. A small landlord is a person and may say yes;
// Riverside Commons is a policy and always says no. One ask per application.
// The deadline lives on the mailbox item, so a granted extension just moves
// deadlineDay and processMailDeadlines, the gear line, and the checklist all
// pick it up unchanged. Constants were set by design — don't tune.
const EXTENSION_DAYS = 4;
const EXTENSION_BASE = 0.40;
const EXTENSION_JOB_BONUS = 0.20;
const EXTENSION_REF_BONUS = 0.15; // per reference

function extensionChance() {
    const c = EXTENSION_BASE + (state.flags.hasJob ? EXTENSION_JOB_BONUS : 0) + EXTENSION_REF_BONUS * referenceCount();
    return Math.max(0, Math.min(0.90, c));
}

// The application the player can still ask about: approved, unsigned, unmissed, not yet asked
function canAskExtension() {
    const app = approvedApplication();
    return !!(app && !(app.extensionAsked || false));
}

// The application behind the letter being read (flags._letterId, set at the mail bin)
function letterApplication() {
    const letter = (state.mailbox || []).find(l => l.id === state.flags._letterId);
    return letter ? findApplication(letter.ref) : null;
}

function requestExtension(appId) {
    const app = findApplication(appId);
    if (!app) return null;
    app.extensionAsked = true;
    const letter = applicationLetter(app);
    let granted = false;
    if (app.tier === 'smallLandlord' && letter && Math.random() < extensionChance()) {
        letter.deadlineDay += EXTENSION_DAYS;
        granted = true;
    }
    state.flags._extension = { granted, newDay: letter ? letter.deadlineDay : null, tier: app.tier };
    return state.flags._extension;
}

// Seasons: derived entirely from state.day — no new save fields, so old saves
// just land wherever the calendar says they are. Warmth is the cold-comfort
// stat, so winter/summer mostly work by scaling the drains that already exist:
// winter makes the cold the main event, summer trades it for sweat (hygiene)
// and heat hazards. roughWarmth shifts what a night outside gives back, which
// flips the shelter economics with the season — winter pushes you indoors,
// summer makes the underpass almost free.
const SEASON_LENGTH = 12; // days per season
const SEASON_ORDER = ['autumn', 'winter', 'spring', 'summer'];
const SEASONS = {
    autumn: { label: 'Autumn', warmthDrain: 1.0,  hygieneDrain: 1.0, roughWarmth: 0 },
    winter: { label: 'Winter', warmthDrain: 1.5,  hygieneDrain: 1.0, roughWarmth: -8 },
    spring: { label: 'Spring', warmthDrain: 0.75, hygieneDrain: 1.0, roughWarmth: 4 },
    summer: { label: 'Summer', warmthDrain: 0.25, hygieneDrain: 2.0, roughWarmth: 10 }
};

// Epoch counts season turns since day 1 (never wraps); the season name cycles.
function seasonEpoch() { return Math.floor((state.day - 1) / SEASON_LENGTH); }
function currentSeason() { return SEASON_ORDER[seasonEpoch() % SEASON_ORDER.length]; }
function seasonConfig() { return SEASONS[currentSeason()]; }
function seasonDaysLeft() { return SEASON_LENGTH - ((state.day - 1) % SEASON_LENGTH); }

// How much a night's sleep RESTORES, added toward each cap — never a hard reset.
// The worse the spot, the less you actually recover, so deprivation compounds
// across days instead of wiping clean every morning. These are the numbers to
// tune once you playtest the spiral slope. (motel_weekly mental 100 is deliberate:
// the weekly's signature perk is a full mental reset, per the original design spec.)
const SLEEP_QUALITY = {
    rough:        { health: 6,  mental: 8,  hunger: 4,  hygiene: 2,  fullWarmth: false, warmth: 10 },
    shelter:      { health: 35, mental: 40, hunger: 40, hygiene: 30, fullWarmth: true },
    flophouse:    { health: 40, mental: 30, hunger: 35, hygiene: 22, fullWarmth: true },
    motel:        { health: 70, mental: 70, hunger: 60, hygiene: 80, fullWarmth: true },
    motel_weekly: { health: 75, mental: 100, hunger: 60, hygiene: 85, fullWarmth: true }
};

// Advance to the next morning and apply additive restoration (clamped to caps).
// opts: { healthPenalty, mentalPenalty, warmth } — warmth overrides rough warmth per spot.
function applySleep(tier, opts = {}) {
    const q = SLEEP_QUALITY[tier] || SLEEP_QUALITY.rough;
    // Where you woke up this morning is part of Pamela's intake read
    state.flags.lastNightTier = tier;

    if (state.timeHour < 8) {
        state.timeHour = 8;
    } else {
        advanceDay();
        state.timeHour = 8;
    }

    state.health  = Math.min(100, state.health  + q.health);
    state.mental  = Math.min(100, state.mental  + q.mental);
    state.hunger  = Math.min(100, state.hunger  + q.hunger);
    state.hygiene = Math.min(100, state.hygiene + q.hygiene);

    if (q.fullWarmth) {
        state.warmth = state.maxWarmthCapacity;
    } else {
        // opts.warmth can be negative now (a bagless night outside costs warmth), so clamp both ends
        const w = opts.warmth !== undefined ? opts.warmth : (q.warmth || 0);
        state.warmth = Math.max(0, Math.min(state.maxWarmthCapacity, state.warmth + w));
    }

    if (opts.healthPenalty) state.health -= opts.healthPenalty;
    if (opts.mentalPenalty) state.mental -= opts.mentalPenalty;

    state.health = Math.max(0, state.health);
    state.mental = Math.max(0, state.mental);
}

// Sleeping outside: barely restorative, and the night itself can go wrong
function resolveRough(spot) {
    const SPOTS = {
        underpass: { warmth: 10, risk: 0.25 },
        abandoned: { warmth: 16, risk: 0.40 } // warmer, but more dangerous
    };
    const s = SPOTS[spot] || SPOTS.underpass;
    // The same spot gives back more or less depending on the season — a winter
    // underpass barely counts as shelter, a summer one almost does
    const spotWarmth = s.warmth + seasonConfig().roughWarmth;

    // Without the sleeping bag — swept, abandoned, or stashed across town — a
    // rough night stops being rest and starts being endurance
    const bagless = !sleepingBagTonight();
    // Splitting watches with Ray — capture before applySleep rolls the calendar forward
    const watched = state.flags.sharedWatchDay === state.day;
    applySleep('rough', bagless
        ? { warmth: spotWarmth - 18, healthPenalty: 4, mentalPenalty: 5 }
        : { warmth: spotWarmth });

    let msg;
    if (watched) {
        // Nobody robs a sleeper with a lookout: no risk roll at all, and the
        // half-night of real sleep restores more than a whole night of flinching
        state.health = Math.min(100, state.health + 4);
        state.mental = Math.min(100, state.mental + 8);
        msg = "You and Ray split the night into watches — four hours down, four hours up, packs stacked between you. Nothing walks up on you. Nothing goes missing. The sleep you get is real sleep, because someone you trust is awake. Two people can hold a night that would eat one.";
    } else if (Math.random() < s.risk) {
        const roll = Math.random();
        if (roll < 0.45) {
            state.mental = Math.max(0, state.mental - 12);
            state.health = Math.max(0, state.health - 4);
            msg = "You never really slept. Every noise snapped you awake, and by first light you're wrung out and jittery.";
        } else if (roll < 0.75 && state.cash > 0) {
            const lost = Math.round(state.cash * (0.3 + Math.random() * 0.5) * 100) / 100;
            state.cash = Math.max(0, state.cash - lost);
            state.mental = Math.max(0, state.mental - 10);
            msg = `You woke to someone going through your things. $${lost.toFixed(2)} gone. Out here, sleep is a luxury you pay for.`;
        } else {
            state.warmth = Math.max(0, state.warmth - 15);
            state.health = Math.max(0, state.health - 8);
            msg = "It turned bitter and wet overnight. You shivered through it and woke stiff, damp, and colder than when you lay down.";
        }
    } else {
        msg = "You bed down and pull everything tight around you. Shallow, uneasy sleep — but the night passes and you make it to morning.";
    }

    if (bagless) {
        msg += " No sleeping bag tonight — cardboard under you, your coat over you, and the cold finding every gap between the two.";
    }

    renderStats();
    if (checkGameStatus() !== "CONTINUE") return;

    document.getElementById('narrative-text').innerHTML = `<p>${msg}</p>`;
    document.getElementById('choices-list').innerHTML =
        `<button class="choice-btn" onclick="loadScenario()">Face the day</button>`;
}

function resolveTheft(confront) {
    let mentalPenalty = 0;
    let healthPenalty = 0;
    let customMsg = "";

    if (!confront) {
        const stolenAmount = state.cash * (Math.random() * 0.90);
        state.cash -= stolenAmount;
        mentalPenalty = 15;
        customMsg = `<br><br><span style="color: var(--accent-color);">You pretended to sleep. The thief took $${stolenAmount.toFixed(2)}. The helplessness sits heavy on you.</span>`;
    } else {
        if (Math.random() < 0.5) {
            healthPenalty = 20;
            customMsg = `<br><br><span style="color: var(--accent-color);">You fought the thief off and kept your money, but took a beating for it.</span>`;
        } else {
            customMsg = `<br><br><span style="color: #4bd863;">You startled the thief and they bolted. Your money's safe.</span>`;
        }
    }

    // Finish the night wherever the robbery interrupted it (shelter or flophouse)
    const tier = state.flags._pendingSleep || 'shelter';
    state.flags._pendingSleep = null;
    applySleep(tier, { healthPenalty, mentalPenalty });

    renderStats();
    if (checkGameStatus() !== "CONTINUE") return;

    document.getElementById('narrative-text').innerHTML = `<p>Morning comes.${customMsg}</p>`;
    document.getElementById('choices-list').innerHTML =
        `<button class="choice-btn" onclick="loadScenario()">Step back outside</button>`;
}

function resolveShelter() {
    // Ray called this place full tonight; if you got a bed anyway, he was wrong.
    // Capture before applySleep rolls the calendar forward.
    const rayWasWrong = state.flags.shelterTipDay === state.day && state.flags.shelterFullDay !== state.day;

    applySleep('shelter');

    let referralMsg = "";
    if (!state.flags.hasShelterReferral) {
        state.flags.hasShelterReferral = true;
        referralMsg = " On your way out, the intake worker stamps a slip of paper and presses it into your hand: a referral to the free health clinic. 'Hold onto that. They won't see you without it.'";
    }
    if (rayWasWrong) {
        referralMsg += " Ray had this place full by six. He was wrong — there were beds to spare. Twenty-two years out here and the man is still not an oracle.";
    }

    renderStats();
    if (checkGameStatus() !== "CONTINUE") return;

    document.getElementById('narrative-text').innerHTML = `<p>You get a shelter bed for the night. It's not silent and it's not home, but you sleep behind a locked door and wake a little more human.${referralMsg}</p>`;
    document.getElementById('choices-list').innerHTML =
        `<button class="choice-btn" onclick="loadScenario()">Step back outside</button>`;
}

// Costs, perks, and flavor per rented tier — recovery amounts live in SLEEP_QUALITY
const ROOM_TIERS = {
    flophouse: {
        cost: 18, robberyChance: 0.2,
        msg: "A canvas cot in a room full of snoring strangers, a shared bathroom down the hall, and a mattress you try not to think about. You sleep with your shoes on and one eye open — but you sleep."
    },
    motel: {
        cost: 50, discountable: true,
        msg: "A hot shower, a real mattress, a door that locks. You raid the vending machine, sleep nine unbroken hours, and wake up feeling almost like your old self.",
        prepaidMsg: "Your key still works — of course it does; the room is paid for. A hot shower, a real mattress, a door nobody can move you along from. You sleep like a person with somewhere to be."
    },
    motel_weekly: {
        cost: 200, discountable: true, nights: 6,
        msg: "You count the bills out and the clerk slides you a brass key — yours for six nights. A door that locks. A shower. An address. You lie in the dark listening to the heater tick and, for the first time in months, your mind goes quiet."
    }
};

// Returning the lost wallet earns a permanent 20% discount at the motel — the owner manages it
function roomCost(tier) {
    const room = ROOM_TIERS[tier];
    if (room.discountable && state.flags.returned_wallet) return Math.round(room.cost * 0.8);
    return room.cost;
}

// The motel has a card reader; the Alcove has a cigar box. With the ATM card,
// motel tiers can be paid from combined funds — pocket cash spends first, the
// checking balance covers the rest. requires.funds gates on the combined total.
function totalFunds() {
    return state.cash + (state.flags.hasBankAccount ? (state.flags.bankBalance || 0) : 0);
}
function payWithFunds(amount) {
    const fromCash = Math.min(state.cash, amount);
    state.cash = Math.round((state.cash - fromCash) * 100) / 100;
    const fromCard = Math.round((amount - fromCash) * 100) / 100;
    if (fromCard > 0) state.flags.bankBalance = Math.max(0, Math.round(((state.flags.bankBalance || 0) - fromCard) * 100) / 100);
    return fromCard;
}

// W-2 pay is weekly, not per-shift: a shift's gross accrues to pendingWages, and
// only a payday actually moves money. On payday, everything accrued BEFORE
// today's shift pays out first (pay runs a period in arrears), then today's
// shift starts the next period. All warehouse pay must route through here —
// wage garnishment (later feature) hooks in at the payout step below.
const PAY_PERIOD_DAYS = 7;
const CHECK_CASHING_FEE_RATE = 0.03;

function workShift(gross) {
    state.flags.pendingWages = state.flags.pendingWages || 0;
    // Legacy save: employed with no payday on the books yet — start a fresh period from today
    if (state.flags.nextPayday === undefined) state.flags.nextPayday = state.day + PAY_PERIOD_DAYS;

    state.flags._paycheck = null;

    if (state.day >= state.flags.nextPayday) {
        const amount = Math.round(state.flags.pendingWages * 100) / 100;
        if (amount > 0) {
            let fee = 0;
            const banked = !!state.flags.hasBankAccount;
            if (banked) {
                state.flags.bankBalance = Math.round(((state.flags.bankBalance || 0) + amount) * 100) / 100;
            } else {
                fee = Math.round(amount * CHECK_CASHING_FEE_RATE * 100) / 100;
                state.cash = Math.round((state.cash + (amount - fee)) * 100) / 100;
            }
            state.flags._paycheck = { amount, fee, banked };
            state.flags.payStubs = (state.flags.payStubs || 0) + 1; // proof of income for a rental application
        }
        state.flags.pendingWages = 0;
        // A long gap between shifts can't leave payday stuck in the past
        while (state.flags.nextPayday <= state.day) state.flags.nextPayday += PAY_PERIOD_DAYS;
    }

    state.flags.pendingWages = Math.round((state.flags.pendingWages + gross) * 100) / 100;
}

function resolveRoom(tier, prepaid) {
    const room = ROOM_TIERS[tier];
    let cardPaid = 0;
    if (!prepaid) {
        if (tier === 'flophouse') state.cash = Math.max(0, state.cash - roomCost(tier));
        else cardPaid = payWithFunds(roomCost(tier));
    }
    // Nights stack on whatever's already on the ledger (same rule as
    // renewMotelWeek) — buying mid-week must never eat paid nights
    if (room.nights) state.flags.motelDaysRemaining = (state.flags.motelDaysRemaining || 0) + room.nights;

    // Flophouse: open bunks and no locks — some nights the wrong person notices you
    if (room.robberyChance && Math.random() < room.robberyChance && state.cash > 0) {
        state.flags._pendingSleep = tier;
        loadScenario('shelter_robbery');
        return;
    }

    // Coming home to gear you left in the room: the stash resolves itself — no
    // sweep roll, no walk across town, just your things where you put them
    const reunited = (state.flags.gearAtMotel || state.flags.gearAtDesk) && (tier === 'motel' || tier === 'motel_weekly');
    if (reunited) {
        state.flags.gearAtMotel = false;
        state.flags.gearAtDesk = false;
        state.flags.gearStashed = false;
        recomputeTimeModifier();
    }

    applySleep(tier);

    renderStats();
    if (checkGameStatus() !== "CONTINUE") return;

    let msg = (prepaid && room.prepaidMsg) ? room.prepaidMsg : room.msg;
    if (cardPaid > 0) {
        msg += ` The clerk runs your card for $${cardPaid.toFixed(2)} of it without a second look — the first roof in a long time with a receipt behind it.`;
    }
    if (reunited) {
        msg += " Your gear sits on the luggage rack exactly where you left it this morning — untouched, because nobody could touch it.";
    }
    document.getElementById('narrative-text').innerHTML = `<p>${msg}</p>`;

    // If the room is paid through tonight too, the morning offers what a bush
    // never could: leave the heavy gear behind a locked door for the day
    const atMotel = tier === 'motel' || tier === 'motel_weekly';
    const remaining = state.flags.motelDaysRemaining || 0;
    const roomTonight = atMotel && remaining > 0 &&
        ownsSleepingBag() && !state.flags.gearStashed;
    // Checkout morning: before you hand the key back, the desk offers two things
    // the sidewalk can't — another six nights on the books, or a favor: your
    // pack behind the counter until evening
    const checkoutMorning = atMotel && remaining <= 0;
    const renewCost = roomCost('motel_weekly');
    const deskHold = checkoutMorning && ownsSleepingBag() && !state.flags.gearStashed;
    // The DMV envelope shouldn't be a lottery ticket: you pass this desk every
    // night you sleep here, so the morning it's due, the desk offers it
    const idAtDesk = atMotel && state.mode === 'goal' && state.flags.idOrdered && state.flags.idViaMotel && !state.hasID && state.day >= (state.flags.idArrivesDay || 0);

    const choicesContainer = document.getElementById('choices-list');
    choicesContainer.innerHTML = `
        ${idAtDesk ? `<button class="choice-btn" onclick="loadScenario('id_arrives')">The clerk holds up an envelope with a state seal — pick up your mail at the desk.</button>` : ''}
        ${roomTonight ? `<button class="choice-btn" onclick="leaveGearAtMotel()">Leave the sleeping bag and heavy gear in the room — it's paid through tonight.</button>` : ''}
        ${checkoutMorning ? `<button class="choice-btn" onclick="renewMotelWeek()" ${totalFunds() < renewCost ? 'disabled' : ''}>Stop at the desk and pay for six more nights ($${renewCost.toFixed(2)}).${totalFunds() < renewCost ? ' (Not enough money)' : ''}</button>` : ''}
        ${deskHold ? `<button class="choice-btn" onclick="leaveGearAtDesk()">Ask the desk to hold your pack until evening.</button>` : ''}
        <button class="choice-btn" onclick="loadScenario()">${prepaid ? 'Lock the door behind you and head out' : 'Check out and step outside'}</button>
    `;
}

// Checkout morning, reconsidered: the weekly rate is available to anyone at the
// desk with the cash — including someone who woke up here and doesn't want to
// find out what the sidewalk costs this week. Nights add on, never overwrite.
function renewMotelWeek() {
    const cost = roomCost('motel_weekly');
    if (totalFunds() < cost) return;
    const cardPaid = payWithFunds(cost);
    state.flags.motelDaysRemaining = (state.flags.motelDaysRemaining || 0) + ROOM_TIERS.motel_weekly.nights;

    renderStats();
    if (checkGameStatus() !== "CONTINUE") return;

    const renewMsg = cardPaid > 0
        ? `You slide the ATM card across the desk before the clerk can ask for the key back. Four seconds of card-reader noises and they slide the key right back — six more nights on the ledger, same room, same lock, and a paper trail that says you live somewhere. Upstairs, the bed is still unmade the way you left it. It's still yours.`
        : `You count the bills out before the clerk can ask for the key back. They slide it right back across the counter without ceremony — six more nights on the ledger, same room, same lock. Upstairs, the bed is still unmade the way you left it. It's still yours.`;
    document.getElementById('narrative-text').innerHTML = `<p>${renewMsg}</p>`;

    const roomTonight = ownsSleepingBag() && !state.flags.gearStashed;
    const idAtDesk = state.mode === 'goal' && state.flags.idOrdered && state.flags.idViaMotel && !state.hasID && state.day >= (state.flags.idArrivesDay || 0);
    document.getElementById('choices-list').innerHTML = `
        ${idAtDesk ? `<button class="choice-btn" onclick="loadScenario('id_arrives')">The clerk holds up an envelope with a state seal — pick up your mail at the desk.</button>` : ''}
        ${roomTonight ? `<button class="choice-btn" onclick="leaveGearAtMotel()">Leave the sleeping bag and heavy gear in the room — it's paid through tonight.</button>` : ''}
        <button class="choice-btn" onclick="loadScenario()">Lock the door behind you and head out</button>
    `;
}

// No room tonight, but the clerk will keep a pack behind the counter until
// evening — a stash with a roof, a lock, and no sweep schedule. Good for one
// day; the dusk pickup is forced from loadScenario like any other stash.
function leaveGearAtDesk() {
    state.flags.gearStashed = true;
    state.flags.gearAtDesk = true;
    state.flags.stashDay = state.day;
    recomputeTimeModifier();
    loadScenario();
}

// Leaving gear in a paid-up room costs nothing and risks nothing — the whole
// point of a door that locks. The city's sweep schedule has no jurisdiction here.
function leaveGearAtMotel() {
    state.flags.gearStashed = true;
    state.flags.gearAtMotel = true;
    state.flags.stashDay = state.day;
    recomputeTimeModifier();
    loadScenario();
}

function applyEffects(effects) {
    if (!effects) return;

    if (effects.maxWarmthCapacity !== undefined) state.maxWarmthCapacity = Math.max(0, state.maxWarmthCapacity + effects.maxWarmthCapacity);

    if (effects.health !== undefined) state.health += effects.health;
    if (effects.mentalFortitude !== undefined) state.mental += effects.mentalFortitude;
    if (effects.warmth !== undefined) state.warmth += effects.warmth;
    if (effects.hunger !== undefined) state.hunger += effects.hunger;
    if (effects.hygiene !== undefined) state.hygiene += effects.hygiene;
    if (effects.foodStash !== undefined) state.foodStash += effects.foodStash;
    if (effects.cash !== undefined) state.cash += effects.cash;
    if (effects.hasID !== undefined) state.hasID = effects.hasID;
    if (effects.hasCleanClothes !== undefined) state.hasCleanClothes = effects.hasCleanClothes;
    if (effects.flags !== undefined) {
        for (const [key, value] of Object.entries(effects.flags)) {
            state.flags[key] = value;
        }
    }

    // Recompute now (flags may have just changed, here or in a customAction) so
    // this action's own timePassed is charged at the current encumbrance
    recomputeTimeModifier();

    // Time advancement and passive drain
    let timePassed = effects.timePassed !== undefined ? effects.timePassed : 1;
    timePassed *= state.timeModifier;
    
    if (timePassed > 0) {
        const season = seasonConfig();
        const warmupDrain = 3 * state.difficultyMultiplier * season.warmthDrain;
        const hungerDrain = 2.5 * state.difficultyMultiplier;

        // A recent hot coffee holds the hunger drain at bay, hour for hour
        const coffeeHours = state.flags.coffeeHoursRemaining || 0;
        const hungryHours = Math.max(0, timePassed - coffeeHours);
        state.flags.coffeeHoursRemaining = Math.max(0, coffeeHours - timePassed);

        state.warmth -= warmupDrain * timePassed;
        state.hunger -= hungerDrain * hungryHours;
        state.hygiene -= 1.5 * season.hygieneDrain * timePassed;

        // Being visibly unwashed wears on you
        if (state.hygiene < 25) {
            state.mental -= 1 * timePassed;
        }

        state.timeHour += timePassed;
        while (state.timeHour >= 24) {
            state.timeHour -= 24;
            advanceDay();
        }
    }

    // Starvation stage: running past empty doesn't kill outright — the hunger
    // deficit converts into health and mental damage, a shrinking window to
    // find food rather than a sudden stop.
    if (state.hunger < 0) {
        state.health += state.hunger * 0.75;
        state.mental += state.hunger * 0.4;
        state.hunger = 0;
    }

    state.health = Math.max(0, Math.min(100, state.health));
    state.mental = Math.max(0, Math.min(100, state.mental));
    state.warmth = Math.max(0, Math.min(state.maxWarmthCapacity, state.warmth));
    state.hunger = Math.max(0, Math.min(100, state.hunger));
    state.hygiene = Math.max(0, Math.min(100, state.hygiene));
    state.foodStash = Math.max(0, Math.min(carryCapacity(), state.foodStash));
    state.cash = Math.max(0, state.cash);
}

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
    lost_wallet: 6,
    // Evening work lane: an empty night is a true thing about the world —
    // the weights renormalize when nothing's on
    event_teardown: 1,
    dishpit_closing: 2,
    ray_dishpit_line: 2
};

// Scenarios that may legitimately fire more than once in a day. Everything else
// is once-daily. Keep this list short — it is the exception, not the default.
const REPEATABLE_SAME_DAY = new Set(['find_meal', 'idle_time', 'soup_kitchen']);

// Category-weighted selection: roll a lane first, then a scenario within it.
// A flat pool lets every new scenario dilute every old one — write three street
// characters and suddenly the drywall truck never comes. Bucketing means new
// encounters only compete with other encounters, and "work shows up about a
// quarter of the time" stays true no matter how much content gets added.
const CATEGORY_WEIGHTS = { work: 25, food: 20, encounter: 20, quest: 20, hazard: 15 };

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

        // Scenario weight still applies, but only against neighbors in the same lane
        const pool = [];
        buckets[chosen].forEach(s => {
            const w = s.weight || 1;
            for (let i = 0; i < w; i++) pool.push(s);
        });
        return pool[Math.floor(Math.random() * pool.length)];
    }
    return null;
}

function loadScenario(id) {
    // Stop if the game has already ended (death or victory) — renderStats shows the end screen
    if (checkGameStatus() !== "CONTINUE") {
        renderStats();
        return;
    }

    // Checkout morning: the prepaid week ran out with your gear still in the
    // room — the desk has already turned it over, and this can't wait
    if (!id && state.flags.gearAtMotel && (state.flags.motelDaysRemaining || 0) <= 0) {
        id = 'motel_gear_desk';
    }

    // Dusk: the desk favor ends when the day shift does — go collect the pack.
    // No sweep roll behind a counter; the walk back is the whole cost.
    if (!id && state.flags.gearAtDesk && state.timeHour >= 18 && state.flags.lastRetrievalPromptDay !== state.day) {
        id = 'desk_gear_pickup';
    }

    // Dusk: stashed gear has to be dealt with before the shelter prompt — what
    // the sweep did or didn't take changes what tonight costs. Gear behind a
    // motel door doesn't need retrieving; the room is where tonight happens.
    if (!id && state.flags.gearStashed && !state.flags.gearAtMotel && !state.flags.gearAtDesk && state.timeHour >= 18 && state.flags.lastRetrievalPromptDay !== state.day) {
        id = 'retrieve_stash';
    }

    // Nightfall: force the shelter decision once per evening
    if (!id && state.timeHour >= 19 && state.flags.lastShelterPromptDay !== state.day) {
        state.flags.lastShelterPromptDay = state.day;
        id = 'find_shelter';
    }

    // A job changes what morning means: the warehouse gate replaces the ticket
    // board, same window, same once-per-day stamp
    if (!id && state.flags.hasJob && state.timeHour >= 6 && state.timeHour <= 10 && state.flags.lastWorkDay !== state.day) {
        id = 'warehouse_shift';
    }

    // The labor office is a guaranteed morning stop for everyone, once per day —
    // boots don't gate the stop, they gate which tickets you're allowed to take.
    // The stash decision lives inside it as a choice, so one stop carries both.
    if (!id && !state.flags.hasJob && state.timeHour >= 6 && state.timeHour <= 10 && state.flags.lastLaborDay !== state.day) {
        id = 'labor_office';
    }

    // Season turn: a one-time notice at the lowest priority — it never preempts
    // the office, the stash, or the night, and costs no time when it fires
    if (!id && (state.flags.seasonNoticedEpoch || 0) !== seasonEpoch()) {
        state.flags.seasonNoticedEpoch = seasonEpoch();
        id = 'season_change';
    }

    let scenario;
    if (id) {
        scenario = scenarios.find(s => s.id === id);
    } else {
        scenario = pickRandomScenario();
    }
    
    if (!scenario) {
        scenario = scenarios.find(s => s.id === 'find_meal'); // fallback
    }

    // dev only — logs what the picker actually had to choose from
    if (location.hash === '#debug') {
        const b = {};
        scenarios.forEach(s => {
            if (s.notRandom || (s.condition && !s.condition())) return;
            b[s.category || 'encounter'] = (b[s.category || 'encounter'] || 0) + 1;
        });
        console.log(`d${state.day} ${formatClock(state.timeHour)}`, b, '→', scenario.id);
    }

    // Suppression bookkeeping. notRandom scenarios are forced or linked, never
    // drawn, so they don't participate — recording them would poison the buffer.
    if (!scenario.notRandom) {
        if (!state.seenToday.includes(scenario.id)) state.seenToday.push(scenario.id);
        state.recentSeen.unshift(scenario.id);
        if (state.recentSeen.length > 20) state.recentSeen.pop();
        state.lastSeenDay[scenario.id] = state.day;
    }

    if (scenario.onLoad) scenario.onLoad();

    if (scenario.effects) {
        applyEffects(scenario.effects);
        // Entry effects may have ended the game
        if (checkGameStatus() !== "CONTINUE") {
            renderStats();
            return;
        }
    }
    
    renderStats();
    
    const scenarioText = typeof scenario.text === 'function' ? scenario.text() : scenario.text;
    document.getElementById('narrative-text').innerHTML = `<p>${scenarioText}</p>`;
    
    const choicesContainer = document.getElementById('choices-list');
    choicesContainer.innerHTML = '';
    
    if (scenario.choices) {
        scenario.choices.forEach(choice => {
            // Unlike requires (which renders a disabled button), hidden choices don't
            // exist at all until you learn they do — grapevine knowledge stays invisible
            if (choice.hidden && choice.hidden()) return;

            const btn = document.createElement('button');
            btn.className = 'choice-btn';

            // Choice text and cash requirements may be functions of state (e.g. karma-discounted prices)
            const choiceText = typeof choice.text === 'function' ? choice.text() : choice.text;

            let reqMet = true;
            let reqMsg = "";
            if (choice.requires) {
                const cashReq = typeof choice.requires.cash === 'function' ? choice.requires.cash() : choice.requires.cash;
                if (cashReq !== undefined && state.cash < cashReq) { reqMet = false; reqMsg = `(Requires $${cashReq.toFixed(2)})`; }
                // funds: pocket cash plus the checking balance (card-reader vendors only)
                const fundsReq = typeof choice.requires.funds === 'function' ? choice.requires.funds() : choice.requires.funds;
                if (fundsReq !== undefined && totalFunds() < fundsReq) { reqMet = false; reqMsg = `(Requires $${fundsReq.toFixed(2)})`; }
                if (choice.requires.mentalFortitude !== undefined && state.mental < choice.requires.mentalFortitude) { reqMet = false; reqMsg = `(Requires ${choice.requires.mentalFortitude}% Mental Fortitude)`; }
                if (choice.requires.health !== undefined && state.health < choice.requires.health) { reqMet = false; reqMsg = `(Requires ${choice.requires.health}% Health)`; }
                if (choice.requires.hunger !== undefined && state.hunger < choice.requires.hunger) { reqMet = false; reqMsg = `(Requires ${choice.requires.hunger}% Hunger)`; }
                if (choice.requires.flag !== undefined && !state.flags[choice.requires.flag]) { reqMet = false; reqMsg = choice.requires.flagLabel || '(Unavailable)'; }
                if (choice.requires.notFlag !== undefined && state.flags[choice.requires.notFlag]) { reqMet = false; reqMsg = choice.requires.notFlagLabel || '(Unavailable)'; }
                if (choice.requires.stash !== undefined && state.foodStash < choice.requires.stash) { reqMet = false; reqMsg = '(Nothing packed to eat)'; }
                if (choice.requires.stashSpace && state.foodStash >= carryCapacity()) { reqMet = false; reqMsg = '(No room in your bag)'; }
                // hygiene mirrors the health gate, but the generic % message reads
                // wrong for a once-over at a kitchen door — allow a custom label
                if (choice.requires.hygiene !== undefined && state.hygiene < choice.requires.hygiene) { reqMet = false; reqMsg = choice.requires.hygieneLabel || `(Requires ${choice.requires.hygiene}% Hygiene)`; }
                // check: generic gate for what the other keys can't express (a
                // closed intake window). hidden = knowledge you don't have;
                // a disabled check = a door you can see but can't open.
                // checkLabel may be a function when one check has several reasons to fail
                if (choice.requires.check !== undefined && !choice.requires.check()) {
                    reqMet = false;
                    const label = typeof choice.requires.checkLabel === 'function' ? choice.requires.checkLabel() : choice.requires.checkLabel;
                    reqMsg = label || '(Unavailable)';
                }
            }

            if (reqMet) {
                btn.textContent = choiceText;
                btn.onclick = () => makeChoice(choice);
            } else {
                btn.textContent = `${choiceText} ${reqMsg}`;
                btn.disabled = true;
                btn.style.opacity = 0.5;
                btn.style.cursor = 'not-allowed';
            }
            choicesContainer.appendChild(btn);
        });
    }
}

function formatClock(hour) {
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = Math.floor(hour % 12) || 12; // handle decimals from modifiers
    // format minutes if fractional hour
    let mins = Math.floor((hour % 1) * 60);
    let minStr = mins < 10 ? `0${mins}` : `${mins}`;
    return `${displayHour}:${minStr} ${ampm}`;
}

function formatTime(hour) {
    return `${formatClock(hour)} (Day ${state.day})`;
}

// The mobile sticky strip's compact vitals; a no-op cosmetically on desktop
// where CSS hides the strip. Danger thresholds mirror the dashboard's.
function renderVitalsStrip() {
    updateElement('strip-health', `${Math.floor(state.health)}%`, state.health <= 30);
    updateElement('strip-warmth', `${Math.floor(state.warmth)}%`, state.warmth <= 30);
    updateElement('strip-hunger', state.hunger <= 0 ? 'Starving' : `${Math.floor(state.hunger)}%`, state.hunger <= 30);
    updateElement('strip-cash', `$${state.cash.toFixed(2)}`);
    updateElement('strip-time', `D${state.day} · ${formatClock(state.timeHour)}`);
}

// Mobile Stats drawer toggle (strip button's inline onclick in index.html)
function toggleDashboard() {
    const open = document.body.classList.toggle('dash-open');
    const btn = document.getElementById('dash-toggle');
    if (btn) btn.textContent = open ? 'Stats ▴' : 'Stats ▾';
}

function updateElement(id, value, isDanger = false) {
    const el = document.getElementById(id);
    el.textContent = value;
    if (isDanger) {
        el.classList.add('danger');
    } else {
        el.classList.remove('danger');
    }
}

function renderGear() {
    const list = document.getElementById('gear-list');
    if (!list) return;

    const items = [];
    const pack = {
        sturdy: 'Heavy-duty pack',
        plastic: 'Plastic grocery bag',
        broken: 'Broken backpack (one strap)',
        worn: 'Worn backpack'
    }[packState()];
    items.push(`${pack} — meals: ${state.foodStash}/${carryCapacity()}`);

    // The sleeping bag's states: on your back, behind a motel door, behind the
    // front desk for the day, under a bush across town, or gone
    if (!ownsSleepingBag()) {
        items.push('Sleeping bag (lost)');
    } else if (state.flags.gearAtMotel) {
        items.push((state.flags.motelDaysRemaining || 0) > 0
            ? 'Sleeping bag (locked in your motel room)'
            : 'Sleeping bag (held at the motel desk)');
    } else if (state.flags.gearAtDesk) {
        items.push('Sleeping bag (held at the motel desk)');
    } else if (state.flags.gearStashed) {
        const daysOut = state.day - (state.flags.stashDay || state.day);
        items.push(`Sleeping bag (stashed${daysOut > 0 ? ` — ${daysOut} day${daysOut === 1 ? '' : 's'} out` : ' today'})`);
    } else {
        items.push('Sleeping bag (carried)');
    }

    if (state.flags.hasPhone) {
        if (phoneActive()) {
            const daysLeft = (state.flags.phoneExpiryDay || 0) - state.day;
            items.push(`Prepaid phone (active — ${daysLeft > 0 ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : 'expires tonight'})`);
        } else {
            items.push('Prepaid phone (no minutes)');
        }
    }
    const motelDays = state.flags.motelDaysRemaining || 0;
    if (motelDays > 0) items.push(`Motel residency proof (${motelDays} day${motelDays === 1 ? '' : 's'} remaining)`);

    if (state.flags.hasBankAccount) items.push(`ATM card — checking $${(state.flags.bankBalance || 0).toFixed(2)}`);

    if (state.flags.hasJob) {
        const payday = state.flags.nextPayday !== undefined ? state.flags.nextPayday : state.day + PAY_PERIOD_DAYS;
        items.push(`Paycheck: $${(state.flags.pendingWages || 0).toFixed(2)} accrued — payday day ${payday}`);
    }

    const passes = state.flags.transitPasses || 0;
    if (passes > 0) items.push(`Bus day pass${passes === 1 ? '' : `es (×${passes})`}`);

    const shoes = { boots: 'Steel-toe work boots', sneakers: 'Decent sneakers', broken: 'Torn shoe (limping)' }[footwear()];
    if (shoes) items.push(shoes);
    if (state.flags.hasWinterCoat) items.push('Winter coat');
    if (state.hasCleanClothes) items.push('Clean clothes');
    if (state.flags.hasShelterReferral) items.push('Clinic referral slip');
    if (state.hasID) {
        items.push('State ID');
    } else {
        if (state.flags.hasMailingAddress) items.push('Mailing address (Hopewell)');
        if (state.flags.hasBirthCert) items.push('Birth certificate');
        if (state.flags.idOrdered) items.push(`State ID (in the mail — day ${state.flags.idArrivesDay})`);
    }

    // Mail shows only once it's been read — a letter in transit or sitting
    // unread in the bin is something the player doesn't know about yet
    const waitlistLetter = findLetter('waitlist_confirm');
    if (waitlistLetter && waitlistLetter.status === 'read' && !waitlistLetter.missed) {
        items.push(`Housing letter — respond by day ${waitlistLetter.deadlineDay}`);
    }
    if (state.flags.onHousingList) items.push('Housing waitlist (active)');
    // The drop happens on the deadline, read or not — but it only shows once
    // the player has opened the letter that tells them
    if (state.flags.waitlistDropped && !(waitlistLetter && waitlistLetter.status === 'in_transit')) {
        items.push('Housing waitlist (dropped)');
    }

    // Applications: the outcome stays hidden until the decision letter is read,
    // so anything with an unread letter reads as waiting, whatever it really is
    for (const app of (state.applications || [])) {
        const label = APPLICATION_TIERS[app.tier].label;
        const letter = applicationLetter(app);
        if (letter && letter.status === 'in_transit') {
            items.push(`Rental application — ${label} (waiting to hear)`);
        } else if (app.status === 'approved' && letter && !letter.missed) {
            items.push(`Approved: ${label} — sign by day ${letter.deadlineDay} ($${WIN_CASH_GOAL} move-in)`);
        }
    }
    if (state.flags.hasPamelaReference) items.push('Reference letter from Pamela');

    // Citations show what the player last saw (knownAmount), never the live amount
    for (const c of unpaidCitations()) {
        const known = c.knownAmount || 0;
        if (c.status === 'open') {
            items.push(`${c.label}: $${known.toFixed(2)} due day ${c.dueDay}`);
        } else if (known === citationTicketAmount(c)) {
            items.push(`${c.label} — past due since day ${c.dueDay}`);
        } else {
            // "In collections" only once someone has said so (the clerk sets
            // knownAmount to the live amount); a notice read earlier doesn't
            const inCollections = c.status === 'collections' && known === c.amount;
            items.push(`${c.label}: $${known.toFixed(2)} owed${inCollections ? ' — in collections' : ''}`);
        }
    }

    list.innerHTML = items.map(i => `<li>${i}</li>`).join('');
}

// Meter fill under a vital stat card. Width is the value (clamped — warmth can
// exceed 100), color steps at the same 30/60 marks the text danger state uses.
function renderBar(id, value) {
    const bar = document.getElementById(id);
    if (!bar) return;
    bar.style.width = `${Math.max(0, Math.min(100, value))}%`;
    bar.classList.remove('mid');
    bar.classList.remove('low');
    if (value <= 30) bar.classList.add('low');
    else if (value <= 60) bar.classList.add('mid');
}

// Season tint + night vignette, via classes on <body> that style.css keys off.
// The test stub's document has no body — bail quietly there.
function renderAtmosphere() {
    const body = document.body;
    if (!body || !body.classList) return;
    SEASON_ORDER.forEach(s => body.classList.remove(`season-${s}`));
    body.classList.add(`season-${currentSeason()}`);
    if (state.timeHour >= 19 || state.timeHour < 6) {
        body.classList.add('time-night');
    } else {
        body.classList.remove('time-night');
    }
}

function renderStats() {
    renderAtmosphere();
    renderVitalsStrip();
    updateElement('stat-health', `${Math.floor(state.health)}%`, state.health <= 30);
    updateElement('stat-mental', `${Math.floor(state.mental)}%`, state.mental <= 30);
    updateElement('stat-warmth', `${Math.floor(state.warmth)}%`, state.warmth <= 30);
    updateElement('stat-hunger', state.hunger <= 0 ? 'Starving' : `${Math.floor(state.hunger)}%`, state.hunger <= 30);
    updateElement('stat-hygiene', `${Math.floor(state.hygiene)}%`, state.hygiene <= 30);

    renderBar('bar-health', state.health);
    renderBar('bar-mental', state.mental);
    renderBar('bar-warmth', state.warmth);
    renderBar('bar-hunger', state.hunger);
    renderBar('bar-hygiene', state.hygiene);
    // Warmth capacity lost to gear (cap below 100) shows as a hatched dead zone
    // at the bar's right end
    document.getElementById('bar-warmth-lost').style.width =
        `${Math.max(0, 100 - state.maxWarmthCapacity)}%`;
    
    document.getElementById('stat-cash').textContent = `$${state.cash.toFixed(2)}`;
    document.getElementById('stat-time').textContent = formatTime(state.timeHour);

    // Season card: count down the last days before a turn so winter never
    // arrives unannounced; the card runs warning-red all winter long
    const daysLeft = seasonDaysLeft();
    updateElement('stat-season',
        seasonConfig().label + (daysLeft <= 3 ? ` (${daysLeft}d)` : ''),
        currentSeason() === 'winter');
    
    // Update goal mode UI
    if (state.mode === 'goal') {
        const totalSaved = state.cash + (state.flags.bankBalance || 0);
        document.getElementById('check-cash').textContent = totalSaved >= WIN_CASH_GOAL
            ? `[x] Save $${WIN_CASH_GOAL}`
            : `[$${Math.floor(totalSaved)} / $${WIN_CASH_GOAL}] saved`;
        document.getElementById('check-id').textContent = state.hasID
            ? '[x] Obtain state-issued ID'
            : state.flags.idOrdered
                ? `[~] State ID in the mail (day ${state.flags.idArrivesDay})`
                : '[ ] Obtain state-issued ID';
        document.getElementById('check-clothes').textContent =
            (state.hasCleanClothes ? '[x]' : '[ ]') + ' Secure clean clothes';
        const approval = approvedApplication();
        document.getElementById('check-lease').textContent = state.flags.signedLease
            ? '[x] Get approved and sign a lease'
            : approval
                ? `[~] Approved at ${APPLICATION_TIERS[approval.tier].label} — sign by day ${applicationLetter(approval).deadlineDay}`
                : '[ ] Get approved and sign a lease';
    }
    
    // Update endless mode UI
    if (state.mode === 'endless') {
        document.getElementById('day-counter-val').textContent = state.day;
    }

    renderGear();

    if (state.mode) saveGame();

    checkGameOver();
}

function checkGameOver() {
    const status = checkGameStatus();
    
    if (status.startsWith("GAME OVER")) {
        endGame(status.replace("GAME OVER: ", ""));
    } else if (status.startsWith("VICTORY")) {
        clearSave();
        document.getElementById('narrative-text').innerHTML = `<p style="color: #4bd863; font-weight: bold;">VICTORY</p><p>${status.replace("VICTORY: ", "")}</p>`;
        document.getElementById('choices-list').innerHTML = `
            <button class="choice-btn" onclick="location.reload()">Play Again</button>
        `;
    }
}

function endGame(message) {
    clearSave();
    document.getElementById('narrative-text').innerHTML = `<p style="color: var(--accent-color); font-weight: bold;">GAME OVER</p><p>${message}</p>`;
    document.getElementById('choices-list').innerHTML = `
        <button class="choice-btn" onclick="location.reload()">Try Again</button>
    `;
}

// Initial game state is paused until startGame is called.

// Number keys 1–9 fire the matching choice. Disabled (requirement-gated)
// buttons never fire; modifier chords and held-key repeats are ignored.
// The test stub's document has no addEventListener — skip there.
if (typeof document.addEventListener === 'function') {
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
        if (!state.mode) return; // title screen
        const n = parseInt(e.key, 10);
        if (!n) return; // only '1'-'9'
        const btn = document.querySelectorAll('#choices-list .choice-btn')[n - 1];
        if (btn && !btn.disabled) btn.click();
    });
}

// Title screen: offer to continue a saved run, if one exists
(function initTitleScreen() {
    document.getElementById('version-tag').textContent = 'v' + GAME_VERSION;
    const saved = loadSave();
    if (saved && saved.mode) {
        const modeName = saved.mode === 'goal' ? 'The Way Out' : 'Endure';
        document.getElementById('continue-btn').innerHTML =
            `<strong>Continue</strong><br><small>Day ${saved.day} — ${modeName} — $${Number(saved.cash).toFixed(2)}</small>`;
        document.getElementById('continue-area').style.display = 'block';
    }
})();
