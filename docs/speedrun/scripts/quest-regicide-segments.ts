// Regicide: every dialogue, interaction and gathering segment, each measured
// from standing next to its NPC or loc (stages are jumped with ::setvar; the
// travel between segments is costed from route tiles in regicide.md).
//
//   bun docs/speedrun/scripts/quest-regicide-segments.ts <bot> [segment...]
//
// Segments: lathas1 iban well exit idris iorwerth3 tracker4 iorwerth5 tracker5
// footprints tracker7 camp iorwerth10 barrel tar sulphur loom quicklime bomb
// rabbit catapult iorwerth12 arianwyn lathas14

import { runScript } from '../../../sdk/runner';
import { slotOf, talkTo } from '../../../speedrun/lib/act';
import { converse, type ConverseResult } from '../../../speedrun/lib/converse';
import { currentTick, waitTicks, waitUntil } from '../../../speedrun/lib/wait';
import { at, findLoc, invCount, invItem, messagesSince, pos, skillXp, waitForNpc } from '../../../speedrun/lib/world';
import { result } from '../../../speedrun/lab/record';
import { dropMatching, ensureItem, getvar, mustTele, setStats, setvar, tele } from '../../../speedrun/lab/setup';

const all = ['lathas1', 'iban', 'well', 'exit', 'idris', 'iorwerth3', 'tracker4', 'iorwerth5', 'tracker5', 'footprints', 'tracker7', 'camp', 'iorwerth10',
    'barrel', 'tar', 'sulphur', 'loom', 'quicklime', 'bomb', 'rabbit', 'catapult', 'iorwerth12', 'arianwyn', 'lathas14'];
const picked = process.argv.slice(3).filter(a => !a.startsWith('-'));
const segments = picked.length ? picked : all;

/**
 * A conversation's counts as the segment rows report them: `ticks` from the
 * first page to the close, `clickToClose` from the click that opened it.
 */
const dlg = (r: ConverseResult & { startTick: number }) => ({
    ticks: r.opened ? r.endTick - r.firstTick : 0,
    pages: r.pages,
    options: r.options,
    clicks: r.pages + r.options,
    clickToClose: r.ticks,
    levelUps: r.levelUps,
    transcript: r.transcript,
});

