// The fractionalizing still (regicide_fractionalizing_still.rs2), Rimmington
// (2927,3212). Opens the still with a barrel of coal-tar and plays a fixed,
// open-loop button schedule, then closes the window once regicide_still_total
// reaches 26 (the [if_close] handler swaps the empty barrel for naphtha).
//
//   bun docs/speedrun/scripts/quest-regicide-still.ts <bot> [runs] [delta] [sim]
//
// `sim` prints the offline model and the optimal schedule without a server.
// The schedule (found by exhaustive search in the model below, which mirrors
// the script line for line): before the first timer fire turn the pressure
// valve up once (26->27), the tar valve up twice (29->31) and add 2 coal; then
// add 1 coal before fires 6, 9 and 12. Total 14 fires of the 2-tick softtimer,
// 5 coal. `delta` shifts the later coal clicks by whole ticks to probe the
// timing margin. While it runs the script polls ::getvar regicide_still_total to
// log when each +2 lands.

import { runScript } from '../../../sdk/runner';
import { cheat, ensure, findLoc, getVar, invCount, now, result, setVar, tele, waitTicks, waitUntil } from './quest-regicide-lab';

const COM_CLOSE = 5030; // regicide_still:com_89
const COM_COAL = 5061; // com_120
const COM_VALVE_UP = 6174; // com_130 (pressure valve 26->27->28)
const COM_TAR_UP = 6176; // com_132 (tar regulator 29->30->31)

// ---------- offline model ----------
type S = { t: number; h: number; p: number; tot: number; valve: number; tar: number };
export function fire(s0: S): S {
    const s = { ...s0 };
    if (s.tot >= 26) return s;
    let dp = 0;
    if (s.valve === 1) dp -= 2; else if (s.valve === 2) dp -= 4;
    if (s.tar === 1) dp += 1; else if (s.tar === 2) dp += 2;
    const reset = () => Object.assign(s, { t: 0, tot: 0, h: 0, p: 0, valve: 0, tar: 0 });
    const np = Math.max(0, s.p + dp);
    if (np > 12) { reset(); return s; }
    s.p = np;
    const ch = (d: number) => { const nh = Math.max(0, s.h + d); if (nh > 12) { reset(); return false; } s.h = nh; return true; };
    let ok = true;
    if (s.t === 0) ok = ch(-1);
    if (ok && s.t > 80) ok = ch(2);
    if (ok) { if (s.t === 80) ok = ch(-1); else if (s.t > 50) ok = ch(1); }
    if (s.t > 0) s.t = Math.max(0, s.t - (5 + 6 * s.h));
    if (s.tar === 2 && s.h >= 6 && s.h <= 11) s.tot += 2;
    return s;
}

export function bestPlan(maxCoal = 3) {
    let frontier = new Map<string, { s: S; plan: number[] }>();
    const s0: S = { t: 0, h: 0, p: 0, tot: 0, valve: 1, tar: 2 };
    frontier.set(JSON.stringify(s0), { s: s0, plan: [] });
    const sum = (p: number[]) => p.reduce((a, b) => a + b, 0);
    for (let k = 1; k <= 40; k++) {
        const next = new Map<string, { s: S; plan: number[] }>();
        for (const { s, plan } of frontier.values()) {
            for (let c = 0; c <= maxCoal; c++) {
                const s1 = fire({ ...s, t: s.t + 60 * c });
                const p2 = [...plan, c];
                if (s1.tot >= 26) return { fires: k, plan: p2, coal: sum(p2) };
                const key = JSON.stringify(s1);
                const prev = next.get(key);
                if (!prev || sum(prev.plan) > sum(p2)) next.set(key, { s: s1, plan: p2 });
            }
        }
        frontier = next;
    }
    return null;
}

