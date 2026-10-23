// Dragon Slayer (S26) on the lab: a fixture per segment start at the post-Monkey-Madness levels
// (STEP-MANIFEST.md entry 13: Attack 99, Strength ~97, Defence ~89; HP ~97, Magic 99 and Prayer ~99
// from RUN-ORDER.md's S15-S18 rows), H22's items spawned, and the acceptance runner.
//
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> speedrun/lab/quests/dragon-slayer.ts:--from=A:--until=L:--runs=3:--dialogue=both:--launch
//
// --death=1 with --from=L kills the account outside Elvarg's gate (::~death) before the run, then
// spawns the death re-supply at the Lumbridge respawn in place of the helper's trade, so segment L
// measures the return route.
//
// Scavvo's runiteshop is shared and holds one chainbody and one pair of platelegs with an hour's
// restock (champions_guild.inv), so before a run that starts in A-C the fixture sells a pair back to
// him. Lab only: staff commands.
//
// H22 fills all 28 slots until the standard fixture wears the kit (it gives everything before it
// wears anything), so what a segment holds beyond H22 (the m'speak amulet, the rune armour, Melzar's
// key) is a fixture's `late` part, given and worn after that wear. dragon-slayer.test.ts counts every
// fixture's slots both ways.

import { QUESTS, ROUTE_QUESTS } from '../../data/quest-stages';
import { act, wield } from '../../lib/act';
import type { Session } from '../../lib/session';
import { waitTicks, waitUntil } from '../../lib/wait';
import { configId, opIndex, waitForNpc } from '../../lib/world';
import * as ds from '../../quests/dragon-slayer';
import { arg } from '../common';
import { cheat, give, mustTele, setStats } from '../setup';
import { applyFixture, labMain, type QuestFixture } from './run';

const LEVELS = { attack: 99, strength: 97, defence: 89, hitpoints: 97, magic: 99, prayer: 99, ranged: 54, agility: 75 } as const;

/**
 * The route's other quests complete (32 QP: login recounts %qp from the quest varps, so setting qp
 * itself does not survive the fixture's relog).
 */
const ROUTE_DONE: Record<string, number> = Object.fromEntries(
    ROUTE_QUESTS.filter(k => k !== 'dragon' && QUESTS[k].questPoints > 0).map(k => [QUESTS[k].varp.name, QUESTS[k].complete.value]),
);

/** Every Dragon Slayer varp, reset to `stage`'s values. */
const vars = (dragonquest: number, extra: Record<string, number> = {}) => ({
    ...ROUTE_DONE, dragonquest, dragon_oracle: 0, dragon_goblin: 0, dragon_shield: 0, dragonquestvar: 0, dragon_ned_hired: 0, dragon_wall: 0, ...extra,
});
const BRIEFED = { dragon_oracle: 1, dragon_goblin: 1, dragon_shield: 1 } as const;

/** The mithril scimitar (H11) is the expected case; --weapon=rune prices the GE bid filling (main, 20:52). */
const WEAPON = arg('weapon', 'mithril') === 'rune' ? 'rune_scimitar' : 'mithril_scimitar';
/** --armour=none: Elvarg without the rune chainbody and platelegs, Scavvo's stock-0 'go on' branch. */
const NO_ARMOUR = arg('armour', 'rune') === 'none';
const WORN_KIT = [WEAPON, 'adamant_full_helm', 'amulet_of_strength'] as const;
const RUNE_ARMOUR = ['rune_chainbody', 'rune_platelegs'] as const;
const ARMOUR: readonly string[] = NO_ARMOUR ? [] : RUNE_ARMOUR;
const MAGIC_DOOR_ITEMS = { wizards_mind_bomb: 1, silk: 1, lobster_pot: 1, bowl_unfired: 1 } as const;
const HULL = { woodplank: 3, nails: 12, hammer: 1 } as const;
const RUNES_LUMBRIDGE = { lawrune: 1, airrune: 3, earthrune: 1 } as const;
const RUNES_FALADOR = { lawrune: 1, airrune: 3, waterrune: 1 } as const;
/** H22 also carries T26-27's Ardougne cast (the inventory ledger's H22 row); T25-26 is a run, so no Varrock set (rs/464; fold-in 28). */
const RUNES_LEGS = { lawrune: 2, waterrune: 2 } as const;
/** Swapped off at H22 and dropped in S26's B. */
const MSPEAK = 'mm_amulet_of_monkey_speak';
export const add = (...parts: Array<Readonly<Record<string, number>>>): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const p of parts) for (const [k, v] of Object.entries(p)) out[k] = (out[k] ?? 0) + v;
    return out;
};
const wear = (list: readonly string[]) => Object.fromEntries(list.map(k => [k, 1]));

