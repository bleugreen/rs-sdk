// Engine probes for docs/speedrun/research/engine-sweep/engine.md (rs/67).
//
//   speedrun/lab/lab.sh <bot> 'speedrun/lab/probe-engine.ts:--probe=bury,held,charge,wine,bankheld:--n=3'
//
// Each probe prints RESULT lines. Probes (section 7 of engine.md):
//   bury      5 bury clicks fired at once, then one bury click every tick for 8 ticks:
//             are OPHELDs sent during the p_delay(0) dropped or queued, and what is the spacing?
//   held      10 delay-free OPHELDs (herb identify) fired at once: all executed, at most 5 per tick?
//             plus bury + 4 identifies in one burst: identifies dropped while delayed?
//   charge    10 Charge casts (IF_BUTTON on the overlay spellbook) at once: per-tick casts;
//             then Charge bursts beside a running fly-fishing loop that is never re-clicked:
//             does the loop survive, and do both grant xp in one tick? Control: one OPHELD.
//   wine      5 + 5 wines (OPHELDU) 10 ticks apart, then Cooking set to 1: when does the
//             fermentation timer fire, and does it without the level?
//   bankheld  OPHELD (bury) on the inventory tab while the bank is open: accepted or dropped?
import type { ActionResult } from '../../sdk/index';
import type { BotWorldState, InventoryItem } from '../../sdk/types';
import { closeSession, openSession } from '../lib/session';
import { nextTick, waitTicks, waitUntil } from '../lib/wait';
import { arg, botArg, result } from './common';
import { cheat, near, setstat, tele, VARROCK_WEST_BANK } from './setup';

const session = await openSession(botArg());
const { sdk, bot } = session;
const probes = arg('probe', 'bury,held,charge,wine,bankheld').split(',');
const N = Number(arg('n', '3'));

const CHARGE = 1193; // magic:charge (server/content/pack/interface.pack)
const BARB_FLY = '0,48,53,31,38'; // Barbarian Village lure spots (rs/2 tickmanip-cycle.ts)

// ---- per-tick record of every published state ----
const byTick = new Map<number, BotWorldState>();
sdk.onStateUpdate(s => byTick.set(s.tick, s));

const xp = (s: BotWorldState | null | undefined, skill: string) => s?.skills.find(k => k.name.toLowerCase() === skill)?.experience ?? 0;
const count = (s: BotWorldState | null | undefined, re: RegExp) => (s?.inventory ?? []).filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);
const items = (s: BotWorldState | null | undefined, re: RegExp) => (s?.inventory ?? []).filter(i => re.test(i.name));
const opOf = (i: InventoryItem, re: RegExp) => i.optionsWithIndex.find(o => re.test(o.text))?.opIndex;

/** Per-tick deltas of `f` over [from, to], as {tick: delta} for nonzero deltas. */
function deltas(from: number, to: number, f: (s: BotWorldState) => number): Record<number, number> {
    const out: Record<number, number> = {};
    let prev: number | undefined;
    for (let t = from; t <= to; t++) {
        const s = byTick.get(t);
        if (!s) continue;
        const v = f(s);
        if (prev !== undefined && v !== prev) out[t - from] = v - prev;
        prev = v;
    }
    return out;
}

const refusals: string[] = [];
function fire(what: string, p: Promise<ActionResult>) {
    p.then(r => { if (!r.success) refusals.push(`${what}: ${r.message}`); }).catch(e => refusals.push(`${what}: ${e}`));
}
function flushRefusals(step: string) {
    if (refusals.length) result(`${step} client-refusals`, refusals.splice(0));
}

async function fresh(...cmds: string[]) {
    await cheat(sdk, '~clearinv');
    await waitTicks(sdk, 2);
    for (const c of cmds) await cheat(sdk, c);
    await waitTicks(sdk, 3);
}

async function teleRetry(spec: string) {
    const [level, mx, mz, lx, lz] = spec.split(',').map(Number);
    for (let i = 0; i < 5; i++) {
        if (await tele(sdk, mx * 64 + lx, mz * 64 + lz, level)) return;
    }
    throw new Error(`tele ${spec} failed`);
}

