// The pure half of a clip: which source line issued an action (from its stack), which captured frame
// each frame of a constant-rate video shows, what a state update says changed, and the merge of
// actions, observed state and world-feed ticks onto the video's clock. capture.ts does the I/O.
//
// Every timestamp here is wall-clock epoch ms on the one machine that runs the lab, the browser
// and the script, which is what lets them line up: the hook's `Date.now()` in the script process,
// the observer's in this one, the feed recorder's receive time, and Chrome's screencast frame time.

import { isAbsolute, relative } from 'node:path';
import type { BotWorldState, GameMessage } from '../sdk/types';

// ------------------------------------------------------------------ stacks

export interface StackFrame {
    fn: string | null;
    /** Relative to the repository root when inside it, else absolute. */
    file: string;
    line: number;
    col: number;
}

// Bun (JavaScriptCore) frames: `at fn (/abs/file.ts:1:2)`, `at async fn (/abs/file.ts:1:2)`,
// `at /abs/file.ts:1:2`. Native frames (`at fn (native:2)`) carry no path and are skipped.
const FRAME = /^\s*at (?:(?:async )?(.*?) \()?((?:file:\/\/)?\/.*?):(\d+):(\d+)\)?\s*$/;

export function parseStack(stack: string, root: string): StackFrame[] {
    const out: StackFrame[] = [];
    for (const l of stack.split('\n')) {
        const m = FRAME.exec(l);
        if (!m) continue;
        const abs = m[2]!.replace(/^file:\/\//, '');
        const rel = relative(root, abs);
        out.push({ fn: m[1] || null, file: rel.startsWith('..') || isAbsolute(rel) ? abs : rel, line: Number(m[3]), col: Number(m[4]) });
    }
    return out;
}

/** Frames that are plumbing rather than the bot's own code: the SDK, this package, dependencies. */
export function isPlumbing(f: StackFrame): boolean {
    return f.file.startsWith('sdk/') || f.file.startsWith('film/') || f.file.includes('node_modules/');
}

export interface Site {
    file: string | null;
    line: number | null;
    col: number | null;
    fn: string | null;
    /** `script`: a frame in the filmed script itself; `caller`: the first frame outside the SDK; `none`. */
    site: 'script' | 'caller' | 'none';
}

/**
 * The source line that issued an action: the innermost frame in the filmed script when one is on the
 * stack (a script that calls a library that calls the SDK), else the first frame outside the SDK.
 */
export function pickSite(frames: readonly StackFrame[], script?: string): Site {
    const own = frames.filter(f => !isPlumbing(f));
    const inScript = script ? own.find(f => f.file === script) : undefined;
    const f = inScript ?? own[0];
    if (!f) return { file: null, line: null, col: null, fn: null, site: 'none' };
    return { file: f.file, line: f.line, col: f.col, fn: f.fn, site: inScript ? 'script' : 'caller' };
}

// ------------------------------------------------------------------ the frame schedule

/**
 * For a constant-rate video of `fps` from `t0` to `t1` (ms), the captured frame each output frame
 * shows: the latest one captured at or before the output frame's start. `frameMs` is sorted. Output
 * frames before the first capture show the first one.
 */
export function schedule(frameMs: readonly number[], fps: number, t0: number, t1: number): number[] {
    if (!frameMs.length) return [];
    const period = 1000 / fps;
    const out: number[] = [];
    let p = 0;
    for (let i = 0; t0 + i * period <= t1; i++) {
        const t = t0 + i * period;
        while (p + 1 < frameMs.length && frameMs[p + 1]! <= t) p++;
        out.push(p);
    }
    return out;
}

export interface Spread {
    n: number;
    median: number;
    p95: number;
    max: number;
}

export function spread(values: readonly number[]): Spread {
    if (!values.length) return { n: 0, median: 0, p95: 0, max: 0 };
    const v = [...values].sort((a, b) => a - b);
    const at = (q: number) => v[Math.min(v.length - 1, Math.floor(q * v.length))]!;
    return { n: v.length, median: +at(0.5).toFixed(1), p95: +at(0.95).toFixed(1), max: +v[v.length - 1]!.toFixed(1) };
}

/**
 * How steady a capture is: the gaps between captured frames, and how old the shown frame is at each
 * output frame (0 when a fresh capture lands exactly on every output frame).
 */
export function frameStats(frameMs: readonly number[], fps: number, t0: number, t1: number): { captureFps: number; intervalMs: Spread; staleMs: Spread } {
    const gaps = frameMs.slice(1).map((t, i) => t - frameMs[i]!);
    const idx = schedule(frameMs, fps, t0, t1);
    const stale = idx.map((p, i) => Math.max(0, t0 + (i * 1000) / fps - frameMs[p]!));
    const span = frameMs.length > 1 ? frameMs[frameMs.length - 1]! - frameMs[0]! : 0;
    return { captureFps: span > 0 ? +(((frameMs.length - 1) * 1000) / span).toFixed(1) : 0, intervalMs: spread(gaps), staleMs: spread(stale) };
}

// ------------------------------------------------------------------ the clock

/** One server tick as the feed recorder received it. */
export interface FeedTick {
    rx: number;
    k: number;
}

/** The server tick in force at `ms`: the latest feed tick received at or before it, or null. */
export function serverTickAt(ticks: readonly FeedTick[], ms: number): number | null {
    let lo = 0;
    let hi = ticks.length - 1;
    let best = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (ticks[mid]!.rx <= ms) {
            best = mid;
            lo = mid + 1;
        } else hi = mid - 1;
    }
    return best < 0 ? null : ticks[best]!.k;
}

