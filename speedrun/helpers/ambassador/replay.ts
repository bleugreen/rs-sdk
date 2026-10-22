#!/usr/bin/env bun
// Replay a window of a real chat log through the ambassador's conversation loop,
// offline: the `seen` lines are fed to the real Conversation (persona, prompts,
// limits, near-repeat guard, memory) on a simulated clock, with a real model. Nothing
// reaches a game. The limiter and player memory start as they stood at the window's
// start (rebuilt from the log's earlier `sent` lines), as after a deploy at that moment.
// The simulated clock advances by each model call's real latency, so staleness and
// pacing behave as they did live. Writes the replay's own chat log, then compares its
// variety and character (variety.ts) with what was actually sent in the same window,
// or with another replay's log (--compare).
//
// A Bounty Board can ride along: --bounties is a board config (the role's `bounties`
// option as JSON) and --offers a fake bidder offers file (ge-offers.ts), served as if
// freshly written at every moment of the replay; its fills keep their own times.
//
//   bun speedrun/helpers/ambassador/replay.ts <chat-YYYY-MM-DD.jsonl> --since ISO --until ISO
//       [--max-calls 200] [--out DIR] [--base-url http://127.0.0.1:11434 | --key-file ~/.rs-fleet/llm-key] [--model NAME]
//       [--bounties board.json --offers offers.json] [--compare other-replay/chat-YYYY-MM-DD.jsonl]
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Conversation, GE_POST, LOOP, type Clock } from '../ambassador';
import type { AmbassadorIO } from './io';
import { ChatLog, readRecords, type LogRecord } from './log';
import { PlayerMemory } from './memory';
import { parseOffers, type OffersSnapshot } from '../ge-offers';
import { boardConfig, BountyBoard, mentionsIn, type BoardConfig } from './bounty';
import { materialFrom, ModelClient, systemPrompt, type ChatModel, type CompleteOptions, type ContextLine } from './model';
import { buildDenyList, isOurs, Limiter, type Channel, type ChatLine, type SendKind } from './policy';
import { analyse, character, formatCharacter, formatReport, heardLines, sentLines, type CharacterReport, type VarietyReport } from './variety';

export interface ReplayResult {
    calls: number;
    /** Simulated time the replay reached (the window end, or where the call cap stopped it). */
    reachedMs: number;
    records: LogRecord[];
}

