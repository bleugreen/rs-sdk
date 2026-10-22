// enchant (role): cast the Enchant spells on the strung amulets in this account's bank, bank the
// products, then stop. The scored run's H7 (amulet of magic) and H22 (amulet of strength) are
// made this way from the jeweller's strung sapphire and ruby amulets (helpers/jeweller.md).
//
// Spells (server/content magic_spells.dbrow): Lvl-1 Enchant (Magic 7, 1 water + 1 cosmic) turns a
// strung sapphire amulet into an amulet of magic; Lvl-3 Enchant (Magic 49, 5 fire + 1 cosmic) turns
// a strung ruby amulet into an amulet of strength. A strung amulet has the same name as its
// unstrung one ("Sapphire amulet"), so everything here goes by obj id.
//
// The plan is read from the bank alone, so a rerun after a stop or a relog enchants whatever is
// still unenchanted and needs no role state. Nothing is withdrawn unless the bank holds every rune
// the whole plan casts with and the account has the Magic level for every spell in it. An
// elemental staff is not counted: the runes are withdrawn either way.
//
// Role options:
//   bank   { x, z } bank to work at (default: the nearest booth in reach of where it stands)
//   max    { sapphire?: n, ruby?: n } most of each amulet to enchant (default: every one banked)
import { withdrawMany, type WithdrawSpec } from '../lib/bank';
import { travelTo, type Tile } from '../lib/toll-gate';
import { closeBank, depositAllExcept, ensureOutOfTutorial, openBank } from './mule';
import { runStandalone, type Role, type RoleContext, type RoleFinish } from './role';

export type Amulet = 'sapphire' | 'ruby';

export const RUNES = { fire: 554, water: 555, cosmic: 564 } as const;
const RUNE_NAMES: Record<number, string> = { [RUNES.fire]: 'Fire rune', [RUNES.water]: 'Water rune', [RUNES.cosmic]: 'Cosmic rune' };

export interface AmuletEnchant {
    amulet: Amulet;
    /** The strung amulet's obj id. */
    from: number;
    product: number;
    productName: string;
    /** The SDK's enchant level (bot.enchantItem). */
    spell: 1 | 3;
    level: number;
    /** Rune obj id to count per cast. */
    runes: Record<number, number>;
}

export const AMULET_ENCHANTS: readonly AmuletEnchant[] = [
    { amulet: 'sapphire', from: 1694, product: 1727, productName: 'Amulet of magic', spell: 1, level: 7, runes: { [RUNES.water]: 1, [RUNES.cosmic]: 1 } },
    { amulet: 'ruby', from: 1698, product: 1725, productName: 'Amulet of strength', spell: 3, level: 49, runes: { [RUNES.fire]: 5, [RUNES.cosmic]: 1 } }
];

export interface EnchantOptions {
    bank?: Tile;
    max: Partial<Record<Amulet, number>>;
}

function tile(raw: unknown, where: string): Tile {
    const t = raw as Partial<Tile> | null;
    if (!t || typeof t !== 'object' || !Number.isInteger(t.x) || !Number.isInteger(t.z)) throw new Error(`enchant: ${where} must be { x, z } (got ${JSON.stringify(raw)})`);
    return { x: t.x!, z: t.z! };
}

export function enchantOptions(raw: Record<string, unknown>): EnchantOptions {
    for (const k of Object.keys(raw)) if (k !== 'bank' && k !== 'max') throw new Error(`enchant: unknown option '${k}'`);
    const max: Partial<Record<Amulet, number>> = {};
    if (raw.max !== undefined) {
        if (!raw.max || typeof raw.max !== 'object') throw new Error('enchant: max must be { sapphire?: n, ruby?: n }');
        for (const [k, v] of Object.entries(raw.max as Record<string, unknown>)) {
            if (!AMULET_ENCHANTS.some(e => e.amulet === k)) throw new Error(`enchant: max.${k}: not an amulet this role enchants (${AMULET_ENCHANTS.map(e => e.amulet).join(', ')})`);
            if (!Number.isInteger(v) || (v as number) < 0) throw new Error(`enchant: max.${k} must be a whole number >= 0 (got ${JSON.stringify(v)})`);
            max[k as Amulet] = v as number;
        }
    }
    return { ...(raw.bank !== undefined ? { bank: tile(raw.bank, 'bank') } : {}), max };
}

export interface EnchantPlan {
    /** One entry per cast, in AMULET_ENCHANTS order. */
    casts: AmuletEnchant[];
    /** Rune obj id to the count the casts use. */
    runes: Map<number, number>;
    /** Why nothing can be cast; when non-empty, `casts` is empty. */
    short: string[];
}

/**
 * What one bank visit withdraws and casts: every strung amulet banked (up to `max`), as many as fit
 * in `slots` beside one stack per rune, or nothing at all when a level or a rune is short.
 */
