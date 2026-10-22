import { describe, expect, test } from 'bun:test';
import type { BotWorldState, InventoryItem, NearbyLoc, NearbyNpc, PlayerState, SkillState } from '../../sdk/types';
import { baseState, FakeSdk, flush } from '../lib/fake-sdk';
import {
    cannonSessionStep, chooseConsume, combatFinishStep, FINISH, gearClick, IMMUNITY, noteConsume, phaseFor, pickTarget, resipAt, RETALIATE_OFF, RETALIATE_ON, runSession,
    specFor, SPIDERS, type ConsumeMemory, type RangedSdk,
} from './ranged';

const SKILLS = ['Attack', 'Defence', 'Strength', 'Hitpoints', 'Ranged', 'Prayer'] as const;
type Levels = Partial<Record<(typeof SKILLS)[number], number | [base: number, boosted: number]>>;
const skills = (lv: Levels): SkillState[] =>
    SKILLS.map(name => {
        const v = lv[name] ?? (name === 'Hitpoints' ? 10 : 1);
        const [base, level] = Array.isArray(v) ? v : [v, v];
        return { name, baseLevel: base, level, experience: base * 1000 };
    });
const player = (hp = 99, x: number = SPIDERS.x, z: number = SPIDERS.z) =>
    ({ worldX: x, worldZ: z, level: 0, hp, maxHp: 99, isDead: false, combat: { inCombat: false, targetIndex: -1, targetType: 'none', lastDamageTick: -1 } }) as unknown as PlayerState;
const item = (slot: number, name: string, count = 1, ops: string[] = ['Use']): InventoryItem =>
    ({ slot, id: 200 + slot, name, count, optionsWithIndex: ops.map((text, i) => ({ text, opIndex: i + 1 })) }) as InventoryItem;
const spider = (index: number, o: Partial<NearbyNpc> = {}): NearbyNpc =>
    ({ kind: 'npc', id: 1009, index, name: 'Poison spider', combatLevel: 64, x: SPIDERS.x + 2, z: SPIDERS.z, distance: 2, hp: 30, maxHp: 64, healthPercent: 50, targetIndex: -1, inCombat: false, optionsWithIndex: [{ text: 'Attack', opIndex: 2 }], ...o }) as NearbyNpc;
const cannonLoc = (): NearbyLoc =>
    ({ id: 6, name: 'Dwarf MultiCannon', x: SPIDERS.x - 1, z: SPIDERS.z - 1, level: 0, distance: 1, optionsWithIndex: [{ text: 'Fire', opIndex: 1 }, { text: 'Pick-up', opIndex: 2 }], options: [] }) as unknown as NearbyLoc;
const kit = (balls = 1100): InventoryItem[] => [
    item(0, 'Cannon base', 1, ['Set-up']), item(1, 'Cannon stand'), item(2, 'Cannon barrels'), item(3, 'Cannon furnace'), item(4, 'Cannonball', balls),
];
const st = (lv: Levels, patch: Partial<BotWorldState> = {}) =>
    baseState({ tick: 1000, player: player(), skills: skills(lv), quests: { mcannon: 'complete' }, prayers: { activePrayers: [], prayerPoints: 99, prayerLevel: 99 }, ...patch });

const ALL99: Levels = { Attack: 99, Strength: 99, Defence: 99, Ranged: 99, Hitpoints: 99, Prayer: 99 };

