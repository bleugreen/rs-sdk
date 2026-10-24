// smith-give (role): smith a list of anvil pieces from this account's own bars at the Varrock west
// anvil, then hand one of each piece to every receiver by trade (handover.ts), and finish.
//
// Every count is by obj id over the bank and the inventory together, so the role can be restarted
// from anywhere: pieces already held count towards the receivers' sets, and only the rest are
// smithed. Once the bank holds a full set per receiver, that is recorded in the account's role
// state and a later run goes straight to the trades, whose own records (handover.ts runHandovers)
// keep a delivered or uncertain trade from ever being repeated.
//
// It refuses, before anything is smithed or given, when the Smithing level is below the highest
// piece still to make, when the bars are fewer than those pieces need, or when it holds no hammer
// and no coins to buy one. With coins and no hammer it buys one at the Varrock general store.
// A refusal ends the role with an `attention` for the supervisor; a failed walk, bank or smith
// throws, so the role is restarted and re-plans from what is held.
//
// Role options:
//   receivers  ['cairn_h51', 'cairn_h52']: each gets one of every piece, in this order
//   pieces     keys of PIECES (default ADAMANT_MELEE: scimitar, full helm, platebody, platelegs)
//   id         names this job in the role state (default: a digest of receivers and pieces)
//   meet       { x, z } where to trade (default: at Varrock west bank)
import { createHash } from 'node:crypto';
import { withdrawMany, type WithdrawSpec } from '../lib/bank';
import { travelTo, type Tile } from '../lib/toll-gate';
import { BARS, SCORED_TILE, smithingLevel, smithSegment, type Bar, type Product, type Segment } from '../skills/smithing';
import { BANKS, SHOPS } from './buyer';
import { ACCOUNT_NAME_RE, FORBIDDEN_ACCOUNTS } from './fleet-config';
import { bankRefusal, finishOf, runHandovers, type Handover } from './handover';
import { closeBank, depositAllExcept, ensureOutOfTutorial, openBank } from './mule';
import { runStandalone, type Role, type RoleContext } from './role';

/** An anvil piece: smithing.ts's Product (level, bars, interface column and slot) and its obj id. */
export type Piece = Product & { obj: number };

/** smithing.dbrow (level, bars), smithing.inv (column, slot), obj.pack (obj); smith-give.test.ts checks them. */
export const PIECES: Readonly<Record<string, Piece>> = {
    adamant_scimitar: { id: 'adamant_scimitar', name: 'Adamant scimitar', obj: 1331, level: 75, bar: 'adamantite_bar', bars: 2, com: 1119, slot: 2 },
    adamant_full_helm: { id: 'adamant_full_helm', name: 'Adamant full helm', obj: 1161, level: 77, bar: 'adamantite_bar', bars: 2, com: 1122, slot: 1 },
    adamant_platebody: { id: 'adamant_platebody', name: 'Adamant platebody', obj: 1123, level: 88, bar: 'adamantite_bar', bars: 5, com: 1121, slot: 3 },
    adamant_platelegs: { id: 'adamant_platelegs', name: 'Adamant platelegs', obj: 1073, level: 86, bar: 'adamantite_bar', bars: 3, com: 1121, slot: 1 }
};

export const ADAMANT_MELEE: readonly string[] = ['adamant_scimitar', 'adamant_full_helm', 'adamant_platebody', 'adamant_platelegs'];

/** Obj ids of the bars PIECES use. */
export const BAR_OBJ: Readonly<Partial<Record<Bar, number>>> = { adamantite_bar: 2361 };
export const HAMMER_OBJ = 2347;
export const COINS_OBJ = 995;
/** Coins taken to the general store for a hammer (its base price is 1). */
export const HAMMER_COINS = 20;
/** Bars per trip to the anvil: 28 slots less the hammer. */
export const INVENTORY_BARS = 27;

export interface SmithGiveOptions {
    id: string;
    receivers: string[];
    pieces: Piece[];
    meet?: Tile;
}

