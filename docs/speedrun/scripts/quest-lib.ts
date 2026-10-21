// Shared helpers for the quest-*.ts measurement scripts (docs/speedrun/LAB.md,
// docs/speedrun/quests/CONVENTIONS.md). Every segment is stamped with server
// ticks (state.tick advances once per PLAYER_INFO, i.e. once per server tick),
// so results are in ticks and independent of NODE_TICKRATE.
//
// A segment records the raw counts the conventions ask for: dialogue pages
// (continue clicks), option clicks, loc/npc interactions, tiles walked, plus
// its first and last tick. Scripts print one line per segment and a JSON dump.
import type { BotSDK } from '../../../sdk';
import type { BotActions } from '../../../sdk/actions';
import type { BotWorldState, NearbyLoc, NearbyNpc } from '../../../sdk/types';

export const XP_RATE = 25; // server/engine/src/util/WorldConfig.ts:102

export function arg(name: string, dflt: string): string {
    const i = process.argv.indexOf('--' + name);
    return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : dflt;
}

export function tick(sdk: BotSDK): number {
    return sdk.getState()?.tick ?? 0;
}

export function pos(sdk: BotSDK) {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
}

/** Resolves on the first state whose tick is greater than `after`. */
export async function nextTick(sdk: BotSDK, after: number): Promise<BotWorldState> {
    return sdk.waitForCondition(s => s.tick > after, 15_000);
}

/** Waits until pred holds or maxTicks server ticks pass. Returns whether it held. */
export async function waitTicksFor(sdk: BotSDK, pred: (s: BotWorldState) => boolean, maxTicks: number): Promise<boolean> {
    const start = tick(sdk);
    const s0 = sdk.getState();
    if (s0 && pred(s0)) return true;
    try {
        await sdk.waitForCondition(s => pred(s) || s.tick - start >= maxTicks, maxTicks * 1000 + 15_000);
    } catch {
        return false;
    }
    const s = sdk.getState();
    return !!s && pred(s);
}

export async function cheat(sdk: BotSDK, cmd: string) {
    await sdk.sendSay('::' + cmd);
    await sdk.waitForTicks(2);
}

/** ::tele to an absolute tile (LAB.md: map square = tile >> 6, local = tile & 63). */
export async function tele(sdk: BotSDK, x: number, z: number, level = 0) {
    await cheat(sdk, `tele ${level},${x >> 6},${z >> 6},${x & 63},${z & 63}`);
    const ok = await waitTicksFor(sdk, s => s.player?.worldX === x && s.player?.worldZ === z && s.player?.level === level, 20);
    if (!ok) throw new Error(`tele to ${level},${x},${z} did not land (at ${JSON.stringify(pos(sdk))})`);
    await sdk.waitForTicks(2);
}

/** Reads a varp with ::getvar (staff level 2+), parsing the 'get <name>: <n>' game message. */
export async function getvar(sdk: BotSDK, name: string): Promise<number> {
    const t0 = tick(sdk);
    await sdk.sendSay('::getvar ' + name);
    const re = new RegExp(`get ${name}: (-?\\d+)`);
    for (let i = 0; i < 30; i++) {
        const s = await nextTick(sdk, tick(sdk));
        const m = s.gameMessages.filter(g => g.tick === undefined || g.tick >= t0).map(g => re.exec(g.text)).find(Boolean);
        if (m) return Number(m[1]);
    }
    throw new Error('getvar ' + name + ' got no reply');
}

/** Empties inventory and equipment, sets stats, gives items. */
export async function setup(sdk: BotSDK, o: { stats?: Record<string, number>; give?: [string, number][]; clear?: boolean }) {
    if (o.clear !== false) {
        // drop everything held and worn by unequipping then dropping; staff has no ::clearinv
        for (let pass = 0; pass < 3; pass++) {
            const s = sdk.getState()!;
            for (const e of s.equipment) await sdk.sendUseEquipmentItem(e.slot, 1).catch(() => {});
            await sdk.waitForTicks(1);
            for (const it of sdk.getState()!.inventory) await sdk.sendDropItem(it.slot).catch(() => {});
            await sdk.waitForTicks(1);
        }
    }
    for (const [k, v] of Object.entries(o.stats ?? {})) await cheat(sdk, `setstat ${k} ${v}`);
    for (const [obj, n] of o.give ?? []) await cheat(sdk, `give ${obj} ${n}`);
    await sdk.waitForTicks(2);
}

