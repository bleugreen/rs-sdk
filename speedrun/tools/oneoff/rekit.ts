#!/usr/bin/env bun
// Re-kit SCORED after a death (host's rekit-a3.ts, attempt 3): record what it kept by id, take each
// courier's trade in turn, check the pack against a want-list, optionally hand items back, cast a
// teleport and walk to a tile. Only through the wrapper:
//
//   bun speedrun/tools/oneoff.ts rekit --couriers=HEX[,HEX...] --meet=X,Z[,L]
//       [--optional=HEX,...] [--optional-wait=600] [--optional-items=ID,...]
//       [--want=FILE] [--drop=ID,...] [--swap-give=ID,...] [--give-after=ID,... [--give-to=HEX]]
//       [--teleport=SPELL] [--to=X,Z[,L]] [--walk-timeout=480] [--go]
//
// --couriers  name-hash prefixes (lib/oneoff.ts findCourier), traded in this order. Every courier not
//             in --optional must be listed within 6 tiles of --meet at preflight, and SCORED within 10
//             of it once in the world. The first courier may not be optional.
// --optional  couriers that may come late: each is waited for (--optional-wait seconds) until it is
//             within 6 tiles of SCORED, and skipped if it never comes or its trade fails.
// --optional-items  ids left out of the want check when an optional courier was missed (in attempt 3
//             the amulet's courier).
// --want      a JSON file {id: count}: after the trades the pack must hold at least that many of each;
//             --drop ids are left out of it.
// --swap-give one of each id given inside the first courier's trade; --give-after one of each given in a
//             separate trade afterwards, to --give-to (default the first courier), then checked gone.
// --teleport  a spell in lib/travel.ts SPELLS, skipped (teleport-skip) when teleportRefusal says no.
// --to        a walk at the end (bot.walkTo, --walk-timeout seconds; 480 for Lumbridge to the Ardougne
//             landing), checked on the exact tile and level.

import { readFileSync } from 'fs';
import { give, receiveFrom, swap, type GiveSpec } from '../../lib/trade';
import { SPELLS, teleport, teleportRefusal, type Spell } from '../../lib/travel';
import { byId, type ById, EXIT, findCourier, flag, intFlag, parseTile, runOneoff, type Tile, tileOf } from '../../lib/oneoff';
import type { BotWorldState } from '../../../sdk/types';

const USAGE =
    'usage: bun speedrun/tools/oneoff.ts rekit --couriers=HEX[,HEX...] --meet=X,Z[,L] [--optional=HEX,...] [--optional-wait=600] [--optional-items=ID,...] [--want=FILE] [--drop=ID,...] [--swap-give=ID,...] [--give-after=ID,... [--give-to=HEX]] [--teleport=SPELL] [--to=X,Z[,L]] [--walk-timeout=480] [--go]';
/** How far SCORED may stand from --meet once logged in. */
export const SCORED_WITHIN = 10;
/** Ticks after walkTo for the player to settle on the tile. */
export const SETTLE_TICKS = 25;
/** Wall ms between player-list reads while an optional courier is waited for. */
export const OPTIONAL_POLL_MS = 5_000;

export interface RekitConfig {
    couriers: string[];
    optional: Set<string>;
    optionalWaitS: number;
    optionalItems: number[];
    meet: Tile;
    want: ById | null;
    swapGive: number[];
    giveAfter: number[];
    giveTo: string;
    teleport: Spell | null;
    to: Tile | null;
    walkTimeoutS: number;
}

const HASH = /^[0-9a-f]{6,64}$/;

