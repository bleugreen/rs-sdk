// Quest pre/postconditions from published state.
//
// The progress varps are server-only (speedrun/data/quest-stages.ts header), so
// a quest's stage is read from two signals the bot layer publishes:
//
// - `quests` (the quest tab's colours): not started / started / complete, free
//   every tick. Enough for every quest-level check: a prerequisite done, a
//   quest finished, a step that only starts a quest.
// - `questJournal` (the journal scroll's text): the exact stage of a started
//   quest, mapped through the tables' markers. Reading it costs a click and a
//   close (readQuestStage), so it is for resume and for checks inside a quest.
//
// A journal is evidence only while fresh: questStage takes it from a resume
// probe (runner/resume.ts, `journalProbe`) or from state when it was on screen
// within JOURNAL_FRESH_TICKS, never older, since the stage may have moved since.

import type { BotSDK } from '../../sdk/index';
import type { BotWorldState, QuestJournalState, QuestStatus } from '../../sdk/types';
import { QUESTS, type QuestKey, type QuestStage, type QuestTable, type StageName } from '../data/quest-stages';
import { waitUntil, type StateSource } from './wait';

export type { QuestKey, StageName };

/** What a check sees: the published state, or the resume walk's observation (state plus probe results). */
export type QuestView = BotWorldState | { state: BotWorldState; probed: Readonly<Record<string, unknown>> };

/** A journal in state counts as current for this many ticks after it was last open. */
export const JOURNAL_FRESH_TICKS = 2;

export interface QuestStageReading {
    key: QuestKey;
    status: QuestStatus;
    /** Every stage the evidence allows, ascending. One entry when the stage is known exactly. */
    stages: readonly QuestStage[];
    /** `status` when only the quest tab was read, `journal` when the journal narrowed it. */
    source: 'status' | 'journal';
}

function table(key: QuestKey): QuestTable {
    return QUESTS[key] as QuestTable;
}

function stateOf(view: QuestView): BotWorldState {
    return 'probed' in view ? view.state : view;
}

export function isComplete(key: QuestKey, value: number): boolean {
    const c = table(key).complete;
    return c.test === '=' ? value === c.value : value >= c.value;
}

/** Stages between not started and complete. */
function startedStages(key: QuestKey): QuestStage[] {
    return table(key).stages.filter(s => s.value !== 0 && !isComplete(key, s.value));
}

/**
 * The quest tab's status for `key`, or null when it cannot be observed: not
 * in game, a client that predates `quests`, or a quest off the list (Mage
 * Arena, whose evidence is its items).
 */
export function questStatus(s: BotWorldState, key: QuestKey): QuestStatus | null {
    if (!s.inGame || !s.quests || !table(key).questList) return null;
    return s.quests[key] ?? 'not_started';
}

export function questPoints(s: BotWorldState): number | null {
    return s.inGame && s.questPoints !== undefined ? s.questPoints : null;
}

/** Journal text as markers are written: tags removed, all whitespace removed (the server wraps lines at its own breaks). */
function compact(text: string): string {
    return text.replace(/@[a-z0-9]{3}@/gi, '').replace(/\s+/g, '');
}

/**
 * The stages a journal's text can mean, or null when the journal is another
 * quest's. A text matching no marker is one of the started stages that has
 * none (quest-stages.ts header).
 */
export function stagesFromJournal(key: QuestKey, journal: Pick<QuestJournalState, 'title' | 'lines'>): QuestStage[] | null {
    const t = table(key);
    if (!t.journalTitle || compact(journal.title) !== compact(t.journalTitle)) return null;
    const text = compact(journal.lines.join(''));
    const matched = t.stages.filter(s => s.journal !== undefined && text.includes(compact(s.journal)));
    if (matched.length > 0) return matched;
    return startedStages(key).filter(s => s.journal === undefined);
}

export function journalProbeName(key: QuestKey): string {
    return `journal:${key}`;
}

function freshJournal(view: QuestView, key: QuestKey): QuestJournalState | null {
    if ('probed' in view) {
        const p = view.probed[journalProbeName(key)];
        if (p && typeof p === 'object' && 'lines' in p) return p as QuestJournalState;
    }
    const s = stateOf(view);
    const j = s.questJournal;
    if (!j) return null;
    return j.open || s.tick - j.tick <= JOURNAL_FRESH_TICKS ? j : null;
}

/**
 * The text of `key`'s journal from a probe or a fresh state, compacted as
 * markers are matched (tags and whitespace removed), or null when there is
 * none. For quests whose sub-stages show only in the journal's prose: match
 * a phrase with `journalText(view, key)?.includes(compactJournal(phrase))`.
 */
export function journalText(view: QuestView, key: QuestKey): string | null {
    const t = table(key);
    const j = freshJournal(view, key);
    if (!j || !t.journalTitle || compact(j.title) !== compact(t.journalTitle)) return null;
    return compact(j.lines.join(''));
}

export { compact as compactJournal };

/** Where `key` stands, as far as the published state (and any journal probe) shows; null when unobservable. */
export function questStage(view: QuestView, key: QuestKey): QuestStageReading | null {
    const status = questStatus(stateOf(view), key);
    if (status === null) return null;
    const t = table(key);
    if (status === 'not_started') return { key, status, stages: t.stages.filter(s => s.value === 0), source: 'status' };
    if (status === 'complete') return { key, status, stages: t.stages.filter(s => isComplete(key, s.value)), source: 'status' };
    const started = startedStages(key);
    const journal = freshJournal(view, key);
    const fromJournal = journal ? stagesFromJournal(key, journal) : null;
    if (fromJournal) {
        // The tab and the journal can disagree for a tick around a stage change;
        // the tab's status bounds what the journal may claim.
        const both = fromJournal.filter(s => started.includes(s));
        if (both.length > 0) return { key, status, stages: both, source: 'journal' };
    }
    return { key, status, stages: started, source: 'status' };
}

