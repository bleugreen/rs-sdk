// S25b's booth fallback: bury the bones left over at the Varrock west booth (STEP-MANIFEST.md
// entry 15; docs/speedrun/skills/prayer.md sections 1, 4 and 6).
//
// Booth only. Prayer's primary path buries inside other modules: inline in S07's knife loop
// (woodcutting.ts), on the Mining `stay2` lap (knife-mine's bury) and in S18's stuns. Those are
// theirs, and this module has no inline mode. It runs only when bones are left over: a knife-off
// night, a stock larger than those paths absorb, or the Mining bury failing to fire.
//
// The loop is overlay-driven: one decision per observed tick, fire-and-forget sends, and nothing
// inside an inventory waits on an effect.
// - Bones in the pack, bank closed: click Bury on the lowest slot that shows a bone, every
//   observed tick. The bury script p_delay(0)s, so the server drops the click that lands in the
//   tick after an accepted one (OpHeldHandler, "cannot interact while delayed") at no cost: the
//   accepted clicks land every 2 ticks, phase-locked without reading any effect. That is the
//   manifest's blind 2-tick bury, sent the way prayer-bury.ts --mode=fast measured 58 per 28.
// - No bones in the pack: click the booth (Use-quickly) on the first tick the pack shows none,
//   the first tick the server accepts it (the last bury's delay has just cleared).
// - Bank open: withdraw a full inventory (lib/bank.ts withdrawMany, `n: 'fill'`) and close in
//   the same tick. A visit holding the helper's noted stack deposits it first (the bank unnotes
//   it) and withdraws on the next tick.
// - Level-up pages: lib/levelup's watcher sends Continue on the tick the page shows. It listens
//   ahead of this loop, so the Continue leaves before that tick's Bury and the Bury runs
//   (prayer.md section 4).
// The bank gap is 4 ticks against 2 for a plain bury: 27 x 2 + 4 = 58 ticks per 28 bones.
//
// The 5-events-a-tick budget does not bind, so this loop keeps no budget books beyond a
// per-tick peak for the lab: a plain tick sends 1 (Bury), a level-up tick 2 (Continue, Bury), the
// booth tick 2-3 (the SDK routes every loc click, MOVE_OPCLICK + OPLOC, plus a Continue), the
// bank tick 2-4 (the withdraw buttons and the close), a first visit's deposit tick one per noted
// id. item-cycle's routed/unrouted accounting belongs to its in-page program; the overlay has no
// unrouted loc click, and the booth tick's 2-3 events leave room for it.
//
// Timing is on observed ticks (rs/158 fold-in 13). Wall clock appears only as lib/wait's idle
// bound, a dead-client detector.
//
// buryHeld is the one primitive for burying the bones in the pack where they are, outside the booth:
// S07's close after Woodcutting 99 (woodcutting.ts, the pure-bury tail) runs it. It sends each Bury
// on the frame that shows the last bone gone, so no click lands in the bury's delay (its comment).
//
// One step, logoutSafe between loads. `run` works from any state at the booth (bones held are
// buried first), so a resume continues from whatever the pack and bank hold; the boneBank probe
// lets `done` see a closed bank.

import type { BankItem, BotWorldState, InventoryItem } from '../../sdk/types';
import { depositMatching, planWithdraws, withdrawMany, type WithdrawSpec } from '../lib/bank';
import type { Booth } from '../lib/item-cycle';
import { INVENTORY_SIZE } from '../lib/items';
import { startLevelUpWatcher, type LevelUpSdk } from '../lib/levelup';
import { logNote } from '../lib/ticks';
import { nextTick, waitUntil } from '../lib/wait';
import { XP_RATE, xpForLevel } from '../lib/xp';
import type { Observed, RunnerSession, Step, StepContext } from '../runner/step';
import { boothFor, boothLoc, SCORED_TILE, VARROCK_WEST } from './herblore';

export const skill = 'prayer';

