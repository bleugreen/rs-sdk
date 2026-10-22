// Live probe: mining coal at Barbarian Village and one capped sale into the coal bid on the
// Grand Exchange (docs/markets/probes.md).
//
//   bun markets/methods/probe-coal.ts <account> --minutes N [--out file.jsonl] [--sell 0] [--floor 80] [--fill-minutes 10]
//
// Start: any account, a fresh one included (it leaves Tutorial Island first).
//   1. Mining 1-15: speedrun/skills/mining.ts's own `mining.prep` and `mining.copper` steps
//      (Rimmington copper, technique 'plain'), driven standalone by drive-steps.ts. Those two steps
//      drop the starter junk and each copper ore, as they do in every rehearsal.
//   2. Mining 15-30: tin at Barbarian Village, beside the coal. mining.ts's own bands above 15
//      run the browser page's in-page `knife-mine` program, which the lite client does not have,
//      so this probe mines the tin with the same SDK loop it uses for coal, banking at Edgeville.
//   3. Coal for `--minutes` of wall clock on the four rocks at Barbarian Village (coalrock1 at
//      3087,3431 3087,3432 3089,3433 3089,3434; m48_53.jm2), banking at Edgeville when full.
//   4. With `--sell N` (at most SELL_CAP): to the Varrock west bank, the coal book read over the
//      public market API, and one sell offer of N at the best bid, only if that bid is at least
//      `--floor`. It waits up to `--fill-minutes` (at most 10) for the fill, cancels any remainder
//      and collects.
//
// It never trades or drops anything of its own beyond mining.ts's training drops, and sells
// nothing but that one capped offer.
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import type { GEOffer } from '../../sdk/ge-types';
import { MarketClient, type MarketQuote } from '../../sdk/market';
import { pointMarketAtServer } from '../../speedrun/helpers/mule';
import { nextTick, waitUntil } from '../../speedrun/lib/wait';
import { onTutorialIsland } from '../../speedrun/lib/world';
import { EMPTY_ROCKS, miningLevel, steps as miningSteps } from '../../speedrun/skills/mining';
import { tutorialSkip } from '../../speedrun/skills/start';
import { driveSteps, pickSteps } from './drive-steps';
import { cheb, coinsIn, commonOptions, here, numberFlag, runProbe, walk, type Args, type CommonOptions, type ProbeContext, type ProbeSpec, type Tile } from './probe-sampler';

/** obj.pack: 453=coal. */
export const COAL_ID = 453;
/** The most coal one probe run may sell (a hard cap, whatever --sell says). */
export const SELL_CAP = 5;
/** Upper bound of the fill wait, in minutes. */
export const FILL_MINUTES_CAP = 10;
/** The 5% seller fee the exchange burns (sdk/MARKET.md). */
export const SELLER_FEE = 0.05;
export const TRAIN_TO = 30;

/** coalrock1 (loc 2096) at Barbarian Village, m48_53.jm2. */
export const COAL_ROCKS: readonly Tile[] = [
    { x: 3087, z: 3431 },
    { x: 3087, z: 3432 },
    { x: 3089, z: 3433 },
    { x: 3089, z: 3434 },
];
/** tinrock1 (loc 2094) at Barbarian Village, m48_53.jm2. */
export const TIN_ROCKS: readonly Tile[] = [
    { x: 3086, z: 3416 },
    { x: 3086, z: 3417 },
    { x: 3087, z: 3418 },
    { x: 3088, z: 3417 },
    { x: 3086, z: 3425 },
];
/** speedrun/helpers/buyer.ts BANKS. */
export const EDGEVILLE_BANK: Tile = { x: 3093, z: 3491 };
export const VARROCK_WEST_BANK: Tile = { x: 3185, z: 3438 };

const COAL = /^coal$/i;
const ORE = /^(coal|tin ore|copper ore|iron ore|clay)$|^uncut /i;
const MINE = /^mine$/i;

export interface CoalOptions extends CommonOptions {
    sell: number;
    floor: number;
    fillMinutes: number;
}

export const COAL_USAGE = `usage: bun markets/methods/probe-coal.ts <account> --minutes N [--out file.jsonl] [--sell 0..${SELL_CAP}] [--floor 80] [--fill-minutes ${FILL_MINUTES_CAP}]`;

export function parseCoal(a: Args): CoalOptions {
    const common = commonOptions(a, ['sell', 'floor', 'fill-minutes']);
    const sell = numberFlag(a, 'sell', 0, { min: 0, integer: true });
    if (sell > SELL_CAP) throw new Error(`--sell ${sell} is over the hard cap of ${SELL_CAP}`);
    return {
        ...common,
        sell,
        floor: numberFlag(a, 'floor', 80, { min: 1, integer: true }),
        fillMinutes: numberFlag(a, 'fill-minutes', FILL_MINUTES_CAP, { min: 0.5, max: FILL_MINUTES_CAP }),
    };
}

