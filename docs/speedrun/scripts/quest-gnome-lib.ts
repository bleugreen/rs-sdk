// Shared helpers for the gnome-chain quest measurements (Tree Gnome Village,
// The Grand Tree, Monkey Madness): docs/speedrun/quests/{tree_gnome_village,
// grand_tree,monkey_madness}.md. Not a script itself.
//
// Clock: `state.tick` counts PLAYER_INFO packets, which the server sends once
// per tick, so differences between two observed ticks are server ticks. The
// clock helpers follow docs/speedrun/scripts/quest-primitives-lib.ts (timing
// primitives child) so numbers from both are comparable.
//
// Method: each quest script jumps the quest varp to a stage with ::setvar,
// teleports next to the segment's first NPC or loc, and then plays the segment
// the way the scored account would (dialogue answered as fast as the client
// allows, interactions sent directly). Long walks between segments are not
// replayed: `pathTiles` measures them on the SDK's collision map, and the
// documents convert tiles to ticks at the run rate.

import type { BotSDK } from '../../../sdk/index';
import type { BotActions } from '../../../sdk/actions';
import type { BotWorldState, NearbyNpc } from '../../../sdk/types';
import { findLongPath } from '../../../sdk/pathfinding';

export type Pred = (s: BotWorldState) => boolean;

export function now(sdk: BotSDK): number {
    return sdk.getState()?.tick ?? -1;
}

/** Resolve with the first published state (and its tick) for which `pred` holds, or null after `maxTicks`. */
export function waitUntil(sdk: BotSDK, pred: Pred, maxTicks = 100): Promise<{ tick: number; state: BotWorldState } | null> {
    return new Promise(resolve => {
        const cur = sdk.getState();
        if (cur && pred(cur)) return resolve({ tick: cur.tick, state: cur });
        const start = cur?.tick ?? 0;
        let done = false;
        const finish = (v: { tick: number; state: BotWorldState } | null) => {
            if (done) return;
            done = true;
            unsub();
            clearTimeout(wall);
            resolve(v);
        };
        const unsub = sdk.onStateUpdate(s => {
            if (pred(s)) finish({ tick: s.tick, state: s });
            else if (s.tick - start > maxTicks) finish(null);
        });
        // Wall-clock backstop, generous enough for a 600 ms tick.
        const wall = setTimeout(() => finish(null), (maxTicks + 20) * 700);
    });
}

export async function waitTicks(sdk: BotSDK, n: number): Promise<void> {
    const t = now(sdk);
    await waitUntil(sdk, s => s.tick >= t + n, n + 5);
}

/** Staff command; debugprocs take the '~' prefix (::~energy, ::~clearinv). */
export async function cheat(sdk: BotSDK, cmd: string): Promise<void> {
    await sdk.sendSay('::' + cmd);
    await waitTicks(sdk, 1);
}

/** Read a varp or varbit through ::getvar (staff level 4, LOCAL_STAFF_LEVEL). */
export async function getvar(sdk: BotSDK, name: string): Promise<number | null> {
    const re = new RegExp(`^get ${name}: (-?\\d+)`);
    const wait = sdk.waitForChat({ matching: re, types: [0], includeSelf: true, timeout: 8000 });
    await sdk.sendSay('::getvar ' + name);
    const m = await wait;
    const v = m ? re.exec(m.text) : null;
    return v ? Number(v[1]) : null;
}

export async function setvar(sdk: BotSDK, name: string, value: number): Promise<void> {
    await cheat(sdk, `setvar ${name} ${value}`);
}

export function pos(s: BotWorldState | null | undefined): { x: number; z: number; level: number } {
    const p = s?.player;
    return { x: p?.worldX ?? -1, z: p?.worldZ ?? -1, level: p?.level ?? -1 };
}

export function at(x: number, z: number, level = 0, tol = 0): Pred {
    return s => {
        const p = pos(s);
        return p.level === level && Math.abs(p.x - x) <= tol && Math.abs(p.z - z) <= tol;
    };
}