export const STEP_NAME = 'S25b prayer booth';

export interface BoneType {
    /** obj.pack debugname. */
    obj: string;
    name: string;
    id: number;
    /** The banknote, cert_<obj>. */
    note: number;
    /** bones.obj bone_exp / 10: the base xp a bury gives. */
    base: number;
}

/** The bones this fallback takes, dragon first (rs/158's dragon-first rule). prayer.test.ts checks them against the content. */
export const BONE_TYPES: readonly BoneType[] = [
    { obj: 'dragon_bones', name: 'Dragon bones', id: 536, note: 537, base: 72 },
    { obj: 'babydragon_bones', name: 'Babydragon bones', id: 534, note: 535, base: 30 }
];

/**
 * Free slots at the first withdrawal. STEP-MANIFEST.md's inventory ledger has no S25b row of its
 * own (S25b sits inside S07's rows), so the booth asks for a full inventory: everything held is
 * the bones themselves, which leave on the first visit.
 */
export const FREE_SLOTS = 28;
/** Chebyshev tiles from the stand tile within which the account counts as at the booth. */
export const AT_BOOTH = 1;
/** Observed ticks without progress (xp, the pack changing, the bank opening or closing) before the loop gives up. */
export const STALL_TICKS = 20;
/** Ticks a booth click waits for the bank before it is sent again. */
export const BOOTH_RETRY = 3;
/** Ticks a deposit, withdraw or close waits for its effect before it is sent again. */
export const BANK_RETRY = 2;

export interface PrayerOptions {
    /** How many bones this entry buries (default 'all'). A count applies to each entry, run or resume. */
    bones?: number | 'all';
    /** Stop at this Prayer level (default 99); the last load takes only the bones it needs. */
    untilLevel?: number;
    /** Bone types to take, by obj id, obj debugname or game name, in this order (default dragon, then babydragon). */
    take?: ReadonlyArray<number | string>;
    booth?: Booth;
    /** Free slots the first withdrawal needs (default FREE_SLOTS); a ledger row may lower it. */
    freeSlots?: number;
}

// ---------------------------------------------------------------- state readers

export function prayerOf(s: BotWorldState): { level: number; xp: number } {
    const k = s.skills.find(x => x.name.toLowerCase() === 'prayer');
    return { level: k?.baseLevel ?? 0, xp: k?.experience ?? 0 };
}

/** The configured bone types in order, or the refusal for an unknown one. */
export function bonesFor(take?: ReadonlyArray<number | string>): BoneType[] | string {
    if (!take) return [...BONE_TYPES];
    if (!take.length) return 'take names no bone type';
    const out: BoneType[] = [];
    for (const t of take) {
        const b = BONE_TYPES.find(x => (typeof t === 'number' ? x.id === t : x.obj === t.toLowerCase() || x.name.toLowerCase() === t.toLowerCase()));
        if (!b) return `unknown bone type ${JSON.stringify(t)} (this module takes ${BONE_TYPES.map(x => `${x.obj} ${x.id}`).join(', ')})`;
        if (!out.includes(b)) out.push(b);
    }
    return out;
}

function typesOf(opts: PrayerOptions): BoneType[] {
    const t = bonesFor(opts.take);
    if (typeof t === 'string') throw new Error(t);
    return t;
}

const allIds = (types: readonly BoneType[]) => new Set(types.flatMap(t => [t.id, t.note]));

/** Buryable bones in the pack (unnoted, of a configured type), lowest slot first. */
export function buryable(s: BotWorldState, types: readonly BoneType[]): InventoryItem[] {
    const ids = new Set(types.map(t => t.id));
    return s.inventory.filter(i => i.count > 0 && ids.has(i.id)).sort((a, b) => a.slot - b.slot);
}

/** Configured bones held, unnoted or noted, as a bone count. */
export function bonesHeld(s: BotWorldState, types: readonly BoneType[]): number {
    const ids = allIds(types);
    return s.inventory.filter(i => ids.has(i.id)).reduce((n, i) => n + i.count, 0);
}