/** Sell only into a bid at or above the floor. */
export function sellDecision(bid: number | null | undefined, floor: number): { sell: true } | { sell: false; reason: string } {
    if (bid === null || bid === undefined) return { sell: false, reason: 'no open bid for coal' };
    if (bid < floor) return { sell: false, reason: `best bid ${bid} gp is below the floor of ${floor} gp` };
    return { sell: true };
}

/**
 * What the seller receives for `quantity` filled at `price`: the gross less the burned fee, which
 * the engine rounds down, cumulatively per sell offer (`floor(gross / 20)`, MarketStore.ts).
 */
export function expectedProceeds(quantity: number, price: number): number {
    const gross = quantity * price;
    return gross - Math.floor(gross * SELLER_FEE);
}

/** The game HTTP origin behind the bot.env SERVER (the same rule as mule.ts pointMarketAtServer). */
export function marketOrigin(server: string | undefined): string {
    const host = (server ?? 'localhost').replace(/^wss?:\/\//, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return /^(localhost|127\.)/.test(host) ? `http://${host}` : `https://${host}`;
}

export function liveRock(s: BotWorldState, t: Tile): NearbyLoc | undefined {
    return s.nearbyLocs.find(l => l.x === t.x && l.z === t.z && !EMPTY_ROCKS.has(l.id) && l.optionsWithIndex.some(o => MINE.test(o.text)));
}

const miningXp = (s: BotWorldState) => s.skills.find(k => k.name === 'Mining')?.experience ?? 0;
const count = (s: BotWorldState, re: RegExp) => s.inventory.filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);

// ------------------------------------------------------------------ the probe

type Ctx = ProbeContext<CoalOptions>;

/** Counters for one mining activity (the tin training or the coal). */
export interface MineCounters {
    ores: number;
    clicks: number;
    /** A rock clicked by us went empty without an ore of ours: another player took it. */
    contested: number;
    /** Choices where the nearest rock of the cluster was already empty and another was taken. */
    nearestDepleted: number;
    /** Ticks with every rock of the cluster empty. */
    allDepletedTicks: number;
    bankTrips: number;
}

const newCounters = (): MineCounters => ({ ores: 0, clicks: 0, contested: 0, nearestDepleted: 0, allDepletedTicks: 0, bankTrips: 0 });

export class CoalProbe {
    private readonly t: Record<string, unknown>;

    constructor(private readonly ctx: Ctx) {
        this.t = ctx.totals;
    }

    private get s(): BotWorldState {
        const s = this.ctx.sdk.getState();
        if (!s?.player) throw new Error('no game state');
        return s;
    }

    private phase(p: string): void {
        this.ctx.sampler.phase = p;
    }

    private walk(to: Tile, tolerance = 2): Promise<void> {
        return walk(this.ctx.bot, this.ctx.sdk, to, { tolerance, signal: this.ctx.signal, tickMs: Number(process.env.NODE_TICKRATE) || 600 });
    }

    async run(): Promise<void> {
        const { ctx } = this;
        await ctx.sdk.waitForCondition(s => (s.player?.worldX ?? 0) > 0, 60_000);
        this.t.miningStart = miningLevel(this.s);
        await this.train();
        this.t.miningAtCoal = miningLevel(this.s);
        if (ctx.signal.aborted) return;
        if (ctx.options.minutes > 0) await this.mineCoal();
        if (ctx.signal.aborted) return;
        if (ctx.options.sell > 0) await this.sell();
    }

    // ------------------------------------------------------------ training

    private async train(): Promise<void> {
        const { ctx } = this;
        if (miningLevel(this.s) >= TRAIN_TO) return;
        this.phase('train-copper');
        const all = miningSteps({ to: 15, technique: 'plain', travel: 'none' });
        const list = [...(onTutorialIsland(this.s.player) ? [tutorialSkip] : []), ...pickSteps(all, ['mining.prep', 'mining.copper'])];
        const r = await driveSteps(ctx.session as never, list, { c: {}, signal: ctx.signal, onRow: row => ctx.event('step', { step: row.step, ticks: row.ticks, ok: row.ok, ...(row.error ? { error: row.error } : {}) }) });
        if (r.aborted || ctx.signal.aborted) return;
        const tin = newCounters();
        this.t.tin = tin;
        await this.mineUntil(TIN_ROCKS, /^tin ore$/i, tin, 'train', () => miningLevel(this.s) >= TRAIN_TO);
        ctx.event('trained', { mining: miningLevel(this.s), tinOres: tin.ores });
    }

    // ------------------------------------------------------------ coal