const QUEST_COINS = ds.QUEST_COINS + ds.SCAVVO.chainbody + ds.SCAVVO.platelegs;

/** H22 as the step receives it (the quest items first: a full inventory drops a give silently). */
const H22 = add(MAGIC_DOOR_ITEMS, HULL, RUNES_LUMBRIDGE, RUNES_FALADOR, RUNES_LEGS, { coins: QUEST_COINS, shark: 10 }, wear(WORN_KIT));

/** Given (then worn, for `worn`) after the standard fixture has worn its own `worn`. */
export interface LateItems {
    items: Readonly<Record<string, number>>;
    worn?: readonly string[];
}
export type DsFixture = QuestFixture & { late?: LateItems };

const fixture = (letter: string, f: Omit<DsFixture, 'letter' | 'levels'>): DsFixture => ({ letter, levels: LEVELS, ...f });

const MSPEAK_LATE: LateItems = { items: { [MSPEAK]: 1 } };
const ARMOUR_LATE: LateItems = { items: wear(ARMOUR), worn: ARMOUR };
const H22_LESS_ARMOUR = add(H22, { coins: -ds.SCAVVO.chainbody - ds.SCAVVO.platelegs });

export const FIXTURES: DsFixture[] = [
    fixture('A', { vars: vars(0), items: H22, worn: WORN_KIT, late: MSPEAK_LATE, tile: ds.TILES.arrival, note: 'arrival, H22 held' }),
    fixture('B', { vars: vars(0), items: H22, worn: WORN_KIT, late: MSPEAK_LATE, tile: ds.TILES.arrival }),
    fixture('C', { vars: vars(1), items: H22, worn: WORN_KIT, tile: { x: 3191, z: 3361 } }),
    // Beside the guild stairs (a 2x2 loc at 3188,3355 whose tiles are blocked).
    fixture('D', { vars: vars(1), items: H22_LESS_ARMOUR, worn: WORN_KIT, late: ARMOUR_LATE, tile: { x: 3190, z: 3356 } }),
    fixture('E', { vars: vars(2, BRIEFED), items: H22_LESS_ARMOUR, worn: WORN_KIT, late: { ...ARMOUR_LATE, items: add(ARMOUR_LATE.items, { melzarkey: 1 }) }, tile: { x: 3068, z: 3516 } }),
    fixture('F', { vars: vars(2, { ...BRIEFED, dragon_oracle: 3 }), items: add(HULL, RUNES_LUMBRIDGE, RUNES_FALADOR, { coins: ds.QUEST_COINS, shark: 10, melzarkey: 1, mappart3: 1 }, wear(WORN_KIT), wear(ARMOUR)), worn: [...WORN_KIT, ...ARMOUR], tile: { x: 3056, z: 9841 } }),
    fixture('G', { vars: vars(2, { ...BRIEFED, dragon_oracle: 3 }), items: add(HULL, RUNES_FALADOR, { coins: ds.QUEST_COINS, shark: 10, melzarkey: 1, mappart3: 1, antidragonbreathshield: 1 }, wear(WORN_KIT), wear(ARMOUR)), worn: [...WORN_KIT, ...ARMOUR, 'antidragonbreathshield'], tile: { x: 3211, z: 3220, level: 1 } }),
    fixture('H', { vars: vars(2, { ...BRIEFED, dragon_oracle: 3 }), items: add(HULL, { coins: ds.QUEST_COINS, shark: 10, melzarkey: 1, mappart3: 1, mappart1: 1, antidragonbreathshield: 1 }, wear(WORN_KIT), wear(ARMOUR)), worn: [...WORN_KIT, ...ARMOUR, 'antidragonbreathshield'], tile: ds.TILES.mazeOutside }),
    // The jail corridor, where H leaves the player (wormbrain.rs2's railings): the tiles just north,
    // (3014,3189) among them, are a closed room with no path out.
    fixture('I', { vars: vars(2, { ...BRIEFED, dragon_oracle: 3 }), items: add(HULL, { coins: 2000, shark: 10, melzarkey: 1, dragonmap: 1, antidragonbreathshield: 1 }, wear(WORN_KIT), wear(ARMOUR)), worn: [...WORN_KIT, ...ARMOUR, 'antidragonbreathshield'], tile: { x: 3012, z: 3186 } }),
    fixture('J', { vars: vars(7, { ...BRIEFED, dragon_oracle: 3, dragonquestvar: 3 }), items: add({ shark: 10, melzarkey: 1, dragonmap: 1, antidragonbreathshield: 1 }, wear(WORN_KIT), wear(ARMOUR)), worn: [...WORN_KIT, ...ARMOUR, 'antidragonbreathshield'], tile: ds.TILES.dock }),
    fixture('K', { vars: vars(8, { ...BRIEFED, dragon_oracle: 3, dragonquestvar: 3, dragon_ned_hired: 1 }), items: add({ shark: 10, melzarkey: 1, antidragonbreathshield: 1 }, wear(WORN_KIT), wear(ARMOUR)), worn: [...WORN_KIT, ...ARMOUR, 'antidragonbreathshield'], tile: { x: 3100, z: 3257 } }),
    fixture('L', { vars: vars(9, { ...BRIEFED, dragon_oracle: 3 }), items: add({ shark: 10, melzarkey: 1, antidragonbreathshield: 1 }, wear(WORN_KIT), wear(ARMOUR)), worn: [...WORN_KIT, ...ARMOUR, 'antidragonbreathshield'], tile: ds.TILES.lairGateOutside }),
];