function list(argv: readonly string[], name: string): string[] {
    return (flag(argv, name) ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

function ids(argv: readonly string[], name: string): number[] | string {
    const l = list(argv, name);
    return l.every(s => /^\d+$/.test(s)) ? l.map(Number) : `--${name} takes obj ids`;
}

/** The flags as a config, or why they don't make one. `read` loads --want's file. */
export function parseRekit(argv: readonly string[], read: (path: string) => string = p => readFileSync(p, 'utf8')): RekitConfig | string {
    const couriers = list(argv, 'couriers');
    if (!couriers.length) return '--couriers is required';
    if (!couriers.every(h => HASH.test(h))) return 'each courier is a name-hash prefix of 6 to 64 hex digits';
    if (new Set(couriers).size !== couriers.length) return 'a courier is named twice';
    const optional = new Set(list(argv, 'optional'));
    for (const h of optional) if (!couriers.includes(h)) return `--optional ${h} is not in --couriers`;
    if (optional.has(couriers[0]!)) return 'the first courier may not be optional';
    const meet = parseTile(flag(argv, 'meet'));
    if (!meet) return '--meet=X,Z[,LEVEL] is required';
    const optionalWaitS = intFlag(argv, 'optional-wait') ?? 600;
    const walkTimeoutS = intFlag(argv, 'walk-timeout') ?? 480;
    if (Number.isNaN(optionalWaitS) || Number.isNaN(walkTimeoutS)) return '--optional-wait and --walk-timeout take seconds';
    const optionalItems = ids(argv, 'optional-items');
    const drop = ids(argv, 'drop');
    const swapGive = ids(argv, 'swap-give');
    const giveAfter = ids(argv, 'give-after');
    for (const l of [optionalItems, drop, swapGive, giveAfter]) if (typeof l === 'string') return l;
    const giveTo = flag(argv, 'give-to')?.toLowerCase() ?? couriers[0]!;
    if (!couriers.includes(giveTo) || optional.has(giveTo)) return '--give-to must be one of the couriers, not an optional one';
    const spell = flag(argv, 'teleport');
    if (spell !== undefined && !(spell in SPELLS)) return `--teleport takes one of ${Object.keys(SPELLS).join(', ')}`;
    const toArg = flag(argv, 'to');
    const to = toArg === undefined ? null : parseTile(toArg);
    if (toArg !== undefined && !to) return '--to takes X,Z[,LEVEL]';
    let want: ById | null = null;
    const wantFile = flag(argv, 'want');
    if (wantFile) {
        let j: unknown;
        try {
            j = JSON.parse(read(wantFile));
        } catch (e) {
            return `--want ${wantFile}: ${e instanceof Error ? e.message : String(e)}`;
        }
        if (!j || typeof j !== 'object' || Array.isArray(j)) return '--want is a JSON object {id: count}';
        want = {};
        for (const [id, n] of Object.entries(j as Record<string, unknown>)) {
            if (!/^\d+$/.test(id) || typeof n !== 'number' || !Number.isInteger(n) || n < 0) return `--want: ${id}: ${String(n)} is not an id and a count`;
            want[Number(id)] = n;
        }
        for (const id of drop as number[]) delete want[id];
    }
    return {
        couriers,
        optional,
        optionalWaitS,
        optionalItems: optionalItems as number[],
        meet,
        want,
        swapGive: swapGive as number[],
        giveAfter: giveAfter as number[],
        giveTo,
        teleport: (spell as Spell | undefined) ?? null,
        to,
        walkTimeoutS,
    };
}

/** The want-list's shortfalls against the pack, with the missed optional couriers' items left out. */
export function censusShort(want: ById, pack: ById, leaveOut: readonly number[] = []): string[] {
    return Object.entries(want)
        .filter(([id]) => !leaveOut.includes(Number(id)))
        .filter(([id, n]) => (pack[Number(id)] ?? 0) < n)
        .map(([id, n]) => `${id}: have ${pack[Number(id)] ?? 0}, want ${n}`);
}

const items = (l: BotWorldState['inventory']) => l.filter(Boolean).map(i => [i.id, i.name, i.count]);
const ones = (l: readonly number[]): GiveSpec[] => l.map(id => ({ item: id, n: 1 }));

if (import.meta.main) {
    const argv = process.argv.slice(2);
    const cfg = parseRekit(argv);
    if (typeof cfg === 'string') {
        console.log(`usage error: ${cfg}`);
        console.log(USAGE);
        process.exit(EXIT.usage);
    }
    /** Courier name by hash, for the required ones (preflight) and each optional one that comes. */
    const names = new Map<string, string>();
    const label = (h: string) => `courier ${cfg.couriers.indexOf(h) + 1}`;
    process.exit(
        await runOneoff({
            kind: 'rekit',
            argv,
            pathfinding: true,
            at: { tile: cfg.meet, within: SCORED_WITHIN },
            preflight: async c => {
                for (const h of cfg.couriers) {
                    if (cfg.optional.has(h)) continue;
                    const found = findCourier(c.roster, h, cfg.meet, c.redact);
                    if (typeof found === 'string') return `${label(h)}: ${found}`;
                    names.set(h, found.name);
                }
                if (new Set(names.values()).size !== names.size) return 'two courier hashes match the same player';
                const first = c.roster.find(p => p.name === names.get(cfg.couriers[0]!))!;
                return {
                    couriers: cfg.couriers.length,
                    optional: cfg.optional.size,
                    first: { x: first.x, z: first.z, level: first.level },
                    want: cfg.want,
                    teleport: cfg.teleport,
                    to: cfg.to,
                };
            },
            act: async c => {
                const s0 = c.state();
                c.out('keep3', { inventory: items(s0.inventory), worn: items(s0.equipment) });
                const missed: string[] = [];
                for (const [i, h] of cfg.couriers.entries()) {
                    const optional = cfg.optional.has(h);
                    if (optional) {
                        const t1 = Date.now();
                        let near = false;
                        while (Date.now() - t1 < cfg.optionalWaitS * 1000) {
                            const me = tileOf(c.state());
                            const found = me ? findCourier((await c.roster()) ?? [], h, me, c.redact) : 'no tile';
                            if (typeof found !== 'string') {
                                names.set(h, found.name);
                                near = true;
                                break;
                            }
                            await c.sleep(OPTIONAL_POLL_MS);
                        }
                        c.out('optional-wait', { courier: label(h), near, waitedS: Math.round((Date.now() - t1) / 1000) });
                        if (!near) {
                            missed.push(h);
                            continue;
                        }
                    }
                    const name = names.get(h)!;
                    const openTicks = optional ? 300 : 750;
                    let ok: boolean;
                    if (cfg.swapGive.length && i === 0) {
                        const r = await swap(c.session.sdk, name, ones(cfg.swapGive), [], { openTicks, maxTicks: 200 });
                        c.out('swap', { with: label(h), ok: r.ok, ticks: r.ticks, gave: r.gave.map(t => [t.id, t.name, t.count]), received: r.received.map(t => [t.id, t.name, t.count]), reason: r.reason ?? null });
                        ok = r.ok;
                    } else {
                        const r = await receiveFrom(c.session.sdk, name, { maxTicks: 200, openMaxTicks: openTicks });
                        c.out('receive', { from: label(h), ok: r.ok, ticks: r.ticks, received: r.received.map(t => [t.id, t.name, t.count]), reason: r.reason ?? null });
                        ok = r.ok;
                    }
                    if (!ok) {
                        if (optional) {
                            missed.push(h);
                            continue;
                        }
                        c.out('CHECK-FAIL', `the trade with ${label(h)} failed`);
                        return false;
                    }
                }
                if (missed.length) c.out('optional-missed', { missed: missed.map(label), leftOut: cfg.optionalItems });
                if (cfg.want) {
                    const short = censusShort(cfg.want, byId(c.state().inventory), missed.length ? cfg.optionalItems : []);
                    c.out('census', { short, ok: short.length === 0 });
                    if (short.length) {
                        c.out('CHECK-FAIL', 'census short');
                        return false;
                    }
                }
                if (cfg.giveAfter.length) {
                    const g = await give(c.session.sdk, names.get(cfg.giveTo)!, ones(cfg.giveAfter), { maxTicks: 200, openMaxTicks: 750 });
                    c.out('give-after', { to: label(cfg.giveTo), ok: g.ok, ticks: g.ticks, gave: g.gave.map(t => [t.id, t.name, t.count]), reason: g.reason ?? null });
                    const left = byId(c.state().inventory);
                    const still = cfg.giveAfter.filter(id => (left[id] ?? 0) > 0);
                    if (!g.ok || still.length) {
                        c.out('CHECK-FAIL', { why: 'give-after', ok: g.ok, still });
                        return false;
                    }
                }
                if (cfg.teleport) {
                    const why = teleportRefusal(c.state(), cfg.teleport);
                    if (why) c.out('teleport-skip', why);
                    else {
                        const t = await teleport(c.session.sdk, cfg.teleport);
                        c.out('teleport', { spell: cfg.teleport, ok: t.ok, ticks: t.ticks, at: tileOf(c.state()) });
                    }
                }
                if (cfg.to) {
                    const to = cfg.to;
                    const w = await c.session.bot.walkTo(to.x, to.z, 0, { timeout: cfg.walkTimeoutS * 1000 });
                    const there = () => {
                        const at = tileOf(c.state());
                        return !!at && at.x === to.x && at.z === to.z && at.level === to.level;
                    };
                    for (let k = 0; k < SETTLE_TICKS && !there(); k++) await c.waitTicks(1);
                    c.out('walk', { ok: w.success, message: w.message, at: tileOf(c.state()), sinceLogin: c.sinceLogin() });
                    if (!there()) {
                        c.out('CHECK-FAIL', { expected: to, at: tileOf(c.state()) });
                        return false;
                    }
                }
                c.out('CHECK-OK', { at: tileOf(c.state()), pack: byId(c.state().inventory) });
                return true;
            },
        })
    );
}
