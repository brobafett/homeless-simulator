// Smoke test: drive game.js + scenarios.js through the full Goal Mode win path using a stubbed DOM.
const fs = require('fs');
const path = require('path');

function makeEl(id) {
    return {
        id,
        style: {},
        textContent: '',
        _innerHTML: '',
        children: [],
        classList: { add() {}, remove() {} },
        appendChild(child) { this.children.push(child); },
        set innerHTML(v) { this._innerHTML = v; this.children = []; },
        get innerHTML() { return this._innerHTML; }
    };
}

const els = {};
global.document = {
    getElementById(id) { if (!els[id]) els[id] = makeEl(id); return els[id]; },
    createElement() { return makeEl('btn'); }
};
global.location = { reload() {} };
const storage = {};
global.localStorage = {
    setItem(k, v) { storage[k] = String(v); },
    getItem(k) { return k in storage ? storage[k] : null; },
    removeItem(k) { delete storage[k]; }
};

// Engine first, then content — same order as the script tags in index.html.
eval(fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8')
    + '\n' + fs.readFileSync(path.join(__dirname, '..', 'scenarios.js'), 'utf8')
    + '\n;global.G = { state, scenarios, WIN_CASH_GOAL, PAY_PERIOD_DAYS, CHECK_CASHING_FEE_RATE };');
// Function declarations from the eval (loadScenario, migrateLegacyFlags, ...) land in
// this scope directly; only let/const bindings need the G hand-off.
const state = global.G.state;
const scenarios = global.G.scenarios;
const WIN_CASH_GOAL = global.G.WIN_CASH_GOAL;
const PAY_PERIOD_DAYS = global.G.PAY_PERIOD_DAYS;
const CHECK_CASHING_FEE_RATE = global.G.CHECK_CASHING_FEE_RATE;

let failures = 0;
function assert(cond, msg) {
    if (cond) { console.log('PASS: ' + msg); }
    else { failures++; console.log('FAIL: ' + msg); }
}

function topUp() {
    state.health = 100; state.mental = 100; state.warmth = 100; state.hunger = 100;
    state.hygiene = 100;
    state.timeHour = 10;
}

function clickChoice(match) {
    const btn = els['choices-list'].children.find(b => b.textContent.includes(match));
    if (!btn) throw new Error('No choice matching "' + match + '". Have: ' + els['choices-list'].children.map(b => b.textContent).join(' | '));
    if (btn.disabled) throw new Error('Choice disabled: ' + btn.textContent);
    btn.onclick();
}

// --- Start goal mode ---
startGame('goal');
state.cash = 100; topUp();

// 1. Day center -> mailing address
loadScenario('day_center');
clickChoice('Sign up');
assert(state.flags.hasMailingAddress === true, 'mailing address obtained');

// 2. Library -> order birth certificate
topUp();
loadScenario('order_birth_cert');
clickChoice('Order the birth certificate');
assert(state.flags.birthCertOrdered === true, 'birth certificate ordered');
assert(state.flags.birthCertArrivesDay === state.day + 3 || state.flags.birthCertArrivesDay > state.day, 'arrival day set in the future');
assert(Math.abs(state.cash - 75) < 0.01, 'paid $25 (cash now $' + state.cash.toFixed(2) + ')');

// 3. Mail arrives after 3 days
topUp();
state.day = state.flags.birthCertArrivesDay;
loadScenario('mail_arrives');
assert(state.flags.hasBirthCert === true, 'birth certificate received');

// 4. DMV -> ID application (the card comes by mail, not over the counter)
topUp();
loadScenario('dmv_visit');
clickChoice('pay for the ID');
assert(state.hasID === false, 'no instant ID — it comes by mail');
assert(state.flags.idOrdered === true, 'ID application filed');
assert(state.flags.idArrivesDay === state.day + 10, 'day-center address takes 10 days of processing');
assert(Math.abs(state.cash - 55) < 0.01, 'paid $20 (cash now $' + state.cash.toFixed(2) + ')');

// 4b. The ID arrives in the mail on or after the arrival day
topUp();
state.day = state.flags.idArrivesDay;
loadScenario('id_arrives');
assert(state.hasID === true, 'state ID received in the mail');

// 5. Clothing closet -> clean clothes
topUp();
loadScenario('clothing_closet');
clickChoice('thrift store');
assert(state.hasCleanClothes === true, 'clean clothes obtained');

// 6. Victory once cash >= WIN_CASH_GOAL
topUp();
state.cash = WIN_CASH_GOAL;
assert(checkGameStatus().startsWith('VICTORY'), 'checkGameStatus reports VICTORY');
renderStats();
assert(els['narrative-text'].innerHTML.includes('VICTORY'), 'victory screen rendered');

// Regression: victory must survive the real gameplay path — loadScenario used to
// render the victory screen and then immediately overwrite it with a new scenario
loadScenario();
assert(els['narrative-text'].innerHTML.includes('VICTORY'), 'victory screen not clobbered by the next scenario load');
assert(els['choices-list'].innerHTML.includes('Play Again'), 'victory screen offers Play Again');
assert(loadSave() === null, 'victory wipes the save');

// --- Money makes food easier: diner meal in find_meal ---
state.mode = 'goal'; state.flags = {};
topUp(); state.cash = 20; state.hunger = 30;
loadScenario('find_meal');
clickChoice('diner');
assert(Math.abs(state.cash - 12) < 0.01, 'diner meal cost $8 (cash now $' + state.cash.toFixed(2) + ')');
assert(state.hunger > 60, 'diner meal restored hunger (now ' + Math.floor(state.hunger) + ')');

// --- Nightfall forces the shelter decision once per evening ---
topUp(); state.cash = 100; state.flags = {};
state.timeHour = 19.5;
loadScenario();
assert(els['narrative-text'].innerHTML.includes("where you're spending the night"), 'find_shelter forced after 7 PM');
assert(state.flags.lastShelterPromptDay === state.day, 'shelter prompt recorded for today');

// --- Motel room: costs $50, safe night, wakes at 8 AM next day ---
const dayBefore = state.day;
clickChoice('Rent a room');
clickChoice('budget motel');
assert(Math.abs(state.cash - 50) < 0.01, 'motel cost $50 (cash now $' + state.cash.toFixed(2) + ')');
assert(state.day === dayBefore + 1 && state.timeHour === 8, 'woke at 8 AM the next day');
assert(state.health === 100 && state.hunger === 100 && state.mental === 100 && state.hygiene === 100, 'motel fully restored stats including hygiene');

// --- Renting disabled without cash ---
topUp(); state.cash = 10;
loadScenario('find_shelter');
const rentBtn = els['choices-list'].children.find(b => b.textContent.includes('Rent a room'));
assert(rentBtn && rentBtn.disabled, 'rent-a-room choice disabled when broke');

// --- Room tiers: price buys quality ---
const origRandom = Math.random;
state.flags = {}; topUp(); state.cash = 30; state.timeHour = 20;
state.health = 50; state.mental = 50; state.hunger = 50; state.hygiene = 40;
Math.random = () => 0.9; // dodge the 20% flophouse robbery roll
loadScenario('rent_room');
clickChoice('flophouse');
Math.random = origRandom;
assert(Math.abs(state.cash - 12) < 0.01, 'flophouse cost $18 (cash now $' + state.cash.toFixed(2) + ')');
assert(state.health === 90 && state.mental === 80 && state.hunger === 85 && state.hygiene === 62,
    'flophouse recovery is additive, not a reset (50/50/50/40 -> 90/80/85/62)');
