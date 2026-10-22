// Per-hop timeline of one leg run, for lab/measure-legs.ts: every click the travel layer sends and
// every published tick's position and dialogue state, folded into one row per hop
// (TravelResult.segments). It shows where a client loses ticks on a leg: how long after a landing
// the first click goes, how long that click takes to move the player, the ticks inside a run on
// which the player stood still, a loc click's first dialogue page, and repeated clicks (act.ts's
// re-sends, the run walker's idle re-sends).

import type { BotSDK } from '../../sdk/index';
import type { Segment } from '../lib/travel';

export interface Send {
    tick: number;
    kind: string;
    /** The player's tile when the click went. */
    x: number;
    z: number;
    level: number;
    target: string;
}

export interface Frame {
    tick: number;
    x: number;
    z: number;
    level: number;
    dialog: boolean;
    /** Chebyshev distance from the player to the nearest listed loc, or null with none listed (the browser lists the built scene's locs, so a far or empty list means the region isn't built yet). */
    locNear: number | null;
    /** Inventory slots in use as published (an item missing for a tick shows here). */
    inv: number;
}

export interface Tracer {
    readonly sends: Send[];
    readonly frames: Frame[];
    stop(): void;
}

const SENDS = ['sendWalk', 'sendInteractLoc', 'sendUseItemOnLoc', 'sendClickComponent', 'sendInteractNpc', 'sendClickDialog', 'clickDialogByText', 'sendUseItem'] as const;

function describe(kind: string, a: readonly unknown[]): string {
    switch (kind) {
        case 'sendWalk': return `${a[0]},${a[1]}`;
        case 'sendInteractLoc': return `loc ${a[2]} at ${a[0]},${a[1]} op ${a[3]}`;
        case 'sendUseItemOnLoc': return `slot ${a[0]} on loc ${a[3]} at ${a[1]},${a[2]}`;
        case 'sendInteractNpc': return `npc ${a[0]} op ${a[1]}`;
        default: return a.map(String).join(',');
    }
}

/** Record the sdk's clicks and published ticks until `stop()`. Lab only: it wraps the instance's send methods. */
export function startTrace(sdk: BotSDK): Tracer {
    const sends: Send[] = [];
    const frames: Frame[] = [];
    const self = sdk as unknown as Record<string, unknown>;
    const restore: Array<() => void> = [];
    for (const kind of SENDS) {
        const orig = self[kind];
        if (typeof orig !== 'function') continue;
        const own = Object.prototype.hasOwnProperty.call(self, kind);
        self[kind] = (...a: unknown[]) => {
            const s = sdk.getState();
            const p = s?.player;
            sends.push({ tick: s?.tick ?? -1, kind, x: p?.worldX ?? -1, z: p?.worldZ ?? -1, level: p?.level ?? -1, target: describe(kind, a) });
            return (orig as (...b: unknown[]) => unknown).apply(sdk, a);
        };
        restore.push(() => {
            if (own) self[kind] = orig;
            else delete self[kind];
        });
    }
    const off = sdk.onStateUpdate(s => {
        const p = s.player;
        if (!p) return;
        let locNear: number | null = null;
        for (const l of s.nearbyLocs) {
            const d = Math.max(Math.abs(l.x - p.worldX), Math.abs(l.z - p.worldZ));
            if (locNear === null || d < locNear) locNear = d;
        }
        const f: Frame = { tick: s.tick, x: p.worldX, z: p.worldZ, level: p.level, dialog: s.dialog.isOpen, locNear, inv: s.inventory.length };
        // Several states can share a tick; the last one is what that tick ended with.
        if (frames.length && frames[frames.length - 1]!.tick === s.tick) frames[frames.length - 1] = f;
        else frames.push(f);
    });
    return {
        sends,
        frames,
        stop() {
            off();
            for (const r of restore) r();
        },
    };
}

