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
assert(state.health === 100 && state.hunger === 100 && state.mental === 100, 'motel fully restored stats');

// --- Motel option disabled without cash ---
topUp(); state.cash = 10;
loadScenario('find_shelter');
const motelBtn = els['choices-list'].children.find(b => b.textContent.includes('motel'));
assert(motelBtn && motelBtn.disabled, 'motel choice disabled when broke');

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