/** Staff teleport to an absolute tile (::tele level,mx,mz,lx,lz) and wait for it plus region load. */
export async function tele(sdk: BotSDK, x: number, z: number, level = 0): Promise<boolean> {
    if (at(x, z, level)(sdk.getState()!)) return true;
    await sdk.sendSay(`::tele ${level},${x >> 6},${z >> 6},${x & 63},${z & 63}`);
    const r = await waitUntil(sdk, at(x, z, level), 20);
    if (r) await waitTicks(sdk, 3);
    return r !== null;
}

export async function give(sdk: BotSDK, obj: string, n = 1): Promise<void> {
    await cheat(sdk, `give ${obj} ${n}`);
}

export async function setstats(sdk: BotSDK, stats: Record<string, number>): Promise<void> {
    for (const [k, v] of Object.entries(stats)) await cheat(sdk, `setstat ${k} ${v}`);
}

export function invCount(s: BotWorldState | null | undefined, re: RegExp): number {
    return (s?.inventory ?? []).filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);
}

export function dialogText(s: BotWorldState | null | undefined): string {
    const d = s?.dialog;
    if (!d?.isOpen) return '';
    // The page words arrive in allComponents; `text` is usually empty.
    const words = (d.allComponents ?? []).map(c => c.text).filter(Boolean).join(' ') || (d.text ?? '');
    return words + (d.options.length ? ' | ' + d.options.map(o => `${o.index}:${o.text}`).join(' / ') : '');
}

export function stats(xs: number[]): { n: number; min: number; max: number; mean: number } {
    const n = xs.length;
    if (n === 0) return { n, min: NaN, max: NaN, mean: NaN };
    return { n, min: Math.min(...xs), max: Math.max(...xs), mean: Math.round((xs.reduce((a, b) => a + b, 0) / n) * 100) / 100 };
}

export function result(name: string, data: unknown): void {
    console.log(`RESULT ${name} ${JSON.stringify(data)}`);
}

// ─── Path lengths ────────────────────────────────────────────────────────────

/**
 * Tiles walked on the shortest route the SDK pathfinder finds between two
 * tiles on one level (doors treated as open). Run speed is 2 tiles per tick,
 * so ticks = ceil(tiles / 2) with run on and energy to spare.
 */
export function pathTiles(level: number, x1: number, z1: number, x2: number, z2: number): { tiles: number; reached: boolean } {
    const wps = findLongPath(level, x1, z1, x2, z2, 4000);
    let t = 0, px = x1, pz = z1;
    for (const w of wps) {
        t += Math.max(Math.abs(w.x - px), Math.abs(w.z - pz));
        px = w.x;
        pz = w.z;
    }
    const reached = wps.length === 0 ? (x1 === x2 && z1 === z2) : (Math.max(Math.abs(px - x2), Math.abs(pz - z2)) <= 1);
    return { tiles: t, reached };
}

// ─── Dialogue ────────────────────────────────────────────────────────────────

export interface DialogueRun {
    pages: number;      // continue clicks (chat, mesbox, objbox pages)
    choices: number;    // option clicks
    firstTick: number;  // tick the first page was seen
    endTick: number;    // tick the dialogue was seen closed for good
    log: string[];
}

/**
 * Answer whatever dialogue is (or becomes) open, clicking the instant a fresh
 * page is published. `answers` are tried in order against the option texts of
 * each choice page; the first matching one is clicked and consumed. The run
 * ends when no dialogue has been open for `idle` ticks (raise it for scripts
 * that close the chat box during a p_delay and reopen it).
 */