/** Feed `seen` records to a Conversation on a simulated clock until `untilMs` or `maxCalls` model calls. */
export async function replay(
    records: readonly LogRecord[],
    o: { sinceMs: number; untilMs: number; maxCalls: number; model: ChatModel; persona: string; logDir: string; selfName?: string; board?: BoardConfig; offers?: OffersSnapshot }
): Promise<ReplayResult> {
    let now = o.sinceMs;
    const offers = o.offers;
    const bounty = o.board ? new BountyBoard(o.board, undefined, () => (offers ? { ...offers, writtenAt: new Date(now).toISOString() } : null), o.sinceMs) : undefined;
    const clock: Clock = { now: () => now, sleep: async ms => void (now += ms) };
    const before = records.filter(r => Date.parse(r.t) < o.sinceMs);
    const limiter = new Limiter();
    const memory = new PlayerMemory();
    for (const s of before) {
        if (s.kind !== 'sent' || s.ok === false || typeof s.text !== 'string') continue;
        const kind = (['reply', 'decline', 'opener'].includes(String(s.purpose)) ? s.purpose : 'reply') as SendKind;
        limiter.record(Date.parse(s.t), kind, typeof s.to === 'string' ? s.to : null, String(s.finalText || s.text));
    }
    limiter.prune(o.sinceMs);
    memory.seed(sentLines(before));
    const context: ContextLine[] = before
        .filter(r => (r.kind === 'seen' && !r.ours) || (r.kind === 'sent' && r.ok !== false))
        .filter(r => Date.parse(r.t) >= o.sinceMs - 30 * 60_000 && typeof r.text === 'string')
        .map(r => ({
            sender: r.kind === 'sent' ? '(you)' : String(r.sender),
            channel: (r.channel === 'pm' ? 'pm' : 'public') as Channel,
            text: String(r.kind === 'sent' ? r.finalText || r.text : r.text),
            ...(r.kind === 'sent' ? { self: true } : {})
        }))
        .slice(-LOOP.contextLines);

    const incoming = records
        .filter(r => r.kind === 'seen' && Date.parse(r.t) >= o.sinceMs && Date.parse(r.t) < o.untilMs && typeof r.sender === 'string')
        .map(r => ({ at: Date.parse(r.t), sender: String(r.sender), channel: (r.channel === 'pm' ? 'pm' : 'public') as Channel, text: String(r.text), type: Number(r.type ?? 2), tick: Number(r.tick ?? 0) }));
    let next = 0;
    const heard: { at: number; sender: string }[] = [];
    const io: AmbassadorIO = {
        readNewChat() {
            const out: ChatLine[] = [];
            while (next < incoming.length && incoming[next]!.at <= now) {
                const l = incoming[next++]!;
                heard.push({ at: l.at, sender: l.sender });
                out.push({ ...l, at: now });
            }
            return out;
        },
        say: async text => ({ ok: true, finalText: text, filtered: false, truncated: false, message: 'replayed' }),
        pm: async (_to, text) => ({ ok: true, finalText: text, filtered: false, truncated: false, message: 'replayed' }),
        self: () => ({ name: o.selfName ?? 'Cairn Md', x: GE_POST.x, z: GE_POST.z, level: 0 }) as ReturnType<AmbassadorIO['self']>,
        nearbyPlayers: () => [...new Set(heard.filter(h => now - h.at < 5 * 60_000 && !isOurs(h.sender)).map(h => h.sender))],
        returnToPost: async () => true
    };

    let calls = 0;
    const model: ChatModel = {
        label: () => o.model.label(),
        async complete(system: string, user: string, opts?: CompleteOptions) {
            calls++;
            const start = Date.now();
            try {
                return await o.model.complete(system, user, opts);
            } finally {
                now += Date.now() - start;
            }
        }
    };

    const log = new ChatLog(o.logDir, () => now);
    const conv = new Conversation({
        io,
        model,
        log: { write: (k, d) => log.write(k, d), muted: () => false, saveState: () => {} },
        limiter,
        deny: buildDenyList([], ['cairn_md', 'cairn_amb', 'cairn_cam', 'cairn_dot_md', 'cairn_mule1', 'cairn_mule2']),
        system: systemPrompt(o.persona),
        selfName: o.selfName ?? 'Cairn Md',
        post: GE_POST,
        initiate: true,
        clock,
        report: () => {},
        context,
        memory,
        material: materialFrom(o.persona),
        ...(bounty ? { bounty } : {})
    });
    while (now < o.untilMs && calls < o.maxCalls) {
        await conv.step();
        now += LOOP.pollMs;
    }
    return { calls, reachedMs: Math.min(now, o.untilMs), records: readRecords(o.logDir, o.sinceMs - 1, now + 1) };
}

export interface Pair {
    to: string;
    heard: string;
    before: string;
    after: string;
}

/** The line each send answered: the latest one heard from that player before it. */
function answered(records: readonly LogRecord[], seen: readonly LogRecord[]): Map<string, string> {
    const out = new Map<string, string>();
    for (const s of records) {
        if (s.kind !== 'sent' || s.ok === false || typeof s.to !== 'string') continue;
        const at = Date.parse(s.t);
        const line = seen.filter(r => r.sender === s.to && Date.parse(r.t) <= at).at(-1);
        if (line) out.set(`${s.to}\u0000${line.t}`, String(s.finalText || s.text));
    }
    return out;
}

/** Lines both the live run and the replay answered: what each said to the same chat line. */
export function pairs(live: readonly LogRecord[], replayed: readonly LogRecord[], seen: readonly LogRecord[]): Pair[] {
    const a = answered(live, seen);
    const b = answered(replayed, seen);
    const out: Pair[] = [];
    for (const [key, before] of a) {
        const after = b.get(key);
        if (after === undefined) continue;
        const [to, t] = key.split('\u0000') as [string, string];
        out.push({ to, heard: String(seen.find(r => r.t === t && r.sender === to)?.text ?? ''), before, after });
    }
    return out;
}

function counts(records: readonly LogRecord[]): Record<string, unknown> {
    const by = (kind: string) => records.filter(r => r.kind === kind);
    const blocked: Record<string, number> = {};
    for (const r of by('blocked')) {
        const k = r.guard ? `${r.reason}:${r.guard}` : String(r.reason);
        blocked[k] = (blocked[k] ?? 0) + 1;
    }
    return {
        decisions: by('decision').length,
        sent: by('sent').length,
        retries: by('retry').length,
        blocked,
        outputFilterBlocked: by('blocked').filter(r => !['repeat', 'opener-reused', 'near-repeat'].includes(String(r.reason))).length,
        injections: by('injection').length,
        stale: by('stale').length
    };
}

