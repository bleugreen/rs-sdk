// SCORED's waits on a helper, guarded. Standing still for a carrier, a cue's readiness or a partner
// coming into sight is where a run has no step body looking after the player: attempt 4 died that way,
// poisoned at ~1 HP inside the {H12, mule} cue open's readiness wait. So every such wait runs under:
// - a DeathWatch (runner/death.ts watchFrames / raceDeath): a death ends the wait at once, sets
//   `session.died` and fails the step, as runLeg does, so run.ts writes the one `(death)` row and
//   exits EXIT_DIED;
// - the wait upkeep (WaitUpkeep): the run's eat rule (lib/travel.ts eatDue, the legs' rule) and an
//   antipoison dose when poisoned (quests/segments.ts poisoned / cureDose / noteAntipoison), one
//   click per frame, nothing while a trade is open (a pack click closes the trade screen) and nothing
//   inside a drink's p_delay (drinkDelayOver: a click there is dropped).
// guardWait is that for one wait; watchStretch is the same over an open-ended stretch (run.ts: from
// login to the first step's entry), which also holds while a dialogue is open. A guard inside a
// guard on the same SDK adds nothing: the outer one already watches and feeds every frame.

import type { BotWorldState, InventoryItem } from '../../sdk/types';
import { annotation } from '../lib/attempt';
import type { TickLog } from '../lib/ticks';
import { tradeOf } from '../lib/trade';
import { EAT_SPACING, eatDue, type EatOptions } from '../lib/travel';
import { waitUntil, type StateSource } from '../lib/wait';
import { opIndex } from '../lib/world';
import { cureDose, DRINK_DELAY_TICKS, drinkDelayOver, noteAntipoison, poisoned } from '../quests/segments';
import { raceDeath, watchFrames, type Death, type DeathStretch } from './death';

/** The antipoison helper the upkeep drinks through (quests/segments.ts); tests inject their own. */
export interface Cure {
    poisoned(s: BotWorldState): boolean;
    cureDose(s: BotWorldState): InventoryItem | null;
    noteAntipoison(tick: number): void;
    /** Until a drink sent at `sent` has finished its p_delay, inside which any click is dropped (segments.ts drinkDelayOver). */
    drinkDelayOver(sdk: StateSource, sent: number): Promise<void>;
    /**
     * Main's poison-unknown (segments.ts `poisonUnknown`, rs/786): a fresh session since the last dose, no poison seen in
     * it, an antipoison held. A carried poison shows only at its first hit, up to 30 ticks after login. Read only with
     * UpkeepOptions.unknownPoisonDose; absent, that dose never goes.
     */
    poisonUnknown?(s: BotWorldState): boolean;
}

export const SEGMENT_CURE: Cure = { poisoned, cureDose, noteAntipoison, drinkDelayOver };

/** Ticks after a dose that landed before upkeep drinks again while SCORED still reads poisoned: one poison cycle (poison.rs2's 30-tick timer). */
export const CURE_SPACING = 30;
/** Ticks after a drink that did not land (the dose still held, as clicked) before it is sent again: a delayed player drops an item click. */
export const CURE_RESEND = 3;

export type UpkeepSdk = StateSource & { sendUseItem(slot: number, option?: number): Promise<unknown> };

export interface UpkeepAct {
    kind: 'eat' | 'cure';
    tick: number;
    item: string;
    hp: number | null;
}

export interface UpkeepOptions {
    /** The eat rule's options (default: travel's, FOOD under EAT_BELOW). */
    eat?: EatOptions;
    cure?: Cure;
    /** Also send nothing while a dialogue is open (the resume stretch: a page a walk or step may need). */
    holdInDialog?: boolean;
    /**
     * With holdInDialog, an eat still goes while a dialogue is open at or under this many hitpoints:
     * an eat closes the chat (OpHeldHandler's clearPendingAction), but under it the next poison hit
     * could take SCORED through the floor. The cure always waits for the dialogue to close.
     */
    urgentHp?: number;
    /**
     * Drink one dose when the cure reads the poison unknown (Cure.poisonUnknown), not only on a poison seen: run.ts's
     * login stretch into S15:A or S16:B (main's ruling), where waiting for the carried poison's first hit costs 5-6 HP.
     */
    unknownPoisonDose?: boolean;
    onAct?: (a: UpkeepAct) => void;
}

const use = (i: InventoryItem, op: RegExp) => opIndex(i, op) ?? 1;