describe('phaseFor: S27 by thresholds', () => {
    test('default: Defence first, then the bow as soon as Defence closes, Hitpoints last', () => {
        expect(phaseFor(st({ Defence: 60, Ranged: 50, Hitpoints: 80 }))).toBe('melee');
        expect(phaseFor(st({ Defence: 99, Ranged: 50, Hitpoints: 80 }))).toBe('bow');
        expect(phaseFor(st({ Defence: 99, Ranged: 67, Hitpoints: 80 }))).toBe('bow');
        expect(phaseFor(st({ Defence: 99, Ranged: 98, Hitpoints: 99 }))).toBe('bow');
        expect(phaseFor(st({ Defence: 99, Ranged: 99, Hitpoints: 98 }))).toBe('hitpoints');
        expect(phaseFor(st(ALL99))).toBeNull();
    });

    test('bowFrom 70: the scimitar phase between Defence 99 and Ranged 70', () => {
        const t = { ...FINISH, bowFrom: 70 };
        expect(phaseFor(st({ Defence: 99, Ranged: 50, Hitpoints: 80 }), t)).toBe('scimitar');
        expect(phaseFor(st({ Defence: 99, Ranged: 69, Hitpoints: 80 }), t)).toBe('scimitar');
        expect(phaseFor(st({ Defence: 99, Ranged: 70, Hitpoints: 80 }), t)).toBe('bow');
    });

    test('a restart past a threshold lands in the later phase (Defence is checked first)', () => {
        // Ranged 80 from S14's overshoot plus a partial S27, Defence still short: melee first.
        expect(phaseFor(st({ Defence: 90, Ranged: 80 }))).toBe('melee');
    });

    test('custom thresholds', () => {
        const t = { ...FINISH, defence: 70, bowFrom: 60, ranged: 75, hitpoints: 1 };
        expect(phaseFor(st({ Defence: 70, Ranged: 60 }), t)).toBe('bow');
        expect(phaseFor(st({ Defence: 70, Ranged: 75 }), t)).toBeNull();
    });
});

describe('specFor', () => {
    test('S14: the cannon alone, scimitar wielded, retaliate off, Protect from Melee', () => {
        const c = specFor('cannon');
        expect(c).toMatchObject({ attack: false, retaliate: false, cannon: true, prayers: ['protect_from_melee'], boosts: [] });
        expect(c.weapon.test('Mithril scimitar')).toBe(true);
    });

    test('melee: defensive, the three-prayer kit and both super boosts', () => {
        expect(specFor('melee')).toMatchObject({
            style: 'Defensive', retaliate: true, attack: true, cannon: true,
            prayers: ['protect_from_melee', 'ultimate_strength', 'incredible_reflexes'], boosts: ['superAttack', 'superStrength'],
        });
    });

    test('scimitar: melee by default, cannon-only with Incredible Reflexes when asked', () => {
        expect(specFor('scimitar')).toMatchObject({ attack: true, style: 'Defensive' });
        expect(specFor('scimitar', { scimitarMelee: false })).toMatchObject({ attack: false, retaliate: false, prayers: ['protect_from_melee', 'incredible_reflexes'] });
    });

    test('bow: rapid magic shortbow with rune arrows, ranging potions', () => {
        const b = specFor('bow');
        expect(b).toMatchObject({ style: 'Rapid', attack: true, cannon: true, prayers: ['protect_from_melee'], boosts: ['ranging'] });
        expect(b.weapon.test('Magic shortbow')).toBe(true);
        expect(b.ammo?.test('Rune arrow')).toBe(true);
    });

    test('hitpoints: melee without the cannon', () => {
        expect(specFor('hitpoints')).toMatchObject({ attack: true, cannon: false, style: 'Defensive' });
    });
});

describe('resipAt: half the boost', () => {
    test('ranging potion: 4 + 10%', () => {
        expect(resipAt('ranging', 70)).toBe(5.5);
        expect(resipAt('ranging', 99)).toBe(6.5);
    });
    test('super attack / strength: 5 + 15%', () => {
        expect(resipAt('superAttack', 99)).toBe(9.5);
        expect(resipAt('superStrength', 80)).toBe(8.5);
    });
});

