/**
 * The runner's stall watchdog (docs/markets/phase2.md 'Stalls'), for every stage. Pure: the runner feeds it each
 * account's readings and asks it on its pump.
 *
 * Progress is per stage (`stageReading`): in the method, the ledger's coin total (carried plus banked), read at the
 * ledger's cadence; in any other stage, the stage's skill XP (`STAGE_SKILL`), the coins carried, or a move of more than
 * MOVE_TILES from where the clock last restarted, read on every state. A change of stage restarts the clock too. A
 * stage with no progress for its policy's `ms` is aborted, so the runner runs its stages again from where the account
 * stands (through travel, stages.ts `reach`), at most `retries` times while it makes no progress; then the verdict is
 * 'leave', once. Retries are counted per stage and reset only by progress in that stage, so a method aborted, sent
 * round its stages and back without earning still runs out of retries.
 */
import type { BotWorldState } from '../../sdk/types';

export interface StallPolicy {
    /** How long a stage may make no progress; 0 turns the watchdog off. */
    ms: number;
    /** Aborts before the account is left alone (the method) or parked (any other stage). */
    retries: number;
}

export const DEFAULT_STALL: StallPolicy = { ms: 10 * 60_000, retries: 3 };

export interface Tile {
    x: number;
    z: number;
}

export interface StallReading {
    stage: string;
    /** Numbers any change in which is progress. */
    marks: readonly number[];
    /** Where the account stands; null where position is no progress (the method, which works in one place). */
    at: Tile | null;
}

/** A move further than this many tiles (Chebyshev) from where the clock last restarted is progress. */
export const MOVE_TILES = 5;

/** The skill whose XP is a stage's progress (its own when it trains one; Thieving where it earns on coins.ts). */
export const STAGE_SKILL: Readonly<Record<string, string>> = {
    hp: 'Hitpoints',
    thieving: 'Thieving',
    coins: 'Thieving',
    admission: 'Thieving',
    'hp-queue': 'Thieving',
    mining: 'Mining'
};

const carried = (s: Pick<BotWorldState, 'inventory'>) => s.inventory.filter(i => /^coins$/i.test(i.name)).reduce((n, i) => n + i.count, 0);

/** A reading in a stage other than the method: its skill's XP (0 when it has none) and the coins carried, and where it stands. */
export function stageReading(stage: string, s: Pick<BotWorldState, 'skills' | 'inventory' | 'player'>): StallReading {
    const skill = STAGE_SKILL[stage];
    const xp = skill ? (s.skills.find(k => k.name === skill)?.experience ?? 0) : 0;
    return { stage, marks: [xp, carried(s)], at: s.player ? { x: s.player.worldX, z: s.player.worldZ } : null };
}

/** A reading in the method: the ledger's coin total. */
export const methodReading = (coins: number): StallReading => ({ stage: 'method', marks: [coins], at: null });

/**
 * The policy for `stage`: the method's, or the stages' with `graceMinutes` added where a stage stands still by design
 * (an Exchange offer's fill wait in the shark purchase and the sale).
 */
export function policyFor(stage: string, method: StallPolicy, stages: StallPolicy, graceMinutes: Readonly<Record<string, number>> = {}): StallPolicy {
    if (stage === 'method') return method;
    if (stages.ms <= 0) return stages;
    return { ...stages, ms: stages.ms + (graceMinutes[stage] ?? 0) * 60_000 };
}

export type StallVerdict = { action: 'abort' | 'leave'; stage: string; retry: number; stalledMs: number; marks: readonly number[]; at: Tile | null };

const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

function progressed(a: StallReading, b: StallReading): boolean {
    if (a.marks.length !== b.marks.length || a.marks.some((m, i) => m !== b.marks[i])) return true;
    return !!a.at && !!b.at && cheb(a.at, b.at) > MOVE_TILES;
}

export class StallWatch {
    /** The reading when the clock last restarted; null between sessions. */
    private anchor: StallReading | null = null;
    private since = 0;
    private readonly aborts = new Map<string, number>();
    private readonly left = new Set<string>();

    /** Aborts in `stage` since it last made progress. */
    retries(stage: string): number {
        return this.aborts.get(stage) ?? 0;
    }

    observe(r: StallReading, now: number): void {
        const a = this.anchor;
        if (a && a.stage === r.stage && !progressed(a, r)) return;
        if (a && a.stage === r.stage) {
            this.aborts.delete(r.stage);
            this.left.delete(r.stage);
        }
        this.anchor = r;
        this.since = now;
    }

    /** Between sessions: no clock until the next reading. The retries are kept. */
    pause(): void {
        this.anchor = null;
    }

    /**
     * Whether to abort `stage` now or (once, after the retries) to leave it. Null while the last reading is of another
     * stage: the clock is the reading's, and a stage just entered has its first reading still to come.
     */
    check(now: number, stage: string, p: StallPolicy): StallVerdict | null {
        const a = this.anchor;
        if (p.ms <= 0 || !a || a.stage !== stage || this.left.has(stage)) return null;
        const stalledMs = now - this.since;
        if (stalledMs < p.ms) return null;
        const n = this.retries(stage);
        const base = { stage, stalledMs, marks: a.marks, at: a.at };
        if (n >= p.retries) {
            this.left.add(stage);
            return { action: 'leave', retry: n, ...base };
        }
        this.aborts.set(stage, n + 1);
        this.since = now;
        return { action: 'abort', retry: n + 1, ...base };
    }
}
