import { describe, expect, test } from 'bun:test';
import { AMULET, bestPickaxe, GEM, ITEM, nextStep, plan, readOpts, withBankKnown, xpForLevel, type Plan, type StepInput } from './jeweller';

const o = readOpts({});
const heldOf = (m: Record<number, number>) => (id: number) => m[id] ?? 0;

describe('xpForLevel', () => {
    test('matches the engine curve (skills/README.md level table, base x 25)', () => {
        expect(xpForLevel(1)).toBe(0);
        expect(xpForLevel(20) / 25).toBeCloseTo(124.2, 0);
        expect(xpForLevel(57) / 25).toBeCloseTo(2143.7, 0);
    });
});

describe('plan', () => {
    test('a fresh account needs every product, training rings and wool for the amulets', () => {
        const p = plan(heldOf({}), 0, o);
        expect(p.products.map(x => `${x.gem} ${x.kind} ${x.remaining}`)).toEqual([
            'sapphire ring 12',
            'emerald ring 27',
            'ruby ring 16',
            'diamond ring 5',
            'sapphire amulet 1',
            'ruby amulet 1'
        ]);
        expect(p.trainingRings).toBe(Math.ceil(xpForLevel(20) / 375));
        expect(p.barsNeeded).toBe(62 + p.trainingRings);
        expect(p.woolShort).toBe(2);
        expect(p.gemShort).toEqual({ sapphire: 13, emerald: 27, ruby: 17, diamond: 5 });
        expect(p.done).toBe(false);
    });

    test('cuts only what the products need: spare uncut diamonds stay uncut', () => {
        const p = plan(heldOf({ [GEM.diamond.uncut]: 10, [GEM.sapphire.uncut]: 27, [GEM.sapphire.cut]: 3 }), xpForLevel(43), o);
        expect(p.toCut.diamond).toBe(5);
        expect(p.toCut.sapphire).toBe(10); // 12 rings + 1 amulet - 3 already cut
        expect(p.gemShort.diamond).toBe(0);
        expect(p.trainingRings).toBe(0);
    });

    test('products already made count against the targets', () => {
        const p = plan(
            heldOf({ [GEM.sapphire.ring]: 12, [GEM.emerald.ring]: 20, [AMULET.sapphire.strung]: 1, [AMULET.ruby.unstrung]: 1, [ITEM.ballOfWool]: 1 }),
            xpForLevel(50),
            o
        );
        expect(p.products.find(x => x.gem === 'sapphire')).toBeUndefined();
        expect(p.products.find(x => x.gem === 'emerald')?.remaining).toBe(7);
        expect(p.products.some(x => x.kind === 'amulet')).toBe(false); // the ruby amulet only needs stringing
        expect(p.woolShort).toBe(0);
    });

    test('gold ore in the bank counts toward the bars', () => {
        const p = plan(heldOf({ [ITEM.goldBar]: 30, [ITEM.goldOre]: 20 }), xpForLevel(20), o);
        expect(p.barsNeeded).toBe(62);
        expect(p.barsShort).toBe(12);
    });

    test('done when every target is held', () => {
        const all: Record<number, number> = { [AMULET.sapphire.strung]: 1, [AMULET.ruby.strung]: 1 };
        for (const g of ['sapphire', 'emerald', 'ruby', 'diamond'] as const) all[GEM[g].ring] = o.rings[g];
        expect(plan(heldOf(all), 0, o).done).toBe(true);
    });

    test('options override the targets', () => {
        const p = plan(heldOf({}), xpForLevel(20), readOpts({ rings: { sapphire: 0, emerald: 2, ruby: 0, diamond: 0 }, amulets: { sapphire: 0, ruby: 0 } }));
        expect(p.products.map(x => `${x.gem} ${x.kind} ${x.remaining}`)).toEqual(['emerald ring 2']);
        expect(p.barsNeeded).toBe(2);
    });
});

