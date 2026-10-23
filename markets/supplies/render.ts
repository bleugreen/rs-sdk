// Renders the supplies tables as Markdown: a summary per item (cheapest shop, world restock, GE book,
// the coins to obtain the run's count), the shop detail per (item, shop) and the GE detail per item.
import type { Content, Obj, Spawn } from './content';
import { buyCost, unitPrice } from './curve';
import { summarize, type GeRead, type GeSummary } from './ge';
import { NO_LIVE_READ, SHOP_PLACES, type Group, type Supply } from './items';
import { cheapestFill } from './plan';
import type { ShopRow } from './shops';

/** One live shelf observation (the read-only shelf reader's output, relayed by the parent). */
export interface ShelfRead {
    inv: string;
    obj: string;
    count: number;
    /** The 'currently costs' price of the next unit, if read. */
    price?: number;
    /** ISO UTC time of the read. */
    at: string;
}

export interface Bank {
    name: string;
    x: number;
    z: number;
}

export interface RenderInput {
    supplies: Supply[];
    content: Content;
    rows: ShopRow[];
    ge: GeRead[];
    shelf: ShelfRead[];
    banks: Bank[];
    /** The fleet buyer's SHOPS key for a row, if it already shops there. */
    fleet: (row: ShopRow) => string | undefined;
}

export const n = (v: number | null | undefined, digits = 0): string =>
    v === null || v === undefined || !Number.isFinite(v) ? '-' : v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export const utc = (ms: number | null | undefined): string => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + 'Z' : '-');

/** The obj a supply names: its pinned debugname, else the one obj with that display name. */
export function objOf(s: Supply, c: Content): Obj | undefined {
    if (s.obj) return c.objs.get(s.obj);
    return [...c.objs.values()].find(o => o.name.toLowerCase() === s.name.toLowerCase() && !/^cert_|^invis_/.test(o.debugname));
}

/** Shops a ship, a quest area or the Wilderness separates from every bank: no straight-line walk. */
const OFF_MAINLAND = /^(cheapringshop|magearena_runeshop|mm_|junglestore|shilo|karamja_fishrestaurant|amuletshop|etc_fishmonger|misc_fishmonger|herbloreshop2|lighthouseshop|werewolf|viking_|razmire|taxfree|generalshop7|generalshop8)/;

/** The nearest bank in straight-line tiles (Chebyshev; running covers 2 a tick), or '-' off the mainland. */
export function nearestBank(row: ShopRow, banks: Bank[]): string {
    const s: Spawn | undefined = row.spawns[0];
    if (!s || OFF_MAINLAND.test(row.inv)) return '-';
    const under = s.z > 6400;
    const at = { x: s.x, z: under ? s.z - 6400 : s.z };
    const [b, d] = banks.map(b => [b, Math.max(Math.abs(b.x - at.x), Math.abs(b.z - at.z))] as const).sort((a, b) => a[1] - b[1])[0]!;
    return `${b.name} ${d}${under ? ' + ladder' : s.level > 0 ? ' + stairs' : ''}`;
}

function shelfCell(row: ShopRow, shelf: ShelfRead[]): string {
    const why = NO_LIVE_READ[row.inv];
    if (why) return `config only (${why})`;
    const r = shelf.filter(x => x.inv === row.inv && x.obj === row.obj).sort((a, b) => b.at.localeCompare(a.at))[0];
    if (!r) return 'pending';
    return `${n(r.count)}${r.price === undefined ? '' : ` at ${n(r.price)}`} (${r.at.slice(0, 16).replace('T', ' ')}Z)`;
}

const esc = (s: string) => s.replace(/\|/g, '\\|');
const table = (head: string[], body: string[][]) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...body.map(r => `| ${r.map(esc).join(' | ')} |`)].join('\n');

export interface ItemView {
    supply: Supply;
    obj?: Obj;
    rows: ShopRow[];
    ge?: GeRead;
    sum?: GeSummary;
}

