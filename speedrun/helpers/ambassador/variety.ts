#!/usr/bin/env bun
// How varied the ambassador sounds, measured from its own lines. The same text
// primitives serve two callers: the analyser below (over a chat-log jsonl, for people
// judging the persona) and the near-repeat guard the conversation loop applies to every
// line before it is sent (nearRepeat), so what is measured is what is enforced.
//
//   bun speedrun/helpers/ambassador/variety.ts <chat-YYYY-MM-DD.jsonl>... [--since ISO] [--until ISO] [--json]
//
// Everything here is pure: no clock, no I/O except the CLI.
import { readFileSync } from 'node:fs';

// ------------------------------------------------------------------ text primitives

/** Lower-case words with apostrophes dropped ("I'm" is "im", "What's" is "whats"). */
export function words(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/['`]/g, '')
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

/** Short words that do not make an opener or phrase distinctive on their own. */
const GLUE = new Set(
    'a an the i im id ive ill you youre your ur we were our my me it its is are am was be on for to of at in with and or but so that this those these just'.split(' ')
);

const STOP = new Set([
    ...GLUE,
    ...'do does did have has had not no yes can cant dont will would there here what whats which who how when where why if then than too very all some any up out get got them they their theirs from into onto over only also like more most much such been being'.split(' ')
]);

/**
 * A line's opening as a template: its first word, plus the next one when either is
 * glue, then "X" for the rest. "Nice gate count!" and "Nice try, I only chat" are
 * both "nice X"; "Congrats on fishing 99!" is "congrats on X"; "What's your fleet
 * doing?" is "whats your X". Punctuation is ignored, so the template also works on
 * the normalised text the limiter keeps.
 */
export function openerOf(text: string): string {
    const w = words(text);
    if (!w.length) return '';
    const key = [w[0]!];
    if (w.length > 1 && (GLUE.has(w[0]!) || GLUE.has(w[1]!))) key.push(w[1]!);
    if (w.length > key.length) key.push('X');
    return key.join(' ');
}

/** Word n-grams of a line that carry at least one non-stopword, each counted once. */
export function phrases(text: string, n = 3): string[] {
    const w = words(text);
    const out = new Set<string>();
    for (let i = 0; i + n <= w.length; i++) {
        const gram = w.slice(i, i + n);
        if (gram.some(x => !STOP.has(x))) out.add(gram.join(' '));
    }
    return [...out];
}

export function isQuestion(text: string): boolean {
    return text.includes('?');
}

const SELF_ID = [
    /\b(im|i am|just|only)\b( \w+){0,3} (a |an )?bots?\b/,
    /\bbots? (run|driven|played) by\b/,
    /\b(run|driven) by (an? )?(team of )?(ai )?agents?\b/,
    /\b(my|our) (ai )?agents\b/,
    /\bagents? (run|drive|handle)s? (me|us)\b/,
    /\bi run on\b( \w+){0,2} agents?\b/,
    /\bwe are all bots\b|\bwe bots\b|\ba bot like me\b|\bas a bot\b/
];

/** The line says what we are: a bot, run by AI agents. */
export function isSelfId(text: string): boolean {
    const s = words(text).join(' ');
    return SELF_ID.some(re => re.test(s));
}

const PROBE =
    /\b(your|ur|their)( \w+)? (fleet|fleets|agent|agents|team|teams|bots|route|routes|operator|owner|setup|script|scripts)\b|\b(which|what) (agent|route|script)\b|\bwho (runs|controls|made) you\b|\bhow many (bots|accounts|alts)\b/;

/** A question about another player's fleet, agents, team or routes: reads as probing, so never asked. */
export function isProbe(text: string): boolean {
    return isQuestion(text) && PROBE.test(words(text).join(' '));
}

// ------------------------------------------------------------------ the near-repeat guard

export const GUARD = {
    /** How many of our latest lines a new one is compared with. */
    window: 30,
    /** An opener template may appear this many times in the window; one more is a near-repeat. */
    openerMax: 1,
    /** A 3-word phrase may appear in this many lines of the window; one more is a near-repeat. */
    phraseMax: 1,
    /** A question when this many of the last questionWindow lines were questions is a near-repeat. */
    questionMax: 3,
    questionWindow: 8,
    /** A content word already in this many of the last wordWindow lines is a near-repeat (the running joke said once too often). */
    wordMax: 3,
    wordWindow: 8
} as const;

export type Guard = typeof GUARD;

/** Content words of a line (four letters or more, not stopwords), plural s dropped. */
export function contentWords(text: string): Set<string> {
    return new Set(
        words(text)
            .filter(w => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w))
            .map(w => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    );
}

export interface NearRepeat {
    reason: 'opener' | 'phrase' | 'word' | 'probe' | 'questions';
    /** The overused opener or phrase, for the retry prompt and the log. */
    detail: string;
}

/**
 * Why `text` would sound like a stock line next to `recent` (our latest lines, oldest
 * first), or null. Exact repeats are the limiter's job; this catches the same
 * template said with different words: a reused opener, a reused three-word phrase,
 * a word we keep coming back to, a question about another player's fleet, or one
 * question too many in a row. Words from `heard` (the lines being answered) are
 * exempt from the word check, so a conversation about bread may keep saying bread.
 */
export function nearRepeat(text: string, recent: readonly string[], g: Guard = GUARD, heard: readonly string[] = []): NearRepeat | null {
    if (isProbe(text)) return { reason: 'probe', detail: 'questions about other players\' fleets, agents or routes' };
    const window = recent.slice(-g.window);
    const opener = openerOf(text);
    if (opener && window.filter(l => openerOf(l) === opener).length >= g.openerMax) return { reason: 'opener', detail: opener };
    for (const p of phrases(text)) {
        if (window.filter(l => phrases(l).includes(p)).length >= g.phraseMax) return { reason: 'phrase', detail: p };
    }
    const theirs = new Set(heard.flatMap(h => [...contentWords(h)]));
    const lately = recent.slice(-g.wordWindow).map(contentWords);
    for (const w of contentWords(text)) {
        if (!theirs.has(w) && lately.filter(s => s.has(w)).length >= g.wordMax) return { reason: 'word', detail: `"${w}" again` };
    }
    if (isQuestion(text) && recent.slice(-g.questionWindow).filter(isQuestion).length >= g.questionMax) {
        return { reason: 'questions', detail: `${g.questionMax} of your last ${g.questionWindow} lines were questions` };
    }
    return null;
}

/** Openers and phrases used more than once in `recent`, most used first: what the prompt tells the model to avoid. */
export function overused(recent: readonly string[], limit = 12): string[] {
    const counts = new Map<string, number>();
    for (const line of recent) {
        for (const key of new Set([openerOf(line), ...phrases(line)])) if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts]
        .filter(([, n]) => n >= 2)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([k]) => k);
}

// ------------------------------------------------------------------ the analyser

export interface SentLine {
    at: number;
    /** The player answered, or null for an opener. */
    to: string | null;
    text: string;
}

export interface Counted {
    key: string;
    lines: number;
}

export interface VarietyReport {
    lines: number;
    questions: number;
    questionShare: number;
    probes: number;
    /** Opener templates by the number of lines that use them. */
    topOpeners: Counted[];
    /** Share of lines whose opener template is one of the five most used. */
    top5OpenerShare: number;
    distinctOpeners: number;
    topPhrases: Counted[];
    selfId: {
        lines: number;
        players: number;
        /** Self-identification lines beyond the first to the same player. */
        repeatsToSamePlayer: number;
        maxToOnePlayer: number;
        byPlayer: Counted[];
    };
    perPlayer10m: {
        /** Most lines to one player inside any 10 minutes. */
        max: number;
        maxPlayer: string | null;
        /** Players who got at least 4 lines inside some 10 minutes. */
        playersAt4: number;
    };
    /** Lines the near-repeat guard would have stopped, judged against the lines before them. */
    guardHits: Record<NearRepeat['reason'], number>;
}

function top(counts: Map<string, number>, n: number): Counted[] {
    return [...counts]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, n)
        .map(([key, lines]) => ({ key, lines }));
}