describe('chooseConsume', () => {
    const mem = (): ConsumeMemory => ({ immuneUntil: -Infinity, poisoned: false });
    const inv = [
        item(10, 'Shark', 1, ['Eat']), item(11, 'Superantipoison(3)', 1, ['Drink']), item(12, 'Antipoison(4)', 1, ['Drink']),
        item(13, 'Super attack(4)', 1, ['Drink']), item(14, 'Super strength(4)', 1, ['Drink']), item(15, 'Ranging potion(4)', 1, ['Drink']),
        item(16, 'Prayer potion(4)', 1, ['Drink']),
    ];
    const melee = specFor('melee');
    const s = (lv: Levels, patch: Partial<BotWorldState> = {}) => st(lv, { inventory: inv, ...patch });
    const boosted: Levels = { Attack: [99, 118], Strength: [99, 118], Ranged: [80, 92], Prayer: 99 };

    test('eating comes first, below the threshold only', () => {
        expect(chooseConsume(s(boosted, { player: player(29) }), melee, mem(), { eatBelow: 30, antipoison: 'proactive' })?.kind).toBe('eat');
        expect(chooseConsume(s(boosted, { player: player(30) }), melee, mem(), { eatBelow: 30, antipoison: 'first-poison' })).toBeNull();
    });

    test('first-poison: no antipoison until poisoned, then the super one', () => {
        const m = mem();
        const o = { eatBelow: 12, antipoison: 'first-poison' as const };
        expect(chooseConsume(s(boosted), melee, m, o)).toBeNull();
        m.poisoned = true;
        expect(chooseConsume(s(boosted), melee, m, o)?.kind).toBe('superAntipoison');
    });

    test('proactive: a dose at once, then none until the immunity runs out', () => {
        const m = mem();
        const o = { eatBelow: 30, antipoison: 'proactive' as const };
        expect(chooseConsume(s(boosted), melee, m, o)?.kind).toBe('superAntipoison');
        noteConsume(m, 'superAntipoison', 1000);
        expect(m.immuneUntil).toBe(1000 + IMMUNITY.superAntipoison);
        expect(chooseConsume(s(boosted, { tick: 1000 + IMMUNITY.superAntipoison - 1 }), melee, m, o)).toBeNull();
        expect(chooseConsume(s(boosted, { tick: 1000 + IMMUNITY.superAntipoison }), melee, m, o)?.kind).toBe('superAntipoison');
    });

    test('the plain antipoison when no super is left', () => {
        const m = { immuneUntil: -Infinity, poisoned: true };
        const st2 = s(boosted, { inventory: inv.filter(i => !/super/i.test(i.name)) });
        expect(chooseConsume(st2, specFor('bow'), m, { eatBelow: 30, antipoison: 'first-poison' })?.kind).toBe('antipoison');
        noteConsume(m, 'antipoison', 50);
        expect(m).toEqual({ immuneUntil: 50 + IMMUNITY.antipoison, poisoned: false });
    });

    test("a boost is re-sipped at half its size, and only the phase's own", () => {
        const m = { immuneUntil: Infinity, poisoned: false };
        const o = { eatBelow: 30, antipoison: 'proactive' as const };
        // Attack boost 9 at 99 (re-sip at 9.5): super attack; strength still 19 up.
        expect(chooseConsume(s({ ...boosted, Attack: [99, 108] }), melee, m, o)?.kind).toBe('superAttack');
        expect(chooseConsume(s({ ...boosted, Strength: [99, 109] }), melee, m, o)).toBeNull();
        expect(chooseConsume(s({ ...boosted, Strength: [99, 108] }), melee, m, o)?.kind).toBe('superStrength');
        expect(chooseConsume(s({ ...boosted, Strength: [99, 108] }), melee, m, o)?.item.slot).toBe(14);
        // The bow phase ignores melee boosts and watches Ranged (re-sip at 6 for base 80).
        expect(chooseConsume(s({ ...boosted, Attack: [99, 99] }), specFor('bow'), m, o)).toBeNull();
        expect(chooseConsume(s({ ...boosted, Ranged: [80, 86] }), specFor('bow'), m, o)?.kind).toBe('ranging');
        expect(chooseConsume(s({ ...boosted, Ranged: [80, 87] }), specFor('bow'), m, o)).toBeNull();
    });

    test('a prayer potion below the threshold, last', () => {
        const m = { immuneUntil: Infinity, poisoned: false };
        const low = s(boosted, { prayers: { activePrayers: [], prayerPoints: 9, prayerLevel: 99 } });
        expect(chooseConsume(low, melee, m, { eatBelow: 30, antipoison: 'proactive' })?.kind).toBe('prayer');
    });
});

