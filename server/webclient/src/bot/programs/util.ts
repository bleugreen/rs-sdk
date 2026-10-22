// Small readers over the published state shared by the tick programs.

import { ChatHistory } from '../../../../../sdk/chat-history.js';
import type { BotWorldState, GameMessage, InventoryItem } from '../types.js';
import type { ProgramContext } from './types.js';

/** Game xp per base xp point (server WorldConfig xp rate). */
export const XP_RATE = 25;

export function skillOf(s: BotWorldState, skill: string) {
    const name = skill.toLowerCase();
    return s.skills.find(k => k.name.toLowerCase() === name);
}

export function skillXp(s: BotWorldState, skill: string): number {
    return skillOf(s, skill)?.experience ?? 0;
}

export function baseLevel(s: BotWorldState, skill: string): number {
    return skillOf(s, skill)?.baseLevel ?? 0;
}

export function invItem(s: BotWorldState, re: RegExp): InventoryItem | undefined {
    return s.inventory.find(i => re.test(i.name));
}

export function invCount(s: BotWorldState, re: RegExp): number {
    return s.inventory.filter(i => re.test(i.name)).length;
}

export function itemOp(item: InventoryItem, re: RegExp, fallback: number): number {
    return item.optionsWithIndex.find(o => re.test(o.text))?.opIndex ?? fallback;
}

const BURY = /^bury$/i;
/** Any buryable bones; the run's are dragon bones. */
export const DEFAULT_BONES = 'bones$';

/** The programs' `bury` parameter: true for DEFAULT_BONES, or a regular expression over the bones' name; null when absent or false. */
export function bonesParam(value: unknown, name = 'bury'): RegExp | null {
    if (value === undefined || value === false) return null;
    return regex(value === true ? DEFAULT_BONES : value, DEFAULT_BONES, name);
}

/** Inventory items matching `re` that offer Bury, in inventory order. */
export function buryable(s: BotWorldState, re: RegExp): InventoryItem[] {
    return s.inventory.filter(i => re.test(i.name) && i.optionsWithIndex.some(o => BURY.test(o.text)));
}

/** Sends Bury on the first buryable bone. Returns the bone, or null when there is none or the send was refused. */
export function buryBone(ctx: ProgramContext, re: RegExp): InventoryItem | null {
    const b = buryable(ctx.state, re)[0];
    if (!b || !ctx.send({ type: 'useInventoryItem', slot: b.slot, optionIndex: itemOp(b, BURY, 1) }, `bury ${b.name}`)) return null;
    return b;
}

export function playerTile(s: BotWorldState): [number, number] | null {
    return s.player ? [s.player.worldX, s.player.worldZ] : null;
}

export function regex(value: unknown, fallback: string, name: string): RegExp {
    const src = value === undefined ? fallback : value;
    if (typeof src !== 'string') throw new Error(`${name} must be a regular expression string`);
    return new RegExp(src, 'i');
}

export function num(value: unknown, fallback: number, name: string): number {
    if (value === undefined || value === null) return fallback;
    const n = Number(value);
    if (!Number.isFinite(n) && n !== Infinity) throw new Error(`${name} must be a number`);
    return n;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T, name: string): T {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`${name} must be one of ${allowed.join(', ')}`);
    return value as T;
}

export function tile(value: unknown, name: string): [number, number] {
    if (!Array.isArray(value) || value.length !== 2 || !value.every(v => Number.isInteger(v))) throw new Error(`${name} must be [x, z]`);
    return [value[0], value[1]];
}

/**
 * Yields the game messages a state carries that were not seen before, each once and in order.
 * A message's observation id is the publication it first showed in, so every message of one
 * tick shares it: a message is its id plus its place among that publication's messages. This
 * is the SDK's ChatHistory rule, used as is so the page and the SDK read one stream one way.
 */
export class FreshMessages {
    private readonly history = new ChatHistory();

    constructor(initial?: BotWorldState | null) {
        if (initial) this.take(initial);
    }

    take(s: BotWorldState): GameMessage[] {
        return this.history.record(s.gameMessages ?? []);
    }
}

/** stat_random (engine PlayerOps): chance out of 256 that a roll at `level` succeeds. */
export function statRandom(level: number, lo: number, hi: number): number {
    const l = Math.min(level, 99);
    return Math.min(1, (Math.floor((lo * (99 - l)) / 98) + Math.floor((hi * (l - 1)) / 98) + 1) / 256);
}

export interface GapStats {
    events: number;
    gaps: number;
    /** Mean gap between consecutive events not split by a break. */
    ticksPerEvent: number;
    histogram: Record<number, number>;
    /** First event to last, breaks included. */
    span: number;
    first: number | null;
    last: number | null;
}

/**
 * Event ticks (xp drops, rolls, laps) and the gaps between them, skipping any
 * gap a break falls inside (a re-bootstrap, a resync): the cadence a loop holds
 * while it is locked. The lite scripts' summaries count gaps the same way.
 */
export class GapCounter {
    private first: number | null = null;
    private last: number | null = null;
    private lastBreak = Number.NEGATIVE_INFINITY;
    private events = 0;
    private gaps = 0;
    private total = 0;
    private readonly histogram: Record<number, number> = {};

    /** Records an event and returns the gap it closed, or null when no gap counts (the first event, or one after a break). */
    event(tick: number): number | null {
        let counted: number | null = null;
        if (this.last !== null && !(this.lastBreak > this.last)) {
            counted = tick - this.last;
            this.histogram[counted] = (this.histogram[counted] ?? 0) + 1;
            this.total += counted;
            this.gaps++;
        }
        if (this.first === null) this.first = tick;
        this.last = tick;
        this.events++;
        return counted;
    }

    /** A break at `tick` excludes the gap it falls inside. */
    break(tick: number): void {
        if (tick > this.lastBreak) this.lastBreak = tick;
    }

    get count(): number {
        return this.events;
    }

    get lastTick(): number | null {
        return this.last;
    }

    get ticksPerEvent(): number {
        return this.gaps ? Math.round((this.total / this.gaps) * 1000) / 1000 : Number.NaN;
    }

    stats(): GapStats {
        return {
            events: this.events,
            gaps: this.gaps,
            ticksPerEvent: this.ticksPerEvent,
            histogram: { ...this.histogram },
            span: this.first !== null && this.last !== null ? this.last - this.first : 0,
            first: this.first,
            last: this.last
        };
    }
}
