// Shared lab helpers for the Priest in Peril and Haunted Mine measurements.
//
// Every timing is in server ticks read from the bot's state (`state.tick`),
// so results do not depend on NODE_TICKRATE. Staff commands (::tele, ::setvar,
// ::give, ::setstat, ::getvar) are used only to set up a segment; they are
// sent outside the timed window.
//
// Credentials: the SDK runner reads BOT_USERNAME/PASSWORD/SERVER/GATEWAY_URL
// from the environment first, then bots/<botname>/bot.env.

import type { BotSDK } from '../../../sdk';

export type Sdk = BotSDK;

export interface Segment {
    name: string;
    ticks: number;
    pages: number;
    options: number;
    tiles: number;
    note?: string;
}

export class Ledger {
    segments: Segment[] = [];
    private cur: Segment | null = null;
    private startTick = 0;

    constructor(private sdk: Sdk) {}

    tick(): number {
        return this.sdk.getState()?.tick ?? 0;
    }

    begin(name: string): void {
        if (this.cur) this.end();
        this.cur = { name, ticks: 0, pages: 0, options: 0, tiles: 0 };
        this.startTick = this.tick();
    }

    add(counts: Partial<Pick<Segment, 'pages' | 'options' | 'tiles'>>): void {
        if (!this.cur) return;
        this.cur.pages += counts.pages ?? 0;
        this.cur.options += counts.options ?? 0;
        this.cur.tiles += counts.tiles ?? 0;
    }

    note(text: string): void {
        if (this.cur) this.cur.note = this.cur.note ? `${this.cur.note}; ${text}` : text;
    }

    end(): Segment | null {
        if (!this.cur) return null;
        this.cur.ticks = this.tick() - this.startTick;
        const s = this.cur;
        this.segments.push(s);
        console.log(`SEG ${s.name}: ${s.ticks} ticks (pages ${s.pages}, options ${s.options}, tiles ${s.tiles})${s.note ? ' - ' + s.note : ''}`);
        this.cur = null;
        return s;
    }

    report(title: string): void {
        console.log(`\n=== ${title} ===`);
        console.log('| Segment | Ticks | Pages | Options | Tiles | Note |');
        console.log('|---|---|---|---|---|---|');
        let total = 0;
        for (const s of this.segments) {
            total += s.ticks;
            console.log(`| ${s.name} | ${s.ticks} | ${s.pages} | ${s.options} | ${s.tiles} | ${s.note ?? ''} |`);
        }
        console.log(`| total | ${total} | | | | |`);
    }
}

export function pos(sdk: Sdk): { x: number; z: number; level: number } {
    const p = sdk.getState()!.player!;
    return { x: p.worldX, z: p.worldZ, level: p.level };
}

export async function ticks(sdk: Sdk, n: number): Promise<void> {
    if (n > 0) await sdk.waitForTicks(n);
}

/** Wait until predicate holds, polling each state update; returns false on timeout. */
export async function until(sdk: Sdk, pred: () => boolean, timeoutTicks = 50): Promise<boolean> {
    const start = sdk.getState()?.tick ?? 0;
    while (!pred()) {
        await sdk.waitForStateUpdate();
        if ((sdk.getState()?.tick ?? 0) - start > timeoutTicks) return false;
    }
    return true;
}

export async function cheat(sdk: Sdk, command: string): Promise<void> {
    await sdk.sendSay(`::${command}`);
    await ticks(sdk, 1);
}

/** ::tele level,mx,mz,lx,lz from absolute tile coordinates. */
export async function tele(sdk: Sdk, x: number, z: number, level = 0): Promise<void> {
    await sdk.sendSay(`::tele ${level},${x >> 6},${z >> 6},${x & 63},${z & 63}`);
    const ok = await until(sdk, () => {
        const p = pos(sdk);
        return p.x === x && p.z === z && p.level === level;
    }, 20);
    if (!ok) throw new Error(`tele to ${x},${z},${level} failed; at ${JSON.stringify(pos(sdk))}`);
    await ticks(sdk, 2);
}

/** Read a varp through ::getvar (lab only). */
export async function getvar(sdk: Sdk, name: string): Promise<number> {
    const before = sdk.getState()!.gameMessages.length;
    await sdk.sendSay(`::getvar ${name}`);
    for (let i = 0; i < 10; i++) {
        await ticks(sdk, 1);
        const msgs = sdk.getState()!.gameMessages.slice(Math.max(0, before - 5));
        for (let j = msgs.length - 1; j >= 0; j--) {
            const m = msgs[j]!.text.match(new RegExp(`${name}[^0-9-]*(-?\\d+)`, 'i'));
            if (m) return parseInt(m[1]!, 10);
        }
    }
    throw new Error(`getvar ${name}: no reply`);
}

