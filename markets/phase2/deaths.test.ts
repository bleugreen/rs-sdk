import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../sdk/types';
import { causeOf, DeathWatch } from './deaths.ts';

interface Opts {
    tick: number;
    hp: number;
    maxHp?: number;
    dead?: boolean;
    respawns?: number;
    messages?: { tick: number; text: string }[];
    combat?: { tick: number; sourceType: 'npc' | 'other_player'; sourceIndex: number; damage: number }[];
    npcs?: { index: number; name: string; x: number; z: number }[];
}

const state = (o: Opts): BotWorldState =>
    ({
        tick: o.tick,
        player: { hp: o.hp, maxHp: o.maxHp ?? 40, worldX: 3231, worldZ: 3218, level: 0, isDead: o.dead ?? false, respawnCount: o.respawns ?? 0 },
        gameMessages: (o.messages ?? []).map(m => ({ type: 0, text: m.text, sender: '', tick: m.tick, fromSelf: false })),
        combatEvents: (o.combat ?? []).map(c => ({ tick: c.tick, type: 'damage_taken', damage: c.damage, sourceType: c.sourceType, sourceIndex: c.sourceIndex, targetType: 'player', targetIndex: 1 })),
        nearbyNpcs: (o.npcs ?? []).map(n => ({ ...n, kind: 'npc', id: 1, combatLevel: 2, distance: 1, optionsWithIndex: [] })),
        nearbyPlayers: [],
        skills: [{ name: 'Thieving', baseLevel: 48, level: 48, experience: 0 }],
        inventory: [{ name: 'Coins', count: 654, slot: 0, id: 995, optionsWithIndex: [] }]
    }) as unknown as BotWorldState;

describe('DeathWatch', () => {
    test('a death on the men: every hit a pickpocket failure, the cause, the trace and what was carried', () => {
        const w = new DeathWatch();
        let hp = 4;
        expect(w.observe(state({ tick: 100, hp }))).toBeNull();
        for (let t = 111; hp > 0; t += 11) {
            hp -= 1;
            const r = w.observe(state({ tick: t, hp, dead: hp === 0, messages: [{ tick: t - 1, text: "You fail to pick the man's pocket." }] }));
            if (hp > 0) expect(r).toBeNull();
            else {
                expect(r).toMatchObject({ cause: 'pickpocket', damage: { pickpocket: 4 }, missed: false, thieving: 48, carriedCoins: 654, maxHp: 40 });
                expect(r!.hits.map(h => h.hp)).toEqual([3, 2, 1, 0]);
                expect(r!.trace.at(-1)).toEqual([t, 0]);
            }
        }
    });

    test('an npc hit is named from the nearby npcs; our own hits (index -1) are not counted', () => {
        const w = new DeathWatch();
        w.observe(state({ tick: 10, hp: 9 }));
        w.observe(state({ tick: 11, hp: 9, combat: [{ tick: 11, sourceType: 'npc', sourceIndex: -1, damage: 3 }] }));
        const r = w.observe(
            state({ tick: 12, hp: 0, dead: true, combat: [{ tick: 12, sourceType: 'npc', sourceIndex: 77, damage: 9 }], npcs: [{ index: 77, name: 'Dark wizard', x: 3230, z: 3219 }] })
        );
        expect(r).toMatchObject({ cause: 'npc:Dark wizard', damage: { 'npc:Dark wizard': 9 }, npcsNear: { 'Dark wizard': 1 } });
    });

    test('a dodgy kebab is its own source', () => {
        const w = new DeathWatch();
        w.observe(state({ tick: 1, hp: 6 }));
        w.observe(state({ tick: 2, hp: 2, messages: [{ tick: 2, text: 'That tasted very dodgy. You feel very ill.' }] }));
        const r = w.observe(state({ tick: 3, hp: 0, dead: true, messages: [{ tick: 3, text: "You fail to pick the guard's pocket." }] }));
        expect(r!.damage).toEqual({ kebab: 4, pickpocket: 2 });
        expect(r!.cause).toBe('kebab');
    });

    test('one record per death: the dead state over several ticks, then the respawn', () => {
        const w = new DeathWatch();
        w.observe(state({ tick: 1, hp: 1 }));
        expect(w.observe(state({ tick: 2, hp: 0, dead: true }))).not.toBeNull();
        expect(w.observe(state({ tick: 3, hp: 0, dead: true }))).toBeNull();
        expect(w.observe(state({ tick: 9, hp: 40, respawns: 1 }))).toBeNull();
        // a level-up or a heal is not a hit
        expect(w.observe(state({ tick: 10, hp: 41, maxHp: 41, respawns: 1 }))).toBeNull();
    });

    test('a death the runner never saw is recorded from the respawn that followed it', () => {
        const w = new DeathWatch();
        w.observe(state({ tick: 1, hp: 5, respawns: 0 }));
        const r = w.observe(state({ tick: 20, hp: 40, respawns: 1 }));
        expect(r).toMatchObject({ missed: true, tick: 20 });
    });

    test('hits older than the window do not count towards the cause', () => {
        expect(causeOf([{ tick: 0, damage: 30, hp: 10, source: 'npc:Dark wizard' }, { tick: 150, damage: 2, hp: 0, source: 'pickpocket' }], 150)).toEqual({ cause: 'pickpocket', damage: { pickpocket: 2 } });
    });
});