function flag(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

function readLog(file: string): LogRecord[] {
    return readFileSync(file, 'utf8')
        .split('\n')
        .filter(l => l.trim())
        .map(l => JSON.parse(l) as LogRecord);
}

/** Variety and character of the lines sent in `records`, measured against the lines heard in `seen`. */
function measure(records: readonly LogRecord[], seen: readonly LogRecord[], board?: BoardConfig): { variety: VarietyReport; character: CharacterReport; bountyLines?: number } {
    const sent = sentLines(records);
    return {
        variety: analyse(sent),
        character: character(sent, heardLines(seen)),
        ...(board ? { bountyLines: sent.filter(s => mentionsIn(s.text, board).items.length).length } : {})
    };
}

if (import.meta.main) {
    const file = process.argv[2];
    const since = flag('since');
    const until = flag('until');
    if (!file || file.startsWith('--') || !since || !until) {
        console.error('usage: replay.ts <chat-log.jsonl> --since ISO --until ISO [--max-calls 200] [--out DIR] [--base-url URL] [--model NAME]');
        process.exit(2);
    }
    const records = readLog(file);
    const sinceMs = Date.parse(since);
    const untilMs = Date.parse(until);
    const outDir = flag('out') ?? mkdtempSync(join(tmpdir(), 'amb-replay-'));
    // A key file picks its provider as the role does (model.ts resolveEndpoint); otherwise an Ollama URL.
    const keyFile = flag('key-file');
    const model = keyFile
        ? new ModelClient({ keyFile, ...(flag('model') ? { model: flag('model') } : {}) })
        : new ModelClient({ baseUrl: flag('base-url') ?? 'http://127.0.0.1:11434', api: 'ollama', model: flag('model') ?? 'qwen3.5:27b' });
    console.log(`model: ${model.label()}`);
    const persona = readFileSync(join(import.meta.dir, 'persona.md'), 'utf8');
    const boardFile = flag('bounties');
    const parsedBoard = boardFile ? boardConfig(JSON.parse(readFileSync(boardFile, 'utf8'))) : null;
    if (parsedBoard && !parsedBoard.ok) throw new Error(`--bounties: ${parsedBoard.error}`);
    const board = parsedBoard?.ok ? parsedBoard.value : undefined;
    const offersFile = flag('offers');
    const offers = offersFile ? (parseOffers(JSON.parse(readFileSync(offersFile, 'utf8'))) ?? undefined) : undefined;
    if (offersFile && !offers) throw new Error('--offers: not an offers file');
    const r = await replay(records, { sinceMs, untilMs, maxCalls: Number(flag('max-calls') ?? 200), model, persona, logDir: outDir, ...(board ? { board } : {}), ...(offers ? { offers } : {}) });
    const inWindow = (x: LogRecord) => Date.parse(x.t) >= sinceMs && Date.parse(x.t) < r.reachedMs;
    const live = records.filter(inWindow);
    const seen = live.filter(x => x.kind === 'seen');
    // The lines to compare with: what was sent live, or another replay's log over the same window.
    const compareFile = flag('compare');
    const before = compareFile ? readLog(compareFile).filter(inWindow) : live;
    const label = compareFile ? `compare (${compareFile})` : 'live';
    const summary = {
        window: { since, until, reached: new Date(r.reachedMs).toISOString(), modelCalls: r.calls, seen: seen.length, model: model.label(), board: board?.bounties.map(b => b.item) ?? null },
        before: { source: label, ...counts(before), ...measure(before, seen, board) },
        after: { ...counts(r.records), ...measure(r.records, seen, board) },
        pairs: pairs(before, r.records, seen),
        ...(board ? { bountyLines: sentLines(r.records).filter(s => mentionsIn(s.text, board).items.length || /bount|board/i.test(s.text)) } : {})
    };
    writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(`replay log and summary.json in ${outDir}`);
    console.log(JSON.stringify(summary.window));
    console.log(`\n== before (${label})\n${JSON.stringify(counts(before))}\n${formatReport(summary.before.variety)}\n${formatCharacter(summary.before.character)}`);
    console.log(`\n== after (replay)\n${JSON.stringify(counts(r.records))}\n${formatReport(summary.after.variety)}\n${formatCharacter(summary.after.character)}`);
    if (summary.bountyLines) {
        console.log(`\n== ${summary.bountyLines.length} bounty lines`);
        for (const l of summary.bountyLines) console.log(`${new Date(l.at).toISOString().slice(11, 19)} ${l.to ?? '(opener)'}: ${l.text}`);
    }
    console.log(`\n== ${summary.pairs.length} pairs`);
    for (const p of summary.pairs) console.log(`${p.to}: ${p.heard}\n  before: ${p.before}\n  after:  ${p.after}`);
}
