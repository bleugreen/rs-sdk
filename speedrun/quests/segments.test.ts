import { describe, expect, test } from 'bun:test';
import type { BotWorldState, InventoryItem, PlayerState } from '../../sdk/types';
import { baseState, FakeSdk } from '../lib/fake-sdk';
import { resolveStart, type StepContext } from '../runner/step';
import { allOf, baseLevels, DEFAULT_DIALOGUE, kitSegment, kitWant, questSteps, segmentName, stageAtLeast, stageDone, talkShape, within, type Segment } from './segments';

const item = (slot: number, name: string, count = 1) => ({ slot, id: slot, name, count, optionsWithIndex: [] }) as unknown as InventoryItem;
const seg = (letter: string, label: string, extra: Partial<Segment> = {}): Segment => ({ letter, label, logoutSafe: true, run: async () => {}, ...extra });
const ctxOf = (sdk: FakeSdk) => ({ sdk, c: {} }) as unknown as StepContext<any>;

describe('questSteps', () => {
    test('names are <stepId>:<letter>-<label>, in order, and runSteps can start at any of them', () => {
        const steps = questSteps('S15', [seg('A', 'narnode'), seg('B', 'daero-orders', { logoutSafe: false })]);
        expect(steps.map(s => s.name)).toEqual(['S15:A-narnode', 'S15:B-daero-orders']);
        expect(steps.map(s => s.logoutSafe)).toEqual([true, false]);
        expect(resolveStart(steps, 'S15:B-daero-orders')).toBe(1);
        expect(segmentName('S11b', 'H2', 'glough')).toBe('S11b:H2-glough');
    });

    test('checks default to passing; done, inProgress, resume and probes pass through only when given', async () => {
        let resumed = false;
        const done = () => true;
        const [a, b] = questSteps('S20', [
            seg('A', 'start'),
            seg('B', 'slug', { done, inProgress: () => false, resume: async () => { resumed = true; }, probes: ['journal:seaslug'] }),
        ]);
        const s = baseState();
        expect(a!.preconditions(s, {})).toBe(true);
        expect(a!.postconditions(s, {})).toBe(true);
        expect('done' in a!).toBe(false);
        expect(b!.done).toBe(done);
        expect(b!.probes).toEqual(['journal:seaslug']);
        await b!.resume!(ctxOf(new FakeSdk()));
        expect(resumed).toBe(true);
    });

    test('rejects bad ids, letters, labels and repeats', () => {
        expect(() => questSteps('S15:x', [seg('A', 'a')])).toThrow(/bad step id/);
        expect(() => questSteps('S15', [])).toThrow(/no segments/);
        expect(() => questSteps('S15', [seg('a', 'x')])).toThrow(/bad segment letter/);
        expect(() => questSteps('S15', [seg('A', 'Narnode Start')])).toThrow(/bad label/);
        expect(() => questSteps('S15', [seg('A', 'x'), seg('A', 'y')])).toThrow(/repeats segment A/);
    });
});

describe('options', () => {
    test('talkShape bursts by default and not in fixed mode', () => {
        expect(DEFAULT_DIALOGUE).toBe('burst');
        expect(talkShape(undefined, '2c, opt, 3c')).toEqual({ shape: '2c, opt, 3c', burst: true });
        expect(talkShape({ dialogue: 'fixed' }, '9c')).toEqual({ shape: '9c', burst: false });
    });
});

describe('checks', () => {
    const at = (x: number, z: number, level = 0) => baseState({ player: { worldX: x, worldZ: z, level } as PlayerState });

    test('within judges by coordinates and level', () => {
        const zoo = within({ x0: 2590, z0: 3260, x1: 2610, z1: 3290 }, 'the zoo');
        expect(zoo(at(2600, 3270), {})).toBe(true);
        expect(zoo(at(2600, 3270, 1), {})).toMatch(/not in the zoo/);
        expect(zoo(at(2500, 3270), {})).toMatch(/at 2500,3270 L0/);
    });

    test('baseLevels names every short skill', () => {
        const s = baseState({ skills: [{ name: 'Ranged', level: 60, baseLevel: 50, experience: 0 }, { name: 'Prayer', level: 40, baseLevel: 40, experience: 0 }] });
        expect(baseLevels({ ranged: 50 })(s, {})).toBe(true);
        expect(baseLevels({ ranged: 50, prayer: 43, magic: 1 })(s, {})).toBe('base levels short: prayer 40/43, magic 0/1');
    });

    test('stage checks read the published quest state', () => {
        const s = baseState({ quests: { cook: 'started' } } as Partial<BotWorldState>);
        expect(stageAtLeast('cook', 'started')(s, {})).toBe(true);
        expect(stageAtLeast('cook', 'complete')(s, {})).not.toBe(true);
        expect(stageDone('cook', 'started')({ state: s, probed: {} }, {})).toBe(true);
    });

    test('allOf returns the first failure', () => {
        const fail = (m: string) => () => m;
        expect(allOf(undefined, () => true)(baseState(), {})).toBe(true);
        expect(allOf(() => true, fail('one'), fail('two'))(baseState(), {})).toBe('one');
    });
});

describe('kitSegment', () => {
    const KIT = [{ item: /^law rune$/i, n: 10 }, { item: 'Banana' }];

    test('kitWant lists only the missing amounts', () => {
        const s = baseState({ inventory: [item(0, 'Law rune', 4), item(1, 'Banana')] });
        expect(kitWant(s, KIT)).toEqual([{ item: /^law rune$/i, amount: 6 }]);
    });

    test('a held kit is only checked: nothing is sent, even with a giver', async () => {
        const sdk = new FakeSdk(baseState({ inventory: [item(0, 'Law rune', 10), item(1, 'Banana', 2)] }));
        const [kit] = questSteps('S15', [kitSegment({ kitFrom: 'cairn_helper' }, KIT)]);
        expect(kit!.name).toBe('S15:A-kit');
        expect(kit!.logoutSafe).toBe(true);
        expect('done' in kit!).toBe(false);
        await kit!.run(ctxOf(sdk));
        expect(sdk.sent).toEqual([]);
        expect(kit!.postconditions(sdk.state!, {})).toBe(true);
    });

    test('missing with no giver fails, naming what is missing', async () => {
        const sdk = new FakeSdk(baseState({ inventory: [item(0, 'Law rune', 4)] }));
        const [kit] = questSteps('S15', [kitSegment(undefined, KIT)]);
        await expect(kit!.run(ctxOf(sdk))).rejects.toThrow(/missing 6 x \/\^law rune\$\/i, 1 x Banana and no kitFrom/);
        expect(kit!.postconditions(sdk.state!, {})).toMatch(/^kit missing/);
    });

    test('missing with a giver asks receiveFrom for the missing amounts', async () => {
        const sdk = new FakeSdk(baseState({ inventory: [] }));
        const [kit] = questSteps('S15', [kitSegment({ kitFrom: 'cairn_helper' }, KIT, { openTimeoutMs: 50 })]);
        await expect(kit!.run(ctxOf(sdk))).rejects.toThrow(/receiveFrom cairn_helper failed \(player_not_found\) wanting 10 x/);
    });

    test('the entry preconditions, letter and label are the module\'s', () => {
        const [kit] = questSteps('S11b', [kitSegment(undefined, KIT, { letter: 'A', label: 'narnode-kit', preconditions: () => 'TGV not complete' })]);
        expect(kit!.name).toBe('S11b:A-narnode-kit');
        expect(kit!.preconditions(baseState(), {})).toBe('TGV not complete');
    });
});