/** The feed ticks in a recorder's feed.jsonl text (`{"rx":ms,"frame":{...}}` lines). */
export function feedTicks(jsonl: string): FeedTick[] {
    const out: FeedTick[] = [];
    for (const line of jsonl.split('\n')) {
        if (!line.includes('"t":"tick"')) continue;
        const r = JSON.parse(line) as { rx: number; frame?: { t?: string; k?: number } };
        if (r.frame?.t === 'tick' && typeof r.frame.k === 'number') out.push({ rx: r.rx, k: r.frame.k });
    }
    return out;
}

// ------------------------------------------------------------------ what a state update says

export type Observed =
    | { kind: 'start'; ms: number; clientTick: number; x: number; z: number; plane: number; skills: Record<string, { level: number; xp: number }> }
    | { kind: 'pos'; ms: number; clientTick: number; x: number; z: number; plane: number; anim: number }
    | { kind: 'xp'; ms: number; clientTick: number; skill: string; xp: number; delta: number; level: number }
    | { kind: 'level'; ms: number; clientTick: number; skill: string; from: number; to: number }
    | { kind: 'chat'; ms: number; clientTick: number; type: number; sender: string; text: string };

const chatKey = (m: GameMessage) => JSON.stringify([m.tick, m.type, m.sender, m.text]);

/**
 * Turns a stream of published states into events: the player's tile once per new client tick, each
 * skill's xp and level changes, and each game message the first time it is published. The client
 * republishes its last 50 messages every update, so a message is new when its count in this state
 * exceeds its count in the last one.
 */
export class StateDiff {
    private tick = -1;
    private skills = new Map<string, { level: number; xp: number }>();
    private chat = new Map<string, number>();
    private started = false;