    private async mineCoal(): Promise<void> {
        const { ctx } = this;
        if (miningLevel(this.s) < TRAIN_TO) throw new Error(`Mining ${miningLevel(this.s)} is below coal's ${TRAIN_TO}`);
        const coal = newCounters();
        this.t.coal = coal;
        let until = 0;
        // the minutes run from the arrival at the rocks
        this.phase('coal-walk');
        await this.walk(COAL_ROCKS[0]!, 3);
        until = Date.now() + ctx.options.minutes * 60_000;
        const t0 = this.s.tick;
        ctx.event('at the coal', { minutes: ctx.options.minutes, mining: miningLevel(this.s) });
        await this.mineUntil(COAL_ROCKS, COAL, coal, 'coal', () => Date.now() >= until);
        this.t.coalTicks = this.s.tick - t0;
        this.t.coalCarried = count(this.s, COAL);
    }

    /**
     * Mine the cluster's live rocks, nearest first, until `done`: one click, then wait for the ore
     * (mining xp) or the rock going empty, as mining.ts's copper loop does. A full inventory goes
     * to the Edgeville bank and back. Phases: `<tag>` mining, `<tag>-walk`, `<tag>-bank`.
     */
    private async mineUntil(rocks: readonly Tile[], ore: RegExp, c: MineCounters, tag: string, done: () => boolean): Promise<void> {
        const { ctx } = this;
        const sdk = ctx.sdk;
        while (!ctx.signal.aborted && !done()) {
            let s = this.s;
            if (s.inventory.length >= 28) {
                await this.bankOres(tag, c);
                continue;
            }
            if (cheb(here(s), rocks[0]!) > 12) {
                this.phase(`${tag}-walk`);
                await this.walk(rocks[0]!, 3);
                continue;
            }
            this.phase(tag);
            if (s.dialog.isOpen) await sdk.sendClickDialog(0); // level-up pages
            const byDistance = [...rocks].sort((a, b) => cheb(here(s), a) - cheb(here(s), b));
            const live = byDistance.filter(t => liveRock(s, t));
            if (!live.length) {
                c.allDepletedTicks++;
                await nextTick(sdk, s.tick);
                continue;
            }
            if (live[0] !== byDistance[0]) c.nearestDepleted++;
            const rock = live[0]!;
            const loc = liveRock(s, rock)!;
            const xp0 = miningXp(s);
            const ores0 = count(s, ore);
            await sdk.sendInteractLoc(rock.x, rock.z, loc.id, loc.optionsWithIndex.find(o => MINE.test(o.text))!.opIndex);
            c.clicks++;
            const r = await waitUntil(sdk, st => miningXp(st) > xp0 || !liveRock(st, rock) || done(), { maxTicks: 60 });
            s = r.state ?? this.s;
            if (miningXp(s) > xp0 || count(s, ore) > ores0) {
                c.ores++;
                // the click on the tick after the success's p_delay(0) is refused (OpLocHandler)
                await nextTick(sdk, s.tick);
            } else if (!liveRock(s, rock)) c.contested++;
        }
    }

    private async bankOres(tag: string, c: MineCounters): Promise<void> {
        const { ctx } = this;
        this.phase(`${tag}-walk`);
        await this.walk(EDGEVILLE_BANK, 2);
        this.phase(`${tag}-bank`);
        await this.depositOres();
        c.bankTrips++;
    }

    /** At a bank: everything mined in, the pickaxe kept. */
    private async depositOres(): Promise<void> {
        const { ctx } = this;
        const opened = await ctx.bot.openBank();
        if (!opened.success) throw new Error(`openBank: ${opened.message}`);
        for (const name of [...new Set(this.s.inventory.filter(i => ORE.test(i.name)).map(i => i.name))]) await ctx.bot.depositItem(name, -1);
        this.t.coalInBank = ctx.sdk.getBankItems().find(i => COAL.test(i.name))?.count ?? 0;
        ctx.event('banked', { coalInBank: this.t.coalInBank, coinsInBank: ctx.sdk.getBankItems().find(i => /^coins$/i.test(i.name))?.count ?? 0 });
    }

    // ------------------------------------------------------------ the sale

    private async quote(): Promise<MarketQuote> {
        return new MarketClient(marketOrigin(this.ctx.session.env.SERVER)).item(COAL_ID);
    }