export function dialogue(sdk: BotSDK, answers: RegExp[] = [], opts: { idle?: number; maxTicks?: number; startTimeout?: number; closeModals?: boolean } = {}): Promise<DialogueRun> {
    const idle = opts.idle ?? 3;
    const maxTicks = opts.maxTicks ?? 600;
    const startTimeout = opts.startTimeout ?? 60;
    const queue = [...answers];
    const run: DialogueRun = { pages: 0, choices: 0, firstTick: -1, endTick: -1, log: [] };
    return new Promise(resolve => {
        let lastPage = '';
        let lastOpen = -1;
        let lastModal = -1;
        let lastClick = -1;
        let lastKey = '';
        const t0 = now(sdk);
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            unsub();
            clearTimeout(wall);
            resolve(run);
        };
        const onState = (s: BotWorldState) => {
            const d = s.dialog;
            // Full-screen chapter cards and similar main modals: close them like a player would.
            if (opts.closeModals !== false && s.modalOpen && !d.isOpen && s.modalInterface !== lastModal) {
                lastModal = s.modalInterface;
                run.log.push(`${s.tick - t0}\tmodal ${s.modalInterface} closed`);
                void sdk.sendCloseModal();
            }
            if (!s.modalOpen) lastModal = -1;
            if (d.isOpen) {
                lastOpen = s.tick;
                if (run.firstTick < 0) run.firstTick = s.tick;
                if (d.isWaiting || !d.pageId) return;
                // The client republishes pages under fresh pageIds, the server applies a click
                // to whatever page it is waiting on, and a second click reaching the server in
                // the same tick is dropped. So: new content is answered at once; a page that
                // looks exactly like the one just answered (the ballista asks three identical
                // coordinate questions) is answered when it is republished 2+ ticks after the
                // last click, or after 4 ticks if nothing changes (stall recovery).
                const key = dialogText(s);
                const fresh = key !== lastKey;
                const republished = d.pageId !== lastPage && s.tick - lastClick >= 2;
                const stalled = s.tick - lastClick >= 4;
                if (!fresh && !republished && !stalled) return;
                if (fresh && d.pageId === lastPage) return;
                lastPage = d.pageId;
                lastKey = key;
                lastClick = s.tick;
                const text = key.replace(/\s+/g, ' ').slice(0, 90);
                if (d.options.length > 1) {
                    let pick = -1;
                    for (let i = 0; i < queue.length && pick < 0; i++) {
                        const o = d.options.find(o => queue[i].test(o.text));
                        if (o) {
                            pick = o.index;
                            queue.splice(i, 1);
                        }
                    }
                    if (pick < 0) {
                        run.log.push(`${s.tick - t0}\tNO ANSWER for: ${text}`);
                        finish();
                        return;
                    }
                    run.choices++;
                    run.log.push(`${s.tick - t0}\tchoice ${pick}\t${text}`);
                    void sdk.sendClickDialog(pick);
                } else {
                    run.pages++;
                    run.log.push(`${s.tick - t0}\tpage\t${text}`);
                    void sdk.sendClickDialog(0);
                }
                return;
            }
            if (lastOpen >= 0 && run.endTick < 0) run.endTick = s.tick;
            if (lastOpen >= 0 && s.tick - lastOpen >= idle && !s.modalOpen) {
                // endTick stays the first closed tick after the last open one.
                finish();
                return;
            }
            if (lastOpen >= 0 && run.endTick >= 0 && s.tick === lastOpen) run.endTick = -1;
            if (lastOpen < 0 && s.tick - t0 > startTimeout) finish();
            if (s.tick - t0 > maxTicks) finish();
        };
        // A reopened dialogue resets the end marker.
        const unsub = sdk.onStateUpdate(s => {
            if (s.dialog.isOpen) run.endTick = -1;
            onState(s);
        });
        const wall = setTimeout(finish, (maxTicks + 40) * 700);
    });
}

export function findNpc(sdk: BotSDK, re: RegExp): NearbyNpc | null {
    const s = sdk.getState();
    const ns = (s?.nearbyNpcs ?? []).filter(n => re.test(n.name)).sort((a, b) => a.distance - b.distance);
    return ns[0] ?? null;
}

export interface StepRecord {
    name: string;
    ticks: number;          // click (or start) to end
    approach?: number;      // click to first dialogue page (walk-up time)
    pages?: number;
    choices?: number;
    note?: string;
}

/** Talk to the nearest NPC matching `re` and run the dialogue. */
export async function talk(sdk: BotSDK, re: RegExp, answers: RegExp[] = [], opts: { idle?: number; maxTicks?: number; op?: RegExp; done?: Pred } = {}): Promise<StepRecord & { run: DialogueRun }> {
    let npc = findNpc(sdk, re);
    if (!npc) {
        await waitTicks(sdk, 2);
        npc = findNpc(sdk, re);
    }
    if (!npc) throw new Error(`npc ${re} not found near ${JSON.stringify(pos(sdk.getState()))}`);
    const opRe = opts.op ?? /talk/i;
    const op = npc.optionsWithIndex.find(o => opRe.test(o.text)) ?? { opIndex: 1, text: '?' };
    const t0 = now(sdk);
    const d = dialogue(sdk, answers, opts);
    await sdk.sendInteractNpc(npc.index, op.opIndex);
    const run = await d;
    let end = run.endTick >= 0 ? run.endTick : now(sdk);
    if (opts.done) {
        // A scripted walk or teleport can follow the last page; count until it lands.
        const r = await waitUntil(sdk, opts.done, 40);
        end = r ? Math.max(end, r.tick) : NaN;
    }
    return { name: `talk ${npc.name}`, ticks: end - t0, approach: run.firstTick >= 0 ? run.firstTick - t0 : undefined, pages: run.pages, choices: run.choices, run };
}

