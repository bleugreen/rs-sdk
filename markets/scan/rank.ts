// Assembles the candidate wealth methods from content, recipes and one GE book snapshot, in two
// units per login-hour: board value (store cost, if the output is banked) and coins (selling the
// output where the market pays most). Coins count 1:1 on the board, so a method's board rate is
// the larger of the two. Every row says how it scales (with logins, a shared world clock, GE bid
// depth or GE weekly flow), what caps it, what it shares with the speedrun, and whether its rate
// is measured or estimated.
import type { Content, MineRow } from './content.ts';
import type { BookRow } from './ge-book.ts';
import { GE_SELLER_FEE, buyFromShop, shopLines, ticksPerHour, thievingLines, type ShopLine } from './methods.ts';
import { statChance } from './recipes.ts';

export type Scaling = 'logins' | 'world clock' | 'GE bid depth' | 'GE weekly flow';
export type Basis = 'measured' | 'estimated';

export interface Candidate {
    id: string;
    method: string;
    kind: 'thieving' | 'mining' | 'woodcutting' | 'fishing' | 'smelting' | 'shop' | 'shop to GE' | 'processing';
    inputs: string;
    /** Board value per login-hour if the output is banked at store cost. */
    boardPerHour: number;
    /** Coins per login-hour selling the output where `sellTo` says. */
    coinsPerHour: number;
    sellTo: string;
    scaling: Scaling;
    /** Units an hour the shared constraint allows across every login (null: none known). */
    worldUnitsPerHour: number | null;
    /** Units the market will take before the price moves (bid depth, or a week's traded volume). */
    marketUnits: number | null;
    cap: string;
    conflict: string;
    basis: Basis;
    notes: string;
}

/** How the market pays for one unit of an item: a standing bid or the week's traded flow, whichever pays more. */
export interface MarketPrice {
    net: number;
    how: 'bid' | 'flow' | 'none';
    /** Bid depth, or the units traded in 7 days. */
    units: number;
    /** False when open bids average below the best, so how much the best bid takes is unknown. */
    depthAtBest: boolean;
}

/** Fewer units than this, bid or traded in a week, is too thin to price a method on. */
export const MIN_MARKET_UNITS = 100;

export function marketPrice(row: BookRow | undefined): MarketPrice {
    const none: MarketPrice = { net: 0, how: 'none', units: 0, depthAtBest: false };
    if (!row) return none;
    const options: MarketPrice[] = [];
    if (row.bid !== null && row.buyQuantity >= MIN_MARKET_UNITS) {
        const full = row.buyValue / row.buyQuantity >= row.bid * 0.95;
        // A bid whose mean sits below the best: the week's volume is the evidence of what clears.
        options.push({ net: Math.floor(row.bid * (1 - GE_SELLER_FEE)), how: 'bid', units: full ? row.buyQuantity : row.volume, depthAtBest: full });
    }
    if (row.volume >= MIN_MARKET_UNITS && row.vwap !== null && row.ask !== null) {
        // Selling into the flow means listing at or under the best ask: the lower of it and the week's mean.
        options.push({ net: Math.floor(Math.min(row.vwap, row.ask) * (1 - GE_SELLER_FEE)), how: 'flow', units: row.volume, depthAtBest: true });
    }
    return options.sort((a, b) => b.net - a.net)[0] ?? none;
}

export interface RankOptions {
    tickMs: number;
    /** Ticks per mining roll with a rune pickaxe (mining.md: 3.00 per iron ore on the demo, measured). */
    rollTicks: number;
    /** Ticks a 27-item bank trip adds (estimated; mining and woodcutting sites are 20-60 tiles from a bank). */
    bankTicks: number;
    /** Measured / modelled pickpocket rate for guards: 7.4 gp a tick (coins.md) over the model's 11.44. */
    thievingCalibration: number;
    /** Ticks per rune essence including the Aubury teleport and bank (coins.md: 80-95k gp an account-hour at 300 ms and 79 gp net, about 11). */
    essenceTicks: number;
    /** Players online, which shortens rock respawns (the demo showed 1,355 at 22:4xZ 2026-10-22). */
    players: number;
}

export const DEFAULT_RANK: RankOptions = { tickMs: 400, rollTicks: 3, bankTicks: 40, thievingCalibration: 7.4 / 11.44, essenceTicks: 11, players: 1400 };