assert(state.timeHour === 8, 'flophouse still sleeps through to morning');

// --- Flophouse can roll into an overnight robbery ---
topUp(); state.cash = 50; state.timeHour = 20;
Math.random = () => 0.1; // force the 20% roll
loadScenario('rent_room');
clickChoice('flophouse');
Math.random = origRandom;
assert(els['narrative-text'].innerHTML.includes('hand reaching into your pockets'), 'flophouse robbery routes into shelter_robbery');
Math.random = () => 0.9; // thief runs off when confronted
clickChoice('Confront');
Math.random = origRandom;
assert(state.timeHour === 8, 'robbery night still resolves to morning');

// --- Weekly motel: $200 up front buys six nights and a full mental reset ---
state.flags = {}; topUp(); state.cash = 250; state.timeHour = 20;
loadScenario('rent_room');
clickChoice('Six nights');
assert(Math.abs(state.cash - 50) < 0.01, 'weekly rate cost $200 (cash now $' + state.cash.toFixed(2) + ')');
assert(state.mental === 100 && state.hygiene === 100, 'weekly motel fully restored, mental reset to 100');
assert(state.flags.motelDaysRemaining === 5, 'five prepaid nights remain after sleeping the first');
assert(els['gear-list'].innerHTML.includes('Motel residency proof'), 'gear panel shows motel residency proof');

// Prepaid nights are free via find_shelter and tick down each day
topUp(); state.timeHour = 20; state.flags.lastShelterPromptDay = 0;
loadScenario('find_shelter');
clickChoice('your motel room');
assert(Math.abs(state.cash - 50) < 0.01, 'prepaid motel night costs nothing');
assert(state.flags.motelDaysRemaining === 4, 'prepaid nights tick down as days advance');

// --- Checkout morning: the desk offers a renewal and a day's gear hold ---
state.flags.motelDaysRemaining = 1; topUp(); state.timeHour = 20; state.flags.lastShelterPromptDay = 0;
loadScenario('find_shelter');
clickChoice('your motel room'); // the last prepaid night
assert(state.flags.motelDaysRemaining === 0, 'last prepaid night consumed');
assert(els['choices-list'].innerHTML.includes('six more nights'), 'checkout morning offers a renewal at the desk');
assert(els['choices-list'].innerHTML.includes('Not enough money'), 'renewal renders disabled when you cannot cover it');
assert(els['choices-list'].innerHTML.includes('hold your pack'), 'checkout morning offers to leave the pack at the desk');

// Desk hold: the pack goes behind the counter, forced pickup at dusk, no sweep roll
leaveGearAtDesk();
assert(state.flags.gearAtDesk === true && state.flags.gearStashed === true, 'desk hold stages the gear');
assert(els['gear-list'].innerHTML.includes('held at the motel desk'), 'gear panel shows the desk-held bag');
state.timeHour = 18; state.flags.lastRetrievalPromptDay = 0;
loadScenario();
assert(els['narrative-text'].innerHTML.includes('hauls your pack'), 'dusk forces the desk pickup');
clickChoice('Shoulder the pack');
assert(!state.flags.gearAtDesk && !state.flags.gearStashed, 'pack back on your back after the pickup');

// Renewal: nights add on instead of overwriting, and no cash means no-op
state.cash = 250; state.flags.motelDaysRemaining = 0;
renewMotelWeek();
assert(state.flags.motelDaysRemaining === 6, 'renewal books six more nights');
assert(Math.abs(state.cash - 50) < 0.01, 'renewal cost $200');
renewMotelWeek();
assert(state.flags.motelDaysRemaining === 6 && Math.abs(state.cash - 50) < 0.01, 'renewal without the cash is a no-op');
state.cash = 200; state.flags.motelDaysRemaining = 2;
renewMotelWeek();
assert(state.flags.motelDaysRemaining === 8, 'renewing early adds nights instead of overwriting');

// Buying the weekly rate mid-week (the rent_room path) stacks the same way
state.cash = 250; state.flags.motelDaysRemaining = 2;
resolveRoom('motel_weekly');
assert(state.flags.motelDaysRemaining === 7, 'mid-week weekly purchase stacks nights (2 + 6, minus the night slept)');
assert(Math.abs(state.cash - 50) < 0.01, 'mid-week weekly purchase cost $200');

// --- Motel residency speeds up ID processing (4 days instead of 10) ---
state.mode = 'goal'; state.hasID = false;
state.flags.hasMailingAddress = true; state.flags.hasBirthCert = true;
topUp(); state.cash = 50;
loadScenario('dmv_visit');
clickChoice('pay for the ID');
assert(state.flags.idArrivesDay === state.day + 4, 'motel address: ID takes only 4 days');
topUp(); state.day = state.flags.idArrivesDay;
loadScenario('id_arrives');
assert(state.hasID === true, 'ID delivered to the motel');
state.hasID = false;

// The envelope is not a lottery ticket: the desk you sleep behind offers it,
// and the Hopewell volunteer's redirect is a walkable pickup, not just flavor
state.flags.motelDaysRemaining = 3; state.cash = 60; state.timeHour = 20;
resolveRoom('motel');
assert(els['choices-list'].innerHTML.includes('state seal'), 'motel morning flags the waiting envelope at the desk');
loadScenario('hopewell_block');
clickChoice('mail bin');
assert(els['narrative-text'].innerHTML.includes('front desk'), 'the Hopewell volunteer redirects a motel-routed card');
clickChoice('front desk');
assert(state.hasID === true, 'the walk to the motel desk collects the ID');
state.hasID = false;

// --- Sleeping rough: additive recovery, so deprivation compounds ---
// Pinned to autumn: the exact warmth numbers assume no seasonal rough-sleep adjustment
state.day = 5;
state.flags = {}; topUp(); state.cash = 0; state.timeHour = 20;
state.health = 60; state.mental = 60; state.warmth = 40; state.hunger = 50; state.hygiene = 50;
Math.random = () => 0.9; // quiet night
loadScenario('find_shelter');
clickChoice('underpass');
Math.random = origRandom;
assert(state.timeHour === 8, 'rough night still ends at 8 AM');
assert(state.health === 66 && state.mental === 68, 'rough sleep barely restores (60/60 -> 66/68)');
assert(state.warmth === 50, 'no warmth reset under the underpass (40 -> 50)');

// A bad roll makes the night actively worse
state.flags = {}; topUp(); state.cash = 0; state.timeHour = 20;
state.health = 60; state.mental = 60;
Math.random = () => 0.1; // risk hits (0.1 < 0.25), roll 0.1 < 0.45: sleepless night
loadScenario('find_shelter');
clickChoice('underpass');
Math.random = origRandom;
assert(state.health === 62 && state.mental === 56, 'a bad night outside costs more than it gives (60/60 -> 62/56)');

// --- Lost wallet: returning it sets karma, coffee buff, and full warmth ---
state.flags = {}; state.timeModifier = 1.0; topUp(); state.cash = 0; state.warmth = 30; state.mental = 60;
loadScenario('lost_wallet');
clickChoice('return it');
assert(state.flags.returned_wallet === true, 'returned_wallet flag set');
assert(Math.abs(state.cash - 20) < 0.01, 'wallet reward is $20');
assert(state.flags.coffeeHoursRemaining === 3, 'coffee buff lasts 3 hours');
assert(state.warmth === state.maxWarmthCapacity, 'coffee and gratitude warmed you through');
assert(state.mental > 60, 'returning the wallet lifts mental fortitude');

