// Plague City: every segment, measured on a local server with the stock lite
// client. Each segment jumps the account to its stage with ::setvar elenaquest
// and ::tele, gives the items a helper would trade, then plays the real route,
// including the short walks between its steps.
//
//   bun docs/speedrun/scripts/quest-plague-city-segments.ts <bot> [segment...]
//
// Segments, in quest order:
//   start  Edmond (0->1), the picture, Alrena with dwellberries (1->2), Edmond (2->3)
//   cure   chocolate dust into milk, snape grass into chocolaty milk (hangover cure)
//   mud    four buckets of water on the mud patch (3->7), dig with the spade (7->8)
//   sewer  rope on the pipe (8->9), Edmond in the sewer (9->10), wear the gas mask, the pipe
//   west   Jethick (10->20), the Rehnisons (20->21->22), Milli (22->23), the plague
//          house door (23->24), the clerk (24->25)
//   bravek Bravek's door, Bravek twice (25->26->27)
//   rescue the warrant at the plague house door, the barrel key, the basement, Elena (27->28)
//   exit   back out through the manhole and the sewer, Edmond (28->29), read the scroll (29->30)
// With no segment names every segment runs. Run quest-primitives-setup.ts first.

import { runScript } from '../../../sdk/runner';
import * as L from './quest-arthur-lab';
import { Steps, atLevel, dropAll, ensure, has, near, opLoc, talk, useOnItem, useOnLoc, varp } from './quest-plague-city-lab';

const all = ['start', 'cure', 'mud', 'sewer', 'west', 'bravek', 'rescue', 'exit'];
const picked = process.argv.slice(3).filter(a => !a.startsWith('-'));
const segments = picked.length ? picked : all;

// Loc ids from server/content/pack/loc.pack; tiles from server/content/maps.
const LOC = {
    mudPatch: [2566, 3332, 2532],
    mudPile: [2561, 9738, 2533],
    pipe: [2530, 9701, 2541],
    manholeClosed: [2529, 3303, 2543],
    manholeOpen: [2529, 3303, 2544],
    rehnisonDoor: [2531, 3328, 2537],
    rehnisonStairs: [2527, 3332, 2539],
    plagueDoor: [2533, 3272, 2535],
    barrel: [2534, 3268, 2530],
    stairsDown: [2536, 3268, 2522],
    stairsUp: [2536, 9671, 2523],
    elenaDoor: [2539, 9672, 2526],
    bravekDoor: [2530, 3314, 2528],
} as const;

