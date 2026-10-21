// Monkey Madness, Ape Atoll segments measured one at a time on the lab server
// (docs/speedrun/quests/monkey_madness.md). Each segment sets the quest state it
// needs with ::setvar, gives its items and teleports to its start, so they can
// be timed independently and in any order.
// Run: bun docs/speedrun/scripts/quest-mm-atoll.ts <botname> <segments, e.g. HTC>
//   H  town: denture crate, crate over the hole, drop to the cellar, mould crate,
//      one banana crate, climb the eastern-warehouse rope back up.
//   T  temple: trapdoor down, smith the enchanted bar at the fire, string the
//      amulet, climb the rope back up. Protect from Melee for the temple guards.
//   C  monkey child with the amulet worn and 5 bananas: the dialogue up to the
//      bananas, the 100-tick toy timer (mm_monkey_child.rs2:142), the talisman.
//   K  as a Karamja monkey with the amulet: Garkor (seek alliance), elder guard,
//      Kruk's escort, Awowogei.
//   Z  Ardougne zoo: the Monkey Minder puts a monkey-form player in the cage, a
//      zoo monkey jumps into the backpack, and the minder lets the human out.

import { runScript } from '../../../sdk/runner';
import { act, opLoc, slotOf, talkTo, walkTo, wield } from '../../../speedrun/lib/act';
import { converse, type ConverseResult } from '../../../speedrun/lib/converse';
import type { OptionPattern } from '../../../speedrun/lib/dialogue';
import type { ItemPattern } from '../../../speedrun/lib/items';
import { pathTiles } from '../../../speedrun/lib/paths';
import { currentTick, waitTicks, waitUntil, type Pred } from '../../../speedrun/lib/wait';
import { findLoc, invCount, invItem, messagesSince, pos } from '../../../speedrun/lib/world';
import { Recorder } from '../../../speedrun/lab/record';
import { clearInventory, getvar, give, setStats, setvar, tele } from '../../../speedrun/lab/setup';

const SEGS = (process.argv[3] ?? 'HTC').toUpperCase().split('');

