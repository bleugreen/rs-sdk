// Shared helpers for the small self-skill quest measurements (Monk's Friend,
// Sea Slug, Fishing Contest, Doric's Quest). Not a script itself. Builds on the
// gnome chain's helpers (quest-gnome-lib.ts), whose clock, dialogue driver and
// recorder follow quest-primitives-lib.ts, so the numbers are comparable.
//
// Run every script through quest-smallskill-lab.sh (NODE_TICKRATE=300).

import type { BotSDK } from '../../../sdk/index';
import type { BotActions } from '../../../sdk/actions';
import { dialogue, now, pos, waitUntil, type DialogueRun, type Pred, type StepRecord } from './quest-gnome-lib';

export * from './quest-gnome-lib';

/** Teleport spell components (server/content/pack/interface.pack; quest-primitives-teleports.ts). */
export const SPELL = { varrock: 1164, lumbridge: 1167, falador: 1170, camelot: 1174, ardougne: 1540 } as const;
/** Landing tiles (skill_magic/configs/magic_spells.dbrow tele_coord), for the fallback below. */
const LANDING: Record<keyof typeof SPELL, [number, number]> = { varrock: [3213, 3424], lumbridge: [3221, 3218], falador: [2965, 3378], camelot: [2757, 3478], ardougne: [2661, 3301] };

/**
 * The dialogue runs in CONVENTIONS.md notation from a DialogueRun log: `c` for
 * a run of continues, `opt` for an option click. State-changing pages are not
 * visible from the client; the documents mark them from the script.
 */
export function runsOf(run: DialogueRun): string {
    const out: string[] = [];
    let k = 0;
    for (const l of run.log) {
        const kind = l.split('\t')[1];
        if (kind === 'page') k++;
        else if (kind?.startsWith('choice')) {
            if (k) out.push(`${k}c`);
            k = 0;
            out.push('opt');
        }
    }
    if (k) out.push(`${k}c`);
    return out.join(', ');
}

/** Cast a teleport spell from the spellbook and wait until the player has jumped. */
export async function teleport(sdk: BotSDK, spell: keyof typeof SPELL): Promise<StepRecord> {
    const p0 = pos(sdk.getState());
    const far = (s: Parameters<Pred>[0]) => { const p = pos(s); return Math.abs(p.x - p0.x) + Math.abs(p.z - p0.z) > 30; };
    const t0 = now(sdk);
    const m0 = sdk.getState()!.gameMessages.length;
    const res = await sdk.sendClickComponent(SPELL[spell]);
    let r = await waitUntil(sdk, far, 10);
    let note: string | undefined;
    if (!r) {
        note = `RETRIED (first click ${res.success ? 'sent' : 'failed: ' + res.message}; msgs: ${sdk.getState()!.gameMessages.slice(m0).map(m => m.text).join(' | ')})`;
        await sdk.sendClickComponent(SPELL[spell]);
        r = await waitUntil(sdk, far, 15);
    }
    if (!r) {
        // A freshly created lab account drops its first casts (the spellbook is not live yet).
        // Staff-teleport to the landing tile and book the measured 4 ticks (primitives.md section 4).
        const [lx, lz] = LANDING[spell];
        await sdk.sendSay(`::tele 0,${lx >> 6},${lz >> 6},${lx & 63},${lz & 63}`);
        await waitUntil(sdk, s => pos(s).x === lx && pos(s).z === lz, 20);
        await waitUntil(sdk, () => false, 3);
        return { name: `${spell} teleport (FALLBACK staff tele; 4 ticks from primitives.md)`, ticks: 4, note };
    }
    return { name: `${spell} teleport -> ${JSON.stringify(pos(r.state))}`, ticks: r.tick - t0, note };
}