// Coffee buff pauses the passive hunger drain, hour for hour
state.difficultyMultiplier = 1.0;
state.hunger = 90;
applyEffects({ timePassed: 2 });
assert(state.hunger === 90, 'no hunger drain while the coffee lasts');
assert(Math.abs(state.flags.coffeeHoursRemaining - 1) < 0.001, 'coffee hours tick down with time');
applyEffects({ timePassed: 2 });
assert(Math.abs(state.hunger - 87.5) < 0.01, 'hunger drain resumes once the coffee runs out (only 1 of 2 hours covered)');

// --- Karma discount: 20% off the motel tiers after returning the wallet ---
topUp(); state.cash = 100; state.timeHour = 20;
loadScenario('rent_room');
assert(els['narrative-text'].innerHTML.includes('wallet you returned'), 'rent_room text acknowledges the karma discount');
clickChoice('budget motel');
assert(Math.abs(state.cash - 60) < 0.01, 'karma discount: motel cost $40 (cash now $' + state.cash.toFixed(2) + ')');

// --- Lost wallet: keeping the cash rolls $40-$120 and costs 30 mental ---
state.flags = {}; topUp(); state.cash = 0;
Math.random = () => 0.5; // midpoint roll: $80
loadScenario('lost_wallet');
clickChoice('Take the cash');
Math.random = origRandom;
assert(Math.abs(state.cash - 80) < 0.01, 'kept $80 (midpoint of the $40-$120 roll)');
assert(Math.abs(state.mental - 70) < 0.01, 'keeping the cash costs 30 mental');
assert(els['narrative-text'].innerHTML.includes('$80.00'), 'wallet_kept narrates the amount taken');

topUp(); state.mental = 20;
loadScenario('lost_wallet');
const keepBtn = els['choices-list'].children.find(b => b.textContent.includes('Take the cash'));
assert(keepBtn && keepBtn.disabled, 'keeping the cash is gated below 25% mental');

// --- Prepaid phone: transit penalty without it, dispatch texts with it ---
state.mode = 'goal'; state.flags = {}; state.timeModifier = 1.0; topUp(); state.cash = 0;
state.timeHour = 7;
loadScenario('labor_office');
assert(Math.abs(state.timeHour - 9.2) < 0.01, 'no phone: 2-hour walk to check the board (time now ' + state.timeHour.toFixed(1) + ')');
assert(state.warmth < 95, 'the cold walk cost warmth');
assert(els['narrative-text'].innerHTML.includes('No working phone'), 'transit penalty notice shown');

topUp(); state.cash = 40;
loadScenario('convenience_store');
clickChoice('prepaid phone');
assert(state.flags.hasPhone === true, 'phone purchased');
assert(state.flags.phoneExpiryDay === state.day + 5, 'phone loaded with 5 days of minutes');
assert(Math.abs(state.cash - 20) < 0.01, 'phone cost $20');
assert(els['gear-list'].innerHTML.includes('Prepaid phone (active'), 'gear panel shows the active phone');

loadScenario('convenience_store');
clickChoice('Top up');
assert(state.flags.phoneExpiryDay === state.day + 10, 'top-up adds 5 more days');
assert(Math.abs(state.cash - 10) < 0.01, 'top-up cost $10');

loadScenario('convenience_store');
const buyPhoneBtn = els['choices-list'].children.find(b => b.textContent.includes('Buy a prepaid phone'));
assert(buyPhoneBtn && buyPhoneBtn.disabled, 'cannot buy a second phone');

state.day++; topUp(); state.timeHour = 7;
loadScenario('labor_office');
assert(Math.abs(state.timeHour - 7.2) < 0.01, 'active phone skips the transit penalty');

state.day = state.flags.phoneExpiryDay + 1;
renderStats();
assert(els['gear-list'].innerHTML.includes('no minutes'), 'gear panel shows the phone once the minutes run out');
state.day = 15; // keep the clock sane for the rest of the suite

// --- Storage: plastic bag holds 1 meal, heavy-duty pack holds 4 ---
state.flags = { pack: 'broken' }; topUp(); state.cash = 20; state.foodStash = 0;
loadScenario('find_meal');
clickChoice('to-go');
assert(state.foodStash === 1, 'bought a packed meal');
loadScenario('find_meal');
const togoBtn = els['choices-list'].children.find(b => b.textContent.includes('to-go'));
assert(togoBtn && togoBtn.disabled && togoBtn.textContent.includes('No room'), 'plastic grocery bag holds only one meal');
state.flags = { pack: 'sturdy' };
loadScenario('find_meal');
const togoBtn2 = els['choices-list'].children.find(b => b.textContent.includes('to-go'));
assert(togoBtn2 && !togoBtn2.disabled, 'heavy-duty pack has room for more');
state.hunger = 40;
loadScenario('find_meal');
Math.random = () => 0; // pin the follow-up draw — a random scenario's entry effects could drain hunger
clickChoice('Eat a packed meal');
Math.random = origRandom;
assert(state.foodStash === 0 && state.hunger > 60, 'ate from the stash (hunger now ' + Math.floor(state.hunger) + ')');

// --- The labor office is a guaranteed morning stop for everyone; boots gate the good tickets ---
state.flags = {}; topUp(); state.cash = 0;
state.timeHour = 7;
loadScenario();
assert(els['narrative-text'].innerHTML.includes('day labor office'), 'no boots: the labor office is still a guaranteed morning stop');
const stashAtOffice = els['choices-list'].children.find(b => b.textContent.includes('Stash the sleeping bag'));
assert(stashAtOffice && !stashAtOffice.disabled, 'the stash decision is offered at the office, before any ticket');
const bootlessConstruction = els['choices-list'].children.find(b => b.textContent.includes('construction'));
assert(bootlessConstruction && bootlessConstruction.disabled, 'the construction ticket stays gated on boots');
const bootlessGeneral = els['choices-list'].children.find(b => b.textContent.includes('general labor'));
assert(bootlessGeneral && !bootlessGeneral.disabled, 'the lousy-but-reliable general ticket is open to everyone');
const bootRoute = els['choices-list'].children.find(b => b.textContent.includes('shoe outlet'));
assert(bootRoute && !bootRoute.disabled, 'bootless morning offers a direct walk to the shoe outlet');
clickChoice('shoe outlet');
assert(els['narrative-text'].innerHTML.includes('clearance rack'), 'the outlet route leads to the shoe store');

// Stashing at the office keeps the board open and discounts the construction toll
state.flags = { footwear: 'boots', hasPhone: true, phoneExpiryDay: 99 }; topUp(); state.cash = 0;
state.timeHour = 7;
loadScenario();
assert(els['narrative-text'].innerHTML.includes('day labor office'), 'morning forces the labor office when you own boots');
assert(state.flags.lastLaborDay === state.day, 'labor office visit recorded for today');
assert(!els['choices-list'].children.find(b => b.textContent.includes('shoe outlet')), 'the outlet route disappears once you own boots');
clickChoice('Stash the sleeping bag');
assert(state.flags.gearStashed === true, 'stashing at the office hides the gear');
assert(els['narrative-text'].innerHTML.includes('ticket list'), 'the board is still there after stashing');
clickChoice('construction');
assert(state.health === 90, 'traveling light halves the construction toll (health now ' + state.health + ')');
assert(Math.abs(state.cash - 90) < 0.01, 'construction gig paid $90 after the stash');
state.flags.gearStashed = false; // put the bag back on for the rest of the suite
let repeatOffice = false;
for (let i = 0; i < 30; i++) {
    topUp(); state.timeHour = 7;
    loadScenario();
    if (els['narrative-text'].innerHTML.includes('day labor office')) repeatOffice = true;
}
assert(!repeatOffice, 'labor office does not reappear the same day');
state.day++;
topUp(); state.timeHour = 7;
loadScenario();
assert(els['narrative-text'].innerHTML.includes('day labor office'), 'labor office returns the next day');