    private async sell(): Promise<void> {
        const { ctx } = this;
        const o = ctx.options;
        const sale: Record<string, unknown> = { item: COAL_ID, requested: o.sell, floor: o.floor };
        this.t.sell = sale;
        this.phase('sell-walk');
        await this.walk(VARROCK_WEST_BANK, 3);
        this.phase('sell');
        // the book first: no coal leaves the bank for a bid under the floor
        const q0 = await this.quote();
        sale.quoteBefore = { bid: q0.bid, ask: q0.ask, buyQuantity: q0.buyQuantity, at: new Date().toISOString() };
        const d0 = sellDecision(q0.bid, o.floor);
        if (!d0.sell) {
            sale.result = 'refused';
            sale.reason = d0.reason;
            ctx.event('sale refused', { reason: d0.reason });
            return;
        }
        // exactly N unnoted coal in the pack: everything mined into the bank, N back out
        await this.depositOres();
        // by the bank item itself: withdrawItem reads a bare number as a bank slot, not an obj id
        const stack = ctx.sdk.getBankItems().find(i => i.id === COAL_ID);
        const take = Math.min(o.sell, stack?.count ?? 0);
        if (stack && take > 0) {
            const w = await ctx.bot.withdrawItem(stack, take);
            if (!w.success) sale.withdraw = w.message;
            await waitUntil(ctx.sdk, s => count(s, COAL) >= take, { maxTicks: 5 });
        }
        await ctx.bot.closeBank();
        const quantity = Math.min(o.sell, count(this.s, COAL));
        sale.quantity = quantity;
        if (quantity <= 0) {
            sale.result = 'refused';
            sale.reason = 'no coal to sell';
            ctx.event('sale refused', { reason: sale.reason });
            return;
        }
        // read again: the bid may have moved during the bank visit
        const q = await this.quote();
        sale.quote = { bid: q.bid, ask: q.ask, buyQuantity: q.buyQuantity, at: new Date().toISOString() };
        const d = sellDecision(q.bid, o.floor);
        if (!d.sell) {
            sale.result = 'refused';
            sale.reason = d.reason;
            ctx.event('sale refused', { reason: d.reason });
            return;
        }
        const price = q.bid!;
        pointMarketAtServer(ctx.sdk, ctx.session.env.SERVER);
        const opened = await ctx.bot.openGE();
        if (!opened.success) throw new Error(`openGE: ${opened.message}`);
        const coins0 = coinsIn(this.s);
        const placed = await ctx.bot.placeGEOffer({ item: COAL_ID, side: 'sell', quantity, price });
        if (!placed.success || !placed.offer) {
            sale.result = placed.outcome === 'unknown' ? 'unknown' : 'not placed';
            sale.reason = `${placed.reason}: ${placed.message}`;
            ctx.event('sale not placed', { reason: sale.reason, outcome: placed.outcome ?? null });
            return;
        }
        const id = placed.offer.id;
        sale.price = price;
        sale.offerId = id;
        sale.placedAt = new Date().toISOString();
        sale.placedTick = this.s.tick;
        sale.expectedCoins = expectedProceeds(quantity, price);
        ctx.event('sell offer placed', { id, quantity, price, expected: sale.expectedCoins });

        const deadline = Date.now() + o.fillMinutes * 60_000;
        let offer: GEOffer | undefined = placed.offer;
        while (Date.now() < deadline && !ctx.signal.aborted) {
            const ge = ctx.sdk.getGEState();
            if (!ge) await ctx.bot.openGE();
            offer = ctx.sdk.getGEState()?.offers.find(x => x.id === id) ?? offer;
            if (offer && (offer.remaining === 0 || offer.state === 'completed')) break;
            await ctx.sdk.waitForTicks(2).catch(() => undefined);
        }
        sale.filled = offer?.filled ?? 0;
        if (offer && offer.remaining === 0) {
            sale.filledAt = new Date().toISOString();
            sale.filledTick = this.s.tick;
        } else sale.filledAt = 'unfilled';
        if (offer && offer.remaining > 0 && offer.state === 'open') {
            const c = await ctx.bot.cancelGEOffer(id);
            sale.cancelled = c.success ? offer.remaining : `failed: ${c.message}`;
        }
        const col = await ctx.bot.collectGEOffer(id);
        await waitUntil(ctx.sdk, s => coinsIn(s) > coins0 || (sale.filled as number) === 0, { maxTicks: 5 });
        sale.collect = { success: col.success, coins: col.coins ?? null, items: col.items ?? null, message: col.message };
        sale.coinsReceived = coinsIn(this.s) - coins0;
        sale.result = (sale.filled as number) === quantity ? 'filled' : (sale.filled as number) > 0 ? 'partial' : 'unfilled';
        ctx.event('sale', { result: sale.result, filled: sale.filled, coinsReceived: sale.coinsReceived, expected: sale.expectedCoins });
        await ctx.bot.closeInterface().catch(() => undefined);
    }
}

export const coalProbe: ProbeSpec<CoalOptions> = {
    name: 'probe-coal',
    usage: COAL_USAGE,
    parse: parseCoal,
    items: { coal: COAL, ore: /^(tin ore|copper ore)$/i },
    run: async ctx => new CoalProbe(ctx).run(),
};

if (import.meta.main) process.exit(await runProbe(coalProbe, process.argv.slice(2)));
