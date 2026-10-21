// Segment recorder for the lab measurement scripts (docs/speedrun/scripts/).
// A segment is one measured stretch of a quest: its server ticks and the raw
// counts docs/speedrun/quests/CONVENTIONS.md asks for (continue pages, option
// clicks, interactions, tiles walked, the dialogue shape). Lab-only: the step
// runner logs with speedrun/lib/ticks.ts.

import type { ConverseResult } from '../lib/converse';
import { dialogueRuns } from '../lib/converse';
import type { StateSource } from '../lib/wait';
import { tileCounter, type TileCounter } from '../lib/world';

export interface Segment {
    name: string;
    kind?: string;
    startTick: number;
    endTick: number;
    ticks: number;
    pages: number;
    options: number;
    levelUps: number;
    interactions: number;
    tiles: number;
    /** Dialogue shape in CONVENTIONS.md notation, one group per dialogue: "4c, opt, 6c | 2c". */
    runs: string;
    note?: string;
    [extra: string]: unknown;
}

export class Recorder {
    readonly segments: Segment[] = [];
    cur: Segment | null = null;
    private markTick: number | null = null;
    private counter: TileCounter | null = null;

    constructor(private sdk: StateSource, readonly title: string) {}

    private now(): number {
        return this.sdk.getState()?.tick ?? -1;
    }

    /** Start a segment (ending any open one). Tiles are counted from here. */
    begin(name: string, kind?: string): Segment {
        if (this.cur) this.end();
        const t = this.now();
        this.cur = { name, ...(kind ? { kind } : {}), startTick: t, endTick: t, ticks: 0, pages: 0, options: 0, levelUps: 0, interactions: 0, tiles: 0, runs: '' };
        this.markTick = null;
        this.counter = tileCounter(this.sdk);
        return this.cur;
    }

    /**
     * End the open segment at its last mark (the tick its last effect was
     * seen), or now when nothing was marked, so settle waits are not counted.
     */
    end(note?: string): Segment | null {
        const c = this.cur;
        if (!c) return null;
        this.counter?.stop();
        c.tiles += this.counter?.tiles ?? 0;
        this.counter = null;
        c.endTick = this.markTick ?? this.now();
        c.ticks = c.endTick - c.startTick;
        if (note) c.note = c.note ? `${c.note}; ${note}` : note;
        this.cur = null;
        this.segments.push(c);
        console.log(line(c));
        return c;
    }

    /** Run `fn` as one segment; a string it returns becomes the note. */
    async seg(name: string, fn: (seg: Segment) => Promise<string | void | unknown>, kind?: string): Promise<Segment> {
        const s = this.begin(name, kind);
        const r = await fn(s);
        return this.end(typeof r === 'string' ? r : undefined)!;
    }

    /** The open segment's effect was seen at `tick` (default now); the segment ends at the latest mark. */
    mark(tick: number = this.now()): void {
        if (this.cur && tick >= 0 && (this.markTick === null || tick > this.markTick)) this.markTick = tick;
    }

    interact(n = 1): void {
        if (this.cur) this.cur.interactions += n;
    }

    note(text: string): void {
        if (this.cur) this.cur.note = this.cur.note ? `${this.cur.note}; ${text}` : text;
    }

    /** Add a conversation's counts and shape to the open segment and mark its end. */
    dialogue(r: ConverseResult): ConverseResult {
        const c = this.cur;
        if (!c) return r;
        c.pages += r.pages;
        c.options += r.options;
        c.levelUps += r.levelUps;
        const runs = dialogueRuns(r.transcript);
        if (runs) c.runs += (c.runs ? ' | ' : '') + runs;
        if (r.endTick >= 0) this.mark(r.endTick);
        return r;
    }

    /** Record a row measured elsewhere (a fight, a timed action). */
    add(row: Partial<Segment> & { name: string; ticks: number }): Segment {
        const t = this.now();
        const s: Segment = { startTick: t - row.ticks, endTick: t, pages: 0, options: 0, levelUps: 0, interactions: 0, tiles: 0, runs: '', ...row };
        this.segments.push(s);
        console.log(line(s));
        return s;
    }