export function invCount(sdk: BotSDK, re: RegExp): number {
    return (sdk.getState()?.inventory ?? []).filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);
}

export function invSlot(sdk: BotSDK, re: RegExp): number {
    const it = (sdk.getState()?.inventory ?? []).find(i => re.test(i.name));
    if (!it) throw new Error('no inventory item matching ' + re);
    return it.slot;
}

export async function wear(sdk: BotSDK, re: RegExp) {
    const it = (sdk.getState()?.inventory ?? []).find(i => re.test(i.name));
    if (!it) throw new Error('nothing to wear matching ' + re);
    const op = it.optionsWithIndex.find(o => /wear|wield/i.test(o.text));
    for (let attempt = 0; attempt < 3; attempt++) {
        if (sdk.getState()?.dialog?.isOpen) await sdk.sendClickDialog(0).catch(() => {});
        const slot = (sdk.getState()?.inventory ?? []).find(i => re.test(i.name))?.slot ?? it.slot;
        await sdk.sendUseItem(slot, op?.opIndex ?? 2);
        if (await waitTicksFor(sdk, s => s.equipment.some(e => re.test(e.name)), 5)) return;
    }
    throw new Error('could not wear ' + re);
}

// ---------------------------------------------------------------------------
// Segment recorder

export interface Segment {
    label: string;
    kind: 'travel' | 'dialogue' | 'interaction' | 'fight' | 'wait' | 'mixed';
    startTick: number;
    endTick: number;
    ticks: number;
    pages: number;
    options: number;
    interactions: number;
    tiles: number;
    note?: string;
}

export class Recorder {
    segments: Segment[] = [];
    constructor(private sdk: BotSDK, public title: string) {}

    async seg(label: string, kind: Segment['kind'], fn: (c: Counts) => Promise<string | void>): Promise<Segment> {
        const c = new Counts();
        const p0 = pos(this.sdk);
        const startTick = tick(this.sdk);
        const note = await fn(c);
        const endTick = c.end ?? tick(this.sdk);
        const p1 = pos(this.sdk);
        const s: Segment = {
            label, kind, startTick, endTick, ticks: endTick - startTick,
            pages: c.pages, options: c.options, interactions: c.interactions,
            tiles: c.tiles || (p0.level === p1.level && Math.max(Math.abs(p1.x - p0.x), Math.abs(p1.z - p0.z)) < 200 ? Math.max(Math.abs(p1.x - p0.x), Math.abs(p1.z - p0.z)) : 0), // a jump (dungeon, teleport) is not tiles walked
            note: note || undefined,
        };
        this.segments.push(s);
        console.log(`[seg] ${label.padEnd(44)} ${kind.padEnd(11)} ticks=${String(s.ticks).padStart(4)} pages=${s.pages} opts=${s.options} ints=${s.interactions} tiles=${s.tiles}${s.note ? ' | ' + s.note : ''}`);
        return s;
    }

    report() {
        const by: Record<string, number> = {};
        let total = 0;
        for (const s of this.segments) { by[s.kind] = (by[s.kind] ?? 0) + s.ticks; total += s.ticks; }
        console.log(`\n== ${this.title}: ${total} ticks total; by kind ${JSON.stringify(by)}`);
        const sum = (k: 'pages' | 'options' | 'interactions' | 'tiles') => this.segments.reduce((a, s) => a + s[k], 0);
        console.log(`   raw counts: pages=${sum('pages')} options=${sum('options')} interactions=${sum('interactions')} tiles=${sum('tiles')}`);
        console.log('JSON ' + JSON.stringify({ title: this.title, total, by, segments: this.segments }));
    }
}

export class Counts {
    /** Set by driveDialog: the tick the segment's real work ended (excludes idle detection). */
    end?: number;
    pages = 0;
    options = 0;
    interactions = 0;
    tiles = 0;
}

// ---------------------------------------------------------------------------
// Dialogue

/**
 * Drives whatever dialogue is open until it has been closed for `idleTicks`
 * consecutive ticks. `choices` are consumed in order whenever an option menu
 * appears. Each continue click counts one page; each menu click one option.
 * Clicks are sent on the tick the page is observed, at most one per tick.
 */