/** Pack slots `items` take once `worn` is on: one per stack, one per unit otherwise. */
export function packSlots(items: Readonly<Record<string, number>>, worn: readonly string[], stackable: (obj: string) => boolean): number {
    let slots = 0;
    for (const [k, n] of Object.entries(items)) {
        const held = n - worn.filter(w => w === k).length;
        slots += stackable(k) ? (held > 0 ? 1 : 0) : Math.max(0, held);
    }
    return slots;
}

/** Give a fixture's late items, check them held by config id, and wear its late worn items. */
async function applyLate(session: Session, letter: string, late: LateItems): Promise<void> {
    const sdk = session.sdk;
    for (const [k, n] of Object.entries(late.items)) await give(sdk, k, n);
    const held = sdk.getState()?.inventory ?? [];
    for (const [k, n] of Object.entries(late.items)) {
        const id = configId('obj', k);
        const have = held.filter(i => i.id === id).reduce((a, i) => a + i.count, 0);
        if (have < n) throw new Error(`fixture ${letter}: gave ${n} ${k} after the wear, holding ${have}`);
    }
    for (const w of late.worn ?? []) {
        const r = await wield(sdk, configId('obj', w));
        if (!r.ok) throw new Error(`fixture ${letter}: could not wear ${w}`);
    }
}