/** player_count.rs2 scale_by_playercount: a rock's respawn at `players` online (capped at 2,000). */
export function respawnAt(base: number, players: number): number {
    return Math.trunc((base * (4000 - Math.min(players, 2000))) / 4000);
}

// What docs/speedrun/SUPPLIES.md and the fleet already take, by item or place.
const CONFLICTS: Record<string, string> = {
    blankrune: 'low: S06/S21 essence (5,427) is staged, fleet ledger 63,674 complete',
    iron_ore: 'low: the Superheat fallback buys ~500 on its own bid',
    coal: 'none known',
    uncut_gems: 'medium: S25c crafts 107 staged gems; the fleet gem supplier buys gems',
    yew_logs: 'low: S03 drops 24 yew and 107 magic logs (woodcutter role)',
    magic_logs: 'low: S03 drops 107 magic logs (woodcutter role)',
    shark: 'medium: the fleet buys sharks on the GE (H12, H22, H23)',
    runite_bar: 'none known',
    adamantite_ore: 'none known',
    steel_bar: 'none known (check: cannonballs for S27 are 1,200 an attempt)',
    knights: 'high: S18 pickpockets the East Ardougne knights on run day; the coins earners use guards',
    bloodrune: 'high: the fleet camps the Magic Guild blood shelf (h88) for S16/S18',
    lawrune: 'medium: the fleet buys ~55 law runes at rune shops',
    naturerune: 'medium: S18 Superheat holds 518 nature runes',
    deathrune: 'low: 110 death runes banked',
    battlestaff: 'low: the run uses staves of fire and water, not battlestaves',
};

/** A login mines one site; the world's rocks cap every login together. */
export function mineRates(m: MineRow, o: RankOptions) {
    const tph = ticksPerHour(o.tickMs);
    const p = statChance(m.chance[0], m.chance[1], 99);
    const ticksPerUnit = o.rollTicks / Math.max(p, 1e-9);
    const free = m.output === 'blankrune' ? tph / o.essenceTicks : tph / (ticksPerUnit + o.bankTicks / 27);
    const bestSite = Math.max(0, ...Object.values(m.sites));
    const respawn = respawnAt(m.respawn, o.players);
    const world = respawn > 0 ? (m.count * tph) / (respawn + ticksPerUnit) : null;
    const site = respawn > 0 ? (bestSite * tph) / (respawn + ticksPerUnit) : null;
    return { p, ticksPerUnit, bestSite, respawn, perLogin: site === null ? free : Math.min(free, site), world };
}

/** Units an hour one login can sell: flow markets take at most a week's volume spread over 168 hours. */
function sellable(perLogin: number, m: MarketPrice): number {
    return m.how === 'flow' ? Math.min(perLogin, m.units / 168) : perLogin;
}

