// The time table of docs/markets/hp-training.md from hp-run.ts's JSONL files.
//
//   bun markets/methods/lab/hp-report.ts /tmp/hp-run-*.jsonl
//
// One row per file: the bot's kit, its Prayer phase (bones buried, the tick the Prayer level was
// reached), and at each Hitpoints mark the ticks and wall minutes from the trainer's start with
// Attack and Strength there; then food, bank trips, altar visits, deaths and coins.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

interface Rec {
    kind: string;
    message?: string;
    [k: string]: unknown;
}

export interface Row {
    bot: string;
    weapons: string[];
    prayer: { level: number; bones: number; tick: number } | null;
    marks: Record<number, { tick: number; minutes: number; attack: number; strength: number }>;
    eats: number;
    kebabsBought: number;
    bankTrips: number;
    altars: number;
    deaths: number;
    coins: number;
    end: string;
}

export function summarise(bot: string, recs: readonly Rec[]): Row {
    const ev = (m: string) => recs.filter(r => r.kind === 'event' && r.message === m);
    const totals = recs.filter(r => r.kind === 'totals').at(-1);
    const marks: Row['marks'] = {};
    for (const m of ev('mark')) marks[m.hp as number] = { tick: m.tick as number, minutes: Math.round(((m.wallMs as number) / 60000) * 10) / 10, attack: m.attack as number, strength: m.strength as number };
    const cows = ev('low trip');
    const reachedAt = cows.find(c => (c.prayer as number) > 1 && c.end === 'until');
    const bones = cows.reduce((n, c) => n + Number(c.bonesBuried ?? 0), 0);
    const buys = recs.filter(r => r.kind === 'event' && typeof r.item === 'string' && 'price' in r);
    const spent = buys.reduce((n, b) => n + Number(b.price ?? 0), 0) + Number(totals?.coinsKebabs ?? 0) + Number(totals?.tollPaid ?? 0);
    return {
        bot,
        weapons: buys.filter(b => b.ok).map(b => String(b.item).replace(/ scimitar$/i, '')),
        prayer: bones ? { level: Number(reachedAt?.prayer ?? 0), bones, tick: Number(reachedAt?.tick ?? 0) } : null,
        marks,
        eats: recs.filter(r => r.kind === 'event' && r.message === 'eat').length + Number(totals?.eatsBeforeCrossing ?? 0),
        kebabsBought: Number(totals?.kebabsBought ?? 0),
        bankTrips: totals ? Number(totals.bankTrips ?? 0) : ev('bank').filter(b => /crabs bank/.test(String(b.at))).length,
        altars: ev('altar').length,
        deaths: ev('died').length,
        coins: spent,
        end: totals ? (totals.error ? `error: ${String(totals.error)}` : 'done') : 'running'
    };
}

if (import.meta.main) {
    const levels = [30, 40, 50, 60, 70, 80, 90, 99];
    console.log(`| Bot | Kit | Prayer phase | ${levels.map(l => `HP ${l}`).join(' | ')} | Eaten | Bank trips | Altars | Deaths | Coins | End |`);
    console.log(`|---|---|---|${levels.map(() => '---').join('|')}|---|---|---|---|---|---|`);
    for (const f of process.argv.slice(2)) {
        const recs = readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as Rec);
        const r = summarise(basename(f).replace(/\.jsonl$/, '').replace(/^.*-/, ''), recs);
        const cell = (l: number) => (r.marks[l] ? `${r.marks[l]!.tick} (${r.marks[l]!.minutes} min, ${r.marks[l]!.attack}/${r.marks[l]!.strength})` : '');
        const pr = r.prayer ? `${r.prayer.level} at ${r.prayer.tick}, ${r.prayer.bones} bones` : '-';
        console.log(`| ${r.bot} | ${r.weapons.join(', ')} | ${pr} | ${levels.map(cell).join(' | ')} | ${r.eats} | ${r.bankTrips} | ${r.altars} | ${r.deaths} | ${r.coins} | ${r.end} |`);
    }
}