    next(s: BotWorldState, ms: number): Observed[] {
        const p = s.player;
        if (!s.inGame || !p) return [];
        const out: Observed[] = [];
        const clientTick = s.tick;
        const counts = new Map<string, number>();
        for (const m of s.gameMessages ?? []) counts.set(chatKey(m), (counts.get(chatKey(m)) ?? 0) + 1);
        if (!this.started) {
            this.started = true;
            const skills: Record<string, { level: number; xp: number }> = {};
            for (const k of s.skills ?? []) {
                skills[k.name] = { level: k.baseLevel, xp: k.experience };
                this.skills.set(k.name, skills[k.name]!);
            }
            this.chat = counts;
            this.tick = clientTick;
            return [{ kind: 'start', ms, clientTick, x: p.worldX, z: p.worldZ, plane: p.level, skills }];
        }
        if (clientTick !== this.tick) {
            this.tick = clientTick;
            out.push({ kind: 'pos', ms, clientTick, x: p.worldX, z: p.worldZ, plane: p.level, anim: p.animId });
        }
        for (const k of s.skills ?? []) {
            const was = this.skills.get(k.name);
            if (was && k.experience !== was.xp) out.push({ kind: 'xp', ms, clientTick, skill: k.name, xp: k.experience, delta: k.experience - was.xp, level: k.baseLevel });
            if (was && k.baseLevel !== was.level) out.push({ kind: 'level', ms, clientTick, skill: k.name, from: was.level, to: k.baseLevel });
            this.skills.set(k.name, { level: k.baseLevel, xp: k.experience });
        }
        const seen = new Map(this.chat);
        for (const m of s.gameMessages ?? []) {
            const key = chatKey(m);
            const left = seen.get(key) ?? 0;
            if (left > 0) {
                seen.set(key, left - 1);
                continue;
            }
            out.push({ kind: 'chat', ms, clientTick, type: m.type, sender: m.sender, text: m.text });
        }
        this.chat = counts;
        return out;
    }
}

/** Xp gained per skill between the first and last observed values (skills that gained only). */
export function xpGained(events: readonly Observed[]): Record<string, number> {
    const start = events.find(e => e.kind === 'start');
    if (!start || start.kind !== 'start') return {};
    const last = new Map(Object.entries(start.skills).map(([k, v]) => [k, v.xp]));
    for (const e of events) if (e.kind === 'xp') last.set(e.skill, e.xp);
    const out: Record<string, number> = {};
    for (const [k, v] of last) {
        const d = v - (start.skills[k]?.xp ?? v);
        if (d > 0) out[k] = d;
    }
    return out;
}

// ------------------------------------------------------------------ the merge

/** One action as the hook wrote it (film/hook.ts). */
export interface RawAction extends Site {
    ms: number;
    clientTick: number | null;
    bot: string;
    action: string;
    args: Record<string, unknown>;
    stack: StackFrame[];
}

export type TraceEntry = ({ kind: 'action' } & Omit<RawAction, 'ms'> | Observed) & { ms: number; videoMs: number; tick: number | null };

/**
 * Actions and observed events on one clock: `videoMs` is the offset into the clip (from `t0`, the
 * clip's first frame), `tick` the server tick then (from the feed). Entries outside the clip's span
 * are dropped, except the observer's `start`, which is clamped to 0 as the clip's opening state.
 */
export function mergeTrace(actions: readonly RawAction[], observed: readonly Observed[], ticks: readonly FeedTick[], t0: number, t1: number): TraceEntry[] {
    const all: TraceEntry[] = [];
    for (const a of actions) all.push({ kind: 'action', ...a, videoMs: a.ms - t0, tick: serverTickAt(ticks, a.ms) });
    let start: Observed | undefined;
    for (const e of observed) {
        if (e.kind === 'start') start = e;
        else all.push({ ...e, videoMs: e.ms - t0, tick: serverTickAt(ticks, e.ms) });
    }
    const kept = all.filter(e => e.ms >= t0 && e.ms <= t1);
    if (start) kept.push({ ...start, videoMs: Math.max(0, start.ms - t0), tick: serverTickAt(ticks, Math.max(start.ms, t0)) });
    return kept.sort((a, b) => a.videoMs - b.videoMs || a.ms - b.ms);
}