export async function driveDialog(sdk: BotSDK, c: Counts, choices: (string | RegExp)[] = [], idleTicks = 3, maxTicks = 400, until?: (s: BotWorldState) => boolean) {
    const queue = [...choices];
    let closedFor = 0;
    let lastPage = '';
    let lastClickTick = -1;
    let closedAt = -1;
    let untilAt = -1;
    const start = tick(sdk);
    let s = sdk.getState()!;
    while (s.tick - start < maxTicks) {
        s = await nextTick(sdk, s.tick);
        const d = s.dialog;
        if (process.env.QDEBUG) console.log(`  [dlg] t=${s.tick} at ${s.player?.worldX},${s.player?.worldZ} open=${d?.isOpen} wait=${d?.isWaiting} text=${(d?.text ?? '').slice(0, 70)} opts=${d?.options.map(o => o.text).join('/')}`);
        if (!d?.isOpen) {
            if (closedFor === 0) closedAt = s.tick;
            if (until && until(s)) { if (untilAt < 0) untilAt = s.tick; } else untilAt = -1;
            if (++closedFor >= idleTicks && (!until || until(s))) {
                c.end = Math.max(closedAt, untilAt, start);
                return;
            }
            continue;
        }
        closedFor = 0;
        untilAt = -1;
        if (d.isWaiting) continue;
        const page = (d.pageId ?? '') + '|' + (d.text ?? '') + '|' + d.options.map(o => o.text).join('/');
        if (page === lastPage && s.tick - lastClickTick < 3) continue; // our click has not been processed yet
        const choosable = d.options.filter(o => !/click here to continue|^continue$/i.test(o.text));
        if (choosable.length > 1) {
            const want = queue.shift();
            if (want === undefined) throw new Error('unexpected option menu: ' + choosable.map(o => o.text).join(' / '));
            const r = await sdk.clickDialogByText(want);
            if (!r.success) throw new Error(`option ${want} not clickable: ${r.message}`);
            c.options++;
        } else {
            await sdk.sendClickDialog(0).catch(() => {});
            c.pages++;
        }
        lastPage = page;
        lastClickTick = s.tick;
    }
    throw new Error(`dialogue did not finish within ${maxTicks} ticks; at ${JSON.stringify(pos(sdk))}, dialog ${JSON.stringify({ open: s.dialog?.isOpen, text: s.dialog?.text, opts: s.dialog?.options.map(o => o.text) })}, last msgs ${s.gameMessages.slice(-3).map(m => m.text).join(' | ')}`);
}

export function findNpc(sdk: BotSDK, re: RegExp | number): NearbyNpc | null {
    const npcs = sdk.getState()?.nearbyNpcs ?? [];
    const me = pos(sdk);
    const list = npcs.filter(n => (typeof re === 'number' ? n.id === re : re.test(n.name)));
    list.sort((a, b) => Math.max(Math.abs(a.x - me.x), Math.abs(a.z - me.z)) - Math.max(Math.abs(b.x - me.x), Math.abs(b.z - me.z)));
    return list[0] ?? null;
}

/** Op1 (Talk-to) an npc and drive the resulting dialogue. */
export async function talk(sdk: BotSDK, c: Counts, npc: RegExp | number, choices: (string | RegExp)[] = [], op = 1, until?: (s: BotWorldState) => boolean) {
    // The lite client drops an interaction it thinks has no route (stale collision
    // after a door animation, an npc in the way); a player would click again.
    let opened = false;
    for (let attempt = 0; attempt < 10 && !opened; attempt++) {
        const n = findNpc(sdk, npc);
        if (!n) throw new Error('npc not nearby: ' + npc);
        const r = await sdk.sendInteractNpc(n.index, op);
        if (!r.success) throw new Error('talk failed: ' + r.message);
        c.interactions++;
        opened = await waitTicksFor(sdk, s => !!s.dialog?.isOpen, attempt < 9 ? 8 : 40);
    }
    if (!opened) throw new Error('no dialogue opened for ' + npc);
    await driveDialog(sdk, c, choices, 3, 400, until);
}

/** True while the player stands inside the inclusive box on `level`. */
export function inBox(s: BotWorldState, x0: number, z0: number, x1: number, z1: number, level = 0): boolean {
    const p = s.player;
    return !!p && p.level === level && p.worldX >= x0 && p.worldX <= x1 && p.worldZ >= z0 && p.worldZ <= z1;
}

