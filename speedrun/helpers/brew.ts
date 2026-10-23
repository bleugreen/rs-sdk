// brew (role): finish potions from the account's own bank until it holds a target count of each,
// working from the Falador west bank, then stop. For the run's finished potions (SUPPLIES.md:
// prayer, antipoison, the super set), brewed by a herb gatherer with the Herblore for them.
//
//   ROLE_OPTIONS='{"targets":[{"potion":"prayer","doses":4,"n":4},{"potion":"superattack","doses":3,"n":1}]}' \
//     bun speedrun/helpers/brew.ts <account>
//
// Brewing makes 3-dose potions only (brew_potion.struct); a (4) comes from decanting, which pours
// one potion into another of its kind: (3)+(3) gives (4)+(2) (decant_potion.rs2). So n (4)s cost
// ceil(4n/3) brews. Each cycle is chosen afresh from the bank and the inventory, so a restart
// resumes, and potions already held count toward the targets:
//   1. unicorn horns    for antipoisons, when horn dust is short: kill the unicorns west of
//                       Falador (4 spawns; every kill drops a horn, unicorn.rs2)
//   2. pestle and mortar from Jatix (Taverley) when none is owned
//   3. grind            pestle on each horn: unicorn horn dust
//   4. mix              clean herb on a vial of water, only when the unfinished potions are short
//   5. brew             secondary on unfinished potion, up to 14 a bank visit
//   6. decant           pour the two fullest partial potions together until the (4)s are made,
//                       keeping the (3)s a target asks for
// The unfinished potions are all named "Unfinished potion", so every item is chosen by id. Inputs
// the role cannot get itself (unfinished potions, snape grass, eyes of newt, limpwurt) must be in
// the bank; when they are short it stops with `attention` naming them. Brewing, grinding and
// decanting carry no delay in the engine, so the uses go out back to back.
import { TRADE_REQUEST_CHAT_TYPE, type BankItem, type InventoryItem } from '../../sdk/types';
import { receiveFrom } from '../lib/trade';
import { parseOptions as bonesOptions, Run } from './bones';
import { FALADOR_WEST_BANK, JATIX, UNF } from './herbs';
import { accountMatches, ChatCursor } from './mule';
import type { Role, RoleContext, RoleFinish } from './role';
import { runStandalone } from './role';

interface Tile { x: number; z: number }
const dist = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const exactName = (account: string) => new RegExp(`^${account}$`, 'i');

// Item ids (server/content/pack/obj.pack)
export const SNAPE_GRASS = 231;
export const EYE_OF_NEWT = 221;
export const LIMPWURT_ROOT = 225;
export const UNICORN_HORN = 237;
export const UNICORN_HORN_DUST = 235;
export const PESTLE_AND_MORTAR = 233;

/**
 * Herblore secondaries ground from a held item with the pestle and mortar (grind_ingredient.rs2),
 * by `grind` option name: S25e's dragon scale dust (weapon poison, antifire) and chocolate dust
 * (energy potion).
 */
export const GRINDS: Readonly<Record<string, { from: number; to: number }>> = {
    scales: { from: 243, to: 241 }, // blue dragon scale -> dragon scale dust
    chocolate: { from: 1973, to: 1975 } // chocolate bar -> chocolate dust
};
export const VIAL_OF_WATER = 227;
const EMPTY_VIAL = 229;

export interface PotionSpec {
    /** The herb whose unfinished potion it takes (a key of herbs.ts UNF). */
    herb: string;
    secondary: number;
    /** Herblore to brew it (brew_potion.struct). */
    level: number;
    /** Item ids by dose: [1, 2, 3, 4]. */
    ids: readonly [number, number, number, number];
}