/** Configured bones in a bank list (the bank stores them unnoted). */
export function bonesIn(items: readonly BankItem[], types: readonly BoneType[]): number {
    const ids = allIds(types);
    return items.filter(i => ids.has(i.id)).reduce((n, i) => n + i.count, 0);
}

/** Inventory slots held by anything that is not a configured bone or its note. */
export function otherItems(s: BotWorldState, types: readonly BoneType[]): InventoryItem[] {
    const ids = allIds(types);
    return s.inventory.filter(i => i.count > 0 && !ids.has(i.id));
}

export function untilLevelOf(opts: PrayerOptions = {}): number {
    return opts.untilLevel ?? 99;
}

export function reached(s: BotWorldState, untilLevel = 99): boolean {
    return prayerOf(s).level >= untilLevel;
}

/** Bones of `type` that take `xp` to `untilLevel`: the last may pass it, none after. */
export function bonesToLevel(xp: number, untilLevel: number, type: BoneType = BONE_TYPES[0]!): number {
    return Math.max(0, Math.ceil((xpForLevel(untilLevel) - xp) / (type.base * XP_RATE)));
}

function chebyshev(s: BotWorldState, t: { x: number; z: number }): number {
    return Math.max(Math.abs((s.player?.worldX ?? -1e9) - t.x), Math.abs((s.player?.worldZ ?? -1e9) - t.z));
}

// ---------------------------------------------------------------- preconditions

export function preconditions(s: BotWorldState, opts: PrayerOptions = {}): true | string {
    if (!s.inGame || !s.player) return 'not in game';
    const until = untilLevelOf(opts);
    if (!Number.isInteger(until) || until < 1 || until > 99) return `untilLevel ${until} is not a level from 1 to 99`;
    if (opts.bones !== undefined && opts.bones !== 'all' && !(Number.isInteger(opts.bones) && opts.bones >= 0)) return `bones ${opts.bones} is not a count or 'all'`;
    const need = opts.freeSlots ?? FREE_SLOTS;
    if (!Number.isInteger(need) || need < 1 || need > INVENTORY_SIZE) return `freeSlots ${need} is not a slot count from 1 to ${INVENTORY_SIZE}`;
    const types = bonesFor(opts.take);
    if (typeof types === 'string') return types;
    // a band already passed, or a zero count, is a no-op
    if (reached(s, until) || opts.bones === 0) return true;
    const booth = opts.booth ?? VARROCK_WEST;
    const stand = booth.stand ?? SCORED_TILE;
    if (chebyshev(s, stand) > AT_BOOTH) return `not at the Varrock west booth: at ${s.player.worldX},${s.player.worldZ}, the booth is worked from ${stand.x},${stand.z}`;
    // right after a login the position is published before the scene's locs
    if (s.nearbyLocs.length && !boothLoc(s, booth)) return `no bank booth (${booth.x},${booth.z}) in view (at ${s.player.worldX},${s.player.worldZ})`;
    // The first withdrawal's free slots: the configured bones leave on the first visit, nothing else does.
    const other = otherItems(s, types);
    if (INVENTORY_SIZE - other.length < need) {
        return `${other.length} other items (${[...new Set(other.map(i => i.name))].join(', ')}): the first withdrawal needs ${need} free slots and would have ${INVENTORY_SIZE - other.length}`;
    }
    // The bank's stock is in sight only while it is open. Closed with none held, the first visit
    // reads it and refuses there with the same reason if it holds none.
    if (bonesHeld(s, types) === 0 && s.bank?.isOpen && bonesIn(s.bank.items, types) === 0) {
        return `no bones banked: none of ${types.map(t => t.name).join(', ')} held or in the open bank`;
    }
    return true;
}

// ---------------------------------------------------------------- the load

