// Holy Grail: every segment outside the first Fisher Realm visit (that one is
// quest-holy-grail-realm.ts), each measured from standing next to its NPC or
// loc. Travel between segments is done with ::tele and costed separately in
// docs/speedrun/quests/holy_grail.md.
//
//   bun docs/speedrun/scripts/quest-holy-grail-segments.ts <bot> [segment...]
//
// Segments, in quest order: start (King Arthur), merlin (workshop door and
// Merlin), boatout (Port Sarim monk to Entrana, gangplank included), priest
// (High Priest; the crone spawns and talks in the same dialogue), boatback
// (Entrana monk to Port Sarim, gangplank included), galahad (holy table
// napkin), whistles (Draynor Manor door and the two whistles it spawns),
// percival (goblin village sacks), realm2 (healed realm: whistle in, castle,
// two staircases, take the Grail, whistle out), reward (King Arthur).

import { runScript } from '../../../sdk/runner';
import * as L from './quest-arthur-lab';

const all = ['start', 'merlin', 'boatout', 'priest', 'boatback', 'galahad', 'whistles', 'percival', 'realm2', 'reward'];
const picked = process.argv.slice(3).filter(a => !a.startsWith('-'));
const segments = picked.length ? picked : all;

const dlg = (d: L.DialogueResult) => ({ ticks: d.ticks, pages: d.pages, options: d.options, clicks: d.pages + d.options });

