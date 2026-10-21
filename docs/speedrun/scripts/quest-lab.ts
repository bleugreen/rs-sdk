// Shared helpers for the quest measurement scripts. Every timing is in server
// ticks read from the world state (state.tick), never in wall-clock time.
import { readFileSync } from 'fs';
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

/**
 * Quest-script actions over one bot, all recorded into a Segments timer.
 * NPCs, locs and objs are addressed by their content config names
 * (npc.pack / loc.pack / obj.pack), never by display name, because several
 * quest NPCs share one display name (the three Students).
 */
export class QuestBot {
    NPC = packIds('npc.pack');
    LOC = packIds('loc.pack');
    OBJ = packIds('obj.pack');
    S: Segments;
    constructor(public sdk: BotSDK, public bot: { walkTo(x: number, z: number, tolerance?: number): Promise<unknown> }) {
        this.S = new Segments(sdk);
    }

    id(map: Map<string, number>, key: string) {
        const v = map.get(key);
        if (v === undefined) throw new Error(`unknown config name ${key}`);
        return v;
    }

    inv(obj: string) {
        const id = this.id(this.OBJ, obj);
        return this.sdk.getInventory().find(i => i.id === id) ?? null;
    }

    count(obj: string) {
        const id = this.id(this.OBJ, obj);
        return this.sdk.getInventory().filter(i => i.id === id).reduce((a, i) => a + i.count, 0);
    }

    need(obj: string) {
        const i = this.inv(obj);
        if (!i) throw new Error(`no ${obj} in inventory`);
        return i;
    }

    npc(key: string) {
        const id = this.id(this.NPC, key);
        const l = this.sdk.getNearbyNpcs().filter(n => n.id === id).sort((a, b) => a.distance - b.distance);
        if (!l.length) throw new Error(`no ${key} in view at ${JSON.stringify(pos(this.sdk))}`);
        return l[0];
    }

    async loc(key: string, near?: [number, number]) {
        const id = this.id(this.LOC, key);
        const l = (await this.sdk.scanNearbyLocs(40)).filter(x => x.id === id);
        if (!l.length) throw new Error(`no ${key} in view at ${JSON.stringify(pos(this.sdk))}`);
        const d = (x: NearbyLoc) => (near ? Math.max(Math.abs(x.x - near[0]), Math.abs(x.z - near[1])) : x.distance);
        return l.sort((a, b) => d(a) - d(b))[0];
    }

    /** Run any dialogue that opens, until `until()` holds with no dialogue open. */
    async settle(until: () => boolean, timeoutTicks = 80, choices: RegExp[] = []) {
        const t0 = tick(this.sdk);
        while (tick(this.sdk) - t0 < timeoutTicks) {
            if (this.sdk.getState()!.dialog.isOpen) {
                this.S.dialog(await runDialog(this.sdk, choices.splice(0), { settleTicks: 1, openTimeoutTicks: 1 }));
                continue;
            }
            if (until()) {
                this.S.mark();
                return;
            }
            await this.sdk.waitForStateUpdate();
        }
        throw new Error(`timed out in segment ${this.S.cur?.name}`);
    }

    async talk(key: string, choices: RegExp[] = []) {
        const n = this.npc(key);
        const op = n.optionsWithIndex.find(o => /talk/i.test(o.text));
        if (!op) throw new Error(`${key} has no talk option`);
        this.S.action();
        await this.sdk.sendInteractNpc(n.index, op.opIndex);
        const r = await runDialog(this.sdk, choices, { openTimeoutTicks: 60, settleTicks: 2 });
        if (r.closedAt < 0) throw new Error(`${key}: no dialogue opened`);
        this.S.dialog(r);
        return r;
    }

    async useOnNpc(obj: string, key: string, until: () => boolean = () => true, choices: RegExp[] = []) {
        const n = this.npc(key);
        this.S.action();
        await this.sdk.sendUseItemOnNpc(this.need(obj).slot, n.index);
        await this.waitForReaction();
        await this.settle(until, 80, choices);
    }

    async opLoc(key: string, op: number, until: () => boolean, near?: [number, number]) {
        const l = await this.loc(key, near);
        this.S.action();
        await this.sdk.sendInteractLoc(l.x, l.z, l.id, op);
        await this.settle(until);
    }

    async useOnLoc(obj: string, key: string, until: () => boolean, near?: [number, number]) {
        const l = await this.loc(key, near);
        this.S.action();
        await this.sdk.sendUseItemOnLoc(this.need(obj).slot, l.x, l.z, l.id);
        await this.settle(until);
    }

    async useOnObj(src: string, dst: string, until: () => boolean) {
        this.S.action();
        await this.sdk.sendUseItemOnItem(this.need(src).slot, this.need(dst).slot);
        await this.settle(until, 20);
    }

    async pickup(obj: string) {
        const id = this.id(this.OBJ, obj);
        const before = this.count(obj);
        const g = this.sdk.getGroundItems().filter(x => x.id === id).sort((a, b) => a.distance - b.distance)[0];
        if (!g) throw new Error(`no ground ${obj} near ${JSON.stringify(pos(this.sdk))}`);
        this.S.action();
        await this.sdk.sendPickup(g.x, g.z, id);
        await this.settle(() => this.count(obj) > before);
    }

    async walk(x: number, z: number, tolerance = 1) {
        await this.bot.walkTo(x, z, tolerance);
        this.S.mark();
    }

    /** Give a use-on-NPC click time to open its dialogue before settle() checks the predicate. */
    private async waitForReaction(ticks = 40) {
        const t0 = tick(this.sdk);
        while (tick(this.sdk) - t0 < ticks && !this.sdk.getState()!.dialog.isOpen) await this.sdk.waitForStateUpdate();
    }

    /** Drop everything not in `keep` while fewer than `free` slots are empty. */
    async makeRoom(keep: string[], free = 3) {
        const keepIds = new Set(keep.map(k => this.id(this.OBJ, k)));
        for (;;) {
            const inv = this.sdk.getInventory();
            if (28 - inv.length >= free) return;
            const junk = inv.find(i => !keepIds.has(i.id));
            if (!junk) throw new Error('inventory full of kept items');
            this.S.action();
            await this.sdk.sendDropItem(junk.slot);
            await waitUntil(this.sdk, () => !this.sdk.getInventory().some(i => i.slot === junk.slot && i.id === junk.id), 10);
        }
    }
}

export async function waitUntil(sdk: BotSDK, pred: () => boolean, ticks = 60) {
    const t0 = tick(sdk);
    while (tick(sdk) - t0 < ticks) {
        if (pred()) return true;
        await sdk.waitForStateUpdate();
    }
    return false;
}