/**
 * One visit's withdraw: the configured types in order (dragon first), each only as many as the
 * free slots, the count left and the xp to `untilLevel` take. A single type that fills the free
 * slots is one Withdraw-All (`n: 'fill'`, the server stops at a full pack); with a second type
 * every amount is exact, because withdrawMany orders sends by bank slot and a Withdraw-All of the
 * later type could otherwise crowd out the earlier one.
 */
export function planLoad(bank: readonly BankItem[], types: readonly BoneType[], free: number, capLeft: number, xpLeft: number): { specs: WithdrawSpec[]; bones: number } {
    const picks: Array<{ id: number; k: number; stock: number }> = [];
    let slots = Math.min(free, capLeft);
    let xp = xpLeft;
    for (const t of types) {
        if (slots <= 0 || xp <= 0) break;
        const item = bank.find(b => b.id === t.id && b.count > 0);
        if (!item) continue;
        const k = Math.min(item.count, slots, Math.ceil(xp / (t.base * XP_RATE)));
        picks.push({ id: item.id, k, stock: item.count });
        slots -= k;
        xp -= k * t.base * XP_RATE;
    }
    const specs: WithdrawSpec[] = picks.map(p => {
        if (picks.length === 1 && p.k === free && p.k < p.stock) return { item: p.id, n: 'fill' };
        if (p.k === p.stock) return { item: p.id, n: 'all' };
        return { item: p.id, n: p.k };
    });
    return { specs, bones: picks.reduce((n, p) => n + p.k, 0) };
}

// ---------------------------------------------------------------- the loop

/** What a booth run did, on observed ticks. */
export interface BoothReport {
    buried: number;
    /** Bones buried per type name. */
    byType: Record<string, number>;
    /** Bones each visit's withdraw planned, by visit. */
    loads: number[];
    /** Ticks of every Prayer xp gain. */
    xpTicks: number[];
    /** The tick the bank was first seen open, per visit. */
    bankOpens: number[];
    /** Bank open to bank open, per visit after the first. */
    cycleTicks: number[];
    /** The cycles that began with a full load of 28, and their mean (null without one). */
    fullCycles: number[];
    ticksPerInventory: number | null;
    /** Bury clicks sent: about two per bone, the server drops the off-tick one. */
    clicks: number;
    /** Booth clicks sent: one per visit, more when a click was dropped (a cold region after an arrival). */
    boothClicks: number;
    levelUps: number;
    /** The most user events this loop sent on one tick. */
    eventPeak: number;
    startTick: number;
    endTick: number;
    stop: 'level' | 'count' | 'exhausted';
    level: number;
    xp: number;
}

export type BurySdk = RunnerSession['sdk'];

// ---------------------------------------------------------------- burying the bones held

/**
 * Observed ticks a Bury may go unanswered before buryHeld sends it again. An accepted Bury's bone
 * leaves the pack on the tick after the one it lands on, so a Bury sent on frame T shows its bone
 * gone on T+2 when the round trip fits in a tick; three frames without it means it was lost.
 */
export const BURY_RESEND = 3;
/** Bury sends in a row that bury nothing before buryHeld stops `stalled`. */
export const BURY_STALL = 5;
/** buryHeld's default bound in observed ticks: a 27-bone pack buries in about 54. */
export const BURY_HELD_TICKS = 600;

export type HeldBurySdk = Pick<BurySdk, 'getState' | 'onStateUpdate' | 'sendUseItem' | 'sendClickDialog'>;

export interface HeldBuryOptions {
    /** Stop once Prayer's base level reaches this. */
    untilLevel?: number;
    /** Stop on the first frame, with no Bury pending, on which this says false. */
    keepOn?: (s: BotWorldState) => boolean;
    /** The bound in observed ticks (default BURY_HELD_TICKS). */
    maxTicks?: number;
    signal?: AbortSignal;
}