export function chebyshevPath(sdk: Sdk, x: number, z: number): number {
    const r = sdk.findPath(x, z, 2000);
    if (!r.success) return -1;
    let { x: px, z: pz } = pos(sdk);
    let n = 0;
    for (const w of r.waypoints) {
        n += Math.max(Math.abs(w.x - px), Math.abs(w.z - pz));
        px = w.x;
        pz = w.z;
    }
    return n;
}

export function dialogOpen(sdk: Sdk): boolean {
    const s = sdk.getState()!;
    return !!s.dialog?.isOpen;
}

/**
 * Click through a dialogue. `choices` are consumed in order, one per option
 * page (string = case-insensitive substring, RegExp = match). Continue pages
 * are clicked as they appear. Returns once the dialogue has stayed closed for
 * `settle` ticks, or when `stopWhen` holds.
 */
export async function dialog(
    sdk: Sdk,
    choices: (string | RegExp)[] = [],
    opts: { settle?: number; timeout?: number; stopWhen?: () => boolean; waitOpen?: number; log?: boolean } = {}
): Promise<{ pages: number; options: number; texts: string[] }> {
    const settle = opts.settle ?? 2;
    const timeout = opts.timeout ?? 400;
    const queue = [...choices];
    let pages = 0;
    let options = 0;
    const texts: string[] = [];
    const start = sdk.getState()!.tick;
    let closedSince = -1;
    let lastPage = '';
    if (opts.waitOpen) await until(sdk, () => dialogOpen(sdk), opts.waitOpen);
    while (sdk.getState()!.tick - start < timeout) {
        if (opts.stopWhen?.()) break;
        const s = sdk.getState()!;
        const d = s.dialog;
        if (!d?.isOpen) {
            if (closedSince < 0) closedSince = s.tick;
            if (s.tick - closedSince >= settle) break;
            await sdk.waitForStateUpdate();
            continue;
        }
        closedSince = -1;
        const pageKey = `${d.pageId ?? ''}|${d.text ?? ''}|${d.options.map(o => o.text).join('/')}`;
        if (pageKey === lastPage || d.isWaiting) {
            await sdk.waitForStateUpdate();
            continue;
        }
        const selectable = d.options.filter(o => !/click here to continue/i.test(o.text));
        if (selectable.length > 1) {
            const want = queue.shift();
            if (want === undefined) throw new Error(`dialog: unexpected options ${selectable.map(o => o.text).join(' / ')}`);
            const re = typeof want === 'string' ? new RegExp(want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : want;
            const opt = selectable.find(o => re.test(o.text));
            if (!opt) throw new Error(`dialog: no option ${re} in ${selectable.map(o => o.text).join(' / ')}`);
            if (opts.log) console.log(`  [opt] ${opt.text}`);
            texts.push(`> ${opt.text}`);
            options++;
            lastPage = pageKey;
            await sdk.clickDialogByText(re);
        } else {
            if (opts.log) console.log(`  [page] ${(d.text ?? '').slice(0, 90)}`);
            texts.push(d.text ?? '');
            pages++;
            lastPage = pageKey;
            await sdk.sendClickDialog(0);
        }
        await sdk.waitForStateUpdate();
    }
    return { pages, options, texts };
}

export async function findLoc(sdk: Sdk, name: string | RegExp, near?: { x: number; z: number }, radius = 30) {
    const locs = await sdk.scanNearbyLocs(radius);
    const re = typeof name === 'string' ? new RegExp(`^${name}$`, 'i') : name;
    const cands = locs.filter(l => re.test(l.name) || re.test(String(l.id)));
    if (near) cands.sort((a, b) => Math.max(Math.abs(a.x - near.x), Math.abs(a.z - near.z)) - Math.max(Math.abs(b.x - near.x), Math.abs(b.z - near.z)));
    else cands.sort((a, b) => a.distance - b.distance);
    return cands[0] ?? null;
}

export function lastMessages(sdk: Sdk, n = 5): string[] {
    return sdk.getState()!.gameMessages.slice(-n).map(m => m.text);
}

export function messageSince(sdk: Sdk, sinceTick: number, re: RegExp): boolean {
    return sdk.getState()!.gameMessages.some(m => m.tick >= sinceTick && re.test(m.text));
}

/** Shared credentials for a run: env vars first, then bots/<name>/bot.env through runScript. */
export function labEnv(): void {
    const name = process.argv[2];
    if (!name) throw new Error('usage: bun <script> <botname>');
    process.env.BOT_USERNAME ??= name;
}
