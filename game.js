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
        returned_wallet: false
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
        const w = opts.warmth !== undefined ? opts.warmth : (q.warmth || 0);
        state.warmth = Math.min(state.maxWarmthCapacity, state.warmth + w);
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

    applySleep('rough', { warmth: s.warmth });

    let msg;
    if (Math.random() < s.risk) {
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
    applySleep('shelter');

    let referralMsg = "";
    if (!state.flags.hasShelterReferral) {
        state.flags.hasShelterReferral = true;
        referralMsg = " On your way out, the intake worker stamps a slip of paper and presses it into your hand: a referral to the free health clinic. 'Hold onto that. They won't see you without it.'";
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

    applySleep(tier);

    renderStats();
    if (checkGameStatus() !== "CONTINUE") return;

    const msg = (prepaid && room.prepaidMsg) ? room.prepaidMsg : room.msg;
    document.getElementById('narrative-text').innerHTML = `<p>${msg}</p>`;

    const choicesContainer = document.getElementById('choices-list');
    choicesContainer.innerHTML = `
        <button class="choice-btn" onclick="loadScenario()">${prepaid ? 'Lock the door behind you and head out' : 'Check out and step outside'}</button>
    `;
}

const scenarios = [
    // Original Scenarios Converted
    {
        id: 'find_meal',
        notRandom: false,
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
        condition: () => state.timeHour >= 17 || state.timeHour <= 5,
        text: "The light is fading and the temperature is dropping fast. You need to figure out where you're spending the night.",
        choices: [
            { text: "Bed down under the underpass for the night.", customAction: () => resolveRough('underpass') },
            {
                text: "Try to get a bed at the downtown shelter.",
                customAction: () => {
                    if (Math.random() < 0.03 && state.cash > 0) {
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
        condition: () => state.timeHour >= 9 && state.timeHour <= 19,
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
        condition: () => !state.flags.backpackBroken && !state.flags.hasSturdyBackpack,
        text: "As you hurry across the intersection, the left strap of your overstuffed backpack snaps. Your sleeping bag, a change of clothes, and your plastic folder of vital documents spill onto the wet pavement. You can't carry it all loose.",
        effects: { mentalFortitude: -15, timePassed: 0.5, flags: { backpackBroken: true } },
        choices: [
            { text: "Abandon the heavy sleeping bag. Keep the documents and extra clothes.", nextScenario: "street_lightweight", effects: { maxWarmthCapacity: -20 } },
            { text: "Use a discarded plastic grocery bag to bundle the loose items. It will drastically slow your walking speed.", nextScenario: "street_with_plastic_bag", effects: { timeModifier: 1.5 } }
        ]
    },
    {
        id: "food_truck_encounter",
        notRandom: false,
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
        condition: () => !state.flags.hasNewShoes,
        text: "Disaster. The worn-out sole of your right shoe finally tears completely off. Walking on the exposed pavement is agonizing.",
        effects: { mentalFortitude: -20, timePassed: 0 },
        choices: [
            { text: "Buy some duct tape at a convenience store to patch it.", requires: { cash: 2.00 }, effects: { cash: -2.00, timePassed: 0.5 }, nextScenario: 'shoe_patched' },
            { text: "Tear a piece of your shirt to tie it together.", nextScenario: 'shoe_shirt', effects: { maxWarmthCapacity: -10, timePassed: 0.5 } },
            { text: "Limp along with the broken shoe.", nextScenario: 'shoe_broken_limp', effects: { timeModifier: 1.3 } }
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
        text: "You're freezing, and the subway station looks incredibly inviting. A heated train ride from one end of the line to the other would take 2 hours.",
        effects: { timePassed: 0.1 },
        choices: [
            { text: "Pay the fare.", requires: { cash: 2.75 }, effects: { cash: -2.75, warmth: 40, mentalFortitude: 10, timePassed: 2 }, nextScenario: 'subway_ride' },
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
        condition: () => !state.flags.hasWinterCoat,
        text: "You find a clothing donation bin. The anti-theft chute is jammed open slightly. You might be able to reach your arm in and pull something out.",
        effects: { timePassed: 0.2 },
        choices: [
            { text: "Reach in.", customAction: () => {
                if (Math.random() < 0.3) {
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
        condition: () => state.timeHour >= 6 && state.timeHour <= 14,
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
    // The Way Out: quest chain to make Goal Mode winnable (mailing address -> birth certificate -> ID -> clean clothes)
    {
        id: 'day_center',
        notRandom: false,
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
        weight: 4,
        condition: () => state.mode === 'goal' && state.flags.birthCertOrdered && !state.flags.hasBirthCert && state.day >= state.flags.birthCertArrivesDay && state.timeHour >= 9 && state.timeHour <= 16,
        text: "You stop by the Hopewell Day Center to check the mail. The volunteer flips through a plastic bin and smiles as she hands you a stiff envelope from the state records office. Your birth certificate. Proof that you exist.",
        effects: { mentalFortitude: 20, timePassed: 0.5, flags: { hasBirthCert: true } },
        choices: [ { text: "Tuck it somewhere safe. Next stop: the DMV.", nextScenario: null } ]
    },
    {
        id: 'dmv_visit',
        notRandom: false,
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
                    state.timeModifier = 1.0;
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
                    state.timeModifier = 1.0;
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
                    state.timeModifier = 1.0;
                    applyEffects({ mentalFortitude: 10, timePassed: 0.3 });
                    loadScenario();
                }
            }
        ]
    },
    {
        id: 'surplus_store',
        notRandom: false,
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
                    state.timeModifier = 1.0;
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
                    state.timeModifier = 1.0;
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
            { text: "Take a general labor ticket — moving furniture (4 hrs, $40.00).", requires: { health: 40, hunger: 30 }, effects: { cash: 40.00, health: -10, hunger: -25, mentalFortitude: 5, timePassed: 4 }, nextScenario: 'labor_done_general' },
            { text: "Take a construction site ticket (6 hrs, $90.00).", requires: { flag: 'hasWorkBoots', flagLabel: '(Requires work boots)', health: 50, hunger: 40 }, effects: { cash: 90.00, health: -20, hunger: -40, warmth: 10, mentalFortitude: 10, timePassed: 6 }, nextScenario: 'labor_done_construction' },
            { text: "Leave. You're in no shape to work today.", nextScenario: null }
        ]
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
    
    if (effects.timeModifier !== undefined) state.timeModifier = effects.timeModifier;

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

    // Time advancement and passive drain
    let timePassed = effects.timePassed !== undefined ? effects.timePassed : 1;
    timePassed *= state.timeModifier;
    
    if (timePassed > 0) {
        const warmupDrain = 3 * state.difficultyMultiplier;
        const hungerDrain = 2.5 * state.difficultyMultiplier;

        // A recent hot coffee holds the hunger drain at bay, hour for hour
        const coffeeHours = state.flags.coffeeHoursRemaining || 0;
        const hungryHours = Math.max(0, timePassed - coffeeHours);
        state.flags.coffeeHoursRemaining = Math.max(0, coffeeHours - timePassed);

        state.warmth -= warmupDrain * timePassed;
        state.hunger -= hungerDrain * hungryHours;
        state.hygiene -= 1.5 * timePassed;

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

function loadScenario(id) {
    // Stop if the game has already ended (death or victory) — renderStats shows the end screen
    if (checkGameStatus() !== "CONTINUE") {
        renderStats();
        return;
    }
    
    // Nightfall: force the shelter decision once per evening
    if (!id && state.timeHour >= 19 && state.flags.lastShelterPromptDay !== state.day) {
        state.flags.lastShelterPromptDay = state.day;
        id = 'find_shelter';
    }

    // Steady work: with boots, the labor office is a guaranteed morning stop, once per day
    if (!id && state.flags.hasWorkBoots && state.timeHour >= 6 && state.timeHour <= 10 && state.flags.lastLaborDay !== state.day) {
        id = 'labor_office';
    }

    let scenario;
    if (id) {
        scenario = scenarios.find(s => s.id === id);
    } else {
        const randomPool = [];
        scenarios.forEach(s => {
            if (s.notRandom) return;
            if (s.condition && !s.condition()) return;
            const weight = s.weight || 1;
            for (let i = 0; i < weight; i++) randomPool.push(s);
        });
        scenario = randomPool[Math.floor(Math.random() * randomPool.length)];
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
    const saved = loadSave();
    if (saved && saved.mode) {
        const modeName = saved.mode === 'goal' ? 'The Way Out' : 'Endure';
        document.getElementById('continue-btn').innerHTML =
            `<strong>Continue</strong><br><small>Day ${saved.day} — ${modeName} — $${Number(saved.cash).toFixed(2)}</small>`;
        document.getElementById('continue-area').style.display = 'block';
    }
})();