export interface HeldBuryReport {
    startTick: number;
    endTick: number;
    buried: number;
    /** Bury clicks sent: one per bone, plus the resends. */
    sends: number;
    resends: number;
    /** The tick of each frame that showed a bone gone. */
    buryTicks: number[];
    /** none: no bone left; level: untilLevel; target: keepOn said false; stalled: BURY_STALL resends in a row; bound: maxTicks. */
    stop: 'none' | 'level' | 'target' | 'stalled' | 'bound' | 'aborted';
}

/**
 * Bury every bone held that `bones` names, at the engine's rate, never sending a click the bury's
 * delay would drop. bury_bone.rs2 runs p_delay(0): PlayerOps.ts P_DELAY sets delayedUntil to the next
 * tick, OpHeldHandler drops any click while the player is delayed, and World.ts clears the delay
 * only in processPlayers, after that tick's client input, where the script resumes and deletes the
 * bone. So a Bury accepted on tick T drops every click landing on T+1, its bone leaves on T+1, and
 * the next click is taken from T+2: one bone per two ticks at best, and nothing to batch, since a
 * second click on T or T+1 is dropped. This loop sends each Bury on the frame that shows the last
 * one's bone gone, a frame on which the delay has cleared, so every send can land; with a round trip
 * inside a tick that is the 2-tick floor. (buryAtBooth's bury half clicks every observed tick
 * instead and lets the server drop the off-tick click.) The level-up watcher runs throughout and
 * sends Continue ahead of that frame's Bury (prayer.md section 4). Works from any pack: a pack with
 * no bones returns at once (`none`).
 */
export function buryHeld(sdk: HeldBurySdk, bones: RegExp, o: HeldBuryOptions = {}): Promise<HeldBuryReport> {
    const first = sdk.getState();
    const rep: HeldBuryReport = { startTick: first?.tick ?? 0, endTick: first?.tick ?? 0, buried: 0, sends: 0, resends: 0, buryTicks: [], stop: 'none' };
    const maxTicks = o.maxTicks ?? BURY_HELD_TICKS;
    const held = (s: BotWorldState) => s.inventory.filter(i => i.count > 0 && bones.test(i.name)).sort((a, b) => a.slot - b.slot);
    return new Promise(resolve => {
        const watcher = startLevelUpWatcher(sdk);
        let pending: { tick: number; held: number } | null = null;
        let unanswered = 0;
        let finished = false;
        let unsub: () => void = () => {};
        const finish = (s: BotWorldState | null, stop: HeldBuryReport['stop']) => {
            if (finished) return;
            finished = true;
            unsub();
            watcher.stop();
            o.signal?.removeEventListener('abort', onAbort);
            rep.endTick = s?.tick ?? rep.endTick;
            rep.stop = stop;
            resolve(rep);
        };
        const onAbort = () => finish(sdk.getState(), 'aborted');
        const step = (s: BotWorldState) => {
            if (finished) return;
            if (o.signal?.aborted) return finish(s, 'aborted');
            const pack = held(s);
            if (pending) {
                if (pack.length < pending.held) {
                    rep.buried += pending.held - pack.length;
                    rep.buryTicks.push(s.tick);
                    pending = null;
                    unanswered = 0;
                } else if (s.tick - pending.tick >= BURY_RESEND) {
                    pending = null;
                    if (++unanswered >= BURY_STALL) return finish(s, 'stalled');
                    rep.resends++;
                } else return;
            }
            if (s.tick - rep.startTick >= maxTicks) return finish(s, 'bound');
            if (!pack.length) return finish(s, 'none');
            if (o.untilLevel !== undefined && reached(s, o.untilLevel)) return finish(s, 'level');
            if (o.keepOn && !o.keepOn(s)) return finish(s, 'target');
            const bone = pack[0]!;
            pending = { tick: s.tick, held: pack.length };
            rep.sends++;
            void sdk.sendUseItem(bone.slot, bone.optionsWithIndex?.find(x => /^bury$/i.test(x.text))?.opIndex ?? 1);
        };
        o.signal?.addEventListener('abort', onAbort);
        unsub = sdk.onStateUpdate(step);
        if (first) step(first);
    });
}