// ---------------------------------------------------------------------------
// Locs

export function findLoc(sdk: BotSDK, id: number, x: number, z: number): NearbyLoc | null {
    return sdk.getNearbyLocs().find(l => l.id === id && l.x === x && l.z === z) ?? null;
}

async function ensureLoc(sdk: BotSDK, id: number, x: number, z: number) {
    if (findLoc(sdk, id, x, z)) return;
    await sdk.scanNearbyLocs(30);
    if (!findLoc(sdk, id, x, z)) throw new Error(`loc ${id} at ${x},${z} not visible from ${JSON.stringify(pos(sdk))}`);
}

export async function opLoc(sdk: BotSDK, c: Counts, id: number, x: number, z: number, op = 1) {
    await ensureLoc(sdk, id, x, z);
    const r = await sdk.sendInteractLoc(x, z, id, op);
    if (!r.success) throw new Error(`interact ${id} at ${x},${z} failed: ${r.message}`);
    c.interactions++;
}

/** Interacts with whatever loc at (x,z) offers an option matching opRe (ladders, stairs, doors). */
export async function opLocText(sdk: BotSDK, c: Counts, x: number, z: number, opRe: RegExp) {
    const pick = () => sdk.getNearbyLocs().find(l => l.x === x && l.z === z && l.level === pos(sdk).level && l.optionsWithIndex.some(o => opRe.test(o.text)));
    let loc = pick();
    if (!loc) { await sdk.scanNearbyLocs(30); loc = pick(); }
    if (!loc) throw new Error(`no loc at ${x},${z} with option ${opRe}; there: ${sdk.getNearbyLocs().filter(l => l.x === x && l.z === z).map(l => l.name + '[' + l.options.join('/') + ']').join(', ')}`);
    const op = loc.optionsWithIndex.find(o => opRe.test(o.text))!;
    const r = await sdk.sendInteractLoc(x, z, loc.id, op.opIndex);
    if (!r.success) throw new Error(`interact ${loc.name} at ${x},${z} failed: ${r.message}`);
    c.interactions++;
}

export async function useOnLoc(sdk: BotSDK, c: Counts, item: RegExp, id: number, x: number, z: number) {
    await ensureLoc(sdk, id, x, z);
    const r = await sdk.sendUseItemOnLoc(invSlot(sdk, item), x, z, id);
    if (!r.success) throw new Error(`use ${item} on ${id} at ${x},${z} failed: ${r.message}`);
    c.interactions++;
}

/** Waits until the player stands on (x,z,level), with a tick budget. */
export async function waitAt(sdk: BotSDK, x: number, z: number, level: number, maxTicks = 60) {
    const ok = await waitTicksFor(sdk, s => s.player?.worldX === x && s.player?.worldZ === z && s.player?.level === level, maxTicks);
    if (!ok) throw new Error(`never reached ${level},${x},${z}; at ${JSON.stringify(pos(sdk))}`);
}

/** Waits until the player is within r tiles of (x,z) on level. */
export async function waitNear(sdk: BotSDK, x: number, z: number, level: number, r: number, maxTicks = 60) {
    const ok = await waitTicksFor(sdk, s => !!s.player && s.player.level === level && Math.abs(s.player.worldX - x) <= r && Math.abs(s.player.worldZ - z) <= r, maxTicks);
    if (!ok) throw new Error(`never got near ${level},${x},${z}; at ${JSON.stringify(pos(sdk))}`);
}

/** Ticks until the player has not moved for `still` ticks and no dialogue is open. */
export async function settle(sdk: BotSDK, still = 2, maxTicks = 60) {
    let s = sdk.getState()!;
    let last = `${s.player?.worldX},${s.player?.worldZ},${s.player?.level}`;
    let n = 0;
    const t0 = s.tick;
    while (s.tick - t0 < maxTicks) {
        s = await nextTick(sdk, s.tick);
        const p = `${s.player?.worldX},${s.player?.worldZ},${s.player?.level}`;
        if (p === last && !s.dialog?.isOpen && (s.player?.animId ?? -1) === -1) { if (++n >= still) return; } else { n = 0; last = p; }
    }
}

// ---------------------------------------------------------------------------
// Travel

