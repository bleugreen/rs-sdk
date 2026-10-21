#!/usr/bin/env bun
/**
 * Firemaking route model. Content values are read (firemaking.obj,
 * firemaking.rs2, flamtaer_pyre.struct); cadences come from
 * firemaking-line.ts, firemaking-supply.ts and firemaking-pyre.ts; outputs
 * are inferred.
 *
 *   bun docs/speedrun/scripts/firemaking-model.ts [--from=1] [--to=99]
 *       [--resupply=TICKS] [--per=27] [--pyrecycle=TICKS]
 *
 * Lighting: every roll costs 4 ticks once rolls are chained (each success or
 * failure re-arms %action_delay by 4, firemaking.rs2:62,73), and succeeds with
 * stat_random(firemaking, 64, 512) for every log tier. Expected ticks per fire
 * = 4 / p(L). The highest unlocked tier is always used, since every tier
 * costs the same ticks. --resupply is the extra ticks one inventory refill
 * adds to the line (measured: trade, bank; 0 for helper-dropped ground rows),
 * charged once per --per logs.
 * Pyre logs: 60 base per yew (or magic) pyre log, 14 per inventory, one
 * inventory per --pyrecycle ticks (creation clicks plus the swap trade).
 */
const argv = process.argv.slice(2);
const arg = (n: string, d: string) => argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const FROM = Number(arg('from', '1'));
const TO = Number(arg('to', '99'));
const PER = Number(arg('per', '27'));

// Player.ts levelExperience, in base xp (game xp / 25).
const levelBase: number[] = [0, 0];
let acc = 0;
for (let level = 1; level < 99; level++) {
    acc += Math.floor(level + Math.pow(2, level / 10) * 300);
    levelBase[level + 1] = (Math.floor(acc / 4) * 10) / 10 / 25;
}
const levelOf = (xp: number) => { let l = 1; while (l < 99 && levelBase[l + 1] <= xp) l++; return l; };
const p = (L: number) => Math.min(1, (Math.floor((64 * (99 - L)) / 98) + Math.floor((512 * (L - 1)) / 98) + 1) / 256);

// firemaking.obj: levelrequire, productexp (tenths).
const TIERS = [
    { name: 'logs', level: 1, xp: 40 }, { name: 'oak_logs', level: 15, xp: 60 }, { name: 'willow_logs', level: 30, xp: 90 },
    { name: 'maple_logs', level: 45, xp: 135 }, { name: 'yew_logs', level: 60, xp: 202.5 }, { name: 'magic_logs', level: 75, xp: 303.8 },
];

export function lighting(from: number, to: number, resupply: number, per = PER) {
    let xp = levelBase[from], ticks = 0, logs = 0;
    const used: Record<string, number> = {};
    const bands: Record<string, { ticks: number; fires: number }> = {};
    while (xp < levelBase[to]) {
        const L = levelOf(xp);
        const tier = [...TIERS].reverse().find(t => t.level <= L)!;
        const dt = 4 / p(L) + (++logs % per === 0 ? resupply : 0);
        ticks += dt; xp += tier.xp;
        used[tier.name] = (used[tier.name] ?? 0) + 1;
        const b = (bands[tier.name] ??= { ticks: 0, fires: 0 }); b.ticks += dt; b.fires++;
    }
    return { ticks: Math.round(ticks), logs, used, bands };
}

export function pyre(from: number, to: number, cycle: number) {
    const need = levelBase[to] - levelBase[from];
    const creates = Math.ceil(need / 60);
    return { ticks: Math.round((creates / 14) * cycle), creates, inventories: Math.ceil(creates / 14) };
}

if (import.meta.main) {
    const R = argv.find(a => a.startsWith('--resupply='));
    const resupplies = R ? [Number(R.slice(11))] : [0, 5, 9, 15, 25];
    console.log(`levels ${FROM} -> ${TO}: ${(levelBase[TO] - levelBase[FROM]).toFixed(1)} base xp`);
    for (const r of resupplies) {
        const m = lighting(FROM, TO, r);
        console.log(`lighting, resupply ${r} ticks per ${PER} logs: ${m.ticks} ticks, ${m.logs} logs ${JSON.stringify(m.used)}`);
        console.log('   bands: ' + Object.entries(m.bands).map(([k, v]) => `${k} ${Math.round(v.ticks)}t/${v.fires}`).join(', '));
    }
    const pc = argv.find(a => a.startsWith('--pyrecycle='));
    for (const c of pc ? [Number(pc.slice(12))] : [8, 12, 15]) {
        const m = pyre(FROM, TO, c);
        console.log(`pyre logs, ${c} ticks per 14: ${m.ticks} ticks, ${m.creates} yew logs + ${m.creates} sacred oil(4), ${m.inventories} inventories`);
    }
    for (const L of [1, 10, 20, 30, 40, 43, 44]) console.log(`p(${L}) = ${p(L).toFixed(4)}`);
}