function bump(m: Map<string, number>, k: string): void {
    m.set(k, (m.get(k) ?? 0) + 1);
}

export function analyse(sent: readonly SentLine[], g: Guard = GUARD): VarietyReport {
    const lines = [...sent].sort((a, b) => a.at - b.at);
    const openers = new Map<string, number>();
    const grams = new Map<string, number>();
    const selfBy = new Map<string, number>();
    const guardHits: VarietyReport['guardHits'] = { opener: 0, phrase: 0, word: 0, probe: 0, questions: 0 };
    let questions = 0;
    let probes = 0;
    let selfLines = 0;
    lines.forEach((l, i) => {
        if (isQuestion(l.text)) questions++;
        if (isProbe(l.text)) probes++;
        bump(openers, openerOf(l.text));
        for (const p of phrases(l.text)) bump(grams, p);
        if (isSelfId(l.text)) {
            selfLines++;
            bump(selfBy, l.to ?? '(opener)');
        }
        const hit = nearRepeat(
            l.text,
            lines.slice(Math.max(0, i - g.window), i).map(x => x.text),
            g
        );
        if (hit) guardHits[hit.reason]++;
    });
    const topOpeners = top(openers, 10);
    const byPlayer = top(selfBy, 50);
    // Lines per player inside any 10 minutes.
    const times = new Map<string, number[]>();
    for (const l of lines) if (l.to) times.set(l.to, [...(times.get(l.to) ?? []), l.at]);
    let max = 0;
    let maxPlayer: string | null = null;
    let playersAt4 = 0;
    for (const [who, ts] of times) {
        let best = 0;
        for (let i = 0, j = 0; i < ts.length; i++) {
            while (ts[i]! - ts[j]! >= 10 * 60_000) j++;
            best = Math.max(best, i - j + 1);
        }
        if (best > max) [max, maxPlayer] = [best, who];
        if (best >= 4) playersAt4++;
    }
    const n = lines.length;
    return {
        lines: n,
        questions,
        questionShare: n ? questions / n : 0,
        probes,
        topOpeners,
        top5OpenerShare: n ? topOpeners.slice(0, 5).reduce((s, c) => s + c.lines, 0) / n : 0,
        distinctOpeners: openers.size,
        topPhrases: top(grams, 10).filter(c => c.lines > 1),
        selfId: {
            lines: selfLines,
            players: selfBy.size,
            repeatsToSamePlayer: [...selfBy.values()].reduce((s, v) => s + v - 1, 0),
            maxToOnePlayer: Math.max(0, ...selfBy.values()),
            byPlayer: byPlayer.filter(c => c.lines > 1)
        },
        perPlayer10m: { max, maxPlayer, playersAt4 },
        guardHits
    };
}