/** User events a send costs: the SDK routes every loc click (MOVE_OPCLICK + OPLOC). */
const BOOTH_EVENTS = 2;

/**
 * Bury at the booth until `untilLevel`, the count, or the stock runs out. Works from any state at
 * the booth: bones held are buried first, a held noted stack is banked on the first visit, and a
 * stop that leaves bones in the pack banks them. Throws `no bones banked` when the first visit
 * finds none held or banked.
 */
export async function buryAtBooth(sdk: BurySdk, opts: PrayerOptions = {}): Promise<BoothReport> {
    const types = typesOf(opts);
    const until = untilLevelOf(opts);
    const cap = opts.bones ?? 'all';
    const first = sdk.getState() ?? (await nextTick(sdk));
    const booth = boothFor(first, opts.booth ?? VARROCK_WEST);
    const ours = [...allIds(types)];
    const notesHeld = (s: BotWorldState) => s.inventory.some(i => types.some(t => t.note === i.id));

    const rep: BoothReport = {
        buried: 0, byType: {}, loads: [], xpTicks: [], bankOpens: [], cycleTicks: [], fullCycles: [], ticksPerInventory: null, clicks: 0,
        boothClicks: 0, levelUps: 0, eventPeak: 0, startTick: first.tick, endTick: first.tick, stop: 'exhausted', level: prayerOf(first).level, xp: prayerOf(first).xp
    };
    const capLeft = () => (cap === 'all' ? Infinity : cap - rep.buried);
    const sent = { booth: -99, deposit: -99, withdraw: -99, close: -99 };
    /** Planned bones by the bank-open tick of the visit that withdrew them. */
    const loadAt = new Map<number, number>();
    let exhausted = false;

    let eventsTick = first.tick;
    let events = 0;
    const spend = (n: number) => {
        const t = sdk.getState()?.tick ?? eventsTick;
        if (t !== eventsTick) {
            eventsTick = t;
            events = 0;
        }
        events += n;
        rep.eventPeak = Math.max(rep.eventPeak, events);
    };
    const fire = (p: Promise<unknown>) => void p.catch(() => {});

    // Registered before the loop's own waits, so on a level-up tick its Continue leaves first.
    const watcherSdk: LevelUpSdk = {
        getState: () => sdk.getState(),
        onStateUpdate: l => sdk.onStateUpdate(l),
        sendClickDialog: ((...a: Parameters<BurySdk['sendClickDialog']>) => {
            spend(1);
            return sdk.sendClickDialog(...a);
        }) as BurySdk['sendClickDialog']
    };
    const watcher = startLevelUpWatcher(watcherSdk);

    const close = (s: BotWorldState) => {
        if (s.tick - sent.close < BANK_RETRY) return;
        sent.close = s.tick;
        spend(1);
        fire(sdk.sendCloseModal());
    };
    const deposit = (s: BotWorldState) => {
        if (s.tick - sent.deposit < BANK_RETRY) return;
        sent.deposit = s.tick;
        spend(new Set(s.inventory.filter(i => ours.includes(i.id)).map(i => i.id)).size);
        fire(depositMatching(sdk, ours));
    };

    let prev = first;
    let progressAt = first.tick;
    let bankWasOpen = false;
    try {
        for (let s = first; ; prev = s, s = await nextTick(sdk, s.tick)) {
            // ---- what the last tick did
            const p = prayerOf(s);
            if (s !== first) {
                if (p.xp > prayerOf(prev).xp) rep.xpTicks.push(s.tick);
                // with the bank closed on both sides, a bone leaves the pack only by its bury
                if (!s.bank.isOpen && !prev.bank.isOpen) {
                    for (const t of types) {
                        const gone = buryable(prev, [t]).length - buryable(s, [t]).length;
                        if (gone > 0) {
                            rep.buried += gone;
                            rep.byType[t.name] = (rep.byType[t.name] ?? 0) + gone;
                        }
                    }
                }
                if (p.xp !== prayerOf(prev).xp || s.bank.isOpen !== prev.bank.isOpen || JSON.stringify(s.inventory.map(i => [i.slot, i.id, i.count])) !== JSON.stringify(prev.inventory.map(i => [i.slot, i.id, i.count]))) progressAt = s.tick;
            }
            if (s.bank.isOpen && !bankWasOpen) rep.bankOpens.push(s.tick);
            bankWasOpen = s.bank.isOpen;
            if (s.tick - progressAt > STALL_TICKS) {
                throw new Error(`no progress for ${STALL_TICKS} ticks at tick ${s.tick}: Prayer ${p.level}, ${bonesHeld(s, types)} bones held, bank ${s.bank.isOpen ? 'open' : 'closed'}, dialog ${s.dialog.isOpen ? 'open' : 'closed'}, ${rep.buried} buried`);
            }

            // ---- this tick's sends
            const held = buryable(s, types);
            const stop = reached(s, until) || capLeft() <= 0;
            if (s.bank.isOpen) {
                if (stop) {
                    // bank what the stop leaves in the pack, then close
                    if (bonesHeld(s, types) > 0) deposit(s);
                    else close(s);
                } else if (notesHeld(s)) {
                    // the helper's noted stack goes in, and the bank unnotes it; the withdraw follows next tick
                    deposit(s);
                } else if (held.length) {
                    // this visit's withdraw has landed (or a resume found the bank open): close
                    close(s);
                } else if (bonesIn(s.bank.items, types) === 0) {
                    close(s);
                    if (rep.buried === 0 && loadAt.size === 0) throw new Error(`no bones banked: none of ${types.map(t => t.name).join(', ')} held or in the bank at ${booth.x},${booth.z}`);
                    exhausted = true;
                } else if (s.tick - sent.withdraw >= BANK_RETRY) {
                    const free = INVENTORY_SIZE - s.inventory.filter(i => i.count > 0).length;
                    const plan = planLoad(s.bank.items, types, free, capLeft(), xpForLevel(until) - p.xp);
                    if (plan.bones > 0) {
                        sent.withdraw = s.tick;
                        loadAt.set(rep.bankOpens.at(-1) ?? s.tick, plan.bones);
                        spend(planWithdraws(s.bank, plan.specs).sends.length);
                        // withdrawMany puts its sends on the wire before its first await, so the close follows them in this tick
                        fire(withdrawMany(sdk, plan.specs));
                        sent.close = s.tick;
                        spend(1);
                        fire(sdk.sendCloseModal());
                    } else close(s);
                }
            } else if (held.length && !stop) {
                const bone = held[0]!;
                rep.clicks++;
                spend(1);
                fire(sdk.sendUseItem(bone.slot, bone.optionsWithIndex?.find(o => /^bury$/i.test(o.text))?.opIndex ?? 1));
            } else if (bonesHeld(s, types) === 0 && (stop || exhausted)) {
                rep.stop = reached(s, until) ? 'level' : capLeft() <= 0 ? 'count' : 'exhausted';
                break;
            } else if (s.tick - sent.booth >= BOOTH_RETRY) {
                // nothing to bury (or the stop leaves bones to bank): the booth
                sent.booth = s.tick;
                rep.boothClicks++;
                spend(BOOTH_EVENTS);
                fire(sdk.sendInteractLoc(booth.x, booth.z, booth.id, booth.option));
            }
        }
    } finally {
        watcher.stop();
        rep.levelUps = watcher.dismissed;
    }

    const end = sdk.getState()!;
    rep.endTick = end.tick;
    rep.level = prayerOf(end).level;
    rep.xp = prayerOf(end).xp;
    rep.loads = rep.bankOpens.map(t => loadAt.get(t)).filter((n): n is number => n !== undefined);
    rep.cycleTicks = rep.bankOpens.slice(1).map((t, i) => t - rep.bankOpens[i]!);
    rep.fullCycles = rep.cycleTicks.filter((_, i) => loadAt.get(rep.bankOpens[i]!) === INVENTORY_SIZE);
    rep.ticksPerInventory = rep.fullCycles.length ? Math.round((rep.fullCycles.reduce((a, b) => a + b, 0) / rep.fullCycles.length) * 100) / 100 : null;
    return rep;
}