/** Pick up the ground item matching `re` and wait until it is in the inventory. */
export async function pickup(sdk: BotSDK, re: RegExp, maxTicks = 40): Promise<StepRecord> {
    const items = (await sdk.scanGroundItems(25)).filter(i => re.test(i.name)).sort((a, b) => a.distance - b.distance);
    const it = items[0];
    if (!it) throw new Error(`no ground item ${re} near ${JSON.stringify(pos(sdk.getState()))}`);
    const before = (sdk.getState()!.inventory ?? []).filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);
    const t0 = now(sdk);
    await sdk.sendPickup(it.x, it.z, it.id);
    let sent = t0;
    const r = await waitUntil(sdk, s => {
        const n = (s.inventory ?? []).filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);
        if (n > before) return true;
        if (s.tick - sent >= 8) { sent = s.tick; void sdk.sendPickup(it.x, it.z, it.id); }
        return false;
    }, maxTicks);
    return { name: `take ${it.name} (${it.x},${it.z})`, ticks: (r?.tick ?? NaN) - t0, note: r ? undefined : 'TIMEOUT' };
}

/** Use one inventory item on another, answer any dialogue, wait for `done`. */
export async function useOnItem(sdk: BotSDK, a: RegExp, b: RegExp, done: Pred, maxTicks = 30): Promise<StepRecord & { run: DialogueRun }> {
    const inv = sdk.getState()!.inventory;
    const ia = inv.find(i => a.test(i.name));
    const ib = inv.find(i => b.test(i.name) && i !== ia);
    if (!ia || !ib) throw new Error(`useOnItem: missing ${a} or ${b}`);
    const t0 = now(sdk);
    const d = dialogue(sdk, [], { startTimeout: 6 });
    await sdk.sendUseItemOnItem(ia.slot, ib.slot);
    const r = await waitUntil(sdk, done, maxTicks);
    const run = await d;
    return { name: `use ${ia.name} on ${ib.name}`, ticks: Math.max(r?.tick ?? NaN, run.endTick) - t0, pages: run.pages, run, note: r ? undefined : 'TIMEOUT' };
}

/** Inventory op (e.g. Rub, Read) on the first item matching `re`, then wait for `done`. */
export async function invOp(sdk: BotSDK, re: RegExp, opRe: RegExp, done: Pred, maxTicks = 20): Promise<StepRecord> {
    const it = sdk.getState()!.inventory.find(i => re.test(i.name));
    if (!it) throw new Error(`no inventory item ${re}`);
    const op = it.optionsWithIndex.find(o => opRe.test(o.text));
    if (!op) throw new Error(`${it.name} has no op ${opRe}: ${it.optionsWithIndex.map(o => o.text).join('/')}`);
    const t0 = now(sdk);
    await sdk.sendUseItem(it.slot, op.opIndex);
    const r = await waitUntil(sdk, done, maxTicks);
    return { name: `${op.text} ${it.name}`, ticks: (r?.tick ?? NaN) - t0, note: r ? undefined : 'TIMEOUT' };
}

/**
 * Walk with the SDK pathfinder, re-clicking if it stops short. Returns ticks and
 * the tiles actually stepped (Chebyshev per observed tick). bot.walkTo costs
 * about 0.57 ticks per route tile against 0.5 for chained clicks (primitives.md
 * section 2), so the documents quote both.
 */
export async function walkTo(bot: BotActions, sdk: BotSDK, x: number, z: number, tol = 1): Promise<StepRecord & { tiles: number }> {
    const p0 = pos(sdk.getState());
    let last = p0;
    let tiles = 0;
    const unsub = sdk.onStateUpdate(s => {
        const p = pos(s);
        const d = Math.max(Math.abs(p.x - last.x), Math.abs(p.z - last.z));
        if (p.level === last.level && d <= 2) tiles += d;
        last = p;
    });
    const t0 = now(sdk);
    let r = await bot.walkTo(x, z, tol);
    for (let i = 0; i < 3 && !r.success; i++) r = await bot.walkTo(x, z, tol);
    unsub();
    return { name: `walk (${p0.x},${p0.z},${p0.level})->(${x},${z})`, ticks: now(sdk) - t0, tiles, note: `${tiles} tiles stepped${r.success ? '' : ' FAILED ' + r.message}` };
}