/** The upkeep's last drink: its dose as clicked, and whether it has been seen to land (the potion left its slot). */
interface Drink {
    tick: number;
    slot: number;
    id: number;
    name: string;
    landed: boolean;
}

/**
 * Eat and cure on SCORED's frames, one click per frame, none while a trade (or with holdInDialog, a dialogue) is open,
 * and none inside a landed drink's p_delay (Cure.drinkDelayOver), which drops any click.
 */
export class WaitUpkeep {
    eats = 0;
    cures = 0;
    /** Frames that wanted nothing sent because a trade or dialogue was open, or that sent nothing for it. */
    held = 0;
    private lastEat = -99;
    private drink: Drink | null = null;
    /** A landed drink's p_delay still running. */
    private delaying = false;
    private lastTick = -Infinity;

    constructor(private readonly sdk: UpkeepSdk, private readonly o: UpkeepOptions = {}) {}

    private get cure(): Cure {
        return this.o.cure ?? SEGMENT_CURE;
    }

    see(s: BotWorldState): void {
        if (!s.inGame || !s.player) return;
        this.observe(s);
        if (this.delaying) {
            this.held++;
            return;
        }
        const inDialog = !!this.o.holdInDialog && !!s.dialog?.isOpen;
        const urgent = this.o.urgentHp !== undefined && s.player.hp <= this.o.urgentHp;
        if (tradeOf(s).isOpen || (inDialog && !urgent)) {
            this.held++;
            return;
        }
        // The eat first: under the threshold a poison tick is what kills, and the cure follows on a later frame.
        const food = eatDue(s, this.o.eat ?? {}, this.lastEat);
        if (food) {
            this.lastEat = s.tick;
            this.eats++;
            this.act('eat', s, food, /^eat$/i);
            return;
        }
        if (inDialog) {
            this.held++;
            return;
        }
        const d = this.drink;
        if (d && !d.landed) {
            // Sent, not yet landed: the same dose again once CURE_RESEND has passed, whatever `poisoned` reads now
            // (the dose was noted when it was sent, so the poison it was sent for no longer shows).
            const held = s.inventory.find(i => i.slot === d.slot && i.id === d.id && i.name === d.name);
            if (held && s.tick - d.tick >= CURE_RESEND) this.drinkNow(s, held, false);
            return;
        }
        const dose = this.doseDue(s);
        if (dose) this.drinkNow(s, dose, true);
    }

    /** Whether this frame still wants an eat or a dose (held or not), or a drink is still landing: what a stretch's `settle` waits out. */
    wants(s: BotWorldState): boolean {
        if (!s.inGame || !s.player) return false;
        if (this.delaying || (this.drink && !this.drink.landed)) return true;
        if (eatDue(s, this.o.eat ?? {}, this.lastEat)) return true;
        return this.doseDue(s) !== null;
    }

    /**
     * A tick below the last one is a client reload (its tick restarts): the eat and drink records are the old session's.
     * A drink whose potion has left its slot has landed, and its p_delay holds every click until it is over.
     */
    private observe(s: BotWorldState): void {
        if (s.tick < this.lastTick) {
            this.lastEat = -99;
            this.drink = null;
            this.delaying = false;
        }
        this.lastTick = s.tick;
        const d = this.drink;
        if (!d || d.landed || s.inventory.some(i => i.slot === d.slot && i.id === d.id && i.name === d.name)) return;
        d.landed = true;
        this.delaying = true;
        void this.cure.drinkDelayOver(this.sdk, d.tick).finally(() => {
            if (this.drink === d) this.delaying = false;
        });
    }

    /** The dose to drink now: none in CURE_SPACING ticks, and poisoned (or, with unknownPoisonDose, the poison unknown). */
    private doseDue(s: BotWorldState): InventoryItem | null {
        if (this.drink && s.tick - this.drink.tick < CURE_SPACING) return null;
        const cure = this.cure;
        const want = cure.poisoned(s) || (!!this.o.unknownPoisonDose && !!cure.poisonUnknown?.(s));
        return want ? cure.cureDose(s) : null;
    }

    private drinkNow(s: BotWorldState, dose: InventoryItem, fresh: boolean): void {
        if (fresh) this.cures++;
        this.drink = { tick: s.tick, slot: dose.slot, id: dose.id, name: dose.name, landed: false };
        this.cure.noteAntipoison(s.tick);
        this.act('cure', s, dose, /^drink$/i);
    }

