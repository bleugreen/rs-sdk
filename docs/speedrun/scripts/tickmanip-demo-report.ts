// Summarise a tickmanip-demo.sh run: ticks per log and ticks per expected roll per
// condition. The demo's xp rate moves the account through many levels during a run, and the
// normal-tree success chance rises with level (stat_random(64, 200) for a bronze axe,
// trees.dbrow), so each log is weighted by the rolls expected at the level it was cut at.
// The walk to the next tree is in both numbers, so ticks per expected roll sits above the
// 4 (plain) and 3 (knife) of the loops themselves.
//
//   bun docs/speedrun/scripts/tickmanip-demo-report.ts <dir with r<round>-<condition>.log>
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const dir = process.argv[2];
if (!dir) {
    console.error('usage: bun docs/speedrun/scripts/tickmanip-demo-report.ts <dir>');
    process.exit(2);
}
const p = (L: number) => Math.min(1, (Math.floor((64 * (99 - L)) / 98) + Math.floor((200 * (L - 1)) / 98) + 1) / 256);

interface Block { round: number; cond: string; ticks: number; logs: number; expRolls: number; lv: [number, number]; gate: string[]; probe: string }
const blocks: Block[] = [];
for (const f of readdirSync(dir).filter(n => /^r\d+-.+\.log$/.test(n)).sort()) {
    const [, round, cond] = f.match(/^r(\d+)-(.+)\.log$/)!;
    const text = readFileSync(join(dir, f), 'utf-8');
    let level = Number(text.match(/setup tick=\d+ .* level=(\d+)/)?.[1] ?? 1);
    const drops: Array<[number, number]> = [];
    for (const line of text.split('\n')) {
        const m = line.match(/^T(\d+) (XP|LEVEL) \+?(\d+)/);
        if (!m) continue;
        if (m[2] === 'LEVEL') level = Number(m[3]);
        else drops.push([Number(m[1]), level]);
    }
    if (drops.length < 2) continue;
    blocks.push({
        round: Number(round),
        cond: cond!,
        ticks: drops[drops.length - 1]![0] - drops[0]![0],
        logs: drops.length - 1,
        expRolls: drops.slice(1).reduce((a, [, L]) => a + 1 / p(L), 0),
        lv: [drops[0]![1], drops[drops.length - 1]![1]],
        gate: [...text.matchAll(/gate \(([\w ]+)\).*-> (.*)$/gm)].map(m => `${m[1]}: ${m[2]}`),
        probe: text.match(/gate \(start\): latency ([0-9: ]+) of/)?.[1] ?? '',
    });
}
const fmt = (t: number, n: number, r: number) => `${(t / n).toFixed(2)} per log, ${(t / r).toFixed(2)} per expected roll`;
for (const b of blocks) console.log(`r${b.round} ${b.cond.padEnd(10)} ${b.ticks} ticks, ${b.logs} logs, level ${b.lv[0]}-${b.lv[1]}: ${fmt(b.ticks, b.logs, b.expRolls)}${b.probe ? `; gate probe ${b.probe}` : ''}${b.gate.length ? ` [${b.gate.join('; ')}]` : ''}`);
for (const cond of [...new Set(blocks.map(b => b.cond))]) {
    const bs = blocks.filter(b => b.cond === cond);
    const sum = (k: 'ticks' | 'logs' | 'expRolls') => bs.reduce((a, b) => a + b[k], 0);
    console.log(`ALL ${cond.padEnd(10)} ${sum('logs')} logs: ${fmt(sum('ticks'), sum('logs'), sum('expRolls'))}`);
}