/** Interact with the nearest loc matching `re` (scan radius 20) and wait for `done`. */
export async function locOp(sdk: BotSDK, re: RegExp, opRe: RegExp, done: Pred, maxTicks = 60): Promise<StepRecord> {
    const locs = (await sdk.scanNearbyLocs(20)).filter(l => re.test(l.name) && l.optionsWithIndex.some(o => opRe.test(o.text))).sort((a, b) => a.distance - b.distance);
    const loc = locs[0];
    if (!loc) throw new Error(`loc ${re}/${opRe} not found near ${JSON.stringify(pos(sdk.getState()))}`);
    const op = loc.optionsWithIndex.find(o => opRe.test(o.text))!;
    const t0 = now(sdk);
    await sdk.sendInteractLoc(loc.x, loc.z, loc.id, op.opIndex);
    const r = await waitUntil(sdk, done, maxTicks);
    return { name: `${op.text} ${loc.name}`, ticks: (r?.tick ?? NaN) - t0, note: r ? undefined : 'TIMEOUT' };
}

type LocLike = { x: number; z: number; id: number; name: string; optionsWithIndex: { text: string; opIndex: number }[] };

async function locAt(sdk: BotSDK, x: number, z: number, opRe: RegExp): Promise<LocLike> {
    const all = await sdk.scanNearbyLocs(25);
    const loc = all.find(l => l.x === x && l.z === z && l.optionsWithIndex.some(o => opRe.test(o.text)));
    if (!loc) throw new Error(`no loc with ${opRe} at (${x},${z}); near: ${all.filter(l => Math.abs(l.x - x) + Math.abs(l.z - z) <= 2).map(l => `${l.name}@${l.x},${l.z}[${l.optionsWithIndex.map(o => o.text).join('/')}]`).join(' ')}`);
    return loc as LocLike;
}

/** Interact with the loc at (x, z) and wait for `done`; re-sends the click every 6 ticks (clicks during p_delay are dropped). */
export async function locOpAt(sdk: BotSDK, x: number, z: number, opRe: RegExp, done: Pred, maxTicks = 60): Promise<StepRecord> {
    const loc = await locAt(sdk, x, z, opRe);
    const op = loc.optionsWithIndex.find(o => opRe.test(o.text))!;
    const t0 = now(sdk);
    await sdk.sendInteractLoc(loc.x, loc.z, loc.id, op.opIndex);
    let sent = t0;
    let moved = false;
    const p0 = pos(sdk.getState());
    const r = await waitUntil(sdk, s => {
        if (done(s)) return true;
        const p = pos(s);
        if (p.x !== p0.x || p.z !== p0.z) moved = true;
        // Only re-send while the player is idle where it started: a walking player has the click.
        if (!moved && !s.dialog.isOpen && s.tick - sent >= 6) {
            sent = s.tick;
            void sdk.sendInteractLoc(loc.x, loc.z, loc.id, op.opIndex);
        }
        return false;
    }, maxTicks);
    return { name: `${op.text} ${loc.name} (${x},${z})`, ticks: (r?.tick ?? NaN) - t0, note: r ? undefined : 'TIMEOUT' };
}

