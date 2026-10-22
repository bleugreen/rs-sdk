import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BotAction, BotWorldState } from '../../sdk/types';
import { activityOf, allowAction, parseHiscorePage } from './observe';

// A state holding only what allowAction reads: nearby locs and npcs.
function state(locs: { id: number; name: string; x: number; z: number }[] = [], npcs: { index: number; name: string }[] = []): BotWorldState {
    return { nearbyLocs: locs, nearbyNpcs: npcs } as unknown as BotWorldState;
}

const act = (a: Record<string, unknown>) => ({ reason: 'test', ...a }) as BotAction;

describe('allowAction (tenet 6 guard)', () => {
    test('walking, waiting and dialogue continues pass', () => {
        for (const a of [act({ type: 'walkTo', x: 1, z: 2 }), act({ type: 'wait' }), act({ type: 'clickDialogOption', optionIndex: 0 }), act({ type: 'acceptCharacterDesign' })]) {
            expect(allowAction(a, state())).toBeNull();
        }
    });

    test('every action that can reach another player or a resource is refused', () => {
        const refused = [
            act({ type: 'interactPlayer', playerIndex: 3, optionIndex: 1 }),
            act({ type: 'spellOnPlayer', playerIndex: 3, spellComponent: 1 }),
            act({ type: 'say', message: 'hi' }),
            act({ type: 'privateMessage', targetName: 'x', message: 'hi' }),
            act({ type: 'pickupItem', x: 1, z: 1, itemId: 995 }),
            act({ type: 'interactGroundItem', x: 1, z: 1, itemId: 995, optionIndex: 1 }),
            act({ type: 'useItemOnLoc', itemSlot: 0, x: 1, z: 1, locId: 1 }),
            act({ type: 'useItemOnNpc', itemSlot: 0, npcIndex: 1 }),
            act({ type: 'spellOnNpc', npcIndex: 1, spellComponent: 1 }),
            act({ type: 'bankWithdraw', slot: 0, amount: 1 }),
            act({ type: 'shopBuy', slot: 0, amount: 1 }),
            act({ type: 'dropItem', slot: 0 }),
        ];
        for (const a of refused) expect(allowAction(a, state())).not.toBeNull();
    });

    test('only the logout button is clickable', () => {
        expect(allowAction(act({ type: 'clickComponent', componentId: 2458 }), state())).toBeNull();
        expect(allowAction(act({ type: 'clickComponent', componentId: 3420 }), state())).not.toBeNull();
    });

    test('locs: doors and stairs pass, resources and unknown locs do not', () => {
        const s = state([
            { id: 1, name: 'Door', x: 10, z: 10 },
            { id: 2, name: 'Staircase', x: 11, z: 10 },
            { id: 3, name: 'Iron rocks', x: 12, z: 10 },
            { id: 4, name: 'Willow', x: 13, z: 10 },
        ]);
        expect(allowAction(act({ type: 'interactLoc', x: 10, z: 10, locId: 1, optionIndex: 1 }), s)).toBeNull();
        expect(allowAction(act({ type: 'interactLoc', x: 11, z: 10, locId: 2, optionIndex: 1 }), s)).toBeNull();
        expect(allowAction(act({ type: 'interactLoc', x: 12, z: 10, locId: 3, optionIndex: 1 }), s)).not.toBeNull();
        expect(allowAction(act({ type: 'interactLoc', x: 13, z: 10, locId: 4, optionIndex: 1 }), s)).not.toBeNull();
        // A loc the observer has not seen is refused, even by a passable-looking id.
        expect(allowAction(act({ type: 'interactLoc', x: 99, z: 99, locId: 1, optionIndex: 1 }), s)).not.toBeNull();
        expect(allowAction(act({ type: 'interactLoc', x: 10, z: 10, locId: 1, optionIndex: 1 }), null)).not.toBeNull();
    });

    test('npcs: only the tutorial guide', () => {
        const s = state([], [{ index: 5, name: 'RuneScape Guide' }, { index: 6, name: 'Knight of Ardougne' }]);
        expect(allowAction(act({ type: 'interactNpc', npcIndex: 5, optionIndex: 1 }), s)).toBeNull();
        expect(allowAction(act({ type: 'interactNpc', npcIndex: 6, optionIndex: 2 }), s)).not.toBeNull();
        expect(allowAction(act({ type: 'talkToNpc', npcIndex: 7 }), s)).not.toBeNull();
    });
});

