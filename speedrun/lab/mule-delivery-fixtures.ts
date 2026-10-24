import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AskItem, CueScope } from '../helpers/altar-cue';
import { H4M_STAND, muleDelivery, type ItineraryOptions } from '../helpers/mule-itinerary';
import { h4mFallbackRow, H4M_ANCHOR, materializeDeliveryPackage, muleFromLedger, muleRunOptions, packageFromRow, parseFallbacks, type LedgerPackage } from '../helpers/mule-ledger';
import type { WorldTile } from '../helpers/mule-readiness';
import { westOfTaverley } from '../lib/kandarin';
import { OBJ_CONFIGS, objIdsNamed, objName, untradeable } from '../lib/items';
import { noteLink, type ObjPack } from '../lib/obj-pack';
import type { GiveSpec, WantSpec } from '../lib/trade';
import { SPELLS, type Area } from '../lib/travel';
import { gameName, itemPattern, planHandOff } from '../runner/handoff';
import { TILES } from '../runner/legs';
import { BANDS } from '../skills/thieving';
import { itemLabel, parseLedger, walk, type Held, type ItemRef, type Kind, type LedgerRow } from '../tools/slot-ledger';

export interface FixtureObject { name: string; stackable: boolean; tradeable?: boolean }
export type FixtureCatalog = ReadonlyMap<number, FixtureObject> & {
    /** Canonical name lookup when backed by engine content; synthetic packs may inject metadata. */
    idsNamed?: (pattern: RegExp) => readonly number[];
};

/**
 * obj.pack supplies identity and cert links, not display names or stackability.
 * Read those from the same source configs as the engine, never from guessed debug names.
 * Entries using unsupported templates are omitted, so resolution fails closed.
 */
export function loadFixtureCatalog(pack: ObjPack): FixtureCatalog {
    const sourceIds = new Map(objIdsNamed(/.*/).map(id => [objName(id)!, id]));
    const catalog: Map<number, FixtureObject> & Pick<FixtureCatalog, 'idsNamed'> = new Map();
    catalog.idsNamed = pattern => objIdsNamed(pattern).flatMap(id => {
        const mapped = pack.ids.get(objName(id)!);
        return mapped === undefined ? [] : [mapped];
    });
    const visit = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) visit(path);
            else if (entry.name.endsWith('.obj')) {
                let id: number | undefined;
                let name: string | undefined;
                let stackable = false;
                let unsupported = false;
                const save = () => {
                    if (id !== undefined && name && !unsupported) {
                        if (catalog.has(id)) throw new Error('Duplicate object definition: ' + id);
                        const sourceId = sourceIds.get(pack.names.get(id)!);
                        if (sourceId === undefined) throw new Error('No canonical object identity: ' + id);
                        catalog.set(id, { name, stackable, tradeable: !untradeable(sourceId) });
                    }
                };
                for (const raw of readFileSync(path, 'utf8').split('\n')) {
                    const line = raw.trim();
                    const section = /^\[([^\]]+)\]$/.exec(line);
                    if (section) {
                        save(); id = pack.ids.get(section[1]!); name = undefined; stackable = false; unsupported = false;
                    } else if (line.startsWith('name=')) name = line.slice(5);
                    else if (line.startsWith('stackable=')) stackable = line.slice(10) === 'yes';
                    else if (/^(template|inherit)=/.test(line)) unsupported = true;
                }
                save();
            }
        }
    };
    visit(OBJ_CONFIGS);
    return catalog;
}