/** Walks with the SDK pathfinder (doors handled); counts Chebyshev tiles moved per tick. */
export async function walk(bot: BotActions, sdk: BotSDK, c: Counts, x: number, z: number, tol = 0) {
    let last = pos(sdk);
    const unsub = sdk.onStateUpdate(st => {
        const p = st.player;
        if (!p) return;
        if (p.level === last.level) c.tiles += Math.max(Math.abs(p.worldX - last.x), Math.abs(p.worldZ - last.z)) <= 2 ? Math.max(Math.abs(p.worldX - last.x), Math.abs(p.worldZ - last.z)) : 0;
        last = { x: p.worldX, z: p.worldZ, level: p.level };
    });
    try {
        let r = await bot.walkTo(x, z, tol, { timeout: 600_000 });
        // walkTo occasionally reports 'Stuck' on open ground (a wandering npc, a stale route); click on
        for (let retry = 0; retry < 3 && !r.success && /stuck/i.test(r.message ?? ''); retry++) r = await bot.walkTo(x, z, tol, { timeout: 600_000 });
        if (!r.success) throw new Error(`walk to ${x},${z} failed: ${r.message}`);
    } finally {
        unsub();
    }
}

// ---------------------------------------------------------------------------
// Fights

/** ticks: call to kill. engaged: call to first hitsplat either way. */
export interface FightResult { ticks: number; engaged: number; dealt: number; taken: number; hits: number; eats: number; died: boolean }

const LEVEL_UP = /congratulations|advanced a .* level|you've just advanced/i;

/**
 * Waits until npc `re` (already attacking or attacked) is dead, attacking it if
 * we are idle, eating `food` below `eatAt` hp. Measures from call to kill.
 */
export async function fight(sdk: BotSDK, c: Counts, re: RegExp, o: { food?: RegExp; eatAt?: number; attack?: boolean; maxTicks?: number } = {}): Promise<FightResult> {
    const t0 = tick(sdk);
    let dealt = 0, taken = 0, hits = 0, eats = 0, engagedTick = -1;
    const seen = new Set<string>();
    const res = (s: BotWorldState, died: boolean): FightResult => ({ ticks: s.tick - t0, engaged: engagedTick < 0 ? -1 : engagedTick - t0, dealt, taken, hits, eats, died });
    let target: NearbyNpc | null = null;
    let lastAttack = -10;
    let s = sdk.getState()!;
    while (s.tick - t0 < (o.maxTicks ?? 600)) {
        s = await nextTick(sdk, s.tick);
        for (const e of s.combatEvents ?? []) {
            const k = `${e.tick}:${e.type}:${e.damage}:${e.sourceIndex}:${e.targetIndex}`;
            if (seen.has(k) || e.tick < t0) continue;
            seen.add(k);
            if (e.type === 'damage_dealt') { dealt += e.damage; hits++; }
            if (e.type === 'damage_taken') taken += e.damage;
            if ((e.type === 'damage_dealt' || e.type === 'damage_taken') && engagedTick < 0) engagedTick = e.tick;
        }
        if (s.player?.isDead) return res(s, true);
        const killed = (s.combatEvents ?? []).some(e => e.type === 'kill' && e.tick >= t0 && target && e.targetIndex === target.index);
        if (killed) return res(s, false);
        const npc: NearbyNpc | null = target ? (s.nearbyNpcs.find(n => n.index === target!.index && re.test(n.name)) ?? null) : findNpc(sdk, re);
        if (target && dealt > 0 && (!npc || npc.hp === 0)) return res(s, false);
        // only level-up boxes can open mid-fight; the death script's dialogue starts after hp hits 0
        if (s.dialog?.isOpen && !s.dialog.isWaiting && (LEVEL_UP.test(s.dialog.text ?? '') || dealt === 0 || (npc?.hp ?? 1) > 0)) await sdk.sendClickDialog(0).catch(() => {});
        if (npc) target = npc;
        if (o.food && s.player && s.player.hp <= (o.eatAt ?? 0)) {
            const f = s.inventory.find(i => o.food!.test(i.name));
            if (f) { await sdk.sendUseItem(f.slot, 1).catch(() => {}); eats++; }
        }
        if (npc && o.attack !== false && !(s.player?.combat.inCombat) && s.tick - lastAttack > 4) {
            await sdk.sendInteractNpc(npc.index, 2).catch(() => {});
            c.interactions++;
            lastAttack = s.tick;
        }
    }
    throw new Error('fight with ' + re + ' did not end');
}