    total(): { ticks: number; pages: number; options: number; levelUps: number; interactions: number; tiles: number } {
        const sum = (k: 'ticks' | 'pages' | 'options' | 'levelUps' | 'interactions' | 'tiles') => this.segments.reduce((a, s) => a + (Number.isFinite(s[k]) ? s[k] : 0), 0);
        return { ticks: sum('ticks'), pages: sum('pages'), options: sum('options'), levelUps: sum('levelUps'), interactions: sum('interactions'), tiles: sum('tiles') };
    }

    /** A markdown table of every segment and the totals, then one `RESULT <title> <json>` line. */
    report(): void {
        if (this.cur) this.end();
        console.log(`\n## ${this.title}\n`);
        console.log('| Segment | Ticks | Pages | Options | Level-ups | Interactions | Tiles | Runs | Note |');
        console.log('|---|---|---|---|---|---|---|---|---|');
        for (const s of this.segments) console.log(`| ${s.name} | ${s.ticks} | ${s.pages} | ${s.options} | ${s.levelUps} | ${s.interactions} | ${s.tiles} | ${s.runs} | ${s.note ?? ''} |`);
        const t = this.total();
        console.log(`| **Total** | ${t.ticks} | ${t.pages} | ${t.options} | ${t.levelUps} | ${t.interactions} | ${t.tiles} | | |`);
        result(this.title, { total: t, segments: this.segments });
    }
}

function line(s: Segment): string {
    const counts = `pages ${s.pages}, options ${s.options}, interactions ${s.interactions}, tiles ${s.tiles}${s.levelUps ? `, level-ups ${s.levelUps}` : ''}`;
    return `SEG ${s.name}: ${s.ticks} ticks (${counts})${s.runs ? ` runs ${s.runs}` : ''}${s.note ? ` - ${s.note}` : ''}`;
}

export interface TraceRow {
    tick: number;
    x: number;
    z: number;
    level: number;
    hp: number;
    energy: number;
    anim: number;
    spot: number;
    /** The open dialogue page's id, '' when none. */
    dialog: string;
    /** The open main modal, -1 when none. */
    modal: number;
}

/** Sample the player once per tick until stopped: position, hitpoints, run energy, animation, dialogue page, modal. */
export function trace(sdk: StateSource): { rows: TraceRow[]; stop: () => void } {
    const rows: TraceRow[] = [];
    let last = -1;
    const stop = sdk.onStateUpdate(s => {
        if (s.tick === last) return;
        last = s.tick;
        const p = s.player;
        rows.push({
            tick: s.tick, x: p?.worldX ?? -1, z: p?.worldZ ?? -1, level: p?.level ?? -1, hp: p?.hp ?? -1,
            energy: p?.runEnergy ?? -1, anim: p?.animId ?? -1, spot: p?.spotanimId ?? -1,
            dialog: s.dialog.isOpen ? (s.dialog.pageId ?? '?') : '', modal: s.modalOpen ? s.modalInterface : -1,
        });
    });
    return { rows, stop };
}

/** One machine-readable line per result: `RESULT <name> <json>`. */
export function result(name: string, data: unknown): void {
    console.log(`RESULT ${name} ${JSON.stringify(data)}`);
}

export interface Stats {
    n: number;
    min: number;
    max: number;
    mean: number;
    median: number;
    p90: number;
}

/** Sample summary (NaN fields for an empty sample). Mean to two decimals. */
export function stats(xs: readonly number[]): Stats {
    const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
    const n = s.length;
    if (!n) return { n, min: NaN, max: NaN, mean: NaN, median: NaN, p90: NaN };
    const q = (f: number) => s[Math.min(n - 1, Math.floor(f * n))]!;
    return { n, min: s[0]!, max: s[n - 1]!, mean: Math.round((s.reduce((a, b) => a + b, 0) / n) * 100) / 100, median: q(0.5), p90: q(0.9) };
}

/** Attempts until the first success for a per-attempt chance p: mean, and the median and 90th percentile counts. */
export function geometric(p: number): { mean: number; p50: number; p90: number } {
    return { mean: 1 / p, p50: Math.ceil(Math.log(0.5) / Math.log(1 - p)), p90: Math.ceil(Math.log(0.1) / Math.log(1 - p)) };
}