// ---- bury: dropped vs queued while delayed ----
async function probeBury() {
    for (let n = 0; n < N; n++) {
        await fresh('give bones 10');
        const s0 = await nextTick(sdk);
        const bones = items(s0, /^bones$/i).slice(0, 5);
        const op = opOf(bones[0]!, /^bury/i)!;
        const before = count(s0, /^bones$/i);
        for (const b of bones) fire('bury', sdk.sendUseItem(b.slot, op));
        const s1 = await waitTicks(sdk, 6);
        result('bury burst5', { sent: 5, buried: before - count(s1, /^bones$/i), prayerXp: deltas(s0.tick, s1.tick, s => xp(s, 'prayer')) });
        flushRefusals('bury burst5');

        // one click per tick, always on the first bone the client still shows
        const start = (await nextTick(sdk)).tick;
        let sent = 0;
        for (let i = 0; i < 8; i++) {
            const s = i === 0 ? sdk.getState()! : await nextTick(sdk);
            const b = items(s, /^bones$/i)[0];
            if (b) { fire('bury', sdk.sendUseItem(b.slot, op)); sent++; }
        }
        const end = (await waitTicks(sdk, 4)).tick;
        const d = deltas(start, end, s => xp(s, 'prayer'));
        const ticks = Object.keys(d).map(Number);
        result('bury one-per-tick', { sent, buried: ticks.length, xpTicks: ticks, gaps: ticks.slice(1).map((t, i) => t - ticks[i]!) });
        flushRefusals('bury one-per-tick');
    }
}

// ---- held: 10 delay-free OPHELDs at once; identifies behind a bury ----
async function probeHeld() {
    await setstat(sdk, 'herblore', 99);
    for (let n = 0; n < N; n++) {
        await fresh('give unidentified_guam 10');
        const s0 = await nextTick(sdk);
        const herbs = items(s0, /./).filter(i => opOf(i, /^identify/i) !== undefined);
        for (const h of herbs) fire('identify', sdk.sendUseItem(h.slot, opOf(h, /^identify/i)!));
        const s1 = await waitTicks(sdk, 6);
        const left = items(s1, /./).filter(i => opOf(i, /^identify/i) !== undefined).length;
        const perTick = deltas(s0.tick, s1.tick, s => -items(s, /./).filter(i => opOf(i, /^identify/i) !== undefined).length);
        result('held identify burst10', { sent: herbs.length, identified: herbs.length - left, perTick });
        flushRefusals('held identify burst10');

        await fresh('give unidentified_guam 4', 'give bones 1');
        const t0 = await nextTick(sdk);
        const bone = items(t0, /^bones$/i)[0]!;
        const herbs2 = items(t0, /./).filter(i => opOf(i, /^identify/i) !== undefined);
        fire('bury', sdk.sendUseItem(bone.slot, opOf(bone, /^bury/i)!));
        for (const h of herbs2) fire('identify', sdk.sendUseItem(h.slot, opOf(h, /^identify/i)!));
        const t1 = await waitTicks(sdk, 6);
        result('held bury+identify4', { buried: 1 - count(t1, /^bones$/i), identified: herbs2.length - items(t1, /./).filter(i => opOf(i, /^identify/i) !== undefined).length });
        flushRefusals('held bury+identify4');
    }
}

// ---- charge: 5 per tick, and beside a fishing loop ----
async function probeCharge() {
    await setstat(sdk, 'magic', 99);
    await setstat(sdk, 'fishing', 99);
    await cheat(sdk, 'setvar magearena 8');
    const runes = ['give firerune 2000', 'give bloodrune 2000', 'give airrune 2000'];
    const casts = (s: BotWorldState) => -Math.round(count(s, /^fire rune$/i) / 3);

    for (let n = 0; n < N; n++) {
        await fresh(...runes);
        const s0 = await nextTick(sdk);
        for (let i = 0; i < 10; i++) fire('charge', sdk.sendClickComponent(CHARGE));
        const s1 = await waitTicks(sdk, 6);
        result('charge burst10', { sent: 10, cast: casts(s1) - casts(s0), perTick: deltas(s0.tick, s1.tick, casts), magicXp: xp(s1, 'magic') - xp(s0, 'magic') });
        flushRefusals('charge burst10');
    }

    // beside a fly-fishing loop that is clicked once
    await teleRetry(BARB_FLY);
    for (let n = 0; n < N; n++) {
        await fresh(...runes, 'give fly_fishing_rod 1', 'give feather 2000');
        const spot = sdk.getState()!.nearbyNpcs.filter(p => /^fishing spot$/i.test(p.name) && p.optionsWithIndex.some(o => /^lure/i.test(o.text))).sort((a, b) => a.distance - b.distance)[0];
        if (!spot) throw new Error('no lure spot');
        const lure = spot.optionsWithIndex.find(o => /^lure/i.test(o.text))!.opIndex;
        fire('lure', sdk.sendInteractNpc(spot.index, lure));
        const first = await waitUntil(sdk, s => xp(s, 'fishing') > xp(sdk.getState(), 'fishing') - 0 && false, { maxTicks: 0 }).catch(() => null);
        void first;
        const f0 = xp(sdk.getState(), 'fishing');
        const caught = await waitUntil(sdk, s => xp(s, 'fishing') > f0, { maxTicks: 40 });
        if (!caught.ok) { result('charge+fish', { error: 'no first catch' }); continue; }
        const start = caught.tick;
        let bursts = 0;
        for (let i = 1; i <= 40; i++) {
            await nextTick(sdk);
            if (i % 5 === 0) { for (let k = 0; k < 4; k++) fire('charge', sdk.sendClickComponent(CHARGE)); bursts++; }
        }
        const end = (await waitTicks(sdk, 3)).tick;
        const fish = deltas(start, end, s => xp(s, 'fishing'));
        const mag = deltas(start, end, s => xp(s, 'magic'));
        const both = Object.keys(fish).filter(t => t in mag).map(Number);
        result('charge+fish', { window: end - start, bursts, catches: Object.keys(fish).length, castTicks: Object.keys(mag).length, casts: (casts(byTick.get(end)!) - casts(byTick.get(start)!)), sameTickXp: both });
        flushRefusals('charge+fish');

        // control: one OPHELD (identify) while fishing; no re-click
        await cheat(sdk, 'give unidentified_guam 1');
        await waitTicks(sdk, 3);
        const h = items(sdk.getState(), /./).find(i => opOf(i, /^identify/i) !== undefined);
        const c0 = (await nextTick(sdk)).tick;
        if (h) fire('identify', sdk.sendUseItem(h.slot, opOf(h, /^identify/i)!));
        const c1 = (await waitTicks(sdk, 25)).tick;
        result('charge+fish control: one OPHELD', { catchesIn25Ticks: Object.keys(deltas(c0 + 1, c1, s => xp(s, 'fishing'))).length });
        flushRefusals('control');
    }
}