export function rankCandidates(c: Content, rows: BookRow[], o: RankOptions = DEFAULT_RANK): Candidate[] {
    const tph = ticksPerHour(o.tickMs);
    const idOf = new Map<string, number>();
    for (const ob of c.objs.values()) if (ob.id !== null) idOf.set(ob.name, ob.id);
    const book = new Map(rows.map(r => [r.id, r]));
    const market = (obj: string) => marketPrice(book.get(idOf.get(obj) ?? -1));
    const cost = (obj: string) => c.objs.get(obj)?.cost ?? 0;
    const out: Candidate[] = [];
    const sellLabel = (m: MarketPrice) => m.how === 'bid' ? `GE bid, ${m.net} net${m.depthAtBest ? '' : ' (depth at the best bid unverified)'}` : m.how === 'flow' ? `GE flow, ${m.net} net` : 'bank (no market)';
    const scalingOf = (m: MarketPrice, world: number | null): Scaling => world !== null ? 'world clock' : m.how === 'bid' ? 'GE bid depth' : m.how === 'flow' ? 'GE weekly flow' : 'logins';

    // Mining, sold raw.
    for (const m of c.mines) {
        if (!m.output || m.count === 0 || cost(m.output) < 10 && m.output !== 'blankrune') continue;
        const r = mineRates(m, o);
        const price = market(m.output);
        out.push({
            id: `mine:${m.output}`, method: `Mine ${(c.objs.get(m.output)?.display ?? m.output).toLowerCase()}${price.how === 'none' ? ', bank' : ', sell'}`, kind: 'mining',
            inputs: `Mining ${m.level}, pickaxe`,
            boardPerHour: r.perLogin * cost(m.output), coinsPerHour: sellable(r.perLogin, price) * price.net, sellTo: sellLabel(price),
            scaling: r.world !== null && r.world < r.perLogin * 3 ? 'world clock' : scalingOf(price, null),
            worldUnitsPerHour: r.world, marketUnits: price.units || null,
            cap: `${m.count} rocks (best site ${r.bestSite}), respawn ${r.respawn} ticks at ${o.players} players (base ${m.respawn}), ${(r.p * 100).toFixed(0)}% a roll at 99${r.world !== null ? `: ${r.world.toFixed(0)} an hour world-wide` : ''}${price.units ? `; market ${price.units.toLocaleString('en-US')} units` : ''}`,
            conflict: CONFLICTS[m.output] ?? 'none known', basis: m.output === 'iron_ore' || m.output === 'blankrune' ? 'measured' : 'estimated',
            notes: m.output === 'blankrune'
                ? `${o.essenceTicks} ticks an essence with trips (coins.md, rs/46's trip time)`
                : `${r.ticksPerUnit.toFixed(1)} ticks a unit + ${o.bankTicks}-tick bank trips${m.output === 'iron_ore' ? ' (3.0 a roll measured on the demo, mining.md; the bank trip estimated)' : ''}`,
        });
    }

    // Gem rocks, each gem sold into its bid.
    const gem = c.mines.find(m => m.row === 'gem_rock');
    if (gem) {
        const r = mineRates(gem, o);
        const t = c.gemRockTable;
        let board = 0, coins = 0;
        const parts: string[] = [];
        // Gems price at their deep standing bids; a week's thin flow above the bid (rubies and red
        // topaz traded near 10,000 on about 1,000 units) is noted as upside, not counted.
        for (const d of t.drops) {
            const share = d.weight / t.total;
            const row = book.get(idOf.get(d.obj) ?? -1);
            const m = market(d.obj);
            const bid = row?.bid != null && row.buyQuantity >= MIN_MARKET_UNITS ? Math.floor(row.bid * (1 - GE_SELLER_FEE)) : 0;
            board += share * cost(d.obj);
            coins += share * (bid || m.net);
            parts.push(`${d.obj.replace('uncut_', '')} ${d.weight}/${t.total} @${bid || m.net} (${row?.buyQuantity ?? 0} bid${m.how === 'flow' && m.net > bid ? `; flow ${m.net} on ${m.units}` : ''})`);
        }
        out.push({
            id: 'mine:gem_rock', method: 'Mine Shilo gem rocks, sell uncut gems into their bids', kind: 'mining',
            inputs: `Mining ${gem.level}, Shilo Village (quest), pickaxe`,
            boardPerHour: r.perLogin * board, coinsPerHour: r.perLogin * coins, sellTo: 'GE bids, ~2,500 each',
            scaling: 'world clock', worldUnitsPerHour: r.world, marketUnits: t.drops.reduce((s, d) => s + market(d.obj).units, 0),
            cap: `${gem.count} rocks at one site, respawn ${r.respawn} ticks at ${o.players} players (base ${gem.respawn}): ${r.world?.toFixed(0)} gems an hour world-wide, shared with whoever is there; opal bids (${market('uncut_opal').units}) fill first`,
            conflict: CONFLICTS.uncut_gems!, basis: 'estimated',
            notes: `per gem ${coins.toFixed(0)} coins net vs ${board.toFixed(0)} board; ${parts.join(', ')}`,
        });
    }

    // Smelted bars from mined ore and coal.
    const byOutput = new Map(c.mines.filter(m => m.output).map(m => [m.output!, m]));
    const smelt = (bar: string, ore: string, coal: number, level: string, smeltTicks = 5) => {
        const oreRow = byOutput.get(ore)!;
        const coalRow = byOutput.get('coal')!;
        const ro = mineRates(oreRow, o);
        const rc = mineRates(coalRow, o);
        const ticks = ro.ticksPerUnit + coal * rc.ticksPerUnit + smeltTicks + (o.bankTicks * (1 + coal)) / 27;
        const site = ro.respawn > 0 ? (ro.bestSite * tph) / (ro.respawn + ro.ticksPerUnit) : Infinity;
        const perLogin = Math.min(tph / ticks, site);
        const m = market(bar);
        out.push({
            id: `smelt:${bar}`, method: `Mine ${ore.replace('_', ' ')} and ${coal} coal, smelt ${bar.replace('_', ' ')}, sell`, kind: 'smelting',
            inputs: level, boardPerHour: perLogin * cost(bar), coinsPerHour: sellable(perLogin, m) * m.net, sellTo: sellLabel(m),
            scaling: ro.world !== null && ro.world < tph / ticks * 3 ? 'world clock' : scalingOf(m, null),
            worldUnitsPerHour: ro.world, marketUnits: m.units || null,
            cap: `${oreRow.count} ${ore} rocks, best site ${ro.bestSite}${ro.world !== null ? ` (${ro.world.toFixed(0)} ore an hour world-wide)` : ''}; market ${m.units.toLocaleString('en-US')} units${m.how === 'flow' ? ' a week' : ''}`,
            conflict: CONFLICTS[bar] ?? 'none known', basis: 'estimated',
            notes: `${ticks.toFixed(0)} ticks a bar: ore ${ro.ticksPerUnit.toFixed(1)}, coal ${coal} x ${rc.ticksPerUnit.toFixed(1)}, smelt ${smeltTicks}, banking`,
        });
    };
    smelt('runite_bar', 'runite_ore', 8, 'Mining 85, Smithing 85');
    smelt('adamantite_bar', 'adamantite_ore', 6, 'Mining 70, Smithing 70');
    smelt('steel_bar', 'iron_ore', 2, 'Mining 30, Smithing 30');

    // Woodcutting and fishing at cycles from the skill docs.
    const gather = (id: string, method: string, kind: Candidate['kind'], obj: string, ticksPerUnit: number, inputs: string, basis: Basis, notes: string) => {
        const perLogin = tph / (ticksPerUnit + o.bankTicks / 27);
        const m = market(obj);
        out.push({
            id, method, kind, inputs, boardPerHour: perLogin * cost(obj), coinsPerHour: sellable(perLogin, m) * m.net, sellTo: sellLabel(m),
            scaling: scalingOf(m, null), worldUnitsPerHour: null, marketUnits: m.units || null,
            cap: m.how === 'flow' ? `${m.units.toLocaleString('en-US')} traded in 7 days (${(m.units / 168).toFixed(0)} an hour)` : m.how === 'bid' ? `bid depth ${m.units.toLocaleString('en-US')}` : 'none (banked)',
            conflict: CONFLICTS[obj] ?? 'none known', basis, notes,
        });
    };
    gather('wc:magic_logs', 'Cut magic logs, sell', 'woodcutting', 'magic_logs', 250 / 5.37, 'Woodcutting 75, rune axe', 'estimated', 'woodcutting.md ideal 5.37 base xp a tick, 250 xp a log');
    gather('wc:yew_logs', 'Cut yew logs, sell', 'woodcutting', 'yew_logs', 175 / 7.69, 'Woodcutting 60, rune axe', 'estimated', 'woodcutting.md ideal 7.69 base xp a tick, 175 xp a log');
    gather('fish:shark', 'Harpoon and cook sharks, sell', 'fishing', 'shark', 110 / 2.52 + 3.6, 'Fishing 76, Cooking 80, harpoon', 'estimated', 'fishing.md measured 2.52 base xp a tick at 99 (110 xp a shark) + a 3.6-tick cook; burns not deducted');
    gather('fish:lobster', 'Cage lobsters, sell', 'fishing', 'raw_lobster', 90 / 4.99, 'Fishing 40, lobster pot', 'estimated', 'fishing.md measured 4.99 base xp a tick at 99 (90 xp a lobster)');

    // Thieving, the model scaled to the guards' measured rate.
    for (const t of thievingLines(c, statChance).filter(t => t.kind === 'pickpocket')) {
        const pp = c.pickpockets.find(p => p.row === t.row)!;
        // Loot at market where it trades, else at cost.
        let marketValue = 0;
        let denom = 128;
        for (let i = pp.loot.length - 1; i >= 0; i--) {
            const l = pp.loot[i]!;
            const p = denom <= 0 ? 1 : Math.min(1, l.weight / denom);
            denom -= l.weight;
            const each = l.obj === 'coins' ? 1 : Math.max(market(l.obj).net, cost(l.obj));
            marketValue += p * ((l.min + l.max) / 2) * each;
        }
        const ticks = t.success * 2 + (1 - t.success) * (2 + pp.stunTicks);
        const k = t.row === 'pickpocket_guard' ? 7.4 / ((t.success * t.valuePerSuccess) / ticks) : o.thievingCalibration;
        if (t.valuePerTick * k * tph < 20_000) continue;
        out.push({
            id: `thieve:${t.row}`, method: `Pickpocket ${t.row.replace('pickpocket_', '').replace(/_/g, ' ')}`, kind: 'thieving',
            inputs: `Thieving ${t.level}, food`, boardPerHour: t.valuePerTick * k * tph, coinsPerHour: ((t.success * marketValue) / ticks) * k * tph,
            sellTo: 'coins (loot at market)', scaling: 'logins', worldUnitsPerHour: null, marketUnits: null,
            cap: 'none: every target NPC serves any number of logins', conflict: t.row.includes('knight') ? CONFLICTS.knights! : 'low: the coins earners (coins.md) use guards',
            basis: t.row === 'pickpocket_guard' ? 'measured' : 'estimated',
            notes: `${(t.success * 100).toFixed(0)}% success at 99, ${t.valuePerSuccess.toFixed(0)} a success; ${t.row === 'pickpocket_guard' ? 'coins.md 7.4 gp a tick (cairn_h61)' : `model x ${o.thievingCalibration.toFixed(2)}, the guards' measured/model ratio`}; loot ${t.loot}`,
        });
    }

    // Shops that sell below cost: board value per coin, world clock.
    const lines = shopLines(c, o.tickMs);
    const shopsByInv0 = new Map(c.shops.map(s => [s.inv, s]));
    for (const l of lines.filter(l => l.price < l.cost && l.boardGainPerHour > 1_000)) {
        out.push({
            id: `shop:${l.shop}:${l.obj}`, method: `Buy ${l.display} from ${l.title.replace(/\.$/, '')}, bank`, kind: 'shop',
            inputs: `coins (${l.price} each)`, boardPerHour: l.boardGainPerHour, coinsPerHour: -l.price * l.unitsPerHour,
            sellTo: 'bank', scaling: 'world clock', worldUnitsPerHour: l.unitsPerHour, marketUnits: null,
            cap: `${l.base} base stock, +1 every ${l.rate} ticks (${l.unitsPerHour.toFixed(0)} an hour); ${l.oneOffUnits} more below cost once (+${l.oneOffGain})`,
            conflict: 'none known', basis: 'estimated',
            notes: `${l.cost} board for ${l.price} coins (${l.boardPerCoin.toFixed(2)} a coin) at ${l.at}; assumes base stock (config only); below base the price rises ${shopsByInv0.get(l.shop)?.delta ?? '?'} per mille a unit, so the row is worth nothing once the shelf is ${l.oneOffUnits + 1} or more under base`,
        });
    }

    // Rune shops restocking into the GE.
    for (const rune of ['deathrune', 'naturerune', 'lawrune', 'bloodrune', 'chaosrune', 'cosmicrune']) {
        const m = market(rune);
        const sellers = lines.filter(l => l.obj === rune && l.restocks);
        if (m.net <= 0 || sellers.length === 0) continue;
        const units = sellers.reduce((s, l) => s + l.unitsPerHour, 0);
        const meanPrice = sellers.reduce((s, l) => s + l.price * l.unitsPerHour, 0) / units;
        const shopsByInv = new Map(c.shops.map(s => [s.inv, s]));
        let oneOff = 0;
        for (const l of sellers) {
            const shop = shopsByInv.get(l.shop)!;
            for (let k = 0; k < l.base; k++) {
                const p = buyFromShop(l.cost, shop, l.base - k, l.base);
                if (p >= m.net) break;
                oneOff += m.net - p;
            }
        }
        const perHourMarket = m.how === 'flow' ? m.units / 168 : Infinity;
        const sold = Math.min(units, perHourMarket);
        // The restock adds a unit a period whatever the shelf holds; an emptier shelf only prices it higher.
        const at = (fill: number) => {
            let coins = 0;
            for (const l of sellers) coins += l.unitsPerHour * (m.net - buyFromShop(l.cost, shopsByInv.get(l.shop)!, Math.floor(l.base * fill), l.base));
            return Math.round((coins * sold) / units);
        };
        out.push({
            id: `shopge:${rune}`, method: `Buy ${c.objs.get(rune)!.display}s at rune shops as they restock, sell`, kind: 'shop to GE',
            inputs: 'coins; the shops: ' + sellers.map(l => `${l.title.replace(/\.$/, '')} (${l.at})`).join(', '),
            boardPerHour: 0, coinsPerHour: sold * (m.net - meanPrice), sellTo: sellLabel(m), scaling: 'world clock',
            worldUnitsPerHour: units, marketUnits: m.units,
            cap: `restock ${units.toFixed(0)} an hour across ${sellers.length} shops${m.how === 'flow' ? `; GE flow ${perHourMarket.toFixed(0)} an hour` : ''}; one-off ${Math.round(oneOff).toLocaleString('en-US')} coins buying full shelves down to the GE price`,
            conflict: CONFLICTS[rune] ?? 'none known', basis: 'estimated',
            notes: `assumes base stock (shelves world-shared; a live read pending for Aubury and Betty, config only for the Magic Guild and Lundail); coins an hour at half shelves ${at(0.5).toLocaleString('en-US')}, at empty shelves ${at(0).toLocaleString('en-US')}, and the one-off is gone`,
        });
    }

    // Battlestaves: a shop-bought staff plus a charged orb is worth 15,500 on the board.
    const staffShops = lines.filter(l => l.obj === 'battlestaff' && l.restocks);
    if (staffShops.length) {
        const units = staffShops.reduce((s, l) => s + l.unitsPerHour, 0);
        const orb = cost('stafforb') + 3 * cost('cosmicrune') + 30 * cost('waterrune');
        const gain = cost('water_battlestaff') - staffShops[0]!.price - orb;
        const shopsByInv = new Map(c.shops.map(s => [s.inv, s]));
        const gainAt = (fill: number) => Math.round(staffShops.reduce((s, l) => s + l.unitsPerHour * (cost('water_battlestaff') - orb - buyFromShop(l.cost, shopsByInv.get(l.shop)!, Math.floor(l.base * fill), l.base)), 0));
        const m = market('water_battlestaff');
        out.push({
            id: 'proc:battlestaff', method: 'Buy battlestaves, attach charged water orbs, bank', kind: 'processing',
            inputs: `Crafting 54, Magic 56 (Charge Water Orb at the obelisk), coins 7,000 a staff, unpowered orbs, cosmic and water runes`,
            boardPerHour: units * gain, coinsPerHour: m.net > 0 ? units * (m.net - staffShops[0]!.price - orb) : 0,
            sellTo: m.how === 'none' ? 'bank (no market)' : sellLabel(m), scaling: 'world clock', worldUnitsPerHour: units, marketUnits: m.units || null,
            cap: `battlestaff restock ${units.toFixed(0)} an hour (${staffShops.map(l => `${l.title.replace(/\.$/, '')} ${l.base}@${l.rate}`).join(', ')}); orbs take their own casting time`,
            conflict: CONFLICTS.battlestaff!, basis: 'estimated',
            notes: `${cost('water_battlestaff')} board for ${staffShops[0]!.price} coins + an orb's ${orb} of inputs: +${gain} a staff; spends ${Math.round(units * staffShops[0]!.price).toLocaleString('en-US')} coins an hour, which were board value already; assumes base stock (Zaff live read pending, the Magic Guild config only): board an hour at half shelves ${gainAt(0.5).toLocaleString('en-US')}, at empty shelves ${gainAt(0).toLocaleString('en-US')}`,
        });
    }

    return out;
}

/** A login-hour's best board rate: coins and banked value both count, so the larger of the two. */
export function boardRate(x: Candidate): number {
    return Math.max(x.boardPerHour, x.coinsPerHour);
}

export function ranked(list: Candidate[]): Candidate[] {
    return [...list].sort((a, b) => boardRate(b) - boardRate(a));
}
