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
import {
    dropAll, ensure, findLoc, findNpc, getVar, invCount, now, pos, result, setStats, setVar, talk, talkThrough, tele, useOnNpc, waitTicks, waitUntil,
} from './quest-regicide-lab';

const all = ['lathas1', 'iban', 'well', 'exit', 'idris', 'iorwerth3', 'tracker4', 'iorwerth5', 'tracker5', 'footprints', 'tracker7', 'camp', 'iorwerth10',
    'barrel', 'tar', 'sulphur', 'loom', 'quicklime', 'bomb', 'rabbit', 'catapult', 'iorwerth12', 'arianwyn', 'lathas14'];
const picked = process.argv.slice(3).filter(a => !a.startsWith('-'));
const segments = picked.length ? picked : all;

const at = (x: number, z: number, level = 0) => (s: any) => s.player?.worldX === x && s.player?.worldZ === z && (s.player?.level ?? 0) === level;

await runScript(async ({ bot, sdk }) => {
    await bot.dismissBlockingUI();
    await setStats(sdk, { agility: 56, crafting: 10, hitpoints: 99 });
    const stage = () => getVar(sdk, 'regicide_quest');
    const useOnLoc = async (item: RegExp, lx: number, lz: number, name?: RegExp) => {
        const loc = await findLoc(sdk, lx, lz, name);
        if (!loc) throw new Error(`loc ${name} at ${lx},${lz} not found`);
        const it = sdk.getInventory().find(i => item.test(i.name));
        if (!it) throw new Error(`no ${item}`);
        const t0 = now(sdk);
        await sdk.sendUseItemOnLoc(it.slot, loc.x, loc.z, loc.id);
        return t0;
    };
    const useOnItem = async (a: RegExp, b: RegExp, produced: RegExp) => {
        const ia = sdk.getInventory().find(i => a.test(i.name))!;
        const ib = sdk.getInventory().find(i => b.test(i.name))!;
        const t0 = now(sdk);
        await sdk.sendUseItemOnItem(ia.slot, ib.slot);
        const r = await waitUntil(sdk, () => invCount(sdk, produced) > 0, 15);
        return r ? r.tick - t0 : null;
    };

    for (const seg of segments) {
        try {
            if (seg === 'lathas1') {
                await setVar(sdk, 'regicide_quest', 1);
                await tele(sdk, 2577, 3292, 1);
                const d = await talk(sdk, /King Lathas/i, [/./]);
                result(seg, { ...d, transcript: undefined, stage: await stage() });
            } else if (seg === 'iban') {
                await setVar(sdk, 'regicide_quest', 2);
                await tele(sdk, 2144, 4648, 1);
                const door = (await sdk.scanNearbyLocs(5)).find(l => /door/i.test(l.name) && l.x === 2143);
                if (!door) throw new Error('iban door not found: ' + (await sdk.scanNearbyLocs(5)).map(l => `${l.name}@${l.x},${l.z}`).join(' '));
                const t0 = now(sdk);
                await sdk.sendInteractLoc(door.x, door.z, door.id, 1);
                const r = await waitUntil(sdk, s => (s.player?.worldX ?? 9999) < 2100, 15);
                result(seg, { ticks: r ? r.tick - t0 : null, end: pos(sdk.getState()) });
            } else if (seg === 'well') {
                await setVar(sdk, 'regicide_quest', 2);
                await tele(sdk, 2014, 4712, 1);
                const well = (await sdk.scanNearbyLocs(10)).find(l => /well/i.test(l.name));
                if (!well) throw new Error('well not found: ' + (await sdk.scanNearbyLocs(10)).map(l => `${l.name}@${l.x},${l.z}`).join(' '));
                const t0 = now(sdk);
                await sdk.sendInteractLoc(well.x, well.z, well.id, 1);
                const r = await waitUntil(sdk, s => (s.player?.worldZ ?? 0) > 9000, 20);
                result(seg, { from: [2014, 4712], ticks: r ? r.tick - t0 : null, end: pos(sdk.getState()) });
            } else if (seg === 'exit') {
                await setVar(sdk, 'regicide_quest', 3);
                await tele(sdk, 2343, 9622, 0);
                const t0 = now(sdk);
                // walk to the exit and use it
                const exit = (await sdk.scanNearbyLocs(40)).find(l => l.x === 2312 && l.z === 9623);
                if (!exit) throw new Error('exit not found: ' + (await sdk.scanNearbyLocs(40)).filter(l => l.options.length).map(l => `${l.name}@${l.x},${l.z}:${l.options}`).join(' '));
                await sdk.sendInteractLoc(exit.x, exit.z, exit.id, 1);
                const r = await waitUntil(sdk, s => (s.player?.worldZ ?? 9999) < 4000, 60);
                result(seg, { from: [2343, 9622], ticks: r ? r.tick - t0 : null, end: pos(sdk.getState()) });
            } else if (seg === 'idris') {
                await setVar(sdk, 'regicide_quest', 2);
                await tele(sdk, 2343, 9622, 0); // leave the mapzones so the timer re-arms
                await waitTicks(sdk, 2);
                const exit = (await sdk.scanNearbyLocs(40)).find(l => l.x === 2312 && l.z === 9623)!;
                await tele(sdk, 2313, 9623, 0);
                await waitTicks(sdk, 2);
                await sdk.sendInteractLoc(exit.x, exit.z, exit.id, 1);
                const arr = await waitUntil(sdk, s => (s.player?.worldZ ?? 9999) < 4000, 20);
                const tArr = arr!.tick;
                const open = await waitUntil(sdk, s => s.dialog.isOpen, 60);
                const d = await talkThrough(sdk, [/./], { settleTicks: 3 });
                result(seg, { arrivalToFirstPage: open ? open.tick - tArr : null, dialogue: { ticks: d.ticks, pages: d.pages, options: d.options }, arrivalToClose: now(sdk) - tArr - 3, stage: await stage(), transcript: d.transcript });
            } else if (seg === 'iorwerth3' || seg === 'iorwerth5' || seg === 'iorwerth10' || seg === 'iorwerth12') {
                const st = Number(seg.replace('iorwerth', ''));
                await setVar(sdk, 'regicide_quest', st);
                if (st === 5) for (const it of sdk.getInventory().filter(i => /Crystal pendant/i.test(i.name))) { await sdk.sendDropItem(it.slot); await waitTicks(sdk, 1); }
                await tele(sdk, 2206, 3251, 0);
                const d = await talk(sdk, /Lord Iorwerth/i, [/./]);
                result(seg, { ...d, transcript: undefined, stage: await stage(), inv: sdk.getInventory().map(i => i.name).filter(n => /pendant|book|message/i.test(n)) });
            } else if (seg === 'tracker4' || seg === 'tracker5' || seg === 'tracker7') {
                const st = Number(seg.replace('tracker', ''));
                await setVar(sdk, 'regicide_quest', st);
                if (st === 5) await ensure(sdk, 'regicide_crystal_pendant', /Crystal pendant/i, 1);
                await tele(sdk, 2257, 3151, 0);
                const d = await talk(sdk, /Tracker|Elf/i, [/./]);
                result(seg, { ...d, transcript: undefined, stage: await stage() });
            } else if (seg === 'footprints') {
                await setVar(sdk, 'regicide_quest', 6);
                await tele(sdk, 2242, 3150, 0);
                const loc = (await sdk.scanNearbyLocs(4)).find(l => /Tracks/i.test(l.name))!;
                const t0 = now(sdk);
                await sdk.sendInteractLoc(loc.x, loc.z, loc.id, 1);
                const r = await waitUntil(sdk, s => s.gameMessages.some(m => /foot prints|impassable/i.test(m.text)), 10);
                result(seg, { ticks: r ? r.tick - t0 : null, stage: await stage() });
            } else if (seg === 'camp') {
                await setVar(sdk, 'regicide_quest', 9);
                await tele(sdk, 2188, 3171, 0);
                const loc = await findLoc(sdk, 2187, 3169, /Dense forest/);
                const t0 = now(sdk);
                await sdk.sendInteractLoc(loc!.x, loc!.z, loc!.id, 1);
                const r = await waitUntil(sdk, at(2188, 3168), 15);
                result(seg, { ticks: r ? r.tick - t0 : null, stage: await stage() });
            } else if (seg === 'barrel') {
                await tele(sdk, 2205, 3255, 0);
                await waitUntil(sdk, () => !!sdk.getGroundItems().find(g => /^Barrel$/i.test(g.name)), 10);
                const g = sdk.getGroundItems().find(g => /^Barrel$/i.test(g.name));
                if (!g) throw new Error('no barrel on the ground');
                const t0 = now(sdk);
                await sdk.sendPickup(g.x, g.z, g.id);
                const r = await waitUntil(sdk, () => invCount(sdk, /^Barrel$/i) > 0, 15);
                result(seg, { at: [g.x, g.z], from: [2205, 3255], ticks: r ? r.tick - t0 : null });
            } else if (seg === 'tar') {
                await ensure(sdk, 'regicide_barrel_empty', /^Barrel$/i, 1);
                await tele(sdk, 2263, 3128, 0);
                const t0 = await useOnLoc(/^Barrel$/i, 2263, 3127, /tar|pool|Coal/i).catch(async () => useOnLoc(/^Barrel$/i, 2263, 3127));
                const r = await waitUntil(sdk, () => invCount(sdk, /coal-tar/i) > 0, 15);
                result(seg, { ticks: r ? r.tick - t0 : null });
            } else if (seg === 'sulphur') {
                await ensure(sdk, 'pestle_and_mortar', /Pestle and mortar/i, 1);
                await tele(sdk, 2258, 3127, 0);
                const locs = await sdk.scanNearbyLocs(4);
                const rock = locs.find(l => l.options.some(o => /mine|break|take|search|collect/i.test(o)) && /sulph|form|rock/i.test(l.name));
                if (!rock) throw new Error('sulphur not found: ' + locs.map(l => `${l.name}@${l.x},${l.z}:${l.options}`).join(' '));
                const t0 = now(sdk);
                await sdk.sendInteractLoc(rock.x, rock.z, rock.id, 1);
                const r = await waitUntil(sdk, () => invCount(sdk, /^Sulphur$/i) > 0, 15);
                const grind = await useOnItem(/Pestle and mortar/i, /^Sulphur$/i, /Ground sulphur/i);
                result(seg, { rock: `${rock.name}@${rock.x},${rock.z}`, breakTicks: r ? r.tick - t0 : null, grindTicks: grind });
            } else if (seg === 'loom') {
                await ensure(sdk, 'ball_of_wool', /Ball of wool/i, 4);
                await tele(sdk, 2199, 3250, 0);
                const t0 = await useOnLoc(/Ball of wool/i, 2198, 3249, /Loom/i);
                const r = await waitUntil(sdk, () => invCount(sdk, /^Cloth$/i) > 0, 15);
                result(seg, { ticks: r ? r.tick - t0 : null });
            } else if (seg === 'quicklime') {
                await setVar(sdk, 'regicide_quest', 11);
                await ensure(sdk, 'limestone', /Limestone/i, 1);
                await ensure(sdk, 'pestle_and_mortar', /Pestle and mortar/i, 1);
                await ensure(sdk, 'pot_empty', /^Pot$/i, 1);
                await tele(sdk, 2974, 3369, 0); // Falador furnace (2975,3368)
                const hp0 = sdk.getState()?.player?.hp ?? 0;
                const t0 = await useOnLoc(/Limestone/i, 2975, 3368, /Furnace/i);
                const r = await waitUntil(sdk, () => invCount(sdk, /^Quicklime$/i) > 0, 15);
                await waitTicks(sdk, 1);
                const grind = await useOnItem(/Pestle and mortar/i, /^Quicklime$/i, /Pot of quicklime/i);
                result(seg, { furnaceTicks: r ? r.tick - t0 : null, grindTicks: grind, dmg: hp0 - (sdk.getState()?.player?.hp ?? 0) });
            } else if (seg === 'bomb') {
                await ensure(sdk, 'regicide_barrel_naphtha', /Barrel of naphtha/i, 1);
                await ensure(sdk, 'regicide_quicklime_dust', /Pot of quicklime/i, 1);
                await ensure(sdk, 'regicide_sulphar_dust', /Ground sulphur/i, 1);
                await ensure(sdk, 'regicide_cloth', /^Cloth$/i, 1);
                const a = await useOnItem(/Pot of quicklime/i, /Barrel of naphtha/i, /Naphtha mix/i);
                await waitTicks(sdk, 1);
                const b = await useOnItem(/Ground sulphur/i, /Naphtha mix/i, /Barrel bomb/i);
                await waitTicks(sdk, 1);
                const ic = sdk.getInventory().find(i => /^Cloth$/i.test(i.name))!;
                const ib = sdk.getInventory().find(i => /Barrel bomb/i.test(i.name))!;
                const t0 = now(sdk);
                await sdk.sendUseItemOnItem(ic.slot, ib.slot);
                const r = await waitUntil(sdk, () => !sdk.getInventory().some(i => /^Cloth$/i.test(i.name)), 10);
                result(seg, { quicklimeMix: a, sulphurMix: b, fuse: r ? r.tick - t0 : null });
            } else if (seg === 'rabbit') {
                await setVar(sdk, 'regicide_quest', 11);
                await setVar(sdk, 'regicide_bits', 0);
                await ensure(sdk, 'cooked_rabbit', /Cooked rabbit/i, 1);
                await tele(sdk, 2182, 3185, 0);
                const d = await useOnNpc(sdk, /Cooked rabbit/i, /Tyras guard/i, [/./]);
                result(seg, { ...d, transcript: undefined, bits: await getVar(sdk, 'regicide_bits') });
            } else if (seg === 'catapult') {
                await setVar(sdk, 'regicide_quest', 11);
                await setVar(sdk, 'regicide_bits', 8); // given_rabbit
                await ensure(sdk, 'regicide_barrel_lid_fused', /Barrel bomb/i, 1);
                await tele(sdk, 2184, 3185, 0);
                const t0 = await useOnLoc(/Barrel bomb/i, 2185, 3183, /Catapult/i);
                const away = await waitUntil(sdk, s => (s.player?.worldZ ?? 0) > 4000, 40);
                const back = await waitUntil(sdk, s => (s.player?.worldZ ?? 9999) < 4000 && (s.player?.worldZ ?? 0) > 3000, 60);
                // free to act: try a 1-tile walk until it moves
                let free: number | null = null;
                const p0 = pos(sdk.getState());
                for (let k = 0; k < 15 && free === null; k++) {
                    await sdk.sendWalk(p0.x, p0.z + 1, true);
                    const m = await waitUntil(sdk, s => (s.player?.worldZ ?? 0) !== p0.z, 1);
                    if (m) free = m.tick;
                }
                result(seg, { toTentTeleport: away ? away.tick - t0 : null, backAt: back ? back.tick - t0 : null, backPos: p0, movesAgainAt: free ? free - t0 : null, stage: await stage() });
            } else if (seg === 'arianwyn') {
                await setVar(sdk, 'regicide_quest', 13);
                await ensure(sdk, 'regicide_iorwerth_message', /Iorwerths message/i, 1);
                await tele(sdk, 2594, 3299, 0);
                await waitTicks(sdk, 2);
                const t0 = now(sdk);
                await sdk.sendWalk(2589, 3299, true);
                const open = await waitUntil(sdk, s => s.dialog.isOpen || s.modalOpen, 30);
                // the dialogue is 16 chained queue steps; step 9 opens the scroll as a main interface
                const tr: string[] = [];
                let pages = 0, scroll = 0;
                const tStart = now(sdk);
                while (now(sdk) - tStart < 150) {
                    const s = sdk.getState()!;
                    if (s.dialog.isOpen && !s.dialog.isWaiting) {
                        tr.push(`[${s.tick}] ${(s.dialog.text ?? '').slice(0, 50)}`);
                        const r = await sdk.clickDialogByText(/continue/i);
                        if (!r.success) await sdk.sendClickDialog(0);
                        pages++;
                        await waitUntil(sdk, st => !st.dialog.isOpen || st.dialog.pageId !== s.dialog.pageId, 6);
                        continue;
                    }
                    if (s.modalOpen && !s.dialog.isOpen) {
                        tr.push(`[${s.tick}] modal ${s.modalInterface}`);
                        scroll++;
                        await sdk.sendCloseModal();
                        await waitTicks(sdk, 1);
                        continue;
                    }
                    const st = await getVar(sdk, 'regicide_quest');
                    if (st === 14 && !sdk.getState()!.dialog.isOpen) break;
                    await waitTicks(sdk, 1);
                }
                result(seg, { walkClickToFirst: open ? open.tick - t0 : null, clickToDone: now(sdk) - t0, pages, scroll, stage: await stage(), transcript: tr });
            } else if (seg === 'lathas14') {
                await setVar(sdk, 'regicide_quest', 14);
                await ensure(sdk, 'regicide_iorwerth_message', /Iorwerths message/i, 1);
                await tele(sdk, 2577, 3292, 1);
                const ag0 = sdk.getSkill('agility')?.experience ?? 0;
                const d = await talk(sdk, /King Lathas/i, [/./]);
                const done = await waitUntil(sdk, () => (sdk.getSkill('agility')?.experience ?? 0) > ag0, 20);
                result(seg, { ...d, transcript: d.transcript, xpAt: done ? done.tick : null, agilityXp: (sdk.getSkill('agility')?.experience ?? 0) - ag0, stage: await stage() });
            }
        } catch (e) {
            result(seg, { error: String(e) });
        }
    }
    void dropAll; void findNpc; void bot;
}, { timeout: 1_800_000 });