export function smithGiveOptions(raw: Record<string, unknown>): SmithGiveOptions {
    const r = raw.receivers;
    if (!Array.isArray(r) || r.length === 0) throw new Error('smith-give: options.receivers must be a non-empty list of cairn_ accounts');
    const receivers = r.map((to, i) => {
        if (typeof to !== 'string' || !ACCOUNT_NAME_RE.test(to) || FORBIDDEN_ACCOUNTS.has(to)) throw new Error(`smith-give: receivers[${i}] ${JSON.stringify(to)} is not a cairn_ helper`);
        return to;
    });
    if (new Set(receivers).size !== receivers.length) throw new Error('smith-give: a receiver is listed twice');
    const names = raw.pieces === undefined ? ADAMANT_MELEE : raw.pieces;
    if (!Array.isArray(names) || names.length === 0) throw new Error('smith-give: options.pieces must be a non-empty list');
    const pieces = names.map(n => {
        const p = typeof n === 'string' ? PIECES[n] : undefined;
        if (!p) throw new Error(`smith-give: unknown piece ${JSON.stringify(n)} (known: ${Object.keys(PIECES).join(', ')})`);
        return p;
    });
    if (new Set(pieces).size !== pieces.length) throw new Error('smith-give: a piece is listed twice');
    let meet: Tile | undefined;
    if (raw.meet !== undefined) {
        const m = raw.meet as Record<string, unknown> | null;
        if (!m || !Number.isInteger(m.x) || !Number.isInteger(m.z)) throw new Error('smith-give: options.meet must be { x, z }');
        meet = { x: m.x as number, z: m.z as number };
    }
    if (raw.id !== undefined && (typeof raw.id !== 'string' || !/^[\w.-]{1,48}$/.test(raw.id))) throw new Error('smith-give: options.id must be 1-48 letters, digits, _ . or -');
    const id = typeof raw.id === 'string' ? raw.id : `smith-give-${createHash('sha256').update(JSON.stringify([receivers, pieces.map(p => p.id)])).digest('hex').slice(0, 12)}`;
    return { id, receivers, pieces, ...(meet ? { meet } : {}) };
}

export interface SmithPlan {
    /** Pieces to smith, in `pieces` order: one per receiver, less what is already held. */
    make: Segment[];
    /** Bars those pieces need. */
    bars: Partial<Record<Bar, number>>;
    /** No hammer is held: one is bought first. */
    buyHammer: boolean;
}

const count = (held: ReadonlyMap<number, number>, obj: number | undefined) => (obj === undefined ? 0 : held.get(obj) ?? 0);

/**
 * What to smith for `o`, given everything held by obj id (bank and inventory) and the Smithing
 * level, or every reason it cannot be done.
 */
export function smithPlan(o: Pick<SmithGiveOptions, 'receivers' | 'pieces'>, held: ReadonlyMap<number, number>, level: number): { ok: true; plan: SmithPlan } | { ok: false; reason: string } {
    const make: Segment[] = [];
    const bars: Partial<Record<Bar, number>> = {};
    for (const p of o.pieces) {
        const n = Math.max(0, o.receivers.length - count(held, p.obj));
        if (n === 0) continue;
        make.push({ product: p, count: n });
        bars[p.bar] = (bars[p.bar] ?? 0) + n * p.bars;
    }
    const buyHammer = make.length > 0 && count(held, HAMMER_OBJ) === 0;
    const reasons: string[] = [];
    for (const { product } of make) if (level < product.level) reasons.push(`Smithing ${level}: ${product.name} needs ${product.level}`);
    for (const [bar, need] of Object.entries(bars) as [Bar, number][]) {
        const have = count(held, BAR_OBJ[bar]);
        if (have < need) reasons.push(`${BARS[bar].name} ${have}/${need}`);
    }
    if (buyHammer && count(held, COINS_OBJ) === 0) reasons.push('no hammer, and no coins to buy one');
    return reasons.length ? { ok: false, reason: reasons.join('; ') } : { ok: true, plan: { make, bars, buyHammer } };
}