// ---- wine: timer restart and no level check at fermentation ----
async function probeWine() {
    for (let n = 0; n < N; n++) {
        await setstat(sdk, 'cooking', 35);
        await fresh('give grapes 10', 'give jug_water 10');
        const make = (s: BotWorldState, k: number) => {
            const g = items(s, /^grapes$/i);
            const j = items(s, /^jug of water$/i);
            for (let i = 0; i < Math.min(k, g.length, j.length); i++) fire('wine', sdk.sendUseItemOnItem(g[i]!.slot, j[i]!.slot));
        };
        const unf = (s: BotWorldState) => count(s, /^unfermented wine$/i);
        const a = await nextTick(sdk);
        const cook0 = xp(a, 'cooking');
        make(a, 5);
        await waitTicks(sdk, 10);
        const b = await nextTick(sdk);
        make(b, 5);
        const made = await waitUntil(sdk, s => unf(s) >= 10, { maxTicks: 6 });
        await setstat(sdk, 'cooking', 1);
        const done = await waitUntil(sdk, s => unf(s) === 0 && count(s, /^grapes$/i) === 0, { maxTicks: 45 });
        const e = done.state ?? sdk.getState()!;
        result('wine', {
            madeFirstBurstPerTick: deltas(a.tick, a.tick + 4, unf),
            made10: made.ok,
            fermentedAfterFirstBurst: done.tick - a.tick,
            fermentedAfterSecondBurst: done.tick - b.tick,
            cookingLevelAtFerment: e.skills.find(k => k.name.toLowerCase() === 'cooking')?.baseLevel,
            wine: count(e, /^jug of wine$/i),
            badWine: count(e, /^jug of bad wine$/i),
            cookingXp: xp(e, 'cooking') - cook0,
        });
        flushRefusals('wine');
    }
    await setstat(sdk, 'cooking', 99);
}

// ---- bankheld: OPHELD on the inventory tab with the bank open ----
async function probeBankHeld() {
    if (!(await tele(sdk, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z))) throw new Error('tele bank');
    for (let n = 0; n < N; n++) {
        await fresh('give bones 2');
        const opened = await bot.openBank();
        if (!opened.success) throw new Error(`openBank: ${opened.message}`);
        const s0 = await nextTick(sdk);
        const b = items(s0, /^bones$/i)[0]!;
        fire('bury (bank open)', sdk.sendUseItem(b.slot, opOf(b, /^bury/i)!));
        const s1 = await waitTicks(sdk, 5);
        result('bankheld', { bankOpenBefore: s0.bank.isOpen, bankOpenAfter: s1.bank.isOpen, buried: count(s0, /^bones$/i) - count(s1, /^bones$/i), prayerXp: xp(s1, 'prayer') - xp(s0, 'prayer') });
        flushRefusals('bankheld');
        await sdk.sendCloseModal();
        await waitTicks(sdk, 2);
    }
}

const table: Record<string, () => Promise<void>> = { bury: probeBury, held: probeHeld, charge: probeCharge, wine: probeWine, bankheld: probeBankHeld };
result('probe-engine start', { probes, n: N, host: process.env.HOSTNAME ?? '', tickrate: process.env.NODE_TICKRATE ?? '' });
for (const p of probes) {
    try {
        await table[p]!();
    } catch (e) {
        result(`${p} error`, String(e));
    }
}
await closeSession(session);
process.exit(0);