export function enchantPlan(bank: ReadonlyArray<{ id: number; count: number }>, magicLevel: number, max: Partial<Record<Amulet, number>> = {}, slots = 28): EnchantPlan {
    const held = (id: number) => bank.filter(i => i.id === id).reduce((a, i) => a + i.count, 0);
    const short: string[] = [];
    const wanted = AMULET_ENCHANTS.map(e => ({ e, n: Math.min(held(e.from), max[e.amulet] ?? Infinity) })).filter(w => w.n > 0);
    for (const { e, n } of wanted) {
        if (magicLevel < e.level) short.push(`Magic ${magicLevel} is below Lvl-${e.spell} Enchant's ${e.level} (${n} ${e.amulet} amulet${n === 1 ? '' : 's'})`);
    }
    const runeStacks = new Set(wanted.flatMap(w => Object.keys(w.e.runes).map(Number))).size;
    let room = Math.max(0, slots - runeStacks);
    const casts: AmuletEnchant[] = [];
    for (const { e, n } of wanted) {
        const k = Math.min(n, room);
        for (let i = 0; i < k; i++) casts.push(e);
        room -= k;
    }
    const runes = new Map<number, number>();
    for (const e of casts) for (const [id, n] of Object.entries(e.runes)) runes.set(Number(id), (runes.get(Number(id)) ?? 0) + n);
    for (const [id, n] of runes) if (held(id) < n) short.push(`${n} ${RUNE_NAMES[id] ?? `rune ${id}`} needed, ${held(id)} banked`);
    return short.length ? { casts: [], runes: new Map(), short } : { casts, runes, short };
}

/** The withdrawals for a plan: each amulet unnoted, each rune stack exactly. */
export function planWithdrawals(plan: EnchantPlan): WithdrawSpec[] {
    const amulets = new Map<number, number>();
    for (const e of plan.casts) amulets.set(e.from, (amulets.get(e.from) ?? 0) + 1);
    return [...[...amulets].map(([id, n]) => ({ item: id, n, asNote: false })), ...[...plan.runes].map(([id, n]) => ({ item: id, n }))];
}

function reportBank(ctx: RoleContext): void {
    ctx.reportBank({ items: ctx.sdk.getBankItems().map(i => ({ id: i.id, name: i.name, count: i.count })) });
}

/** One bank visit and its casts: the products made, or a finish when there is nothing (more) to do. */
async function round(ctx: RoleContext, o: EnchantOptions, made: Map<Amulet, number>): Promise<{ made: number } | { finish: RoleFinish }> {
    const { sdk, bot } = ctx;
    if (!(await openBank(ctx))) throw new Error('enchant: could not open the bank');
    if (!(await depositAllExcept(sdk))) throw new Error('enchant: could not empty the inventory into the bank');
    reportBank(ctx);
    const left = Object.fromEntries(Object.entries(o.max).map(([k, v]) => [k, Math.max(0, v - (made.get(k as Amulet) ?? 0))]));
    const plan = enchantPlan(sdk.getBankItems(), sdk.getSkill('Magic')?.baseLevel ?? 1, left);
    if (plan.short.length) {
        await closeBank(ctx);
        ctx.log('enchant: short; nothing withdrawn', { short: plan.short });
        return { finish: { attention: `enchant: ${plan.short.join('; ')}` } };
    }
    if (plan.casts.length === 0) {
        await closeBank(ctx);
        return { finish: {} };
    }
    const w = await withdrawMany(sdk, planWithdrawals(plan));
    if (!w.ok) {
        await depositAllExcept(sdk);
        await closeBank(ctx);
        throw new Error(`enchant: withdraw failed (${w.reason})`);
    }
    await closeBank(ctx);
    ctx.log('enchant: withdrawn', { casts: plan.casts.length, inventory: sdk.getInventory().map(i => `${i.name} x${i.count}`) });
    let n = 0;
    for (const e of plan.casts) {
        if (ctx.signal.aborted) break;
        const item = sdk.getInventory().find(i => i.id === e.from);
        if (!item) break;
        const r = await bot.enchantItem(item, e.spell, { timeout: 10_000 });
        const ok = r.success && r.product?.id === e.product;
        ctx.log('enchant: cast', { amulet: e.amulet, spell: `Lvl-${e.spell} Enchant`, ok, product: r.product?.name ?? null, xp: r.xpGained ?? 0, result: r.message });
        if (!ok) break;
        made.set(e.amulet, (made.get(e.amulet) ?? 0) + 1);
        n++;
    }
    return { made: n };
}

export const role: Role = {
    name: 'enchant',
    produces: AMULET_ENCHANTS.map(e => new RegExp(`^${e.productName}$`, 'i')),
    async run(ctx) {
        const o = enchantOptions(ctx.options);
        await ensureOutOfTutorial(ctx);
        await ctx.bot.dismissBlockingUI();
        if (o.bank) {
            const r = await travelTo(ctx.bot, ctx.sdk, o.bank, { tolerance: 3, log: ctx.log, signal: ctx.signal });
            if (!r.ok) throw new Error(`enchant: could not reach the bank at (${o.bank.x}, ${o.bank.z}): ${r.reason}`);
        }
        const made = new Map<Amulet, number>();
        // Each visit casts on everything withdrawn; one that makes nothing would only repeat itself.
        for (let visit = 1; !ctx.signal.aborted; visit++) {
            const r = await round(ctx, o, made);
            if ('finish' in r) {
                ctx.log('enchant: finished', { made: Object.fromEntries(made) });
                return r.finish;
            }
            if (r.made === 0) {
                if (await openBank(ctx)) {
                    await depositAllExcept(ctx.sdk);
                    reportBank(ctx);
                    await closeBank(ctx);
                }
                ctx.log('enchant: a visit enchanted nothing; stopping', { visit, made: Object.fromEntries(made) });
                return { attention: 'enchant: a cast failed; see the log' };
            }
        }
    }
};

if (import.meta.main) await runStandalone(role);