/** The trades: one of every piece to each receiver, by obj id. */
export function setHandovers(o: Pick<SmithGiveOptions, 'receivers' | 'pieces'>): Handover[] {
    return o.receivers.map(to => ({ to, items: o.pieces.map(p => ({ id: p.obj, n: 1 })) }));
}

/** Split the pieces into trips to the anvil of at most `cap` bars each, in order. */
export function batches(make: readonly Segment[], cap = INVENTORY_BARS): Segment[][] {
    const out: Segment[][] = [];
    let cur: Segment[] = [];
    let used = 0;
    for (const seg of make) {
        if (seg.product.bars > cap) throw new Error(`${seg.product.name} needs ${seg.product.bars} bars, more than a trip's ${cap}`);
        for (let i = 0; i < seg.count; i++) {
            if (used + seg.product.bars > cap) {
                out.push(cur);
                cur = [];
                used = 0;
            }
            const last = cur[cur.length - 1];
            if (last && last.product === seg.product) last.count++;
            else cur.push({ product: seg.product, count: 1 });
            used += seg.product.bars;
        }
    }
    if (cur.length) out.push(cur);
    return out;
}

/** A trip's bars by bar. */
export function barsOf(batch: readonly Segment[]): Partial<Record<Bar, number>> {
    const out: Partial<Record<Bar, number>> = {};
    for (const s of batch) out[s.product.bar] = (out[s.product.bar] ?? 0) + s.count * s.product.bars;
    return out;
}

/** Pieces the bank and inventory hold fewer of than there are receivers, as "name have/want". */
export function shortPieces(o: Pick<SmithGiveOptions, 'receivers' | 'pieces'>, held: ReadonlyMap<number, number>): string[] {
    return o.pieces.filter(p => count(held, p.obj) < o.receivers.length).map(p => `${p.name} ${count(held, p.obj)}/${o.receivers.length}`);
}

function heldCounts(ctx: RoleContext): Map<number, number> {
    const m = new Map<number, number>();
    for (const i of [...ctx.sdk.getBankItems(), ...ctx.sdk.getInventory()]) m.set(i.id, (m.get(i.id) ?? 0) + i.count);
    return m;
}

function reportBank(ctx: RoleContext): void {
    ctx.reportBank({ items: ctx.sdk.getBankItems().map(i => ({ id: i.id, name: i.name, count: i.count })) });
}

async function go(ctx: RoleContext, to: Tile, what: string, tolerance: number): Promise<void> {
    const r = await travelTo(ctx.bot, ctx.sdk, to, { tolerance, log: ctx.log, signal: ctx.signal });
    if (!r.ok) throw new Error(`smith-give: could not reach ${what}: ${r.reason}`);
}

async function atBank(ctx: RoleContext): Promise<void> {
    await go(ctx, BANKS.varrockWest, 'Varrock west bank', 3);
    if (!(await openBank(ctx))) throw new Error('smith-give: could not open the Varrock west bank');
}

async function withdraw(ctx: RoleContext, specs: WithdrawSpec[]): Promise<void> {
    const refused = bankRefusal(specs, ctx.sdk.getBankItems());
    if (refused) throw new Error(`smith-give: ${refused.reason}`);
    const w = await withdrawMany(ctx.sdk, specs);
    if (!w.ok) throw new Error(`smith-give: withdraw ${w.reason ?? 'failed'}`);
}

async function buyHammer(ctx: RoleContext, coins: number): Promise<void> {
    await withdraw(ctx, [{ item: COINS_OBJ, n: Math.min(coins, HAMMER_COINS), asNote: false }]);
    await closeBank(ctx);
    const shop = SHOPS.varrockGeneral!;
    await go(ctx, { x: shop.stand.x, z: shop.stand.z }, 'the Varrock general store', 2);
    const opened = await ctx.bot.openShop(shop.npc);
    if (!opened.success) throw new Error(`smith-give: open the general store: ${opened.message}`);
    const bought = await ctx.bot.buyFromShop(/^hammer$/i, 1);
    await ctx.bot.closeShop();
    if (!bought.success) throw new Error(`smith-give: buy a hammer: ${bought.message}`);
    ctx.log('smith-give: bought a hammer');
    await atBank(ctx);
    await depositAllExcept(ctx.sdk, new Map([[HAMMER_OBJ, 1]]));
}

