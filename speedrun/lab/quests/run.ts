// The quest modules' lab runner: put the lab account in a segment's start
// state (a fixture: levels, varps, items, worn items, tile, via lab/setup.ts),
// run the module's segments --from..--until through runSteps with a TickLog,
// N times, and print a per-segment tick table (mean, min, max per segment and
// in total) ready for a PR body. Each quest's speedrun/lab/quests/<quest>.ts
// supplies its fixtures and calls `labMain`:
//
//   speedrun/lab/lab.sh <bot> speedrun/lab/quests/<quest>.ts:--from=H:--until=J:--runs=3:--dialogue=both:--trace=10
//
// --from / --until take a segment letter or a full step name (until defaults to
// from: one segment); --runs (default 1); --dialogue=fixed|burst|both (default
// fixed; both runs every repetition in each mode and prints the comparison);
// --trace=N prints the player every N ticks and on every hp, dialogue or chat
// change; --launch makes this script launch (and own) the bot's client, which
// a fixture's relog needs: run lab.sh with LAB_RUNNERS=0 then; --client=browser
// runs this checkout's page in a headless tab instead (implies --launch; build
// the bundle first: `bun run build` in server/webclient). Lab only: staff
// commands. Under the table the report lists each run's `note` rows (what a
// segment recorded about itself: casts, refusals, free slots), and a quest's
// `check` can fail a run whose segments passed (a reward's xp).
//
// ::setvar changes a quest's varp but not the quest tab's colours, which are
// what the bot publishes as `quests` (lib/quests.ts): the content recolours
// the tab in ~send_quest_progress and, from the varps, at login
// (login.rs2 ~update_questlist). A fixture that sets vars therefore relogs
// after them by default, so a segment's quest-stage preconditions see the
// fixture's stage.

import type { BotSDK } from '../../../sdk/index';
import type { BotWorldState } from '../../../sdk/types';
import { wield } from '../../lib/act';
import { pageText, resetDialogueMemory } from '../../lib/dialogue';
import { closeSession, openSession, relog, type Session } from '../../lib/session';
import { TickLog, type TickRow } from '../../lib/ticks';
import { waitTicks } from '../../lib/wait';
import { XP_RATE } from '../../lib/xp';
import { configId } from '../../lib/world';
import type { DialogueMode, QuestOptions } from '../../quests/segments';
import { BOUNDARY_STEP, runSteps, type RunnerSession, type Step } from '../../runner/step';
import { launchLabBrowser } from '../browser';
import { arg, botArg, result } from '../common';
import { stats, type Stats } from '../record';
import { clearInventory, give, leaveTutorial, mustTele, setStats, setVars, tele } from '../setup';

/** A segment's start state on the lab account. */
export interface QuestFixture {
    /** The segment this fixture starts (its letter). */
    letter: string;
    /** Levels to ::setstat (skill debug names: attack, prayer, ...), set last so hitpoints and prayer start full. */
    levels?: Readonly<Record<string, number>>;
    /** Varps and varbits to ::setvar (quest stages: grandtree 130). */
    vars?: Readonly<Record<string, number>>;
    /** Items to ::give, obj debug name -> count, in this order (quest items first: a full inventory drops a give silently). */
    items?: Readonly<Record<string, number>>;
    /** Worn at the start (obj debug names, each also in `items`). */
    worn?: readonly string[];
    tile: { x: number; z: number; level?: number };
    /** Relog after setting `vars`, so the published quest tab shows them (default: whenever `vars` is non-empty). Needs --launch. */
    relog?: boolean;
    note?: string;
}

