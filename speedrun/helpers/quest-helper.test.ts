import { describe, expect, test } from 'bun:test';
import type { BotWorldState, InventoryItem } from '../../sdk/types';
import { baseState } from '../lib/fake-sdk';
import * as grandTree from '../quests/grand-tree';
import * as tgv from '../quests/tree-gnome-village';
import { ROUTES } from '../skills/agility';
import { ARMOUR, gtPlan, KIT_COINS, KIT_SHARKS, kitCheck, kitWithdraws, mmPlan, nearestWaypoint, parsePhases, PHASES, ROYAL_SEAL, TGV_KIT, tgvPlan, type QuestPlan } from './quest-helper';

let slot = 0;
const item = (name: string, count = 1, id = 9000 + slot): InventoryItem => ({ slot: slot++, id, name, count, optionsWithIndex: [] }) as unknown as InventoryItem;
const state = (over: Partial<BotWorldState> = {}): BotWorldState => {
    slot = 0;
    return baseState({ tick: 1, ...over });
};
const at = (x: number, z: number, level = 0) => ({ name: 'h', x, z, worldX: x, worldZ: z, level, hp: 99, maxHp: 99 }) as BotWorldState['player'];

const letters = (stepId: string, names: string[]) => names.map(n => new RegExp(`^${stepId}:([A-Z][0-9]?)-`).exec(n)?.[1]);

describe('the plans name real segments, exactly the ruled ones', () => {
    const check = (plan: QuestPlan, stepId: string, names: string[], subs: string[], legs: string[]) => {
        const real = letters(stepId, names);
        expect(Object.keys(plan.substitute).sort()).toEqual([...subs].sort());
        expect(Object.keys(plan.legs).sort()).toEqual([...legs].sort());
        for (const k of [...subs, ...legs]) expect(real).toContain(k);
    };

    test('Tree Gnome Village: A, B, H, K substituted, no legs', () => {
        check(tgvPlan(), tgv.stepId, tgv.steps({ dialogue: 'fixed' }).map(s => s.name), ['A', 'B', 'H', 'K'], []);
    });

    test('The Grand Tree: A, I, N1, N2 substituted; legs before B, C and J', () => {
        check(gtPlan(), grandTree.stepId, grandTree.steps({ dialogue: 'fixed' }).map(s => s.name), ['A', 'I', 'N1', 'N2'], ['B', 'C', 'J']);
    });

    test('Monkey Madness: only A', () => {
        // The MM module is pinned off main (rs/185's e5161ba4), so only the plan's own shape is held here.
        expect(Object.keys(mmPlan().substitute)).toEqual(['A']);
        expect(Object.keys(mmPlan().legs)).toEqual([]);
    });
});

describe('kitCheck', () => {
    const kit = (logs: number, sharks: number, weapon = true) =>
        state({ inventory: [...Array.from({ length: logs }, () => item('Logs')), item('Shark', 1), ...Array.from({ length: sharks - 1 }, () => item('Shark'))], equipment: weapon ? [item('Rune scimitar')] : [] });

    test('passes with the logs, the sharks and the scimitar worn', () => {
        expect(kitCheck(kit(6, TGV_KIT.sharks), TGV_KIT)).toBe(true);
    });
    test('names what is short', () => {
        expect(kitCheck(kit(5, TGV_KIT.sharks), TGV_KIT)).toMatch(/5 logs, needs 6/);
        expect(kitCheck(kit(6, 3), TGV_KIT)).toMatch(/3 sharks/);
        expect(kitCheck(kit(6, TGV_KIT.sharks, false), TGV_KIT)).toMatch(/not worn/);
    });
    test('an adamant longsword serves as the weapon (no rune scimitar on the demo)', () => {
        const s = state({ inventory: [...Array.from({ length: 6 }, () => item('Logs')), ...Array.from({ length: TGV_KIT.sharks }, () => item('Shark'))], equipment: [item('Adamant longsword')] });
        expect(kitCheck(s, TGV_KIT)).toBe(true);
    });
});