export const POTIONS: Readonly<Record<string, PotionSpec>> = {
    prayer: { herb: 'ranarr', secondary: SNAPE_GRASS, level: 38, ids: [143, 141, 139, 2434] },
    antipoison: { herb: 'marrentill', secondary: UNICORN_HORN_DUST, level: 5, ids: [179, 177, 175, 2446] },
    superantipoison: { herb: 'irit', secondary: UNICORN_HORN_DUST, level: 48, ids: [185, 183, 181, 2448] },
    superattack: { herb: 'irit', secondary: EYE_OF_NEWT, level: 45, ids: [149, 147, 145, 2436] },
    superstrength: { herb: 'kwuarm', secondary: LIMPWURT_ROOT, level: 55, ids: [161, 159, 157, 2440] }
};

/**
 * The two unicorns south of Edgeville, spawns (3084,3454) and (3090,3450): ~41 path waypoints
 * from the Falador west bank. The four west of Falador (2838-2863, 3370-3378) are closer on the
 * map but off the walkable mainland: every path there ends at Taverley's south edge (2879,3393).
 */
export const UNICORN_FIELD = { x1: 3074, z1: 3440, x2: 3100, z2: 3464 };
const UNICORN_CENTRE: Tile = { x: 3087, z: 3452 };

/**
 * How many of a potion to hold: n (4)-dose, n (3)-dose. A (4) also serves where a (3) is asked.
 * `low` lists the (1)s and (2)s wanted, one entry per potion: no pour makes one (decant_potion.rs2
 * only combines), so they are drunk down from potions the (4)s and (3)s leave spare.
 */
export interface Want { four: number; three: number; low?: number[] }

export interface Target { potion: string; doses: 1 | 2 | 3 | 4; n: number }

export interface BrewOptions {
    targets: Target[];
    wants: Record<string, Want>;
    hornsPerTrip: number;
    /** An account that will trade the missing inputs (a `handover` donor); waited for at the bank once nothing else is left. */
    receiveFrom: string | null;
    receiveMinutes: number;
    /** GRINDS entries ground in full whatever the targets need; with them, `targets` may be empty. */
    grind: { from: number; to: number }[];
}

export function brewOptions(raw: Record<string, unknown>): BrewOptions {
    const names = raw.grind === undefined ? [] : raw.grind;
    if (!Array.isArray(names) || names.some(n => !GRINDS[String(n)])) throw new Error(`brew: options.grind must list ${Object.keys(GRINDS).join(', ')}`);
    const grind = names.map(n => GRINDS[String(n)]!);
    const list = raw.targets ?? (grind.length ? [] : undefined);
    if (!Array.isArray(list) || (list.length === 0 && grind.length === 0)) throw new Error('brew: options.targets is required (or grind)');
    const targets = list.map((t: Record<string, unknown>, i: number) => {
        const potion = String(t.potion ?? '');
        if (!POTIONS[potion]) throw new Error(`brew: targets[${i}].potion must be one of ${Object.keys(POTIONS).join(', ')} (got '${potion}')`);
        if (t.doses !== 1 && t.doses !== 2 && t.doses !== 3 && t.doses !== 4) throw new Error(`brew: targets[${i}].doses must be 1, 2, 3 or 4`);
        const n = Number(t.n);
        if (!Number.isInteger(n) || n < 1) throw new Error(`brew: targets[${i}].n must be a positive integer`);
        return { potion, doses: t.doses, n } as Target;
    });
    const wants: Record<string, Want> = {};
    for (const t of targets) {
        const w = (wants[t.potion] ??= { four: 0, three: 0 });
        if (t.doses === 4) w.four += t.n;
        else if (t.doses === 3) w.three += t.n;
        else (w.low ??= []).push(...Array<number>(t.n).fill(t.doses));
    }
    const hornsPerTrip = typeof raw.hornsPerTrip === 'number' ? raw.hornsPerTrip : 27;
    const receiveFrom = raw.receiveFrom === undefined ? null : String(raw.receiveFrom);
    if (receiveFrom !== null && !/^cairn_[a-z0-9_]{1,6}$/.test(receiveFrom)) throw new Error('brew: receiveFrom must be a cairn_ account');
    const receiveMinutes = typeof raw.receiveMinutes === 'number' ? raw.receiveMinutes : 45;
    return { targets, wants, hornsPerTrip, receiveFrom, receiveMinutes, grind };
}

