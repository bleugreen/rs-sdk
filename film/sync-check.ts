// Does a clip's trace line up with its video? For trace entries whose effect is visible, find the
// first video frame where that part of the client changes, and report the offset from the entry's
// videoMs. Three measures:
//
//   chat       a game message (trace kind chat) against the chatbox redrawing: the clock sync, since
//              the client draws the message and publishes it in the same tick
//   action     a held-log light (useItemOnItem) against the log leaving the inventory: when an action
//              lands, a server round trip after it is sent
//   feed       the player's tile in the world feed against the same tile in the client's state: how
//              feed.jsonl lines up with trace.jsonl and the video
//
//   bun film/sync-check.ts <clip dir> [--n=12]
//
// Writes <clip dir>/sync.json, sync-sheet.jpg (for the first --n chat events: the frame before
// videoMs and the first changed frame, side by side) and sync-regions.jpg (the regions measured,
// outlined). Regions are in the 765 x 503 client's pixels.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spread } from './trace';

export interface Region {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** The 2004 client's fixed layout (Client.ts areas): the chatbox's text and the inventory's slots. */
export const REGIONS = {
    chat: { x: 22, y: 360, w: 470, h: 80 },
    inventory: { x: 560, y: 210, w: 176, h: 250 }
} as const satisfies Record<string, Region>;

/** A pixel has changed when its grey level moves by more than this: above the encoder's ripple. */
export const CHANGED_LEVELS = 24;

/**
 * How many pixels changed between consecutive frames of a w x h gray stream (diff[0] = 0). A count,
 * not a mean: one inventory icon leaving moves a region's mean by less than the encoder's noise.
 */
export function frameDiffs(gray: Uint8Array, w: number, h: number): number[] {
    const size = w * h;
    const n = Math.floor(gray.length / size);
    const out = [0];
    for (let i = 1; i < n; i++) {
        let count = 0;
        const a = (i - 1) * size;
        const b = i * size;
        for (let j = 0; j < size; j++) if (Math.abs(gray[b + j]! - gray[a + j]!) > CHANGED_LEVELS) count++;
        out.push(count);
    }
    return out;
}

/**
 * The first frame in [from, to] (ms) whose change exceeds `threshold`, as its time; null if none.
 * A change first seen in frame i happened in the frame interval before it, so i's own start is used.
 */
export function firstChange(diffs: readonly number[], fps: number, from: number, to: number, threshold: number): number | null {
    const period = 1000 / fps;
    for (let i = Math.max(1, Math.ceil(from / period)); i < diffs.length && i * period <= to; i++) {
        if (diffs[i]! > threshold) return i * period;
    }
    return null;
}

/** A change threshold well above a region's resting noise: 4x its median count, at least 40 pixels. */
export function threshold(diffs: readonly number[]): number {
    const v = [...diffs].sort((a, b) => a - b);
    return Math.max(40, 4 * (v[Math.floor(v.length / 2)] ?? 0));
}

async function grayRegion(video: string, r: Region): Promise<Uint8Array> {
    const ff = Bun.spawn(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', video, '-vf', `crop=${r.w}:${r.h}:${r.x}:${r.y},format=gray`, '-f', 'rawvideo', '-'], { stdout: 'pipe', stderr: 'pipe' });
    const [buf, err, code] = await Promise.all([new Response(ff.stdout).arrayBuffer(), new Response(ff.stderr).text(), ff.exited]);
    if (code !== 0) throw new Error(`ffmpeg decode: ${err.trim()}`);
    return new Uint8Array(buf);
}

interface Entry {
    kind: string;
    ms: number;
    videoMs: number;
    tick: number | null;
    action?: string;
    type?: number;
    text?: string;
    x?: number;
    z?: number;
}

function summary(offsets: number[], tickMs: number) {
    const s = spread(offsets);
    const v = [...offsets].sort((a, b) => a - b);
    return { ...s, min: v[0] ?? null, p10: v[Math.floor(v.length * 0.1)] ?? null, medianTicks: +(s.median / tickMs).toFixed(2), maxAbsTicks: +(Math.max(0, ...offsets.map(Math.abs)) / tickMs).toFixed(2) };
}

if (import.meta.main) {
    const dir = process.argv[2];
    if (!dir) throw new Error('usage: bun film/sync-check.ts <clip dir> [--n=12]');
    const n = Number(process.argv.find(a => a.startsWith('--n='))?.slice(4) ?? 12);
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as {
        video: { file: string; fps: number; width: number; height: number };
        tickMs: { feedHello: number; observed: { median: number } };
        feed: { followedSlot: number | null };
    };
    const fps = meta.video.fps;
    const tickMs = meta.tickMs.observed.median || meta.tickMs.feedHello;
    const video = join(dir, meta.video.file);
    const trace = readFileSync(join(dir, 'trace.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l) as Entry);
    const durationMs = (trace.at(-1)?.videoMs ?? 0) + 2000;

    const measure = async (region: Region, events: Entry[], from: number, to: number) => {
        const diffs = frameDiffs(await grayRegion(video, region), region.w, region.h);
        const thr = threshold(diffs);
        const hits = events.map(e => ({ e, at: firstChange(diffs, fps, e.videoMs + from, e.videoMs + to, thr) }));
        const found = hits.filter(h => h.at !== null);
        return { thr: +thr.toFixed(2), events: events.length, found: found.length, hits: found.map(h => ({ videoMs: h.e.videoMs, changeMs: h.at!, offsetMs: +(h.at! - h.e.videoMs).toFixed(1), what: h.e.text ?? h.e.action })), offsets: found.map(h => h.at! - h.e.videoMs) };
    };

    // A message is drawn and published in the same client tick, so it may show before or after the
    // observer heard it; look a little either side. An action's effect cannot come before it.
    const chats = trace.filter(e => e.kind === 'chat' && e.type === 0 && e.videoMs > 0 && e.videoMs < durationMs - 2000);
    const lights = trace.filter(e => e.kind === 'action' && e.action === 'useItemOnItem');
    const chat = await measure(REGIONS.chat, chats, -800, 1200);
    const action = await measure(REGIONS.inventory, lights, -100, 2000);

    // The feed against the client's state: each tile the player reaches, in both.
    const slot = meta.feed.followedSlot;
    const feedTiles: { recv: number; x: number; z: number; k: number }[] = [];
    if (slot !== null) {
        for (const line of readFileSync(join(dir, 'feed.jsonl'), 'utf8').split('\n')) {
            if (!line.includes('"t":"tick"')) continue;
            const r = JSON.parse(line) as { recv: number; frame: { k: number; p?: { i: number; x?: number; z?: number }[] } };
            const me = r.frame.p?.find(p => p.i === slot && p.x !== undefined);
            if (me) feedTiles.push({ recv: r.recv, x: me.x!, z: me.z!, k: r.frame.k });
        }
    }
    const feedOffsets: number[] = [];
    let prev = '';
    for (const e of trace.filter(t => t.kind === 'pos')) {
        const key = `${e.x},${e.z}`;
        if (key === prev) continue;
        prev = key;
        const f = feedTiles.filter(t => t.x === e.x && t.z === e.z).sort((a, b) => Math.abs(a.recv - e.ms) - Math.abs(b.recv - e.ms))[0];
        if (f && Math.abs(f.recv - e.ms) < 2000) feedOffsets.push(e.ms - f.recv);
    }

    // The contact sheet: for the first n chat hits, the frame before videoMs and the changed frame.
    const pick = chat.hits.slice(0, n);
    const frameAt = (ms: number) => Math.max(0, Math.round((ms * fps) / 1000));
    const nums = pick.flatMap(h => [Math.max(0, frameAt(h.videoMs) - 1), frameAt(h.changeMs)]);
    if (nums.length) {
        const select = [...new Set(nums)].map(i => `eq(n\\,${i})`).join('+');
        const rows = Math.ceil(nums.length / 4);
        const ff = Bun.spawnSync(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-vf', `select=${select},scale=iw/2:-2,tile=4x${rows}:padding=4`, '-frames:v', '1', '-q:v', '3', join(dir, 'sync-sheet.jpg')]);
        if (ff.exitCode !== 0) console.error(`[sync] contact sheet: ${ff.stderr?.toString().trim() ?? ''}`);
    }

    const report = {
        tickMs,
        fps,
        frameMs: +(1000 / fps).toFixed(1),
        method: `per frame of the decoded clip, the pixels of a gray crop that moved more than ${CHANGED_LEVELS} grey levels since the previous frame; the first frame inside the search window with more than 4x the region's median count (at least 40) is the change`,
        chat: { region: REGIONS.chat, window: [-800, 1200], threshold: chat.thr, events: chat.events, found: chat.found, offsetMs: summary(chat.offsets, tickMs), sample: chat.hits.slice(0, n) },
        action: { region: REGIONS.inventory, window: [-100, 2000], threshold: action.thr, events: action.events, found: action.found, offsetMs: summary(action.offsets, tickMs), sample: action.hits.slice(0, n) },
        feed: { followedSlot: slot, matched: feedOffsets.length, clientMinusFeedMs: summary(feedOffsets, tickMs) }
    };
    // The regions measured, outlined on a frame mid-clip.
    const box = (r: Region, c: string) => `drawbox=x=${r.x}:y=${r.y}:w=${r.w}:h=${r.h}:color=${c}:t=2`;
    Bun.spawnSync(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-ss', String(Math.max(0, durationMs / 2000)), '-i', video, '-vf', `${box(REGIONS.chat, 'red')},${box(REGIONS.inventory, 'yellow')}`, '-frames:v', '1', '-q:v', '3', join(dir, 'sync-regions.jpg')]);
    writeFileSync(join(dir, 'sync.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`RESULT sync ${JSON.stringify({ chat: { found: `${chat.found}/${chat.events}`, ...report.chat.offsetMs }, action: { found: `${action.found}/${action.events}`, ...report.action.offsetMs }, feed: report.feed })}`);
}
