// Fixed against burst dialogue on one repeatable conversation, for the lab and the demo alike:
// Father Aereck's default branch in Lumbridge church (father_aereck.rs2), which never touches
// %prieststart, so a fresh account can repeat it as often as it likes.
//
//   welcome, > Who's Saradomin?, 5 pages, > Oh, sorry. I'm not from this world., 4 pages,
//   > You don't understand. This is a computer game!, 3 pages
//
// The driver logs in through lib/session.ts, skips the tutorial if the account is still on
// Tutorial Island (skills/start.ts S00, no staff commands), runs to the church, holds TALKS
// conversations alternating fixed and burst (fixed first), and logs out, confirmed. Nothing else:
// no staff command anywhere, so the demo path is the lab path.
//
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <fresh bot> 'speedrun/lab/quests/aereck-burst.ts:--lab:--launch'
//   bun speedrun/lab/quests/aereck-burst.ts <bot> --launch [--client=browser]       (the demo)
//
// --lab refuses any world but the local engine; without it the driver refuses the local engine and
// a `cairn_*` account. --talks=N (even, default 16) shortens a rehearsal.
//
// Prints a DIALOGUE line per conversation (dialogue-burst.ts's format) with its TRANSCRIPT lines,
// then a summary table per mode and a RESULT line.

import { talkTo } from '../../lib/act';
import type { ConverseResult } from '../../lib/converse';
import { matchesOption, type OptionPattern } from '../../lib/dialogue';
import { closeSession, loadBotEnv, logoutClean, openSession, type ClientKind, type LogoutResult, type Session } from '../../lib/session';
import { TickLog } from '../../lib/ticks';
import { runTo, type TravelSdk } from '../../lib/travel';
import { onTutorialIsland, tutorialSkip } from '../../skills/start';
import { runSteps } from '../../runner/step';
import { talkShape, type DialogueMode } from '../../quests/segments';
import { arg, botArg, result } from '../common';
import { stats } from '../record';
import { dialogueLines } from './dialogue-burst';

/** The default branch's shape (CONVENTIONS.md notation): 13 continue pages and 3 option clicks. */
export const AERECK_SHAPE = '1c, opt, 5c, opt, 4c, opt, 3c';
export const AERECK = /^Father Aereck$/;
export const AERECK_CHOICES: readonly OptionPattern[] = ["Who's Saradomin?", "Oh, sorry. I'm not from this world.", "You don't understand. This is a computer game!"];
/** Option 3 of the welcome menu starts The Restless Ghost and changes every later conversation. */
export const QUEST_OPTION = "I'm looking for a quest!";
/** Inside the church, by Father Aereck's spawn (m50_50.jm2: 3244,3206); he wanders, talkTo walks the rest. */
export const CHURCH = { x: 3243, z: 3208, tol: 3 } as const;
/** One conversation's own budget, in ticks: the branch is 16 pages, about 20 ticks fixed. */
export const TALK_MAX_TICKS = 60;
export const DEFAULT_TALKS = 16;

/** The conversations' modes in order: fixed, burst, fixed, burst... */
export function talkOrder(n: number): DialogueMode[] {
    if (!Number.isInteger(n) || n < 2 || n % 2) throw new Error(`talks: want an even number of at least 2, got ${n}`);
    return Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 'fixed' : 'burst'));
}

/** Throws when any choice could pick the quest option. */
export function assertNoQuestChoice(choices: readonly OptionPattern[]): void {
    const bad = choices.find(c => matchesOption(QUEST_OPTION, c));
    if (bad !== undefined) throw new Error(`refusing choice ${String(bad)}: it matches "${QUEST_OPTION}" (starts The Restless Ghost)`);
}

export type TalkSdk = TravelSdk;

/** One conversation with Father Aereck in `mode`. A menu none of the choices answers stops it (ok false); it never takes a default. */
export async function talkAereck(sdk: TalkSdk, mode: DialogueMode, choices: readonly OptionPattern[] = AERECK_CHOICES): Promise<ConverseResult> {
    assertNoQuestChoice(choices);
    const r = await talkTo(sdk, AERECK, [...choices], { ...talkShape({ dialogue: mode }, AERECK_SHAPE), unmatched: 'stop', maxTicks: TALK_MAX_TICKS });
    const clicked = r.transcript.find(l => /^\[\d+\] > /.test(l) && matchesOption(l, QUEST_OPTION));
    if (clicked) throw new Error(`the quest option was clicked: ${clicked}`);
    return r;
}

export interface Talk {
    mode: DialogueMode;
    r: ConverseResult;
}

/**
 * Hold one conversation per entry of `modes`, in order, while the loop's tick budget lasts. A failed
 * conversation ends the loop: its pages are unknown, and the next talk would start mid-dialogue.
 */
