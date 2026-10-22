// Sea travel between the mainland (Misthalin and Asgarnia), Karamja and
// Kandarin, for accounts without the levels or quests that open the land
// routes. Every fare is 30 coins:
//
//   Port Sarim -> Karamja (Musa Point)   a Port Sarim sailor  (sailors.rs2)
//   Musa Point -> Port Sarim             the customs officer  (customs_officer.rs2)
//   Brimhaven  -> Ardougne               the customs officer  (customs_officer.rs2)
//   Ardougne   -> Brimhaven              Captain Barnaby      (captain_barnaby.rs2)
//
// So the mainland and Kandarin are two voyages apart through Karamja, with the
// walk across the island (Musa Point to Brimhaven, ~205 tiles) in between. The
// land route over White Wolf Mountain is speedrun/lib/kandarin.ts; it needs
// about 30 Hitpoints and carries the risk of a death, which these ships don't.
//
// A ship lands on its deck (level 1), and the gangplank takes you ashore
// (gangplank.rs2).
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState } from '../../sdk/types';
import { classifyPage } from './dialogue';
import { waitUntil } from './wait';

export interface Tile {
    x: number;
    z: number;
}

export type Region = 'mainland' | 'karamja' | 'kandarin';

export const FARE = 30;

/**
 * Which land mass a tile is on. Underground tiles count as the surface above
 * them. Karamja is the island south of Port Sarim and Rimmington (Musa Point,
 * Brimhaven, Tai Bwo Wannai); Kandarin is everything west of White Wolf
 * Mountain that is not Karamja (Ardougne, Port Khazard, Yanille, Hemenster,
 * Seers' Village, Catherby, the Gnome Stronghold, the Barbarian Outpost).
 * Small islands (Entrana, Crandor, Ape Atoll) are not modelled.
 */
export function regionOf(t: Tile): Region {
    const x = t.x;
    const z = t.z > 6400 ? t.z - 6400 : t.z;
    // Rimmington's south shore is at z ~3190, east of x 2900; Brimhaven's docks reach z 3235.
    if (x >= 2690 && z >= 2880 && ((x <= 2970 && z < 3190) || (x < 2900 && z <= 3240))) return 'karamja';
    if (x < 2850) return 'kandarin';
    return 'mainland';
}

export interface Voyage {
    name: string;
    from: Region;
    to: Region;
    /** Where to stand to talk to whoever sells the passage. */
    dock: Tile;
    /** Ashore at the far end, past the gangplank (approximately). */
    lands: Tile;
    npc: RegExp;
    /** Answers to the passage dialogue's choices, in any order. */
    answers: RegExp[];
}

const CUSTOMS_ANSWERS = [/journey on this ship/i, /search away/i, /^ok\.?$/i];

export const VOYAGES: readonly Voyage[] = [
    { name: 'Port Sarim to Karamja', from: 'mainland', to: 'karamja', dock: { x: 3029, z: 3218 }, lands: { x: 2954, z: 3146 }, npc: /^(seaman lorris|seaman thresnor|captain tobias)$/i, answers: [/^yes please/i] },
    { name: 'Musa Point to Port Sarim', from: 'karamja', to: 'mainland', dock: { x: 2954, z: 3148 }, lands: { x: 3029, z: 3217 }, npc: /^customs officer$/i, answers: CUSTOMS_ANSWERS },
    { name: 'Brimhaven to Ardougne', from: 'karamja', to: 'kandarin', dock: { x: 2772, z: 3228 }, lands: { x: 2681, z: 3270 }, npc: /^customs officer$/i, answers: CUSTOMS_ANSWERS },
    { name: 'Ardougne to Brimhaven', from: 'kandarin', to: 'karamja', dock: { x: 2681, z: 3276 }, lands: { x: 2772, z: 3232 }, npc: /^captain barnaby$/i, answers: [/^yes please/i] }
];

/** The fewest voyages from one region to another (empty when they are the same). */
export function voyagesBetween(from: Region, to: Region): Voyage[] {
    if (from === to) return [];
    const prev = new Map<Region, Voyage>();
    const queue: Region[] = [from];
    while (queue.length > 0) {
        const r = queue.shift()!;
        for (const v of VOYAGES) {
            if (v.from !== r || v.to === from || prev.has(v.to)) continue;
            prev.set(v.to, v);
            if (v.to === to) {
                const path: Voyage[] = [];
                for (let at: Region = to; at !== from; at = prev.get(at)!.from) path.unshift(prev.get(at)!);
                return path;
            }
            queue.push(v.to);
        }
    }
    throw new Error(`no voyage from ${from} to ${to}`);
}