/** The next pestle job: the horns the targets need first, then every held item of a `grind` entry. */
export function nextGrind(items: readonly { id: number; count: number }[], horns: number, grind: readonly { from: number; to: number }[]): { from: number; to: number; n: number } | null {
    if (horns > 0) return { from: UNICORN_HORN, to: UNICORN_HORN_DUST, n: horns };
    for (const g of grind) {
        const n = countOf(items, g.from);
        if (n > 0) return { ...g, n };
    }
    return null;
}

const countOf = (items: readonly { id: number; count: number }[], id: number) =>
    items.filter(i => i.id === id).reduce((a, i) => a + i.count, 0);

/** One entry per potion of this kind held, its dose count (bank stacks expand). */
export function dosesHeld(items: readonly { id: number; count: number }[], spec: PotionSpec): number[] {
    const out: number[] = [];
    spec.ids.forEach((id, k) => { for (let c = countOf(items, id); c > 0; c--) out.push(k + 1); });
    return out;
}

/**
 * Whether these potions can be decanted into the target: the (3)s it asks for kept as they
 * are (or covered by spare (4)s), and the (4)s from what is already 4 plus the other partial
 * doses poured together, 4 to a potion.
 */
export function feasible(held: readonly number[], w: Want): boolean {
    const fours = held.filter(d => d === 4).length;
    const threes = held.filter(d => d === 3).length;
    const kept = Math.min(w.three, threes);
    const pooled = held.filter(d => d < 4).reduce((a, d) => a + d, 0) - 3 * kept;
    return fours + Math.floor(pooled / 4) >= w.four + (w.three - kept);
}

/** Brews (each a new 3-dose potion) still needed for the target. */
export function brewsNeeded(held: readonly number[], w: Want): number {
    for (let k = 0; k < 200; k++) if (reachable([...held, ...Array(k).fill(3)], w)) return k;
    throw new Error('brew: target out of reach');
}

/** Whether decanting and then drinking down turn these potions into the target, (1)s and (2)s included. */
export function reachable(held: readonly number[], w: Want): boolean {
    if (!feasible(held, w)) return false;
    if (!w.low?.length) return true;
    const after = settled(held, w).map((doses, slot) => ({ slot, doses }));
    return assignLow(spares(after, w), w.low) !== null;
}

/** The doses held once the role's pours for the (4)s and (3)s are done, in the engine's model (decant_potion.rs2). */
export function settled(held: readonly number[], w: Want): number[] {
    const inv = held.map((doses, slot) => ({ slot, doses }));
    for (let i = 0; i < 60; i++) {
        const pour = nextPour(inv.filter(p => p.doses > 0), w);
        if (!pour) break;
        const a = inv[pour[0]]!, b = inv[pour[1]]!;
        const total = a.doses + b.doses;
        a.doses = Math.min(4, total);
        b.doses = total - a.doses;
    }
    return inv.map(p => p.doses).filter(d => d > 0);
}

/** The potions left once the (4)s and then the (3)s the target asks for are set aside (spare (4)s cover missing (3)s). */
export function spares<P extends { doses: number }>(potions: readonly P[], w: Want): P[] {
    const rest = [...potions];
    const takeOne = (d: number) => { const i = rest.findIndex(p => p.doses === d); if (i < 0) return false; rest.splice(i, 1); return true; };
    for (let k = 0; k < w.four; k++) takeOne(4);
    for (let k = 0; k < w.three; k++) if (!takeOne(3)) takeOne(4);
    return rest;
}

/**
 * Which spare serves each (1) or (2) the target asks for: the smallest spare that holds enough,
 * (2)s placed first. Null when the spares cannot cover them.
 */
