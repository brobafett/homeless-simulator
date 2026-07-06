// Smoke test: drive game.js through the full Goal Mode win path using a stubbed DOM.
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

eval(fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8')
    + '\n;global.G = { state };');
const state = global.G.state;

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

// 6. Victory once cash >= 1200
topUp();
state.cash = 1200;
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
Math.random = () => 0.9; // dodge the 20% flophouse robbery roll
loadScenario('rent_room');
clickChoice('flophouse');
Math.random = origRandom;
assert(Math.abs(state.cash - 12) < 0.01, 'flophouse cost $18 (cash now $' + state.cash.toFixed(2) + ')');
assert(state.hygiene === 70 && state.mental === 80, 'flophouse gives a rougher night than the motel');
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
assert(Math.abs(state.hunger - 87) < 0.01, 'hunger drain resumes once the coffee runs out (only 1 of 2 hours covered)');

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
state.flags = { backpackBroken: true }; topUp(); state.cash = 20; state.foodStash = 0;
loadScenario('find_meal');
clickChoice('to-go');
assert(state.foodStash === 1, 'bought a packed meal');
loadScenario('find_meal');
const togoBtn = els['choices-list'].children.find(b => b.textContent.includes('to-go'));
assert(togoBtn && togoBtn.disabled && togoBtn.textContent.includes('No room'), 'plastic grocery bag holds only one meal');
state.flags = { hasSturdyBackpack: true };
loadScenario('find_meal');
const togoBtn2 = els['choices-list'].children.find(b => b.textContent.includes('to-go'));
assert(togoBtn2 && !togoBtn2.disabled, 'heavy-duty pack has room for more');
state.hunger = 40;
loadScenario('find_meal');
clickChoice('Eat a packed meal');
assert(state.foodStash === 0 && state.hunger > 60, 'ate from the stash (hunger now ' + Math.floor(state.hunger) + ')');

// --- Boots make the labor office a guaranteed daily stop ---
state.flags = { hasWorkBoots: true, hasNewShoes: true }; topUp(); state.cash = 0;
state.timeHour = 7;
loadScenario();
assert(els['narrative-text'].innerHTML.includes('day labor office'), 'morning forces the labor office when you own boots');
assert(state.flags.lastLaborDay === state.day, 'labor office visit recorded for today');
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
state.flags = { hasWorkBoots: true };
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
assert(state.flags.hasWorkBoots === true && state.flags.hasNewShoes === true, 'buying boots sets footwear flags');
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
assert(state.hygiene === 100, 'shelter stay restored hygiene');

// --- Backpack: breaking once stops repeats until replaced ---
state.flags = {}; topUp();
loadScenario('backpack_breaks');
assert(state.flags.backpackBroken === true, 'backpack break sets the broken flag');
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
assert(state.flags.backpackBroken === false, 'found backpack clears the broken flag');

// --- Surplus store: used pack gated to broken, new pack ends breaks forever ---
state.flags = {}; topUp(); state.cash = 100;
loadScenario('surplus_store');
const usedBtn = els['choices-list'].children.find(b => b.textContent.includes('used backpack'));
assert(usedBtn && usedBtn.disabled && usedBtn.textContent.includes('holding together'), 'used backpack disabled while current pack works');
clickChoice('heavy-duty');
assert(state.flags.hasSturdyBackpack === true, 'new backpack sets sturdy flag');
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

console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