/** Smith whatever the receivers' sets still lack into the bank. Returns a refusal, or null when the bank holds every set. */
export async function smithSets(ctx: RoleContext, o: SmithGiveOptions): Promise<string | null> {
    await atBank(ctx);
    await depositAllExcept(ctx.sdk);
    reportBank(ctx);
    const held = heldCounts(ctx);
    const level = smithingLevel(ctx.sdk.getState()!);
    const r = smithPlan(o, held, level);
    if (!r.ok) {
        await closeBank(ctx);
        return r.reason;
    }
    const { plan } = r;
    ctx.log('smith-give: plan', { level, make: plan.make.map(s => `${s.product.name} x${s.count}`), bars: plan.bars, buyHammer: plan.buyHammer, held: Object.fromEntries(o.pieces.map(p => [p.name, count(held, p.obj)])) });
    if (plan.buyHammer) await buyHammer(ctx, count(held, COINS_OBJ));
    for (const batch of batches(plan.make)) {
        if (ctx.signal.aborted) throw new Error('smith-give: stopped');
        const specs: WithdrawSpec[] = Object.entries(barsOf(batch)).map(([bar, n]) => ({ item: BAR_OBJ[bar as Bar]!, n: n!, asNote: false }));
        if (!ctx.sdk.getInventory().some(i => i.id === HAMMER_OBJ)) specs.unshift({ item: HAMMER_OBJ, n: 1, asNote: false });
        await withdraw(ctx, specs);
        await closeBank(ctx);
        await go(ctx, SCORED_TILE, 'the Varrock west anvil', 1);
        for (const seg of batch) {
            if (ctx.signal.aborted) throw new Error('smith-give: stopped');
            const made = await smithSegment(ctx.sdk, seg, false);
            ctx.log('smith-give: smithed', { piece: seg.product.name, n: seg.count, firstClick: made.firstClick, lastXp: made.lastXp, resends: made.resends });
        }
        await atBank(ctx);
        await depositAllExcept(ctx.sdk, new Map([[HAMMER_OBJ, 1]]));
    }
    await depositAllExcept(ctx.sdk);
    reportBank(ctx);
    const after = heldCounts(ctx);
    await closeBank(ctx);
    const short = shortPieces(o, after);
    if (short.length) throw new Error(`smith-give: after smithing the bank holds ${short.join(', ')}`);
    ctx.log('smith-give: every set is in the bank', { pieces: Object.fromEntries(o.pieces.map(p => [`${p.name} (obj ${p.obj})`, count(after, p.obj)])) });
    return null;
}

export const role: Role = {
    name: 'smith-give',
    produces: [],
    async run(ctx) {
        const o = smithGiveOptions(ctx.options);
        await ensureOutOfTutorial(ctx);
        await ctx.bot.dismissBlockingUI();
        const smithed = `smith-give/${o.id}/smithed`;
        if (ctx.state.get(smithed) === undefined) {
            const refused = await smithSets(ctx, o);
            if (refused) {
                ctx.log(`smith-give: REFUSED, nothing smithed or given: ${refused}`);
                return { attention: `smith-give refused: ${refused}` };
            }
            await ctx.state.set(smithed, { at: new Date().toISOString() });
        } else {
            ctx.log('smith-give: the sets were smithed by an earlier run; going to the trades', { since: ctx.state.get(smithed) });
        }
        const report = await runHandovers(ctx, { id: o.id, bank: BANKS.varrockWest, ...(o.meet ? { meet: o.meet } : {}), handovers: setHandovers(o) });
        return finishOf(report);
    }
};

if (import.meta.main) await runStandalone(role);