describe('activityOf', () => {
    test('maps seq.pack names to skills', () => {
        expect(activityOf('human_mining_rune_pickaxe')).toBe('mining');
        expect(activityOf('human_woodcutting_bronze_axe')).toBe('woodcutting');
        expect(activityOf('human_harpoon')).toBe('fishing');
        expect(activityOf('human_pickpocket')).toBe('thieving');
        expect(activityOf('human_walk_logbalance')).toBe('agility');
        expect(activityOf('human_unarmedblock')).toBeNull();
        expect(activityOf(null)).toBeNull();
    });
});

describe('parseHiscorePage', () => {
    const row = (skill: string, rank: string, level: string, ticks: string) =>
        `<tr><td><a href="/hiscores?category=1&profile=main" class="c"><img src="/img/skill/x.png">${skill}</a></td>
         <td align="right">${rank}</td>
         <td align="right">${level}</td>
         <td align="right"><span title="${ticks} ticks" style="">1h</span></td></tr>`;

    const fixture = (name: string) => readFileSync(join(import.meta.dir, 'fixtures/hiscore', name), 'utf8');

    test('old form (lab worlds): reads skill, rank, level and exact ticks', () => {
        const h = parseHiscorePage('stunbaron', row('Overall', '1', '1,881', '35,916') + row('Mining', '7', '99', '12,006'));
        expect(h.found).toBe(true);
        expect(h.skills).toEqual([
            { skill: 'Overall', rank: 1, level: 1881, ticks: 35916 },
            { skill: 'Mining', rank: 7, level: 99, ticks: 12006 },
        ]);
    });

    test('normalized form (demo since its 400 ms restart): ticks read straight from the title', () => {
        const h = parseHiscorePage('cairn_chops', fixture('player-cairn_chops-2026-10-22-400ms.html'));
        expect(h.found).toBe(true);
        expect(h.skills.find(s => s.skill === 'Woodcutting')).toEqual({ skill: 'Woodcutting', rank: 1, level: 99, ticks: 3_329 });
        expect(h.skills.find(s => s.skill === 'Overall')).toMatchObject({ level: 126, ticks: 3_329 });
        // Skills under level 15 have no row on the page.
        expect(h.skills.some(s => s.skill === 'Attack')).toBe(false);
        const burns = parseHiscorePage('cairn_burns', fixture('player-cairn_burns-2026-10-22-400ms.html'));
        expect(burns.skills.find(s => s.skill === 'Firemaking')).toMatchObject({ level: 99, ticks: 690 });
    });

    test('seconds form (demo, 19:34 to 19:56 UTC): the same ticks under the rate it was rendered at', () => {
        const html = fixture('player-cairn_chops-2026-10-22.html');
        expect(parseHiscorePage('cairn_chops', html, 300).skills.find(s => s.skill === 'Woodcutting')).toEqual({ skill: 'Woodcutting', rank: 1, level: 99, ticks: 3_329 });
        expect(() => parseHiscorePage('cairn_chops', html)).toThrow(/no tick rate/);
    });

    test('a seconds title off the rate grid throws instead of caching a wrong stamp', () => {
        const html = fixture('player-cairn_burns-2026-10-22.html').replaceAll('title="207 seconds', 'title="207.1 seconds');
        expect(() => parseHiscorePage('cairn_burns', html, 300)).toThrow(/not a whole number of 300 ms ticks/);
    });

    test('a page with no skill rows throws rather than reading as unranked', () => {
        expect(() => parseHiscorePage('x', '<html><body>502 Bad Gateway</body></html>')).toThrow(/no skill rows/);
    });

    test('a missing player is not found', () => {
        expect(parseHiscorePage('nobody', '<p>Player "nobody" not found.</p>').found).toBe(false);
        expect(parseHiscorePage('nobody', fixture('player-missing.html'))).toMatchObject({ found: false, skills: [] });
    });
});