export interface FixtureItem {
    /** Inventory id, including a cert id for a noted stack. */
    id: number;
    count: number;
    bankId: number;
    name: string;
    debugName: string;
    kind: Kind;
}
export interface ConcreteFixtureOverride {
    items: readonly { id: number; count: number }[];
    /** Caller authority for the concrete choice; retained in the result. */
    reason: string;
}
export interface RowFixtureOverrides {
    /** Keys are exact itemLabel strings from the walked before-state. */
    before?: Readonly<Record<string, ConcreteFixtureOverride>>;
    /** Required for all/family/placeholder returns, except the authorized H4 recoil fixture. */
    takeBacks?: Readonly<Record<string, ConcreteFixtureOverride>>;
    /** Resolve an ambiguous incoming display name, at its canonical fixed count/top-up maximum. */
    receive?: Readonly<Record<string, ConcreteFixtureOverride>>;
    /** Conditional rows need a main-ledger insertion point, before this row. */
    beforeRow?: string;
}
export interface MuleDeliveryFixture {
    row: string;
    onRequest: boolean;
    status: 'mechanical-only' | 'mechanical-only-not-accepted';
    scoredArrivalAccepted: false;
    at: WorldTile;
    bank: WorldTile;
    receivingArea: Area;
    ledger: LedgerPackage;
    beforeInventory: FixtureItem[];
    beforeEquipment: FixtureItem[];
    /** The inventory after taking off returns, before opening the trade. */
    tradeInventory: FixtureItem[];
    takeBacks: FixtureItem[];
    receive: FixtureItem[];
    afterInventory: FixtureItem[];
    afterEquipment: FixtureItem[];
    give: GiveSpec[];
    want: WantSpec[];
    /** Publish with a fresh timestamp on the actual open-trade frame. */
    topUpAsk: { scope: CueScope; items: AskItem[] } | null;
    /** All fixed quantities and top-up maxima; not just this recipient's ask. */
    reserve: FixtureItem[];
    /** Present only when the canonical generator carries the next ordered package. */
    carryNext?: string;
    helperBeforeInventory: FixtureItem[];
    helperAfterInventory: FixtureItem[];
    slots: { before: number; beforeEquipment: number; trade: number; afterSwap: number; afterEquip: number; helperStaged: number; helperAfterSwap: number };
    overrides: RowFixtureOverrides;
}
export interface MuleDeliveryFixtureOptions {
    manifest: string;
    rows: readonly string[];
    onRequest?: readonly string[];
    pack: ObjPack;
    itinerary?: ItineraryOptions;
    overrides?: Readonly<Record<string, RowFixtureOverrides>>;
    /** Inject object metadata for a different content pack or pure tests. */
    catalog?: FixtureCatalog;
}
export interface MuleDeliveryFixturePlan {
    ok: boolean;
    requestedRows: string[];
    fixtures: MuleDeliveryFixture[];
    unresolved: { row: string; reasons: string[] }[];
    /** Null if any requested row is unresolved: a partial plan cannot seed a run. */
    bankSeed: FixtureItem[] | null;
    /** Give this batch, then really deposit it before giving the next batch. */
    seedBatches: FixtureItem[][] | null;
}

const positive = (n: number) => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
function fail(message: string): never { throw new Error(message); }
const total = (items: readonly FixtureItem[]) => items.reduce((n, i) => n + i.count, 0);
const norm = (name: string) => name.toLowerCase();

