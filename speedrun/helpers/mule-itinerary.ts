import { SPELLS, type Area } from '../lib/travel';
import { westOfTaverley } from '../lib/kandarin';
import { ARRIVAL as PLAGUE_CITY_ARRIVAL } from '../quests/plague-city';
import { TILES } from '../runner/legs';
import { BANDS } from '../skills/thieving';
import { BANKS } from './questitems';
import { worldTile, type WorldTile } from './mule-readiness';

export type { WorldTile } from './mule-readiness';

export interface ItineraryOptions {
    /** The canonical firemaking geometry is run-config data, not a fixed coop tile. */
    rehearsal?: { firemakingEnd: WorldTile };
}

export interface MuleDelivery {
    row: string;
    at: WorldTile;
    bank: WorldTile;
}

const ground = (tile: Area): WorldTile => worldTile({ x: tile.x, z: tile.z, level: tile.level ?? 0 });
// BANKS is the canonical ground-level booth roster; no second bank coordinate map.
const [draynor, faladorWest, , varrockWest, , , ardougneSouth, ardougneNorth, seers] = BANKS;
const bank = (tile: typeof draynor): WorldTile => {
    if (!tile) throw new Error('Canonical ground-level bank roster is incomplete');
    return ground(tile);
};

/** SUPPLIES section 1's helper tile, west of the teleport spread, not the S16 cellar. */
const ardougneHelper = ground({ ...SPELLS.ardougne.landing, x: SPELLS.ardougne.landing.x - 3 });
const knights = BANDS.find(b => b.stunPack)?.anchors[0];
if (!knights) throw new Error('S18 has no canonical stun-pack anchor');

/**
 * Helper meeting tiles, not teleport destinations or the runner's tolerance boxes.
 * SUPPLIES section 1 overrides leg centres at Doric and the Champions' Guild door.
 * Banks are staging choices, not claims that the route fits its scored window.
 */
const DELIVERIES: Readonly<Record<string, { at: WorldTile; bank: WorldTile }>> = {
    H1: { at: ground(TILES.lumbridgeSpawn), bank: bank(draynor) },
    H4: { at: ground({ ...TILES.doric, x: TILES.doric.x - 1 }), bank: bank(faladorWest) },
    // The leg centre is a tree (loc 1278); the approved helper stand is southwest, within tol 1.
    H4k: { at: ground({ ...TILES.taverleyNormals, x: TILES.taverleyNormals.x - 1, z: TILES.taverleyNormals.z - 1 }), bank: bank(faladorWest) },
    H6: { at: ground(PLAGUE_CITY_ARRIVAL), bank: bank(ardougneNorth) },
    H4p: { at: ground(TILES.zooIron), bank: bank(ardougneSouth) },
    H7: { at: ground(TILES.elkoy), bank: bank(ardougneSouth) },
    H8: { at: ground(TILES.grandTreeDoor), bank: bank(ardougneNorth) },
    H9: { at: ardougneHelper, bank: bank(ardougneSouth) },
    H10: { at: ardougneHelper, bank: bank(ardougneSouth) },
    H12: { at: ground(TILES.grandTreeDoor), bank: bank(ardougneNorth) },
    H13: { at: ardougneHelper, bank: bank(ardougneSouth) },
    H14: { at: ground(knights), bank: bank(ardougneSouth) },
    H15: { at: ground(TILES.caroline), bank: bank(ardougneSouth) },
    H16: { at: ground(TILES.fishingContest), bank: bank(seers) },
    H18: { at: ground(TILES.flySpots), bank: bank(draynor) },
    H19: { at: ground(TILES.cook), bank: bank(draynor) },
    H20: { at: ground(TILES.rustyAnchor), bank: bank(draynor) },
    H21d: { at: ground(TILES.westBooth), bank: bank(varrockWest) },
    // North of SCORED, away from the guild door: deliveryTradeReach refuses a door beside either trader.
    H22: { at: ground({ ...TILES.championsGuild, z: TILES.championsGuild.z + 1 }), bank: bank(varrockWest) },
    H4e: { at: ground(TILES.taverleyWillows), bank: bank(faladorWest) },
    H4m: { at: ground({ ...TILES.zooIron, x: TILES.zooIron.x + 1, z: TILES.zooIron.z - 1 }), bank: bank(ardougneSouth) },
};

/** Shared by the scored runner and helper generator. Unknown rows never fall back to Varrock. */
export function muleDelivery(row: string, options: ItineraryOptions = {}): MuleDelivery {
    if (row === 'H3') {
        if (!options.rehearsal) throw new Error('H3 is owned by ring givers in production; an explicit rehearsal itinerary is required');
        return { row, at: worldTile(options.rehearsal.firemakingEnd, 'H3 canonical firemaking end'), bank: bank(draynor) };
    }
    const entry = Object.hasOwn(DELIVERIES, row) ? DELIVERIES[row] : undefined;
    if (!entry) throw new Error(`No canonical mule delivery for ${row}`);
    return { row, at: { ...entry.at }, bank: { ...entry.bank } };
}

/** A selected itinerary is nonempty and names each row once, in the caller's ledger order. */
export function muleItinerary(rows: readonly string[], options: ItineraryOptions = {}): MuleDelivery[] {
    if (!rows.length) throw new Error('Delivery requires a nonempty itinerary');
    if (new Set(rows).size !== rows.length) throw new Error('Duplicate delivery row in selected itinerary');
    return rows.map(row => muleDelivery(row, options));
}


export interface MuleTopologyConflict {
    fromRow: string;
    toRow: string;
    from: WorldTile;
    to: WorldTile;
    kind: 'staging' | 'ordered' | 'conditional';
}

/**
 * Cross-region travel has no approved low-level mule route. Inspect every staging leg,
 * successive ordered deliveries, and both sides of every possible conditional insertion.
 * This is a necessary safety gate, not proof of reachability within either region.
 */
export function muleTopologyConflicts(selected: readonly (MuleDelivery & { onRequest?: boolean })[]): MuleTopologyConflict[] {
    const conflicts: MuleTopologyConflict[] = [];
    const add = (fromRow: string, from: WorldTile, toRow: string, to: WorldTile, kind: MuleTopologyConflict['kind']) => {
        if (westOfTaverley(from) !== westOfTaverley(to)) conflicts.push({ fromRow, toRow, from, to, kind });
    };
    for (const entry of selected) add(entry.row, entry.bank, entry.row, entry.at, 'staging');
    const ordered = selected.filter(p => !p.onRequest);
    for (let i = 1; i < ordered.length; i++) {
        const previous = ordered[i - 1]!;
        const next = ordered[i]!;
        add(previous.row, previous.at, next.row, next.bank, 'ordered');
    }
    for (const from of selected) {
        for (const to of selected) {
            if (from !== to && (from.onRequest || to.onRequest)) add(from.row, from.at, to.row, to.bank, 'conditional');
        }
    }
    return conflicts;
}

export function assertMuleTopology(selected: readonly (MuleDelivery & { onRequest?: boolean })[]): void {
    const conflicts = muleTopologyConflicts(selected);
    if (conflicts.length) {
        throw new Error('Unsafe cross-region mule delivery: ' + conflicts.map(c => `${c.fromRow} -> ${c.toRow} (${c.kind})`).join(', ')
            + '; select region-consistent itineraries for explicitly approved prepositioned carriers');
    }
}