/** Interact with the loc at (x, z), answer the dialogue it opens, and wait for `done` (if given). */
export async function locTalkAt(sdk: BotSDK, x: number, z: number, opRe: RegExp, answers: RegExp[], opts: { idle?: number; maxTicks?: number; done?: Pred } = {}): Promise<StepRecord & { run: DialogueRun }> {
    const loc = await locAt(sdk, x, z, opRe);
    const op = loc.optionsWithIndex.find(o => opRe.test(o.text))!;
    const t0 = now(sdk);
    const d = dialogue(sdk, answers, opts);
    await sdk.sendInteractLoc(loc.x, loc.z, loc.id, op.opIndex);
    const run = await d;
    let end = run.endTick >= 0 ? run.endTick : now(sdk);
    if (opts.done) {
        const r = await waitUntil(sdk, opts.done, 30);
        end = Math.max(end, r?.tick ?? NaN);
    }
    return { name: `${op.text} ${loc.name} (${x},${z})`, ticks: end - t0, approach: run.firstTick >= 0 ? run.firstTick - t0 : undefined, pages: run.pages, choices: run.choices, run };
}

/** Use the first inventory item matching `item` (name regex or obj id) on the loc at (x, z). */
export async function useOnLocAt(sdk: BotSDK, item: RegExp | number, x: number, z: number, done: Pred, opts: { maxTicks?: number; answers?: RegExp[] } = {}): Promise<StepRecord> {
    const inv = sdk.getState()!.inventory;
    const it = inv.find(i => (typeof item === 'number' ? i.id === item : item.test(i.name)));
    if (!it) throw new Error(`no inventory item ${item}`);
    const all = await sdk.scanNearbyLocs(25);
    const loc = all.find(l => l.x === x && l.z === z);
    if (!loc) throw new Error(`no loc at (${x},${z})`);
    const t0 = now(sdk);
    const d = dialogue(sdk, opts.answers ?? [], { startTimeout: 15 });
    await sdk.sendUseItemOnLoc(it.slot, loc.x, loc.z, loc.id);
    const r = await waitUntil(sdk, done, opts.maxTicks ?? 40);
    const run = await d;
    const end = Math.max(r?.tick ?? NaN, run.endTick);
    return { name: `use ${it.name} on ${loc.name} (${x},${z})`, ticks: end - t0, pages: run.pages, note: r ? undefined : 'TIMEOUT' };
}

/** Open the door at (x, z) and wait until it no longer offers Open (the opened door moves to the next tile). */
export async function openDoorAt(sdk: BotSDK, x: number, z: number, maxTicks = 30): Promise<StepRecord> {
    const isClosed = (l: { x: number; z: number; name: string; optionsWithIndex: { text: string }[] }) => l.x === x && l.z === z && /door|gate/i.test(l.name) && l.optionsWithIndex.some(o => /^open$/i.test(o.text));
    const door = (await sdk.scanNearbyLocs(20)).find(isClosed);
    if (!door) return { name: `door (${x},${z}) already open`, ticks: 0 };
    const t0 = now(sdk);
    const op = door.optionsWithIndex.find(o => /^open$/i.test(o.text))!.opIndex;
    await sdk.sendInteractLoc(door.x, door.z, door.id, op);
    // A click sent while a script holds the player in p_delay is dropped; re-send until it lands.
    let sent = t0;
    const r = await waitUntil(sdk, s => {
        if (!(s.nearbyLocs ?? []).some(isClosed)) return true;
        if (s.tick - sent >= 5) {
            sent = s.tick;
            void sdk.sendInteractLoc(door.x, door.z, door.id, op);
        }
        return false;
    }, maxTicks);
    return { name: `open door (${x},${z})`, ticks: (r?.tick ?? NaN) - t0, note: r ? undefined : 'TIMEOUT' };
}

/** Walk with run on and return ticks; the route is the SDK's (doors handled). */
export async function walk(bot: BotActions, sdk: BotSDK, x: number, z: number, tol = 1): Promise<StepRecord> {
    const p0 = pos(sdk.getState());
    const est = pathTiles(p0.level, p0.x, p0.z, x, z);
    const t0 = now(sdk);
    const r = await bot.walkTo(x, z, tol);
    return { name: `walk (${p0.x},${p0.z})->(${x},${z})`, ticks: now(sdk) - t0, note: `${est.tiles} path tiles${r.success ? '' : ' FAILED ' + r.message}` };
}

// ─── Fights ─────────────────────────────────────────────────────────────────

export interface FightRecord extends StepRecord {
    playerHits: number;
    damageTaken: number;
    food: number;
    died: boolean;
}

