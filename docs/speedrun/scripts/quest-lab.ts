// Shared helpers for the quest measurement scripts. Every timing is in server
// ticks read from the world state (state.tick), never in wall-clock time.
import type { BotSDK } from '../../../sdk/index';
import type { BotWorldState, NearbyLoc, NearbyNpc } from '../../../sdk/types';

export const tick = (sdk: BotSDK) => sdk.getState()?.tick ?? -1;

/** Send a staff command (needs LOCAL_STAFF_LEVEL=4) and let it land. */
export async function cheat(sdk: BotSDK, cmd: string, ticks = 2) {
    await sdk.sendSay(`::${cmd}`);
    await sdk.waitForTicks(ticks);
}

/** Teleport with ::tele and wait until the client reports the new tile. */
export async function tele(sdk: BotSDK, x: number, z: number, level = 0) {
    await sdk.sendSay(`::tele ${level},${x >> 6},${z >> 6},${x & 63},${z & 63}`);
    await sdk.waitForCondition(s => s.player?.worldX === x && s.player?.worldZ === z && s.player?.level === level, 20_000);
    await sdk.waitForTicks(2);
}

export async function clearInv(sdk: BotSDK) {
    await cheat(sdk, '~clearinv inv');
}

export async function give(sdk: BotSDK, obj: string, n = 1) {
    await cheat(sdk, `give ${obj} ${n}`, 1);
}

export const pos = (sdk: BotSDK) => {
    const p = sdk.getState()!.player!;
    return { x: p.worldX, z: p.worldZ, level: p.level };
};

export const has = (sdk: BotSDK, pattern: RegExp) => sdk.getInventory().some(i => pattern.test(i.name));

/** Drain chat so a later waitForMessage only sees new lines. */
export function drainChat(sdk: BotSDK) {
    sdk.getNewChat({ types: [0], includeSelf: true });
}

/**
 * Wait for a game message (chat type 0) or an open dialogue's text matching
 * any pattern; returns the matching text or null on timeout. Item boxes
 * (~objbox) announce some results without a chat line, hence the dialogue check.
 */
export async function waitForMessage(sdk: BotSDK, patterns: RegExp[], timeoutTicks = 30): Promise<{ text: string } | null> {
    const start = tick(sdk);
    while (tick(sdk) - start < timeoutTicks) {
        for (const m of sdk.getNewChat({ types: [0], includeSelf: true })) {
            if (patterns.some(p => p.test(m.text))) return m;
        }
        const d = sdk.getState()?.dialog;
        if (d?.isOpen && d.text && patterns.some(p => p.test(d.text!))) return { text: d.text };
        await sdk.waitForStateUpdate();
    }
    return null;
}

export interface DialogRun {
    pages: number; // continue clicks
    options: number; // option clicks
    ticks: number; // first open to closed
    closedAt: number; // first tick the dialogue was seen closed (-1 if it never opened)
    transcript: string[];
}

/**
 * Drive a dialogue to the end. `choices` are consumed in order, one per
 * option page; a page whose options match none of the next choice throws.
 * Returns when no dialogue has been open for `settleTicks` ticks.
 */
export async function runDialog(
    sdk: BotSDK,
    choices: RegExp[] = [],
    opts: { settleTicks?: number; openTimeoutTicks?: number; maxSteps?: number; log?: boolean } = {},
): Promise<DialogRun> {
    const settle = opts.settleTicks ?? 3;
    const queue = [...choices];
    const out: DialogRun = { pages: 0, options: 0, ticks: 0, closedAt: -1, transcript: [] };
    let first = -1;
    let lastOpen = -1;
    let lastPage = '';
    const t0 = tick(sdk);
    for (let step = 0; step < (opts.maxSteps ?? 400); step++) {
        const s: BotWorldState = sdk.getState()!;
        const d = s.dialog;
        if (d?.isOpen) {
            if (first < 0) first = s.tick;
            lastOpen = s.tick;
            const page = d.pageId ?? `${d.text}|${d.options.map(o => o.text).join('/')}`;
            if (!d.isWaiting && page !== lastPage) {
                lastPage = page;
                const onlyContinue = d.options.length > 0 && d.options.every(o => /click here to continue/i.test(o.text));
                if (onlyContinue) {
                    out.pages++;
                    out.transcript.push((d.text ?? '').slice(0, 70));
                    if (opts.log) console.log(`  [${s.tick}] ${(d.text ?? '').slice(0, 70)}`);
                    await sdk.clickDialogByText(d.options[0].text);
                } else if (d.options.length > 0) {
                    const want = queue[0];
                    const opt = want ? d.options.find(o => want.test(o.text)) : undefined;
                    if (!opt) throw new Error(`no option for ${want} among: ${d.options.map(o => o.text).join(' | ')}`);
                    queue.shift();
                    out.options++;
                    out.transcript.push(`> ${opt.text}`);
                    if (opts.log) console.log(`  [${s.tick}] > ${opt.text}`);
                    await sdk.clickDialogByText(opt.text);
                } else {
                    out.pages++;
                    out.transcript.push((d.text ?? '').slice(0, 70));
                    if (opts.log) console.log(`  [${s.tick}] ${(d.text ?? '').slice(0, 70)}`);
                    await sdk.sendClickDialog(0);
                }
            }
        } else {
            if (first < 0 && s.tick - t0 > (opts.openTimeoutTicks ?? 15)) break;
            if (first >= 0 && s.tick - lastOpen >= settle) break;
        }
        await sdk.waitForStateUpdate();
    }
    out.ticks = first < 0 ? 0 : lastOpen - first + 1;
    out.closedAt = first < 0 ? -1 : lastOpen + 1;
    if (queue.length) throw new Error(`dialog ended with unused choices: ${queue.join(', ')}`);
    return out;
}