export function simulate(plan: number[]) {
    let s: S = { t: 0, h: 0, p: 0, tot: 0, valve: 1, tar: 2 };
    const rows: string[] = [];
    for (let k = 0; k < 40 && s.tot < 26; k++) {
        const c = plan[k] ?? 0;
        s.t += 60 * c;
        const before = s.t;
        s = fire(s);
        rows.push(`fire ${k + 1}: coal ${c}, temp in ${before}, heat ${s.h}, pressure ${s.p}, total ${s.tot}`);
    }
    return { fires: rows.length, rows, total: s.tot };
}

const argv = process.argv.slice(2);
if (argv.includes('sim')) {
    const best = bestPlan();
    console.log(JSON.stringify(best));
    for (const r of simulate(best!.plan).rows) console.log(r);
    // sensitivity: each later coal one fire early or late
    for (const shift of [-1, 1]) {
        for (const k of [5, 8, 11]) {
            const p = [...best!.plan];
            p[k] = 0;
            p[k + shift] = (p[k + shift] ?? 0) + 1;
            console.log(`coal ${k + 1} moved ${shift > 0 ? 'late' : 'early'}: ${simulate(p).fires} fires`);
        }
    }
    process.exit(0);
}

const runs = Number(argv[1] ?? 1);
const delta = Number(argv[2] ?? 0);

await runScript(async ({ sdk }) => {
    const out: unknown[] = [];
    for (let run = 0; run < runs; run++) {
        await tele(sdk, 2928, 3213, 0);
        await setVar(sdk, 'regicide_still_total', 0);
        await ensure(sdk, 'regicide_barrel_tar', /^Barrel of coal-tar$/i, 1);
        await ensure(sdk, 'coal', /^Coal$/i, 8);
        const coal0 = invCount(sdk, /^Coal$/i);
        const still = await findLoc(sdk, 2927, 3212);
        if (!still) throw new Error('still not found');
        const tar = sdk.getInventory().find(i => /^Barrel of coal-tar$/i.test(i.name))!;
        const t0 = now(sdk);
        await sdk.sendUseItemOnLoc(tar.slot, still.x, still.z, still.id);
        const open = await waitUntil(sdk, s => !!(s.modalOpen || s.interface?.isOpen), 30);
        if (!open) throw new Error('still interface never opened');
        const s0 = open.tick;
        // Before fire 1: valve up, tar up x2, coal x2 (5 events = the per-tick cap).
        await sdk.sendClickComponent(COM_VALVE_UP);
        await sdk.sendClickComponent(COM_TAR_UP);
        await sdk.sendClickComponent(COM_TAR_UP);
        await sdk.sendClickComponent(COM_COAL);
        await sdk.sendClickComponent(COM_COAL);
        const coalAt = [6, 9, 12].map(k => s0 + 2 * k - 2 + delta);
        const log: Array<[number, number | null]> = [];
        let done: number | null = null;
        while (now(sdk) - s0 < 80) {
            const t = now(sdk);
            while (coalAt.length && t >= coalAt[0]) {
                coalAt.shift();
                await sdk.sendClickComponent(COM_COAL);
            }
            if (coalAt.length) { await waitTicks(sdk, 1); continue; }
            const v = await getVar(sdk, 'regicide_still_total');
            log.push([now(sdk) - s0, v]);
            if (v !== null && v >= 26) { done = now(sdk); break; }
        }
        await sdk.sendClickComponent(COM_CLOSE);
        const got = await waitUntil(sdk, () => invCount(sdk, /^Barrel of naphtha$/i) > 0, 10);
        out.push({
            run, delta,
            openTick: s0 - t0,
            totalReached26: done === null ? null : done - s0,
            naphthaFromClick: got === null ? null : got.tick - t0,
            coalUsed: coal0 - invCount(sdk, /^Coal$/i),
            totalLog: log,
        });
        result('still', out[out.length - 1]);
        // drop the naphtha so the next run starts clean
        for (const it of sdk.getInventory().filter(i => /^Barrel/i.test(i.name))) { await sdk.sendDropItem(it.slot); await waitTicks(sdk, 1); }
        void cheat;
    }
}, { timeout: 900_000 });