await runScript(async ({ bot, sdk }) => {
    await bot.dismissBlockingUI();
    const S = new Steps(sdk);
    const varps: Record<string, unknown> = {};
    const setStage = (v: number) => L.cheat(sdk, `setvar elenaquest ${v}`);
    const quest = async (label: string) => {
        varps[label] = await varp(sdk, 'elenaquest');
        console.log(`  elenaquest after ${label}: ${varps[label]}`);
    };
    const loc = (k: keyof typeof LOC, op = 1) => opLoc(sdk, LOC[k][0], LOC[k][1], LOC[k][2], op);
    const useOn = (item: RegExp, k: keyof typeof LOC) => useOnLoc(sdk, item, LOC[k][0], LOC[k][1], LOC[k][2]);
    // Unequip and drop quest items left from earlier runs so each segment starts clean.
    await dropAll(sdk, /^(Picture|Book|Warrant|A small key|A scruffy note|Hangover cure|Dwellberries|Bucket|Bucket of water|Rope|Spade|Chocolaty milk|A magic scroll)$/i);

    for (const seg of segments) {
        console.log(`\n-- ${seg}`);
        if (seg === 'start') {
            await L.cheat(sdk, 'setvar biohazard 0');
            await setStage(0);
            await dropAll(sdk, /^Gas mask$/i);
            await L.tele(sdk, 2568, 3332);
            await S.step('Edmond: start (0->1)', talk(sdk, /^Edmond$/), { choices: [/What's happened to her/, /Can I help find her/] });
            await quest('edmond1');
            await ensure(sdk, 'dwellberries', /^Dwellberries$/i);
            const pic = (await sdk.scanGroundItems(12)).find(g => /^Picture$/i.test(g.name));
            // bot.pickupItem walks next to the item (sendPickup alone does not route) and opens doors on the way.
            if (pic) await S.step('pick up the picture (2576,3334)', () => bot.pickupItem(pic), { done: has(sdk, /^Picture$/i), settle: 0 });
            else console.log('  picture not on the ground (already taken?)');
            await S.step('Alrena: dwellberries -> gas mask (1->2)', talk(sdk, /^Alrena$/), { settle: 6, done: has(sdk, /^Gas mask$/i) });
            await quest('alrena');
            await S.step('Edmond: gas mask (2->3)', talk(sdk, /^Edmond$/));
            await quest('edmond2');
        } else if (seg === 'cure') {
            await dropAll(sdk, /^(Chocolate dust|Bucket of milk|Snape grass|Chocolaty milk|Hangover cure)$/i);
            await ensure(sdk, 'chocolate_dust', /^Chocolate dust$/i);
            await ensure(sdk, 'bucket_milk', /^Bucket of milk$/i);
            await ensure(sdk, 'snape_grass', /^Snape grass$/i);
            await S.step('chocolate dust on milk', useOnItem(sdk, /^Chocolate dust$/i, /^Bucket of milk$/i), { done: has(sdk, /^Chocolaty milk$/i) });
            await S.step('snape grass on chocolaty milk', useOnItem(sdk, /^Snape grass$/i, /^Chocolaty milk$/i), { done: has(sdk, /^Hangover cure$/i) });
        } else if (seg === 'mud') {
            await setStage(3);
            await ensure(sdk, 'bucket_water', /^Bucket of water$/i, 4);
            await ensure(sdk, 'spade', /^Spade$/i);
            await L.tele(sdk, 2567, 3332);
            for (let i = 1; i <= 4; i++) await S.step(`bucket of water on the mud patch #${i}`, useOn(/^Bucket of water$/i, 'mudPatch'));
            await quest('buckets');
            await S.step('dig the mud patch: fall into the sewer (7->8)', useOn(/^Spade$/i, 'mudPatch'), { done: () => L.pos(sdk).z > 9000 });
            varps.landed = L.pos(sdk);
            await quest('dig');
        } else if (seg === 'sewer') {
            await setStage(8);
            await ensure(sdk, 'rope', /^Rope$/i);
            await ensure(sdk, 'gasmask', /^Gas mask$/i);
            if (L.pos(sdk).z < 9000) await L.tele(sdk, 2561, 9737);
            await S.walk('mud pile -> pipe', 2530, 9702);
            await S.step('rope on the pipe grill (8->9)', useOn(/^Rope$/i, 'pipe'));
            await quest('rope');
            await S.walk('pipe -> Edmond', 2535, 9718);
            await S.step('Edmond in the sewer: pull the grill (9->10)', talk(sdk, /^Edmond$/));
            await quest('edmondSewer');
            await S.walk('Edmond -> pipe', 2530, 9702);
            console.log('  inventory before wearing:', sdk.getInventory().map(i => i.name).join(', '));
            await S.step('wear the gas mask', async () => {
                const mask = sdk.findInventoryItem(/^Gas mask$/i);
                const r = mask ? await sdk.sendUseItem(mask.slot, 2) : { success: false, message: 'no mask' };
                console.log('  wear:', JSON.stringify(r));
            }, { done: () => sdk.getEquipment().some(e => /^Gas mask$/i.test(e.name)), settle: 0, maxTicks: 20 });
            console.log('  equipment:', sdk.getEquipment().map(i => i.name).join(', '));
            await S.step('climb through the pipe to West Ardougne', loc('pipe'), { done: () => L.pos(sdk).z < 9000 });
            varps.westArrival = L.pos(sdk);
        } else if (seg === 'west') {
            await setStage(10);
            await ensure(sdk, 'elena_picture', /^Picture$/i);
            const p = L.pos(sdk);
            if (p.level !== 0 || p.x !== 2529 || p.z !== 3304) await L.tele(sdk, 2529, 3304);
            await S.walk('manhole -> Jethick', 2539, 3305);
            await S.step('Jethick: picture -> book (10->20)', talk(sdk, /^Jethick$/), { choices: [/looking for a woman from East Ardougne/] });
            await quest('jethick');
            await S.walk('Jethick -> Rehnison door', 2531, 3327);
            await S.step('Rehnison door: return the book (20->21)', loc('rehnisonDoor'), { done: () => L.pos(sdk).z >= 3329 });
            await quest('rehnisonDoor');
            await S.step('Ted Rehnison (21->22)', talk(sdk, /^Ted Rehnison$/));
            await quest('ted');
            await S.step('Rehnison stairs up', loc('rehnisonStairs'), { done: atLevel(sdk, 1), settle: 0 });
            await S.step('Milli (22->23)', talk(sdk, /^Milli/));
            await quest('milli');
            const top = (await sdk.scanNearbyLocs(6)).find(l => /stair/i.test(l.name));
            if (!top) throw new Error('Rehnison stairs top not found');
            await S.step('Rehnison stairs down', () => sdk.sendInteractLoc(top.x, top.z, top.id, 1), { done: atLevel(sdk, 0), settle: 0 });
            await S.step('Rehnison door (out)', loc('rehnisonDoor'), { done: () => L.pos(sdk).z <= 3328, settle: 0 });
            await S.walk('Rehnison door -> plague house door', 2533, 3273);
            await S.step('plague house door: the mourner (23->24)', loc('plagueDoor'), { choices: [/I fear not a mere plague/] });
            await quest('plagueDoor');
            // A run click from the door tile right after the mourner's dialogue does not move the bot; bot.walkTo does.
            // Stand east of the clerk: the stage only advances if Bravek (2536,3314) is within 7 tiles
            // of the player (clerk.rs2 .npc_find(coord, bravek, 7, 0)); from x=2528 he is 8 away.
            await S.longWalk(bot, 'plague house -> clerk (bot.walkTo)', 2529, 3316);
            const bravekNpc = sdk.findNearbyNpc(/^Bravek$/);
            console.log(`  before clerk: player ${JSON.stringify(L.pos(sdk))}, Bravek ${bravekNpc ? `${bravekNpc.x},${bravekNpc.z}` : 'not seen'}`);
            await S.step('clerk (24->25)', talk(sdk, /^Clerk$/), { choices: [/I need permission to enter a plague house/, /This is urgent though/] });
            await quest('clerk');
        } else if (seg === 'clerk') {
            await setStage(24);
            await L.tele(sdk, 2529, 3316);
            await sdk.waitForTicks(2);
            // The stage only advances if Bravek is within 7 tiles of the player when the clerk's
            // last page runs (clerk.rs2 .npc_find(coord, bravek, 7, 0)). Bravek wanders around
            // (2536,3314) and the player cannot stand east of x=2529, so measure the hit rate.
            const tries = Number(process.env.CLERK_TRIES ?? 8);
            const where = () => { const b = sdk.findNearbyNpc(/^Bravek$/); return b ? `${b.x},${b.z}` : 'not seen'; };
            for (let i = 1; i <= tries; i++) {
                await setStage(24);
                const before = where();
                await S.step(`clerk try ${i} (24->25)`, talk(sdk, /^Clerk$/), { choices: [/I need permission to enter a plague house/, /This is urgent though/] });
                const v = await varp(sdk, 'elenaquest');
                console.log(`  clerk try ${i}: Bravek ${before} -> ${where()}, stage ${v}`);
                varps[`clerk${i}`] = { before, after: where(), stage: v };
            }
        } else if (seg === 'bravek') {
            await setStage(25);
            await ensure(sdk, 'hangover_cure', /^Hangover cure$/i);
            if (Math.abs(L.pos(sdk).x - 2528) > 3 || Math.abs(L.pos(sdk).z - 3316) > 3) await L.tele(sdk, 2528, 3316);
            await S.step('Bravek door', loc('bravekDoor'), { done: () => L.pos(sdk).x >= 2530, settle: 0 });
            await S.walk('door -> Bravek', 2535, 3314);
            await S.step('Bravek: the note (25->26)', talk(sdk, /^Bravek$/), { choices: [/This is really important though/, /Do you know what is in the cure/] });
            await quest('bravek1');
            await S.step('Bravek: hangover cure -> warrant (26->27)', talk(sdk, /^Bravek$/), { choices: [/They won't listen to me/] });
            await quest('bravek2');
        } else if (seg === 'rescue') {
            await setStage(27);
            await ensure(sdk, 'warrant', /^Warrant$/i);
            await dropAll(sdk, /^A small key$/i);
            await L.tele(sdk, 2533, 3273);
            await S.step('plague house door with the warrant', loc('plagueDoor'), { done: () => L.pos(sdk).z <= 3271 });
            await S.walk('door -> barrel', 2534, 3269);
            await S.step('search the barrel: key', loc('barrel'), { done: has(sdk, /^A small key$/i) });
            await S.step('stairs down to the basement', loc('stairsDown'), { done: () => L.pos(sdk).z > 9000, settle: 0 });
            await S.walk('basement -> Elena door', 2539, 9672);
            await S.step('unlock the Elena door', loc('elenaDoor'), { done: () => L.pos(sdk).x >= 2540 });
            await S.step('Elena (27->28)', talk(sdk, /^Elena$/));
            await quest('elena');
        } else if (seg === 'exit') {
            await setStage(28);
            if (L.pos(sdk).z < 9000) await L.tele(sdk, 2540, 9672);
            await S.step('Elena door, back out', loc('elenaDoor'), { done: () => L.pos(sdk).x <= 2539, settle: 0 });
            await S.step('basement stairs up', loc('stairsUp'), { done: () => L.pos(sdk).z < 9000, settle: 0 });
            await S.step('plague house door, out', loc('plagueDoor'), { done: () => L.pos(sdk).z >= 3272, settle: 0 });
            await S.walk('plague house -> manhole', 2529, 3304);
            await S.step('open the manhole', loc('manholeClosed'), { done: () => sdk.getState()!.nearbyLocs.some(l => l.x === 2529 && l.z === 3303 && l.id === 2544), settle: 0 });
            await S.step('climb down the manhole', loc('manholeOpen'), { done: () => L.pos(sdk).z > 9000, settle: 0 });
            await S.walk('sewer -> mud pile', 2561, 9737);
            await S.step('climb the mud pile', loc('mudPile'), { done: () => L.pos(sdk).z < 9000, settle: 0 });
            await S.walk('garden -> Edmond', 2567, 3333);
            await S.step('Edmond: reward (28->29)', talk(sdk, /^Edmond$/), { settle: 4, done: has(sdk, /^A magic scroll$/i) });
            await sdk.waitForTicks(2);
            const modal = sdk.getState()!.modalOpen;
            if (modal) await S.step('close the quest-complete scroll', () => sdk.sendCloseModal(), { done: () => !sdk.getState()!.modalOpen, settle: 0 });
            await quest('edmondReward');
            await S.step('read the magic scroll (29->30)', async () => { await sdk.sendUseItem(sdk.findInventoryItem(/^A magic scroll$/i)!.slot, 1); });
            await quest('scroll');
        }
    }
    S.print('Plague City segments');
    L.report('varps and positions', varps);
}, { timeout: 1_800_000, printState: false });