export function assignLow<P extends { doses: number }>(spare: readonly P[], low: readonly number[]): { potion: P; doses: number }[] | null {
    const pool = [...spare].sort((a, b) => a.doses - b.doses);
    const out: { potion: P; doses: number }[] = [];
    for (const d of [...low].sort((a, b) => b - a)) {
        const i = pool.findIndex(p => p.doses >= d);
        if (i < 0) return null;
        out.push({ potion: pool[i]!, doses: d });
        pool.splice(i, 1);
    }
    return out;
}

/**
 * The next potion to drink a dose from, by slot: a spare assigned to a (1) or (2) that still holds
 * more. Null while the (4)s and (3)s are not yet poured (decant first), and once every low
 * target is met.
 */
export function nextDrink(potions: readonly { slot: number; doses: number }[], w: Want): number | null {
    if (!w.low?.length || !arranged(potions.map(p => p.doses), w)) return null;
    const a = assignLow(spares(potions, w), w.low);
    return a?.find(x => x.potion.doses > x.doses)?.potion.slot ?? null;
}

/** True when the potions already meet the target with no decanting. */
export function arranged(held: readonly number[], w: Want): boolean {
    const fours = held.filter(d => d === 4).length;
    const threes = held.filter(d => d === 3).length;
    return fours >= w.four && threes + (fours - w.four) >= w.three;
}

/**
 * The next pour, as [used slot, target slot]: the two fullest partial potions that are not
 * kept as a (3) for the target. Null once the target is met or no two partials are left.
 */
export function nextPour(potions: readonly { slot: number; doses: number }[], w: Want): [number, number] | null {
    if (arranged(potions.map(p => p.doses), w)) return null;
    const keep = new Set(potions.filter(p => p.doses === 3).slice(0, w.three).map(p => p.slot));
    const partials = potions.filter(p => p.doses < 4 && !keep.has(p.slot)).sort((a, b) => b.doses - a.doses || a.slot - b.slot);
    if (partials.length < 2) return null;
    return [partials[1]!.slot, partials[0]!.slot];
}

export interface Plan {
    /** Brews still needed per potion. */
    brews: Record<string, number>;
    /** Unfinished potions needed per herb, and how many of them must be mixed first. */
    unf: Record<string, { need: number; mix: number }>;
    /** Secondaries needed by id (unicorn horn dust counted as dust). */
    secondaries: Record<number, number>;
    /** Horns to grind (held) and horns still to gather. */
    grind: number;
    gather: number;
    /** Inputs the role cannot get itself, as readable lines. */
    short: string[];
    /** Potions those shortages block (the rest can still be brewed). */
    blocked: string[];
}

/** What is left to do, from everything the account holds (bank and inventory together). */
export function plan(items: readonly { id: number; count: number }[], wants: Readonly<Record<string, Want>>, herblore: number): Plan {
    const brews: Record<string, number> = {};
    const unf: Plan['unf'] = {};
    const secondaries: Record<number, number> = {};
    const short: string[] = [];
    const blocked = new Set<string>();
    const block = (line: string, potions: string[]) => { short.push(line); for (const p of potions) blocked.add(p); };
    const using = (pred: (s: PotionSpec) => boolean) => Object.keys(brews).filter(p => pred(POTIONS[p]!));
    for (const [potion, w] of Object.entries(wants)) {
        const spec = POTIONS[potion]!;
        const k = brewsNeeded(dosesHeld(items, spec), w);
        if (k === 0) continue;
        if (herblore < spec.level) block(`${potion}: Herblore ${spec.level} (have ${herblore})`, [potion]);
        brews[potion] = k;
        const u = (unf[spec.herb] ??= { need: 0, mix: 0 });
        u.need += k;
        secondaries[spec.secondary] = (secondaries[spec.secondary] ?? 0) + k;
    }
    let vials = countOf(items, VIAL_OF_WATER);
    for (const [herb, u] of Object.entries(unf)) {
        const ids = UNF[herb]!;
        const missing = Math.max(0, u.need - countOf(items, ids.unf));
        u.mix = Math.min(missing, countOf(items, ids.herb), vials);
        vials -= u.mix;
        if (u.mix < missing) block(`${herb} (unf): ${missing - u.mix} short`, using(s => s.herb === herb));
    }
    let grind = 0, gather = 0;
    for (const [id, need] of Object.entries(secondaries).map(([id, n]) => [Number(id), n] as const)) {
        const have = countOf(items, id);
        if (have >= need) continue;
        if (id === UNICORN_HORN_DUST) {
            grind = Math.min(need - have, countOf(items, UNICORN_HORN));
            gather = need - have - grind;
        } else block(`item ${id}: ${need - have} short`, using(s => s.secondary === id));
    }
    return { brews, unf, secondaries, grind, gather, short, blocked: [...blocked] };
}