export interface Sailor {
    bot: BotActions;
    sdk: BotSDK;
    log: (message: string, data?: Record<string, unknown>) => void;
    /** Walk to a tile on the current land mass; throws when it cannot. */
    walk: (t: Tile) => Promise<void>;
}

const here = (s: BotWorldState | null): Tile & { level: number } => ({ x: s?.player?.worldX ?? 0, z: s?.player?.worldZ ?? 0, level: s?.player?.level ?? 0 });
const coins = (s: BotWorldState | null) => (s?.inventory ?? []).filter(i => /^coins$/i.test(i.name)).reduce((a, i) => a + i.count, 0);

/** Take one voyage: walk to its dock, pay, ride, and cross the gangplank ashore. Throws on failure. */
export async function sail(t: Sailor, v: Voyage): Promise<void> {
    const { bot, sdk } = t;
    if (coins(sdk.getState()) < FARE) throw new Error(`${v.name}: needs ${FARE} coins in the inventory`);
    await t.walk(v.dock);
    const t0 = sdk.getState()?.tick ?? 0;
    const departed = (s: BotWorldState) => regionOf(here(s)) === v.to || here(s).level !== 0;
    for (let attempt = 1; attempt <= 3 && !departed(sdk.getState()!); attempt++) {
        const r = await bot.talkTo(v.npc);
        if (!r.success) {
            t.log('voyage: talk failed', { voyage: v.name, attempt, message: r.message });
            await sdk.waitForTicks(3);
            continue;
        }
        // Answer the passage dialogue until the ship has us; the ride itself is a
        // modal (ship_journey) for 7 ticks, then a telejump onto the far deck.
        for (let i = 0; i < 60 && !departed(sdk.getState()!); i++) {
            const s = sdk.getState()!;
            if (s.dialog.isOpen && !s.dialog.isWaiting) {
                if (classifyPage(s.dialog) === 'choice') {
                    const opt = s.dialog.options.find(o => v.answers.some(a => a.test(o.text)));
                    if (!opt) throw new Error(`${v.name}: no answer among ${s.dialog.options.map(o => o.text).join(' | ')}`);
                    await sdk.sendClickDialog(opt.index);
                } else await sdk.sendClickDialog(0);
            } else if (!s.dialog.isOpen && !s.modalOpen && i > 8) break;
            await sdk.waitForTicks(1);
        }
        if (coins(sdk.getState()) < FARE && !departed(sdk.getState()!)) throw new Error(`${v.name}: not enough coins for the fare`);
    }
    const arrived = await waitUntil(sdk, s => regionOf(here(s)) === v.to, { maxTicks: 20 });
    if (!arrived.ok) throw new Error(`${v.name}: never sailed (at ${JSON.stringify(here(sdk.getState()))})`);
    await disembark(t);
    t.log('voyage', { voyage: v.name, ticks: (sdk.getState()?.tick ?? 0) - t0, at: here(sdk.getState()) });
}

/** From a ship's deck (level 1), close the arrival message and cross the gangplank. */
export async function disembark(t: Pick<Sailor, 'bot' | 'sdk'>): Promise<void> {
    const { sdk } = t;
    for (let attempt = 0; attempt < 4 && here(sdk.getState()).level !== 0; attempt++) {
        if (sdk.getState()?.dialog.isOpen) {
            await waitUntil(sdk, s => !s.dialog.isWaiting, { maxTicks: 5 });
            await sdk.sendClickDialog(0);
            await waitUntil(sdk, s => !s.dialog.isOpen, { maxTicks: 5 });
        }
        const plank = sdk
            .getState()!
            .nearbyLocs.filter(l => /gangplank/i.test(l.name) && l.optionsWithIndex.some(o => /cross/i.test(o.text)))
            .sort((a, b) => a.distance - b.distance)[0];
        if (!plank) {
            await sdk.waitForTicks(2);
            continue;
        }
        await sdk.sendInteractLoc(plank.x, plank.z, plank.id, plank.optionsWithIndex.find(o => /cross/i.test(o.text))!.opIndex);
        await waitUntil(sdk, s => here(s).level === 0, { maxTicks: 20 });
    }
    if (here(sdk.getState()).level !== 0) throw new Error(`still on the ship's deck at ${JSON.stringify(here(sdk.getState()))}`);
}

/** Sail from wherever we stand to `to`'s land mass (nothing when already there). */
export async function sailTo(t: Sailor, to: Tile): Promise<void> {
    const from = here(t.sdk.getState());
    for (const v of voyagesBetween(regionOf(from), regionOf(to))) await sail(t, v);
}