await runScript(async ({ bot, sdk }) => {
    const rec = new Recorder(sdk, 'monkey_madness_atoll');

    // Counts and walk-up time of a conversation; with `done`, a conversation that never opened is timed to `done`.
    const dialogueRow = async (r: ConverseResult, done?: Pred): Promise<string | undefined> => {
        rec.dialogue(r);
        if (r.firstTick >= 0) rec.note(`approach ${r.firstTick - r.startTick}`);
        if (done && !r.opened) {
            const w = await waitUntil(sdk, done, { maxTicks: 30 });
            if (!w.ok) return 'TIMEOUT';
            rec.mark(w.tick);
        }
        return r.ok ? undefined : r.reason;
    };
    const walk = (name: string, x: number, z: number, tol: number) => rec.seg(name, async () => {
        const p = pos(sdk);
        const est = pathTiles(p.level, p.x, p.z, x, z);
        const w = await walkTo(bot, sdk, x, z, tol);
        return `${est.tiles} path tiles${w.ok ? '' : ' FAILED ' + w.message}`;
    });
    const talk = (name: string, npc: RegExp, choices: OptionPattern[], o: { idle?: number; done?: Pred } = {}) => rec.seg(name, async () => {
        const r = await talkTo(sdk, npc, choices, { idle: o.idle ?? 3, maxTicks: 600, unmatched: 'stop', closeModals: true, ...(o.done ? { until: o.done } : {}) });
        rec.interact(r.clicks);
        return dialogueRow(r, o.done);
    });
    // Click the loc at (x, z) and wait for `done`; a dropped click is re-sent.
    const locStep = (name: string, x: number, z: number, op: RegExp, done: Pred, maxTicks = 20) => rec.seg(name, async () => {
        const r = await opLoc(sdk, { x, z, op }, op, done, { maxTicks });
        rec.interact(1 + r.resends);
        return r.ok ? undefined : 'TIMEOUT';
    });
    // Click the loc at (x, z) and answer the dialogue it opens (the crates ask before they are searched).
    const locTalk = (name: string, x: number, z: number, op: RegExp, choices: OptionPattern[], o: { idle?: number; done?: Pred } = {}) => rec.seg(name, async () => {
        const conv = converse(sdk, choices, { idle: o.idle ?? 3, openTicks: 60, maxTicks: 600, unmatched: 'stop', closeModals: true, ...(o.done ? { until: o.done } : {}) });
        await opLoc(sdk, { x, z, op }, op);
        rec.interact();
        return dialogueRow(await conv, o.done);
    });
    // Use an inventory item on the loc at (x, z), timed to `done` or the end of the page it opens, whichever is later.
    const useOnLoc = (name: string, item: ItemPattern, x: number, z: number, done: Pred, maxTicks = 40) => rec.seg(name, async () => {
        const loc = await findLoc(sdk, { x, z });
        if (!loc) throw new Error(`no loc at (${x},${z})`);
        const slot = slotOf(sdk, item);
        const conv = converse(sdk, [], { idle: 3, openTicks: 15, closeModals: true, unmatched: 'stop' });
        const r = await act(sdk, () => sdk.sendUseItemOnLoc(slot, loc.x, loc.z, loc.id), done, { maxTicks });
        rec.interact(1 + r.resends);
        rec.mark();
        const d = await conv;
        if (d.opened) rec.dialogue(d);
        return r.ok ? undefined : 'TIMEOUT';
    });
    const reset = async (vars: Record<string, number>, items: Array<[string, number]>, at: [number, number, number?]) => {
        await sdk.sendCloseModal();
        await waitTicks(sdk, 1);
        await clearInventory(sdk);
        await setStats(sdk, { hitpoints: 70, prayer: 43 });
        await setvar(sdk, 'treequest', 9);
        await setvar(sdk, 'grandtree', 160);
        for (const [k, v] of Object.entries(vars)) await setvar(sdk, k, v);
        for (const [o, n] of items) await give(sdk, o, n);
        for (let k = 0; k < 5 && !(await tele(sdk, at[0], at[1], at[2] ?? 0)); k++) await waitTicks(sdk, 5);
        await waitTicks(sdk, 2);
    };

    for (const seg of SEGS) {
        if (seg === 'H') {
            // Search the denture crate from its east side (2768,2769): every other side is inside the
            // sleeping guard's zone (mm_sleeping_monkey_guard.rs2:2-5), whose 2-tick timer closes the
            // crate's choice and calls the guards.
            await reset({ mm_main: 3, mm_zooknock: 5 }, [['shark', 5]], [2768, 2769]);
            let lastK = '';
            const dump = sdk.onStateUpdate(s => { const k = `${JSON.stringify(pos(s))} ${s.dialog.isOpen ? (s.dialog.isWaiting ? 'W ' : '') + (s.dialog.allComponents ?? []).map(c => c.text).join(' ').slice(0, 50) : '-'} modal=${s.modalOpen}`; if (k !== lastK) console.log('S', s.tick, k); lastK = k; });
            await locTalk('H1 denture crate', 2767, 2769, /search/i, [/^Yes$/], { idle: 5, done: s => invCount(s, /dentures/i) > 0 });
            await locTalk('H2 crate over the hole -> cellar', 2769, 2765, /search/i, [/Yes, I'm sure/], { idle: 8, done: s => pos(s).z > 9000 });
            console.log('cellar landing', JSON.stringify(pos(sdk)), 'hp', sdk.getState()!.player!.hp);
            dump();
            await walk('H3 walk to mould crate', 2782, 9171, 1);
            await locTalk('H4 mould crate', 2782, 9172, /search/i, [/^Yes$/], { idle: 5, done: s => invCount(s, /mould/i) > 0 });
            await walk('H5 walk to banana crate', 2786, 9171, 1);
            await locTalk('H6 one banana crate', 2786, 9170, /search/i, [/^Yes$/], { idle: 5, done: s => invCount(s, /^banana$/i) > 0 });
            // The western rope: the eastern one lands inside the sleeping guard's zone again.
            await walk('H7 walk to western rope', 2764, 9166, 1);
            await locStep('H8 climb rope', 2764, 9165, /climb/i, s => pos(s).z < 9000);
            console.log('up at', JSON.stringify(pos(sdk)));
        }
        if (seg === 'T') {
            await reset({ mm_main: 3, mm_zooknock: 5 }, [['mm_enchanted_gold_bar', 1], ['mm_monkey_amulet_mould', 1], ['ball_of_wool', 1], ['shark', 5]], [2795, 2786]);
            // Auto retaliate off (one click on the combat tab, controls:com_3, player_controls.rs2:14-19),
            // or every guard hit turns the player round to fight and drops the walk.
            await setvar(sdk, 'option_nodef', 1);
            await bot.activatePrayer('protect_from_melee');
            await rec.seg('T1 trapdoor open + climb down under attack', async () => {
                // Five aggressive temple guards (level 167, mm_religious_trapdoor_guard) stand round the
                // trapdoor and block the tiles next to it; clicks only land when a gap opens. Click it
                // (open, then climb down) every 3 ticks until underground.
                const t0 = currentTick(sdk);
                let opened = -1;
                let clicks = 0;
                let sent = -10;
                const r = await waitUntil(sdk, s => {
                    if (pos(s).z > 9000) return true;
                    if (opened < 0 && messagesSince(s, t0, /trapdoor opens/i).length > 0) opened = s.tick;
                    if (s.tick - sent >= 3) {
                        sent = s.tick;
                        clicks++;
                        // The client cannot route to this trapdoor (cant_reach), so walk onto its only
                        // access tile, west of it, and click from there.
                        const p = pos(s);
                        if (p.x !== 2806 || p.z !== 2785) { void sdk.sendWalk(2806, 2785, true); return false; }
                        void sdk.scanNearbyLocs(20).then(ls => {
                            const l = ls.find(l => l.x === 2807 && l.z === 2785);
                            if (l) void sdk.sendInteractLoc(l.x, l.z, l.id, l.optionsWithIndex[0]?.opIndex ?? 1);
                        });
                    }
                    return false;
                }, { maxTicks: 150 });
                rec.interact(clicks);
                if (r.ok) rec.mark(r.tick);
                return `${clicks} clicks, opened at +${opened >= 0 ? opened - t0 : '?'}, hp ${sdk.getState()!.player!.hp}${r.ok ? '' : ', TIMEOUT'}`;
            });
            console.log('temple landing', JSON.stringify(pos(sdk)));
            const fire = (await sdk.scanNearbyLocs(15)).filter(l => /fire|wall/i.test(l.name) || /firewall/i.test(String(l.id))).sort((a, b) => a.distance - b.distance);
            for (const f of fire.slice(0, 4)) console.log('fire loc', f.name, f.id, f.x, f.z, f.distance);
            const f0 = fire[0];
            if (f0) await useOnLoc('T3 smith at the fire', /Enchanted bar/i, f0.x, f0.z, s => invCount(s, /M'speak amulet/i) > 0, 30);
            await rec.seg('T4 string the amulet', async () => {
                const wool = invItem(sdk, /ball of wool/i);
                const am = invItem(sdk, /M'speak amulet/i);
                if (!wool || !am) return 'no wool or no amulet';
                const r = await act(sdk, () => sdk.sendUseItemOnItem(wool.slot, am.slot), s => invCount(s, /ball of wool/i) === 0, { maxTicks: 10 });
                rec.interact(1 + r.resends);
                return r.ok ? undefined : 'TIMEOUT';
            });
            await walk('T5 walk to rope', 2808, 9200, 1);
            await locStep('T6 climb rope', 2808, 9201, /climb/i, s => pos(s).z < 9000);
            await bot.deactivateAllPrayers();
            console.log('up at', JSON.stringify(pos(sdk)), 'hp', sdk.getState()!.player!.hp);
        }
        if (seg === 'C') {
            await reset({ mm_main: 3, mm_zooknock: 5, mm_monkey_child: 0 }, [['mm_amulet_of_monkey_speak', 1], ['banana', 5], ['shark', 5]], [2745, 2797]);
            await rec.seg("C0 equip M'speak amulet", async () => {
                const r = await wield(sdk, /M'speak amulet/i);
                rec.interact(1 + r.resends);
                return r.ok ? undefined : 'TIMEOUT';
            });
            let guards = 0;
            const unsub = sdk.onStateUpdate(s => { if (s.nearbyNpcs.some(n => /^(Duke|Oipuis|Uyoro|Ouhai|Uodai|Monkey Guard)$/i.test(n.name) && n.distance < 6)) guards++; });
            await talk('C1 child: hello', /^Monkey child$/i, []);
            await talk('C2 child: uncle', /^Monkey child$/i, [/monkey's uncle/]);
            await talk('C3 child: bananas wanted', /^Monkey child$/i, [/How many bananas/]);
            await talk('C4 child: give bananas', /^Monkey child$/i, []);
            await rec.seg('C5 toy timer (100 ticks, mm_monkey_child.rs2:142)', () => waitTicks(sdk, 100));
            await talk('C6 child: talisman', /^Monkey child$/i, [], { done: s => invCount(s, /Monkey talisman/i) > 0 });
            unsub();
            console.log('guard sightings (ticks with a summoned guard within 6):', guards, 'pos', JSON.stringify(pos(sdk)), 'mm_monkey_child', await getvar(sdk, 'mm_monkey_child'));
        }
    }
    rec.report();
}, { timeout: 1_800_000 });