class Brewer {
    bank: BankItem[] | null = null;
    private stalls = 0;
    private lastHoldings = '';
    private readonly requests: ChatCursor;

    constructor(readonly run: Run, readonly ctx: RoleContext, readonly opt: BrewOptions) {
        this.requests = new ChatCursor(ctx.sdk, [TRADE_REQUEST_CHAT_TYPE]);
    }

    inv(): InventoryItem[] { return this.run.state().inventory; }
    herblore(): number { return this.run.level('Herblore'); }
    holdings(): { id: number; count: number }[] {
        return [...(this.bank ?? []), ...this.inv()].map(i => ({ id: i.id, count: i.count }));
    }
    carried(id: number): InventoryItem[] { return this.inv().filter(i => i.id === id); }

    async toBank(): Promise<boolean> {
        if (!this.run.underground() && dist(this.run.pos(), FALADOR_WEST_BANK) <= 8) return true;
        this.run.phase('walk:bank');
        return this.run.walk(FALADOR_WEST_BANK.x, FALADOR_WEST_BANK.z, 3, 300_000);
    }

    /** Open the bank, put everything carried away, and note its contents. */
    async openAndEmpty(): Promise<boolean> {
        const bot = this.run.bot, sdk = this.run.sdk;
        const open = await bot.openBank();
        if (!open.success) { this.ctx.log('bank did not open', { reason: open.message }); return false; }
        for (const id of [...new Set(this.inv().map(i => i.id))]) {
            const it = this.inv().find(i => i.id === id);
            if (it) await bot.depositItem(it, -1);
        }
        await this.run.waitFor(s => s.inventory.length === 0, 4);
        this.noteBank();
        return true;
    }

    noteBank(): void {
        this.bank = this.run.sdk.getBankItems().map(i => ({ ...i }));
        this.ctx.reportBank({ items: this.bank.map(i => ({ id: i.id, name: i.name, count: i.count })) });
    }

    /** Withdraw `n` of an item by id (as items, not notes). Returns how many came out. */
    async take(id: number, n: number): Promise<number> {
        if (n <= 0) return 0;
        const b = this.run.sdk.getBankItems().find(i => i.id === id);
        if (!b) return 0;
        const before = countOf(this.inv(), id);
        await this.run.bot.withdrawItem(b, Math.min(n, b.count));
        await this.run.waitFor(s => countOf(s.inventory, id) > before, 4);
        return countOf(this.inv(), id) - before;
    }

    async closeBank(): Promise<void> {
        this.noteBank();
        await this.run.bot.closeBank();
        await this.run.waitFor(s => !s.interface?.isOpen, 4);
    }

    /** Use each carried `used` item on a carried `on` item, pairwise, and wait for them to go. */
    async usePairs(used: number, on: number, n: number): Promise<void> {
        const a = this.carried(used), b = this.carried(on);
        const k = Math.min(n, a.length, b.length);
        for (let i = 0; i < k; i++) await this.run.sdk.sendUseItemOnItem(a[i]!.slot, b[i]!.slot);
        const left = (s: { inventory: InventoryItem[] }) => countOf(s.inventory, used) <= a.length - k || countOf(s.inventory, on) <= b.length - k;
        await this.run.waitFor(left, 12);
        await this.run.bot.dismissBlockingUI();
    }

