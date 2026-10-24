import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { BotWorldState, InventoryItem, NearbyLoc, NearbyNpc, PlayerState, SkillState } from '../../sdk/types';
import { baseState, drive as settle, FakeSdk, simulateWalking } from '../lib/fake-sdk';
import { chebyshev, pos } from '../lib/world';
import { legById, SPIDERS_SOUTH } from '../runner/legs';
import { RETREAT_MAX_TICKS } from '../runner/retreat';
import { IF_RETALIATE_OFF, IF_RETALIATE_ON } from '../lib/session';
import { TickLog } from '../lib/ticks';
import { Observation, resolveResume } from '../runner/resume';
import {
    cannonSessionStep, chooseConsume, combatFinishStep, FINISH, gearClick, IMMUNITY, noteConsume, noteSession, otherItems, phaseFor, pickTarget, resipAt, runSession,
    slotNeed, specFor, SPIDERS, type ConsumeMemory, type RangedSdk,
    inSpiderReach, SITE_RADIUS, SPIDER_REACH, SPIDER_REACH_AREA, SPIDER_SPAWNS, spiderRetreat,
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

    test('the bow, then the arrows, then the style', () => {
        const bowSpec = specFor('bow');
        const g1 = gearClick(st(ALL99, { inventory: [bow, arrows], equipment: [scim], autoRetaliateEnabled: false }), bowSpec);
        expect(g1).toEqual({ kind: 'wield', item: bow, op: 1 });
        const g2 = gearClick(st(ALL99, { inventory: [arrows, scim], equipment: [bow], autoRetaliateEnabled: false }), bowSpec);
        expect(g2).toMatchObject({ kind: 'wield', item: arrows });
        const worn = { inventory: [scim], equipment: [bow, arrows] };
        expect(gearClick(st(ALL99, { ...worn, combatStyle: styles(0), autoRetaliateEnabled: false }), bowSpec)).toEqual({ kind: 'style', index: 1 });
        expect(gearClick(st(ALL99, { ...worn, combatStyle: styles(1), autoRetaliateEnabled: false }), bowSpec)).toBeNull();
    });

    test('S14 leaves the style alone, and auto-retaliate is never a gear click (runSession sets it through setAutoRetaliate)', () => {
        const s = st(ALL99, { equipment: [scim], combatStyle: styles(0), autoRetaliateEnabled: true });
        expect(gearClick(s, specFor('cannon'))).toBeNull();
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

    test('S14 Attack floor: 99 by default; s14MinAttack lowers it (the twin rehearsal only)', () => {
        const at = (attack: number) => s14Ready({ skills: skills({ Attack: attack, Prayer: 43, Hitpoints: 42, Ranged: 1 }) });
        expect(pre(cannonSessionStep(), at(94))).toBe("Attack 94: the cannon's accuracy is the scimitar's at Attack 99");
        expect(pre(cannonSessionStep({ s14MinAttack: 94 }), at(94))).toBe(true);
        expect(pre(cannonSessionStep({ s14MinAttack: 94 }), at(93))).toBe("Attack 93: the cannon's accuracy is the scimitar's at Attack 94");
    });

    test('S14 done and in progress from levels', () => {
        const step = cannonSessionStep();
        expect(isDone(step, s14Ready({ skills: skills({ Attack: 99, Ranged: 50 }) }))).toBe(true);
        expect(isDone(step, s14Ready({ skills: skills({ Attack: 99, Ranged: 49 }) }))).toBe(false);
        expect(inProg(step, s14Ready({ nearbyLocs: [cannonLoc()] }))).toBe(true);
        expect(inProg(step, s14Ready())).toBe(true); // Ranged xp 1000 here: a session has fired
        expect(inProg(step, s14Ready({ player: player(42, 3200, 3700) }))).toBe(false);
    });

    test('S14 at Ranged 50 with its cannon still placed (a pick-up that threw, rs/562 E): not done, in progress, and the walk resumes it', async () => {
        const step = cannonSessionStep();
        const lv: Levels = { Attack: 99, Prayer: 43, Hitpoints: 42, Ranged: 50 };
        const leftPlaced = st(lv, { inventory: [item(4, 'Cannonball', 30)], equipment: [item(9, 'Mithril scimitar')], nearbyLocs: [cannonLoc()] });
        expect(isDone(step, leftPlaced)).toBe(false);
        expect(inProg(step, leftPlaced)).toBe(true);
        const p = await resolveResume([step], new Observation(leftPlaced), {});
        expect([p.step, p.mode]).toEqual(['S14 cannon session', 'resume']);
        // Picked up: done. Away from the spiders: done whatever is placed. S27's cannon at the same site, after Monkey Madness: done.
        expect(isDone(step, st(lv, { inventory: kit(30) }))).toBe(true);
        expect(isDone(step, { ...leftPlaced, player: player(42, 3200, 3700) })).toBe(true);
        expect(isDone(step, { ...leftPlaced, quests: { mcannon: 'complete', mm: 'complete' } })).toBe(true);
        expect(isDone(cannonSessionStep({ pickUp: { s14: false } }), leftPlaced)).toBe(true);
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

describe('steps: the free-slot preconditions', () => {
    type S = ReturnType<typeof cannonSessionStep>;
    const pre = (step: S, s: BotWorldState) => step.preconditions(s, {} as never);
    const junk = (n: number, name = 'Bones') => Array.from({ length: n }, (_, i) => item(40 + i, name));
    const scim = item(9, 'Mithril scimitar');
    const s14 = (inventory: InventoryItem[], patch: Partial<BotWorldState> = {}) => st({ Attack: 99, Prayer: 43, Hitpoints: 42, Ranged: 1 }, { inventory, equipment: [scim], ...patch });

    test('S14: a held set needs nothing beyond itself; a placed cannon needs 4 free slots for its pick-up', () => {
        const step = cannonSessionStep();
        expect(pre(step, s14([...kit(100), ...junk(23)]))).toBe(true);
        const placed = (n: number) => s14([item(4, 'Cannonball', 100), ...junk(n)], { nearbyLocs: [cannonLoc()] });
        expect(pre(step, placed(23))).toBe(true);
        expect(pre(step, placed(25))).toBe('25 other items (Bones): need 4 free slots (4 to pick up the placed cannon), 2 free');
        expect(pre(cannonSessionStep({ pickUp: { s14: false } }), placed(25))).toBe(true);
        expect(otherItems(s14([...kit(100), item(5, 'Shark'), item(6, 'Antipoison(3)'), item(7, 'Law rune', 2), item(8, 'Vial')]))).toEqual(['Law rune']);
    });

    test('S27: the bow takes a worn shield off, unless the held rune arrows free a slot going to the quiver', () => {
        const step = combatFinishStep();
        const lv: Levels = { Attack: 99, Defence: 99, Ranged: 70, Prayer: 99 };
        const shield = item(5, 'Anti-dragon shield');
        const quiver = item(13, 'Rune arrow', 570);
        const s27 = (inv: InventoryItem[], equipment: InventoryItem[], l: Levels = lv) => st(l, { inventory: [...kit(1200), item(5, 'Magic shortbow'), ...inv], equipment });
        // The route: the 570 rune arrows in the pack beside the shield. A full pack still starts.
        expect(pre(step, s27([item(6, 'Rune arrow', 570), ...junk(21)], [scim, shield]))).toBe(true);
        // The arrows already quivered: the shield needs a slot.
        expect(pre(step, s27(junk(22), [scim, shield, quiver]))).toBe('22 other items (Bones): need 1 free slots (1 for the Anti-dragon shield the magic shortbow takes off), 0 free');
        expect(pre(step, s27(junk(21), [scim, shield, quiver]))).toBe(true);
        expect(pre(step, s27(junk(22), [scim, quiver]))).toBe(true);
        // Ranged 99: no bow phase ahead.
        expect(pre(step, s27(junk(22), [scim, shield, quiver], { ...lv, Ranged: 99 }))).toBe(true);
        expect(slotNeed(s27([], [scim, shield, quiver]), { pickUp: true, bowAhead: true })).toEqual({ need: 1, why: ['1 for the Anti-dragon shield the magic shortbow takes off'] });
    });

    test('S27 with the cannon placed: the pick-up and the shield together', () => {
        const s = st({ Attack: 99, Defence: 99, Ranged: 70, Prayer: 99 }, {
            inventory: [item(4, 'Cannonball', 1200), item(5, 'Magic shortbow'), ...junk(24)],
            equipment: [scim, item(5, 'Anti-dragon shield'), item(13, 'Rune arrow', 570)],
            nearbyLocs: [cannonLoc()],
        });
        expect(slotNeed(s, { pickUp: true, bowAhead: true }).need).toBe(5);
        expect(pre(combatFinishStep(), s)).toBe('24 other items (Bones): need 5 free slots (4 to pick up the placed cannon; 1 for the Anti-dragon shield the magic shortbow takes off), 2 free');
        expect(pre(combatFinishStep(), { ...s, inventory: s.inventory.slice(0, 23) })).toBe(true);
    });
});

describe('noteSession: the session result in the tick log', () => {
    const result = {
        startTick: 1911, fireTick: 1937, endTick: 2048, ticks: 137, setUpTicks: 26, pickUpTicks: 1, phases: [], prayer: { start: 99, min: 90, end: 92 },
        damageTaken: 3, minHp: 90, consumes: {}, attacks: 0, levelUps: 49, bursts: 0, restores: 0, reloads: 2, refires: 0, dryEvents: 0, ballsUsed: 68, arrowsUsed: 0, overBudget: 0, end: 'done' as const,
    };

    test("one `(session)` note row with the result and the firing ticks between set-up and pick-up", () => {
        const log = TickLog.memory('r');
        noteSession({ log, session: { name: 'acct', sessionId: 2 } as never }, 'S14 cannon session', result);
        expect(log.rows.length).toBe(1);
        const r = log.rows[0]!;
        expect([r.kind, r.step, r.startTick, r.endTick, r.ticks, r.ok]).toEqual(['note', 'S14 cannon session (session)', 1911, 2048, 0, true]);
        expect(r.meta).toMatchObject({ setUpTicks: 26, pickUpTicks: 1, reloads: 2, ballsUsed: 68, firingTicks: 110 });
    });

    test('a caller with no tick log gets no row and no error', () => {
        expect(() => noteSession({}, 'S14 cannon session', result)).not.toThrow();
    });
});

type Press = typeof IF_RETALIATE_ON | typeof IF_RETALIATE_OFF;

/**
 * The server's controls:com_2 / com_3 (player_controls.rs2): a press publishes autoRetaliateEnabled
 * on the next tick. Returns the presses sent, in order; any other component click fails the test.
 */
function serveRetaliate(sdk: FakeSdk): Press[] {
    const presses: Press[] = [];
    let pending: boolean | undefined;
    sdk.onSend = a => {
        if (a.method !== 'sendClickComponent') return;
        expect([IF_RETALIATE_ON, IF_RETALIATE_OFF]).toContain(a.args[0] as number);
        presses.push(a.args[0] as Press);
        pending = a.args[0] === IF_RETALIATE_ON;
    };
    const tick = sdk.tick.bind(sdk);
    sdk.tick = patch => {
        const on = pending;
        pending = undefined;
        return tick(s => ({ ...(typeof patch === 'function' ? patch(s) : patch), ...(on !== undefined ? { autoRetaliateEnabled: on } : {}) }));
    };
    return presses;
}

describe('runSession on the fake SDK', () => {
    /** Tick until the session settles (its phaseOf, stop or maxTicks ends it). */
    const drive = <T>(sdk: FakeSdk, p: Promise<T>, ticks: number) => settle(sdk, p, ticks + 20);
    const atCannon = (patch: Partial<BotWorldState> = {}) =>
        new FakeSdk(
            st({ ...ALL99, Defence: 98 }, {
                inventory: kit(500), equipment: [item(9, 'Mithril scimitar')], nearbyLocs: [cannonLoc()], nearbyNpcs: [spider(4, { inCombat: true })],
                prayers: { activePrayers: [], prayerPoints: 99, prayerLevel: 99 }, autoRetaliateEnabled: false, ...patch,
            }),
        );
    const consume = { eatBelow: 30, antipoison: 'first-poison' } as const;

    test('a session re-entered past its last phase with its cannon placed picks the cannon up and ends (rs/562 E)', async () => {
        const sdk = atCannon({ inventory: [item(4, 'Cannonball', 30)], nearbyNpcs: [] });
        sdk.onSend = a => {
            if (a.method !== 'sendInteractLoc' || a.args[3] !== 2) return;
            queueMicrotask(() => sdk.tick(cur => ({ nearbyLocs: [], inventory: [...kit(30).slice(0, 4), { ...cur.inventory[0]!, slot: 4, count: 60 }] })));
        };
        const p = runSession(sdk as unknown as RangedSdk, { phaseOf: () => null, consume, maxTicks: 100 });
        const res = (await drive(sdk, p, 10)) as Awaited<ReturnType<typeof runSession>>;
        expect(sdk.sent.map(a => a.method)).toEqual(['sendInteractLoc']);
        expect(res.end).toBe('done');
        expect(res.phases).toEqual([]);
        expect(cannonSessionStep().postconditions({ ...sdk.state!, skills: skills({ Attack: 99, Ranged: 50 }) }, {} as never)).toBe(true);
        // Nothing placed: nothing sent.
        const none = atCannon({ nearbyLocs: [] });
        await drive(none, runSession(none as unknown as RangedSdk, { phaseOf: () => null, consume, maxTicks: 100 }), 2);
        expect(none.sent).toEqual([]);
    });

    test('a placed cannon is fired, the flick keeps one prayer, the attack goes behind each burst', async () => {
        const sdk = atCannon();
        serveRetaliate(sdk);
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

    test('a phase change re-plans the prayers and closes a row; auto-retaliate stays on between two phases that want it', async () => {
        const sdk = atCannon();
        const presses = serveRetaliate(sdk);
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
        expect(presses).toEqual([IF_RETALIATE_ON, IF_RETALIATE_OFF]);
    });

    test('a phase that wants auto-retaliate turns it on at its start and off at its end; the only clicks are setAutoRetaliate presses', async () => {
        const sdk = atCannon();
        const presses = serveRetaliate(sdk);
        const t0 = sdk.state!.tick;
        const p = runSession(sdk as unknown as RangedSdk, { phaseOf: s => (s.tick - t0 >= 10 ? null : 'bow'), consume, pickUp: false, maxTicks: 100 });
        const res = await drive(sdk, p, 10);
        expect(res.end).toBe('done');
        expect(presses).toEqual([IF_RETALIATE_ON, IF_RETALIATE_OFF]);
        const methods = sdk.sent.map(a => (a.method === 'sendClickComponent' ? `press ${a.args[0]}` : a.method));
        expect(methods.indexOf(`press ${IF_RETALIATE_ON}`)).toBeLessThan(methods.lastIndexOf('sendInteractNpc'));
        expect(methods.lastIndexOf('sendInteractNpc')).toBeLessThan(methods.indexOf(`press ${IF_RETALIATE_OFF}`));
        expect(sdk.getState()!.autoRetaliateEnabled).toBe(false);
    });

    test('a throw inside the phase still puts auto-retaliate back off', async () => {
        const sdk = atCannon();
        const presses = serveRetaliate(sdk);
        const p = runSession(sdk as unknown as RangedSdk, { phaseOf: () => 'bow', consume, pickUp: false, maxTicks: 8 });
        const err = await drive(sdk, p.then(() => null, (e: unknown) => e), 10);
        expect(String(err)).toContain('over 8 ticks');
        expect(presses).toEqual([IF_RETALIATE_ON, IF_RETALIATE_OFF]);
        expect(sdk.getState()!.autoRetaliateEnabled).toBe(false);
    });

    test('a stop puts it back off too', async () => {
        const sdk = atCannon();
        const presses = serveRetaliate(sdk);
        const p = runSession(sdk as unknown as RangedSdk, { phaseOf: () => 'melee', stop: (s, fire) => s.tick - fire >= 8, consume, pickUp: false, maxTicks: 100 });
        const res = await drive(sdk, p, 10);
        expect(res.end).toBe('stopped');
        expect(presses).toEqual([IF_RETALIATE_ON, IF_RETALIATE_OFF]);
        expect(sdk.getState()!.autoRetaliateEnabled).toBe(false);
    });

    test('S14 (off): no click when login left it off; one press off when something left it on, and none at the end', async () => {
        for (const [was, want] of [[false, []], [true, [IF_RETALIATE_OFF]]] as const) {
            const sdk = atCannon({ autoRetaliateEnabled: was });
            const presses = serveRetaliate(sdk);
            const t0 = sdk.state!.tick;
            const res = await drive(sdk, runSession(sdk as unknown as RangedSdk, { phaseOf: s => (s.tick - t0 >= 10 ? null : 'cannon'), consume, pickUp: false, maxTicks: 100 }), 10);
            expect(res.end).toBe('done');
            expect(presses).toEqual([...want]);
            expect(sdk.sent.filter(a => a.method === 'sendClickComponent')).toHaveLength(want.length);
            expect(sdk.getState()!.autoRetaliateEnabled).toBe(false);
        }
    });

    test('nothing to do: no sends', async () => {
        const sdk = new FakeSdk(st(ALL99, { inventory: kit(500) }));
        const res = await runSession(sdk as unknown as RangedSdk, { phaseOf: () => null, consume: { eatBelow: 30, antipoison: 'proactive' }, maxTicks: 10 });
        expect(res.ticks).toBe(0);
        expect(sdk.sent).toEqual([]);
    });
});

/** Spawns of `npc` on level 0 in the map squares around the cannon spot, from the game's own maps (`level x z: id`). */
function spawnsOf(npc: number): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    for (const mx of [50, 51, 52]) for (const mz of [58, 59, 60]) {
        const file = join(import.meta.dir, `../../server/content/maps/m${mx}_${mz}.jm2`);
        if (!existsSync(file)) continue;
        const section = readFileSync(file, 'utf8').split('==== NPC ====')[1]?.split('====')[0] ?? '';
        for (const line of section.split('\n')) {
            const m = /^0 (\d+) (\d+): (\d+)$/.exec(line.trim());
            if (m && Number(m[3]) === npc) out.push({ x: mx * 64 + Number(m[1]), z: mz * 64 + Number(m[2]) });
        }
    }
    return out;
}

const POISON_SPIDER = 134;
const AGGRESSIVE_BLACK_KNIGHT = 179;

describe("the cannon steps' retreat out of the spiders' reach (rs/725)", () => {
    test('SPIDER_SPAWNS is the box of every poison spider spawn in the maps around the spot, and the reach is maxrange + 1', () => {
        const spawns = spawnsOf(POISON_SPIDER);
        expect(spawns.length).toBe(63);
        const xs = spawns.map(s => s.x);
        const zs = spawns.map(s => s.z);
        expect([Math.min(...xs), Math.max(...xs)]).toEqual([...SPIDER_SPAWNS.x]);
        expect([Math.min(...zs), Math.max(...zs)]).toEqual([...SPIDER_SPAWNS.z]);
        // poisonspider (all.npc): wanderrange=10 and no maxrange, so maxrange is 12 (NpcType.postDecode) and the reach 13.
        const npc = readFileSync(join(import.meta.dir, '../../server/content/scripts/_unpack/225/all.npc'), 'utf8').split('[poisonspider]')[1]!.split('\n[')[0]!;
        expect(npc).toMatch(/^wanderrange=10$/m);
        expect(npc).toMatch(/^huntrange=1$/m);
        expect(npc).not.toMatch(/^maxrange=/m);
        expect(SPIDER_REACH).toBe(10 + 2 + 1);
        // The spot and every tile the steps start on are in reach.
        expect(inSpiderReach(baseState({ player: player(99, SPIDERS.x, SPIDERS.z) }))).toBe(true);
    });

    test("the retreat's route is T14-15's first hop, the leg out of S14", () => {
        expect(legById('T14-15').def.hops[0]).toBe(SPIDERS_SOUTH);
        expect(SPIDERS_SOUTH).toEqual({ kind: 'run', to: { x: 3288, z: 3660 }, wildernessAtMost: 20 });
        expect(cannonSessionStep().retreat).toBe(spiderRetreat);
        expect(combatFinishStep().retreat).toBe(spiderRetreat);
    });

    // The host's S14 deaths failed on the spot itself (3288,3810); the steps start anywhere within SITE_RADIUS of it.
    const starts: [number, number][] = [
        [SPIDERS.x, SPIDERS.z],
        [SPIDERS.x + SITE_RADIUS, SPIDERS.z + SITE_RADIUS],
        [SPIDERS.x - SITE_RADIUS, SPIDERS.z - SITE_RADIUS],
        [SPIDERS.x - SITE_RADIUS, SPIDERS.z + SITE_RADIUS],
        [SPIDERS.x + SITE_RADIUS, SPIDERS.z - SITE_RADIUS],
    ];
    for (const [step, make] of [['S14', cannonSessionStep], ['S27', combatFinishStep]] as const) {
        test(`${step}'s retreat starts in the spider area and ends on the first tiles out of every spider's reach, clear of the black knights`, async () => {
            const spiders = spawnsOf(POISON_SPIDER);
            const knights = spawnsOf(AGGRESSIVE_BLACK_KNIGHT);
            expect(knights).toEqual([{ x: 3310, z: 3769 }, { x: 3313, z: 3769 }]);
            for (const [x, z] of starts) {
                const sdk = new FakeSdk(baseState({ tick: 235, player: player(25, x, z) }));
                simulateWalking(sdk);
                expect(inSpiderReach(sdk.state!)).toBe(true);
                const t0 = sdk.state!.tick;
                await settle(sdk, make().retreat!({ sdk, bot: {} } as never), 200);
                const end = pos(sdk.state!);
                expect([x, z, inSpiderReach(sdk.state!)]).toEqual([x, z, false]);
                // South down T14-15's line, stopped on the first tile out of reach: (3288,3768).
                expect([x, z, end]).toEqual([x, z, { x: 3288, z: SPIDER_REACH_AREA.z[0] - 1, level: 0 }]);
                for (const s of spiders) expect(chebyshev(end, s)).toBeGreaterThan(SPIDER_REACH);
                // aggressive_black_knight: wanderrange 10, huntrange 5.
                for (const k of knights) expect(chebyshev(end, k)).toBeGreaterThan(10 + 5);
                expect(sdk.state!.tick - t0).toBeLessThanOrEqual(RETREAT_MAX_TICKS);
                // Only walk clicks: nothing picked up, the cannon left.
                expect([...new Set(sdk.sent.map(a => a.method))]).toEqual(['sendWalk']);
            }
        });
    }

    test('out of reach already: the retreat sends nothing', async () => {
        const sdk = new FakeSdk(baseState({ tick: 300, player: player(25, 3288, 3700) }));
        await spiderRetreat({ sdk, bot: {} } as never);
        expect(sdk.sent).toEqual([]);
    });

    test('a walk that cannot leave the reach throws, naming the tile it ended on', async () => {
        const sdk = new FakeSdk(baseState({ tick: 300, player: player(25, SPIDERS.x, SPIDERS.z) }));
        simulateWalking(sdk, { blocked: (_x, z) => z < 3800 });
        await expect(settle(sdk, spiderRetreat({ sdk, bot: {} } as never), 1200)).rejects.toThrow(/^the retreat ended at 3288,3800, still in the spiders' reach: /);
    });
});
