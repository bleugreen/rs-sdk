#!/usr/bin/env bun
/**
 * Gentle wealth poller for the public demo: the bank board's top 50, /playerpositions and the GE bid pool (one
 * book page ranked by coins committed), once per interval
 * (never more often than every 5 minutes), appended to docs/markets/data/poll-<block>.json, one file per block
 * of UTC hours. Public HTTP only; it never logs in. Format and decoding: markets/lib/snapshots.ts.
 *
 *   bun markets/tools/poll.ts [--every=300] [--block-hours=6] [--out=docs/markets/data] [--once] [--server=HOST]
 *
 * Each poll also records every player standing in the watched zones (markets/lib/positions.ts ZONES: the GE
 * table, the banks, the fishing spots, the essence mine and the air altar). Each poll prints the leaders, online
 * family counts and zone headcounts; a gain too large for ordinary play between two polls
 * (markets/lib/snapshots.ts jumps()) prints a JUMP line and saves jump-<stamp>.json: the jumps, everyone within
 * 8 tiles of each online jumper, and the full position lists of that poll and the one before.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readBank } from '../lib/boards.ts';
import { DEMO_SERVER, Gentle } from '../lib/demo.ts';
import { bidPool, DemoMarket, readBids } from '../lib/market.ts';
import { familyOf } from '../lib/families.ts';
import { playerNameKey, readPositions, zoneRoster, type Position } from '../lib/positions.ts';
import { decodePolls, encodePoll, formatPollFile, jumps, type BankRow, type PollFile } from '../lib/snapshots.ts';

const MIN_EVERY_S = 300;
export const DEFAULT_OUT = resolve(import.meta.dir, '../../docs/markets/data');

/** `poll-2026-10-22T18Z.json` for the block of `hours` UTC hours holding `at`. */
export function blockFile(at: Date, hours: number): string {
    const h = Math.floor(at.getUTCHours() / hours) * hours;
    return `poll-${at.toISOString().slice(0, 10)}T${String(h).padStart(2, '0')}Z.json`;
}

/** For each jumping account that is online, everyone within `radius` tiles of it on its level. */
export function jumpNeighbours(found: { name: string }[], positions: Position[], radius = 8): Record<string, Position[] | null> {
    const out: Record<string, Position[] | null> = {};
    for (const j of found) {
        const me = positions.find(p => playerNameKey(p.name) === playerNameKey(j.name));
        out[j.name] = me ? positions.filter(p => p !== me && p.level === me.level && Math.abs(p.x - me.x) <= radius && Math.abs(p.z - me.z) <= radius) : null;
    }
    return out;
}

const gp = (n: number): string => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : `${(n / 1e6).toFixed(1)}M`);

async function main(): Promise<void> {
    const { values } = parseArgs({
        args: Bun.argv.slice(2),
        options: { every: { type: 'string' }, 'block-hours': { type: 'string' }, out: { type: 'string' }, once: { type: 'boolean' }, server: { type: 'string' } }
    });
    const every = Number(values.every ?? MIN_EVERY_S);
    if (!(every >= MIN_EVERY_S)) throw new Error(`--every must be at least ${MIN_EVERY_S} seconds (tenet 28)`);
    const blockHours = Number(values['block-hours'] ?? 6);
    if (!(blockHours >= 1 && 24 % blockHours === 0)) throw new Error('--block-hours must divide 24');
    const out = values.out ? resolve(values.out) : DEFAULT_OUT;
    mkdirSync(out, { recursive: true });
    const g = new Gentle({ server: values.server ?? DEMO_SERVER });
    const market = new DemoMarket(g);
    let previous: BankRow[] | null = null;
    let previousPositions: Position[] | null = null;

    for (let next = Date.now(); ; ) {
        const at = new Date();
        const bank = await readBank(g).catch(e => (console.error(`${at.toISOString()} bank: ${e instanceof Error ? e.message : e}`), null));
        const positions: Position[] | null = await readPositions(g).catch(e => (console.error(`${at.toISOString()} positions: ${e instanceof Error ? e.message : e}`), null));
        const bids = await readBids(market, 7).then(bidPool, e => (console.error(`${at.toISOString()} bids: ${e instanceof Error ? e.message : e}`), null));

        const path = join(out, blockFile(at, blockHours));
        const file: PollFile = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { v: 1, source: g.origin, polls: [] };
        if (previous === null && file.polls.length) previous = decodePolls(file).findLast(p => p.bank)?.bank ?? null;
        const record = encodePoll(file, at.toISOString(), bank, positions, n => familyOf(n) !== null, ps => zoneRoster(ps));
        if (bids) record.bids = bids;
        file.polls.push(record);
        writeFileSync(path, formatPollFile(file));

        const online = new Map<string, number>();
        for (const p of positions ?? []) {
            const f = familyOf(p.name);
            if (f) online.set(f, (online.get(f) ?? 0) + 1);
        }
        const leaders = (bank ?? []).slice(0, 5).map(r => `${r.name} ${gp(r.gp)}`).join(', ');
        console.log(`${at.toISOString().slice(0, 16)}Z online=${positions?.length ?? '?'} | ${leaders || 'bank read failed'} | families online ${[...online].map(([f, n]) => `${f} ${n}`).join(', ')}`);
        if (bids) console.log(`  bid pool: ${bids.items} items, ${gp(bids.value)} committed`);
        if (record.zones) console.log(`  zones: ${Object.entries(record.zones).map(([z, names]) => `${z} ${names.length}`).join(', ')}`);
        if (bank && previous) {
            const found = jumps(previous, bank);
            for (const j of found) console.log(`  JUMP ${j.name} ${j.from === null ? 'new' : gp(j.from)} -> ${gp(j.to)} (+${gp(j.delta)})`);
            if (found.length) {
                const jumpFile = join(out, `jump-${at.toISOString().replace(/[:]/g, '').replace(/\.\d+Z$/, 'Z')}.json`);
                writeFileSync(jumpFile, JSON.stringify({ at: at.toISOString(), jumps: found, near: jumpNeighbours(found, positions ?? []), positionsBefore: previousPositions, positionsAfter: positions }));
                console.log(`  saved ${jumpFile}`);
            }
        }
        if (bank) previous = bank;
        if (positions) previousPositions = positions;
        if (values.once) return;
        next += every * 1000;
        await Bun.sleep(Math.max(0, next - Date.now()));
    }
}

if (import.meta.main) await main();
