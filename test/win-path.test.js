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

// 4. DMV -> ID
topUp();
loadScenario('dmv_visit');
clickChoice('pay for the ID');
assert(state.hasID === true, 'state ID obtained');

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

// --- Motel room: costs $45, safe night, wakes at 8 AM next day ---
const dayBefore = state.day;
clickChoice('motel');
assert(Math.abs(state.cash - 55) < 0.01, 'motel cost $45 (cash now $' + state.cash.toFixed(2) + ')');
assert(state.day === dayBefore + 1 && state.timeHour === 8, 'woke at 8 AM the next day');
assert(state.health === 100 && state.hunger === 100 && state.mental === 100 && state.hygiene === 100, 'motel fully restored stats including hygiene');

// --- Motel option disabled without cash ---
topUp(); state.cash = 10;
loadScenario('find_shelter');
const motelBtn = els['choices-list'].children.find(b => b.textContent.includes('motel'));
assert(motelBtn && motelBtn.disabled, 'motel choice disabled when broke');

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
clickChoice('Take it');
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

console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