/**
 * Attack the nearest NPC matching `re` and wait until it is gone (dead and
 * despawned) or `doneP` holds. Eats any food item when hp drops below
 * `eatBelow`. Ticks run from the attack click to the kill.
 */
export async function fight(sdk: BotSDK, bot: BotActions, re: RegExp, opts: { eatBelow?: number; maxTicks?: number; doneP?: Pred; food?: RegExp } = {}): Promise<FightRecord> {
    const maxTicks = opts.maxTicks ?? 1500;
    const food = opts.food ?? /^(shark|lobster|swordfish|monkfish|cooked karambwan|manta ray)$/i;
    let npc = findNpc(sdk, re);
    if (!npc) {
        await waitTicks(sdk, 3);
        npc = findNpc(sdk, re);
    }
    if (!npc) throw new Error(`fight target ${re} not found`);
    const idx = npc.index;
    const startHp = sdk.getState()!.player!.hp;
    const t0 = now(sdk);
    const rec: FightRecord = { name: `fight ${npc.name} (lvl ${npc.combatLevel})`, ticks: NaN, playerHits: 0, damageTaken: 0, food: 0, died: false };
    let lastHp = startHp;
    let lastFood = invCount(sdk.getState(), food);
    let lastEatClick = -10;
    const unsub = sdk.onStateUpdate(s => {
        const hp = s.player?.hp ?? lastHp;
        if (hp < lastHp) rec.damageTaken += lastHp - hp;
        lastHp = hp;
        if (s.player?.isDead) rec.died = true;
        // Food eaten is the drop in the food count, not the number of eat clicks.
        const fc = invCount(s, food);
        if (fc < lastFood) rec.food += lastFood - fc;
        lastFood = fc;
        if (opts.eatBelow && hp < opts.eatBelow && s.tick - lastEatClick >= 3) {
            const f = s.inventory.find(i => food.test(i.name));
            if (f) {
                lastEatClick = s.tick;
                void sdk.sendUseItem(f.slot, 1);
            }
        }
    });
    const opAtk = npc.optionsWithIndex.find(o => /attack/i.test(o.text));
    await sdk.sendInteractNpc(idx, opAtk?.opIndex ?? 2);
    // Re-issue the attack if combat drops (e.g. after eating).
    let lastAttack = t0;
    const r = await waitUntil(sdk, s => {
        if (opts.doneP && opts.doneP(s)) return true;
        const n = s.nearbyNpcs.find(n => n.index === idx);
        if (!n) return true;
        if (n.hp === 0) return true;
        if (s.tick - lastAttack > 8 && !s.player?.combat?.inCombat) {
            lastAttack = s.tick;
            void sdk.sendInteractNpc(idx, opAtk?.opIndex ?? 2);
        }
        return false;
    }, maxTicks);
    unsub();
    rec.ticks = (r?.tick ?? NaN) - t0;
    if (!r) rec.note = 'TIMEOUT';
    return rec;
}

// ─── Recording ──────────────────────────────────────────────────────────────

export class Recorder {
    steps: StepRecord[] = [];
    constructor(readonly quest: string) {}
    add(r: StepRecord, label?: string): StepRecord {
        const rec = label ? { ...r, name: `${label}: ${r.name}` } : r;
        this.steps.push(rec);
        const extra = [rec.approach !== undefined ? `approach ${rec.approach}` : '', rec.pages !== undefined ? `${rec.pages} pages` : '', rec.choices !== undefined ? `${rec.choices} choices` : '', rec.note ?? ''].filter(Boolean).join(', ');
        console.log(`STEP ${rec.ticks}\t${rec.name}${extra ? '  [' + extra + ']' : ''}`);
        const log = (r as { run?: DialogueRun }).run?.log;
        if (process.env.GNOME_DEBUG && log) for (const l of log) console.log(`  | ${l}`);
        return rec;
    }
    async time(label: string, fn: () => Promise<unknown>): Promise<StepRecord> {
        const sdk = (globalThis as any).__sdk as BotSDK;
        const t0 = now(sdk);
        await fn();
        return this.add({ name: label, ticks: now(sdk) - t0 });
    }
    summary(): void {
        const total = this.steps.reduce((a, s) => a + (Number.isFinite(s.ticks) ? s.ticks : 0), 0);
        result(this.quest, { total, steps: this.steps });
    }
}