// ---------------------------------------------------------------- the probe and the step

/** The configured bones the bank holds, read by the boneBank probe. */
export interface BoneBankProbe {
    bones: number;
    byType: Record<string, number>;
}

/** Open the booth in sight (Use-quickly), count the bones, close: about 3 ticks. Null with no booth in sight. */
export function boneBankProbe(opts: PrayerOptions = {}): (session: RunnerSession) => Promise<BoneBankProbe | null> {
    return async session => {
        const sdk = session.sdk;
        const s = sdk.getState();
        const types = bonesFor(opts.take);
        if (!s || typeof types === 'string' || !boothLoc(s, opts.booth ?? VARROCK_WEST)) return null;
        const booth = boothFor(s, opts.booth ?? VARROCK_WEST);
        if (!s.bank.isOpen) void sdk.sendInteractLoc(booth.x, booth.z, booth.id, booth.option);
        const open = await waitUntil(sdk, st => st.bank.isOpen, { maxTicks: 6 });
        if (!open.ok) return null;
        const items = open.state.bank.items;
        const out = { bones: bonesIn(items, types), byType: Object.fromEntries(types.map(t => [t.name, bonesIn(items, [t])])) };
        void sdk.sendCloseModal();
        await waitUntil(sdk, st => !st.bank.isOpen, { maxTicks: 6 });
        return out;
    };
}

