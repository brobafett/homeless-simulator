// Build version, shown on the title screen (initTitleScreen). Scheme 1.0.x.y:
// bump x for a gameplay/content feature, y for a fix or tuning pass.
const GAME_VERSION = '1.0.2.0';

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
        // Gear staging: the sleeping bag was always implicitly there — now it's a thing you can lose
        hasSleepingBag: true,
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
        transitPasses: 0
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

function continueGame() {
    const saved = loadSave();
    if (!saved || !saved.mode) return;

    Object.assign(state, saved); // merge over defaults so old saves survive new fields
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
function carryCapacity() {
    if (state.flags.hasSturdyBackpack) return 4;
    if (state.flags.backpackBroken) return 1; // plastic grocery bag
    return 2; // worn or scavenged backpack
}

// Walking speed is a fact of circumstance, not a stat: a flapping sole, a life
// carried in a grocery bag, or the rare relief of moving without forty pounds on
// your back. Derived from flags so the states compose instead of clobbering each
// other — applyEffects recomputes this after every flag change.
function recomputeTimeModifier() {
    let m = 1.0;
    if (state.flags.shoeBroken) m *= 1.3;        // limping on a torn sole
    if (state.flags.luggingPlasticBag) m *= 1.5; // everything you own in one hand
    if (state.flags.gearStashed) m *= 0.85;      // traveling light, for once
    state.timeModifier = m;
}

// Old saves predate the flag, so "undefined" means the bag you always had
function ownsSleepingBag() {
    return state.flags.hasSleepingBag !== false;
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

    // 2. Check for Win (Only in Goal Mode)
    if (state.mode === "goal") {
        if (state.cash >= 1200 && state.hasID && state.hasCleanClothes) {
            return "VICTORY: You secured a lease on a small apartment. You broke the cycle.";
        }
    }

    return "CONTINUE";
}

function advanceDay() {
    state.day++;
    if ((state.flags.motelDaysRemaining || 0) > 0) state.flags.motelDaysRemaining--;
    if (state.mode === "endless") {
        state.difficultyMultiplier += 0.08; // Every day gets 8% harder
    }
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

function resolveRoom(tier, prepaid) {
    const room = ROOM_TIERS[tier];
    if (!prepaid) state.cash = Math.max(0, state.cash - roomCost(tier));
    if (room.nights) state.flags.motelDaysRemaining = room.nights;

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

    const choicesContainer = document.getElementById('choices-list');
    choicesContainer.innerHTML = `
        ${roomTonight ? `<button class="choice-btn" onclick="leaveGearAtMotel()">Leave the sleeping bag and heavy gear in the room — it's paid through tonight.</button>` : ''}
        ${checkoutMorning ? `<button class="choice-btn" onclick="renewMotelWeek()" ${state.cash < renewCost ? 'disabled' : ''}>Stop at the desk and pay for six more nights ($${renewCost.toFixed(2)}).${state.cash < renewCost ? ' (Not enough cash)' : ''}</button>` : ''}
        ${deskHold ? `<button class="choice-btn" onclick="leaveGearAtDesk()">Ask the desk to hold your pack until evening.</button>` : ''}
        <button class="choice-btn" onclick="loadScenario()">${prepaid ? 'Lock the door behind you and head out' : 'Check out and step outside'}</button>
    `;
}

// Checkout morning, reconsidered: the weekly rate is available to anyone at the
// desk with the cash — including someone who woke up here and doesn't want to
// find out what the sidewalk costs this week. Nights add on, never overwrite.
function renewMotelWeek() {
    const cost = roomCost('motel_weekly');
    if (state.cash < cost) return;
    state.cash = Math.max(0, state.cash - cost);
    state.flags.motelDaysRemaining = (state.flags.motelDaysRemaining || 0) + ROOM_TIERS.motel_weekly.nights;

    renderStats();
    if (checkGameStatus() !== "CONTINUE") return;

    document.getElementById('narrative-text').innerHTML = `<p>You count the bills out before the clerk can ask for the key back. They slide it right back across the counter without ceremony — six more nights on the ledger, same room, same lock. Upstairs, the bed is still unmade the way you left it. It's still yours.</p>`;

    const roomTonight = ownsSleepingBag() && !state.flags.gearStashed;
    document.getElementById('choices-list').innerHTML = `
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

// The dispatcher's ticket list — shared between labor_office and labor_board so
// stashing your gear first doesn't cost you the morning's options
const LABOR_TICKETS = [
    { text: "Take a general labor ticket — moving furniture (4 hrs, $40.00).", requires: { health: 40, hunger: 30 }, effects: { cash: 40.00, health: -10, hunger: -25, mentalFortitude: 5, timePassed: 4 }, nextScenario: 'labor_done_general' },
    {
        text: "Take a construction site ticket (6 hrs, $90.00).",
        requires: { flag: 'hasWorkBoots', flagLabel: '(Requires work boots)', health: 50, hunger: 40 },
        // You can't haul your bed to a jobsite and still lift block for six
        // hours — stashed gear halves what the shift takes out of you
        customAction: () => {
            applyEffects({ cash: 90.00, health: state.flags.gearStashed ? -10 : -20, hunger: -40, warmth: 10, mentalFortitude: 10, timePassed: 6 });
            loadScenario('labor_done_construction');
        }
    },
    { text: "Leave. You're in no shape to work today.", nextScenario: null }
];

const scenarios = [
    // Original Scenarios Converted
    {
        id: 'find_meal',
        notRandom: false,
        category: 'food',
        // A full stomach doesn't go looking for meals — below 70 the text is at
        // least honest, and when everyone's fed the food lane yields its share
        condition: () => state.hunger < 70,
        text: () => state.hunger < 30 ?
            "Your stomach growls violently. The cold morning air bites at your skin. You need food soon or you won't have the energy to keep moving. What do you do?" : 
            "You are feeling peckish. It might be a good idea to secure a meal while you have the chance. What do you do?",
        choices: [
            { text: "Beg outside the local bakery.", effects: { health: -2, mentalFortitude: -2, warmth: -5, hunger: 10, cash: 2.50 } },
            { text: "Search the dumpster behind the grocery store.", customAction: () => {
                applyEffects({ health: -5, mentalFortitude: -5, warmth: -10, hunger: 30 });
                if (state.flags.backpackBroken && Math.random() < 0.35) {
                    loadScenario('dumpster_backpack');
                } else {
                    loadScenario();
                }
            }},
            { text: "Visit the busy intersection to panhandle.", effects: { health: -2, mentalFortitude: -5, warmth: -10, hunger: -5, cash: 5.00 } },
            { text: "Buy hot soup from a local deli ($3.00)", requires: { cash: 3.00 }, effects: { cash: -3.00, health: 5, mentalFortitude: 15, warmth: 35, hunger: 40 } },
            { text: "Get a cup of hot coffee ($1.00)", requires: { cash: 1.00 }, effects: { cash: -1.00, health: 2, mentalFortitude: 15, warmth: 20, hunger: 5 } },
            { text: "Sit down for a full hot meal at the diner ($8.00)", requires: { cash: 8.00 }, effects: { cash: -8.00, health: 10, mentalFortitude: 20, warmth: 30, hunger: 70 } },
            { text: "Buy a to-go meal to pack for later ($4.00)", requires: { cash: 4.00, stashSpace: true }, effects: { cash: -4.00, foodStash: 1, timePassed: 0.3 } },
            { text: "Eat a packed meal from your bag.", requires: { stash: 1 }, effects: { foodStash: -1, hunger: 35, mentalFortitude: 5, timePassed: 0.3 } }
        ]
    },
    {
        id: 'find_shelter',
        notRandom: false,
        category: 'hazard',
        condition: () => state.timeHour >= 17 || state.timeHour <= 5,
        text: "The light is fading and the temperature is dropping fast. You need to figure out where you're spending the night.",
        choices: [
            { text: "Bed down under the underpass for the night.", customAction: () => resolveRough('underpass') },
            {
                text: () => state.flags.shelterTipDay === state.day
                    ? "Try the downtown shelter anyway — Ray says they're full by six."
                    : "Try to get a bed at the downtown shelter.",
                customAction: () => {
                    // On nights Ray called full, the walk over ends at a closed door
                    if (state.flags.shelterFullDay === state.day) {
                        loadScenario('shelter_full');
                    } else if (Math.random() < 0.03 && state.cash > 0) {
                        state.flags._pendingSleep = 'shelter';
                        loadScenario('shelter_robbery');
                    } else {
                        resolveShelter();
                    }
                }
            },
            { text: "Hunker down in an abandoned building for the night.", customAction: () => resolveRough('abandoned') },
            { text: "Head back to your motel room — it's paid through the week.", requires: { flag: 'motelDaysRemaining', flagLabel: '(No room paid up)' }, customAction: () => resolveRoom('motel', true) },
            { text: "Rent a room for the night (from $18.00).", requires: { cash: 18.00 }, nextScenario: 'rent_room' }
        ]
    },
    {
        id: 'rent_room',
        notRandom: true,
        text: () => {
            let text = `Two signs glow against the dark a few blocks apart: THE ALCOVE — BEDS $18, and a budget motel with a flickering VACANCY sign at $${roomCost('motel')} a night. A hand-lettered card in the motel office window adds: WEEKLY RATE — 6 NIGHTS, $${roomCost('motel_weekly')} UP FRONT.`;
            if (state.flags.returned_wallet) {
                text += " The manager at the motel desk is the person whose wallet you returned. They quietly knock 20% off the motel's rates whenever they see you: 'Honest people stay cheaper here.'";
            }
            return text;
        },
        choices: [
            { text: "A bunk at the Alcove flophouse ($18.00).", requires: { cash: 18.00 }, customAction: () => resolveRoom('flophouse') },
            { text: () => `A room at the budget motel ($${roomCost('motel').toFixed(2)}).`, requires: { cash: () => roomCost('motel') }, customAction: () => resolveRoom('motel') },
            { text: () => `Six nights at the motel, paid up front ($${roomCost('motel_weekly').toFixed(2)}).`, requires: { cash: () => roomCost('motel_weekly') }, customAction: () => resolveRoom('motel_weekly') },
            { text: "Too rich for tonight. Reconsider your options.", customAction: () => loadScenario('find_shelter') }
        ]
    },
    {
        id: 'shelter_robbery',
        notRandom: true,
        text: "You manage to get a bed and fall asleep. But in the middle of the night, you are jolted awake by the feeling of a hand reaching into your pockets!",
        choices: [
            { text: "Pretend to sleep and let them take it (Lose money, -10% mental)", customAction: () => resolveTheft(false) },
            { text: "Confront the thief! (Keep money, risk injury)", customAction: () => resolveTheft(true) }
        ]
    },
    {
        id: 'idle_time',
        notRandom: false,
        category: 'encounter',
        text: "The streets are relatively quiet. A rare moment of stillness, but the constant pressure of survival never really leaves you.",
        choices: [
            { text: "Rest on a park bench.", effects: { health: 5, mentalFortitude: 15, warmth: -8, hunger: -5 } },
            { text: "Wander and collect cans for recycling.", customAction: () => {
                applyEffects({ health: -5, mentalFortitude: 5, warmth: -10, hunger: -8, cash: 3.50 });
                if (state.flags.backpackBroken && Math.random() < 0.35) {
                    loadScenario('dumpster_backpack');
                } else {
                    loadScenario();
                }
            }},
            { text: "Check the bins behind the restaurant row for tossed food.", effects: { hunger: 12, hygiene: -4, mentalFortitude: -3, timePassed: 0.4 } },
            { text: "Read a discarded newspaper to stay sharp.", effects: { health: 0, mentalFortitude: 20, warmth: -5, hunger: -5 } },
            { text: "Warm up with a cup of hot soup ($3.00)", requires: { cash: 3.00 }, effects: { cash: -3.00, health: 5, mentalFortitude: 15, warmth: 35, hunger: 30 } },
            { text: "Get a cup of hot coffee ($1.00)", requires: { cash: 1.00 }, effects: { cash: -1.00, health: 2, mentalFortitude: 15, warmth: 20, hunger: 5 } },
            { text: "Eat a packed meal from your bag.", requires: { stash: 1 }, effects: { foodStash: -1, hunger: 35, mentalFortitude: 5, timePassed: 0.3 } },
            { text: "Stop by the convenience store on the corner.", effects: { timePassed: 0.2 }, nextScenario: 'convenience_store' }
        ]
    },
    {
        id: 'convenience_store',
        notRandom: true,
        text: () => {
            let phoneLine;
            if (!state.flags.hasPhone) {
                phoneLine = "Behind the register, a rack of prepaid burner phones hangs next to the cigarettes: $20 for a handset loaded with five days of minutes — enough for a dispatcher or a caseworker to actually reach you.";
            } else if (phoneActive()) {
                phoneLine = "Your prepaid phone still has minutes on it, but a $10 top-up card would buy another five days before it goes dark.";
            } else {
                phoneLine = "Your prepaid phone has been dead for days — no minutes, no callbacks. A $10 top-up card would put five days of service back on it.";
            }
            return "Fluorescent lights, burnt coffee, a clerk who watches you without quite staring. " + phoneLine;
        },
        effects: { warmth: 5, timePassed: 0.1 },
        choices: [
            {
                text: "Buy a prepaid phone ($20.00).",
                requires: { cash: 20.00, notFlag: 'hasPhone', notFlagLabel: '(You already own a phone)' },
                customAction: () => {
                    state.flags.hasPhone = true;
                    state.flags.phoneExpiryDay = state.day + 5;
                    applyEffects({ cash: -20.00, mentalFortitude: 10, timePassed: 0.3 });
                    loadScenario('phone_bought');
                }
            },
            {
                text: "Top up your phone — 5 more days ($10.00).",
                requires: { cash: 10.00, flag: 'hasPhone', flagLabel: "(You don't own a phone)" },
                customAction: () => {
                    // Extend from today if the minutes already ran out
                    state.flags.phoneExpiryDay = Math.max(state.day, state.flags.phoneExpiryDay || 0) + 5;
                    applyEffects({ cash: -10.00, timePassed: 0.2 });
                    loadScenario('phone_topped_up');
                }
            },
            { text: "Warm your hands a minute and leave.", nextScenario: null }
        ]
    },
    {
        id: 'phone_bought',
        notRandom: true,
        text: "The clerk snaps the phone out of its plastic shell and activates it at the counter. It's cheap, the screen is scratched, but it rings — and that changes everything. The day labor dispatcher can text you the morning ticket list now. No more two-hour walks just to read a board.",
        choices: [ { text: "Pocket the phone and save the dispatcher's number.", nextScenario: null } ]
    },
    {
        id: 'phone_topped_up',
        notRandom: true,
        text: "You scratch the foil off the top-up card and punch in the code. Five more days of minutes. Five more days of being reachable — which, out here, is five more days of being employable.",
        choices: [ { text: "Step back outside.", nextScenario: null } ]
    },
    // New Advanced Scenarios
    {
        id: "intake_appointment",
        notRandom: false,
        category: 'quest',
        condition: () => !state.hasID && state.timeHour >= 9 && state.timeHour <= 16 && !state.flags.intake_attempted,
        text: "You finally made it to your housing assessment appointment after walking 3 miles. The caseworker is sympathetic but looks at your clipboard. 'I need a state-issued photo ID and a verification of homelessness form from a registered shelter to process this.' You have neither, and the shelter won't give you a form without an ID.",
        effects: { hunger: -15, mentalFortitude: -25, timePassed: 3, flags: { intake_attempted: true } },
        choices: [
            { text: "Argue your case and demand to speak to a supervisor.", nextScenario: "caseworker_confrontation", requires: { mentalFortitude: 40 } },
            { text: "Leave the office. Walk to the library to research how to order a replacement ID online.", nextScenario: "library_research", effects: { cash: 0 } }
        ]
    },
    {
        id: "library_refuge",
        notRandom: false,
        category: 'encounter',
        // "Pouring rain, freezing" framing — doesn't fit a heat wave
        condition: () => state.timeHour >= 9 && state.timeHour <= 19 && currentSeason() !== 'summer',
        text: "It's pouring rain. You step into the public library to get dry and charge your phone. Your backpack is soaked and leaks a small puddle onto the linoleum. Within five minutes, a security guard steps into your line of sight, arms crossed, staring at you.",
        effects: { warmth: 15, mentalFortitude: -5, timePassed: 0.5 },
        choices: [
            { text: "Keep your head down, mimic reading a heavy book, and try to blend in.", nextScenario: "library_stay_quiet" },
            { text: "Find a corner carrel, spread your wet layers to dry, and quietly eat something from your bag.", requires: { stash: 1 }, effects: { foodStash: -1, hunger: 35, warmth: 15, mentalFortitude: 10, timePassed: 1.5 }, nextScenario: "library_dry_out" },
            { text: "Pack your things and leave before they ask you to. It's better than getting banned.", nextScenario: "back_in_rain", effects: { warmth: -20, mentalFortitude: -2 } }
        ]
    },
    {
        id: "backpack_breaks",
        notRandom: false,
        category: 'hazard',
        // The scene narrates the sleeping bag spilling out, so it needs the bag on your back
        condition: () => !state.flags.backpackBroken && !state.flags.hasSturdyBackpack && ownsSleepingBag() && !state.flags.gearStashed,
        text: "As you hurry across the intersection, the left strap of your overstuffed backpack snaps. Your sleeping bag, a change of clothes, and your plastic folder of vital documents spill onto the wet pavement. You can't carry it all loose.",
        effects: { mentalFortitude: -15, timePassed: 0.5, flags: { backpackBroken: true } },
        choices: [
            { text: "Abandon the heavy sleeping bag. Keep the documents and extra clothes.", nextScenario: "street_lightweight", effects: { maxWarmthCapacity: -20, flags: { hasSleepingBag: false } } },
            { text: "Use a discarded plastic grocery bag to bundle the loose items. It will drastically slow your walking speed.", nextScenario: "street_with_plastic_bag", effects: { flags: { luggingPlasticBag: true } } }
        ]
    },
    {
        id: "food_truck_encounter",
        notRandom: false,
        category: 'food',
        // The text claims 18 foodless hours; the gate keeps that claim honest,
        // and a bin burrito only tempts a stomach that's already arguing
        condition: () => state.hunger < 55,
        text: "A tourist near a food truck plaza drops half a gourmet burrito into a trash can right in front of you. It's wrapped in foil and untouched on top of the bin. You haven't eaten in 18 hours.",
        effects: { timePassed: 0.2 },
        choices: [
            { 
                text: "Grab it quickly before anyone notices you scavenging.", 
                customAction: () => {
                    let effectsToApply = { hunger: 40, timePassed: 0 };
                    let msg = "<br><br>You ate the burrito. It was delicious and filling.";
                    if (Math.random() < 0.3) {
                        effectsToApply.health = -30;
                        msg += " <span style='color: var(--accent-color);'>But a few hours later, your stomach violently cramps. Food poisoning.</span>";
                    }
                    applyEffects(effectsToApply);
                    renderStats();
                    if (checkGameStatus() !== "CONTINUE") return; // death screen already shown

                    document.getElementById('narrative-text').innerHTML += msg;
                    document.getElementById('choices-list').innerHTML =
                        `<button class="choice-btn" onclick="loadScenario()">Keep going</button>`;
                }
            },
            { text: "Buy your own burrito from the truck ($7.00).", requires: { cash: 7.00 }, effects: { cash: -7.00, hunger: 50, warmth: 10, mentalFortitude: 10 }, nextScenario: null },
            { text: "Keep walking. Your dignity—and your stomach—can't take it right now.", nextScenario: "street_hungry", effects: { hunger: -5, mentalFortitude: 5 } }
        ]
    },
    // Additional Advanced Scenarios (8-20)
    {
        id: 'stray_dog',
        notRandom: false,
        category: 'encounter',
        text: "A scruffy stray dog approaches you, tail wagging cautiously. It looks hungry, but it's friendly.",
        effects: { timePassed: 0.2 },
        choices: [
            { text: "Share some of your food.", requires: { hunger: 50 }, effects: { hunger: -20, mentalFortitude: 20 }, nextScenario: 'dog_fed' },
            { text: "Just pet the dog.", effects: { mentalFortitude: 10 }, nextScenario: 'dog_pet' },
            { text: "Shoo it away. You can't take care of yourself, let alone a dog.", effects: { mentalFortitude: -5 }, nextScenario: null }
        ]
    },
    {
        id: 'dog_fed',
        notRandom: true,
        text: "The dog happily eats the food and licks your hand. It follows you for a few blocks before getting distracted by a squirrel. You feel a rare moment of connection.",
        choices: [ { text: "Keep walking.", nextScenario: null } ]
    },
    {
        id: 'dog_pet',
        notRandom: true,
        text: "The dog enjoys the attention but eventually wanders off looking for a meal. You feel a bit lighter.",
        choices: [ { text: "Keep walking.", nextScenario: null } ]
    },
    {
        id: 'shoe_blowout',
        notRandom: false,
        category: 'hazard',
        condition: () => !state.flags.hasNewShoes,
        text: "Disaster. The worn-out sole of your right shoe finally tears completely off. Walking on the exposed pavement is agonizing.",
        effects: { mentalFortitude: -20, timePassed: 0 },
        choices: [
            { text: "Buy some duct tape at a convenience store to patch it.", requires: { cash: 2.00 }, effects: { cash: -2.00, timePassed: 0.5 }, nextScenario: 'shoe_patched' },
            { text: "Tear a piece of your shirt to tie it together.", nextScenario: 'shoe_shirt', effects: { maxWarmthCapacity: -10, timePassed: 0.5 } },
            { text: "Limp along with the broken shoe.", nextScenario: 'shoe_broken_limp', effects: { flags: { shoeBroken: true } } }
        ]
    },
    {
        id: 'shoe_patched',
        notRandom: true,
        text: "The duct tape holds the sole together. It's not pretty, and it's not waterproof, but you can walk normally again.",
        choices: [ { text: "Resume walking.", nextScenario: null } ]
    },
    {
        id: 'shoe_shirt',
        notRandom: true,
        text: "You ruined a good shirt, reducing your overall warmth, but the makeshift tie keeps the sole attached for now.",
        choices: [ { text: "Resume walking.", nextScenario: null } ]
    },
    {
        id: 'shoe_broken_limp',
        notRandom: true,
        text: "Every step is painful and slow. It's going to take you much longer to get anywhere now.",
        choices: [ { text: "Limp onward.", nextScenario: null } ]
    },
    {
        id: 'public_transit',
        notRandom: false,
        category: 'encounter',
        // "You're freezing" — nobody rides the subway to warm up in July
        condition: () => currentSeason() !== 'summer',
        text: "You're freezing, and the subway station looks incredibly inviting. A heated train ride from one end of the line to the other would take 2 hours.",
        effects: { timePassed: 0.1 },
        choices: [
            { text: "Pay the fare.", requires: { cash: 2.75 }, effects: { cash: -2.75, warmth: 40, mentalFortitude: 10, timePassed: 2 }, nextScenario: 'subway_ride' },
            {
                text: "Swipe one of the day passes from Ray.",
                hidden: () => !((state.flags.transitPasses || 0) > 0),
                customAction: () => {
                    state.flags.transitPasses--;
                    applyEffects({ warmth: 40, mentalFortitude: 10, timePassed: 2 });
                    loadScenario('subway_ride');
                }
            },
            { text: "Jump the turnstile.", customAction: () => {
                if (Math.random() < 0.2) {
                    loadScenario('subway_caught');
                } else {
                    applyEffects({ warmth: 40, mentalFortitude: 10, timePassed: 2 });
                    loadScenario('subway_ride');
                }
            }},
            { text: "Stay above ground.", nextScenario: null }
        ]
    },
    {
        id: 'subway_ride',
        notRandom: true,
        text: "The gentle rocking of the train and the blast of the heater offer a temporary escape from the harsh reality of the streets. Two hours to the end of the line and back — time that's yours for once, and warm.",
        choices: [
            { text: "Eat a packed meal while the city slides past the window.", requires: { stash: 1 }, effects: { foodStash: -1, hunger: 35, mentalFortitude: 5, timePassed: 0 }, nextScenario: null },
            { text: "Doze against the window, hood up.", effects: { health: 5, mentalFortitude: 5, timePassed: 0 }, nextScenario: null },
            { text: "Just watch the stations go by, then exit.", nextScenario: null }
        ]
    },
    {
        id: 'subway_caught',
        notRandom: true,
        text: "A transit officer grabs your shoulder as soon as your feet hit the platform. They write you a $50 ticket you can't pay and kick you out into the cold.",
        effects: { mentalFortitude: -30, timePassed: 0.5 },
        choices: [ { text: "Walk away in shame.", nextScenario: null } ]
    },
    {
        id: 'medical_clinic',
        notRandom: false,
        category: 'encounter',
        condition: () => state.timeHour >= 8 && state.timeHour <= 17,
        text: "You pass a free health clinic. You have a nagging cough that hasn't gone away for weeks.",
        effects: { timePassed: 0.1 },
        choices: [
            { text: "Walk in and ask to see a doctor.", nextScenario: 'clinic_desk' },
            { text: "Ignore the cough. It's probably nothing.", effects: { health: -10 }, nextScenario: null }
        ]
    },
    {
        id: 'clinic_desk',
        notRandom: true,
        text: "The receptionist asks for an ID and insurance card. When you explain your situation, they say they can only see you if you have a referral from a shelter.",
        choices: [
            { text: "Hand over the referral slip from the downtown shelter.", requires: { flag: 'hasShelterReferral', flagLabel: '(Requires a shelter referral)' }, nextScenario: 'clinic_treated' },
            {
                text: "Ask about the Thursday walk-in list Ray mentioned.",
                hidden: () => !state.flags.clinicWalkInTip,
                customAction: () => {
                    state.flags.clinicWalkInTip = false; // one favor per tip
                    loadScenario('clinic_walkin');
                }
            },
            { text: "Argue that you need help now.", requires: { mentalFortitude: 50 }, nextScenario: 'clinic_argue' },
            { text: "Leave quietly.", effects: { mentalFortitude: -5 }, nextScenario: null }
        ]
    },
    {
        id: 'clinic_treated',
        notRandom: true,
        text: "The receptionist checks the slip and waves you back. A doctor listens to your chest, prescribes antibiotics from the sample cabinet, and dresses the blisters on your feet. Real medical care, no arguing required.",
        effects: { health: 40, mentalFortitude: 15, timePassed: 2 },
        choices: [ { text: "Leave feeling better than you have in weeks.", nextScenario: null } ]
    },
    {
        id: 'clinic_argue',
        notRandom: true,
        text: "You cause enough of a scene that a sympathetic nurse pulls you aside, gives you a basic checkup, and hands you some antibiotics.",
        effects: { health: 30, mentalFortitude: 10, timePassed: 1 },
        choices: [ { text: "Thank them and leave.", nextScenario: null } ]
    },
    {
        id: 'gym_trial',
        notRandom: false,
        category: 'encounter',
        condition: () => state.hygiene <= 40,
        text: "You can smell yourself, and so can everyone else. You stand outside a 24-hour fitness center, thinking about the showers inside.",
        effects: { timePassed: 0.1 },
        choices: [
            { text: "Pay $5 for a guest day pass.", requires: { cash: 5.00 }, effects: { cash: -5.00, health: 15, mentalFortitude: 30, warmth: 20, hygiene: 100, timePassed: 1 }, nextScenario: 'gym_shower' },
            { text: "Try to slip in behind someone.", customAction: () => {
                // Reduced failure rate to 20%
                if (Math.random() < 0.2) {
                    loadScenario('gym_caught');
                } else {
                    applyEffects({ health: 15, mentalFortitude: 30, warmth: 20, hygiene: 100, timePassed: 1 });
                    loadScenario('gym_shower');
                }
            }},
            { text: "Walk away.", nextScenario: null }
        ]
    },
    {
        id: 'gym_shower',
        notRandom: true,
        text: "The hot water washes away layers of grime and stress. You feel almost human again. You even manage to wash some socks in the sink.",
        choices: [ { text: "Step back outside.", nextScenario: null } ]
    },
    {
        id: 'gym_caught',
        notRandom: true,
        text: "The front desk staff notices you and loudly tells you to leave before they call the cops. Everyone in the lobby stares.",
        effects: { mentalFortitude: -25 },
        choices: [ { text: "Leave humiliated.", nextScenario: null } ]
    },
    {
        id: 'bottle_return',
        notRandom: false,
        category: 'work',
        // The payout depends on hauling the bag to the recycling center, which keeps
        // day hours — also stops this scene from owning the whole work lane at night
        condition: () => state.timeHour >= 7 && state.timeHour <= 19,
        text: "You spot a garbage bag full of crushed aluminum cans sitting near an alley entrance. It's easily worth $10 at the recycling center. But there's a shopping cart parked nearby—someone might have staged it there.",
        effects: { timePassed: 0.1 },
        choices: [
            { text: "Take the bag and run to the recycling center.", customAction: () => {
                if (Math.random() < 0.4) {
                    loadScenario('bottle_fight');
                } else {
                    applyEffects({ cash: 10.00, timePassed: 1 });
                    loadScenario('bottle_success');
                }
            }},
            { text: "Leave it alone. It's not worth the risk.", effects: { mentalFortitude: 5 }, nextScenario: null }
        ]
    },
    {
        id: 'bottle_fight',
        notRandom: true,
        text: "An angry man rounds the corner and yells 'Hey! That's mine!' He tackles you. You manage to escape, but without the cans, and you took a few hits.",
        effects: { health: -25, mentalFortitude: -15, timePassed: 0.5 },
        choices: [ { text: "Run away.", nextScenario: null } ]
    },
    {
        id: 'bottle_success',
        notRandom: true,
        text: "You manage to haul the heavy bag to the center without incident. The attendant hands you a crisp ten-dollar bill.",
        choices: [ { text: "Pocket the cash.", nextScenario: null } ]
    },
    {
        id: 'winter_coat',
        notRandom: false,
        category: 'quest',
        // Day hours (a bin at 3 AM was never real), plus a cooldown after a failed
        // reach-in — you scraped your arm raw; you're not going back at dawn. Without
        // the cooldown this scene re-rolls forever and, in endless mode, eventually
        // owns the whole quest lane.
        condition: () => !state.flags.hasWinterCoat && state.timeHour >= 7 && state.timeHour <= 20 && state.day >= (state.flags.nextCoatTryDay || 0),
        text: "You find a clothing donation bin. The anti-theft chute is jammed open slightly. You might be able to reach your arm in and pull something out.",
        effects: { timePassed: 0.2 },
        choices: [
            { text: "Reach in.", customAction: () => {
                if (Math.random() < 0.3) {
                    state.flags.nextCoatTryDay = state.day + 3;
                    loadScenario('coat_stuck');
                } else {
                    applyEffects({ maxWarmthCapacity: 20, warmth: 20, flags: { hasWinterCoat: true } });
                    loadScenario('coat_success');
                }
            }},
            { text: "Don't risk getting stuck.", nextScenario: null }
        ]
    },
    {
        id: 'coat_stuck',
        notRandom: true,
        text: "Your arm gets wedged in the metal mechanism. You scrape your skin raw tearing your arm free, and come away with nothing.",
        effects: { health: -15, mentalFortitude: -10 },
        choices: [ { text: "Bandage your arm and leave.", nextScenario: null } ]
    },
    {
        id: 'coat_success',
        notRandom: true,
        text: "You manage to pull out a thick, slightly worn winter coat. This is a game-changer. Your ability to retain warmth is permanently increased.",
        choices: [ { text: "Put it on.", nextScenario: null } ]
    },
    {
        id: 'police_move_on',
        notRandom: false,
        category: 'hazard',
        condition: () => state.timeHour >= 21 || state.timeHour <= 5,
        text: "You find a relatively safe, dry spot in a public park to rest your eyes. Just as you drift off, a flashlight shines in your face. 'You can't sleep here. Move along.'",
        effects: { timePassed: 1 },
        choices: [
            { text: "Comply immediately.", effects: { mentalFortitude: -10 }, nextScenario: null },
            { text: "Argue that it's public property.", requires: { mentalFortitude: 60 }, nextScenario: 'police_argue' }
        ]
    },
    {
        id: 'police_argue',
        notRandom: true,
        text: "You stand your ground, citing local ordinances. The officer sighs, turns off the flashlight, and says, 'Fine, but be gone by 6 AM.' You manage to get some actual rest.",
        effects: { health: 10, mentalFortitude: 15, timePassed: 4 },
        choices: [ { text: "Go to sleep.", nextScenario: null } ]
    },
    {
        id: 'soup_kitchen',
        notRandom: false,
        category: 'food',
        weight: 2,
        // Lunch service keeps set hours — one of the few fixed points in the day
        condition: () => state.timeHour >= 10 && state.timeHour <= 13,
        text: "St. Brigid's dining hall serves a hot lunch from eleven to one, every day, no questions asked. The line already stretches along the fence, but it moves — the volunteers have this down to a rhythm.",
        effects: { timePassed: 0.1 },
        choices: [
            { text: "Join the line and wait for a tray.", effects: { warmth: 10, hunger: 60, health: 10, mentalFortitude: 5, timePassed: 1.5 }, nextScenario: 'soup_kitchen_eat' },
            { text: "You can't spare the time today. Keep moving.", nextScenario: null }
        ]
    },
    {
        id: 'soup_kitchen_eat',
        notRandom: true,
        text: "Forty minutes in line, then a tray: stew, bread, an apple, coffee. The hall is loud and warm and nobody asks you for anything. On the way out, a volunteer presses a bagged sandwich into your hands for later.",
        effects: { foodStash: 1, timePassed: 0 },
        choices: [ { text: "Leave with a full stomach.", nextScenario: null } ]
    },
    {
        id: 'food_bank',
        notRandom: false,
        category: 'food',
        weight: 2,
        // The pantry serves each person once every few days — flags.nextFoodBankDay is the cooldown
        condition: () => state.timeHour >= 9 && state.timeHour <= 16 && state.day >= (state.flags.nextFoodBankDay || 0),
        text: "A sandwich board outside a church annex: COMMUNITY FOOD PANTRY — OPEN TODAY. Through the propped door you can see folding tables stacked with bread and canned goods, volunteers packing grocery bags. A woman with a clipboard catches your eye and waves you in — no sermon, no paperwork beyond a first name.",
        effects: { timePassed: 0.1 },
        choices: [
            {
                text: "Sign in and wait your turn.",
                customAction: () => {
                    state.flags.nextFoodBankDay = state.day + 4;
                    applyEffects({ hunger: 25, warmth: 10, mentalFortitude: 10, foodStash: 3, timePassed: 1.5 });
                    loadScenario('food_bank_supplied');
                }
            },
            { text: "Keep moving. Pride, or momentum — you're not sure which.", nextScenario: null }
        ]
    },
    {
        id: 'food_bank_supplied',
        notRandom: true,
        text: () => {
            const base = "They hand you a paper sack: bread, peanut butter, fruit cups, two ready-to-eat meals, and a granola bar you eat right there on the spot. 'Come back in a few days,' the woman says, like it's the most normal thing in the world.";
            if (carryCapacity() <= 1) {
                return base + " But most of it won't fit in the plastic bag holding your life together. You eat what you can on the steps and leave the rest on the give-away table — food you couldn't carry.";
            }
            if (state.foodStash >= carryCapacity()) {
                return base + " Your bag is packed to the seams; whatever didn't fit went back on the table for the next person in line.";
            }
            return base + " Your bag rides heavier on the way out — the good kind of heavy. For once, tomorrow's meals are already solved.";
        },
        choices: [ { text: "Head out with your supplies.", nextScenario: null } ]
    },
    {
        id: 'bakery_closing',
        notRandom: false,
        category: 'food',
        condition: () => state.timeHour >= 17 && state.timeHour <= 21,
        text: "The bakery on the corner is shutting down for the night. A worker carries out a clear bag of unsold rolls and pastries — a whole day's leftovers, still wrapped — and sets it on the bin lid while she locks the back door.",
        effects: { timePassed: 0.1 },
        choices: [
            {
                text: "Ask if you can take some before it goes in the bin.",
                customAction: () => {
                    if (Math.random() < 0.75) {
                        applyEffects({ hunger: 30, mentalFortitude: 8, foodStash: 1, timePassed: 0.3 });
                        loadScenario('bakery_kind');
                    } else {
                        applyEffects({ mentalFortitude: -8, timePassed: 0.3 });
                        loadScenario('bakery_refused');
                    }
                }
            },
            { text: "Wait until she goes inside, then take from the bin.", effects: { hunger: 25, hygiene: -4, mentalFortitude: -4, timePassed: 0.4 }, nextScenario: null },
            { text: "Keep walking.", nextScenario: null }
        ]
    },
    {
        id: 'bakery_kind',
        notRandom: true,
        text: "She glances back at the door, then opens the bag. 'Take whatever you want — it's just going in the trash.' You fill your pockets with rolls, and she wraps two more in a paper bag for you. 'Same time most nights,' she says, and goes back inside.",
        choices: [ { text: "Eat one while it's still warm.", nextScenario: null } ]
    },
    {
        id: 'bakery_refused',
        notRandom: true,
        text: "She winces. 'I can't. Corporate policy — liability, they say. If they catch me handing it out I lose my shift.' She ties the bag shut and carries it back inside, apologizing twice. The rules would rather the food rot in a locked dumpster than reach you.",
        choices: [ { text: "Move on.", nextScenario: null } ]
    },
    {
        id: 'lost_wallet',
        notRandom: false,
        category: 'encounter',
        text: "While walking past a bus stop, you see a leather wallet on the ground. Inside, there is an ID, some credit cards, and a fold of cash — more than you've held in weeks.",
        effects: { timePassed: 0.1 },
        choices: [
            {
                text: "Take the cash and drop the wallet in a mailbox.",
                requires: { mentalFortitude: 25 },
                customAction: () => {
                    const haul = Math.round((40 + Math.random() * 80) * 100) / 100; // $40–$120
                    state.flags.walletCashFound = haul;
                    applyEffects({ cash: haul, mentalFortitude: -30, timePassed: 0.2 });
                    loadScenario('wallet_kept');
                }
            },
            {
                text: "Walk to the address on the ID to return it.",
                customAction: () => {
                    applyEffects({ cash: 20.00, mentalFortitude: 20, warmth: 100, timePassed: 1 });
                    // Set the coffee buff after the walk so all 3 hours apply going forward
                    state.flags.returned_wallet = true;
                    state.flags.coffeeHoursRemaining = 3;
                    loadScenario('wallet_returned');
                }
            }
        ]
    },
    {
        id: 'wallet_kept',
        notRandom: true,
        text: () => `You pocket the $${(state.flags.walletCashFound || 0).toFixed(2)} and drop the wallet in a mailbox. You needed it more than they did, you tell yourself. It doesn't help. The face on the ID stays with you for hours.`,
        choices: [ { text: "Keep walking.", nextScenario: null } ]
    },
    {
        id: 'wallet_returned',
        notRandom: true,
        text: "You knock on the door and hold out the wallet, everything still inside. The owner is stunned, then overwhelmingly grateful — they press a $20 bill into your hand and insist you come in from the cold for a huge mug of fresh coffee. It warms you through. 'I manage the motel on 5th,' they say as you leave. 'You ever need a room, you ask for me.'",
        choices: [ { text: "Thank them and leave.", nextScenario: null } ]
    },
    {
        id: 'street_harassment',
        notRandom: false,
        category: 'hazard',
        text: "A car full of teenagers slows down as it drives past you. One of them throws a half-empty soda cup at you, yelling an insult before speeding off. The sticky liquid gets on your jacket.",
        effects: { mentalFortitude: -10, timePassed: 0.1 },
        choices: [
            { text: "Clean it up in silence.", nextScenario: null },
            { text: "Scream in frustration.", nextScenario: 'scream_frustration' }
        ]
    },
    {
        id: 'scream_frustration',
        notRandom: true,
        text: "You let out a primal yell of anger and unfairness. A passerby looks at you with fear and crosses the street. You feel alienated, but you got the anger out.",
        effects: { mentalFortitude: 10 },
        choices: [ { text: "Wipe off the soda and keep moving.", nextScenario: null } ]
    },
    {
        id: 'job_day_labor',
        notRandom: false,
        category: 'work',
        // Runs to mid-afternoon so bottle_return doesn't spend five hours a day
        // as the entire work lane — a 4-hour haul starting at 4 PM still ends by 8
        condition: () => state.timeHour >= 6 && state.timeHour <= 16,
        text: "A contractor in a pickup truck pulls over. 'Need someone to help haul drywall for 4 hours. $10 an hour.'",
        effects: { timePassed: 0.1 },
        choices: [
            { text: "Take the job.", requires: { health: 50, hunger: 40 }, effects: { cash: 40.00, health: -15, warmth: 20, hunger: -30, timePassed: 4 }, nextScenario: 'job_done' },
            { text: "You're too weak to do heavy lifting right now.", nextScenario: null }
        ]
    },
    {
        id: 'job_done',
        notRandom: true,
        text: "You spend 4 grueling hours carrying heavy sheets of drywall up three flights of stairs. You are exhausted and starving, but you have 40 dollars in your pocket.",
        choices: [ { text: "Rest your aching muscles.", nextScenario: null } ]
    },
    {
        id: 'rainstorm_sudden',
        notRandom: false,
        category: 'hazard',
        text: "The sky suddenly opens up into a torrential downpour. You have seconds to find cover before you are completely soaked.",
        effects: { timePassed: 0.1 },
        choices: [
            { text: "Duck into a bank ATM vestibule.", nextScenario: 'atm_vestibule' },
            { text: "Just keep walking in the rain.", effects: { warmth: -40, mentalFortitude: -15, timePassed: 1 }, nextScenario: null }
        ]
    },
    {
        id: 'atm_vestibule',
        notRandom: true,
        text: "You huddle in the corner of the ATM lobby. A customer comes in, looks uncomfortable, and quickly leaves. You stay dry, but the anxiety of being kicked out wears on you.",
        effects: { warmth: 10, mentalFortitude: -10, timePassed: 1 },
        choices: [ { text: "Leave when the rain stops.", nextScenario: null } ]
    },
    {
        // Forced (lowest priority) the first time a load happens in a new season.
        // Costs no time — it's a page turn, not an event.
        id: 'season_change',
        notRandom: true,
        text: () => ({
            winter: "You wake to a different kind of cold — the kind with a season behind it. Frost on the inside of bus shelters, breath hanging until mid-morning. The street changes in winter: shelter lines form earlier, and everyone sleeping outside starts doing arithmetic about wind and wet. From here on, the cold is the main event.",
            spring: "Something loosens. The gutters run with meltwater and the mornings stop hurting. Spring out here means rain more than cold — long gray days of it — but the nights stop being dangerous, and that changes what a dollar has to cover.",
            summer: "The heat arrives like a wall. By ten the pavement is baking and the city smells of hot tar and garbage. Cold stops being the enemy — now it's the sun, the sweat, the long shadeless blocks. Nights outside are almost easy. The days are what you survive.",
            autumn: "The heat breaks. Mornings come in crisp, and the first genuinely cold night lands like a warning shot. Autumn is the season of getting ready — everyone out here knows what's behind it."
        })[currentSeason()],
        effects: { timePassed: 0 },
        choices: [ { text: "Face the season.", nextScenario: null } ]
    },
    {
        id: 'cold_snap',
        notRandom: false,
        category: 'hazard',
        weight: 2,
        condition: () => currentSeason() === 'winter' && state.timeHour >= 8 && state.timeHour <= 18,
        text: "The wind swings out of the north and the temperature falls off a cliff. Within the hour your fingers stop cooperating and the sidewalk crowd thins to nobody. A church two blocks over runs a warming room on days like this.",
        effects: { warmth: -12, timePassed: 0.3 },
        choices: [
            { text: "Sit out the worst of it in the warming room.", effects: { warmth: 45, mentalFortitude: -4, timePassed: 2.5 }, nextScenario: null },
            { text: "Buy a hot coffee and thaw out standing up ($1.00).", requires: { cash: 1.00 }, effects: { cash: -1.00, warmth: 25, mentalFortitude: 5, timePassed: 0.7 }, nextScenario: null },
            { text: "Keep moving. You can't afford to lose the hours.", effects: { warmth: -10, health: -5, timePassed: 0.5 }, nextScenario: null }
        ]
    },
    {
        id: 'heat_wave',
        notRandom: false,
        category: 'hazard',
        weight: 2,
        condition: () => currentSeason() === 'summer' && state.timeHour >= 10 && state.timeHour <= 18,
        text: "By midday the sun has turned the street into a griddle. There's no shade on this stretch and your shirt is soaked through. Your head has started doing a slow, warning throb — out here, heat puts people in the hospital faster than cold does.",
        effects: { health: -4, hygiene: -6, timePassed: 0.3 },
        choices: [
            { text: "Ride out the worst hours in the library's air conditioning.", effects: { health: 6, mentalFortitude: 6, timePassed: 2.5 }, nextScenario: null },
            { text: "Buy a cold bottle of water and find some shade ($2.00).", requires: { cash: 2.00 }, effects: { cash: -2.00, health: 8, timePassed: 0.5 }, nextScenario: null },
            { text: "Soak your shirt at the park fountain and push on.", effects: { health: 3, hygiene: -6, timePassed: 0.5 }, nextScenario: null }
        ]
    },
    // The Way Out: quest chain to make Goal Mode winnable (mailing address -> birth certificate -> ID -> clean clothes)
    {
        id: 'day_center',
        notRandom: false,
        category: 'quest',
        weight: 3,
        condition: () => state.mode === 'goal' && !state.flags.hasMailingAddress && state.timeHour >= 9 && state.timeHour <= 16,
        text: "You pass the Hopewell Day Center — a squat brick building with a hand-painted sign. Inside there's coffee, a bathroom, and a volunteer at a folding table. She mentions they run a free mail service: you can use the center's address to receive letters, no questions asked.",
        effects: { warmth: 5, timePassed: 0.2 },
        choices: [
            { text: "Sign up for the mail service.", effects: { mentalFortitude: 10, timePassed: 1, flags: { hasMailingAddress: true } }, nextScenario: 'day_center_signed' },
            { text: "Grab a free coffee and keep moving.", effects: { warmth: 10, timePassed: 0.5 }, nextScenario: null }
        ]
    },
    {
        id: 'day_center_signed',
        notRandom: true,
        text: "The volunteer writes your name in a ledger and hands you a card with the center's address on it. 'Check back whenever we're open.' For the first time in months, you have an address. It's a start. Now you need $25 and a library computer to order your birth certificate.",
        choices: [ { text: "Step back outside.", nextScenario: null } ]
    },
    {
        id: 'order_birth_cert',
        notRandom: false,
        category: 'quest',
        weight: 3,
        condition: () => state.mode === 'goal' && state.flags.hasMailingAddress && !state.flags.birthCertOrdered && !state.hasID && state.timeHour >= 9 && state.timeHour <= 19,
        text: "The library is warm and quiet. With the day center's address card in your pocket, you could finally order a replacement birth certificate from the state records office. Expedited processing costs $25 and takes a few days to arrive.",
        effects: { warmth: 5, timePassed: 0.2 },
        choices: [
            {
                text: "Order the birth certificate ($25.00).",
                requires: { cash: 25.00 },
                customAction: () => {
                    state.flags.birthCertOrdered = true;
                    state.flags.birthCertArrivesDay = state.day + 3;
                    applyEffects({ cash: -25.00, mentalFortitude: 15, timePassed: 1 });
                    loadScenario('birth_cert_ordered');
                }
            },
            { text: "You can't spare the money right now. Leave.", nextScenario: null }
        ]
    },
    {
        id: 'birth_cert_ordered',
        notRandom: true,
        text: "You submit the form and write the confirmation number on the back of the day center's card. Estimated delivery: 3 days. For once, the system is working for you instead of against you. Check the day center's mail in a few days.",
        choices: [ { text: "Log off and head out.", nextScenario: null } ]
    },
    {
        id: 'mail_arrives',
        notRandom: false,
        category: 'quest',
        weight: 4,
        condition: () => state.mode === 'goal' && state.flags.birthCertOrdered && !state.flags.hasBirthCert && state.day >= state.flags.birthCertArrivesDay && state.timeHour >= 9 && state.timeHour <= 16,
        text: "You stop by the Hopewell Day Center to check the mail. The volunteer flips through a plastic bin and smiles as she hands you a stiff envelope from the state records office. Your birth certificate. Proof that you exist.",
        effects: { mentalFortitude: 20, timePassed: 0.5, flags: { hasBirthCert: true } },
        choices: [ { text: "Tuck it somewhere safe. Next stop: the DMV.", nextScenario: null } ]
    },
    {
        id: 'dmv_visit',
        notRandom: false,
        category: 'quest',
        weight: 3,
        condition: () => state.mode === 'goal' && state.flags.hasBirthCert && !state.hasID && !state.flags.idOrdered && state.timeHour >= 9 && state.timeHour <= 15,
        text: () => {
            const viaMotel = (state.flags.motelDaysRemaining || 0) > 0;
            return "The DMV. The line snakes out the door and the fluorescent lights hum. You have your birth certificate and " +
                (viaMotel
                    ? "a paid-up motel receipt — a private address, real proof of residency."
                    : "the day center's mailing address.") +
                " A state ID costs $20, and the card comes by mail: " +
                (viaMotel
                    ? "about four days to a street address."
                    : "mail routed through a day center gets flagged for manual review — ten days, if nothing goes wrong.");
        },
        effects: { timePassed: 0.2 },
        choices: [
            {
                text: "Wait in line and pay for the ID ($20.00).",
                requires: { cash: 20.00 },
                customAction: () => {
                    const viaMotel = (state.flags.motelDaysRemaining || 0) > 0;
                    state.flags.idOrdered = true;
                    state.flags.idViaMotel = viaMotel;
                    state.flags.idArrivesDay = state.day + (viaMotel ? 4 : 10);
                    applyEffects({ cash: -20.00, warmth: -10, hunger: -15, mentalFortitude: 10, timePassed: 3 });
                    loadScenario('dmv_ordered');
                }
            },
            { text: "You can't face that line today. Leave.", nextScenario: null }
        ]
    },
    {
        id: 'dmv_ordered',
        notRandom: true,
        text: () => "Three hours in a plastic chair for four minutes at the counter. The clerk checks your paperwork, takes your $20, snaps your photo, and slides you a paper receipt. 'The card comes by mail.' " +
            (state.flags.idViaMotel
                ? "It's addressed to your motel — should be about four days."
                : "It's routed through the Hopewell Day Center's general delivery, and the clerk winces at the address: 'Those take ten days, minimum. Backlog.'") +
            " Until it arrives, the receipt is the only proof you exist.",
        choices: [ { text: "Step outside and start counting the days.", nextScenario: null } ]
    },
    {
        id: 'id_arrives',
        notRandom: false,
        category: 'quest',
        weight: 4,
        condition: () => state.mode === 'goal' && state.flags.idOrdered && !state.hasID && state.day >= (state.flags.idArrivesDay || 0) && state.timeHour >= 9 && state.timeHour <= 16,
        text: () => (state.flags.idViaMotel
                ? "The motel clerk flags you down on your way past the office and holds up a stiff government envelope with your name on it."
                : "You stop by the Hopewell Day Center to check the mail, and the volunteer hands you a stiff government envelope from the DMV.") +
            " Inside: a laminated card, your own face looking back at you. You exist again, officially. Doors that were closed — shelters, clinics, real jobs, housing — just cracked open.",
        effects: { mentalFortitude: 20, timePassed: 0.5, hasID: true },
        choices: [ { text: "Step outside, standing a little taller.", nextScenario: null } ]
    },
    {
        id: 'clothing_closet',
        notRandom: false,
        category: 'quest',
        weight: 3,
        condition: () => state.mode === 'goal' && !state.hasCleanClothes && state.timeHour >= 9 && state.timeHour <= 17,
        text: "A church basement runs a clothing closet today — a line of folding tables stacked with donated clothes. There's a wait, but it's free. Two blocks over, a thrift store sells clean, interview-ready outfits for cash.",
        effects: { timePassed: 0.1 },
        choices: [
            { text: "Wait in line at the clothing closet.", effects: { warmth: -15, hunger: -10, mentalFortitude: 10, hygiene: 20, timePassed: 2, hasCleanClothes: true }, nextScenario: 'clothes_found' },
            { text: "Buy an outfit at the thrift store ($15.00).", requires: { cash: 15.00 }, effects: { cash: -15.00, mentalFortitude: 15, hygiene: 20, timePassed: 1, hasCleanClothes: true }, nextScenario: 'clothes_found' },
            { text: "Not today.", nextScenario: null }
        ]
    },
    {
        id: 'clothes_found',
        notRandom: true,
        text: "Clean jeans, a warm shirt, a jacket without holes. You change in a restroom and catch your reflection in the mirror. You look like someone a landlord might actually rent to.",
        choices: [ { text: "Keep moving.", nextScenario: null } ]
    },
    // Gear upgrades and steady employment
    {
        id: 'shoe_store',
        notRandom: false,
        category: 'quest',
        weight: 2,
        condition: () => !state.flags.hasWorkBoots && state.timeHour >= 9 && state.timeHour <= 18,
        text: () => state.flags.hasNewShoes ?
            "You pass the discount shoe outlet again. Your sneakers are holding up, but the steel-toe work boots in the window would open up construction work at the labor office." :
            "A discount shoe outlet has a clearance rack out front. Your own footwear is one bad step from falling apart. Decent shoes would change your days; the steel-toe work boots in the window would open up construction work.",
        effects: { timePassed: 0.1 },
        choices: [
            {
                text: "Buy a solid pair of used sneakers ($12.00).",
                requires: { cash: 12.00 },
                customAction: () => {
                    state.flags.hasNewShoes = true;
                    state.flags.shoeBroken = false;
                    applyEffects({ cash: -12.00, mentalFortitude: 10, timePassed: 0.5 });
                    loadScenario('shoes_bought');
                }
            },
            {
                text: "Invest in steel-toe work boots ($35.00).",
                requires: { cash: 35.00 },
                customAction: () => {
                    state.flags.hasNewShoes = true;
                    state.flags.hasWorkBoots = true;
                    state.flags.shoeBroken = false;
                    applyEffects({ cash: -35.00, mentalFortitude: 15, timePassed: 0.5 });
                    loadScenario('boots_bought');
                }
            },
            { text: "Your money is needed elsewhere.", nextScenario: null }
        ]
    },
    {
        id: 'shoes_bought',
        notRandom: true,
        text: "You lace up the sneakers and leave your old wrecked pair in the store's trash can. Walking doesn't hurt anymore. It's amazing how much of survival comes down to your feet.",
        choices: [ { text: "Walk on, faster than before.", nextScenario: null } ]
    },
    {
        id: 'boots_bought',
        notRandom: true,
        text: "The boots are heavy, warm, and tough as nails. With these, the dispatcher at the day labor office will let you take the construction tickets — the ones that actually pay.",
        choices: [ { text: "Break them in.", nextScenario: null } ]
    },
    {
        id: 'dumpster_backpack',
        notRandom: true,
        text: "Wedged behind a flattened cardboard box, you spot a faded canvas backpack. One zipper pull is missing, but the straps are solid — a mile better than what you've been hauling your life around in.",
        choices: [
            {
                text: "Take it and transfer your things.",
                customAction: () => {
                    state.flags.backpackBroken = false;
                    state.flags.luggingPlasticBag = false;
                    applyEffects({ mentalFortitude: 10, timePassed: 0.3 });
                    loadScenario();
                }
            }
        ]
    },
    {
        id: 'surplus_store',
        notRandom: false,
        category: 'quest',
        weight: 2,
        condition: () => !state.flags.hasSturdyBackpack && state.timeHour >= 9 && state.timeHour <= 18,
        text: "An army surplus store has bins of used gear on the sidewalk — faded rucksacks, canteens, wool socks. Behind the counter hang the new heavy-duty packs: double-stitched straps, the kind that never let go.",
        effects: { timePassed: 0.1 },
        choices: [
            {
                text: "Buy a used backpack from the bin ($8.00).",
                requires: { cash: 8.00, flag: 'backpackBroken', flagLabel: "(Your current pack is holding together)" },
                customAction: () => {
                    state.flags.backpackBroken = false;
                    state.flags.luggingPlasticBag = false;
                    applyEffects({ cash: -8.00, mentalFortitude: 10, timePassed: 0.5 });
                    loadScenario('backpack_used_bought');
                }
            },
            {
                text: "Buy a new heavy-duty backpack ($30.00).",
                requires: { cash: 30.00 },
                customAction: () => {
                    state.flags.backpackBroken = false;
                    state.flags.hasSturdyBackpack = true;
                    state.flags.luggingPlasticBag = false;
                    applyEffects({ cash: -30.00, mentalFortitude: 15, timePassed: 0.5 });
                    loadScenario('backpack_new_bought');
                }
            },
            { text: "Browse and move on.", nextScenario: null }
        ]
    },
    {
        id: 'backpack_used_bought',
        notRandom: true,
        text: "The used rucksack smells like mothballs, but everything fits and both straps hold. You repack your life in the store's doorway and walk out standing straighter.",
        choices: [ { text: "Move out.", nextScenario: null } ]
    },
    {
        id: 'backpack_new_bought',
        notRandom: true,
        text: "Stiff zippers, padded straps, reinforced seams. It's the first new thing you've owned in a long time, and it will not let you down. Your gear rides comfortably on your back.",
        choices: [ { text: "Shoulder it and go.", nextScenario: null } ]
    },
    {
        id: 'labor_office',
        notRandom: false,
        category: 'work',
        weight: 2,
        condition: () => state.timeHour >= 6 && state.timeHour <= 10 && state.flags.lastLaborDay !== state.day,
        onLoad: () => {
            state.flags.lastLaborDay = state.day;
            // No working phone means no dispatch texts: walk across town just to read the board
            if (!phoneActive()) {
                applyEffects({ timePassed: 2, hunger: -6, warmth: -10 });
            }
        },
        text: () => {
            const base = "The day labor office on 3rd Street opens at dawn. Workers fill the plastic chairs while the dispatcher calls out tickets. General labor pays $10 an hour; the construction site tickets pay $15, but the dispatcher won't hand one over unless you're wearing steel-toe boots.";
            if (phoneActive()) {
                return "Your prepaid phone buzzed at dawn — the dispatcher texted today's ticket list straight to you, so you came directly here with no wasted miles. " + base;
            }
            return `<span style="color: var(--accent-color);">No working phone means no dispatch calls. You spent two cold hours walking across town just to read the job board in person.</span><br><br>` + base;
        },
        effects: { timePassed: 0.2 },
        choices: [
            {
                // The stash decision lives here, in the one place it has real stakes:
                // a lighter day, a cheaper shift, and the sweep schedule as counterparty
                text: "Stash the sleeping bag and heavy gear out of sight first (20 min).",
                hidden: () => !(ownsSleepingBag() && !state.flags.gearStashed),
                customAction: () => {
                    state.flags.gearStashed = true;
                    state.flags.stashDay = state.day;
                    state.flags.stashSpotQuality = state.flags.knowsStashSpot ? 2 : 1;
                    applyEffects({ timePassed: 0.2 });
                    loadScenario('labor_board');
                }
            },
            ...LABOR_TICKETS
        ]
    },
    {
        id: 'labor_board',
        notRandom: true, // the office again, after stashing — same tickets, lighter shoulders
        text: () => (state.flags.knowsStashSpot
            ? "You detour two blocks to the gap behind the loading-dock fence on Merchant — Ray's spot — work the roll in deep, and double back. "
            : "You wedge the roll into the gap behind the lot fence and drag a pallet slat over it. From the sidewalk, nothing shows. ")
            + "Walking back in, your shoulders feel like a stranger's — lighter, quicker. The dispatcher is still working down the ticket list.",
        choices: LABOR_TICKETS
    },
    {
        id: 'labor_done_general',
        notRandom: true,
        text: () => "Four hours of hauling couches and boxes up apartment stairs. Your back aches, but the dispatcher counts two twenties into your palm. Honest money." + walkHomeStoreLine(),
        choices: [
            { text: "Stop by the convenience store on the walk back.", effects: { timePassed: 0.2 }, nextScenario: 'convenience_store' },
            { text: "Pocket the cash and stretch your back.", nextScenario: null }
        ]
    },
    {
        id: 'labor_done_construction',
        notRandom: true,
        text: () => "Six hours on the site — hauling block, clearing debris, staying out of the crane's way. The foreman nods at your boots and says there's usually work for people who show up. $90, cash." + walkHomeStoreLine(),
        choices: [
            { text: "Stop by the convenience store on the walk back.", effects: { timePassed: 0.2 }, nextScenario: 'convenience_store' },
            { text: "Head out, exhausted but flush.", nextScenario: null }
        ]
    },
    // Gear staging: stash the heavy gear by day (a choice at the labor office),
    // gamble on the city's sweep schedule by night
    {
        id: 'retrieve_stash',
        notRandom: true, // forced from loadScenario at dusk while gear is stashed
        onLoad: () => { state.flags.lastRetrievalPromptDay = state.day; },
        text: () => {
            const daysOut = state.day - (state.flags.stashDay || state.day);
            let t = "The light is going, and everything you need for the night is still hidden across town.";
            if (daysOut > 0) t += ` It's been out there ${daysOut === 1 ? 'a day and a night' : daysOut + ' days'} now.`;
            return t + " Whatever this evening becomes, it starts with that walk — or with deciding not to make it.";
        },
        choices: [
            {
                text: "Walk back and pull your gear out.",
                customAction: () => {
                    // Sweep odds: 12% for an obvious spot, 5% for a good one — rare
                    // enough that the night it happens actually lands. Leaving the
                    // gear out overnight (the choice below) adds 8% per full day,
                    // capped at 55%.
                    const daysOut = state.day - (state.flags.stashDay || state.day);
                    const base = (state.flags.stashSpotQuality || 1) >= 2 ? 0.05 : 0.12;
                    const sweepChance = Math.min(0.55, base + 0.08 * daysOut);
                    state.flags.gearStashed = false;
                    if (Math.random() < sweepChance) {
                        state.flags.hasSleepingBag = false;
                        applyEffects({ maxWarmthCapacity: -20, mentalFortitude: -20, timePassed: 0.5 });
                        loadScenario('stash_swept');
                    } else {
                        applyEffects({ mentalFortitude: 6, timePassed: 0.5 });
                        loadScenario('stash_recovered');
                    }
                }
            },
            { text: "Leave it hidden. One more night without it.", effects: { timePassed: 0.1 }, nextScenario: null }
        ]
    },
    {
        id: 'stash_recovered',
        notRandom: true,
        text: "Your bag is where you left it — one corner damp, everything else untouched. You crouch there a second longer than you need to, hand flat on the fabric, just confirming it's real. Then you shoulder the weight, and tonight goes back to being an ordinary problem.",
        choices: [ { text: "Head out with your gear.", nextScenario: null } ]
    },
    {
        id: 'stash_swept',
        notRandom: true,
        text: "The spot is scraped clean — whatever leaned or grew there has been cut back and hauled off, the ground raked bare. A skid loader's tracks run straight through where your bag was. Zip-tied to the fence a few yards down is a laminated sheet: NOTICE OF SCHEDULED CLEANUP — ALL UNATTENDED PROPERTY WILL BE REMOVED AND DISPOSED OF. It's dated three days ago. It was posted facing the road, where the drivers could read it and you couldn't. Your sleeping bag, your spare clothes, the socks you were saving — compacted in a city truck by mid-afternoon, logged somewhere as debris. There's no one to argue with. There's nothing left to argue over.",
        choices: [ { text: "There's nothing to pick up. Walk.", nextScenario: null } ]
    },
    {
        id: 'motel_gear_desk',
        notRandom: true, // forced from loadScenario the morning the prepaid week runs out with gear still inside
        text: "Your week at the motel is up, and your gear was still in the room when housekeeping turned it. The clerk could have walked it straight to the dumpster — instead it's stacked behind the front desk, sleeping bag rolled the wrong way but rolled. 'Figured you'd be back for it,' they say, hauling it up onto the counter. Everything's there.",
        choices: [
            {
                text: "Take your gear and thank them.",
                customAction: () => {
                    state.flags.gearAtMotel = false;
                    state.flags.gearStashed = false;
                    applyEffects({ mentalFortitude: 4, timePassed: 0.4 });
                    loadScenario();
                }
            }
        ]
    },
    {
        id: 'desk_gear_pickup',
        notRandom: true, // forced from loadScenario at dusk while the desk is holding your pack
        onLoad: () => { state.flags.lastRetrievalPromptDay = state.day; },
        text: "The lobby smells like burnt coffee and carpet cleaner. The evening clerk sees you come in and hauls your pack up from behind the counter before you ask — still cinched the way you left it, nothing gone through, nothing gone. A whole day it sat there, and the worst that happened to it was fluorescent light.",
        choices: [
            {
                text: "Shoulder the pack and thank them.",
                customAction: () => {
                    state.flags.gearAtDesk = false;
                    state.flags.gearStashed = false;
                    applyEffects({ mentalFortitude: 2, timePassed: 0.4 });
                    loadScenario();
                }
            },
            {
                text: "Take it — and ask what a room runs, since you're standing here.",
                customAction: () => {
                    state.flags.gearAtDesk = false;
                    state.flags.gearStashed = false;
                    applyEffects({ timePassed: 0.4 });
                    loadScenario('rent_room');
                }
            }
        ]
    },
    {
        id: 'outreach_bedroll',
        notRandom: false,
        category: 'encounter',
        weight: 2,
        // The way back after losing your bedding: free gear, if you can spare the hours
        condition: () => !ownsSleepingBag() && state.timeHour >= 14 && state.timeHour <= 20,
        text: "A church van idles at the corner with its rear doors open: a folding table, a coffee urn, and a wall of donated blankets and surplus sleeping bags. A volunteer works down the line — no clipboard, no questions, one bag per person. The line is long. It moves anyway.",
        effects: { timePassed: 0.1 },
        choices: [
            { text: "Get in line and wait your turn.", effects: { warmth: 10, mentalFortitude: 10, maxWarmthCapacity: 20, timePassed: 2, flags: { hasSleepingBag: true } }, nextScenario: 'bedroll_received' },
            { text: "Two hours is more than you have today. Keep moving.", nextScenario: null }
        ]
    },
    {
        id: 'bedroll_received',
        notRandom: true,
        text: "The volunteer sizes you up and hands over an army-surplus mummy bag, faintly musty, re-stitched along one seam by somebody's patient hands. 'That one's warm,' she says, and moves on to the next person. You strap it under your pack straps. Tonight has an answer again.",
        choices: [ { text: "Carry it out of there.", nextScenario: null } ]
    },
    // Mutual aid: Ray, the grapevine, and the economy that doesn't show up on any ledger
    {
        id: 'ray_first_meeting',
        notRandom: false,
        category: 'encounter',
        weight: 2,
        condition: () => !state.flags.metRay && state.timeHour >= 8 && state.timeHour <= 20,
        text: "A man is parked on a milk crate at the mouth of the alley off 4th — grey stubble, army coat, a cart tarped and bungeed with the precision of someone who has packed it ten thousand times. He isn't flying a sign and he doesn't look up hungry. He just nods, the way people nod out here: an acknowledgment, not an ask. 'They're running sweeps up Merchant this week,' he says, to you or to the street in general. 'In case you keep anything anywhere.'",
        effects: { timePassed: 0.1 },
        choices: [
            {
                text: "Sit down and split a packed meal with him.",
                requires: { stash: 1 },
                customAction: () => {
                    state.flags.metRay = true;
                    state.flags.streetRep = (state.flags.streetRep || 0) + 1;
                    applyEffects({ foodStash: -1, mentalFortitude: 5, timePassed: 1 });
                    loadScenario('ray_met_meal');
                }
            },
            {
                text: "Stop and talk a while. It costs nothing.",
                customAction: () => {
                    state.flags.metRay = true;
                    state.flags.streetRep = (state.flags.streetRep || 0) + 1;
                    applyEffects({ mentalFortitude: 5, timePassed: 1 });
                    loadScenario('ray_met_talk');
                }
            },
            { text: "Nod back and keep moving.", nextScenario: null }
        ]
    },
    {
        id: 'ray_met_meal',
        notRandom: true,
        text: "He halves the sandwich with a pocketknife, exactly, and hands the bigger half back. 'Ray,' he says, like a fact you should file. Twenty-two years out here, most of them within ten blocks of this crate. He eats slowly and asks nothing — not your story, not your plans — and tells you which security guards are human and which corner the wind skips in January. 'You want to know something, ask,' he says when you get up. 'Cheaper than learning it yourself.'",
        choices: [ { text: "Remember the crate on 4th.", nextScenario: null } ]
    },
    {
        id: 'ray_met_talk',
        notRandom: true,
        text: "You lean on the wall and he makes room without being asked. 'Ray,' he says, like a fact you should file. Twenty-two years out here, and he talks the way a mechanic talks about engines — which shelters pad their bed counts, which dumpster gets locked on Tuesdays, where the wind doesn't reach. No sermon in any of it. When you push off the wall he says, 'You want to know something, ask. Cheaper than learning it yourself.'",
        choices: [ { text: "Remember the crate on 4th.", nextScenario: null } ]
    },
    {
        id: 'ray_grapevine',
        notRandom: false,
        category: 'encounter',
        condition: () => state.flags.metRay && (state.flags.streetRep || 0) >= 1 && state.timeHour >= 8 && state.timeHour <= 20,
        // Pick from the tips the player hasn't already got; small talk if he's out of news
        onLoad: () => {
            const tips = [];
            if (state.flags.shelterTipDay !== state.day) tips.push('shelter');
            if (!state.flags.knowsStashSpot) tips.push('stash');
            if (!state.flags.clinicWalkInTip) tips.push('clinic');
            state.flags._rayTip = tips.length ? tips[Math.floor(Math.random() * tips.length)] : 'smalltalk';
        },
        text: () => {
            const lead = "Ray waves you over to the crate with two fingers, which from him is a parade. ";
            switch (state.flags._rayTip) {
                case 'shelter': return lead + "'Save yourself the walk tonight. Downtown shelter's been turning people away by six all week — county cut their overflow beds and didn't tell anybody. Spend the evening somewhere that counts.'";
                case 'stash': return lead + "'That lot fence where the day crews tuck their rolls? Every sweep driver knows it too. There's a gap behind the loading-dock fence on Merchant — can't be seen from the road, and the crews don't get out of the truck there. Four years I've used it. Don't crowd it.'";
                case 'clinic': return lead + "'That clinic on 8th that wants a referral — Thursdays they run a walk-in list. No slip, no questions, they just don't advertise it or the line would eat the block. Tell the desk you're there for the walk-ins.'";
                default: return lead + "No news today. Instead it's twenty minutes on the hawk that's moved into the overpass girders and what it's doing to the pigeon situation, which Ray relates like a war correspondent. It's the first conversation in weeks that asks nothing of you.";
            }
        },
        effects: { timePassed: 0.1 },
        choices: [
            {
                text: "Worth knowing. Thank him.",
                customAction: () => {
                    const tip = state.flags._rayTip;
                    state.flags._rayTip = null;
                    if (tip === 'shelter') {
                        state.flags.shelterTipDay = state.day;
                        // He's usually right. Usually.
                        if (Math.random() < 0.75) state.flags.shelterFullDay = state.day;
                    } else if (tip === 'stash') {
                        state.flags.knowsStashSpot = true;
                    } else if (tip === 'clinic') {
                        state.flags.clinicWalkInTip = true;
                    }
                    applyEffects({ mentalFortitude: 3, timePassed: 0.3 });
                    loadScenario();
                }
            }
        ]
    },
    {
        id: 'ray_buddy',
        notRandom: false,
        category: 'encounter',
        weight: 2,
        condition: () => state.flags.metRay && (state.flags.streetRep || 0) >= 2 && state.flags.sharedWatchDay !== state.day && state.timeHour >= 16 && state.timeHour <= 21,
        text: "Ray's cart is already pointed toward the underpass when he falls in step with you. 'Weather's turning and I don't like the foot traffic lately. Two of us, we do the night in shifts — you sleep four, I sleep four, packs stacked in the middle. Nobody walks up on two.' He says it like a logistics problem he's already solved, which it is.",
        effects: { timePassed: 0.1 },
        choices: [
            {
                text: "Split the night with Ray.",
                customAction: () => {
                    state.flags.sharedWatchDay = state.day;
                    applyEffects({ mentalFortitude: 5, timePassed: 0.3 });
                    loadScenario('ray_watch_set');
                }
            },
            { text: "Not tonight. You'd rather keep your own counsel.", nextScenario: null }
        ]
    },
    {
        id: 'ray_watch_set',
        notRandom: true,
        text: "You spend the tail of the evening setting up the way Ray likes it: cardboard doubled, packs in the middle, feet toward the wind. He draws the first watch without discussing it. 'Wake you at two,' he says, and starts a quiet inventory of his cart like a man settling in at a front desk.",
        choices: [ { text: "See to the rest of the evening.", nextScenario: null } ]
    },
    {
        id: 'ray_reciprocity',
        notRandom: false,
        category: 'encounter',
        condition: () => state.flags.metRay && (state.flags.streetRep || 0) >= 1 && state.day >= (state.flags.nextRayNeedDay || 0) && state.timeHour >= 9 && state.timeHour <= 17,
        onLoad: () => { state.flags.nextRayNeedDay = state.day + 7; },
        text: "Ray isn't on his crate. He's two blocks down, sitting against the laundromat wall with his coat buttoned wrong, and you hear the cough before you cross the street — deep, wet, tearing at something. The cart is with him but the tarp is half-cinched, which from Ray is like a flag at half mast. 'Don't fuss,' he says, and coughs through it.",
        effects: { timePassed: 0.1 },
        choices: [
            {
                text: "Walk to the pharmacy and back for him ($8.00).",
                requires: { cash: 8.00 },
                customAction: () => {
                    state.flags.streetRep = (state.flags.streetRep || 0) + 1;
                    applyEffects({ cash: -8.00, mentalFortitude: 8, timePassed: 2 });
                    loadScenario('ray_helped');
                }
            },
            {
                text: "Give him your packed meal and stay while he eats it.",
                requires: { stash: 1 },
                customAction: () => {
                    state.flags.streetRep = (state.flags.streetRep || 0) + 1;
                    applyEffects({ foodStash: -1, mentalFortitude: 8, timePassed: 1.5 });
                    loadScenario('ray_helped');
                }
            },
            {
                text: "Stay a while. It's all you've got to give.",
                customAction: () => {
                    state.flags.streetRep = (state.flags.streetRep || 0) + 1;
                    applyEffects({ mentalFortitude: 5, timePassed: 2 });
                    loadScenario('ray_helped');
                }
            },
            { text: "You can't stop today.", effects: { mentalFortitude: -8 }, nextScenario: 'ray_walked_past' }
        ]
    },
    {
        id: 'ray_helped',
        notRandom: true,
        text: "Cough syrup, aspirin, water, or just your shoulder against the wall next to his — he takes what you brought without ceremony. 'Square,' he says eventually, which from Ray is a whole paragraph. That's it. That's the transaction. Nothing comes of it, and nothing was supposed to; some things you do because a man sat with you when you were new and the wind was wrong.",
        choices: [ { text: "Leave him resting easier.", nextScenario: null } ]
    },
    {
        id: 'ray_walked_past',
        notRandom: true,
        text: "You keep your eyes forward and your feet moving. He doesn't call after you — that's not his way — and somehow the quiet is worse than being cursed at. The cough follows you longer than the two blocks it should. You had reasons. Everyone who has ever walked past you had reasons too.",
        choices: [ { text: "Keep walking.", nextScenario: null } ]
    },
    {
        id: 'ray_barter',
        notRandom: false,
        category: 'encounter',
        condition: () => state.flags.metRay && state.timeHour >= 8 && state.timeHour <= 20,
        text: "Ray's crate doubles as a storefront if you know how to read it. Today's stock, arranged on the tarp: three bus day passes — a church group mails them to the outreach van and Ray always ends up holding extras — some batteries, and a stack of sandwiches in wax paper from the Friday volunteers. Going rate is a packed meal for a pass, or the other way around if you're holding. He doesn't haggle. The prices predate you.",
        effects: { timePassed: 0.1 },
        choices: [
            {
                text: "Trade a packed meal for a bus day pass.",
                requires: { stash: 1 },
                customAction: () => {
                    state.flags.transitPasses = (state.flags.transitPasses || 0) + 1;
                    applyEffects({ foodStash: -1, timePassed: 0.3 });
                    loadScenario('ray_barter_done');
                }
            },
            {
                text: "Trade a day pass for one of the wax-paper sandwiches.",
                requires: { flag: 'transitPasses', flagLabel: '(No pass to trade)', stashSpace: true },
                customAction: () => {
                    state.flags.transitPasses--;
                    applyEffects({ foodStash: 1, timePassed: 0.3 });
                    loadScenario('ray_barter_done');
                }
            },
            { text: "Nothing to trade today. Talk pigeons instead.", effects: { mentalFortitude: 3, timePassed: 0.3 }, nextScenario: null }
        ]
    },
    {
        id: 'ray_barter_done',
        notRandom: true,
        text: "The swap takes thirty seconds and neither of you counts anything twice. No receipt, no thanks beyond a nod — the whole arrangement runs on the fact that you'll both still be here tomorrow, and that out here a reputation for fair dealing is worth more than the goods.",
        choices: [ { text: "Pocket your end of the deal.", nextScenario: null } ]
    },
    {
        id: 'shelter_full',
        notRandom: true,
        text: "The line outside the downtown shelter isn't moving, and at the door a staffer repeats it to each new face: full. Full since six. County cut the overflow beds, try again tomorrow. Ray called it to the hour. The walk over cost you the warm part of the evening, and the night still has to be solved from scratch.",
        effects: { warmth: -10, mentalFortitude: -8, timePassed: 1 },
        choices: [ { text: "Figure out where else the night can go.", customAction: () => loadScenario('find_shelter') } ]
    },
    {
        id: 'clinic_walkin',
        notRandom: true,
        text: "The receptionist looks at you a beat too long, then pulls a clipboard from under the counter without a word — a handwritten list, half the names already crossed off. An hour later a doctor is listening to your chest, dressing the blisters on your feet, and pressing a sample-cabinet course of antibiotics into your hand. Nobody ever asks for a referral. The whole side door of the system, and it runs on somebody telling somebody.",
        effects: { health: 40, mentalFortitude: 15, timePassed: 2 },
        choices: [ { text: "Leave better than you arrived.", nextScenario: null } ]
    },
    // Shannon: the median person out here. She has a job, a car she lives in, and
    // boundaries. She gives no tips, runs no economy, and teaches nothing — most
    // people aren't a lesson, and the game should have at least one of them.
    {
        id: 'shannon_first_meeting',
        notRandom: false,
        category: 'encounter',
        weight: 2,
        condition: () => !state.flags.metShannon && state.timeHour >= 9 && state.timeHour <= 18,
        text: "The laundromat on Delancey runs warm and nobody clocks how long you sit. Two machines down, a woman in a grocery-store polo is folding a work uniform to creases you could pass inspection with. Through the glass, a twenty-year-old Corolla is parked where she can watch it, packed the way a car gets packed when it's doing the work of a closet. She catches you noticing the car and doesn't look away or explain. 'Shannon,' she says — the tone of someone closing a topic, not opening one.",
        effects: { timePassed: 0.1 },
        choices: [
            {
                text: "Talk a while, over the noise of the machines.",
                customAction: () => {
                    state.flags.metShannon = true;
                    state.flags.lastShannonDay = state.day;
                    state.flags.streetRep = (state.flags.streetRep || 0) + 1;
                    applyEffects({ mentalFortitude: 4, timePassed: 0.8 });
                    loadScenario('shannon_met');
                }
            },
            { text: "Nod and keep to the warm end of the bench.", nextScenario: null }
        ]
    },
    {
        id: 'shannon_met',
        notRandom: true,
        text: "Four a.m. stocking shift at the Foodway on Route 9, six years in, the last two of them from the Corolla. She doesn't say how that happened, and she visibly files your not-asking as a point in your favor. The talk stays small on purpose: the dryer that shorts everyone five minutes, her sister's kid, a manager she has outlasted twice. Nothing about your situation, nothing about hers. When her buzzer goes she stands, squares the folded uniform like it's load-bearing, and says, 'Some of us are around.' From her, that's the whole welcome mat.",
        choices: [ { text: "Let her get to her folding.", nextScenario: null } ]
    },
    {
        id: 'shannon_around',
        notRandom: false,
        category: 'encounter',
        condition: () => state.flags.metShannon && state.flags.lastShannonDay !== state.day && state.timeHour >= 8 && state.timeHour <= 20,
        // People have days. Roll hers — sometimes company, sometimes headphones,
        // sometimes she's simply elsewhere, living the parts of her life that
        // don't happen on this block.
        onLoad: () => {
            state.flags.lastShannonDay = state.day;
            const roll = Math.random();
            state.flags._shannonMood = roll < 0.55 ? 'talk' : roll < 0.85 ? 'quiet' : 'absent';
        },
        text: () => {
            switch (state.flags._shannonMood) {
                case 'talk': return "Shannon's on the retaining wall outside the Foodway with a break-room coffee, off shift and for once in no hurry. She slides over to make room without making it a thing. Conversation the way she runs it: the show she's watching one episode a week on the library computers, the new cart-corral policy, her sister's kid's science fair volcano. Nothing about your situation or hers. Twenty minutes of being two people on a wall.";
                case 'quiet': return "Shannon's at the laundromat with her headphones in, working through a paperback with a pencil behind her ear. She gives you the two-finger wave that means she sees you and that today that's the whole transaction. Fair enough. People are allowed to be at capacity.";
                default: return "Her usual machines are running but it's a stranger's wash inside them. The counter kid shrugs: schedule change, or her sister came through, or nothing at all. People have lives, and the parts of Shannon's that don't happen on this block aren't yours to audit. The dryers tumble on.";
            }
        },
        effects: { timePassed: 0.1 },
        choices: [
            { text: "Stay through the coffee.", hidden: () => state.flags._shannonMood !== 'talk', effects: { mentalFortitude: 4, timePassed: 0.7 }, nextScenario: null },
            { text: "Wave and keep moving.", hidden: () => state.flags._shannonMood !== 'talk', effects: { timePassed: 0.1 }, nextScenario: null },
            { text: "Leave her to her book.", hidden: () => state.flags._shannonMood !== 'quiet', effects: { timePassed: 0.1 }, nextScenario: null },
            { text: "Move along.", hidden: () => state.flags._shannonMood !== 'absent', effects: { timePassed: 0.1 }, nextScenario: null }
        ]
    },
    {
        id: 'shannon_fifty_cents',
        notRandom: false,
        category: 'encounter',
        condition: () => state.flags.metShannon && state.flags.lastShannonDay !== state.day && state.timeHour >= 9 && state.timeHour <= 18,
        // The favor runs both directions and nobody keeps books — that's the
        // entire thesis, priced at fifty cents and a cup of detergent
        onLoad: () => {
            state.flags.lastShannonDay = state.day;
            state.flags._shannonTurn = Math.random() < 0.5 ? 'hers' : 'yours';
        },
        text: () => state.flags._shannonTurn === 'hers'
            ? "Mid-cycle, Shannon's dryer dies wanting two more quarters, and she's turning over a palmful of nickels and pocket lint with her jaw set. Wet work uniform, four a.m. shift, no dryer. It's fifty cents. It's also none of your business."
            : "Shannon flags you down at the laundromat door and hands you a paper cup half full of detergent, already turning back to her folding. 'Bought the big box,' she says, which is the entire ceremony. The machines are warm, the afternoon is yours to spend, and clean is one of the few things in this city with a working price.",
        effects: { timePassed: 0.1 },
        choices: [
            {
                text: "Feed her machine two quarters.",
                hidden: () => state.flags._shannonTurn !== 'hers',
                requires: { cash: 0.50 },
                customAction: () => {
                    state.flags.streetRep = (state.flags.streetRep || 0) + 1;
                    applyEffects({ cash: -0.50, mentalFortitude: 2, timePassed: 0.1 });
                    loadScenario('shannon_covered');
                }
            },
            {
                text: "Fifty cents is fifty cents today. Stay out of it.",
                hidden: () => state.flags._shannonTurn !== 'hers',
                effects: { timePassed: 0.1 },
                nextScenario: 'shannon_not_yours'
            },
            {
                text: "Run your spare layers through a wash while the heat's free.",
                hidden: () => state.flags._shannonTurn !== 'yours',
                effects: { hygiene: 6, warmth: 8, mentalFortitude: 2, timePassed: 1.2 },
                nextScenario: 'shannon_laundry_done'
            },
            {
                text: "Can't spare the hour. Thank her and pocket nothing.",
                hidden: () => state.flags._shannonTurn !== 'yours',
                effects: { timePassed: 0.1 },
                nextScenario: null
            }
        ]
    },
    {
        id: 'shannon_covered',
        notRandom: true,
        text: "She says thanks the way you'd thank a stranger for holding a door — proportionate, and finished. The drum turns. The uniform dries. Fifty cents' worth of the world staying ordinary, and nobody writes anything down.",
        choices: [ { text: "Go about your day.", nextScenario: null } ]
    },
    {
        id: 'shannon_not_yours',
        notRandom: true,
        text: "The kid at the counter breaks a dollar for her before it becomes a moment. The dryer turns. Not everything is yours to fix, and nothing happened here that needs forgiving.",
        choices: [ { text: "Go about your day.", nextScenario: null } ]
    },
    {
        id: 'shannon_laundry_done',
        notRandom: true,
        text: "An hour of heat and tumble, Shannon's detergent doing its work two machines down from Shannon's headphones. Your spare layers come out warm enough to hold against your chest, smelling like a house you used to live in. She's gone before you finish folding — shift, car, life. No goodbye required. You'll both still be here.",
        choices: [ { text: "Pack the warm clothes away.", nextScenario: null } ]
    },
    // Paul: what the street does to a person when the network never catches him.
    // Desperate, not predatory — his scams are small, readable in hindsight, and
    // only ever cost cash and time. The game never hands him your papers.
    {
        id: 'paul_first_meeting',
        notRandom: false,
        category: 'encounter',
        weight: 2,
        condition: () => !state.flags.metPaul && state.timeHour >= 8 && state.timeHour <= 19,
        onLoad: () => { state.flags.lastPaulDay = state.day; },
        text: "The man at the transit center doors is maybe thirty-five and moves like sixty, and he's on you before the doors finish closing: sister in Millbrook, job lined up, bus leaves at four, ten dollars short. The story arrives worn smooth, every corner rounded from handling. Under it, something true — the sweat on him has nothing to do with the weather, and his eyes do the arithmetic on your pockets while his mouth does the sister. 'Paul,' he says, hand out, like the name is collateral.",
        effects: { flags: { metPaul: true }, timePassed: 0.1 },
        choices: [
            { text: "Give him the ten.", requires: { cash: 10.00 }, effects: { cash: -10.00, timePassed: 0.1 }, nextScenario: 'paul_took_ten' },
            { text: "Offer a packed meal instead of cash.", requires: { stash: 1 }, effects: { foodStash: -1, mentalFortitude: 2, timePassed: 0.3 }, nextScenario: 'paul_took_meal' },
            { text: "Ten you don't have to spare. Keep walking.", effects: { timePassed: 0.1 }, nextScenario: 'paul_refused' }
        ]
    },
    {
        id: 'paul_took_ten',
        notRandom: true,
        text: "He thanks you three times, which is two more than the transaction needed, and the thanks is the realest thing he's said. He heads inside toward the ticket window and you watch him drift past it, easy as water finding a drain, out the far doors toward Frontage Road. There's no bus at four. There maybe isn't a sister. There was definitely a need, and it was exactly ten dollars shaped, and now it's somewhere on Frontage Road with the rest of him.",
        choices: [ { text: "It's gone. Let it be gone.", nextScenario: null } ]
    },
    {
        id: 'paul_took_meal',
        notRandom: true,
        text: "A beat, while he re-runs the script for a scene it doesn't cover. Then he takes the sandwich, eats half of it right there — fast, mechanical, a man refueling rather than dining — and wraps the other half with a care that tells you food wasn't the ten dollars. 'Bus at four,' he says again, quieter, both of you letting it stand. He wishes you luck like he means it. That part isn't in the script either.",
        choices: [ { text: "Head on your way.", nextScenario: null } ]
    },
    {
        id: 'paul_refused',
        notRandom: true,
        text: "'Worth a try,' he says, no heat in it at all, and he's already scanning past your shoulder for the next face coming through the doors. Being told no is a bigger part of his day than being told yes, and he's made a kind of peace with the ratio. You're forgotten before you're out of earshot, which is its own strange mercy.",
        choices: [ { text: "Keep moving.", nextScenario: null } ]
    },
    {
        id: 'paul_borrow',
        notRandom: false,
        category: 'encounter',
        condition: () => state.flags.metPaul && !state.flags.paulBorrowDone && state.flags.lastPaulDay !== state.day && state.timeHour >= 9 && state.timeHour <= 18,
        onLoad: () => { state.flags.lastPaulDay = state.day; },
        text: "Paul falls into step beside you like the sidewalk assigned him there. Today's version is closer to the bone than the sister story: he owes a guy, the guy's patience has a schedule, and twenty dollars now beats what Friday costs without it. 'Friday,' he says. 'I'm good for it Friday.' He believes it, which is the hard part. Somewhere in him there is a Friday where everything comes back — the twenty, the years, the guy he was. He's borrowing against that Friday all over the neighborhood.",
        effects: { flags: { paulBorrowDone: true }, timePassed: 0.2 },
        choices: [
            {
                text: "Hand him the twenty.",
                requires: { cash: 20.00 },
                customAction: () => {
                    state.flags.paulOwesYou = true;
                    state.flags.paulBorrowDay = state.day;
                    applyEffects({ cash: -20.00, timePassed: 0.1 });
                    loadScenario('paul_lent');
                }
            },
            { text: "Not this time. You need your money to stay yours.", effects: { timePassed: 0.1 }, nextScenario: 'paul_refused' }
        ]
    },
    {
        id: 'paul_lent',
        notRandom: true,
        text: "The bills disappear the way rain disappears into dry ground. He repeats 'Friday' twice, shakes your hand with both of his, and walks off lighter than you've ever seen him. You watch him go and do your own arithmetic — the honest kind, the kind that files the twenty under weather rather than debts. Some money you lend. Some money you release.",
        choices: [ { text: "Get on with your day.", nextScenario: null } ]
    },
    {
        id: 'paul_no_friday',
        notRandom: false,
        category: 'encounter',
        condition: () => state.flags.metPaul && state.flags.paulOwesYou && state.day >= (state.flags.paulBorrowDay || 0) + 3 && state.timeHour >= 8 && state.timeHour <= 19,
        onLoad: () => { state.flags.lastPaulDay = state.day; },
        text: "Paul sees you from half a block out, and you watch the twenty dollars arrive in his face before you've said a word. He doesn't cross the street — give him that — but everything in him wants to. He's rehearsing something as you close the distance, and what he lands on is: 'Next week. I know. Next week for sure.' Friday came and went and neither of you mentions which Friday it was.",
        effects: { timePassed: 0.1 },
        choices: [
            {
                text: "Tell him it's fine. It stopped being a debt a while ago.",
                customAction: () => {
                    state.flags.paulOwesYou = false;
                    applyEffects({ mentalFortitude: 3, timePassed: 0.2 });
                    loadScenario('paul_debt_released');
                }
            },
            {
                text: "Hold him to it. 'Friday, Paul.'",
                customAction: () => {
                    state.flags.paulOwesYou = false;
                    applyEffects({ timePassed: 0.2 });
                    loadScenario('paul_friday_promise');
                }
            }
        ]
    },
    {
        id: 'paul_debt_released',
        notRandom: true,
        text: "Something in his shoulders comes down an inch. He nods too many times, says you're all right — the highest honor he has to confer — and changes the subject to a rumor about the overflow shelter reopening, eager as a man stepping off a ledge onto floor. The twenty is gone, but it stopped costing you anything the moment you reclassified it. He'll owe somebody forever. It doesn't have to be you.",
        choices: [ { text: "Talk shelters a minute, then move on.", nextScenario: null } ]
    },
    {
        id: 'paul_friday_promise',
        notRandom: true,
        text: "'Friday,' he agrees, solemn as a courtroom, and you both stand there inside the word for a second. You'll see him again. There will be no twenty. Holding the marker doesn't make you wrong — it was your money and your Friday too — it just makes you one more line in a ledger he stopped being able to read years ago.",
        choices: [ { text: "Leave it there.", nextScenario: null } ]
    },
    {
        id: 'paul_spot',
        notRandom: false,
        category: 'encounter',
        condition: () => state.flags.metPaul && !state.flags.paulSpotDone && state.flags.lastPaulDay !== state.day && state.timeHour >= 9 && state.timeHour <= 15,
        onLoad: () => { state.flags.lastPaulDay = state.day; },
        text: "The line outside the housing outreach office is forty deep when Paul finds you in it — or finds the line, and you happen to be the face he knows. He's holding a spot near the front, he says, and he's got to go see a guy, ten minutes, and can you stand in it for him because if he loses the spot he loses the intake slot and if he loses the slot — he's already backing away as he says it, and the direction he's backing is Frontage Road, which has never once in its existence been ten minutes from anything.",
        effects: { flags: { paulSpotDone: true }, timePassed: 0.1 },
        choices: [
            { text: "Hold the spot. Ten minutes is ten minutes.", effects: { mentalFortitude: -6, timePassed: 1.75 }, nextScenario: 'paul_spot_burned' },
            { text: "You can't carry his place and your day both. Decline.", effects: { timePassed: 0.1 }, nextScenario: 'paul_spot_declined' }
        ]
    },
    {
        id: 'paul_spot_burned',
        notRandom: true,
        text: "Ten minutes becomes an hour becomes the intake worker flipping the sign at the door. Paul never comes back. You stood a stranger's ground in a line that couldn't help you, holding a slot for a man who was never coming to fill it, and the afternoon went wherever his ten dollars went. The sting isn't the time, exactly. It's that he knew you'd stand there — that being decent made you the right person to spend.",
        choices: [ { text: "Walk it off.", nextScenario: null } ]
    },
    {
        id: 'paul_spot_declined',
        notRandom: true,
        text: "He takes the no like he took the last one — no heat, already pivoting, asking the woman behind you before you've finished saying it. She says no too. Everybody in this line has exactly one spot's worth of standing in them and nothing to spare, which Paul knows better than anyone. It's why he asks here.",
        choices: [ { text: "Keep your own place in the day.", nextScenario: null } ]
    },
    {
        id: 'paul_withdrawal',
        notRandom: false,
        category: 'encounter',
        condition: () => state.flags.metPaul && state.day >= (state.flags.nextPaulSickDay || 0) && state.timeHour >= 8 && state.timeHour <= 18,
        onLoad: () => { state.flags.nextPaulSickDay = state.day + 6; state.flags.lastPaulDay = state.day; },
        text: "Paul is on the ground behind the transit center, back against the brick, jacket zipped to the chin on a day that doesn't call for it. He's sick the way that keeps a schedule — shaking, gray, sweat standing on his face, arms wrapped around himself like he's holding something in. No script today. No sister, no Friday, no guy. He looks up at you and doesn't ask for anything, which from Paul is the most alarming thing he could possibly do.",
        effects: { timePassed: 0.1 },
        choices: [
            {
                text: "Get electrolytes and crackers from the corner store ($4.00).",
                requires: { cash: 4.00 },
                customAction: () => {
                    state.flags.streetRep = (state.flags.streetRep || 0) + 1;
                    applyEffects({ cash: -4.00, mentalFortitude: 6, timePassed: 1 });
                    loadScenario('paul_sick_stayed');
                }
            },
            {
                text: "Sit with him a while. Nobody should ride this out alone.",
                customAction: () => {
                    state.flags.streetRep = (state.flags.streetRep || 0) + 1;
                    applyEffects({ mentalFortitude: 4, timePassed: 1.5 });
                    loadScenario('paul_sick_stayed');
                }
            },
            {
                text: "Call the outreach line on your phone.",
                hidden: () => !phoneActive(),
                customAction: () => {
                    state.flags.streetRep = (state.flags.streetRep || 0) + 1;
                    applyEffects({ mentalFortitude: 5, timePassed: 0.75 });
                    loadScenario('paul_sick_van');
                }
            },
            { text: "You can't be what he needs. Walk on.", effects: { mentalFortitude: -5 }, nextScenario: 'paul_walked_on' }
        ]
    },
    {
        id: 'paul_sick_stayed',
        notRandom: true,
        text: "He gets the drink down in sips, loses the first one, keeps the second. Mostly what you do is be a body next to his body so the people walking past see two people instead of a problem. 'It's not even the being sick,' he says at one point, teeth going. 'It's that it knows exactly when.' That's as close as Paul gets to explaining himself, and closer than anyone's asked him to get in years. Nothing is fixed when you leave. He's still there. But he rode an hour of it with company, and the hour was going to happen either way.",
        choices: [ { text: "Leave him the rest of the crackers.", nextScenario: null } ]
    },
    {
        id: 'paul_sick_van',
        notRandom: true,
        text: "The outreach van takes forty minutes, which for the outreach van is a sprint. Two workers who clearly know Paul by name get him up gently — 'Hey, brother, bad one today?' — and into a seat, and one of them nods at you before they pull out: whoever called, good call. There's a cot and fluids and somebody with a clipboard at the other end of that ride. He'll be back on this block by Thursday. That's not the system failing. That's just the shape of the ride — and today, for once, somebody's phone was the net.",
        choices: [ { text: "Watch the van go.", nextScenario: null } ]
    },
    {
        id: 'paul_walked_on',
        notRandom: true,
        text: "You walk on. There are days you could have sat, and this isn't one, or maybe it is and you'll never know now. Half a block later you're rehearsing the reasons the way Paul rehearses his stories, smoothing the corners so they'll carry. That's the thing nobody tells you about walking past someone: you don't stop doing it when the block ends.",
        choices: [ { text: "Keep going.", nextScenario: null } ]
    },
    {
        id: 'paul_good_day',
        notRandom: false,
        category: 'encounter',
        condition: () => state.flags.metPaul && state.flags.lastPaulDay !== state.day && state.timeHour >= 9 && state.timeHour <= 19,
        onLoad: () => { state.flags.lastPaulDay = state.day; },
        text: "Paul, upright, fed, and steady, is a different animal entirely. He's at the transit center wall doing commentary on the parking enforcement officer working the block — quiet, deadpan, merciless — 'He's going for the Civic. He wants the Civic. Twenty years chasing the Civic that got away' — and when you post up next to him he hands you the next line like you've been doing this act for years. For half an hour he's quick and funny and nobody's mark and nobody's cautionary tale. Somewhere in the middle of it he asks, casual as weather, whether you've seen Ray around — says it like a man checking that something is still where he left it.",
        effects: { timePassed: 0.1 },
        choices: [
            { text: "Stay for the show.", effects: { mentalFortitude: 4, timePassed: 0.5 }, nextScenario: null },
            { text: "Trade a line and keep moving.", effects: { mentalFortitude: 2, timePassed: 0.1 }, nextScenario: null }
        ]
    },
    // Placeholder transition scenarios
    {
        id: "caseworker_confrontation",
        notRandom: true,
        text: "You raise your voice and demand a supervisor. The supervisor comes out, repeats the same policy, and warns that security will be called if you don't lower your voice. Defeated, you leave.",
        effects: { mentalFortitude: -10, timePassed: 0.5 },
        choices: [ { text: "Step outside.", nextScenario: null } ]
    },
    {
        id: "library_research",
        notRandom: true,
        text: "You use a public computer for 30 minutes. You learn that a replacement ID requires a birth certificate, which costs $25 to order with expedited processing. You also need a mailing address. It feels impossible — until you spot a flyer taped to the monitor: the Hopewell Day Center offers a free mail service for people without an address.",
        effects: { mentalFortitude: -10, timePassed: 1 },
        choices: [ { text: "Log off. Maybe there's a way after all.", nextScenario: null } ]
    },
    {
        id: "library_stay_quiet",
        notRandom: true,
        text: "You stare at the book. The guard eventually drifts back to his post, but you spend the next hour on edge, never quite able to relax. Still — you're dry, you're warm, and nobody has told you to leave yet.",
        effects: { timePassed: 1, warmth: 10, mentalFortitude: -3 },
        choices: [ { text: "Eventually leave the library.", nextScenario: null } ]
    },
    {
        id: "library_dry_out",
        notRandom: true,
        text: "You find a carrel in the back corner, drape your wet jacket over the chair, and eat with your head down — one slow bite at a time, so no one notices. By the time the rain lets up, your clothes are half-dry and your stomach has stopped growling. The library asked nothing of you. One of the last places that doesn't.",
        choices: [ { text: "Pack up and head back out.", nextScenario: null } ]
    },
    {
        id: "back_in_rain",
        notRandom: true,
        text: "You step back into the freezing rain. The brief respite in the library only makes the cold feel sharper.",
        effects: { timePassed: 0.2 },
        choices: [ { text: "Look for better shelter.", nextScenario: null } ]
    },
    {
        id: "street_lightweight",
        notRandom: true,
        text: "You leave the sleeping bag behind. Your load is lighter, but you know tonight is going to be brutally cold without it.",
        effects: { timePassed: 0.2 },
        choices: [ { text: "Keep walking.", nextScenario: null } ]
    },
    {
        id: "street_with_plastic_bag",
        notRandom: true,
        text: "You awkwardly carry your belongings in a flimsy grocery bag. It swings and hits your leg with every step, slowing you down significantly.",
        effects: { timePassed: 0.2 },
        choices: [ { text: "Trudge on.", nextScenario: null } ]
    },
    {
        id: "street_hungry",
        notRandom: true,
        text: "You walk past the trash can. Your pride is intact, but the hunger pangs are dizzying. You need to find real food soon.",
        effects: { timePassed: 0.2 },
        choices: [ { text: "Keep looking for food.", nextScenario: null } ]
    }
];

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
    } else {
        loadScenario();
    }
}