export async function talkLoop(
    sdk: TalkSdk,
    modes: readonly DialogueMode[],
    opts: { budgetTicks?: number; talk?: (sdk: TalkSdk, mode: DialogueMode) => Promise<ConverseResult>; onTalk?: (t: Talk, i: number) => void } = {}
): Promise<{ talks: Talk[]; stopped?: string }> {
    const talk = opts.talk ?? talkAereck;
    const budget = opts.budgetTicks ?? modes.length * TALK_MAX_TICKS;
    const t0 = sdk.getState()?.tick ?? 0;
    const talks: Talk[] = [];
    for (const [i, mode] of modes.entries()) {
        const used = (sdk.getState()?.tick ?? t0) - t0;
        if (used > budget) return { talks, stopped: `tick budget ${budget} spent after ${talks.length} talks (${used} ticks)` };
        const t = { mode, r: await talk(sdk, mode) };
        talks.push(t);
        opts.onTalk?.(t, i);
        if (!t.r.ok || !t.r.opened) return { talks, stopped: `talk ${i + 1} (${mode}) failed: ${t.r.reason ?? 'no dialogue opened'}` };
    }
    return { talks };
}

/** One answered step of a conversation: a page, an option click, or a burst of pages, with the tick it was first seen. */
export interface AnswerStep {
    tick: number;
    pages: number;
    kind: 'page' | 'option' | 'burst';
    /** Ticks from this step's page first seen to the next page (or the close) showing: where our click landed. */
    gap: number;
}

/**
 * The steps of a transcript and their reaction gaps. Page and option lines carry the tick their page
 * was first seen; a burst notes all its pages on its first page's tick. Each step's gap runs to the
 * next step's tick, the last one's to `endTick` (the first tick seen closed).
 */
export function answerSteps(transcript: readonly string[], endTick: number): AnswerStep[] {
    const steps: Array<Omit<AnswerStep, 'gap'>> = [];
    for (const line of transcript) {
        const m = /^\[(\d+)\] (page: |> )/.exec(line);
        if (!m) continue;
        const tick = Number(m[1]);
        const last = steps.at(-1);
        if (last && last.tick === tick && m[2] === 'page: ' && last.kind !== 'option') {
            last.pages++;
            last.kind = 'burst';
        } else steps.push({ tick, pages: 1, kind: m[2] === '> ' ? 'option' : 'page' });
    }
    return steps.map((s, i) => ({ ...s, gap: (steps[i + 1]?.tick ?? endTick) - s.tick }));
}

