// The moves the five small quest modules share (S05 Doric's Quest, S23 Cook's Assistant, S24's
// Goblin Diplomacy, Druidic Ritual and Romeo & Juliet): a run inside the quest, a talk answered
// to its shape, a loc op that moves the player, the completion's pages, and the lab report's note
// rows. Each is bound to the module's step id, so failures and notes name `S24:D5` and the like.
// The modules keep their own segment logic; this holds only what would otherwise be five copies.

import type { BotWorldState } from '../../sdk/types';
import { opLoc, talkTo, type ActSdk } from '../lib/act';
import { converse, levelUpInterrupt, type ConverseResult, type ConverseSdk, type Interrupt } from '../lib/converse';
import type { OptionPattern } from '../lib/dialogue';
import { questStatus, type QuestKey } from '../lib/quests';
import { logNote } from '../lib/ticks';
import { inArea, runTo, type Area, type TravelSdk } from '../lib/travel';
import { currentTick, waitOrThrow, waitUntil, type Pred } from '../lib/wait';
import { messagesSince, pos, type LocQuery } from '../lib/world';
import type { StepContext } from '../runner/step';
import { talkShape, type QuestOptions } from './segments';

export type QuestSdk = TravelSdk & ActSdk & ConverseSdk;
type Ctx = StepContext<any>;

export interface TalkSpec {
    /** For failures and notes: 'Doric (start)'. */
    who: string;
    npc: RegExp;
    /** Where the NPC stands (or wanders round): candidates are sorted by distance to it. */
    near: { x: number; z: number };
    choices?: OptionPattern[];
    /** CONVENTIONS.md shape, read from the script: drives the burst and is checked against the pages. */
    shape: string;
    until?: Pred;
    maxTicks?: number;
    /**
     * Ticks the chat must stay closed before the talk is over (default 0). These quests' NPC scripts
     * end at their last page, with no p_delay and no page reopening after it (read, per script), so
     * the talk ends the tick it sees the chat closed; a completion's queued pages are `completion`'s.
     * Raise it for a script that closes the chat and reopens it.
     */
    idle?: number;
}

export interface QuestMoves {
    sdkOf(ctx: Ctx): QuestSdk;
    /** Throw `<stepId>:<seg>: why at {x,z,level}`. */
    fail(seg: string, why: string, sdk?: QuestSdk): never;
    /** A note row for the lab report. */
    note(ctx: Ctx, seg: string, meta: Record<string, unknown>): void;
    /** Run to `to` (through `via`'s tiles, where the SDK route is not the short one), retrying a run that ends short: ok only inside the area. */
    go(ctx: Ctx, seg: string, to: Area, what: string, via?: ReadonlyArray<{ x: number; z: number }>): Promise<void>;
    /** Talk to an NPC and answer it to the end of its shape; refused unless it opened and ended well. */
    talk(ctx: Ctx, seg: string, opts: QuestOptions | undefined, t: TalkSpec, extra?: Record<string, unknown>): Promise<ConverseResult>;
    /** A loc op that moves the player (stairs, a ladder): clicked until `arrived`. */
    locMove(ctx: Ctx, seg: string, what: string, loc: LocQuery, arrived: Pred, maxTicks?: number, op?: RegExp | number): Promise<void>;
    /**
     * After the conversation that queues the completion: wait for the quest tab to show it complete,
     * then answer the reward's level-up pages and close the quest scroll, so the next leg's first
     * click is not spent on them. `levelUp`: the reward raises a level, so its page is waited for
     * (it opens one or two ticks after the completion, m: Doric's Mining 1 -> 49) unless its message
     * has come since `since` (the conversation's start: a burst talk still listening answers the page
     * itself); without one, nothing is waited for beyond what is already open.
     */
    completion(ctx: Ctx, seg: string, key: QuestKey, levelUp: boolean, since: number): Promise<void>;
}

/** Ticks a reward's level-up page gets to open after the quest shows complete (m: 1-2, Doric's Mining). */
export const COMPLETION_PAGE_TICKS = 4;
/** The level-up page's game message (levelup.rs2's mes). */
const LEVEL_UP = /^Congratulations, you just advanced/i;

/** The interrupts every quest conversation and click takes: the level-up pages (fresh chain state per call). */
export const interrupts = (): Interrupt[] => [levelUpInterrupt()];