describe('nextStep', () => {
    const input = (held: Record<number, number>, levels: Partial<StepInput['levels']> = {}, xp = xpForLevel(levels.crafting ?? 1)): StepInput => {
        const h = heldOf(held);
        const p: Plan = plan(h, xp, o);
        return { inTutorial: false, levels: { crafting: 1, mining: 1, smithing: 1, ...levels }, plan: p, held: h, gold: 'mine' };
    };
    const tools = { [ITEM.chisel]: 1, [ITEM.ringMould]: 1, [ITEM.amuletMould]: 1, [ITEM.ballOfWool]: 2 };

    test('tutorial, then wool below Crafting 5', () => {
        expect(nextStep({ ...input({}), inTutorial: true })).toBe('tutorial');
        expect(nextStep(input({}))).toBe('wool');
    });
    test('smith before mining gold', () => {
        expect(nextStep(input({ [ITEM.ballOfWool]: 2 }, { crafting: 5 }))).toBe('smith');
    });
    test('tools, then gold, then training rings', () => {
        expect(nextStep(input({ [ITEM.ballOfWool]: 2 }, { crafting: 5, mining: 40, smithing: 40 }))).toBe('tools');
        expect(nextStep(input(tools, { crafting: 5, mining: 40, smithing: 40 }))).toBe('gold');
        expect(nextStep(input({ ...tools, [ITEM.goldOre]: 5 }, { crafting: 5, mining: 40, smithing: 40 }))).toBe('smelt');
        expect(nextStep(input({ ...tools, [ITEM.goldBar]: 80 }, { crafting: 5, mining: 40, smithing: 40 }))).toBe('train');
    });
    test('cut before craft, then craft, then receive when gems run out', () => {
        const base = { ...tools, [ITEM.goldBar]: 80 };
        expect(nextStep(input({ ...base, [GEM.sapphire.uncut]: 13 }, { crafting: 20, mining: 40, smithing: 40 }))).toBe('cut');
        expect(nextStep(input({ ...base, [GEM.sapphire.cut]: 13 }, { crafting: 40, mining: 40, smithing: 40 }))).toBe('craft');
        expect(nextStep(input(base, { crafting: 40, mining: 40, smithing: 40 }))).toBe('receive');
    });
    test("gold 'receive' never trains Smithing or mines", () => {
        const i = { ...input(tools, { crafting: 5 }), gold: 'receive' as const };
        expect(nextStep(i)).toBe('receive');
    });
});

describe('withBankKnown', () => {
    test('an unseen bank means look first, except where no bank count matters', () => {
        expect(withBankKnown('tutorial', false, 1)).toBe('tutorial');
        expect(withBankKnown('smith', false, 6)).toBe('smith');
        expect(withBankKnown('wool', false, 1)).toBe('wool');
        // Crafting 5+: wool is only for stringing, and the balls may be banked.
        expect(withBankKnown('wool', false, 6)).toBe('look');
        // Never a 20-minute courier wait just because the bank is unseen.
        expect(withBankKnown('receive', false, 20)).toBe('look');
        expect(withBankKnown('tools', false, 6)).toBe('look');
    });
    test('a seen bank keeps the step', () => {
        for (const s of ['wool', 'tools', 'gold', 'receive', 'craft', 'done'] as const) expect(withBankKnown(s, true, 30)).toBe(s);
    });
});

describe('bestPickaxe', () => {
    test('the best tier wins regardless of bank order', () => {
        const bank = [
            { id: 436, name: 'Copper ore' },
            { id: 1265, name: 'Bronze pickaxe' },
            { id: 2353, name: 'Steel bar' },
            { id: 1271, name: 'Adamant pickaxe' }
        ];
        expect(bestPickaxe(bank)).toBe(1271);
    });
    test('none banked', () => {
        expect(bestPickaxe([{ id: 1755, name: 'Chisel' }])).toBeNull();
    });
});
