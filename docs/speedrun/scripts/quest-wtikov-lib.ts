// Shared helpers for the Watchtower and Temple of Ikov measurement scripts.
//
// Every script logs segments: server ticks between start and end, tiles
// walked (Chebyshev steps between consecutive state updates on one plane;
// teleports are not counted), dialogue pages clicked through, option
// clicks and loc/npc/item interactions. Ticks include SDK round-trip
// latency, so they are upper bounds on what a tighter client would need.

import type { BotSDK } from '../../../sdk/index';
import type { BotActions } from '../../../sdk/actions';
import type { BotWorldState } from '../../../sdk/types';

export function now(sdk: BotSDK): number {
    return sdk.getState()?.tick ?? -1;
}

export function pos(sdk: BotSDK): { x: number; z: number; level: number } {
    const p = sdk.getState()!.player!;
    return { x: p.worldX, z: p.worldZ, level: p.level };
}

/** Staff command; needs LOCAL_STAFF_LEVEL=4 on a non-production engine. */
export async function cheat(sdk: BotSDK, cmd: string): Promise<void> {
    await sdk.sendSay('::' + cmd);
    await sdk.waitForTicks(2);
}

export async function tele(sdk: BotSDK, x: number, z: number, level = 0): Promise<void> {
    await cheat(sdk, `tele ${level},${x >> 6},${z >> 6},${x & 63},${z & 63}`);
    await sdk.waitForCondition(s => s.player?.worldX === x && s.player?.worldZ === z && s.player?.level === level, 15_000);
    await sdk.waitForTicks(2);
}

export interface Segment {
    name: string;
    t0: number;
    t1: number;
    ticks: number;
    tiles: number;
    pages: number;
    options: number;
    interactions: number;
    note?: string;
}

export class Recorder {
    segs: Segment[] = [];
    cur: Segment | null = null;
    private last: { x: number; z: number; level: number } | null = null;

    constructor(private sdk: BotSDK) {
        sdk.onStateUpdate((s: BotWorldState) => {
            const p = s.player;
            if (!p) return;
            const here = { x: p.worldX, z: p.worldZ, level: p.level };
            if (this.cur && this.last && this.last.level === here.level) {
                const d = Math.max(Math.abs(here.x - this.last.x), Math.abs(here.z - this.last.z));
                if (d <= 2) this.cur.tiles += d;
            }
            this.last = here;
        });
    }

    start(name: string): void {
        if (this.cur) this.end();
        const t = now(this.sdk);
        this.cur = { name, t0: t, t1: t, ticks: 0, tiles: 0, pages: 0, options: 0, interactions: 0 };
        console.log(`[seg] start ${name} @${t}`);
    }

    interact(n = 1): void {
        if (this.cur) this.cur.interactions += n;
    }

    end(note?: string): Segment | null {
        const c = this.cur;
        if (!c) return null;
        c.t1 = now(this.sdk);
        c.ticks = c.t1 - c.t0;
        if (note) c.note = note;
        this.segs.push(c);
        this.cur = null;
        console.log(`[seg] end ${c.name}: ${c.ticks} ticks, ${c.tiles} tiles, ${c.pages} pages, ${c.options} options, ${c.interactions} interactions${note ? ' (' + note + ')' : ''}`);
        return c;
    }

    summary(title: string): void {
        if (this.cur) this.end();
        const tot = { ticks: 0, tiles: 0, pages: 0, options: 0, interactions: 0 };
        console.log(`\n## ${title}\n`);
        console.log('| Segment | Ticks | Tiles | Pages | Options | Interactions |');
        console.log('|---|---|---|---|---|---|');
        for (const s of this.segs) {
            console.log(`| ${s.name}${s.note ? ' (' + s.note + ')' : ''} | ${s.ticks} | ${s.tiles} | ${s.pages} | ${s.options} | ${s.interactions} |`);
            tot.ticks += s.ticks; tot.tiles += s.tiles; tot.pages += s.pages; tot.options += s.options; tot.interactions += s.interactions;
        }
        console.log(`| **Total** | ${tot.ticks} | ${tot.tiles} | ${tot.pages} | ${tot.options} | ${tot.interactions} |`);
        console.log('\nJSON ' + JSON.stringify(this.segs));
    }
}

/**
 * Click through a dialogue until it has stayed closed for `idleTicks` ticks.
 * `choices` are consumed in order: each option page clicks the first queued
 * choice that matches one of its options. Waits up to `openTicks` for the
 * dialogue to appear first. Returns pages and option clicks.
 */