    private act(kind: UpkeepAct['kind'], s: BotWorldState, item: InventoryItem, op: RegExp): void {
        this.o.onAct?.({ kind, tick: s.tick, item: item.name, hp: s.player?.hp ?? null });
        void this.sdk.sendUseItem(item.slot, use(item, op));
    }
}

/** What a guard needs of its context: the SDK, and the session `died` goes on (a StepContext has both). */
export interface GuardContext {
    sdk: UpkeepSdk;
    session?: { died?: Death };
}

export interface Stretch extends DeathStretch {
    readonly upkeep: WaitUpkeep;
    /**
     * Wait, at most `maxTicks` observed ticks, until the upkeep wants nothing more (an eat and a dose go on
     * separate frames), or a death. A stretch ending at a step's entry settles first, so a cure due behind
     * an eat is not left to a step that may not cure a poison carried in.
     */
    settle(maxTicks?: number): Promise<void>;
}

/** Ticks a stretch's settle waits at most: an eat, its EAT_SPACING, a dose, its resend and its p_delay. */
export const SETTLE_TICKS = EAT_SPACING + CURE_RESEND + DRINK_DELAY_TICKS + 2;

/** SDKs with a stretch's upkeep running on them: a guard inside one adds nothing. */
const kept = new WeakMap<object, number>();

/**
 * Watch `ctx.sdk`'s frames from now until `stop()`: the DeathWatch (death.ts watchFrames, from the
 * first in-game frame) and the wait upkeep on every frame before a death, the current one at once.
 * A death goes on `ctx.session.died`.
 */
export function watchStretch(ctx: GuardContext, during: string, o: UpkeepOptions = {}): Stretch {
    const upkeep = new WaitUpkeep(ctx.sdk, o);
    kept.set(ctx.sdk, (kept.get(ctx.sdk) ?? 0) + 1);
    const frames = watchFrames(ctx.sdk, ctx.session, during, s => upkeep.see(s));
    let stopped = false;
    return {
        upkeep,
        died: frames.died,
        death: () => frames.death(),
        settle: async (maxTicks = SETTLE_TICKS) => {
            if (stopped) return;
            await waitUntil(ctx.sdk, s => !!frames.death() || !upkeep.wants(s), { maxTicks });
        },
        stop: () => {
            if (!stopped) {
                stopped = true;
                kept.set(ctx.sdk, (kept.get(ctx.sdk) ?? 1) - 1);
            }
            return frames.stop();
        },
    };
}

/** Upkeep options that write each eat or dose as a 0-tick note row, `<prefix> upkeep <during>: eat|cure`, in the step's log. */
export function loggedActs(ctx: { log: TickLog; session: { name: string; sessionId: number } }, during: string, prefix = '(wait)'): Pick<UpkeepOptions, 'onAct'> {
    return {
        onAct: a => ctx.log.append(annotation(ctx.log, ctx.session.name, 'note', `${prefix} upkeep ${during}: ${a.kind}`, { sessionId: ctx.session.sessionId, startTick: a.tick, meta: { ...a } })),
    };
}

/**
 * `steps` with each entry (`run`, `resume`) first ending `stretch`: the step's own upkeep takes over
 * from it, and a death the stretch saw fails the step before it sends anything (run.ts's upkeep
 * from login to the first step's entry).
 */
export function enteringEnds<S extends { run(ctx: never): Promise<void>; resume?(ctx: never): Promise<void> }>(steps: readonly S[], stretch: Pick<Stretch, 'stop' | 'settle'>): S[] {
    const enter = <A extends unknown[]>(f: (...a: A) => Promise<void>) => async (...a: A): Promise<void> => {
        await stretch.settle();
        const death = stretch.stop();
        if (death) throw new Error(death.reason);
        await f(...a);
    };
    return steps.map(s => ({ ...s, run: enter(s.run), ...(s.resume ? { resume: enter(s.resume) } : {}) }));
}

/**
 * `fn`, a wait SCORED stands through for a helper, under watchStretch: a death ends it at once with
 * the death's reason ('SCORED died <during>: ...', session.died set), whatever `fn` was still waiting
 * for; otherwise `fn`'s own result or throw. Inside another stretch on the same SDK it is just `fn`.
 */
export function guardWait<T>(ctx: GuardContext, during: string, fn: () => Promise<T>, o: UpkeepOptions = {}): Promise<T> {
    if ((kept.get(ctx.sdk) ?? 0) > 0) return fn();
    return raceDeath(watchStretch(ctx, during, o), fn);
}