// --- Gear panel reflects inventory ---
state.flags = { footwear: 'boots' };
renderStats();
assert(els['gear-list'].innerHTML.includes('Steel-toe work boots'), 'gear panel lists boots');
assert(els['gear-list'].innerHTML.includes('Worn backpack'), 'gear panel shows backpack tier');
state.hasID = true;
renderStats();
assert(els['gear-list'].innerHTML.includes('State ID'), 'gear panel lists state ID');
state.hasID = false;

// --- Requirements: health and flag gating enforced on choices ---
state.mode = 'goal'; state.flags = {};
topUp(); state.cash = 0; state.health = 20;
loadScenario('labor_office');
const generalBtn = els['choices-list'].children.find(b => b.textContent.includes('general labor'));
assert(generalBtn && generalBtn.disabled, 'general labor ticket disabled at 20% health');
const constructionBtn = els['choices-list'].children.find(b => b.textContent.includes('construction'));
assert(constructionBtn && constructionBtn.disabled && constructionBtn.textContent.includes('work boots'), 'construction ticket disabled without work boots');

// --- Shoe store: boots unlock the better-paying construction gig ---
topUp(); state.cash = 50;
loadScenario('shoe_store');
clickChoice('work boots');
assert(state.flags.footwear === 'boots', 'buying boots sets footwear to boots');
assert(Math.abs(state.cash - 15) < 0.01, 'boots cost $35 (cash now $' + state.cash.toFixed(2) + ')');
topUp();
loadScenario('labor_office');
clickChoice('construction');
assert(Math.abs(state.cash - 105) < 0.01, 'construction gig paid $90 (cash now $' + state.cash.toFixed(2) + ')');

// --- New shoes prevent shoe blowouts ---
let blowout = false;
for (let i = 0; i < 300; i++) {
    topUp();
    loadScenario();
    if (els['narrative-text'].innerHTML.includes('sole of your right shoe')) blowout = true;
}
assert(!blowout, 'shoe_blowout never occurs once you own decent shoes');

// --- Shelter stay grants clinic referral; referral gets treatment ---
state.flags = {}; topUp(); state.cash = 0; state.timeHour = 20;
loadScenario('find_shelter');
clickChoice('downtown shelter');
assert(state.flags.hasShelterReferral === true, 'shelter stay granted a clinic referral');
topUp(); state.health = 50;
loadScenario('clinic_desk');
clickChoice('referral slip');
assert(state.health > 80, 'clinic treated you via the referral (health now ' + Math.floor(state.health) + ')');

// --- Hygiene: decays over time, gates the gym, restored by showers ---
state.flags = {}; topUp();
loadScenario('find_meal');
clickChoice('Beg outside');
assert(state.hygiene < 100, 'hygiene decays as time passes (now ' + state.hygiene.toFixed(1) + ')');

let gymWhileClean = false;
for (let i = 0; i < 300; i++) {
    topUp(); // hygiene 100
    loadScenario();
    if (els['narrative-text'].innerHTML.includes('fitness center')) gymWhileClean = true;
}
assert(!gymWhileClean, 'gym shower scenario never appears while clean');

topUp(); state.hygiene = 30; state.cash = 10;
loadScenario('gym_trial');
clickChoice('guest day pass');
assert(state.hygiene > 90, 'gym shower restored hygiene (now ' + Math.floor(state.hygiene) + ')');

topUp(); state.hygiene = 20; state.cash = 0; state.timeHour = 20;
loadScenario('find_shelter');
clickChoice('downtown shelter');
assert(state.hygiene === 50, 'shelter shower helps but no longer wipes the slate (20 -> 50)');

// --- Legacy save migration: overlapping gear booleans fold into single-valued flags ---
{
    const legacy = { hasWorkBoots: true, hasNewShoes: true, shoeBroken: true, backpackBroken: true, luggingPlasticBag: true, hasSleepingBag: false, metRay: true };
    migrateLegacyFlags(legacy);
    assert(legacy.footwear === 'boots', 'migration: boots win over a stale shoeBroken');
    assert(legacy.pack === 'plastic', 'migration: broken pack with plastic bag -> plastic');
    assert(legacy.lostSleepingBag === true, 'migration: hasSleepingBag false -> lostSleepingBag');
    assert(legacy.metRay === true, 'migration leaves unrelated flags alone');
    assert(!('hasWorkBoots' in legacy) && !('backpackBroken' in legacy) && !('hasSleepingBag' in legacy), 'migration drops the legacy keys');
    const legacy2 = { hasNewShoes: true, backpackBroken: true, hasSturdyBackpack: false };
    migrateLegacyFlags(legacy2);
    assert(legacy2.footwear === 'sneakers' && legacy2.pack === 'broken', 'migration: sneakers and a loose broken pack');
    const fresh = {};
    migrateLegacyFlags(fresh);
    assert(fresh.footwear === undefined && fresh.pack === undefined && fresh.lostSleepingBag === undefined, 'migration is a no-op on a fresh save (defaults stay implicit)');
}

// --- Gear defaults: a fresh flags object means worn shoes, worn pack, sleeping bag owned ---
state.flags = {}; topUp();
recomputeTimeModifier();
assert(state.timeModifier === 1 && carryCapacity() === 2 && ownsSleepingBag(), 'fresh flags: no limp, two-meal pack, sleeping bag owned');
state.flags = { footwear: 'broken', pack: 'plastic' }; recomputeTimeModifier();
assert(Math.abs(state.timeModifier - 1.95) < 1e-9 && carryCapacity() === 1, 'torn shoe and plastic bag stack (1.3 x 1.5) at one-meal capacity');
renderStats();
assert(els['gear-list'].innerHTML.includes('Torn shoe') && els['gear-list'].innerHTML.includes('Plastic grocery bag'), 'gear panel shows the limp and the plastic bag');
state.flags = {}; recomputeTimeModifier();

// --- Backpack: breaking once stops repeats until replaced ---
state.flags = {}; topUp();
loadScenario('backpack_breaks');
assert(state.flags.pack === 'broken', 'backpack break sets pack to broken');
let rebreak = false;
for (let i = 0; i < 300; i++) {
    topUp();
    loadScenario();
    if (els['narrative-text'].innerHTML.includes('backpack snaps')) rebreak = true;
}
assert(!rebreak, 'backpack_breaks never repeats while already broken');

// --- Scavenging can turn up a replacement when yours is broken ---
topUp(); state.cash = 0;
const realRandom = Math.random;
Math.random = () => 0.1; // force the 35% find
loadScenario('find_meal');
clickChoice('dumpster');
Math.random = realRandom;
assert(els['narrative-text'].innerHTML.includes('faded canvas backpack'), 'dumpster dive found a backpack');
Math.random = () => 0; // pin the follow-up random draw so backpack_breaks can't immediately re-fire
clickChoice('Take it');
Math.random = realRandom;
assert(state.flags.pack === 'worn', 'found backpack restores a worn pack');