    async cycle(): Promise<RoleFinish | 'done' | null> {
        await this.run.bot.dismissBlockingUI();
        if (!(await this.toBank())) return null;
        if (!(await this.openAndEmpty())) return null;
        const full = plan(this.holdings(), this.opt.wants, this.herblore());
        // Work on what the stock allows; a shortage holds back only the potions that need it.
        const wants = Object.fromEntries(Object.entries(this.opt.wants).filter(([k]) => !full.blocked.includes(k)));
        const p = plan(this.holdings(), wants, this.herblore());
        const key = JSON.stringify(this.bank?.map(i => [i.id, i.count]));
        this.stalls = key === this.lastHoldings ? this.stalls + 1 : 0;
        this.lastHoldings = key;
        if (this.stalls >= 3) return { attention: `brew: no progress in 3 bank visits; plan ${JSON.stringify(p)}` };
        const bot = this.run.bot;

        // 1. Horns.
        if (p.gather > 0) {
            await this.closeBank();
            await this.gatherHorns(Math.min(p.gather, this.opt.hornsPerTrip));
            return null;
        }
        // 2-3. Pestle and mortar, then grind.
        const job = nextGrind(this.holdings(), p.grind, this.opt.grind);
        if (job) {
            if (countOf(this.bank ?? [], PESTLE_AND_MORTAR) === 0 && this.carried(PESTLE_AND_MORTAR).length === 0) {
                await this.closeBank();
                await this.buyPestle();
                return null;
            }
            await this.take(PESTLE_AND_MORTAR, 1);
            const n = await this.take(job.from, Math.min(job.n, 27));
            await this.closeBank();
            this.run.phase('grind');
            const pestle = this.carried(PESTLE_AND_MORTAR)[0];
            const held = this.carried(job.from);
            if (pestle) for (const h of held) await this.run.sdk.sendUseItemOnItem(pestle.slot, h.slot);
            await this.run.waitFor(s => countOf(s.inventory, job.from) === 0, 12);
            await bot.dismissBlockingUI();
            this.ctx.log('ground', { from: job.from, n, dust: countOf(this.inv(), job.to) });
            return null;
        }
        // 4. Unfinished potions short: mix them.
        const mix = Object.entries(p.unf).find(([, u]) => u.mix > 0);
        if (mix) {
            const [herb, u] = mix;
            const ids = UNF[herb]!;
            const n = Math.min(u.mix, 14);
            await this.take(ids.herb, n);
            await this.take(VIAL_OF_WATER, n);
            await this.closeBank();
            this.run.phase(`mix:${herb}`);
            await this.usePairs(ids.herb, VIAL_OF_WATER, n);
            this.ctx.log('mixed', { herb, made: countOf(this.inv(), ids.unf) });
            return null;
        }
        // 5. Brew.
        const brew = Object.entries(p.brews)[0];
        if (brew) {
            const [potion, k] = brew;
            const spec = POTIONS[potion]!;
            const unfId = UNF[spec.herb]!.unf;
            const n = Math.min(k, 14);
            await this.take(unfId, n);
            await this.take(spec.secondary, n);
            await this.closeBank();
            this.run.phase(`brew:${potion}`);
            await this.usePairs(spec.secondary, unfId, n);
            this.ctx.log('brewed', { potion, made: countOf(this.inv(), spec.ids[2]), herblore: this.herblore() });
            return null;
        }
        // 6. Decant.
        for (const [potion, w] of Object.entries(wants)) {
            const spec = POTIONS[potion]!;
            if (arranged(dosesHeld(this.holdings(), spec), w)) continue;
            for (const id of spec.ids) await this.take(id, 28 - this.inv().length);
            await this.closeBank();
            this.run.phase(`decant:${potion}`);
            await this.decantCarried(spec, w);
            this.ctx.log('decanted', { potion, held: dosesHeld(this.inv(), spec) });
            return null;
        }
        // 7. Drink spares down to the (1)s and (2)s.
        for (const [potion, w] of Object.entries(wants)) {
            const spec = POTIONS[potion]!;
            if (nextDrink(dosesHeld(this.holdings(), spec).map((doses, slot) => ({ slot, doses })), w) === null) continue;
            for (const id of spec.ids) await this.take(id, 28 - this.inv().length);
            await this.closeBank();
            this.run.phase(`drink:${potion}`);
            await this.drinkCarried(spec, w);
            this.ctx.log('drank down', { potion, held: dosesHeld(this.inv(), spec) });
            return null;
        }
        await this.closeBank();
        if (full.blocked.length === 0) return 'done';
        // 8. Everything the stock allows is made; the rest waits on inputs from a donor.
        this.ctx.log('short', { short: full.short, blocked: full.blocked, waitingFor: this.opt.receiveFrom });
        if (!this.opt.receiveFrom) return { attention: `brew: short of ${full.short.join('; ')}` };
        return (await this.receiveDonation(this.opt.receiveFrom)) ? null : { attention: `brew: no trade from ${this.opt.receiveFrom} in ${this.opt.receiveMinutes} min; short of ${full.short.join('; ')}` };
    }