export async function runDialog(
    sdk: BotSDK,
    rec: Recorder | null,
    choices: (string | RegExp)[] = [],
    opts: { openTicks?: number; idleTicks?: number; maxTicks?: number; chooser?: (texts: string[], options: string[]) => RegExp | null } = {},
): Promise<{ pages: number; options: number; texts: string[] }> {
    const openTicks = opts.openTicks ?? 12;
    const idleTicks = opts.idleTicks ?? 2;
    const maxTicks = opts.maxTicks ?? 400;
    const queue = choices.map(c => (typeof c === 'string' ? new RegExp(c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : c));
    let pages = 0, options = 0, seenOpen = false, closedFor = 0, waited = 0;
    let lastClicked: string | undefined;
    const texts: string[] = [];
    const startTick = now(sdk);
    while (now(sdk) - startTick < maxTicks) {
        const s = await sdk.waitForStateUpdate();
        const d = s.dialog;
        const modal = s.modalOpen && !d.isOpen;
        if (!d.isOpen) {
            if (modal) { await sdk.sendCloseModal(); continue; }
            if (!seenOpen) { if (++waited > openTicks) break; continue; }
            if (++closedFor >= idleTicks) break;
            continue;
        }
        seenOpen = true;
        closedFor = 0;
        if (d.isWaiting || (d.pageId && d.pageId === lastClicked)) continue;
        const real = d.options.filter(o => o.text && !/click here to continue/i.test(o.text));
        if (real.length > 1) {
            let picked = -1;
            const dyn = opts.chooser?.(texts, real.map(o => o.text));
            if (dyn) { const m = real.find(o => dyn.test(o.text)); if (m) { picked = m.index; texts.push('> ' + m.text); } }
            for (let qi = 0; qi < queue.length && picked < 0 && !dyn; qi++) {
                const m = real.find(o => queue[qi].test(o.text));
                if (m) { picked = m.index; queue.splice(qi, 1); texts.push('> ' + m.text); }
            }
            if (picked < 0) {
                console.log(`[dialog] no queued choice for options: ${real.map(o => o.text).join(' | ')}; taking first`);
                picked = real[0].index;
                texts.push('> ' + real[0].text + ' (default)');
            }
            lastClicked = d.pageId;
            await sdk.sendClickDialog(picked);
            options++;
        } else {
            if (d.text) texts.push(d.text.replace(/\s+/g, ' ').slice(0, 80));
            lastClicked = d.pageId;
            await sdk.sendClickDialog(0);
            pages++;
        }
    }
    if (rec?.cur) { rec.cur.pages += pages; rec.cur.options += options; }
    return { pages, options, texts };
}

export async function walk(bot: BotActions, sdk: BotSDK, x: number, z: number, tol = 1): Promise<void> {
    const r = await bot.walkTo(x, z, tol, { timeout: 180_000 });
    if (!r.success) console.log(`[walk] to ${x},${z} failed: ${r.message}; at ${JSON.stringify(pos(sdk))}`);
}

export function msgsSince(sdk: BotSDK, tick: number): string[] {
    return (sdk.getState()?.gameMessages ?? []).filter((m: any) => (m.tick ?? 0) >= tick).map((m: any) => m.text);
}

export function invHas(sdk: BotSDK, re: RegExp): boolean {
    return sdk.getInventory().some(i => re.test(i.name));
}

let objIds: Map<string, number> | null = null;

/** Config id of an obj by its debug name, from server/content/pack/obj.pack. */
export function objId(name: string): number {
    if (!objIds) {
        objIds = new Map();
        const text = require('fs').readFileSync(new URL('../../../server/content/pack/obj.pack', import.meta.url), 'utf8') as string;
        for (const line of text.split('\n')) {
            const i = line.indexOf('=');
            if (i > 0) objIds.set(line.slice(i + 1).trim(), parseInt(line.slice(0, i)));
        }
    }
    const id = objIds.get(name);
    if (id === undefined) throw new Error(`unknown obj ${name}`);
    return id;
}

/** An inventory item by display-name pattern, or by debug name (string). */
export type ItemRef = RegExp | string;

export function inv(sdk: BotSDK, ref: ItemRef) {
    if (typeof ref === 'string') {
        const id = objId(ref);
        return sdk.getInventory().find(i => i.id === id) ?? null;
    }
    return sdk.findInventoryItem(ref);
}

export function npcByName(sdk: BotSDK, re: RegExp) {
    return sdk.getNearbyNpcs().filter(n => re.test(n.name)).sort((a: any, b: any) => (a.distance ?? 0) - (b.distance ?? 0))[0] ?? null;
}

export function baseXp(sdk: BotSDK, skill: string): number {
    return (sdk.getSkillXp(skill) ?? 0) / 25;
}

/** Read a varp with the staff `::getvar` command (lab only; not counted in segments). */
export async function getvar(sdk: BotSDK, name: string): Promise<number> {
    const t = now(sdk);
    await sdk.sendSay(`::getvar ${name}`);
    const re = new RegExp(`get ${name}: (-?\\d+)`);
    for (let i = 0; i < 20; i++) {
        await sdk.waitForStateUpdate();
        const m = (sdk.getState()?.gameMessages ?? []).filter((g: any) => g.tick >= t - 1).map((g: any) => re.exec(g.text)).find(Boolean);
        if (m) return parseInt(m[1]);
    }
    return NaN;
}

export async function logVars(sdk: BotSDK, names: string[]): Promise<void> {
    const out: string[] = [];
    for (const n of names) out.push(`${n}=${await getvar(sdk, n)}`);
    console.log('[vars] ' + out.join(' ') + ' @' + JSON.stringify(pos(sdk)));
}

/** Nearest loc to (x, z) whose name matches, from an on-demand scan. */
export async function locNear(sdk: BotSDK, x: number, z: number, re: RegExp = /./, radius = 20) {
    const locs = await sdk.scanNearbyLocs(radius);
    return locs.filter(l => re.test(l.name)).sort((a, b) => Math.max(Math.abs(a.x - x), Math.abs(a.z - z)) - Math.max(Math.abs(b.x - x), Math.abs(b.z - z)))[0] ?? null;
}

/** Nearest npc to (x, z) whose name matches. */
export function npcNear(sdk: BotSDK, re: RegExp, x?: number, z?: number) {
    const p = pos(sdk);
    const cx = x ?? p.x, cz = z ?? p.z;
    return sdk.getNearbyNpcs().filter(n => re.test(n.name)).sort((a, b) => Math.max(Math.abs(a.x - cx), Math.abs(a.z - cz)) - Math.max(Math.abs(b.x - cx), Math.abs(b.z - cz)))[0] ?? null;
}

/** Op a loc near (x, z), then click through whatever dialogue it opens. */
export async function opLoc(sdk: BotSDK, rec: Recorder | null, x: number, z: number, re: RegExp, op = 1, choices: (string | RegExp)[] = [], opts: { openTicks?: number } = {}) {
    const loc = await locNear(sdk, x, z, re);
    if (!loc) { console.log(`[loc] none matching ${re} near ${x},${z}`); return null; }
    await sdk.sendInteractLoc(loc.x, loc.z, loc.id, op);
    rec?.interact();
    return runDialog(sdk, rec, choices, { openTicks: opts.openTicks ?? 25 });
}

export async function talk(sdk: BotSDK, rec: Recorder | null, re: RegExp, choices: (string | RegExp)[] = [], x?: number, z?: number, chooser?: (texts: string[], options: string[]) => RegExp | null) {
    const npc = npcNear(sdk, re, x, z);
    if (!npc) { console.log(`[npc] none matching ${re}`); return null; }
    await sdk.sendInteractNpc(npc.index, 1);
    rec?.interact();
    return runDialog(sdk, rec, choices, { openTicks: 30, chooser });
}

export async function useOnNpc(sdk: BotSDK, rec: Recorder | null, itemRe: ItemRef, npcRe: RegExp, choices: (string | RegExp)[] = [], x?: number, z?: number) {
    const item = inv(sdk, itemRe);
    const npc = npcNear(sdk, npcRe, x, z);
    if (!item || !npc) { console.log(`[use] missing item ${itemRe}=${!!item} or npc ${npcRe}=${!!npc}`); return null; }
    await sdk.sendUseItemOnNpc(item.slot, npc.index);
    rec?.interact();
    return runDialog(sdk, rec, choices, { openTicks: 30 });
}

export async function useOnItem(sdk: BotSDK, rec: Recorder | null, aRe: ItemRef, bRe: ItemRef, choices: (string | RegExp)[] = []) {
    const a = inv(sdk, aRe), b = inv(sdk, bRe);
    if (!a || !b) { console.log(`[use] missing ${aRe}=${!!a} ${bRe}=${!!b}`); return null; }
    await sdk.sendUseItemOnItem(a.slot, b.slot);
    rec?.interact();
    return runDialog(sdk, rec, choices, { openTicks: 4 });
}

/** Wait until the player's position satisfies `pred`, or `ticks` pass. */
export async function waitPos(sdk: BotSDK, pred: (p: { x: number; z: number; level: number }) => boolean, ticks = 30): Promise<boolean> {
    const t = now(sdk);
    while (now(sdk) - t < ticks) {
        if (pred(pos(sdk))) return true;
        await sdk.waitForStateUpdate();
    }
    return pred(pos(sdk));
}

export function hp(sdk: BotSDK): number {
    return sdk.getSkill('hitpoints')?.level ?? 0;
}

export async function setupAccount(sdk: BotSDK, bot: BotActions, stats: Record<string, number>, items: [string, number][]): Promise<void> {
    await sdk.waitForReady(60_000);
    const r = await bot.skipTutorial();
    console.log('[setup] tutorial', r.message, JSON.stringify(pos(sdk)));
    for (const [s, l] of Object.entries(stats)) await cheat(sdk, `setstat ${s} ${l}`);
    for (const [i, n] of items) await cheat(sdk, `give ${i} ${n}`);
    await sdk.waitForTicks(2);
}