/** Put one chainbody and one pair of platelegs back in Scavvo's shared stock, by selling a spawned pair to him. */
async function restockScavvo(session: Session): Promise<void> {
    const sdk = session.sdk;
    await mustTele(sdk, 3190, 3352, 1);
    const scavvo = await waitForNpc(sdk, /^Scavvo$/i, 10);
    if (!scavvo) throw new Error('restock: Scavvo not in sight');
    const r = await act(sdk, () => sdk.sendInteractNpc(scavvo.index, opIndex(scavvo, /^trade$/i) ?? 3), s => s.shop.isOpen, { maxTicks: 20 });
    if (!r.ok) throw new Error('restock: Scavvo\'s shop did not open');
    const stock = (re: RegExp) => sdk.getState()!.shop.shopItems.find(i => re.test(i.name))?.count ?? 0;
    const missing = RUNE_ARMOUR.filter((_, i) => stock(i === 0 ? ds.ITEM.chainbody : ds.ITEM.platelegs) < 1);
    if (missing.length) {
        await sdk.sendCloseShop();
        await give(sdk, [...missing]);
        await act(sdk, () => sdk.sendInteractNpc(scavvo.index, opIndex(scavvo, /^trade$/i) ?? 3), s => s.shop.isOpen, { maxTicks: 20 });
        for (const it of sdk.getState()!.shop.playerItems.filter(p => /^Rune (chainbody|platelegs)$/i.test(p.name))) await sdk.sendShopSell(it.slot, 1);
        await waitUntil(sdk, () => stock(ds.ITEM.chainbody) >= 1 && stock(ds.ITEM.platelegs) >= 1, { maxTicks: 10 });
    }
    console.log(`restock: Scavvo holds ${stock(ds.ITEM.chainbody)} chainbody, ${stock(ds.ITEM.platelegs)} platelegs`);
    await sdk.sendCloseShop();
    await waitTicks(sdk, 1);
}

const DEATH = arg('death', '0') === '1';

/** The death re-supply (ds.DEATH_KIT) as obj debug names, given where the helper's trade would land. */
const DEATH_ITEMS = { [WEAPON]: 1, shark: 8, woodplank: 3, nails: 12, hammer: 1 } as const;

if (import.meta.main) await labMain<ds.Options>({
    title: 'Dragon Slayer (S26), from the arrival tile (3191,3364)',
    stepId: ds.stepId,
    steps: o => ds.steps(o),
    fixtures: FIXTURES,
    reference: ds.REFERENCE,
    // The rune scimitar and armour need their levels before the standard fixture wears them.
    async applyFixture(session, f) {
        await setStats(session.sdk, { ...LEVELS });
        await applyFixture(session, f);
        const late = (f as DsFixture).late;
        if (late) await applyLate(session, f.letter, late);
        // The ledger's S26 start: H22 and the m'speak amulet, 3 free.
        if (['A', 'B'].includes(f.letter)) {
            const free = 28 - session.sdk.getState()!.inventory.length;
            console.log(`fixture ${f.letter}: ${free} free slots`);
        }
    },
    async prepare(session, f) {
        const sdk = session.sdk;
        if (['A', 'B', 'C'].includes(f.letter)) {
            await restockScavvo(session);
            await mustTele(sdk, f.tile.x, f.tile.z, f.tile.level ?? 0);
        }
        await waitTicks(sdk, 2);
        if (f.letter === 'L' && DEATH) {
            await cheat(sdk, '~death');
            await waitUntil(sdk, s => !s.player?.isDead && (s.player?.worldZ ?? 0) < 4000, { maxTicks: 30 });
            await waitTicks(sdk, 3);
            console.log('death: kept', JSON.stringify([...sdk.getState()!.inventory, ...sdk.getState()!.equipment].map(i => i.name)), 'at', sdk.getState()!.player?.worldX, sdk.getState()!.player?.worldZ);
            for (const [k, n] of Object.entries(DEATH_ITEMS)) await give(sdk, k, n);
        }
    },
});