await runScript(async ({ bot, sdk }) => {
    await bot.dismissBlockingUI();
    const results: Record<string, unknown> = {};
    process.on('exit', () => { if (!results.done) L.report('Holy Grail segments (partial)', results); });

    const stripGear = async () => {
        for (const e of sdk.getEquipment()) await bot.unequipItem(e.name);
        await sdk.waitForTicks(1);
        for (const item of sdk.getInventory()) await sdk.sendDropItem(item.slot);
        await sdk.waitForTicks(2);
    };
    const ensure = async (name: string, count = 1) => {
        if (sdk.countInventoryItems(new RegExp(`^${name.replace(/_/g, ' ')}$`, 'i')) < count) {
            await L.cheat(sdk, `give ${name} ${count}`, 2);
        }
    };
    const talk = async (npc: RegExp, choices: RegExp[]) => {
        await L.waitUntil(sdk, () => sdk.findNearbyNpc(npc) !== null, 20);
        const t0 = L.tick(sdk);
        const r = await bot.talkTo(npc);
        if (!r.success) throw new Error(`talk ${npc}: ${r.message}`);
        const d = await L.talkThrough(sdk, choices);
        return { ...dlg(d), total: L.tick(sdk) - t0 - 3 };
    };
    const climb = async (op: 'Climb-up' | 'Climb-down', toLevel: number) => {
        const t0 = L.tick(sdk);
        const loc = (await sdk.scanNearbyLocs(20))
            .filter(l => l.options.includes(op))
            .sort((a, b) => a.distance - b.distance)[0];
        if (!loc) throw new Error(`no ${op} loc near ${JSON.stringify(L.pos(sdk))}`);
        await bot.interactLoc(loc, op);
        await L.waitUntil(sdk, () => L.pos(sdk).level === toLevel, 60);
        return { ticks: L.tick(sdk) - t0, via: `${loc.name}@${loc.x},${loc.z}` };
    };
    // The monk's dialogue closes during the voyage (set_sail's p_delay), so
    // arrival is detected by position: on the destination ship's deck (level 1).
    const sail = async (monk: RegExp, choices: RegExp[], landed: () => boolean) => {
        const t0 = L.tick(sdk);
        const r = await bot.talkTo(monk);
        if (!r.success) throw new Error(`talk ${monk}: ${r.message}`);
        const d = await L.talkThrough(sdk, choices, { maxTicks: 60, settleTicks: 2 });
        await L.waitUntil(sdk, () => L.pos(sdk).level === 1 && landed(), 60);
        const onDeck = L.tick(sdk) - t0;
        const arrival = await L.talkThrough(sdk, [], { settleTicks: 1 }); // "The ship arrives at ..."
        d.pages += arrival.pages;
        const t1 = L.tick(sdk);
        const plank = (await sdk.scanNearbyLocs(10)).find(l => l.options.includes('Cross'));
        if (!plank) throw new Error(`no gangplank near ${JSON.stringify(L.pos(sdk))}`);
        await bot.interactLoc(plank, 'Cross');
        await L.waitUntil(sdk, () => L.pos(sdk).level === 0 && landed(), 30);
        return { ...dlg(d), clickToDeck: onDeck, gangplank: L.tick(sdk) - t1, total: L.tick(sdk) - t0, at: L.pos(sdk) };
    };

    for (const seg of segments) {
        if (seg === 'start') {
            await L.cheat(sdk, 'setvar arthur 7');
            await L.cheat(sdk, 'setvar grail 0');
            await L.tele(sdk, 2764, 3513, 0);
            results.start = { ...(await talk(/King Arthur/, [/Tell me of this quest/, /I'd enjoy trying that/])), grail: await L.getVar(sdk, 'grail') };
        } else if (seg === 'merlin') {
            await L.cheat(sdk, 'setvar grail 2');
            await L.tele(sdk, 2764, 3504, 1); // outside the workshop door 1_43_54_12_47
            const t0 = L.tick(sdk);
            const door = (await sdk.scanNearbyLocs(5)).find(l => l.x === 2764 && l.z === 3503 && l.options.includes('Open'));
            if (!door) throw new Error('workshop door not found');
            await bot.interactLoc(door, 'Open'); // spawns Merlin inside (quest_grail.rs2:9)
            const doorTicks = L.tick(sdk) - t0;
            const merlin = await talk(/Merlin/, [/Thank you for the advice/]);
            results.merlin = { doorTicks, merlin, grail: await L.getVar(sdk, 'grail') };
        } else if (seg === 'boatout') {
            await stripGear();
            await L.tele(sdk, 3046, 3236, 0);
            results.boatout = await sail(/Monk of Entrana/, [/I'm ready to go/], () => L.pos(sdk).x < 2900);
        } else if (seg === 'priest') {
            await L.cheat(sdk, 'setvar grail 3');
            await L.tele(sdk, 2851, 3347, 0);
            results.priest = { ...(await talk(/High Priest/, [/Ok, I will go searching/])), grail: await L.getVar(sdk, 'grail') };
        } else if (seg === 'boatback') {
            await L.tele(sdk, 2834, 3335, 0);
            results.boatback = await sail(/Monk of Entrana/, [/I'm ready to go/], () => L.pos(sdk).x > 3000);
        } else if (seg === 'galahad') {
            await L.cheat(sdk, 'setvar grail 4');
            for (const it of sdk.getInventory().filter(i => /napkin/i.test(i.name))) await sdk.sendDropItem(it.slot);
            await L.tele(sdk, 2612, 3476, 0);
            results.galahad = { ...(await talk(/^Galahad$/, [/I seek an item from the realm/])), napkin: sdk.countInventoryItems(/napkin/i) };
        } else if (seg === 'whistles') {
            await ensure('holy_table_napkin');
            for (const it of sdk.getInventory().filter(i => /Magic whistle/i.test(i.name))) await sdk.sendDropItem(it.slot);
            await sdk.waitForTicks(2);
            await L.tele(sdk, 3105, 3364, 2); // where the manor staircase lands
            const t0 = L.tick(sdk);
            const door = (await sdk.scanNearbyLocs(5)).find(l => l.x === 3106 && l.z === 3361 && l.options.includes('Open'));
            if (!door) throw new Error('whistle door not found');
            await bot.interactLoc(door, 'Open');
            await L.waitUntil(sdk, () => sdk.findGroundItem(/Magic whistle/i) !== null, 10);
            const doorTicks = L.tick(sdk) - t0;
            for (let i = 0; i < 2; i++) {
                const w = sdk.findGroundItem(/Magic whistle/i);
                if (w) await bot.pickupItem(w);
                await L.waitUntil(sdk, () => sdk.countInventoryItems(/Magic whistle/i) > i, 15);
            }
            results.whistles = { doorTicks, total: L.tick(sdk) - t0, whistles: sdk.countInventoryItems(/Magic whistle/i) };
        } else if (seg === 'percival') {
            await L.cheat(sdk, 'setvar grail 8');
            await ensure('magic_whistle', 2);
            await L.tele(sdk, 2959, 3506, 0);
            const sacks = (await sdk.scanNearbyLocs(5)).find(l => l.x === 2960 && l.z === 3507);
            const t0 = L.tick(sdk);
            await bot.interactLoc(sacks!, 'Open');
            const d = await L.talkThrough(sdk, [/Your father wishes to speak to you/]);
            results.percival = { ...dlg(d), total: L.tick(sdk) - t0 - 3, grail: await L.getVar(sdk, 'grail'), whistlesLeft: sdk.countInventoryItems(/Magic whistle/i) };
        } else if (seg === 'realm2') {
            await L.cheat(sdk, 'setvar grail 9');
            await ensure('magic_whistle');
            for (const it of sdk.getInventory().filter(i => /Holy grail/i.test(i.name))) await sdk.sendDropItem(it.slot);
            await L.tele(sdk, 2741, 3235, 0);
            await sdk.waitForTicks(2);
            const r: Record<string, unknown> = {};
            let t0 = L.tick(sdk);
            await sdk.sendUseItem(sdk.findInventoryItem(/Magic whistle/i)!.slot, 1);
            const arrived = await L.waitUntil(sdk, () => L.pos(sdk).z > 4600, 30);
            r.whistleIn = arrived === null ? null : arrived - t0;
            r.arrivedAt = L.pos(sdk);
            await sdk.waitForTicks(1);
            r.walkToStairs = await L.timedWalk(sdk, bot, 2648, 4684, 1);
            r.stairs1 = await climb('Climb-up', 1);
            await sdk.waitForTicks(1);
            r.at1 = L.pos(sdk);
            r.stairs2 = await climb('Climb-up', 2);
            await sdk.waitForTicks(1);
            r.at2 = L.pos(sdk);
            t0 = L.tick(sdk);
            const grail = sdk.findGroundItem(/Holy grail/i);
            if (!grail) throw new Error(`no Holy Grail visible at ${JSON.stringify(L.pos(sdk))}`);
            await bot.pickupItem(grail);
            await L.waitUntil(sdk, () => sdk.countInventoryItems(/Holy grail/i) > 0, 30);
            r.takeGrail = L.tick(sdk) - t0;
            t0 = L.tick(sdk);
            await sdk.sendUseItem(sdk.findInventoryItem(/Magic whistle/i)!.slot, 1);
            const back = await L.waitUntil(sdk, () => L.pos(sdk).z < 4000, 30);
            r.whistleOut = back === null ? null : back - t0;
            results.realm2 = r;
        } else if (seg === 'reward') {
            await L.cheat(sdk, 'setvar grail 9');
            await ensure('holy_grail');
            await L.tele(sdk, 2764, 3513, 0);
            const arthur = await talk(/King Arthur/, []);
            await sdk.waitForTicks(3);
            results.reward = { arthur, grail: await L.getVar(sdk, 'grail') };
        }
        console.log(seg, JSON.stringify(results[seg]));
    }
    results.done = true;
    L.report('Holy Grail segments', results);
}, { timeout: 900_000, printState: false });