    /** Stand at the bank accepting `from`'s trade (a `handover` donor). True once one came in. */
    async receiveDonation(from: string): Promise<boolean> {
        this.run.phase('wait-donor');
        const deadline = Date.now() + this.opt.receiveMinutes * 60_000;
        let lastLog = 0;
        while (!this.ctx.signal.aborted && Date.now() < deadline) {
            if (Date.now() - lastLog > 180_000) { this.ctx.log('waiting for donor', { from }); lastLog = Date.now(); }
            if (this.requests.next().some(m => accountMatches(m.sender, exactName(from)))) {
                const r = await receiveFrom(this.run.sdk, from, { openTimeoutMs: 20_000 });
                this.ctx.log('received', { from, ok: r.ok, reason: r.reason, received: r.received.map(i => `${i.name} x${i.count}`) });
                if (r.ok) return true;
            }
            await this.run.sdk.waitForTicks(3);
        }
        return false;
    }

    async decantCarried(spec: PotionSpec, w: Want): Promise<void> {
        const doses = (id: number) => spec.ids.indexOf(id) + 1;
        for (let pours = 0; pours < 40; pours++) {
            const potions = this.inv().filter(i => doses(i.id) > 0).map(i => ({ slot: i.slot, doses: doses(i.id) }));
            const pour = nextPour(potions, w);
            if (!pour) return;
            const before = JSON.stringify(potions);
            await this.run.sdk.sendUseItemOnItem(pour[0], pour[1]);
            const moved = await this.run.waitFor(s => JSON.stringify(s.inventory.filter(i => doses(i.id) > 0).map(i => ({ slot: i.slot, doses: doses(i.id) }))) !== before, 5);
            if (!moved) { this.ctx.log('decant: pour not seen', { pour }); return; }
        }
    }

    async drinkCarried(spec: PotionSpec, w: Want): Promise<void> {
        const doses = (id: number) => spec.ids.indexOf(id) + 1;
        const held = () => this.inv().filter(i => doses(i.id) > 0).map(i => ({ slot: i.slot, doses: doses(i.id) }));
        for (let sips = 0; sips < 40; sips++) {
            const slot = nextDrink(held(), w);
            if (slot === null) return;
            const item = this.inv().find(i => i.slot === slot)!;
            const op = item.optionsWithIndex.find(o => /^drink$/i.test(o.text))?.opIndex ?? 1;
            const before = JSON.stringify(held());
            await this.run.sdk.sendUseItem(slot, op);
            const drank = await this.run.waitFor(s => JSON.stringify(s.inventory.filter(i => doses(i.id) > 0).map(i => ({ slot: i.slot, doses: doses(i.id) }))) !== before, 5);
            if (!drank) { this.ctx.log('drink: dose not seen', { slot }); return; }
        }
    }