export interface LabQuest<O extends QuestOptions = QuestOptions> {
    /** For the table heading: 'Monkey Madness'. */
    title: string;
    stepId: string;
    steps(opts: O): Step<any>[];
    fixtures: readonly QuestFixture[];
    /** Reference ticks per segment letter (the quest doc's row or the manifest's figure), for the table's delta column. */
    reference?: Readonly<Record<string, number>>;
    /** The module's own options; the runner sets `dialogue`. */
    options?: Omit<O, 'dialogue'>;
    /** Replace the standard fixture application (default `applyFixture`). */
    applyFixture?(session: Session, fixture: QuestFixture): Promise<void>;
    /** Quest-specific setup after the fixture. */
    prepare?(session: Session, fixture: QuestFixture): Promise<void>;
    /** After a run whose segments all passed: a quest-specific outcome check (a reward's xp). A string fails the run with it. */
    check?(session: Session, fixture: QuestFixture, rows: readonly TickRow[]): string | undefined | Promise<string | undefined>;
    /** Where the fixture is set up before the final teleport (default Lumbridge's courtyard: nothing attacks there). */
    staging?: { x: number; z: number };
}

export const STAGING = { x: 3222, z: 3218 } as const;

/**
 * The standard fixture: close any modal, set up at the staging tile, empty the
 * inventory and worn slots, set every var, give every item (checked held, by
 * config id), wear the worn items, set the levels, and teleport to the tile.
 */
export async function applyFixture(session: Session, f: QuestFixture, staging: { x: number; z: number } = STAGING): Promise<void> {
    const sdk = session.sdk;
    await sdk.sendCloseModal();
    await tele(sdk, staging.x, staging.z);
    await clearInventory(sdk);
    const vars = Object.entries(f.vars ?? {});
    if (vars.length) await setVars(sdk, Object.fromEntries(vars));
    if (f.relog ?? vars.length > 0) {
        if (!session.child && session.client !== 'browser') throw new Error(`fixture ${f.letter}: the quest tab only shows the vars after a relog, which needs this script to own the client (LAB_RUNNERS=0 and --launch), or relog: false`);
        await relog(session);
        await waitTicks(sdk, 2);
    }
    const items = Object.entries(f.items ?? {});
    for (const [k, n] of items) await give(sdk, k, n);
    const held = sdk.getState()?.inventory ?? [];
    for (const [k, n] of items) {
        const id = configId('obj', k);
        const have = held.filter(i => i.id === id).reduce((a, i) => a + i.count, 0);
        if (have < n) throw new Error(`fixture ${f.letter}: gave ${n} ${k}, holding ${have}`);
    }
    for (const w of f.worn ?? []) {
        const r = await wield(sdk, configId('obj', w));
        if (!r.ok) throw new Error(`fixture ${f.letter}: could not wear ${w}`);
    }
    if (f.levels && Object.keys(f.levels).length) await setStats(sdk, f.levels);
    await mustTele(sdk, f.tile.x, f.tile.z, f.tile.level ?? 0);
}

/** The segment letter of a step name `<stepId>:<letter>-<label>`, or null. */
export function letterOf(stepId: string, name: string): string | null {
    const m = new RegExp(`^${stepId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:([A-Z][0-9]?)-`).exec(name);
    return m ? m[1]! : null;
}

/** The steps from `from` to `until` inclusive, each a letter or a full step name. */
export function selectSegments<T extends { name: string }>(steps: readonly T[], stepId: string, from: string, until: string = from): T[] {
    const find = (key: string) => {
        const i = steps.findIndex(s => s.name === key || letterOf(stepId, s.name) === key.toUpperCase());
        if (i < 0) throw new Error(`no segment "${key}" in ${steps.map(s => s.name).join(', ')}`);
        return i;
    };
    const i0 = find(from);
    const i1 = find(until);
    if (i1 < i0) throw new Error(`--until=${until} comes before --from=${from}`);
    return steps.slice(i0, i1 + 1);
}

export interface RunRecord {
    ok: boolean;
    error?: string;
    rows: readonly TickRow[];
}

export interface SegmentLine {
    name: string;
    ref?: number;
    /** Per run: the segment's ticks, `fail@N` when its row failed, null when the run never reached it. */
    runs: Array<number | string | null>;
    stats: Stats;
}

export interface LabReport {
    title: string;
    dialogue: DialogueMode;
    runs: number;
    passes: number;
    segments: SegmentLine[];
    /** Ticks between segments (runSteps' boundary rows), per run. */
    boundary: SegmentLine;
    /** Whole run: segments plus boundaries, for the runs that passed. */
    total: SegmentLine;
    errors: string[];
    /** What the segments recorded about themselves (`note` rows, lib/ticks.ts logNote), by run (0-based). */
    notes: Array<{ run: number; step: string; meta: unknown }>;
}