// --- Surplus store: used pack gated to broken, new pack ends breaks forever ---
state.flags = {}; topUp(); state.cash = 100;
loadScenario('surplus_store');
const usedBtn = els['choices-list'].children.find(b => b.textContent.includes('used backpack'));
assert(usedBtn && usedBtn.disabled && usedBtn.textContent.includes('holding together'), 'used backpack disabled while current pack works');
clickChoice('heavy-duty');
assert(state.flags.pack === 'sturdy', 'new backpack sets pack to sturdy');
assert(Math.abs(state.cash - 70) < 0.01, 'new backpack cost $30 (cash now $' + state.cash.toFixed(2) + ')');
let sturdyBreak = false;
for (let i = 0; i < 300; i++) {
    topUp();
    loadScenario();
    if (els['narrative-text'].innerHTML.includes('backpack snaps')) sturdyBreak = true;
}
assert(!sturdyBreak, 'backpack never breaks once you own the heavy-duty pack');

// --- Random pool sanity: conditions gate quest steps correctly ---
// Fresh-ish state: reset relevant fields
state.mode = 'goal'; state.hasID = false; state.hasCleanClothes = false; state.flags = {};
topUp(); state.cash = 50;
let nightSceneByDay = false;
for (let i = 0; i < 200; i++) {
    topUp(); // keep alive; loadScenario entry effects drain stats; resets to 10:00 AM
    loadScenario();
    if (els['narrative-text'].innerHTML.includes('a flashlight shines in your face')) nightSceneByDay = true;
}
assert(true, '200 random goal-mode scenario loads without crash');
assert(!nightSceneByDay, 'police_move_on (night scene) never appears during the day');

// order_birth_cert must never appear randomly without a mailing address
state.flags = {}; topUp();
let leaked = false;
for (let i = 0; i < 300; i++) {
    topUp();
    loadScenario();
    if (els['narrative-text'].innerHTML.includes('order a replacement birth certificate')) leaked = true;
}
assert(!leaked, 'order_birth_cert never appears before getting a mailing address');

// Endless mode: quest scenarios must not appear
state.mode = 'endless'; state.flags = { hasMailingAddress: true, hasBirthCert: true }; topUp();
let questLeak = false;
for (let i = 0; i < 300; i++) {
    topUp();
    loadScenario();
    const html = els['narrative-text'].innerHTML;
    if (html.includes('Hopewell') || html.includes('DMV') || html.includes('clothing closet')) questLeak = true;
}
assert(!questLeak, 'quest scenarios never appear in endless mode');

// --- Save system: autosave, continue, and wipe on death ---
state.mode = 'goal'; state.hasID = false; state.hasCleanClothes = false; state.flags = {};
topUp(); state.cash = 77.50; state.day = 12;
loadScenario('find_meal'); // renderStats autosaves
let saved = loadSave();
assert(saved && saved.mode === 'goal' && saved.day === 12 && Math.abs(saved.cash - 77.50) < 0.01, 'game autosaves on render');

state.cash = 1.00; state.day = 1; state.flags = {};
continueGame();
assert(Math.abs(state.cash - 77.50) < 0.01 && state.day === 12, 'continueGame restores the saved run');

state.health = 0;
renderStats(); // death -> endGame -> save wiped
assert(loadSave() === null, 'death wipes the save');
assert(els['narrative-text'].innerHTML.includes('GAME OVER'), 'death screen shown');
state.health = 100; // revive for cleanliness

// --- Starvation: an empty stomach drains health instead of killing outright ---
state.mode = 'goal'; state.flags = {}; state.timeModifier = 1.0; state.difficultyMultiplier = 1.0;
topUp(); state.hunger = 2; state.health = 80; state.mental = 80;
applyEffects({ timePassed: 2 }); // 5 hunger drain vs 2 available: 3-point deficit
assert(state.hunger === 0, 'hunger clamps at 0 instead of going negative');
assert(Math.abs(state.health - 77.75) < 0.01, 'the deficit converts into health damage (now ' + state.health.toFixed(2) + ')');
assert(checkGameStatus() === 'CONTINUE', 'hitting 0 hunger is not instant death');
state.hunger = 0; state.health = 5;
applyEffects({ timePassed: 4 });
assert(checkGameStatus().includes('Starvation'), 'prolonged starvation still kills, through health');
state.health = 100; state.hunger = 100; // revive

// --- Food bank: multi-day supply, limited to once every few days ---
state.flags = { pack: 'sturdy' }; topUp(); state.foodStash = 0;
loadScenario('food_bank');
clickChoice('Sign in');
assert(state.foodStash === 3, 'pantry visit stocks three meals when the bag has room');
assert(state.flags.nextFoodBankDay === state.day + 4, 'pantry locked out for the next few days');
let pantryRepeat = false;
for (let i = 0; i < 100; i++) {
    topUp();
    loadScenario();
    if (els['narrative-text'].innerHTML.includes('FOOD PANTRY')) pantryRepeat = true;
}
assert(!pantryRepeat, 'food bank never reappears during the lockout window');
state.day = state.flags.nextFoodBankDay;
topUp();
loadScenario('food_bank');
const pantryBtn = els['choices-list'].children.find(b => b.textContent.includes('Sign in'));
assert(pantryBtn && !pantryBtn.disabled, 'food bank opens up again once the lockout passes');

// --- Soup kitchen keeps set lunch hours ---
state.flags = {};
let lunchAfterHours = false;
for (let i = 0; i < 200; i++) {
    topUp(); state.timeHour = 15;
    loadScenario();
    if (els['narrative-text'].innerHTML.includes('dining hall serves')) lunchAfterHours = true;
}
assert(!lunchAfterHours, 'soup kitchen lunch never appears outside serving hours');
topUp(); state.timeHour = 11;
loadScenario('soup_kitchen');
clickChoice('Join the line');
assert(state.hunger === 100 && els['narrative-text'].innerHTML.includes('tray'), 'the lunch line ends in a hot meal');

// --- Combined actions: eating can piggyback on riding out the elements ---
state.flags = {}; state.timeModifier = 1.0; topUp(); state.foodStash = 1; state.hunger = 50;
// Stamp the forced office stop so the zero-time assertion below isn't disturbed
// by the labor office intercepting the follow-up draw
state.flags.lastLaborDay = state.day;
const hourBefore = state.timeHour;
loadScenario('subway_ride');
Math.random = () => 0; // pin the follow-up draw to find_meal (no entry effects)
clickChoice('packed meal');
Math.random = origRandom;
assert(state.hunger > 80, 'eating on the train restores hunger (now ' + Math.floor(state.hunger) + ')');
assert(state.timeHour === hourBefore, 'eating on the train costs no extra time');

topUp(); state.foodStash = 1; state.hunger = 40; state.warmth = 50;
loadScenario('library_refuge');
clickChoice('corner carrel');
assert(state.hunger > 60, 'eating while drying off in the library restores hunger (now ' + Math.floor(state.hunger) + ')');
assert(state.warmth > 60, 'sheltering from the rain also restores warmth (now ' + Math.floor(state.warmth) + ')');
assert(els['narrative-text'].innerHTML.includes('carrel'), 'the combined choice gets its own scene');

// --- The walk back from work passes the convenience store ---
state.flags = { hasPhone: true, phoneExpiryDay: state.day + 1 }; topUp(); state.cash = 50;
loadScenario('labor_done_general');
assert(els['narrative-text'].innerHTML.includes('last minutes'), 'job-done scene warns when the phone is about to die');
clickChoice('convenience store');
assert(els['narrative-text'].innerHTML.includes('top-up'), 'store reachable straight from the job site');
clickChoice('Top up');
assert(state.flags.phoneExpiryDay === state.day + 6, 'topped up on the way home from work');
loadScenario('labor_done_construction');
const storeBtn = els['choices-list'].children.find(b => b.textContent.includes('convenience store'));
assert(storeBtn && !storeBtn.disabled, 'construction jobs offer the same store stop');