describe('kitWithdraws', () => {
    const names = (s: BotWorldState) => kitWithdraws(s).map(w => [String(w.item), w.n]);
    test('an empty pack takes the sharks, the weapon, the axe and the fares', () => {
        expect(names(state({ inventory: [], equipment: [] }))).toEqual([[String(/^Shark$/i), KIT_SHARKS], [String(/^(Rune scimitar|Adamant longsword)$/i), 1], ...ARMOUR.map(a => [String(a), 1]), [String(/^Bronze axe$/i), 1], [String(/^Coins$/i), KIT_COINS]]);
    });
    test('only the shortfall, no axe once the logs are held, nothing for a worn weapon', () => {
        const s = state({ inventory: [item('Shark', 1), ...Array.from({ length: 6 }, () => item('Logs')), item('Coins', 1000)], equipment: [item('Adamant longsword'), item('Adamant chainbody'), item('Adamant platelegs'), item('Adamant full helm')] });
        expect(names(s)).toEqual([[String(/^Shark$/i), KIT_SHARKS - 1]]);
    });
});

describe('substituted checks replace SCORED-only gates', () => {
    test("TGV A: the helper's kit, not H7 (no staff of fire, no runes, Prayer 1)", () => {
        const s = state({
            quests: { tree: 'not_started' } as unknown as BotWorldState['quests'],
            inventory: [...Array.from({ length: 6 }, () => item('Logs')), ...Array.from({ length: TGV_KIT.sharks }, () => item('Shark'))],
            equipment: [item('Rune scimitar')],
            player: at(tgv.ARRIVAL.x, tgv.ARRIVAL.z),
        });
        const a = tgvPlan().substitute.A!;
        expect(a.preconditions!(s, {})).toBe(true);
        expect(a.postconditions!(s, {})).toBe(true);
        expect(tgv.kitCheck(s)).not.toBe(true);
    });

    test('GT A: needs TGV complete and the tree door, not Plague City, Magic or Prayer', () => {
        const a = gtPlan().substitute.A!;
        const door = at(grandTree.TILES.arrival.x, grandTree.TILES.arrival.z);
        expect(a.preconditions!(state({ quests: { tree: 'complete', grandtree: 'not_started' } as unknown as BotWorldState['quests'], player: door }), {})).toBe(true);
        expect(a.preconditions!(state({ quests: { tree: 'started', grandtree: 'not_started' } as unknown as BotWorldState['quests'], player: door }), {})).toMatch(/Tree Gnome Village/);
        expect(a.preconditions!(state({ quests: { tree: 'complete', grandtree: 'not_started' } as unknown as BotWorldState['quests'], player: at(3200, 3200) }), {})).toMatch(/not at the Grand Tree door/);
    });

    test('MM A: both prerequisite quests complete, MM not started (or the seal already held)', () => {
        const a = mmPlan().substitute.A!;
        const q = (mm: string) => ({ tree: 'complete', grandtree: 'complete', mm }) as unknown as BotWorldState['quests'];
        expect(a.preconditions!(state({ quests: q('not_started') }), {})).toBe(true);
        expect(a.preconditions!(state({ quests: q('started') }), {})).toMatch(/Monkey Madness is started/);
        expect(a.preconditions!(state({ quests: q('started'), inventory: [item('Royal seal', 1, ROYAL_SEAL)] }), {})).toBe(true);
        expect(a.preconditions!(state({ quests: { tree: 'complete', grandtree: 'started', mm: 'not_started' } as unknown as BotWorldState['quests'] }), {})).toMatch(/Grand Tree/);
    });
});

describe('parsePhases', () => {
    test('the whole climb by default order, or any in-order subset', () => {
        expect(parsePhases(PHASES.join(','))).toEqual([...PHASES]);
        expect(parsePhases('grandtree, mm')).toEqual(['grandtree', 'mm']);
        expect(parsePhases('kit,logs,agility')).toEqual(['kit', 'logs', 'agility']);
    });
    test('refuses unknown, repeated or out-of-order phases', () => {
        expect(() => parsePhases('agility,plague')).toThrow(/unknown phase "plague"/);
        expect(() => parsePhases('tree,tree')).toThrow(/named twice/);
        expect(() => parsePhases('grandtree,tree')).toThrow(/out of order/);
    });
});

describe('nearestWaypoint', () => {
    test('joins the agility route where it passes nearest, not at Lumbridge', () => {
        const route = ROUTES.spawnToGnome;
        // The Grand Exchange: the route's Falador stretch (Chebyshev 200), not its Lumbridge start.
        const i = nearestWaypoint(route, { x: 3165, z: 3487 });
        expect(i).toBeGreaterThan(0);
        expect(route[i]).toEqual([3000, 3287]);
        expect(nearestWaypoint(route, { x: 3201, z: 3237 })).toBe(0);
    });
});