export function findNpcWithOp(sdk: BotSDK, name: RegExp, op: RegExp): { npc: NearbyNpc; opIndex: number } | null {
    const npcs = sdk.getNearbyNpcs().filter(n => name.test(n.name)).sort((a, b) => a.distance - b.distance);
    for (const npc of npcs) {
        const o = npc.optionsWithIndex.find(x => op.test(x.text));
        if (o) return { npc, opIndex: o.opIndex };
    }
    return null;
}

export async function findLoc(sdk: BotSDK, name: RegExp, filter: (l: NearbyLoc) => boolean = () => true, radius = 20) {
    const locs = (await sdk.scanNearbyLocs(radius)).filter(l => name.test(l.name) && filter(l));
    locs.sort((a, b) => a.distance - b.distance);
    return locs[0] ?? null;
}

export function invSlot(sdk: BotSDK, pattern: RegExp) {
    return sdk.getInventory().find(i => pattern.test(i.name)) ?? null;
}

/** Geometric-distribution summary for a per-attempt success chance p. */
export function geometric(p: number) {
    return { mean: 1 / p, p50: Math.ceil(Math.log(0.5) / Math.log(1 - p)), p90: Math.ceil(Math.log(0.1) / Math.log(1 - p)) };
}

export function stats(xs: number[]) {
    const s = [...xs].sort((a, b) => a - b);
    const mean = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
    const q = (f: number) => s[Math.min(s.length - 1, Math.floor(f * s.length))];
    return { n: s.length, mean: +mean.toFixed(2), min: s[0], p50: q(0.5), p90: q(0.9), max: s[s.length - 1] };
}

/** name -> id from a server/content/pack/*.pack file (npc, loc, obj). */
export function packIds(file: 'npc.pack' | 'loc.pack' | 'obj.pack'): Map<string, number> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require('fs') as typeof import('fs');
    const m = new Map<string, number>();
    const path = new URL(`../../../server/content/pack/${file}`, import.meta.url).pathname;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        const i = line.indexOf('=');
        if (i > 0) m.set(line.slice(i + 1).trim(), parseInt(line.slice(0, i)));
    }
    return m;
}

export interface Segment {
    name: string;
    ticks: number;
    pages: number;
    options: number;
    actions: number; // clicks on npcs, locs, items and ground items (not dialogue, not walking)
    note?: string;
}

/**
 * Segment timer. A segment runs from its first action to the tick its last
 * effect was seen (dialogue closed, item arrived), so the helpers' settle
 * waits are not counted.
 */
export class Segments {
    list: Segment[] = [];
    cur: Segment | null = null;
    private start = 0;
    private end = 0;
    constructor(private sdk: BotSDK) {}

    async run(name: string, fn: () => Promise<void | string>) {
        this.cur = { name, ticks: 0, pages: 0, options: 0, actions: 0 };
        this.start = tick(this.sdk);
        this.end = this.start;
        const note = await fn();
        if (note) this.cur.note = note;
        this.cur.ticks = this.end - this.start;
        this.list.push(this.cur);
        console.log(`SEG ${JSON.stringify(this.cur)}`);
        this.cur = null;
    }

    mark(at = tick(this.sdk)) {
        if (at > this.end) this.end = at;
    }

    action() {
        if (this.cur) this.cur.actions++;
    }

    dialog(r: DialogRun) {
        if (!this.cur) return;
        this.cur.pages += r.pages;
        this.cur.options += r.options;
        if (r.closedAt >= 0) this.mark(r.closedAt);
    }

    total() {
        return this.list.reduce((a, s) => ({ ticks: a.ticks + s.ticks, pages: a.pages + s.pages, options: a.options + s.options, actions: a.actions + s.actions }), { ticks: 0, pages: 0, options: 0, actions: 0 });
    }
}