function concrete(id: number, count: number, pack: ObjPack, catalog: FixtureCatalog): FixtureItem {
    if (!positive(count)) fail('Invalid concrete count ' + count + ' for obj ' + id);
    const link = noteLink(id, pack);
    const obj = catalog.get(link.item) ?? fail('No supported object metadata for obj ' + id);
    return { id, count, bankId: link.item, name: obj.name, debugName: pack.names.get(id)!, kind: id === link.note ? 'n' : obj.stackable ? 's' : 'u' };
}
function merge(items: readonly FixtureItem[]): FixtureItem[] {
    const out = new Map<number, FixtureItem>();
    for (const item of items) {
        const old = out.get(item.id);
        const count = (old?.count ?? 0) + item.count;
        if (!positive(count)) fail('Invalid aggregate count for obj ' + item.id);
        if (old && old.kind !== item.kind) fail('Conflicting kind for obj ' + item.id);
        out.set(item.id, { ...item, count });
    }
    return [...out.values()];
}
export function fixtureSlots(items: readonly FixtureItem[]): number {
    return merge(items).reduce((n, i) => n + (i.kind === 'u' ? i.count : 1), 0);
}
function fits(items: readonly FixtureItem[], at: string): number {
    const used = fixtureSlots(items);
    if (used > 28) fail(at + ': ' + used + ' slots exceeds 28');
    return used;
}
function subtract(items: readonly FixtureItem[], removed: readonly FixtureItem[]): FixtureItem[] {
    const out = merge(items);
    for (const item of merge(removed)) {
        const held = out.find(i => i.id === item.id);
        if (!held || held.count < item.count) fail('Missing obj ' + item.id + ' x' + item.count);
        held.count -= item.count;
    }
    return out.filter(i => i.count > 0);
}
function same(a: readonly FixtureItem[], b: readonly FixtureItem[]): boolean {
    const key = (items: readonly FixtureItem[]) => JSON.stringify(merge(items).map(i => [i.id, i.count]).sort((x, y) => x[0]! - y[0]!));
    return key(a) === key(b);
}
function matches(ref: ItemRef, item: FixtureItem): boolean {
    return ref.id !== undefined ? ref.id === item.bankId : itemPattern(ref.name).test(item.name);
}
function overridden(o: ConcreteFixtureOverride, pack: ObjPack, catalog: FixtureCatalog): FixtureItem[] {
    if (!o.reason?.trim() || !o.items.length) fail('Concrete override needs items and an authority reason');
    return merge(o.items.map(i => concrete(i.id, i.count, pack, catalog)));
}
function resolve(h: Held, o: ConcreteFixtureOverride | undefined, pack: ObjPack, catalog: FixtureCatalog): FixtureItem[] {
    if (h.count === null) fail(itemLabel(h) + ' x?: unknown canonical quantity');
    if (!positive(h.count)) fail(itemLabel(h) + ': invalid canonical quantity ' + h.count);
    if (o) {
        const items = overridden(o, pack, catalog);
        if (total(items) !== h.count) fail(itemLabel(h) + ': override changes canonical count ' + h.count);
        if (items.some(i => i.kind !== h.kind)) fail(itemLabel(h) + ': override changes canonical kind [' + h.kind + ']');
        if (!h.placeholder && items.some(i => !matches(h, i))) fail(itemLabel(h) + ': override does not match the canonical identity');
        return items;
    }
    if (h.placeholder || h.family) fail(itemLabel(h) + ': explicit concrete fixture override required');
    let id = h.id;
    if (id === undefined) {
        const name = norm(gameName(h.name));
        const literal = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const candidates = catalog.idsNamed
            ? [...new Set(catalog.idsNamed(new RegExp('^' + literal + '$', 'i')))]
            : [...catalog].filter(([, obj]) => norm(obj.name) === name).map(([key]) => key);
        if (candidates.length !== 1) fail(itemLabel(h) + ': ' + candidates.length + ' concrete objects match; explicit identity override required');
        id = candidates[0]!;
    }
    const link = noteLink(id, pack);
    if (link.item !== id) fail(itemLabel(h) + ': ledger id must be unnoted');
    const actualId = h.kind === 'n' ? link.note ?? fail(itemLabel(h) + ': no cert link') : id;
    const item = concrete(actualId, h.count, pack, catalog);
    if (item.kind !== h.kind) fail(itemLabel(h) + ': object kind [' + item.kind + '] differs from ledger [' + h.kind + ']');
    return [item];
}

const recoil: ConcreteFixtureOverride = { items: [{ id: 2550, count: 20 }], reason: 'Explicitly authorized lab-only H4 enchanted-ring fixture: ring_of_recoil 2550 x20' };
function authorizedRecoil(row: string, ref: ItemRef, count: number | 'all' | 'any' | null, pack: ObjPack): ConcreteFixtureOverride | undefined {
    if (row !== 'H4' || !ref.placeholder || ref.name !== 'enchanted ring' || count !== 20) return undefined;
    if (pack.names.get(2550) !== 'ring_of_recoil') fail('Authorized H4 recoil id does not match obj.pack');
    return recoil;
}