export function questMoves(stepId: string): QuestMoves {
    const sdkOf = (ctx: Ctx) => ctx.sdk as unknown as QuestSdk;
    const fail = (seg: string, why: string, sdk?: QuestSdk): never => {
        throw new Error(`${stepId}:${seg}: ${why}${sdk ? ` at ${JSON.stringify(pos(sdk))}` : ''}`);
    };
    const note = (ctx: Ctx, seg: string, meta: Record<string, unknown>) => logNote(ctx.log, ctx.session, `${stepId}:${seg}`, meta);
    const noteShape = (ctx: Ctx, seg: string, who: string, r: ConverseResult, extra: Record<string, unknown> = {}) =>
        note(ctx, seg, {
            who, pages: r.pages, options: r.options, ticks: r.ticks,
            ...(r.levelUps ? { levelUps: r.levelUps } : {}),
            ...(r.shape ? { shape: r.shape.seen, expected: r.shape.expected, matches: r.shape.matches, bursts: r.shape.bursts, failedBursts: r.shape.failedBursts } : {}),
            ...extra,
        });

    return {
        sdkOf,
        fail,
        note,
        async go(ctx, seg, to, what, via) {
            const sdk = sdkOf(ctx);
            let why = '';
            for (let i = 0; i < 3; i++) {
                if (inArea(sdk, to)) return;
                // A retry goes straight: the via tiles may be behind the player by then.
                const r = await runTo(sdk, to, { bot: ctx.bot, ...(via && i === 0 ? { via } : {}) });
                if (r.ok) return;
                why = r.reason ?? 'not arrived';
            }
            if (!inArea(sdk, to)) fail(seg, `run to ${what} (${to.x},${to.z}) failed (${why})`, sdk);
        },
        async talk(ctx, seg, opts, t, extra = {}) {
            const sdk = sdkOf(ctx);
            const r = await talkTo(sdk, t.npc, t.choices ?? [], {
                near: t.near, interrupts: interrupts(), unmatched: 'stop', idle: t.idle ?? 0, maxTicks: t.maxTicks ?? 120,
                ...(t.until ? { until: t.until } : {}), ...talkShape(opts, t.shape),
            });
            if (!r.opened) fail(seg, `${t.who}: no dialogue opened`, sdk);
            if (!r.ok) fail(seg, `${t.who}: ${r.reason}`, sdk);
            noteShape(ctx, seg, t.who, r, { clicks: r.clicks, ...(r.settleTicks ? { settleTicks: r.settleTicks } : {}), ...extra });
            return r;
        },
        async locMove(ctx, seg, what, loc, arrived, maxTicks = 20, op = 1) {
            const sdk = sdkOf(ctx);
            if (arrived(sdk.getState()!)) return;
            const r = await opLoc(sdk, { radius: 20, ...loc }, op, arrived, { maxTicks, interrupts: interrupts() });
            if (!r.ok) fail(seg, `${what}: no arrival within ${maxTicks} ticks`, sdk);
            note(ctx, seg, { loc: what, clickToEffect: r.ticks, resends: r.resends });
        },
        async completion(ctx, seg, key, levelUp, since) {
            const sdk = sdkOf(ctx);
            const t0 = currentTick(sdk);
            await waitOrThrow(sdk, (s: BotWorldState) => questStatus(s, key) === 'complete', 10, `${stepId}:${seg} quest complete`);
            // The reward's level-up pages (stat_advance's [advancestat], one or two ticks after the
            // completion) and the quest scroll (a modal). TEMPORARY until rs/185's shared converse
            // fix: the page is waited for here rather than by converse's openTicks, because as an
            // `interrupts` page it does not count as the conversation opening (converse.ts, the
            // interruptKey rule) and converse waits out the window after answering it (m: +4).
            const open = (s: BotWorldState) => s.dialog.isOpen || s.modalOpen;
            const answered = (s: BotWorldState) => messagesSince(s, since, LEVEL_UP).length > 0 && !open(s);
            if (levelUp && !open(sdk.getState()!) && !answered(sdk.getState()!)) await waitUntil(sdk, s => open(s) || answered(s), { maxTicks: COMPLETION_PAGE_TICKS });
            const r = await converse(sdk, [], { openTicks: 0, idle: 1, closeModals: true });
            if (sdk.getState()?.modalOpen) {
                await sdk.sendCloseModal();
                await waitUntil(sdk, s => !s.modalOpen, { maxTicks: 3 });
            }
            note(ctx, seg, { completion: true, levelUps: r.levelUps, pages: r.pages, ticks: currentTick(sdk) - t0 });
        },
    };
}

/** The first state's player tile inside `box` of +-r round `c` (the arrival checks). */
export function near(c: { x: number; z: number }, r: number, level = 0) {
    return { x0: c.x - r, z0: c.z - r, x1: c.x + r, z1: c.z + r, level };
}