const isStepRow = (r: TickRow) => !r.kind && r.step !== BOUNDARY_STEP;

/** The per-segment table over the runs' TickLog rows. Means, minima and maxima are over the passing values only. */
export function summarize(title: string, dialogue: DialogueMode, names: readonly string[], records: readonly RunRecord[], reference: Readonly<Record<string, number>> = {}, stepId?: string): LabReport {
    const refOf = (name: string) => {
        const l = stepId ? letterOf(stepId, name) : null;
        return l !== null ? reference[l] : reference[name];
    };
    const segments: SegmentLine[] = names.map(name => {
        const runs = records.map(r => {
            const row = r.rows.find(x => isStepRow(x) && x.step === name);
            return row ? (row.ok ? row.ticks : `fail@${row.ticks}`) : null;
        });
        const ref = refOf(name);
        return { name, ...(ref !== undefined ? { ref } : {}), runs, stats: stats(runs.filter((x): x is number => typeof x === 'number')) };
    });
    const bRuns = records.map(r => r.rows.filter(x => !x.kind && x.step === BOUNDARY_STEP).reduce((a, x) => a + x.ticks, 0));
    const tRuns = records.map((r, i) => (r.ok ? segments.reduce((a, s) => a + (typeof s.runs[i] === 'number' ? (s.runs[i] as number) : 0), 0) + bRuns[i]! : null));
    const refs = segments.map(s => s.ref);
    const refTotal = refs.every(x => x !== undefined) ? refs.reduce((a: number, x) => a + x!, 0) : undefined;
    return {
        title,
        dialogue,
        runs: records.length,
        passes: records.filter(r => r.ok).length,
        segments,
        boundary: { name: '(boundaries)', runs: bRuns, stats: stats(bRuns) },
        total: { name: 'Total', ...(refTotal !== undefined ? { ref: refTotal } : {}), runs: tRuns, stats: stats(tRuns.filter((x): x is number => x !== null)) },
        errors: records.filter(r => r.error).map(r => r.error!),
        notes: records.flatMap((r, run) => r.rows.filter(x => x.kind === 'note').map(x => ({ run, step: x.step, meta: x.meta }))),
    };
}

const fmt = (x: number) => (Number.isFinite(x) ? String(Math.round(x * 10) / 10) : '-');

function delta(line: SegmentLine): string {
    if (line.ref === undefined || !line.stats.n) return '';
    const d = line.stats.mean - line.ref;
    const pct = line.ref ? ` (${d >= 0 ? '+' : ''}${Math.round((d / line.ref) * 100)}%)` : '';
    return `${d >= 0 ? '+' : ''}${fmt(d)}${pct}`;
}

function row(line: SegmentLine, bold = false): string {
    const name = bold ? `**${line.name}**` : line.name;
    const runs = line.runs.map(x => (x === null ? '-' : String(x))).join(', ');
    return `| ${name} | ${line.ref ?? ''} | ${runs} | ${fmt(line.stats.mean)} | ${fmt(line.stats.min)} | ${fmt(line.stats.max)} | ${delta(line)} |`;
}

/** The report as a markdown table: one row per segment, the boundaries, the total. */
export function formatReport(r: LabReport): string {
    const out = [
        `### ${r.title}: ${r.passes}/${r.runs} runs passed (dialogue ${r.dialogue}; measured, lab at ${process.env.NODE_TICKRATE ?? process.env.SPEEDRUN_TICK_MS ?? '300'} ms)`,
        '',
        '| Segment | Ref | Runs | Mean | Min | Max | Mean vs ref |',
        '|---|---|---|---|---|---|---|',
        ...r.segments.map(s => row(s)),
        row(r.boundary),
        row(r.total, true),
    ];
    if (r.errors.length) out.push('', ...r.errors.map((e, i) => `- failure ${i + 1}: ${e}`));
    if (r.notes.length) out.push('', 'Notes:', ...r.notes.map(n => `- run ${n.run + 1} ${n.step}: ${JSON.stringify(n.meta)}`));
    return out.join('\n');
}

