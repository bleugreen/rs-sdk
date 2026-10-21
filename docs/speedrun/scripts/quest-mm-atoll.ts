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
import type { BotSDK } from '../../../sdk/index';
import {
    cheat, give, invCount, locOpAt, locTalkAt, now, pos, Recorder, setstats, setvar, talk, tele,
    useOnLocAt, waitTicks, waitUntil, walk, type Pred, type StepRecord,
} from './quest-gnome-lib';

const SEGS = (process.argv[3] ?? 'HTC').toUpperCase().split('');

const near = (x: number, z: number, r = 3, l = 0): Pred => s => {
    const p = pos(s);
    return p.level === l && Math.abs(p.x - x) <= r && Math.abs(p.z - z) <= r;
};

async function equip(sdk: BotSDK, bot: { equipItem(t: string | RegExp): Promise<unknown> }, re: RegExp, label: string, rec: Recorder): Promise<void> {
    const t0 = now(sdk);
    await bot.equipItem(re);
    await waitUntil(sdk, s => (s.equipment ?? []).some(i => re.test(i.name)), 10);
    rec.add({ name: `equip ${re}`, ticks: now(sdk) - t0 }, label);
}

await runScript(async ({ bot, sdk }) => {
    const rec = new Recorder('monkey_madness_atoll');
    const add = (r: StepRecord, label: string) => rec.add(r, label);
    const reset = async (vars: Record<string, number>, items: Array<[string, number]>, at: [number, number, number?]) => {
        await sdk.sendCloseModal();
        await waitTicks(sdk, 1);
        await cheat(sdk, '~clearinv');
        await setstats(sdk, { hitpoints: 70, prayer: 43 });
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
            add(await locTalkAt(sdk, 2767, 2769, /search/i, [/^Yes$/], { idle: 5, done: s => invCount(s, /dentures/i) > 0 }), 'H1 denture crate');
            add(await locTalkAt(sdk, 2769, 2765, /search/i, [/Yes, I'm sure/], { idle: 8, done: s => pos(s).z > 9000 }), 'H2 crate over the hole -> cellar');
            console.log('cellar landing', JSON.stringify(pos(sdk.getState())), 'hp', sdk.getState()!.player!.hp);
            dump();
            add(await walk(bot, sdk, 2782, 9171, 1), 'H3 walk to mould crate');
            add(await locTalkAt(sdk, 2782, 9172, /search/i, [/^Yes$/], { idle: 5, done: s => invCount(s, /mould/i) > 0 }), 'H4 mould crate');
            add(await walk(bot, sdk, 2786, 9171, 1), 'H5 walk to banana crate');
            add(await locTalkAt(sdk, 2786, 9170, /search/i, [/^Yes$/], { idle: 5, done: s => invCount(s, /^banana$/i) > 0 }), 'H6 one banana crate');
            // The western rope: the eastern one lands inside the sleeping guard's zone again.
            add(await walk(bot, sdk, 2764, 9166, 1), 'H7 walk to western rope');
            add(await locOpAt(sdk, 2764, 9165, /climb/i, s => pos(s).z < 9000, 20), 'H8 climb rope');
            console.log('up at', JSON.stringify(pos(sdk.getState())));
        }
        if (seg === 'T') {
            await reset({ mm_main: 3, mm_zooknock: 5 }, [['mm_enchanted_gold_bar', 1], ['mm_monkey_amulet_mould', 1], ['ball_of_wool', 1], ['shark', 5]], [2807, 2787]);
            await bot.activatePrayer('protect_from_melee');
            {
                // The trapdoor guards attack a human at once; a click can be lost to the fight, so re-send.
                const t0 = now(sdk);
                const loc = (await sdk.scanNearbyLocs(5)).find(l => l.x === 2807 && l.z === 2785)!;
                let sent = -10;
                const r = await waitUntil(sdk, s => {
                    if (s.gameMessages.some(m => m.tick >= t0 && /trapdoor opens/i.test(m.text))) return true;
                    if (s.tick - sent >= 4) { sent = s.tick; void sdk.sendInteractLoc(loc.x, loc.z, loc.id, 1); }
                    return false;
                }, 30);
                add({ name: 'open trapdoor (under attack)', ticks: (r?.tick ?? NaN) - t0 }, 'T1');
                console.log('after T1', JSON.stringify(pos(sdk.getState())), 'hp', sdk.getState()!.player!.hp, 'prayer', sdk.getSkill('prayer')!.level, 'msgs', sdk.getState()!.gameMessages.slice(-5).map(m => m.text).join(' | '));
            }
            add(await locOpAt(sdk, 2807, 2785, /climb/i, s => pos(s).z > 9000, 30), 'T2 climb down');
            const p = pos(sdk.getState());
            console.log('temple landing', JSON.stringify(p));
            const fire = (await sdk.scanNearbyLocs(15)).filter(l => /fire|wall/i.test(l.name) || /firewall/i.test(String(l.id))).sort((a, b) => a.distance - b.distance);
            for (const f of fire.slice(0, 4)) console.log('fire loc', f.name, f.id, f.x, f.z, f.distance);
            const f0 = fire[0];
            if (f0) add(await useOnLocAt(sdk, /Enchanted bar/i, f0.x, f0.z, s => invCount(s, /M'speak amulet/i) > 0, { maxTicks: 30 }), 'T3 smith at the fire');
            {
                const inv = sdk.getState()!.inventory;
                const wool = inv.find(i => /ball of wool/i.test(i.name));
                const am = inv.find(i => /M'speak amulet/i.test(i.name));
                const t0 = now(sdk);
                if (wool && am) await sdk.sendUseItemOnItem(wool.slot, am.slot);
                const r = await waitUntil(sdk, s => !(s.inventory ?? []).some(i => /ball of wool/i.test(i.name)), 10);
                add({ name: 'string the amulet', ticks: (r?.tick ?? NaN) - t0 }, 'T4');
            }
            add(await walk(bot, sdk, 2808, 9200, 1, ), 'T5 walk to rope');
            add(await locOpAt(sdk, 2808, 9201, /climb/i, s => pos(s).z < 9000, 20), 'T6 climb rope');
            await bot.deactivateAllPrayers();
            console.log('up at', JSON.stringify(pos(sdk.getState())), 'hp', sdk.getState()!.player!.hp);
        }
        if (seg === 'C') {
            await reset({ mm_main: 3, mm_zooknock: 5, mm_monkey_child: 0 }, [['mm_amulet_of_monkey_speak', 1], ['banana', 5], ['shark', 5]], [2745, 2797]);
            await equip(sdk, bot, /M'speak amulet/i, 'C0', rec);
            let guards = 0;
            const unsub = sdk.onStateUpdate(s => { if (s.nearbyNpcs.some(n => /^(Duke|Oipuis|Uyoro|Ouhai|Uodai|Monkey Guard)$/i.test(n.name) && n.distance < 6)) guards++; });
            add(await talk(sdk, /^Monkey child$/i, [], { idle: 3 }), 'C1 child: hello');
            add(await talk(sdk, /^Monkey child$/i, [/monkey's uncle/], { idle: 3 }), 'C2 child: uncle');
            add(await talk(sdk, /^Monkey child$/i, [/How many bananas/], { idle: 3 }), 'C3 child: bananas wanted');
            add(await talk(sdk, /^Monkey child$/i, [], { idle: 3 }), 'C4 child: give bananas');
            const tGave = now(sdk);
            await waitTicks(sdk, 100);
            add({ name: 'toy timer (100 ticks, mm_monkey_child.rs2:142)', ticks: now(sdk) - tGave }, 'C5');
            add(await talk(sdk, /^Monkey child$/i, [], { idle: 3, done: s => invCount(s, /Monkey talisman/i) > 0 }), 'C6 child: talisman');
            unsub();
            console.log('guard sightings (ticks with a summoned guard within 6):', guards, 'pos', JSON.stringify(pos(sdk.getState())), 'mm_monkey_child', await (await import('./quest-gnome-lib')).getvar(sdk, 'mm_monkey_child'));
        }
    }
    rec.summary();
    void useOnLocAt; void near;
}, { timeout: 1_800_000 });
