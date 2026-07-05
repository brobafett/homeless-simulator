// State
let state = {
    mode: null,
    health: 100,
    mental: 100,
    warmth: 100,
    hunger: 100,
    cash: 0.00,
    timeHour: 8, // Starts at 8:00 AM
    day: 1,
    maxWarmthCapacity: 100,
    timeModifier: 1.0,
    difficultyMultiplier: 1.0,
    hasID: false,
    hasCleanClothes: false,
    flags: {}
};

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
    // 1. Check for Loss
    if (state.health <= 0 || state.hunger <= 0 || (state.warmth <= 0 && state.health < 50) || state.mental <= 0) {
        let reason = "You succumbed to the elements.";
        if (state.hunger <= 0) reason = "Starvation has overtaken you.";
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
    if (state.mode === "endless") {
        state.difficultyMultiplier += 0.08; // Every day gets 8% harder
    }
}

function resolveTheft(confront) {
    let stolenAmount = 0;
    let mentalPenalty = 0;
    let healthPenalty = 0;
    let customMsg = "";

    if (!confront) {
        const stolenPercent = Math.random() * 0.90;
        stolenAmount = state.cash * stolenPercent;
        state.cash -= stolenAmount;
        mentalPenalty = 10;
        customMsg = `<br><br><span style="color: var(--accent-color);">You pretended to sleep. The thief took $${stolenAmount.toFixed(2)}. The helplessness reduces your mental fortitude.</span>`;
    } else {
        if (Math.random() < 0.5) {
            healthPenalty = 20;
            customMsg = `<br><br><span style="color: var(--accent-color);">You fought off the thief and kept your money, but you took a beating in the process.</span>`;
        } else {
            customMsg = `<br><br><span style="color: #4bd863;">You startled the thief and they ran off! Your money is safe.</span>`;
        }
    }

    if (state.timeHour < 8) {
        state.timeHour = 8;
    } else {
        advanceDay();
        state.timeHour = 8;
    }
    
    state.health = Math.max(0, 100 - healthPenalty);
    state.hunger = 100;
    state.mental = Math.max(0, 100 - mentalPenalty);
    state.warmth = state.maxWarmthCapacity;
    
    renderStats();
    
    document.getElementById('narrative-text').innerHTML = `<p>Morning comes.${customMsg}</p>`;
    
    const choicesContainer = document.getElementById('choices-list');
    choicesContainer.innerHTML = `
        <button class="choice-btn" onclick="loadScenario()">Step back outside</button>
    `;
}