export interface ModeSummary {
    mode: DialogueMode;
    n: number;
    /** Click to closed (ConverseResult.ticks), each and mean. */
    ticks: number[];
    meanTicks: number;
    /** First page seen to closed: the conversation without the walk up to the NPC. */
    dialogueTicks: number[];
    meanDialogueTicks: number;
    /** Answered pages per conversation (continues + options). */
    answered: number[];
    /** Mean of dialogueTicks / answered. */
    perPage: number;
    bursts: number;
    failedBursts: number;
    matches: number;
    /** Reaction gaps of the single-page steps (pages and options), and how often each value came. */
    gaps: number[];
    gapCounts: Record<number, number>;
    meanGap: number;
    /** Each burst as `pages:ticks` (first page seen to the landing seen). */
    burstSpans: string[];
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const mean = (xs: readonly number[]) => (xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : NaN);

export function summarize(talks: readonly Talk[], mode: DialogueMode): ModeSummary {
    const rs = talks.filter(t => t.mode === mode).map(t => t.r);
    const dialogueTicks = rs.map(r => (r.firstTick >= 0 ? r.endTick - r.firstTick : NaN));
    const answered = rs.map(r => r.pages + r.options);
    const steps = rs.flatMap(r => answerSteps(r.transcript, r.endTick));
    const gaps = steps.filter(s => s.kind !== 'burst').map(s => s.gap);
    const gapCounts: Record<number, number> = {};
    for (const g of gaps) gapCounts[g] = (gapCounts[g] ?? 0) + 1;
    return {
        mode,
        n: rs.length,
        ticks: rs.map(r => r.ticks),
        meanTicks: mean(rs.map(r => r.ticks)),
        dialogueTicks,
        meanDialogueTicks: mean(dialogueTicks),
        answered,
        perPage: mean(dialogueTicks.map((t, i) => t / answered[i]!)),
        bursts: rs.reduce((a, r) => a + (r.shape?.bursts ?? 0), 0),
        failedBursts: rs.reduce((a, r) => a + (r.shape?.failedBursts ?? 0), 0),
        matches: rs.filter(r => r.shape?.matches).length,
        gaps,
        gapCounts,
        meanGap: mean(gaps),
        burstSpans: steps.filter(s => s.kind === 'burst').map(s => `${s.pages}:${s.gap}`),
    };
}

export function formatSummary(sums: readonly ModeSummary[], label = 'lab'): string {
    const counts = (c: Record<number, number>) => Object.entries(c).sort(([a], [b]) => Number(a) - Number(b)).map(([g, n]) => `${g}t×${n}`).join(', ');
    const lines = [
        `| Where | Mode | Talks | Click to closed, each | Mean | First page to closed, each | Mean | Per page | Bursts | Failed bursts | Shape matches | Reaction gaps (single pages) | Mean gap | Bursts (pages:ticks) |`,
        '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ];
    for (const s of sums) {
        lines.push(
            `| ${label} | ${s.mode} | ${s.n} | ${s.ticks.join(', ')} | ${s.meanTicks} | ${s.dialogueTicks.join(', ')} | ${s.meanDialogueTicks} | ${s.perPage} | ${s.bursts} | ${s.failedBursts} | ${s.matches}/${s.n} | ${counts(s.gapCounts)} | ${s.meanGap} | ${s.burstSpans.join(', ') || '-'} |`
        );
    }
    return lines.join('\n');
}

/** Log out and require the confirmation: a logout that is not confirmed throws. */
export async function confirmedLogout(session: Session, opts: { timeoutMs?: number } = {}): Promise<LogoutResult> {
    const out = await logoutClean(session, opts);
    if (!out.ok) throw new Error(`${session.name}: logout not confirmed: ${out.reason ?? 'unknown'}`);
    return out;
}

const isLocal = (server: string | undefined) => /^(localhost|127\.)/.test(server ?? '');

/** The demo's account rules, checked before any login: the world matches the mode, and no branded name off the lab. */
export function checkTarget(env: { BOT_USERNAME: string; SERVER?: string }, lab: boolean): void {
    if (lab && !isLocal(env.SERVER)) throw new Error('--lab drives the local lab engine only');
    if (!lab && isLocal(env.SERVER)) throw new Error('without --lab this is the demo run: the account must point at the demo world');
    if (!lab && /^cairn_/i.test(env.BOT_USERNAME)) throw new Error(`${env.BOT_USERNAME}: the demo run takes an unbranded throwaway, not a cairn_* account`);
}

async function main(): Promise<void> {
    const lab = process.argv.includes('--lab');
    const n = Number(arg('talks', String(DEFAULT_TALKS)));
    const modes = talkOrder(n);
    const client = arg('client', 'lite') as ClientKind;
    const bot = botArg();
    checkTarget(loadBotEnv(bot), lab);

    const session = await openSession(bot, { client, launch: process.argv.includes('--launch') });
    let exit = 0;
    let logout: LogoutResult | null = null;
    const talks: Talk[] = [];
    try {
        const { sdk } = session;
        const s0 = sdk.getState()!;
        console.log(`aereck-burst: ${session.name} on ${lab ? 'the lab' : 'the demo'}, ${client} client, at ${s0.player?.worldX},${s0.player?.worldZ} tick ${s0.tick}; ${n} talks ${modes.join(',')}`);
        if (onTutorialIsland(s0.player)) {
            const log = TickLog.open(`aereck-${session.name}`);
            await runSteps(session, [tutorialSkip], { log, c: {}, shouldStop: () => false, tickMonitor: false });
            console.log(`tutorial skipped: at ${sdk.getState()?.player?.worldX},${sdk.getState()?.player?.worldZ}`);
        }
        const walk = await runTo(sdk, CHURCH, { bot: session.bot, maxTicks: 300 });
        console.log(`walk to the church: ${walk.ok ? 'ok' : `FAILED (${walk.reason})`} ${walk.ticks} ticks`);
        if (!walk.ok) throw new Error(`walk to the church failed: ${walk.reason}`);

        const loop = await talkLoop(sdk, modes, {
            onTalk: (t, i) => {
                // Tick delivery to a lone account differs from one in a crowd (host thread, 2026-10-21): record the crowd.
                console.log(`talk ${i + 1}/${n} CROWD ${sdk.getState()?.nearbyPlayers.length ?? '?'} players in view`);
                for (const line of dialogueLines(t.mode, t.r)) console.log(line);
            },
        });
        talks.push(...loop.talks);
        if (loop.stopped) {
            console.log(`talk loop stopped: ${loop.stopped}`);
            exit = 1;
        }
    } catch (e) {
        console.log(`aereck-burst: ${e instanceof Error ? e.message : String(e)}`);
        exit = 1;
    } finally {
        try {
            logout = await confirmedLogout(session);
            console.log(`logout confirmed by ${logout.confirmedBy} (click tick ${logout.clickTick}, last in world ${logout.lastInWorldTick})`);
        } catch (e) {
            console.log(`LOGOUT FAILED: ${e instanceof Error ? e.message : String(e)}`);
            exit = 2;
        }
        await closeSession(session);
    }

    const sums = (['fixed', 'burst'] as const).map(m => summarize(talks, m)).filter(s => s.n > 0);
    console.log(`\n${formatSummary(sums, lab ? 'lab' : 'demo')}\n`);
    result('aereck_burst', { lab, talks: talks.length, summaries: sums, logout });
    process.exit(exit);
}

if (import.meta.main) await main();