// --- One store visit, several transactions ---
state.flags = {}; state.timeModifier = 1.0; topUp(); state.cash = 40; state.foodStash = 0;
loadScenario('convenience_store');
const registerCash = state.cash;
const registerHour = state.timeHour;
clickChoice('candy bar');
assert(els['narrative-text'].innerHTML.includes('another pass down the aisle'), 'a purchase keeps you in the store');
clickChoice('cold-case sandwich');
assert(Math.abs(state.cash - (registerCash - 7)) < 0.01, 'both purchases rang up (cash now $' + state.cash.toFixed(2) + ')');
assert(Math.abs(state.timeHour - (registerHour + 0.4)) < 0.01, 'the browse loop charges item time only, no fresh entry effects');
clickChoice('prepaid phone');
assert(state.flags.hasPhone, 'phone bought mid-errand');
clickChoice('pick up a few things');
clickChoice('packaged meal');
assert(state.foodStash === 1, 'kept shopping after the phone: meal packed');
assert(Math.abs(state.cash - (registerCash - 33)) < 0.01, 'four transactions, one visit (cash now $' + state.cash.toFixed(2) + ')');

// --- The Hopewell block: the library across from the day center, walkable on purpose ---
state.mode = 'goal'; state.flags = {}; state.timeModifier = 1.0; state.day = 5;
state.hasID = false; state.hasCleanClothes = false;
topUp(); state.cash = 60; state.foodStash = 0;
loadScenario('idle_time');
clickChoice('branch library');
assert(els['narrative-text'].innerHTML.includes('Sycamore'), 'the walk from idle time lands on the Hopewell block');
clickChoice('ask about the mail service');
clickChoice('Sign up');
assert(state.flags.hasMailingAddress, 'mailing address earned without waiting on the random draw');
clickChoice('Cross the street and find a free computer');
clickChoice('Order the birth certificate');
assert(state.flags.birthCertOrdered, 'signed up and ordered the birth certificate in one trip');
loadScenario('hopewell_block');
clickChoice('mail bin');
assert(els['narrative-text'].innerHTML.includes('Nothing with your name'), 'checking the bin early finds no mail');
clickChoice('Cross back to the library');
assert(els['narrative-text'].innerHTML.includes('Sycamore'), 'the no-mail visit loops back to the block');
state.day = state.flags.birthCertArrivesDay; topUp();
loadScenario('hopewell_block');
clickChoice('mail bin');
assert(state.flags.hasBirthCert, 'birth certificate collected at the window on purpose');
state.flags.idOrdered = true; state.flags.idViaMotel = false; state.flags.idArrivesDay = state.day + 10;
loadScenario('hopewell_block');
clickChoice('mail bin');
assert(!state.hasID, 'the ID is not in the bin before its day');
state.day = state.flags.idArrivesDay; topUp();
loadScenario('hopewell_block');
clickChoice('mail bin');
assert(state.hasID, 'state ID collected at the window on purpose');
state.foodStash = 1; state.hunger = 40;
loadScenario('hopewell_block');
clickChoice('corner table');
assert(state.hunger > 60, 'the library doubles as a meal window (hunger now ' + Math.floor(state.hunger) + ')');
assert(els['narrative-text'].innerHTML.includes('Sycamore'), 'eating keeps you on the block');
state.timeHour = 21;
loadScenario('idle_time');
// v1.0.23.0: the after-hours walk renders disabled instead of vanishing —
// a known place is a door you can see but can't open
const lateWalk = els['choices-list'].children.find(b => b.textContent.includes('branch library'));
assert(lateWalk && lateWalk.disabled && lateWalk.textContent.includes('Closed until 8 AM'), 'library walk after closing renders disabled, not hidden');
state.mode = 'endless'; state.flags = {}; topUp(); state.hasID = false;
loadScenario('hopewell_block');
assert(!els['choices-list'].children.some(b => b.textContent.includes('mail')), 'endless mode keeps no mail window at the hub');
assert(els['choices-list'].children.some(b => b.textContent.includes('periodicals')), 'the reading room is open to everyone');
state.mode = 'goal';

// --- Pamela: the caseworker at Hopewell reads your nights ---
state.mode = 'goal'; state.flags = { hasMailingAddress: true }; state.timeModifier = 1.0; state.day = 5;
state.hasID = false; state.hasCleanClothes = false;
topUp(); state.cash = 300;
loadScenario('hopewell_block');
clickChoice('Introduce yourself');
assert(state.flags.metPamela, 'Pamela added you to her caseload');
clickChoice('lay it out');
assert(els['narrative-text'].innerHTML.includes('weekly rate'), 'sleeping rough: she pushes stable housing first');
assert(!els['choices-list'].children.some(b => b.textContent.includes('ready for steady work')), 'no job talk without a stable base');
resolveShelter();
topUp();
loadScenario('pamela_checkin');
assert(els['narrative-text'].innerHTML.includes('bunk is a bed'), 'a shelter night gets the bunk-line talk instead');
state.flags.motelDaysRemaining = 5;
loadScenario('pamela_checkin');
assert(els['narrative-text'].innerHTML.includes("call back"), 'housed: she works down the rest of the checklist');
assert(!els['choices-list'].children.some(b => b.textContent.includes('ready for steady work')), 'checklist unfinished, no job offer yet');
state.flags.hasPhone = true; state.flags.phoneExpiryDay = state.day + 5;
state.hasCleanClothes = true; state.hasID = true;
loadScenario('pamela_checkin');
assert(els['narrative-text'].innerHTML.includes('Hireable'), 'four for four: hireable');
clickChoice('ready for steady work');
assert(state.flags.jobSearchUnlocked, 'Pamela opens the full-time job search');
assert(els['narrative-text'].innerHTML.includes('check back at this table'), 'she starts making calls');
loadScenario('pamela_checkin');
assert(els['narrative-text'].innerHTML.includes('Still working my phone'), 'follow-up visits hold the line');
state.mode = 'endless';
loadScenario('hopewell_block');
assert(!els['choices-list'].children.some(b => b.textContent.includes('Pamela') || b.textContent.includes('caseworker')), 'endless mode has no caseworker table');
state.mode = 'goal';