function describe(r: QuestStageReading): string {
    const names = r.stages.map(s => `${s.name} (${s.value})`);
    return names.length === 1 ? names[0]! : `one of ${names.join(', ')}`;
}

export interface RequireOptions {
    /** Pass at `stage` or any later one (by value), instead of exactly at it. */
    atLeast?: boolean;
}

/**
 * `true` when `key` is at `stage` (or past it, with atLeast), otherwise why
 * not, in the `Check` shape step preconditions and postconditions return.
 * Fails, saying so, when the evidence cannot tell `stage` from a neighbour:
 * read the journal first (readQuestStage, or the `journal:<key>` probe).
 */
export function requireQuestStage<K extends QuestKey>(view: QuestView, key: K, stage: StageName<K>, opts: RequireOptions = {}): true | string {
    const t = table(key);
    const target = t.stages.find(s => s.name === stage);
    if (!target) throw new Error(`requireQuestStage: ${key} has no stage "${stage}"`);
    const r = questStage(view, key);
    if (!r) return `${t.title}: quest state not observable (not in game, an older client, or not on the quest list)`;
    const ok = (s: QuestStage) => (opts.atLeast ? s.value >= target.value : s.value === target.value);
    const passing = r.stages.filter(ok);
    if (passing.length === r.stages.length) return true;
    const want = `${opts.atLeast ? 'at least ' : ''}${stage} (${target.value})`;
    if (passing.length === 0) return `${t.title} is at ${describe(r)}, not ${want}`;
    return `${t.title} is at ${describe(r)} (from the ${r.source === 'journal' ? 'journal' : 'quest tab'}); read the journal to tell whether it is ${want}`;
}

/** For Step.done: the quest is complete. */
export function questDone(key: QuestKey): (o: QuestView) => boolean {
    return o => questStatus(stateOf(o), key) === 'complete';
}

export type JournalSdk = StateSource & Pick<BotSDK, 'sendClickComponent' | 'sendCloseModal'>;

export interface ReadOptions {
    /** Open the journal even when the quest tab already decides the stage (not started, or complete with one stage). */
    force?: boolean;
    /** Leave the journal open (the caller closes it, or the next modal replaces it). */
    leaveOpen?: boolean;
    /** Ticks to wait for the journal after each of the (at most two) clicks; default 3. */
    maxTicks?: number;
}

export interface JournalRead {
    reading: QuestStageReading;
    /** The journal as read; null when the quest tab decided without opening it. */
    journal: QuestJournalState | null;
}

/**
 * Read `key`'s exact stage: click its quest-tab entry, wait for the journal,
 * close it. When the quest tab alone leaves one stage (not started; complete
 * with one complete value; started with one started value, as Cook's
 * Assistant) it is decided without the click. Costs two events and about two
 * ticks when it opens the journal.
 */
export async function readQuestStage(sdk: JournalSdk, key: QuestKey, opts: ReadOptions = {}): Promise<JournalRead> {
    const t = table(key);
    const s0 = sdk.getState();
    if (!s0) throw new Error('readQuestStage: no state');
    const before = questStage(s0, key);
    if (!before || !t.questList || !t.journalTitle) throw new Error(`readQuestStage: ${t.title} is not observable`);
    if (!opts.force && before.stages.length === 1) return { reading: before, journal: null };

    // The click runs a protected script, which the engine skips without a word
    // while the player is busy (delayed, or inside another script, as right after
    // a teleport or a dialogue): so one more click if the journal has not opened
    // in time. The journal opens the tick after an accepted click.
    const perClick = opts.maxTicks ?? 3;
    const journalOpen = (after: number) => (s: BotWorldState) =>
        !!s.questJournal?.open && s.questJournal.tick > after && compact(s.questJournal.title) === compact(t.journalTitle!);
    let opened = null as Awaited<ReturnType<typeof waitUntil>> | null;
    for (let attempt = 0; attempt < 2 && !opened?.ok; attempt++) {
        const sentAt = sdk.getState()?.tick ?? s0.tick;
        await sdk.sendClickComponent(t.questList.componentId);
        opened = await waitUntil(sdk, journalOpen(sentAt), { maxTicks: perClick, after: sentAt });
    }
    if (!opened?.ok) throw new Error(`readQuestStage: the ${t.title} journal did not open after two clicks`);
    const journal = opened.state.questJournal!;
    const reading = questStage({ state: opened.state, probed: { [journalProbeName(key)]: journal } }, key)!;
    if (!opts.leaveOpen) {
        await sdk.sendCloseModal();
        const closed = await waitUntil(sdk, s => !s.questJournal?.open, { maxTicks: 3 });
        if (!closed.ok) throw new Error('readQuestStage: the journal did not close');
    }
    return { reading, journal };
}

/**
 * The resume walk's probe for `key` (register it under journalProbeName(key)):
 * the journal read by readQuestStage, or null when the quest tab decided.
 */
export function journalProbe(key: QuestKey): (session: { sdk: JournalSdk }) => Promise<QuestJournalState | null> {
    return async session => (await readQuestStage(session.sdk, key)).journal;
}

/** Probes for every quest in `keys`, keyed by journalProbeName, for runResumable's `probes`. */
export function journalProbes(keys: readonly QuestKey[]): Record<string, (session: { sdk: JournalSdk }) => Promise<QuestJournalState | null>> {
    return Object.fromEntries(keys.map(k => [journalProbeName(k), journalProbe(k)]));
}