/** Fixed against burst, segment by segment (mean ticks over passing runs). */
export function formatComparison(fixed: LabReport, burst: LabReport): string {
    const lines = ['| Segment | Fixed mean | Burst mean | Saved |', '|---|---|---|---|'];
    const pair = (a: SegmentLine, b: SegmentLine | undefined, bold = false) => {
        const saved = b && a.stats.n && b.stats.n ? fmt(a.stats.mean - b.stats.mean) : '';
        lines.push(`| ${bold ? `**${a.name}**` : a.name} | ${fmt(a.stats.mean)} | ${b ? fmt(b.stats.mean) : '-'} | ${saved} |`);
    };
    fixed.segments.forEach((s, i) => pair(s, burst.segments[i]));
    pair(fixed.total, burst.total, true);
    return lines.join('\n');
}

export interface LabRunOptions {
    from: string;
    until?: string;
    runs?: number;
    dialogue?: DialogueMode;
    /** Print the player every N ticks (0: off). */
    trace?: number;
}

/** Skills whose base xp gained each run's RESULT line carries. */
export const XP_SKILLS = ['magic', 'defence', 'hitpoints'] as const;

/** Game xp per skill in `XP_SKILLS`. */
export function skillXps(s: BotWorldState | null): Record<string, number> {
    return Object.fromEntries(XP_SKILLS.map(k => [k, s?.skills.find(x => x.name.toLowerCase() === k)?.experience ?? 0]));
}

/** Base xp gained per skill of `before` between two `skillXps` snapshots (game xp / XP_RATE, to 0.1); a skill `after` lacks gained nothing. */
export function baseXpGained(before: Readonly<Record<string, number>>, after: Readonly<Record<string, number>>): Record<string, number> {
    return Object.fromEntries(Object.keys(before).map(k => [k, Math.round((((after[k] ?? before[k]!) - before[k]!) / XP_RATE) * 10) / 10]));
}

/** Apply the fixture of `from`, run the chosen segments, `runs` times; a failed run is recorded and the next one starts afresh. */
export async function runLabQuest<O extends QuestOptions>(session: Session | RunnerSession, quest: LabQuest<O>, o: LabRunOptions): Promise<LabReport> {
    const dialogue = o.dialogue ?? 'fixed';
    // Built afresh for every run: a module's steps() may keep what the run has seen in a closure,
    // and a later run must not inherit it.
    const build = () => selectSegments(quest.steps({ ...(quest.options ?? {}), dialogue } as O), quest.stepId, o.from, o.until);
    let chosen = build();
    const names = chosen.map(c => c.name);
    const letter = letterOf(quest.stepId, names[0]!);
    const fixture = quest.fixtures.find(f => f.letter === letter);
    if (!fixture) throw new Error(`${quest.title}: no fixture for segment ${letter}`);
    const records: RunRecord[] = [];
    for (let run = 0; run < (o.runs ?? 1); run++) {
        if (run > 0) chosen = build();
        // The dialogue layer remembers the last page it acted on per sdk: run N's last page must not
        // read as stale when run N+1's first page has the same id.
        resetDialogueMemory(session.sdk);
        const s = session as Session;
        if (quest.applyFixture) await quest.applyFixture(s, fixture);
        else await applyFixture(s, fixture, quest.staging);
        if (quest.prepare) await quest.prepare(s, fixture);
        const xp0 = skillXps(session.sdk.getState());
        const log = TickLog.memory();
        const untrace = o.trace ? trace(session.sdk, o.trace) : () => undefined;
        let error: string | undefined;
        try {
            await runSteps(session, chosen, { log, c: {}, shouldStop: () => false, tickMonitor: false });
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            untrace();
        }
        if (!error && quest.check) error = (await quest.check(s, fixture, log.rows)) || undefined;
        records.push({ ok: !error, ...(error ? { error } : {}), rows: log.rows });
        result(`${quest.stepId}_run`, {
            run, dialogue, ok: !error, ...(error ? { error } : {}),
            ticks: Object.fromEntries(log.rows.filter(isStepRow).map(r => [r.step, r.ok ? r.ticks : `fail@${r.ticks}`])),
            boundary: log.rows.filter(r => !r.kind && r.step === BOUNDARY_STEP).reduce((a, r) => a + r.ticks, 0),
            xpBase: baseXpGained(xp0, skillXps(session.sdk.getState())),
        });
    }
    return summarize(quest.title, dialogue, names, records, quest.reference, quest.stepId);
}