/** The scored arrival areas, not the helper's exact stand. Coordinates stay in the canonical modules. */
function receivingArea(row: string, at: WorldTile, itinerary?: ItineraryOptions): Area {
    const areas: Record<string, Area> = {
        H1: TILES.lumbridgeSpawn, H4: TILES.doric, H4k: TILES.taverleyNormals,
        H4e: TILES.taverleyWillows, H4m: TILES.zooIron, H4p: TILES.zooIron,
        H6: TILES.edmond, H7: TILES.elkoy, H8: TILES.grandTreeDoor, H12: TILES.grandTreeDoor,
        H9: SPELLS.ardougne.landing, H10: SPELLS.ardougne.landing, H13: SPELLS.ardougne.landing,
        H14: BANDS.find(b => b.stunPack)?.anchors[0] ?? fail('Missing canonical stun-pack anchor'), H15: TILES.caroline, H16: TILES.fishingContest,
        H18: TILES.flySpots, H19: TILES.cook, H20: TILES.rustyAnchor,
        H21d: TILES.westBooth, H22: TILES.championsGuild,
    };
    // H4m's loads: SCORED on the zoo lap's east stay, the one lap tile beside the stand.
    const area: Area | undefined = row === 'H3' ? itinerary?.rehearsal?.firemakingEnd
        : /^H4m\.\d+$/.test(row) ? { x: H4M_STAND.x - 1, z: H4M_STAND.z, tol: 0 } : areas[row];
    if (!area) fail('No canonical receiving area for ' + row);
    return { ...area, level: area.level ?? at.level, tol: area.tol ?? 0 };
}

/** Note-assisted initial gives only; the harness must really deposit each bounded batch. */
export function fixtureSeedBatches(stock: readonly FixtureItem[], pack: ObjPack, catalog: FixtureCatalog): FixtureItem[][] {
    const batches: FixtureItem[][] = [];
    let batch: FixtureItem[] = [];
    for (const item of merge(stock)) {
        const link = noteLink(item.bankId, pack);
        const id = link.note ?? link.item;
        let remaining = item.count;
        while (remaining > 0) {
            const seed = concrete(id, remaining, pack, catalog);
            const room = 28 - fixtureSlots(batch);
            if (!room) { batches.push(batch); batch = []; continue; }
            const n = seed.kind === 'u' ? Math.min(room, remaining) : remaining;
            batch.push({ ...seed, count: n });
            remaining -= n;
        }
    }
    if (batch.length) batches.push(batch);
    return batches;
}

/**
 * One independent recipient per ledger row. No logins, live mutations, inferred quantities,
 * account names or serving engine. A failure remains in unresolved even when other rows resolve.
 */
