// SCORED's death, seen and acted on. DeathWatch watches the states of a stretch the run cannot let a
// death pass unseen in: a logout's hold (lib/session.ts logoutClean, which puts what it saw on the
// logout's result and on Session.died), a leg's travel (runner/legs.ts runLeg, the same on
// Session.died, the leg failing), every other step's body (runner/step.ts deathWatched, through
// watchFrames and raceDeath below) and the helper waits (runner/wait-guard.ts). run.ts then writes one `(death)` row, ends the attempt with
// EXIT_DIED, and refuses any later run into the same log, a walk from game state and a --from alike,
// until the operator names that death with --r8-recovered after R8's recovery: a resume from the
// respawn would otherwise go on as if nothing had happened.

import type { BotWorldState } from '../../sdk/types';
import { annotation, type AttemptResult } from '../lib/attempt';
import type { LogoutResult } from '../lib/session';
import type { TickLog, TickRow } from '../lib/ticks';
import { inArea, RELOCATE_TILES, RESPAWN } from '../lib/travel';
import { chebyshev, messageCursor, messagesAfter, pos, type Tile } from '../lib/world';

// ------------------------------------------------------------------ seeing it

/** death.rs2's `mes("Oh dear you are dead!")` (server/content/scripts/player/scripts/death.rs2), as the client shows it: no comma. */
export const DEATH_MESSAGE = /^Oh dear you are dead!$/;

/**
 * What showed the death: the engine's message after the watch began; hitpoints at 0 (`isDead`, or
 * `hp` 0 of a `maxHp`); the client's own count of lives going up (`lifeId`, `respawnCount`: the
 * browser client's); or a jump onto the respawn square (lib/travel.ts RESPAWN, further than
 * RELOCATE_TILES allows) that hitpoints corroborate, at 0 before it or restored to full on it.
 */
export type DeathSign = 'message' | 'dead' | 'respawned' | 'respawn-tile';

export interface Death {
    /** The tile before: the last one before the jump onto the respawn, else the watch's first state's. */
    from: Tile;
    fromTick: number;
    /** The last in-world tile the watch saw. */
    to: Tile;
    toTick: number;
    /** The tick of the first sign. */
    tick: number;
    signs: DeathSign[];
    /** Hitpoints when the watch began, the lowest it saw, and the last; null where the state has none. */
    hpBefore: number | null;
    hpMin: number | null;
    hpAfter: number | null;
    reason: string;
}

/** What a logout's wait before its click held: the combat it waited out and the hitpoints through it. */
export interface HeldLogout {
    fromTick: number;
    clickTick: number;
    ticks: number;
    /** Hitpoints when the logout began, then each change, with its tick. */
    hp: { tick: number; hp: number }[];
    /** Distinct ticks a published state said the player was in combat. */
    inCombatTicks: number;
    lastDamageTick: number;
}

interface SeenAt {
    tile: Tile;
    tick: number;
    hp: number | null;
}

const seenAt = (s: BotWorldState): SeenAt => ({ tile: pos(s), tick: s.tick, hp: s.player?.hp ?? null });

/**
 * Every in-world state from `entry` on: whether SCORED died meanwhile (any DeathSign), and the combat
 * and hitpoints it went through. A teleport elsewhere and a walk are not deaths, nor is a forced
 * teleport onto the respawn square (a Lumbridge Teleport lands there too) with the hitpoints it left
 * with. A client that publishes neither `isDead` nor `lifeId` (the lite client) and skips the 0-hp
 * frame shows a death close to the square, under RELOCATE_TILES away, only by the engine's message.
 */
export class DeathWatch {
    private readonly cursor: number;
    private readonly first: SeenAt;
    private readonly life: number | null;
    private readonly respawns: number | null;
    private last: SeenAt;
    private jumpFrom: SeenAt | null = null;
    private readonly signs = new Set<DeathSign>();
    private signTick: number | null = null;
    private hpMin: number | null;
    private readonly hp: { tick: number; hp: number }[] = [];
    private readonly combat = new Set<number>();
    private lastDamageTick: number;
    /** A logout's: it waited before its click. */
    holding = false;

    /** `during` completes the reason: 'SCORED died <during>: ...'. */
    constructor(entry: BotWorldState, private readonly during: string) {
        this.cursor = messageCursor(entry);
        this.first = this.last = seenAt(entry);
        // lifeId 0: the client has not seen this life begin, so a later 1 is no respawn.
        this.life = entry.player?.lifeId ? entry.player.lifeId : null;
        this.respawns = entry.player?.respawnCount ?? null;
        this.hpMin = this.first.hp;
        if (this.first.hp !== null) this.hp.push({ tick: entry.tick, hp: this.first.hp });
        this.lastDamageTick = entry.player?.combat?.lastDamageTick ?? -1;
        if (entry.player?.combat?.inCombat) this.combat.add(entry.tick);
        this.signsOf(entry);
    }