export function itemViews(i: RenderInput): ItemView[] {
    return i.supplies.map(supply => {
        const obj = objOf(supply, i.content);
        // Cheapest first; on a tie, a shop anyone can use before one behind a quest, skill or ship.
        const gated = (r: ShopRow) => (SHOP_PLACES[r.inv]?.needs ? 1 : 0);
        const rows = obj ? i.rows.filter(r => r.obj === obj.debugname).sort((a, b) => a.priceAtBase - b.priceAtBase || gated(a) - gated(b) || b.base - a.base) : [];
        const ge = obj?.id === undefined ? undefined : i.ge.find(g => g.id === obj.id);
        return { supply, obj, rows, ge, sum: ge ? summarize(ge) : undefined };
    });
}

function askCell(sum: GeSummary | undefined): string {
    if (!sum) return 'not read';
    if (sum.ask === null) return 'none';
    const climbs = sum.askMean !== null && sum.askMean > sum.ask * 1.2 ? ` (book mean ${n(sum.askMean)})` : '';
    return `${n(sum.ask)} x${n(sum.askDepth)}${climbs}`;
}

function summaryRow(v: ItemView): string[] {
    const { supply: s, rows, sum } = v;
    const stocked = rows.filter(r => r.base > 0);
    const cheapest = stocked[0];
    const shop = cheapest ? `${cheapest.owner.npcName ?? cheapest.owner.npc}: ${n(cheapest.priceAtBase)} x${n(cheapest.base)}` + (stocked.length > 1 ? ` (+${stocked.length - 1} more)` : '') : rows.length ? 'player-sold shelves only' : 'none';
    const perHour = stocked.reduce((a, r) => a + r.restockPerHour, 0);
    const perHourCell = perHour ? n(perHour, perHour < 10 ? 1 : 0) : '-';
    const vol = sum ? `${n(sum.volume)}${sum.perHour ? ` (${n(sum.perHour, 1)}/h)` : ''}` : '-';
    let fill = '-';
    let avg = '-';
    if (s.need) {
        const f = cheapestFill(s.need, stocked.map(r => ({ label: r.inv, pricing: r.pricing })), sum?.ask ? { ask: sum.ask, depth: sum.askDepth } : null);
        fill = f.units === 0 ? 'no seller' : f.units < s.need ? `${n(f.units)} only, ${n(f.cost)}` : n(f.cost);
        if (f.units) avg = n(f.cost / f.units, f.cost / f.units < 10 ? 1 : 0) + (f.ge && Object.keys(f.taken).length ? ' (mixed)' : f.ge ? ' (GE)' : '');
    }
    return [s.name, s.need === null ? '-' : n(s.need), s.note ?? '', shop, perHourCell, askCell(sum), sum?.bid ? `${n(sum.bid)} x${n(sum.bidDepth)}` : sum ? 'none' : '-', vol, fill, avg];
}

function shopRowCells(v: ItemView, r: ShopRow, i: RenderInput): string[] {
    const p = SHOP_PLACES[r.inv];
    const where = p ? `${p.place}${p.needs ? `; ${p.needs}` : ''}` : r.spawns[0] ? `(${r.spawns[0].x}, ${r.spawns[0].z})` : '?';
    const step = (r.pricing.cost * r.pricing.delta) / 1000;
    const need = v.supply.need ?? 0;
    const fromFull = r.base > 0 && need > 0 ? `${n(buyCost(r.pricing, Math.min(need, r.base)) ?? 0)}${need > r.base ? ` for ${n(r.base)}` : ''}` : '-';
    const ceiling = r.base > 0 ? `${n(r.ceiling)}${r.toCeiling === null ? ` (not reached; last unit ${n(unitPrice(r.pricing, 1))})` : ` after ${n(r.toCeiling)}`}` : n(r.ceiling);
    const restock = r.base === 0 ? 'none (player-sold)' : r.rate ? `1 per ${n(r.rate)} t, ${n(r.restockPerHour, 1)}/h` : 'never';
    return [
        v.supply.name,
        `${r.owner.npcName ?? r.owner.npc} (\`${r.inv}\`)`,
        where,
        nearestBank(r, i.banks),
        i.fleet(r) ?? '',
        n(r.base),
        n(r.priceAtBase),
        `+${n(step, 2)}`,
        ceiling,
        fromFull,
        restock,
        shelfCell(r, i.shelf),
    ];
}

/** Shops listed per item in the detail table: the cheapest stocked ones, then any the fleet already uses. */
export const DETAIL_SHOPS = 5;