await runScript(async ({ bot, sdk }) => {
    await bot.dismissBlockingUI();
    await setStats(sdk, { agility: 56, crafting: 10, hitpoints: 99 });
    const stage = () => getvar(sdk, 'regicide_quest');
    // Every choice page takes its first option (the quest's dialogues have no wrong branch here).
    const talk = async (npc: RegExp) => dlg(await talkTo(sdk, npc, [/./], { keep: true, findTicks: 20 }));
    /** Use an inventory item on an NPC and answer the dialogue that follows. */
    const useOnNpc = async (item: RegExp, npc: RegExp) => {
        const n = await waitForNpc(sdk, npc, 20);
        if (!n) throw new Error(`npc ${npc} not found`);
        const conv = converse(sdk, [/./], { keep: true });
        await sdk.sendUseItemOnNpc(slotOf(sdk, item), n.index);
        return dlg(await conv);
    };
    const useOnLoc = async (item: RegExp, lx: number, lz: number, name?: RegExp) => {
        const loc = await findLoc(sdk, { x: lx, z: lz, name });
        if (!loc) throw new Error(`loc ${name} at ${lx},${lz} not found`);
        const slot = slotOf(sdk, item);
        const t0 = currentTick(sdk);
        await sdk.sendUseItemOnLoc(slot, loc.x, loc.z, loc.id);
        return t0;
    };
    const useOnItem = async (a: RegExp, b: RegExp, produced: RegExp) => {
        const sa = slotOf(sdk, a);
        const sb = slotOf(sdk, b);
        const t0 = currentTick(sdk);
        await sdk.sendUseItemOnItem(sa, sb);
        const r = await waitUntil(sdk, s => invCount(s, produced) > 0, { maxTicks: 15 });
        return r.ok ? r.tick - t0 : null;
    };

    for (const seg of segments) {
        try {
            if (seg === 'lathas1') {
                await setvar(sdk, 'regicide_quest', 1);
                await mustTele(sdk, 2577, 3292, 1);
                const d = await talk(/King Lathas/i);
                result(seg, { ...d, transcript: undefined, stage: await stage() });
            } else if (seg === 'iban') {
                await setvar(sdk, 'regicide_quest', 2);
                await mustTele(sdk, 2144, 4648, 1);
                const door = (await sdk.scanNearbyLocs(5)).find(l => /door/i.test(l.name) && l.x === 2143);
                if (!door) throw new Error('iban door not found: ' + (await sdk.scanNearbyLocs(5)).map(l => `${l.name}@${l.x},${l.z}`).join(' '));
                const t0 = currentTick(sdk);
                await sdk.sendInteractLoc(door.x, door.z, door.id, 1);
                const r = await waitUntil(sdk, s => (s.player?.worldX ?? 9999) < 2100, { maxTicks: 15 });
                result(seg, { ticks: r.ok ? r.tick - t0 : null, end: pos(sdk) });
            } else if (seg === 'well') {
                await setvar(sdk, 'regicide_quest', 2);
                await mustTele(sdk, 2014, 4712, 1);
                const well = (await sdk.scanNearbyLocs(10)).find(l => /well/i.test(l.name));
                if (!well) throw new Error('well not found: ' + (await sdk.scanNearbyLocs(10)).map(l => `${l.name}@${l.x},${l.z}`).join(' '));
                const t0 = currentTick(sdk);
                await sdk.sendInteractLoc(well.x, well.z, well.id, 1);
                const r = await waitUntil(sdk, s => (s.player?.worldZ ?? 0) > 9000, { maxTicks: 20 });
                result(seg, { from: [2014, 4712], ticks: r.ok ? r.tick - t0 : null, end: pos(sdk) });
            } else if (seg === 'exit') {
                await setvar(sdk, 'regicide_quest', 3);
                await mustTele(sdk, 2343, 9622, 0);
                const t0 = currentTick(sdk);
                // walk to the exit and use it
                const exit = (await sdk.scanNearbyLocs(40)).find(l => l.x === 2312 && l.z === 9623);
                if (!exit) throw new Error('exit not found: ' + (await sdk.scanNearbyLocs(40)).filter(l => l.options.length).map(l => `${l.name}@${l.x},${l.z}:${l.options}`).join(' '));
                await sdk.sendInteractLoc(exit.x, exit.z, exit.id, 1);
                const r = await waitUntil(sdk, s => (s.player?.worldZ ?? 9999) < 4000, { maxTicks: 60 });
                result(seg, { from: [2343, 9622], ticks: r.ok ? r.tick - t0 : null, end: pos(sdk) });
            } else if (seg === 'idris') {
                await setvar(sdk, 'regicide_quest', 2);
                await mustTele(sdk, 2343, 9622, 0); // leave the mapzones so the timer re-arms
                await waitTicks(sdk, 2);
                const exit = (await sdk.scanNearbyLocs(40)).find(l => l.x === 2312 && l.z === 9623);
                if (!exit) throw new Error('temple exit (2312,9623) not found');
                await mustTele(sdk, 2313, 9623, 0);
                await waitTicks(sdk, 2);
                await sdk.sendInteractLoc(exit.x, exit.z, exit.id, 1);
                const arr = await waitUntil(sdk, s => (s.player?.worldZ ?? 9999) < 4000, { maxTicks: 20 });
                if (!arr.ok) throw new Error('did not leave the temple');
                const tArr = arr.tick;
                const open = await waitUntil(sdk, s => s.dialog.isOpen, { maxTicks: 60 });
                // Idris's two pages, then the queued evil-elf ambush (idris.rs2:26-71) opens
                // more pages after the scouts walk up; keep answering until 10 quiet ticks.
                let pages = 0, lastPage = tArr;
                const tr: string[] = [];
                for (let k = 0; k < 6; k++) {
                    const d = await converse(sdk, [/./], { keep: true, idle: 10, openTicks: 20 });
                    if (d.pages + d.options === 0) break;
                    pages += d.pages + d.options;
                    tr.push(...d.transcript);
                    lastPage = d.endTick;
                }
                result(seg, { arrivalToFirstPage: open.ok ? open.tick - tArr : null, pages, arrivalToLastClose: lastPage - tArr, stage: await stage(), transcript: tr });
            } else if (seg === 'iorwerth3' || seg === 'iorwerth5' || seg === 'iorwerth10' || seg === 'iorwerth12') {
                const st = Number(seg.replace('iorwerth', ''));
                await setvar(sdk, 'regicide_quest', st);
                if (st === 5) await dropMatching(sdk, [/Crystal pendant/i]);
                await waitTicks(sdk, 4);
                for (let k = 0; k < 3 && !(await tele(sdk, 2206, 3251, 0)); k++) await waitTicks(sdk, 3);
                const d = await talk(/Lord Iorwerth/i);
                result(seg, { ...d, transcript: undefined, stage: await stage(), inv: sdk.getInventory().map(i => i.name).filter(n => /pendant|book|message/i.test(n)) });
            } else if (seg === 'tracker4' || seg === 'tracker5' || seg === 'tracker7') {
                const st = Number(seg.replace('tracker', ''));
                await setvar(sdk, 'regicide_quest', st);
                if (st === 5) await ensureItem(sdk, 'regicide_crystal_pendant', /Crystal pendant/i, 1);
                await mustTele(sdk, 2257, 3151, 0);
                const d = await talk(/Tracker|Elf/i);
                result(seg, { ...d, transcript: undefined, stage: await stage() });
            } else if (seg === 'footprints') {
                await setvar(sdk, 'regicide_quest', 6);
                await mustTele(sdk, 2242, 3150, 0);
                const loc = await findLoc(sdk, { name: /Tracks/i, radius: 4 });
                if (!loc) throw new Error('no tracks near 2242,3150');
                const t0 = currentTick(sdk);
                await sdk.sendInteractLoc(loc.x, loc.z, loc.id, 1);
                const r = await waitUntil(sdk, s => messagesSince(s, t0, /foot prints|impassable/i).length > 0, { maxTicks: 10 });
                result(seg, { ticks: r.ok ? r.tick - t0 : null, stage: await stage() });
            } else if (seg === 'camp') {
                await setvar(sdk, 'regicide_quest', 9);
                await mustTele(sdk, 2188, 3171, 0);
                const loc = await findLoc(sdk, { x: 2187, z: 3169, name: /Dense forest/ });
                if (!loc) throw new Error('no dense forest at 2187,3169');
                const t0 = currentTick(sdk);
                await sdk.sendInteractLoc(loc.x, loc.z, loc.id, 1);
                const r = await waitUntil(sdk, at(2188, 3168), { maxTicks: 15 });
                await waitTicks(sdk, 5); // the stage is set after the cross-over's p_delay(3)
                result(seg, { ticks: r.ok ? r.tick - t0 : null, stage: await stage() });
            } else if (seg === 'barrel') {
                await mustTele(sdk, 2205, 3255, 0);
                const seen = await waitUntil(sdk, s => s.groundItems.some(g => /^Barrel$/i.test(g.name)), { maxTicks: 10 });
                const g = seen.state?.groundItems.find(g => /^Barrel$/i.test(g.name));
                if (!g) throw new Error('no barrel on the ground');
                const t0 = currentTick(sdk);
                await sdk.sendPickup(g.x, g.z, g.id);
                const r = await waitUntil(sdk, s => invCount(s, /^Barrel$/i) > 0, { maxTicks: 15 });
                result(seg, { at: [g.x, g.z], from: [2205, 3255], ticks: r.ok ? r.tick - t0 : null });
            } else if (seg === 'tar') {
                await ensureItem(sdk, 'regicide_barrel_empty', /^Barrel$/i, 1);
                await mustTele(sdk, 2263, 3128, 0);
                const t0 = await useOnLoc(/^Barrel$/i, 2263, 3127, /tar|pool|Coal/i).catch(async () => useOnLoc(/^Barrel$/i, 2263, 3127));
                const r = await waitUntil(sdk, s => invCount(s, /coal-tar/i) > 0, { maxTicks: 15 });
                result(seg, { ticks: r.ok ? r.tick - t0 : null });
            } else if (seg === 'sulphur') {
                await ensureItem(sdk, 'pestle_and_mortar', /Pestle and mortar/i, 1);
                await mustTele(sdk, 2258, 3127, 0);
                const locs = await sdk.scanNearbyLocs(4);
                const rock = locs.find(l => l.options.some(o => /mine|break|take|search|collect/i.test(o)) && /sulph|form|rock/i.test(l.name));
                if (!rock) throw new Error('sulphur not found: ' + locs.map(l => `${l.name}@${l.x},${l.z}:${l.options}`).join(' '));
                const t0 = currentTick(sdk);
                await sdk.sendInteractLoc(rock.x, rock.z, rock.id, 1);
                const r = await waitUntil(sdk, s => invCount(s, /^Sulphur$/i) > 0, { maxTicks: 15 });
                const grind = await useOnItem(/Pestle and mortar/i, /^Sulphur$/i, /Ground sulphur/i);
                result(seg, { rock: `${rock.name}@${rock.x},${rock.z}`, breakTicks: r.ok ? r.tick - t0 : null, grindTicks: grind });
            } else if (seg === 'loom') {
                await ensureItem(sdk, 'ball_of_wool', /Ball of wool/i, 4);
                await mustTele(sdk, 2199, 3250, 0);
                const t0 = await useOnLoc(/Ball of wool/i, 2198, 3249, /Loom/i);
                const r = await waitUntil(sdk, s => invCount(s, /^Cloth$/i) > 0, { maxTicks: 15 });
                result(seg, { ticks: r.ok ? r.tick - t0 : null });
            } else if (seg === 'quicklime') {
                await setvar(sdk, 'regicide_quest', 11);
                await ensureItem(sdk, 'limestone', /Limestone/i, 1);
                await ensureItem(sdk, 'pestle_and_mortar', /Pestle and mortar/i, 1);
                await ensureItem(sdk, 'pot_empty', /^Pot$/i, 1);
                await mustTele(sdk, 2974, 3369, 0); // Falador furnace (2975,3368)
                const hp0 = sdk.getState()?.player?.hp ?? 0;
                const t0 = await useOnLoc(/Limestone/i, 2975, 3368, /Furnace/i);
                const r = await waitUntil(sdk, s => invCount(s, /^Quicklime$/i) > 0, { maxTicks: 15 });
                await waitTicks(sdk, 1);
                const grind = await useOnItem(/Pestle and mortar/i, /^Quicklime$/i, /Pot of quicklime/i);
                result(seg, { furnaceTicks: r.ok ? r.tick - t0 : null, grindTicks: grind, dmg: hp0 - (sdk.getState()?.player?.hp ?? 0) });
            } else if (seg === 'bomb') {
                await ensureItem(sdk, 'regicide_barrel_naphtha', /Barrel of naphtha/i, 1);
                await ensureItem(sdk, 'regicide_quicklime_dust', /Pot of quicklime/i, 1);
                await ensureItem(sdk, 'regicide_sulphar_dust', /Ground sulphur/i, 1);
                await ensureItem(sdk, 'regicide_cloth', /^Cloth$/i, 1);
                const a = await useOnItem(/Pot of quicklime/i, /Barrel of naphtha/i, /Naphtha mix/i);
                await waitTicks(sdk, 1);
                const b = await useOnItem(/Ground sulphur/i, /Naphtha mix/i, /Barrel bomb/i);
                await waitTicks(sdk, 1);
                const ic = slotOf(sdk, /^Cloth$/i);
                const ib = slotOf(sdk, /Barrel bomb/i);
                const t0 = currentTick(sdk);
                await sdk.sendUseItemOnItem(ic, ib);
                const r = await waitUntil(sdk, s => invItem(s, /^Cloth$/i) === null, { maxTicks: 10 });
                result(seg, { quicklimeMix: a, sulphurMix: b, fuse: r.ok ? r.tick - t0 : null });
            } else if (seg === 'rabbit') {
                await setvar(sdk, 'regicide_quest', 11);
                await setvar(sdk, 'regicide_bits', 0);
                await ensureItem(sdk, 'cooked_rabbit', /Cooked rabbit/i, 1);
                await mustTele(sdk, 2182, 3185, 0);
                const d = await useOnNpc(/Cooked rabbit/i, /Tyras guard/i);
                result(seg, { ...d, transcript: undefined, bits: await getvar(sdk, 'regicide_bits') });
            } else if (seg === 'catapult') {
                await setvar(sdk, 'regicide_quest', 11);
                await setvar(sdk, 'regicide_bits', 8); // given_rabbit
                await ensureItem(sdk, 'regicide_barrel_lid_fused', /Barrel bomb/i, 1);
                await mustTele(sdk, 2184, 3185, 0);
                const t0 = await useOnLoc(/Barrel bomb/i, 2185, 3183, /Catapult/i);
                const away = await waitUntil(sdk, s => (s.player?.worldZ ?? 0) > 4000, { maxTicks: 40 });
                const back = await waitUntil(sdk, s => (s.player?.worldZ ?? 9999) < 4000 && (s.player?.worldZ ?? 0) > 3000, { maxTicks: 60 });
                // free to act: try a 1-tile walk until it moves
                let free: number | null = null;
                const p0 = pos(sdk);
                for (let k = 0; k < 15 && free === null; k++) {
                    await sdk.sendWalk(p0.x, p0.z + 1, true);
                    const m = await waitUntil(sdk, s => (s.player?.worldZ ?? 0) !== p0.z, { maxTicks: 1 });
                    if (m.ok) free = m.tick;
                }
                result(seg, { toTentTeleport: away.ok ? away.tick - t0 : null, backAt: back.ok ? back.tick - t0 : null, backPos: p0, movesAgainAt: free ? free - t0 : null, stage: await stage() });
            } else if (seg === 'arianwyn') {
                await setvar(sdk, 'regicide_quest', 13);
                await ensureItem(sdk, 'regicide_iorwerth_message', /Iorwerths message/i, 1);
                await mustTele(sdk, 2594, 3299, 0);
                await waitTicks(sdk, 2);
                const t0 = currentTick(sdk);
                await sdk.sendWalk(2589, 3299, true);
                const open = await waitUntil(sdk, s => s.dialog.isOpen || s.modalOpen, { maxTicks: 30 });
                // Queue gaps are not completion: keep answering until the staff probe confirms
                // stage 14. The scroll midway through the chain is closed by converse.
                let completed = false;
                let stopped = false;
                const probe = (async () => {
                    while (!stopped && !completed && currentTick(sdk) - t0 < 180) {
                        if (!sdk.getState()?.dialog.isOpen) completed = await stage() === 14;
                        if (!completed && !stopped) await waitTicks(sdk, 1);
                    }
                })();
                let d: ConverseResult;
                try {
                    d = await converse(sdk, [/./], { keep: true, unmatched: 'first', closeModals: true, idle: 6, openTicks: 150, maxTicks: 150, until: () => completed });
                } finally {
                    stopped = true;
                    await probe;
                }
                if (!completed || !d.ok) throw new Error('Arianwyn sequence did not reach stage 14');
                const scroll = d.transcript.filter(l => / modal \d+ closed$/.test(l)).length;
                result(seg, { walkClickToFirst: open.ok ? open.tick - t0 : null, clickToDone: d.opened ? d.endTick - t0 : currentTick(sdk) - t0, pages: d.pages + d.options, scroll, stage: await stage(), transcript: d.transcript });
            } else if (seg === 'lathas14') {
                await setvar(sdk, 'regicide_quest', 14);
                await ensureItem(sdk, 'regicide_iorwerth_message', /Iorwerths message/i, 1);
                await mustTele(sdk, 2577, 3292, 1);
                const ag0 = skillXp(sdk, 'agility');
                const d = await talk(/King Lathas/i);
                const done = await waitUntil(sdk, s => skillXp(s, 'agility') > ag0, { maxTicks: 20 });
                result(seg, { ...d, xpAt: done.ok ? done.tick : null, agilityXp: skillXp(sdk, 'agility') - ag0, stage: await stage() });
            }
        } catch (e) {
            result(seg, { error: String(e) });
        }
    }
}, { timeout: 1_800_000 });