/** The probes this module's step reads (registered by run.ts). */
export const PROBES = { boneBank: boneBankProbe() } as const;

/** Bones banked as the observation shows them: the open bank, else the probe; null when unknown. */
export function bankedOf(o: Observed, types: readonly BoneType[]): number | null {
    if (o.state.bank?.isOpen) return bonesIn(o.state.bank.items, types);
    const p = o.probed.boneBank as BoneBankProbe | null | undefined;
    return p ? p.bones : null;
}

export function prayerStep(opts: PrayerOptions = {}): Step<any> {
    const until = untilLevelOf(opts);
    const typed = bonesFor(opts.take);
    const types = typeof typed === 'string' ? [] : typed;
    const done = (o: Observed) => reached(o.state, until) || (bonesHeld(o.state, types) === 0 && bankedOf(o, types) === 0);
    const entry = async (ctx: StepContext<any>) => {
        const r = await buryAtBooth(ctx.sdk, opts);
        logNote(ctx.log, ctx.session, 'S25b:booth', { ...r });
    };
    return {
        name: STEP_NAME,
        preconditions: s => preconditions(s, opts),
        run: entry,
        resume: entry,
        postconditions: s => {
            if (s.bank?.isOpen) return 'the bank is still open';
            const held = bonesHeld(s, types);
            if (held > 0) return `${held} bones left in the pack`;
            return true;
        },
        logoutSafe: true,
        probes: ['boneBank'],
        done,
        inProgress: o => !!o.state.player && !done(o) && (buryable(o.state, types).length > 0 || !!o.state.bank?.isOpen)
    };
}

/** The step-module convention (`skill`, `steps()`): one step, S25b's booth. */
export function steps(opts: PrayerOptions & { to?: number; [k: string]: unknown } = {}): Step<any>[] {
    const { to, ...rest } = opts;
    return [prayerStep({ ...rest, untilLevel: rest.untilLevel ?? to })];
}