    see(s: BotWorldState): void {
        const p = s.player;
        if (!s.inGame || !p) return;
        const prev = this.last;
        const now = seenAt(s);
        this.last = now;
        if (now.hp !== null) {
            if (this.hp.at(-1)?.hp !== now.hp) this.hp.push({ tick: s.tick, hp: now.hp });
            this.hpMin = this.hpMin === null ? now.hp : Math.min(this.hpMin, now.hp);
        }
        if (p.combat?.inCombat) this.combat.add(s.tick);
        this.lastDamageTick = Math.max(this.lastDamageTick, p.combat?.lastDamageTick ?? -1);
        this.signsOf(s);
        const ticks = Math.max(1, now.tick - prev.tick);
        if (this.jumpFrom || !inArea(s, RESPAWN) || chebyshev(prev.tile, now.tile) <= RELOCATE_TILES + 2 * (ticks - 1)) return;
        this.jumpFrom = prev;
        // A respawn restores every stat (death.rs2 ~stat_reset_all): 2 or more up to the full, more than a regeneration tick gives.
        const restored = now.hp !== null && prev.hp !== null && now.hp === p.maxHp && now.hp - prev.hp >= 2;
        if (restored || this.signs.has('dead')) this.sign('respawn-tile', s.tick);
    }

    private signsOf(s: BotWorldState): void {
        const p = s.player;
        if (!p) return;
        if (p.isDead || (p.maxHp > 0 && p.hp <= 0)) this.sign('dead', s.tick);
        if ((this.life !== null && (p.lifeId ?? 0) > this.life) || (this.respawns !== null && (p.respawnCount ?? 0) > this.respawns)) this.sign('respawned', s.tick);
        if (messagesAfter(s, this.cursor, DEATH_MESSAGE).length > 0) this.sign('message', s.tick);
    }

    private sign(k: DeathSign, tick: number): void {
        this.signs.add(k);
        this.signTick ??= tick;
    }

    death(): Death | null {
        if (this.signs.size === 0) return null;
        const from = this.jumpFrom ?? this.first;
        const to = this.last;
        const signs = [...this.signs];
        const t = (x: Tile) => `(${x.x},${x.z},${x.level})`;
        const hp = (n: number | null) => (n === null ? '?' : String(n));
        return {
            from: from.tile, fromTick: from.tick, to: to.tile, toTick: to.tick, tick: this.signTick!, signs,
            hpBefore: this.first.hp, hpMin: this.hpMin, hpAfter: to.hp,
            reason: `SCORED died ${this.during}: ${t(from.tile)} on tick ${from.tick} to ${t(to.tile)} on tick ${to.tick} `
                + `(${signs.join(', ')}; hp ${hp(this.first.hp)} at the start, lowest ${hp(this.hpMin)}, ${hp(to.hp)} after)`,
        };
    }

    held(clickTick: number): HeldLogout {
        return {
            fromTick: this.first.tick, clickTick, ticks: Math.max(0, clickTick - this.first.tick),
            hp: [...this.hp], inCombatTicks: this.combat.size, lastDamageTick: this.lastDamageTick,
        };
    }
}

/** A stretch of frames under a DeathWatch (watchFrames). */
export interface DeathStretch {
    /** The death the stretch saw, or null. */
    death(): Death | null;
    /** Resolves on the first frame that shows a death. */
    readonly died: Promise<Death>;
    /** Stop watching (idempotent); returns the death seen, if any. */
    stop(): Death | null;
}

type Frames = { getState(): BotWorldState | null; onStateUpdate(fn: (s: BotWorldState) => void): () => void };

/**
 * Watch `sdk`'s frames from now until `stop()`: a DeathWatch from the first in-game frame (the current
 * one when it is), a death going on `session.died`. `alive` sees every frame before any death, the
 * current one first: what a guard does on the player's frames (runner/wait-guard.ts's upkeep).
 */
export function watchFrames(sdk: Frames, session: { died?: Death } | undefined, during: string, alive?: (s: BotWorldState) => void): DeathStretch {
    let watch: DeathWatch | null = null;
    let seen: Death | null = null;
    let stopped = false;
    let resolve!: (d: Death) => void;
    const died = new Promise<Death>(r => (resolve = r));
    const see = (s: BotWorldState) => {
        if (stopped || seen) return;
        if (!watch) {
            if (!s.inGame || !s.player) return;
            watch = new DeathWatch(s, during);
        } else watch.see(s);
        const d = watch.death();
        if (d) {
            seen = d;
            if (session) session.died ??= d;
            resolve(d);
            return;
        }
        alive?.(s);
    };
    const off = sdk.onStateUpdate(see);
    const s0 = sdk.getState();
    if (s0) see(s0);
    return {
        died,
        death: () => seen,
        stop: () => {
            if (!stopped) {
                stopped = true;
                off();
            }
            return seen;
        },
    };
}