export function planMuleDeliveryFixtures(o: MuleDeliveryFixtureOptions): MuleDeliveryFixturePlan {
    const requestedRows = [...o.rows, ...(o.onRequest ?? [])];
    const result: MuleDeliveryFixturePlan = { ok: false, requestedRows, fixtures: [], unresolved: [], bankSeed: null, seedBatches: null };
    const parsed = parseLedger(o.manifest);
    let fallbacks: LedgerRow[] = [];
    let catalog: FixtureCatalog;
    try {
        if (!requestedRows.length) fail('No selected delivery rows');
        if (parsed.errors.length) fail(parsed.errors.join('; '));
        fallbacks = parseFallbacks(o.manifest);
        catalog = o.catalog ?? loadFixtureCatalog(o.pack);
    } catch (error) {
        result.unresolved = (requestedRows.length ? requestedRows : ['<selection>']).map(row => ({ row, reasons: [String(error)] }));
        return result;
    }
    const entries = walk(parsed.rows);
    let previousIndex = -1;
    for (const rowId of requestedRows) {
        const reasons: string[] = [];
        const capture = <T>(fn: () => T, otherwise: T): T => {
            try { return fn(); } catch (error) { reasons.push((error as Error).message); return otherwise; }
        };
        const fixture = capture((): MuleDeliveryFixture => {
            if (requestedRows.filter(id => id === rowId).length !== 1) fail('Duplicate selected row ' + rowId);
            // An H4m load is the canonical expansion of the fallback row H4m.1-H4m.N (mule-ledger.ts), right
            // after H4p; its recipient is SCORED as H4p leaves it, the state before H4p's step.
            const load = /^H4m\.\d+$/.test(rowId) ? muleFromLedger(o.manifest, { rows: [H4M_ANCHOR], pack: o.pack }).find(l => l.row === rowId) ?? fail(rowId + ': not one of the manifest\'s H4m loads') : null;
            if (load && !(requestedRows[requestedRows.indexOf(rowId) - 1] === H4M_ANCHOR || /^H4m\.\d+$/.test(requestedRows[requestedRows.indexOf(rowId) - 1] ?? ''))) fail(rowId + ': an H4m load follows ' + H4M_ANCHOR + ' or another load');
            const onRequest = !load && (o.onRequest ?? []).includes(rowId);
            const rows = onRequest || load ? fallbacks : parsed.rows;
            const loadSource = load ? h4mFallbackRow(fallbacks) : null;
            const indices = rows.flatMap((r, i) => (loadSource ? r === loadSource : r.row === rowId) ? [i] : []);
            if (indices.length !== 1) fail(rowId + ': expected exactly one ledger row, found ' + indices.length);
            const index = indices[0]!;
            if (!onRequest && !load && index <= previousIndex) fail('Selected rows are not in ledger order');
            if (!onRequest && !load) previousIndex = index;
            const row = rows[index]!;
            const overrides = o.overrides?.[rowId] ?? {};
            const point = overrides.beforeRow ?? (load ? load.step! : onRequest ? ({ H4e: 'S07 last load', H4m: 'S09' } as Record<string, string>)[rowId] : rowId);
            if (!onRequest && !load && overrides.beforeRow && point !== rowId) fail('An ordered row cannot override its ledger insertion point');
            const checkpoints = parsed.rows.flatMap((r, i) => r.row === point ? [i] : []);
            if (checkpoints.length !== 1) fail('Conditional fixture needs an unambiguous beforeRow checkpoint');
            const checkpoint = checkpoints[0]!;
            const prior = entries.slice(0, checkpoint).filter(e => e.verdict === 'ERROR');
            if (prior.length) fail('Ledger walk errors before row: ' + prior.map(e => e.row.row + ': ' + e.notes.join('; ')).join(' | '));
            const before = entries[checkpoint - 1]?.stacks ?? { inv: [], worn: [] };
            const allowedBefore = new Set([...before.inv, ...before.worn].map(itemLabel));
            for (const key of Object.keys(overrides.before ?? {})) if (!allowedBefore.has(key)) fail('Unknown before override ' + key);
            for (const key of Object.keys(overrides.takeBacks ?? {})) if (!row.out.some(e => itemLabel(e) === key)) fail('Unknown takeBacks override ' + key);
            for (const key of Object.keys(overrides.receive ?? {})) if (!row.in.some(e => itemLabel(e) === key)) fail('Unknown receive override ' + key);
            const materialized = new Map<string, FixtureItem[]>();
            const held = (h: Held) => capture(() => {
                const items = resolve(h, overrides.before?.[itemLabel(h)] ?? authorizedRecoil(rowId, h, h.count, o.pack), o.pack, catalog);
                materialized.set(itemLabel(h), [...(materialized.get(itemLabel(h)) ?? []), ...items]);
                return items;
            }, []);
            const beforeInventory = merge(before.inv.flatMap(held));
            const beforeEquipment = merge(before.worn.flatMap(held));
            const canonicalPlan = capture(() => planHandOff(row), null);
            const ledger = load ?? capture(() => packageFromRow(rows, index, 'ask', o.pack, onRequest), null);
            const delivery = capture(() => muleDelivery(rowId, o.itinerary), null);
            const takeBacks = merge(row.out.flatMap(e => capture(() => {
                // A `drop` is left on SCORED's tile, never handed back to the helper.
                if (e.reason === 'drop') return [];
                if (e.count === null) fail(itemLabel(e) + ' x?: unknown canonical return quantity');
                if (e.reason !== 'swap' && e.reason !== 'trade') fail(itemLabel(e) + ': not a trade return');
                const chosen = overrides.takeBacks?.[itemLabel(e)] ?? authorizedRecoil(rowId, e, e.count, o.pack);
                if ((e.placeholder || e.family || e.count === 'all' || e.count === 'any') && !chosen) fail(itemLabel(e) + ': all/any/family/placeholder return requires explicit concrete fixture override');
                const items = chosen ? overridden(chosen, o.pack, catalog) : [...beforeInventory, ...beforeEquipment].filter(i => matches(e, i));
                const expected = e.placeholder ? materialized.get(itemLabel(e)) ?? [] : [...beforeInventory, ...beforeEquipment].filter(i => matches(e, i));
                if (!same(items, expected)) fail(itemLabel(e) + ': return override differs from the intended before-state');
                // `any` may return nothing (stock an earlier step used up)
                if ((!items.length && e.count !== 'any') || (typeof e.count === 'number' && total(items) !== e.count)) fail(itemLabel(e) + ': return count differs from canonical count ' + e.count);
                subtract([...beforeInventory, ...beforeEquipment], items);
                return items;
            }, [])));
            const reserve: FixtureItem[] = [];
            const receive: FixtureItem[] = [];
            const ask: AskItem[] = [];
            for (let i = 0; i < row.in.length; i++) capture(() => {
                const e = row.in[i]!;
                if (e.placeholder || e.family) fail(itemLabel(e) + ': transform incoming module/family row to concrete canonical package lines');
                const items = resolve(e, overrides.receive?.[itemLabel(e)], o.pack, catalog);
                if (items.length !== 1) fail(itemLabel(e) + ': incoming line must resolve to one concrete object');
                reserve.push(...items);
                const r = canonicalPlan?.receive.find(r => r.name === e.name && r.kind === e.kind && (e.id === undefined || r.ids?.includes(items[0]!.id)));
                if (!r) fail(itemLabel(e) + ': no canonical handoff receive match');
                const heldCount = [...beforeInventory, ...beforeEquipment].filter(h => r.ids ? r.ids.includes(h.id) : r.pattern.test(h.name)).reduce((n, h) => n + h.count, 0);
                const count = e.topUp ? Math.max(0, e.count! - heldCount) : e.count!;
                // The canonical ask format accepts only positive counts. An absent line requests
                // zero; when every top-up is satisfied the helper takes its ordinary no-ask path.
                if (e.topUp && count > 0) ask.push({ item: r.pattern.source, count });
                if (count) receive.push({ ...items[0]!, count });
            }, undefined);
            if (reasons.length) fail('Row cannot be materialized');
            if (!canonicalPlan || !ledger || !delivery) fail('Incomplete canonical row');
            const off = beforeEquipment.filter(i => takeBacks.some(t => t.id === i.id));
            const tradeInventory = merge([...beforeInventory, ...off]);
            const afterSwap = merge([...subtract(tradeInventory, takeBacks), ...receive]);
            let afterInventory = afterSwap;
            let afterEquipment = subtract(beforeEquipment, off);
            for (const e of row.equip) {
                const from = e.on ? afterInventory : afterEquipment;
                const item = from.find(i => itemPattern(e.name).test(i.name)) ?? fail('Equip ' + e.name + ': missing concrete item');
                const moved = { ...item, count: item.kind === 'u' ? 1 : item.count };
                if (e.on) { afterInventory = subtract(afterInventory, [moved]); afterEquipment = merge([...afterEquipment, moved]); }
                else { afterEquipment = subtract(afterEquipment, [moved]); afterInventory = merge([...afterInventory, moved]); }
                fits(afterInventory, 'recipient equipment transition');
            }
            for (const item of [...reserve, ...takeBacks]) {
                if (catalog.get(item.bankId)?.tradeable === false) fail(item.name + ' @' + item.id + ': canonical trade includes an untradeable object');
            }
            // Preserve canonical quantities and note flags while binding the caller-validated
            // identities before the same runtime materialization/carry boundary the helper uses.
            ledger.package = materializeDeliveryPackage({ ...ledger.package, items: ledger.package.items.map((line, i) => {
                const { item, id, ...quantity } = line;
                return { ...quantity, id: reserve[i]!.bankId };
            }) }, o.pack);
            const slots = {
                before: fits(beforeInventory, 'recipient before'), beforeEquipment: fixtureSlots(beforeEquipment),
                trade: fits(tradeInventory, 'recipient after unequip'), afterSwap: fits(afterSwap, 'recipient after swap'),
                afterEquip: fits(afterInventory, 'recipient after equipment'),
                helperStaged: fits(reserve, 'helper top-up maximum reserve'),
                helperAfterSwap: fits([...subtract(reserve, receive), ...takeBacks], 'helper retained top-up reserve plus returns'),
            };
            if (row.need === null) fail('Unknown needAtStart');
            const freeAfterReturns = 28 - fixtureSlots(subtract(tradeInventory, takeBacks));
            if (freeAfterReturns < row.need) fail('Recipient has ' + freeAfterReturns + ' free after returns against canonical needAtStart ' + row.need);
            return {
                onRequest, status: rowId === 'H4m' ? 'mechanical-only-not-accepted' : 'mechanical-only', scoredArrivalAccepted: false,
                ...delivery, receivingArea: receivingArea(rowId, delivery.at, o.itinerary), ledger,
                beforeInventory, beforeEquipment, tradeInventory, takeBacks, receive: merge(receive),
                afterInventory, afterEquipment, give: takeBacks.map(i => ({ item: i.id, n: i.count })),
                want: merge(receive).map(i => ({ item: i.id, amount: i.count })),
                topUpAsk: ask.length ? { scope: { step: rowId, family: 'mule' }, items: ask } : null,
                reserve: merge(reserve), helperBeforeInventory: merge(reserve),
                helperAfterInventory: merge([...subtract(reserve, receive), ...takeBacks]), slots, overrides,
            };
        }, null);
        if (fixture) result.fixtures.push(fixture);
        else result.unresolved.push({ row: rowId, reasons: [...new Set(reasons)] });
    }
    // Read carry selection from the production generator; do not duplicate its row policy.
    for (let i = 0; i + 1 < o.rows.length; i++) {
        const first = result.fixtures.find(f => f.row === o.rows[i]);
        const next = result.fixtures.find(f => f.row === o.rows[i + 1]);
        if (!first || !next || westOfTaverley(first.at) !== westOfTaverley(next.at)) continue;
        try {
            const generated = muleRunOptions([first.ledger, next.ledger], '/lab-fixture-only', {
                deliveryRun: 'lab-fixture-only', serve: 'lab-fixture-recipient', itinerary: o.itinerary,
            });
            if (!generated.packages[0]!.carryNext) continue;
            const before = merge([...first.reserve, ...next.reserve]);
            const after = merge([...subtract(before, first.receive), ...first.takeBacks]);
            const nextAfter = merge([...subtract(after, next.receive), ...next.takeBacks]);
            const staged = fits(before, first.row + ' carry staging');
            const retained = fits(after, first.row + ' carry reserve plus returns');
            const final = fits(nextAfter, next.row + ' carry completion');
            first.carryNext = next.row;
            first.helperBeforeInventory = before;
            first.helperAfterInventory = after;
            first.slots.helperStaged = staged;
            first.slots.helperAfterSwap = retained;
            next.helperBeforeInventory = after;
            next.helperAfterInventory = nextAfter;
            next.slots.helperStaged = retained;
            next.slots.helperAfterSwap = final;
        } catch (error) {
            result.fixtures = result.fixtures.filter(f => f !== first && f !== next);
            for (const f of [first, next]) result.unresolved.push({ row: f.row, reasons: ['Canonical delivery/carry capacity: ' + (error as Error).message] });
        }
    }
    if (!result.unresolved.length) {
        result.ok = true;
        result.bankSeed = merge(result.fixtures.flatMap(f => f.reserve.map(i => concrete(i.bankId, i.count, o.pack, catalog))));
        result.seedBatches = fixtureSeedBatches(result.bankSeed, o.pack, catalog);
    }
    return result;
}