export interface HopRow {
    hop: string;
    ok: boolean;
    ticks: number;
    /** Clicks inside the hop, and by send kind. */
    sends: number;
    byKind: Record<string, number>;
    /** Hop start to its first click: after a landing, how long the next click waited. */
    firstSend: number | null;
    /** The first click to the first tick the player stood on another tile. */
    firstStep: number | null;
    /** Ticks (from the hop's start) after the first step on which the player had not moved, before the hop ended. */
    still: number[];
    /** Tiles stepped (Chebyshev, consecutive published ticks on one level; jumps over 2 tiles are not steps). */
    tiles: number;
    /** The first click to the first tick with a dialogue open. */
    firstPage: number | null;
    /** Clicks that repeated an earlier click's kind and target inside the hop. */
    repeats: number;
    /** Ticks inside the hop with no published state. */
    frameGaps: number;
    /** Hop start to the first tick a loc was listed within SCENE_NEAR tiles of the player (null: never inside the hop). */
    sceneAt: number | null;
}

/** A listed loc this close to the player means the client's scene is built around them. */
export const SCENE_NEAR = 10;

const cheb = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const same = (a: Frame, b: Frame) => a.x === b.x && a.z === b.z && a.level === b.level;

/**
 * One row per hop. A hop owns the ticks from its start up to the next hop's start (the last hop up
 * to `endTick`, inclusive): no hop sends on the tick it observes its own arrival, so a click on a
 * boundary tick belongs to the hop that starts there.
 */
export function hopRows(segments: readonly Segment[], sends: readonly Send[], frames: readonly Frame[], endTick: number): HopRow[] {
    return segments.map((seg, i) => {
        const start = seg.startTick;
        const last = i === segments.length - 1;
        const end = last ? endTick : segments[i + 1]!.startTick;
        const inHop = (t: number) => t >= start && (last ? t <= end : t < end);
        const mine = sends.filter(s => inHop(s.tick));
        const fs = frames.filter(f => f.tick >= start && f.tick <= end);
        const byKind: Record<string, number> = {};
        const seen = new Set<string>();
        let repeats = 0;
        for (const s of mine) {
            byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
            const key = `${s.kind} ${s.target}`;
            if (seen.has(key)) repeats++;
            seen.add(key);
        }
        const first = mine[0];
        let firstStep: number | null = null;
        let firstPage: number | null = null;
        const still: number[] = [];
        let tiles = 0;
        for (let j = 1; j < fs.length; j++) {
            const a = fs[j - 1]!;
            const b = fs[j]!;
            if (a.level === b.level && cheb(a, b) <= 2) tiles += cheb(a, b);
        }
        if (first) {
            const at = [...frames].reverse().find(f => f.tick <= first.tick) ?? { tick: first.tick, x: first.x, z: first.z, level: first.level, dialog: false, locNear: null, inv: -1 };
            const moved = frames.find(f => f.tick > first.tick && !same(f, at));
            if (moved && moved.tick <= end) firstStep = moved.tick - first.tick;
            const page = frames.find(f => f.tick >= first.tick && f.tick <= end && f.dialog);
            if (page) firstPage = page.tick - first.tick;
            if (moved && moved.tick <= end) {
                for (let j = 1; j < fs.length; j++) {
                    const b = fs[j]!;
                    if (b.tick <= moved.tick || b.tick >= end) continue;
                    if (same(fs[j - 1]!, b)) still.push(b.tick - start);
                }
            }
        }
        const ticksSeen = new Set(fs.map(f => f.tick)).size;
        const built = fs.find(f => f.locNear !== null && f.locNear <= SCENE_NEAR);
        return {
            hop: seg.hop, ok: seg.ok, ticks: seg.ticks, sends: mine.length, byKind,
            firstSend: first ? first.tick - start : null, firstStep, still, tiles, firstPage, repeats,
            frameGaps: Math.max(0, end - start + 1 - ticksSeen),
            sceneAt: built ? built.tick - start : null,
        };
    });
}

/** One line per run: `hop ticks (clicks, first click +n, first step +n, idle n[, page +n][, repeats n])`. */
export function hopLine(rows: readonly HopRow[]): string {
    return rows
        .map(h => {
            const parts = [`${h.sends} clicks`, `first click +${h.firstSend ?? '-'}`, `step +${h.firstStep ?? '-'}`, `idle ${h.still.length}`];
            if (h.firstPage !== null) parts.push(`page +${h.firstPage}`);
            if (h.repeats) parts.push(`repeats ${h.repeats}`);
            if (h.frameGaps) parts.push(`gaps ${h.frameGaps}`);
            if (h.sceneAt !== 0) parts.push(`scene +${h.sceneAt ?? '-'}`);
            return `${h.hop} ${h.ticks} (${parts.join(', ')})`;
        })
        .join(' | ');
}