/** `fn` raced against `stretch`'s death: on a death, `<label>: <reason>` at once, whatever `fn` still waits for; else `fn`'s result or throw. Stops the stretch. */
export async function raceDeath<T>(stretch: DeathStretch, label: string, fn: () => Promise<T>): Promise<T> {
    try {
        const r = await Promise.race([fn().then(v => ({ v }), (e: unknown) => ({ e })), stretch.died.then(() => ({ dead: true as const }))]);
        const death = stretch.death();
        if (death) throw new Error(`${label}: ${death.reason}`);
        if ('e' in r) throw r.e;
        return (r as { v: T }).v;
    } finally {
        stretch.stop();
    }
}

/** `fn` under a DeathWatch (watchFrames, raceDeath): a death ends it at once, on `session.died`, failing with its reason. */
export function watchDeath<T>(sdk: Frames, session: { died?: Death } | undefined, during: string, fn: () => Promise<T>): Promise<T> {
    return raceDeath(watchFrames(sdk, session, during), during, fn);
}

// ------------------------------------------------------------------ acting on it

export const DEATH_STEP = '(death)';
export const DEATH_ACK_STEP = '(death) acknowledged';

/** run.ts's exit when SCORED died. Not 4: a stop is resumed by running again, a death is not. */
export const EXIT_DIED = 6;

export const R8_RECOVERY = "R8's recovery (RUN-HOST.md 'After a player-kill': the manual procedure, or rs/527's recover-now once it is on the floor)";

/** What --r8-recovered takes to acknowledge the death a `(death)` row records. */
export function deathKey(row: Pick<TickRow, 'runId' | 'startTick'>): string {
    return `${row.runId}@${row.startTick}`;
}

/** The `(death)` row; `logout`, the logout that saw it, when one did. */
export function deathRow(log: Pick<TickLog, 'runId'>, account: string, sessionId: number, d: Death, logout?: LogoutResult): TickRow {
    const { reason, ...seen } = d;
    return annotation(log, account, 'note', DEATH_STEP, {
        sessionId, startTick: d.tick, ok: false, error: reason,
        meta: {
            ...seen,
            ...(logout ? { logout: { ok: logout.ok, clickTick: logout.clickTick, lastInWorldTick: logout.lastInWorldTick, ...(logout.reason ? { reason: logout.reason } : {}), ...(logout.held ? { held: logout.held } : {}) } } : {}),
        },
    });
}

export function operatorLine(row: Pick<TickRow, 'runId' | 'startTick'>): string {
    return `${R8_RECOVERY}, then run again with --r8-recovered=${deathKey(row)}`;
}

/** The attempt's result once SCORED has died, whatever the chain itself ended with. */
export function diedResult(row: TickRow, before: AttemptResult): AttemptResult {
    return { outcome: `DIED: ${row.error} (the chain had ended: ${before.outcome}). Next: ${operatorLine(row)}`, code: EXIT_DIED, paused: null };
}

/**
 * The start's death gate over the log's earlier rows: refused while a `(death)` row stands that no
 * `(death) acknowledged` row covers, unless `ack` (--r8-recovered) names the latest such death, in
 * which case every open one is acknowledged. An `ack` with nothing open is refused too, so a flag left
 * on a command line never acknowledges a later death.
 */
export function deathGate(rows: readonly TickRow[], ack?: string): { refusal: string } | { acknowledge: string[] } {
    const acked = new Set(rows.filter(r => r.step === DEATH_ACK_STEP).flatMap(r => (r.meta?.keys as string[] | undefined) ?? []));
    const open = rows.filter(r => r.step === DEATH_STEP && !acked.has(deathKey(r)));
    const last = open.at(-1);
    if (!last) return ack === undefined ? { acknowledge: [] } : { refusal: `--r8-recovered=${ack} names no unacknowledged death in this log` };
    if (ack === deathKey(last)) return { acknowledge: open.map(deathKey) };
    return {
        refusal: `${last.error ?? 'SCORED died'}. A run from here would resume from the respawn as if nothing happened`
            + `${ack !== undefined ? ` (--r8-recovered=${ack} does not name it)` : ''}. Do ${operatorLine(last)}`,
    };
}

/** The row an acknowledged start writes, so later runs into the log pass the gate. */
export function ackRow(log: Pick<TickLog, 'runId'>, account: string, keys: readonly string[]): TickRow {
    return annotation(log, account, 'gate', DEATH_ACK_STEP, { meta: { keys: [...keys], recovery: 'R8' } });
}