function resolveShelter() {
    if (state.timeHour < 8) {
        state.timeHour = 8;
    } else {
        advanceDay();
        state.timeHour = 8;
    }
    
    state.health = 100;
    state.hunger = 100;
    state.mental = 100;
    state.warmth = state.maxWarmthCapacity;
    
    renderStats();
    
    document.getElementById('narrative-text').innerHTML = `<p>You got a warm bed for the night. You wake up feeling fully rested and ready to face a new day.</p>`;
    
    const choicesContainer = document.getElementById('choices-list');
    choicesContainer.innerHTML = `
        <button class="choice-btn" onclick="loadScenario()">Step back outside</button>
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
            { text: "Beg outside the local bakery.", effects: { health: -2, mentalFortitude: -2, warmth: -10, hunger: 10, cash: 2.50 } },
            { text: "Search the dumpster behind the grocery store.", effects: { health: -5, mentalFortitude: -5, warmth: -10, hunger: 30, cash: 0 } },
            { text: "Visit the busy intersection to panhandle.", effects: { health: -2, mentalFortitude: -5, warmth: -15, hunger: -10, cash: 5.00 } },
            { text: "Buy hot soup from a local deli ($3.00)", requires: { cash: 3.00 }, effects: { cash: -3.00, health: 5, mentalFortitude: 15, warmth: 35, hunger: 40 } },
            { text: "Get a cup of hot coffee ($1.00)", requires: { cash: 1.00 }, effects: { cash: -1.00, health: 2, mentalFortitude: 15, warmth: 20, hunger: 5 } }
        ]
    },
    {
        id: 'find_shelter',
        notRandom: false,
        condition: () => state.timeHour >= 17 || state.timeHour <= 5,
        text: "The wind is picking up, and dark clouds are rolling in. It looks like rain, maybe even sleet. You need to find a place to stay dry.",
        choices: [
            { text: "Head to the underpass.", effects: { health: 0, mentalFortitude: -2, warmth: 10, hunger: -10 } },
            { 
                text: "Try to get a bed at the downtown shelter.", 
                customAction: () => {
                    if (Math.random() < 0.03 && state.cash > 0) {
                        loadScenario('shelter_robbery');
                    } else {
                        resolveShelter();
                    }
                }
            },
            { text: "Hunker down in an abandoned building.", effects: { health: -5, mentalFortitude: -5, warmth: 15, hunger: -10 } }
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
            { text: "Rest on a park bench.", effects: { health: 5, mentalFortitude: 15, warmth: -15, hunger: -10 } },
            { text: "Wander and collect cans for recycling.", effects: { health: -5, mentalFortitude: 5, warmth: -10, hunger: -15, cash: 3.50 } },
            { text: "Read a discarded newspaper to stay sharp.", effects: { health: 0, mentalFortitude: 20, warmth: -10, hunger: -10 } },
            { text: "Warm up with a cup of hot soup ($3.00)", requires: { cash: 3.00 }, effects: { cash: -3.00, health: 5, mentalFortitude: 15, warmth: 35, hunger: 30 } },
            { text: "Get a cup of hot coffee ($1.00)", requires: { cash: 1.00 }, effects: { cash: -1.00, health: 2, mentalFortitude: 15, warmth: 20, hunger: 5 } }
        ]
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
        effects: { warmth: 15, mentalFortitude: -5, timePassed: 1 },
        choices: [
            { text: "Keep your head down, mimic reading a heavy book, and try to blend in.", nextScenario: "library_stay_quiet" },
            { text: "Pack your things and leave before they ask you to. It's better than getting banned.", nextScenario: "back_in_rain", effects: { warmth: -20, mentalFortitude: -2 } }
        ]
    },
    {
        id: "backpack_breaks",
        notRandom: false,
        text: "As you hurry across the intersection, the left strap of your overstuffed backpack snaps. Your sleeping bag, a change of clothes, and your plastic folder of vital documents spill onto the wet pavement. You can't carry it all loose.",
        effects: { mentalFortitude: -15, timePassed: 0.5 },
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
                    
                    document.getElementById('narrative-text').innerHTML += msg;
                    const choicesContainer = document.getElementById('choices-list');
                    choicesContainer.innerHTML = `<button class="choice-btn" onclick="loadScenario()">Keep going</button>`;
                } 
            },
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
        text: "The gentle rocking of the train and the blast of the heater offer a temporary escape from the harsh reality of the streets.",
        choices: [ { text: "Exit the station.", nextScenario: null } ]
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
            { text: "Argue that you need help now.", requires: { mentalFortitude: 50 }, nextScenario: 'clinic_argue' },
            { text: "Leave quietly.", effects: { mentalFortitude: -5 }, nextScenario: null }
        ]
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
        text: "You haven't showered in over a week. You stand outside a 24-hour fitness center.",
        effects: { timePassed: 0.1 },
        choices: [
            { text: "Pay $5 for a guest day pass.", requires: { cash: 5.00 }, effects: { cash: -5.00, health: 15, mentalFortitude: 30, warmth: 20, timePassed: 1 }, nextScenario: 'gym_shower' },
            { text: "Try to slip in behind someone.", customAction: () => {
                // Reduced failure rate to 20%
                if (Math.random() < 0.2) {
                    loadScenario('gym_caught');
                } else {
                    applyEffects({ health: 15, mentalFortitude: 30, warmth: 20, timePassed: 1 });
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
        text: "You find a clothing donation bin. The anti-theft chute is jammed open slightly. You might be able to reach your arm in and pull something out.",
        effects: { timePassed: 0.2 },
        choices: [
            { text: "Reach in.", customAction: () => {
                if (Math.random() < 0.3) {
                    loadScenario('coat_stuck');
                } else {
                    applyEffects({ maxWarmthCapacity: 20, warmth: 20 });
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
        text: "You arrive at the local soup kitchen, but the line wraps around the block. It will easily take 3 hours of standing in the cold just to get inside.",
        effects: { timePassed: 0.1 },
        choices: [
            { text: "Wait in line.", effects: { warmth: -20, hunger: 60, health: 10, mentalFortitude: -10, timePassed: 3 }, nextScenario: 'soup_kitchen_eat' },
            { text: "It's too cold to wait. Leave.", nextScenario: null }
        ]
    },
    {
        id: 'soup_kitchen_eat',
        notRandom: true,
        text: "After hours of shivering, you are served a hot bowl of stew, bread, and an apple. It's the best thing you've tasted in days.",
        choices: [ { text: "Leave with a full stomach.", nextScenario: null } ]
    },
    {
        id: 'lost_wallet',
        notRandom: false,
        text: "While walking past a bus stop, you see a leather wallet on the ground. Inside, there is an ID, some credit cards, and $40 in cash.",
        effects: { timePassed: 0.1 },
        choices: [
            { text: "Take the cash and drop the wallet in a mailbox.", effects: { cash: 40.00, mentalFortitude: -15 }, nextScenario: 'wallet_kept' },
            { text: "Walk to the address on the ID to return it.", effects: { timePassed: 1 }, nextScenario: 'wallet_returned' }
        ]
    },
    {
        id: 'wallet_kept',
        notRandom: true,
        text: "You pocket the $40. You needed it more than they did, you tell yourself. Still, a pang of guilt gnaws at you.",
        choices: [ { text: "Keep walking.", nextScenario: null } ]
    },
    {
        id: 'wallet_returned',
        notRandom: true,
        text: "You knock on the door and return the wallet. The owner is shocked and overwhelmingly grateful. They insist on giving you a $20 reward and a warm cup of coffee.",
        effects: { cash: 20.00, warmth: 15, mentalFortitude: 30 },
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
        text: "You use a public computer for 30 minutes. You learn that a replacement ID requires a birth certificate, which costs $25 to order, and takes 4 weeks to arrive by mail. You also need a mailing address. It feels impossible.",
        effects: { mentalFortitude: -15, timePassed: 1 },
        choices: [ { text: "Log off and go back outside.", nextScenario: null } ]
    },
    {
        id: "library_stay_quiet",
        notRandom: true,
        text: "You stare at the book. The guard eventually walks away, but you spend the next two hours on edge, unable to actually read or relax.",
        effects: { timePassed: 2, mentalFortitude: -5 },
        choices: [ { text: "Eventually leave the library.", nextScenario: null } ]
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
    if (effects.cash !== undefined) state.cash += effects.cash;
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
        const hungerDrain = 3 * state.difficultyMultiplier;
        
        state.warmth -= warmupDrain * timePassed;
        state.hunger -= hungerDrain * timePassed;
        
        state.timeHour += timePassed;
        while (state.timeHour >= 24) {
            state.timeHour -= 24;
            advanceDay();
        }
    }

    state.health = Math.max(0, Math.min(100, state.health));
    state.mental = Math.max(0, Math.min(100, state.mental));
    state.warmth = Math.max(0, Math.min(state.maxWarmthCapacity, state.warmth));
    state.hunger = Math.max(0, Math.min(100, state.hunger));
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
    // Check if dead before loading new scenario
    if (state.health <= 0 || state.hunger <= 0 || (state.warmth <= 0 && state.health < 50) || state.mental <= 0) {
        renderStats(); 
        return; 
    }
    
    let scenario;
    if (id) {
        scenario = scenarios.find(s => s.id === id);
    } else {
        const randomPool = scenarios.filter(s => {
            if (s.notRandom) return false;
            if (s.condition && !s.condition()) return false;
            return true;
        });
        scenario = randomPool[Math.floor(Math.random() * randomPool.length)];
    }
    
    if (!scenario) {
        scenario = scenarios.find(s => s.id === 'find_meal'); // fallback
    }

    if (scenario.effects) {
        applyEffects(scenario.effects);
        // Check if dead due to entry effects of the new scenario
        if (state.health <= 0 || state.hunger <= 0 || (state.warmth <= 0 && state.health < 50) || state.mental <= 0) {
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
            
            let reqMet = true;
            let reqMsg = "";
            if (choice.requires) {
                if (choice.requires.cash !== undefined && state.cash < choice.requires.cash) { reqMet = false; reqMsg = `(Requires $${choice.requires.cash.toFixed(2)})`; }
                if (choice.requires.mentalFortitude !== undefined && state.mental < choice.requires.mentalFortitude) { reqMet = false; reqMsg = `(Requires ${choice.requires.mentalFortitude}% Mental Fortitude)`; }
            }
            
            if (reqMet) {
                btn.textContent = choice.text;
                btn.onclick = () => makeChoice(choice);
            } else {
                btn.textContent = `${choice.text} ${reqMsg}`;
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

function renderStats() {
    updateElement('stat-health', `${Math.floor(state.health)}%`, state.health <= 30);
    updateElement('stat-mental', `${Math.floor(state.mental)}%`, state.mental <= 30);
    updateElement('stat-warmth', `${Math.floor(state.warmth)}%`, state.warmth <= 30);
    updateElement('stat-hunger', `${Math.floor(state.hunger)}%`, state.hunger <= 30);
    
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
    
    checkGameOver();
}

function checkGameOver() {
    const status = checkGameStatus();
    
    if (status.startsWith("GAME OVER")) {
        endGame(status.replace("GAME OVER: ", ""));
    } else if (status.startsWith("VICTORY")) {
        document.getElementById('narrative-text').innerHTML = `<p style="color: #4bd863; font-weight: bold;">VICTORY</p><p>${status.replace("VICTORY: ", "")}</p>`;
        document.getElementById('choices-list').innerHTML = `
            <button class="choice-btn" onclick="location.reload()">Play Again</button>
        `;
    }
}

function endGame(message) {
    document.getElementById('narrative-text').innerHTML = `<p style="color: var(--accent-color); font-weight: bold;">GAME OVER</p><p>${message}</p>`;
    document.getElementById('choices-list').innerHTML = `
        <button class="choice-btn" onclick="location.reload()">Try Again</button>
    `;
}

// Initial game state is paused until startGame is called.