/** With --trace: the player every `every` ticks, and on every hp, dialogue page or new chat line. */
export function trace(sdk: Pick<BotSDK, 'onStateUpdate'>, every: number): () => void {
    let last = -Infinity;
    let hp = -1;
    let page = '';
    let seen = -1;
    return sdk.onStateUpdate((s: BotWorldState) => {
        const p = s.player;
        if (!p) return;
        const msgs = seen < 0 ? [] : s.gameMessages.filter(m => m.tick > seen).map(m => m.text);
        seen = s.tick;
        const d = s.dialog.isOpen ? `${s.dialog.options.length > 1 ? 'choice' : 'page'}:${pageText(s.dialog).slice(0, 50)}` : '';
        const changed = d !== page;
        page = d;
        if (s.tick - last < every && p.hp === hp && !changed && !msgs.length) return;
        last = s.tick;
        hp = p.hp;
        console.log(`TRACE t=${s.tick} @${p.worldX},${p.worldZ},${p.level} hp=${p.hp} pp=${s.prayers?.prayerPoints ?? '?'} anim=${p.animId}${changed ? ` dialog=${d || 'closed'}` : ''}${msgs.length ? ` msgs=${JSON.stringify(msgs)}` : ''}`);
    });
}

/** The command line for a quest's lab file: `<bot> --from --until --runs --dialogue --trace`. */
export function labArgs(): Omit<LabRunOptions, 'dialogue'> & { dialogue: DialogueMode | 'both'; launch: boolean; client: 'lite' | 'browser' } {
    const dialogue = arg('dialogue', 'fixed');
    if (dialogue !== 'fixed' && dialogue !== 'burst' && dialogue !== 'both') throw new Error(`--dialogue=${dialogue}: want fixed, burst or both`);
    const from = arg('from', '');
    if (!from) throw new Error('--from=<segment letter or step name> is required');
    const until = arg('until', from);
    const client = arg('client', 'lite');
    if (client !== 'lite' && client !== 'browser') throw new Error(`--client=${client}: want lite or browser`);
    return { from, until, runs: Number(arg('runs', '1')), dialogue, trace: Number(arg('trace', '0')), launch: process.argv.includes('--launch') || client === 'browser', client };
}

/** Open the lab bot's session, run, print the table(s) and a RESULT line, close. */
export async function labMain<O extends QuestOptions>(quest: LabQuest<O>): Promise<LabReport[]> {
    const a = labArgs();
    // --client=browser: this checkout's page in a headless lab tab (lab/browser.ts), launched and owned here
    const chrome = a.client === 'browser' ? await launchLabBrowser(botArg()) : null;
    const session = await openSession(botArg(), a.client === 'browser' ? { client: 'browser', launch: true, insecureQueryLogin: true } : { launch: a.launch });
    try {
        // A bot's first login on this engine's saves is on Tutorial Island, where every fixture's tele() refuses.
        await leaveTutorial(session);
        const modes: DialogueMode[] = a.dialogue === 'both' ? ['fixed', 'burst'] : [a.dialogue];
        const reports: LabReport[] = [];
        for (const dialogue of modes) {
            const r = await runLabQuest(session, quest, { ...a, dialogue });
            reports.push(r);
            console.log(`\n${formatReport(r)}\n`);
            result(`${quest.stepId}_table`, r);
        }
        if (reports.length === 2) console.log(`\n${formatComparison(reports[0]!, reports[1]!)}\n`);
        return reports;
    } finally {
        await closeSession(session);
        await chrome?.kill();
    }
}