export function detailRows(v: ItemView, fleet: (row: ShopRow) => string | undefined): ShopRow[] {
    const ordered = [...v.rows.filter(r => r.base > 0), ...v.rows.filter(r => r.base === 0)];
    const top = ordered.slice(0, DETAIL_SHOPS);
    return [...top, ...ordered.slice(DETAIL_SHOPS).filter(r => fleet(r))];
}

const GROUPS: Group[] = ['Runes', 'Arrows and fletching', 'Potions', 'Food', 'Gems and jewellery', 'Staves', 'Bars and ores', 'Skill supplies', 'Gear and tools', 'Quest items'];

export function render(i: RenderInput): string {
    const views = itemViews(i);
    const out: string[] = [];
    const readTimes = i.ge.map(g => g.at).filter(Boolean);
    out.push(`GE figures read ${utc(Math.min(...readTimes))} to ${utc(Math.max(...readTimes))} (public market API, read-only). Shop figures are the content's configuration (\`server/content\`), which a full shelf after a server restart matches; the Live shelf column carries the read-only shelf reader's counts as they arrive.`);
    out.push('### Summary by item');
    for (const g of GROUPS) {
        const vs = views.filter(v => v.supply.group === g);
        if (!vs.length) continue;
        out.push(`#### ${g}`);
        out.push(table(['Item', 'Run need', 'Need note', 'Cheapest stocked shop: price x stock', 'Shop restock/h (world)', 'GE ask x depth', 'GE bid x depth', 'GE 7-day volume', 'Coins for the need', 'gp/unit'], vs.map(summaryRow)));
    }
    out.push('### Shop detail');
    out.push(
        table(
            ['Item', 'Shopkeeper (inv)', 'Where; needs', 'Nearest bank, tiles', 'Fleet key', 'Base stock', '1st unit', 'Step/unit', 'Ceiling', "Run's need from a full shelf", 'Restock', 'Live shelf'],
            views.flatMap(v => detailRows(v, i.fleet).map(r => shopRowCells(v, r, i))),
        ),
    );
    const omitted = views.filter(v => v.rows.length > detailRows(v, i.fleet).length).map(v => `${v.supply.name} ${v.rows.length - detailRows(v, i.fleet).length}`);
    if (omitted.length) out.push(`At most ${DETAIL_SHOPS} shops per item, cheapest stocked first, plus any the fleet buys at. Further shops, none cheaper at a full shelf, not listed: ${omitted.join(', ')}.`);
    out.push('### Grand Exchange detail');
    out.push(
        table(
            ['Item (id)', 'Bid x qty', 'Ask x qty', 'Mean ask', 'Last trade', '7-day volume (trades)', '7-day low-high', 'Read'],
            views
                .filter(v => v.ge)
                .map(v => {
                    const s = v.sum!;
                    const q = v.ge!.quote;
                    if (!q) return [`${v.supply.name} (${v.obj?.id})`, v.ge!.error ?? 'no quote', '', '', '', '', '', utc(v.ge!.at)];
                    return [
                        `${v.supply.name} (${v.obj?.id})`,
                        s.bid === null ? 'none' : `${n(s.bid)} x${n(s.bidDepth)}`,
                        s.ask === null ? 'none' : `${n(s.ask)} x${n(s.askDepth)}`,
                        n(s.askMean),
                        s.lastPrice === null ? '-' : `${n(s.lastPrice)} (${utc(s.lastTradeAt)})`,
                        `${n(s.volume)} (${n(s.trades)})`,
                        s.low === null ? '-' : `${n(s.low)}-${n(s.high)}`,
                        utc(v.ge!.at),
                    ];
                }),
        ),
    );
    return out.join('\n\n');
}

export const BEGIN = '<!-- supplies:generated:begin (bun markets/supplies/build.ts render) -->';
export const END = '<!-- supplies:generated:end -->';

/** Replace the generated block of a document, keeping the hand-written text around it. */
export function splice(doc: string, block: string): string {
    const a = doc.indexOf(BEGIN);
    const b = doc.indexOf(END);
    if (a < 0 || b < a) throw new Error('document has no generated block markers');
    return `${doc.slice(0, a + BEGIN.length)}\n\n${block}\n\n${doc.slice(b)}`;
}