// --- Full-time: the warehouse replaces the ticket board ---
state.mode = 'goal'; state.timeModifier = 1.0; state.day = 5;
state.flags = { metPamela: true, hasMailingAddress: true, motelDaysRemaining: 6, hasPhone: true, phoneExpiryDay: 30 };
state.hasID = true; state.hasCleanClothes = true;
topUp(); state.cash = 100; state.foodStash = 0;
loadScenario('pamela_checkin');
clickChoice('ready for steady work');
assert(state.flags.jobSearchUnlocked && state.flags.jobSearchDay === state.day, 'job search opens with the day stamped');
loadScenario('pamela_checkin');
assert(els['narrative-text'].innerHTML.includes('Still working my phone'), 'no callback before her calls land');
state.day += 2; topUp();
loadScenario('pamela_checkin');
assert(els['narrative-text'].innerHTML.includes('Somebody called back'), 'two days later, the callback lands');
clickChoice('Ask who called back');
assert(els['narrative-text'].innerHTML.includes('Merchant Street'), 'the lead: Duane at Merchant Street Distribution');
clickChoice('Walk to Merchant Street');
assert(els['narrative-text'].innerHTML.includes('Sixteen an hour'), 'Duane states the terms');
clickChoice('Take it');
assert(state.flags.hasJob, 'hired full-time');
state.day += 1; topUp(); state.timeHour = 8;
state.flags.lastLaborDay = 0; state.flags.lastWorkDay = 0;
loadScenario();
assert(els['narrative-text'].innerHTML.includes('First shift'), 'employed morning forces the warehouse gate');
assert(state.flags.lastWorkDay === state.day, 'shift stamped for today');
const payBefore = state.cash;
clickChoice('work through lunch');
assert(state.cash === payBefore, 'a worked shift adds no cash — pay accrues instead');
assert(state.flags.pendingWages === 128, 'the shift accrued $128 in pending wages');
assert(els['narrative-text'].innerHTML.includes('books instead of into your pocket'), 'shift_done narrates the accrual on a non-payday');
assert(state.flags.shiftsWorked === 1, 'shift counted');
state.timeHour = 7; state.flags.lastLaborDay = 0;
loadScenario();
assert(state.flags.lastLaborDay === 0, 'the ticket board is retired while employed');
state.day += 1; topUp();
loadScenario('warehouse_shift');
clickChoice('Call out');
assert(state.flags.missedShifts === 1, 'first miss counted');
assert(els['narrative-text'].innerHTML.includes("That's one"), 'Duane counts it too');
const cashBeforeFired = state.cash;
state.day += 1; topUp();
loadScenario('warehouse_shift');
clickChoice('Call out');
assert(!state.flags.hasJob, 'second miss: fired');
assert(state.flags.jobSearchUnlocked === false, 'the job search resets');
assert(Math.abs(state.cash - (cashBeforeFired + 128)) < 0.01, 'getting fired pays out the $128 owed, in cash, no fee');
assert(state.flags.pendingWages === 0, 'pending wages cleared after the final payout');
assert(state.flags.nextPayday === undefined, 'payday schedule cleared once the job is gone');
assert(els['narrative-text'].innerHTML.includes('$128.00'), 'warehouse_fired narrates the actual payout, not the already-zeroed pendingWages');
topUp();
loadScenario('pamela_checkin');
assert(els['choices-list'].children.some(b => b.textContent.includes('ready for steady work')), 'Pamela will go to bat a second time');
state.cash = 1200;
assert(checkGameStatus() === 'CONTINUE', '$1200 no longer signs a lease');
state.cash = WIN_CASH_GOAL;
assert(checkGameStatus().startsWith('VICTORY'), '$' + WIN_CASH_GOAL + ' does');
state.cash = 100; state.hasID = false; state.hasCleanClothes = false;

// --- Paycheck lag: pay is weekly and runs a period in arrears ---
{
    // Accrual across several shifts adds no cash
    const day0 = 100;
    state.day = day0; state.flags = { hasJob: true, hasBankAccount: false, bankBalance: 0, nextPayday: day0 + PAY_PERIOD_DAYS, pendingWages: 0 };
    state.cash = 0;
    workShift(128);
    assert(state.cash === 0, 'first shift adds no cash');
    assert(state.flags.pendingWages === 128, 'first shift accrues its gross pay');
    workShift(128);
    assert(state.cash === 0, 'second shift still adds no cash');
    assert(state.flags.pendingWages === 256, 'wages accrue across shifts');

    // Payday, banked: direct deposit, no fee, pays out everything accrued BEFORE today's shift
    state.flags.hasBankAccount = true; state.flags.bankBalance = 0;
    state.day = day0 + PAY_PERIOD_DAYS;
    workShift(128);
    assert(Math.abs(state.flags.bankBalance - 256) < 0.01, 'direct deposit pays out the $256 accrued before today, no fee');
    assert(state.flags.pendingWages === 128, "today's shift starts the next pay period");
    assert(state.flags._paycheck && state.flags._paycheck.banked === true && state.flags._paycheck.fee === 0, 'paycheck record shows a fee-free deposit');
    assert(state.flags.nextPayday === day0 + 2 * PAY_PERIOD_DAYS, 'payday schedule advances by one period');

    // Payday, unbanked: check-cashing counter takes a 3% cut, rounded to cents
    state.flags.hasBankAccount = false; state.flags.bankBalance = 0; state.cash = 0;
    state.day += PAY_PERIOD_DAYS;
    const cashBefore = state.cash;
    workShift(128);
    const expectedFee = Math.round(128 * CHECK_CASHING_FEE_RATE * 100) / 100;
    assert(Math.abs(state.flags._paycheck.fee - expectedFee) < 0.001, 'check-cashing fee is 3% of the check, rounded to cents');
    assert(Math.abs(state.cash - (cashBefore + 128 - expectedFee)) < 0.01, 'net pay after the fee lands in cash');
    assert(state.flags._paycheck.banked === false, 'paycheck record shows the unbanked cash-out');

    // Called out on payday: the check waits and pays out at the next worked shift
    const day1 = state.day + 10;
    state.flags = { hasJob: true, hasBankAccount: true, bankBalance: 0, pendingWages: 90, nextPayday: state.day };
    state.day = day1; // several days pass with no shift worked (called out through payday)
    workShift(128);
    assert(Math.abs(state.flags.bankBalance - 90) < 0.01, 'the delayed check pays out once work resumes');
    assert(state.flags.pendingWages === 128, "the shift that resumes work starts the fresh accrual");
    assert(state.flags.nextPayday > state.day, 'the rolled-forward schedule lands in the future, not stuck in the past');

    // Old save: employed with no pendingWages/nextPayday on record
    state.flags = { hasJob: true };
    delete state.flags.pendingWages;
    delete state.flags.nextPayday;
    let threw = false;
    try { workShift(128); } catch (e) { threw = true; }
    assert(!threw, 'workShift does not throw on a save missing payday fields');
    assert(state.flags.nextPayday === day1 + PAY_PERIOD_DAYS, 'a missing payday defaults to a fresh period starting today');
    assert(state.flags.pendingWages === 128, 'first shift on the old save still accrues correctly');

    delete state.flags.pendingWages;
    delete state.flags.nextPayday;
    threw = false;
    try { renderStats(); } catch (e) { threw = true; }
    assert(!threw, 'renderGear does not throw when payday fields are missing entirely');

    // Gear panel shows the accrued paycheck while employed
    state.flags = { hasJob: true, pendingWages: 42.50, nextPayday: state.day + 3 };
    renderStats();
    assert(els['gear-list'].innerHTML.includes('Paycheck: $42.50 accrued'), 'gear panel shows the accrued paycheck');
    assert(els['gear-list'].innerHTML.includes('payday day ' + (state.day + 3)), 'gear panel shows the payday');
}

// --- Seasons: derived from the day, scaling the drains and the nights ---
state.mode = 'goal'; state.flags = {}; state.timeModifier = 1.0; state.difficultyMultiplier = 1.0;
state.day = 5;
assert(currentSeason() === 'autumn', 'day 5 is autumn');
state.day = 13;
assert(currentSeason() === 'winter', 'day 13 begins winter');
state.day = 48;
assert(currentSeason() === 'summer', 'day 48 is still summer');
state.day = 49;
assert(currentSeason() === 'autumn', 'day 49 cycles back around to autumn');

// Winter: warmth drains half again as fast
state.day = 13; topUp();
applyEffects({ timePassed: 2 });
assert(Math.abs(state.warmth - 91) < 0.01, 'winter warmth drain runs 4.5/hr (100 -> ' + state.warmth.toFixed(1) + ')');

// Summer: warmth barely moves, hygiene drains double (sweat)
state.day = 40; topUp();
applyEffects({ timePassed: 2 });
assert(Math.abs(state.warmth - 98.5) < 0.01, 'summer warmth drain runs 0.75/hr (100 -> ' + state.warmth.toFixed(1) + ')');
assert(Math.abs(state.hygiene - 94) < 0.01, 'summer hygiene drain runs 3/hr (100 -> ' + state.hygiene.toFixed(1) + ')');