    async gatherHorns(n: number): Promise<void> {
        const run = this.run;
        run.phase('unicorns');
        const target = { npc: /^unicorn$/i, area: UNICORN_FIELD, centre: UNICORN_CENTRE, loot: /^unicorn horn$/i };
        if (!(await run.walk(UNICORN_CENTRE.x, UNICORN_CENTRE.z, 4, 300_000))) {
            this.ctx.log('unicorns: could not reach the field', { at: run.pos() });
            return;
        }
        const deadline = Date.now() + 15 * 60_000;
        while (!this.ctx.signal.aborted && Date.now() < deadline && this.carried(UNICORN_HORN).length < n && run.freeSlots() > 0) {
            const p = run.pos();
            if (p.x < UNICORN_FIELD.x1 || p.x > UNICORN_FIELD.x2 || p.z < UNICORN_FIELD.z1 || p.z > UNICORN_FIELD.z2) {
                if (!(await run.walk(UNICORN_CENTRE.x, UNICORN_CENTRE.z, 4, 120_000))) break;
            }
            await run.surfaceFight(target);
        }
        this.ctx.log('horns', { carried: this.carried(UNICORN_HORN).length, wanted: n, kills: run.kills });
    }

    async buyPestle(): Promise<void> {
        const run = this.run, bot = run.bot;
        run.phase('pestle');
        // Coins for it: the bank was just emptied into, so take some back out.
        const open = await bot.openBank();
        if (open.success) { await this.take(995, 200); await this.closeBank(); }
        if (!(await run.walk(JATIX.x, JATIX.z, 3, 300_000))) return;
        const shop = await bot.openShop(/^jatix$/i);
        if (!shop.success) { this.ctx.log('pestle: shop did not open', { reason: shop.message }); return; }
        const item = run.sdk.getState()?.shop?.shopItems.find(i => i.id === PESTLE_AND_MORTAR);
        if (!item || item.count === 0) this.ctx.log('pestle: none in stock');
        else {
            const r = await bot.buyFromShop(item, 1);
            this.ctx.log('pestle', { bought: r.amountBought ?? 0, message: r.message });
        }
        await bot.closeShop();
    }
}

export const role: Role = {
    name: 'brew',
    produces: [/^(prayer potion|antipoison|superantipoison|super attack|super strength)\(\d\)$/i, /^unicorn horn( dust)?$/i],
    async run(ctx: RoleContext): Promise<void | RoleFinish> {
        const opt = brewOptions(ctx.options);
        await ctx.sdk.waitForReady(60_000);
        // The bones engine walks and fights; it never banks here (food none, no spot work).
        const run = new Run(ctx, bonesOptions({ spot: 'chaos_druids_taverley', food: 'none', train: 1, loot: '^unicorn horn$' }));
        const brewer = new Brewer(run, ctx, opt);
        ctx.log('start', { targets: opt.targets, herblore: brewer.herblore(), at: run.pos() });
        run.guard.start();
        let errors = 0;
        try {
            while (!ctx.signal.aborted) {
                try {
                    const r = await brewer.cycle();
                    errors = 0;
                    if (r === 'done') {
                        const held = Object.fromEntries(Object.entries(POTIONS).map(([k, s]) => [k, dosesHeld(brewer.holdings(), s)]).filter(([, d]) => (d as number[]).length));
                        ctx.log('done', { held });
                        return;
                    }
                    if (r) { ctx.log('stopped', r as Record<string, unknown>); return r; }
                } catch (e) {
                    errors++;
                    ctx.log('cycle error', { error: String(e), errors });
                    if (errors >= 10) return { attention: `brew: ${errors} cycle errors in a row, last ${String(e)}` };
                    await new Promise(r => setTimeout(r, Math.min(30_000, 1000 * errors)));
                }
            }
        } finally {
            run.guard.stop();
        }
    }
};

if (import.meta.main) await runStandalone(role);