/** Empty the inventory and worn slots (::~clearinv is unreliable in this lab, fishing.md section 6), then drop leftovers. */
export async function clearInv(sdk: BotSDK): Promise<void> {
    await sdk.sendSay('::~clearinv inv');
    await sdk.sendSay('::~clearinv worn');
    await waitUntil(sdk, () => false, 2);
    for (let pass = 0; pass < 4 && (sdk.getState()!.inventory.length > 0); pass++) {
        for (const it of sdk.getState()!.inventory) await sdk.sendDropItem(it.slot).catch(() => {});
        await waitUntil(sdk, () => false, 2);
    }
}

/**
 * Interact with loc `id` at (x, z) without scanning (the client's loc scan
 * mislabels bridged floors such as the fishing platform), answer any dialogue,
 * and wait for `done`. Re-sends the click every 6 ticks while idle where it started.
 */
export async function locId(sdk: BotSDK, x: number, z: number, id: number, op: number, done: Pred, opts: { answers?: RegExp[]; idle?: number; maxTicks?: number; label?: string } = {}): Promise<StepRecord & { run: DialogueRun }> {
    const t0 = now(sdk);
    let talked = false;
    const d = dialogue(sdk, opts.answers ?? [], { idle: opts.idle ?? 3, startTimeout: 12 }).then(r => { if (r.firstTick >= 0) talked = true; return r; });
    await sdk.sendInteractLoc(x, z, id, op);
    let sent = t0;
    const p0 = pos(sdk.getState());
    let moved = false;
    const r = await waitUntil(sdk, s => {
        if (done(s) || talked) return true;
        const p = pos(s);
        if (p.x !== p0.x || p.z !== p0.z || p.level !== p0.level) moved = true;
        if (!moved && !s.dialog.isOpen && s.tick - sent >= 6) { sent = s.tick; void sdk.sendInteractLoc(x, z, id, op); }
        return false;
    }, opts.maxTicks ?? 60);
    const run = await d;
    const end = talked && run.endTick >= 0 ? run.endTick : (r?.tick ?? NaN);
    return { name: `${opts.label ?? 'loc ' + id} (${x},${z})`, ticks: end - t0, pages: run.pages, choices: run.choices, run, note: r ? undefined : 'TIMEOUT' };
}

/** True once a game message matching `re` has arrived since tick `since`. */
export function msgSince(re: RegExp, since: number): Pred {
    return s => s.gameMessages.some(m => re.test(m.text) && ((m as { tick?: number }).tick ?? since) >= since);
}

/**
 * Walk by clicking the destination tile (the client's own router), re-clicking
 * until within `tol`. For areas the SDK's precomputed long-path map does not
 * cover, such as the bridged fishing platform, where bot.walkTo finds no waypoints.
 */
export async function clickWalk(sdk: BotSDK, x: number, z: number, tol = 0, maxTicks = 60): Promise<StepRecord & { tiles: number }> {
    const p0 = pos(sdk.getState());
    let last = p0;
    let tiles = 0;
    const t0 = now(sdk);
    let sent = t0;
    await sdk.sendWalk(x, z);
    const r = await waitUntil(sdk, s => {
        const p = pos(s);
        const d = Math.max(Math.abs(p.x - last.x), Math.abs(p.z - last.z));
        if (p.level === last.level && d <= 2) tiles += d;
        const moved = d > 0;
        last = p;
        if (p.level === p0.level && Math.max(Math.abs(p.x - x), Math.abs(p.z - z)) <= tol) return true;
        if (!moved && s.tick - sent >= 3) { sent = s.tick; void sdk.sendWalk(x, z); }
        return false;
    }, maxTicks);
    return { name: `click-walk (${p0.x},${p0.z},${p0.level})->(${x},${z})`, ticks: (r?.tick ?? NaN) - t0, tiles, note: `${tiles} tiles stepped${r ? '' : ' TIMEOUT at ' + JSON.stringify(pos(sdk.getState()))}` };
}

/** Print the dialogue runs of a talk/locTalk record and pass it through. */
export function withRuns<T extends StepRecord & { run?: DialogueRun }>(r: T): T {
    if (r.run) r.note = [r.note, `runs ${runsOf(r.run)}`].filter(Boolean).join('; ');
    return r;
}