/** Sent lines from chat-log records (the `sent` kind, delivered ones only). */
export function sentLines(records: Iterable<Record<string, unknown>>, sinceMs = -Infinity, untilMs = Infinity): SentLine[] {
    const out: SentLine[] = [];
    for (const r of records) {
        if (r.kind !== 'sent' || r.ok === false || typeof r.text !== 'string' || typeof r.t !== 'string') continue;
        const at = Date.parse(r.t);
        if (at < sinceMs || at >= untilMs) continue;
        out.push({ at, to: typeof r.to === 'string' ? r.to : null, text: String(r.finalText || r.text) });
    }
    return out;
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

export function formatReport(r: VarietyReport): string {
    const out = [
        `lines sent: ${r.lines}`,
        `questions: ${r.questions} (${pct(r.questionShare)}), of them about others' fleets/agents/routes: ${r.probes}`,
        `distinct openers: ${r.distinctOpeners}; top 5 cover ${pct(r.top5OpenerShare)} of lines`,
        ...r.topOpeners.slice(0, 5).map((c, i) => `  opener ${i + 1}: "${c.key}" x${c.lines}`),
        `most reused phrases: ${r.topPhrases.slice(0, 5).map(c => `"${c.key}" x${c.lines}`).join(', ') || 'none'}`,
        `self-identification: ${r.selfId.lines} lines to ${r.selfId.players} players; ${r.selfId.repeatsToSamePlayer} repeats to the same player (most: ${r.selfId.maxToOnePlayer})`,
        `per player in 10 min: max ${r.perPlayer10m.max} (${r.perPlayer10m.maxPlayer ?? '-'}); players with 4+: ${r.perPlayer10m.playersAt4}`,
        `near-repeat guard would stop: ${Object.entries(r.guardHits).map(([k, v]) => `${k} ${v}`).join(', ')}`
    ];
    return out.join('\n');
}

function flag(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.main) {
    const files = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !['--since', '--until'].includes(all[i - 1] ?? ''));
    if (!files.length) {
        console.error('usage: variety.ts <chat-log.jsonl>... [--since ISO] [--until ISO] [--json]');
        process.exit(2);
    }
    const records: Record<string, unknown>[] = [];
    for (const f of files) {
        for (const line of readFileSync(f, 'utf8').split('\n')) {
            if (!line.trim()) continue;
            try {
                records.push(JSON.parse(line));
            } catch {
                // a torn last line
            }
        }
    }
    const since = flag('since');
    const until = flag('until');
    const report = analyse(sentLines(records, since ? Date.parse(since) : -Infinity, until ? Date.parse(until) : Infinity));
    console.log(process.argv.includes('--json') ? JSON.stringify(report, null, 2) : formatReport(report));
}