describe('gearClick', () => {
    const styles = (current: number) => ({
        known: true, currentStyle: current, weaponName: 'x', tabInterfaceId: 1,
        styles: [
            { index: 0, name: 'Accurate', type: 'Accurate', trainsSkills: [], damageType: 'Slash' }, { index: 1, name: 'Rapid', type: 'Rapid', trainsSkills: [], damageType: 'Slash' },
            { index: 3, name: 'Block', type: 'Defensive', trainsSkills: [], damageType: 'Slash' },
        ],
    });
    const bow = item(5, 'Magic shortbow', 1, ['Wield']);
    const arrows = item(6, 'Rune arrow', 600, ['Wield']);
    const scim = item(7, 'Mithril scimitar', 1, ['Wield']);

    test('the bow, then the arrows, then the style, then retaliate', () => {
        const bowSpec = specFor('bow');
        const g1 = gearClick(st(ALL99, { inventory: [bow, arrows], equipment: [scim], autoRetaliateEnabled: false }), bowSpec);
        expect(g1).toEqual({ kind: 'wield', item: bow, op: 1 });
        const g2 = gearClick(st(ALL99, { inventory: [arrows, scim], equipment: [bow], autoRetaliateEnabled: false }), bowSpec);
        expect(g2).toMatchObject({ kind: 'wield', item: arrows });
        const worn = { inventory: [scim], equipment: [bow, arrows] };
        expect(gearClick(st(ALL99, { ...worn, combatStyle: styles(0), autoRetaliateEnabled: false }), bowSpec)).toEqual({ kind: 'style', index: 1 });
        expect(gearClick(st(ALL99, { ...worn, combatStyle: styles(1), autoRetaliateEnabled: false }), bowSpec)).toEqual({ kind: 'retaliate', on: true });
        expect(gearClick(st(ALL99, { ...worn, combatStyle: styles(1), autoRetaliateEnabled: true }), bowSpec)).toBeNull();
    });

    test('S14 turns auto-retaliate off and leaves the style alone', () => {
        const s = st(ALL99, { equipment: [scim], combatStyle: styles(0), autoRetaliateEnabled: true });
        expect(gearClick(s, specFor('cannon'))).toEqual({ kind: 'retaliate', on: false });
        expect(RETALIATE_OFF).not.toBe(RETALIATE_ON);
    });

    test('the melee phase asks for Defensive once the scimitar is in hand', () => {
        expect(gearClick(st(ALL99, { equipment: [scim], combatStyle: styles(0), autoRetaliateEnabled: true }), specFor('melee'))).toEqual({ kind: 'style', index: 3 });
    });

    test('nothing to wield is not a click (preconditions own missing gear)', () => {
        expect(gearClick(st(ALL99, { autoRetaliateEnabled: true }), specFor('melee'))).toBeNull();
    });
});

describe('pickTarget', () => {
    const anchor = { x: SPIDERS.x, z: SPIDERS.z };

    test('keeps the current target while it lives', () => {
        const s = st(ALL99, { nearbyNpcs: [spider(1, { inCombat: true }), spider(2)] });
        expect(pickTarget(s, anchor, 2)?.index).toBe(2);
    });

    test('then a spider already fighting us, then the one nearest the cannon', () => {
        const near = spider(1, { x: anchor.x + 1 });
        const far = spider(2, { x: anchor.x + 6, inCombat: true });
        const nearer = spider(3, { x: anchor.x, z: anchor.z + 1 });
        expect(pickTarget(st(ALL99, { nearbyNpcs: [near, far, nearer] }), anchor, null)?.index).toBe(2);
        expect(pickTarget(st(ALL99, { nearbyNpcs: [near, { ...far, inCombat: false }] }), anchor, null)?.index).toBe(1);
    });

    test('skips the dead, the unreachable and other NPCs', () => {
        const s = st(ALL99, { nearbyNpcs: [spider(1, { hp: 0 }), spider(2, { reachable: false } as Partial<NearbyNpc>), { ...spider(3), name: 'Skeleton' }] });
        expect(pickTarget(s, anchor, 1)).toBeNull();
    });
});