// Winter nights outside give back almost nothing
state.day = 14; state.flags = {}; topUp(); state.cash = 0; state.timeHour = 20;
state.warmth = 40;
Math.random = () => 0.9; // quiet night
loadScenario('find_shelter');
clickChoice('underpass');
Math.random = origRandom;
assert(state.warmth === 42, 'winter underpass barely counts as shelter (40 -> 42)');

// Seasonal hazards swap with the calendar
const heatWave = scenarios.find(s => s.id === 'heat_wave');
const coldSnap = scenarios.find(s => s.id === 'cold_snap');
state.day = 40; state.timeHour = 12;
assert(heatWave.condition() && !coldSnap.condition(), 'midsummer midday: heat wave in the pool, cold snap out');
state.day = 14;
assert(!heatWave.condition() && coldSnap.condition(), 'midwinter midday: cold snap in the pool, heat wave out');
state.day = 40;
assert(!scenarios.find(s => s.id === 'public_transit').condition(), 'the freezing subway warm-up sits out the summer');

// The season turn forces a one-time notice, at no time cost
state.flags = {}; topUp(); state.day = 13; state.timeHour = 12;
const hourAtTurn = state.timeHour;
loadScenario();
assert(els['narrative-text'].innerHTML.includes('the cold is the main event'), 'season turn forces the winter notice');
assert(state.flags.seasonNoticedEpoch === 1, 'season notice stamps the epoch');
assert(state.timeHour === hourAtTurn, 'the season turning costs no time');
loadScenario();
assert(!els['narrative-text'].innerHTML.includes('the cold is the main event'), 'notice fires only once per season turn');

// --- The bank: the ID's dividend — banked pay sits out of theft's reach ---
state.mode = 'goal';
state.flags = {}; topUp(); state.day = 5; state.timeHour = 11; state.cash = 200;
state.hasID = false;
loadScenario('idle_time');
assert(!els['choices-list'].children.some(b => b.textContent.includes('Cornerstone')), 'no bank walk without the ID');
state.hasID = true; state.timeHour = 11;
loadScenario('idle_time');
clickChoice('Cornerstone');
clickChoice('Open the free checking');
assert(state.flags.hasBankAccount === true, 'checking account opened');
assert(state.flags.bankBalance === 25, 'opening deposit on the ledger');
assert(Math.abs(state.cash - 175) < 0.01, 'opening deposit left the pocket (cash now $' + state.cash.toFixed(2) + ')');
clickChoice('Back to the teller window');
clickChoice('everything but $20');
assert(Math.abs(state.cash - 20) < 0.01, 'kept $20 walking money');
assert(Math.abs(state.flags.bankBalance - 180) < 0.01, 'deposit landed (balance $' + state.flags.bankBalance.toFixed(2) + ')');

// A thief going through your pockets never touches the account
state.timeHour = 23; state.flags._pendingSleep = 'shelter';
Math.random = () => 0.5; // thief takes 45% of pocket cash
resolveTheft(false);
Math.random = origRandom;
assert(Math.abs(state.flags.bankBalance - 180) < 0.01, 'the thief cannot reach the checking account');
assert(state.cash < 20.01, 'only pocket cash was exposed');

// Corner-store ATM: after-hours access, with the corner-store tax
topUp(); state.timeHour = 11;
loadScenario('convenience_store');
const cashBeforeAtm = state.cash;
clickChoice('ATM by the door');
assert(Math.abs(state.cash - (cashBeforeAtm + 40)) < 0.01, 'ATM handed over $40');
assert(Math.abs(state.flags.bankBalance - 137) < 0.01, 'balance debited $43 with the fee (now $' + state.flags.bankBalance.toFixed(2) + ')');

// Branch withdrawal, no fee
loadScenario('bank_branch');
clickChoice('Withdraw $40');
assert(Math.abs(state.flags.bankBalance - 97) < 0.01, 'branch withdrawal costs face value only');

// The bank is deliberate travel from the paperwork corner, not just a random draw
topUp(); state.timeHour = 11;
loadScenario('hopewell_block');
assert(els['choices-list'].children.some(b => b.textContent.includes('Cornerstone')), 'bank walk offered from the Hopewell block');
state.timeHour = 18;
loadScenario('hopewell_block');
assert(!els['choices-list'].children.some(b => b.textContent.includes('Cornerstone')), 'no bank walk after teller hours');

// shift_done offers the bank even before an account exists — the employed
// player's mornings are eaten by the shift, so the offer must live here
state.flags.hasBankAccount = false; state.flags.bankBalance = 0;
topUp(); state.timeHour = 15;
loadScenario('shift_done');
assert(els['choices-list'].children.some(b => b.textContent.includes('teller window')), 'after-shift bank walk offered without an account');

// The c-store ATM takes deposits — the after-hours answer for late shifts
state.flags.hasBankAccount = true; state.flags.bankBalance = 100;
topUp(); state.timeHour = 19; state.cash = 148;
loadScenario('convenience_store');
clickChoice('Feed your pay');
assert(Math.abs(state.cash - 20) < 0.01, 'ATM deposit kept $20 pocket money');
assert(Math.abs(state.flags.bankBalance - 228) < 0.01, 'ATM deposit is fee-free (balance now $' + state.flags.bankBalance.toFixed(2) + ')');

// The motel takes the card: combined funds gate the room, cash spends first
state.flags.hasBankAccount = true; state.flags.bankBalance = 100;
topUp(); state.timeHour = 20; state.cash = 10; state.day = 5;
loadScenario('rent_room');
const flopBtn = els['choices-list'].children.find(b => b.textContent.includes('Alcove'));
assert(flopBtn && flopBtn.disabled, 'the Alcove is cash-only — bank balance does not unlock the bunk');
clickChoice('room at the budget motel');
assert(Math.abs(state.cash - 0) < 0.01, 'pocket cash spent first');
assert(Math.abs(state.flags.bankBalance - 60) < 0.01, 'card covered the remaining $40 (balance now $' + state.flags.bankBalance.toFixed(2) + ')');
assert(els['narrative-text'].innerHTML.includes('runs your card for $40.00'), 'the card payment is narrated');

// Renewal at the desk runs the card too
state.flags.bankBalance = 200; state.cash = 50; state.flags.motelDaysRemaining = 0;
topUp();
renewMotelWeek();
assert(state.flags.motelDaysRemaining === 6, 'card renewal books six nights');
assert(Math.abs(state.cash - 0) < 0.01 && Math.abs(state.flags.bankBalance - 50) < 0.01, 'renewal split: $50 cash + $150 card');

// Without an account, funds means pocket cash only
state.flags.hasBankAccount = false; state.flags.bankBalance = 500;
topUp(); state.timeHour = 20; state.cash = 10;
loadScenario('rent_room');
const motelBtn = els['choices-list'].children.find(b => b.textContent.includes('room at the budget motel'));
assert(motelBtn && motelBtn.disabled, 'no account, no card — the balance field alone buys nothing');

// The win check counts both sides of the ledger
state.cash = 1000; state.flags.bankBalance = 1400;
state.hasID = true; state.hasCleanClothes = true;
topUp();
assert(checkGameStatus().startsWith('VICTORY'), 'lease money can live in the bank');
state.flags.bankBalance = 500; state.cash = 100;
renderStats();
assert(els['check-cash'].textContent.includes('$600'), 'goal checklist shows pocket and bank combined');

console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