// Category-weighted selection: roll a lane first, then a scenario within it.
// A flat pool lets every new scenario dilute every old one — write three street
// characters and suddenly the drywall truck never comes. Bucketing means new
// encounters only compete with other encounters, and "work shows up about a
// quarter of the time" stays true no matter how much content gets added.
const CATEGORY_WEIGHTS = { work: 25, food: 20, encounter: 20, quest: 20, hazard: 15 };

function pickRandomScenario() {
    const buckets = {};
    scenarios.forEach(s => {
        if (s.notRandom) return;
        if (s.condition && !s.condition()) return;
        const cat = s.category || 'encounter';
        (buckets[cat] = buckets[cat] || []).push(s);
    });

    // Empty buckets (quest chain finished, work closed for the night) never
    // reach the roll — the weights renormalize over whoever's home
    const cats = Object.keys(buckets);
    if (cats.length === 0) return null;

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

    // The labor office is a guaranteed morning stop for everyone, once per day —
    // boots don't gate the stop, they gate which tickets you're allowed to take.
    // The stash decision lives inside it as a choice, so one stop carries both.
    if (!id && state.timeHour >= 6 && state.timeHour <= 10 && state.flags.lastLaborDay !== state.day) {
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
                if (choice.requires.mentalFortitude !== undefined && state.mental < choice.requires.mentalFortitude) { reqMet = false; reqMsg = `(Requires ${choice.requires.mentalFortitude}% Mental Fortitude)`; }
                if (choice.requires.health !== undefined && state.health < choice.requires.health) { reqMet = false; reqMsg = `(Requires ${choice.requires.health}% Health)`; }
                if (choice.requires.hunger !== undefined && state.hunger < choice.requires.hunger) { reqMet = false; reqMsg = `(Requires ${choice.requires.hunger}% Hunger)`; }
                if (choice.requires.flag !== undefined && !state.flags[choice.requires.flag]) { reqMet = false; reqMsg = choice.requires.flagLabel || '(Unavailable)'; }
                if (choice.requires.notFlag !== undefined && state.flags[choice.requires.notFlag]) { reqMet = false; reqMsg = choice.requires.notFlagLabel || '(Unavailable)'; }
                if (choice.requires.stash !== undefined && state.foodStash < choice.requires.stash) { reqMet = false; reqMsg = '(Nothing packed to eat)'; }
                if (choice.requires.stashSpace && state.foodStash >= carryCapacity()) { reqMet = false; reqMsg = '(No room in your bag)'; }
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

function formatTime(hour) {
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = Math.floor(hour % 12) || 12; // handle decimals from modifiers
    // format minutes if fractional hour
    let mins = Math.floor((hour % 1) * 60);
    let minStr = mins < 10 ? `0${mins}` : `${mins}`;
    if (minStr === "00") minStr = "00";
    return `${displayHour}:${minStr} ${ampm} (Day ${state.day})`;
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
    let pack = 'Worn backpack';
    if (state.flags.hasSturdyBackpack) pack = 'Heavy-duty pack';
    else if (state.flags.backpackBroken) pack = 'Plastic grocery bag';
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

    const passes = state.flags.transitPasses || 0;
    if (passes > 0) items.push(`Bus day pass${passes === 1 ? '' : `es (×${passes})`}`);

    if (state.flags.hasWorkBoots) items.push('Steel-toe work boots');
    else if (state.flags.hasNewShoes) items.push('Decent sneakers');
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

    list.innerHTML = items.map(i => `<li>${i}</li>`).join('');
}

function renderStats() {
    updateElement('stat-health', `${Math.floor(state.health)}%`, state.health <= 30);
    updateElement('stat-mental', `${Math.floor(state.mental)}%`, state.mental <= 30);
    updateElement('stat-warmth', `${Math.floor(state.warmth)}%`, state.warmth <= 30);
    updateElement('stat-hunger', state.hunger <= 0 ? 'Starving' : `${Math.floor(state.hunger)}%`, state.hunger <= 30);
    updateElement('stat-hygiene', `${Math.floor(state.hygiene)}%`, state.hygiene <= 30);
    
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
        document.getElementById('check-cash').textContent = state.cash >= 1200 ? '[x]' : '[ ]';
        document.getElementById('check-id').textContent = state.hasID ? '[x]' : '[ ]';
        document.getElementById('check-clothes').textContent = state.hasCleanClothes ? '[x]' : '[ ]';
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