describe('steps: gates and resume', () => {
    type S = ReturnType<typeof cannonSessionStep>;
    const pre = (step: S, s: BotWorldState) => step.preconditions(s, {} as never);
    const isDone = (step: S, s: BotWorldState) => step.done!({ state: s, probed: {} } as never, {} as never);
    const inProg = (step: S, s: BotWorldState) => step.inProgress!({ state: s, probed: {} } as never, {} as never);
    const s14Ready = (patch: Partial<BotWorldState> = {}) =>
        st({ Attack: 99, Prayer: 43, Hitpoints: 42, Ranged: 1 }, { inventory: [...kit(100)], equipment: [item(9, 'Mithril scimitar')], ...patch });

    test('S14 preconditions name what is missing', () => {
        const step = cannonSessionStep();
        expect(pre(step, s14Ready())).toBe(true);
        expect(pre(step, s14Ready({ quests: {} }))).toMatch(/Dwarf Cannon/);
        expect(pre(step, s14Ready({ player: player(42, 3200, 3700) }))).toMatch(/not at the poison spiders/);
        expect(pre(step, s14Ready({ inventory: kit(99) }))).toMatch(/99 cannonballs/);
        expect(pre(step, s14Ready({ inventory: kit(100).slice(1) }))).toMatch(/no cannon set/);
        expect(pre(step, s14Ready({ equipment: [] }))).toMatch(/mithril scimitar/);
        expect(pre(step, s14Ready({ skills: skills({ Attack: 98, Prayer: 43 }) }))).toMatch(/Attack 98/);
        expect(pre(step, s14Ready({ skills: skills({ Attack: 99, Prayer: 40 }) }))).toMatch(/Prayer 40/);
    });

    test('S14 done and in progress from levels', () => {
        const step = cannonSessionStep();
        expect(isDone(step, s14Ready({ skills: skills({ Attack: 99, Ranged: 50 }) }))).toBe(true);
        expect(isDone(step, s14Ready({ skills: skills({ Attack: 99, Ranged: 49 }) }))).toBe(false);
        expect(inProg(step, s14Ready({ nearbyLocs: [cannonLoc()] }))).toBe(true);
        expect(inProg(step, s14Ready())).toBe(true); // Ranged xp 1000 here: a session has fired
        expect(inProg(step, s14Ready({ player: player(42, 3200, 3700) }))).toBe(false);
    });

    test('S27 preconditions: the bow and arrows below Ranged 99 only', () => {
        const step = combatFinishStep();
        const ready = (lv: Levels, inv: InventoryItem[]) => st(lv, { inventory: [...kit(1200), ...inv], equipment: [item(9, 'Mithril scimitar')] });
        const lv: Levels = { Attack: 99, Defence: 60, Ranged: 50, Prayer: 99 };
        const bowKit = [item(5, 'Magic shortbow'), item(6, 'Rune arrow', 570)];
        expect(pre(step, ready(lv, bowKit))).toBe(true);
        expect(pre(step, ready(lv, []))).toMatch(/magic shortbow/);
        expect(pre(step, ready(lv, [bowKit[0]!, item(6, 'Rune arrow', 100)]))).toMatch(/100 rune arrows/);
        expect(pre(step, ready({ ...lv, Prayer: 43 }, bowKit))).toBe(true);
        expect(pre(step, ready({ ...lv, Prayer: 33 }, bowKit))).toMatch(/Prayer 33 is too low for protect_from_melee, incredible_reflexes/);
        expect(pre(step, ready({ ...lv, Ranged: 99 }, []))).toBe(true);
        expect(isDone(step, ready(ALL99, []))).toBe(true);
        expect(inProg(step, ready({ ...lv, Defence: 99 }, bowKit))).toBe(true);
    });
});

describe('runSession on the fake SDK', () => {
    async function drive(sdk: FakeSdk, p: Promise<unknown>, ticks: number, each: (s: BotWorldState, i: number) => Partial<BotWorldState> = () => ({})) {
        for (let i = 0; i < ticks; i++) {
            await flush();
            sdk.tick(s => each(s, i));
        }
        await flush();
        return p;
    }

    test('a placed cannon is fired, the flick keeps one prayer, the attack goes behind each burst', async () => {
        const sdk = new FakeSdk(
            st({ ...ALL99, Defence: 98 }, {
                inventory: kit(500), equipment: [item(9, 'Mithril scimitar')], nearbyLocs: [cannonLoc()], nearbyNpcs: [spider(4, { inCombat: true })],
                prayers: { activePrayers: [], prayerPoints: 99, prayerLevel: 99 },
            }),
        );
        const t0 = sdk.state!.tick;
        const p = runSession(sdk as unknown as RangedSdk, {
            phaseOf: s => (s.tick - t0 >= 10 ? null : 'bow'),
            consume: { eatBelow: 30, antipoison: 'first-poison' },
            pickUp: false,
            maxTicks: 100,
        });
        const res = (await drive(sdk, p, 10)) as Awaited<ReturnType<typeof runSession>>;
        expect(sdk.sent[0]).toEqual({ method: 'sendInteractLoc', args: [SPIDERS.x - 1, SPIDERS.z - 1, 6, 1] });
        expect(res.end).toBe('done');
        expect(res.phases.map(r => r.phase)).toEqual(['bow']);
        expect(res.overBudget).toBe(0);
        // Each burst's toggles are followed by an attack on the spider fighting us.
        const methods = sdk.sent.map(a => a.method);
        const firstToggle = methods.indexOf('sendTogglePrayer');
        expect(firstToggle).toBeGreaterThan(0);
        expect(methods.slice(firstToggle).includes('sendInteractNpc')).toBe(true);
        for (const a of sdk.sent.filter(x => x.method === 'sendInteractNpc')) expect(a.args).toEqual([4, 2]);
        expect(sdk.sent.filter(x => x.method === 'sendTogglePrayer').every(a => a.args[0] === 'protect_from_melee')).toBe(true);
        expect(res.bursts).toBeGreaterThanOrEqual(2);
    });

    test('a phase change re-plans the prayers and closes a row', async () => {
        const sdk = new FakeSdk(
            st({ ...ALL99, Defence: 98 }, {
                inventory: kit(500), equipment: [item(9, 'Mithril scimitar')], nearbyLocs: [cannonLoc()], nearbyNpcs: [spider(4, { inCombat: true })],
                prayers: { activePrayers: [], prayerPoints: 99, prayerLevel: 99 },
            }),
        );
        const t0 = sdk.state!.tick;
        const p = runSession(sdk as unknown as RangedSdk, {
            phaseOf: s => (s.tick - t0 >= 12 ? null : s.tick - t0 >= 6 ? 'bow' : 'melee'),
            consume: { eatBelow: 30, antipoison: 'first-poison' },
            pickUp: false,
            maxTicks: 100,
        });
        const res = (await drive(sdk, p, 12)) as Awaited<ReturnType<typeof runSession>>;
        expect(res.phases.map(r => r.phase)).toEqual(['melee', 'bow']);
        expect(res.phases[0]!.endTick).toBe(res.phases[1]!.startTick);
        const toggled = new Set(sdk.sent.filter(x => x.method === 'sendTogglePrayer').map(a => a.args[0]));
        expect(toggled).toEqual(new Set(['protect_from_melee', 'ultimate_strength', 'incredible_reflexes']));
    });

    test('nothing to do: no sends', async () => {
        const sdk = new FakeSdk(st(ALL99, { inventory: kit(500) }));
        const res = await runSession(sdk as unknown as RangedSdk, { phaseOf: () => null, consume: { eatBelow: 30, antipoison: 'proactive' }, maxTicks: 10 });
        expect(res.ticks).toBe(0);
        expect(sdk.sent).toEqual([]);
    });
});
