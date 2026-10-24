import { describe, expect, test } from 'bun:test';
import { boneGiverOptions } from '../helpers/bone-giver';
import { parseLaunchConfig } from '../helpers/standalone';
import { objPack } from '../lib/obj-pack';
import { STAND_IN_STEP } from '../runner/run-report';
import { COURIER_BANK, COURIER_PORT_OFFSET, courierGaps, courierLaunch, courierSeed, runsS18 } from './courier-launch';

const S18 = [{ id: 'T17-18', name: 'leg' }, { id: 'S18', name: 'S18 thieving:knights' }];

describe('courierLaunch', () => {
    const c = courierLaunch({ account: 'cairn_dc15', botsDir: '/tmp/b', runDir: '/tmp/r', gatewayPort: 8300 + COURIER_PORT_OFFSET });

    test("e15's role through bone-giver.ts's own parser: on-request, iron ore, hold 14, refill below 14, the carry list, bank restock at Ardougne south, the {S18, courier} scope", () => {
        expect(c.gatewayPort).toBe(8314);
        const o = boneGiverOptions(c.accounts[0]!.options, { RC_CUE_DIR: '/tmp/cue' });
        expect([o.mode, o.item, o.obj, o.hold, o.refillBelow, o.scope]).toEqual(['on-request', 'Iron ore', 'iron_ore', 14, 14, { step: 'S18', family: 'courier' }]);
        expect(o.carry.map(x => [x.item, x.count, x.once ?? false])).toEqual([['Shark', 2, false], ['Adamant arrowtips', 2220, true], ['Rune arrowtips', 570, true], ['Copper ore', 5, true], ['Tin ore', 5, true]]);
        expect([o.restock.kind, o.restock.bank]).toEqual(['bank', { ...COURIER_BANK }]);
        expect(o.sites).toEqual([{ giver: { x: 2671, z: 3305 }, receiver: { x: 2670, z: 3305 } }]);
    });

    test("the bank's lab seed is staff names the pack knows: 14 loads of ore and sharks, noted, the once stacks once", () => {
        const pack = objPack();
        const seed = courierSeed();
        for (const s of seed) expect(pack.ids.has(s.obj)).toBe(true);
        expect(seed).toEqual([
            { obj: 'cert_iron_ore', n: 196 }, { obj: 'cert_shark', n: 28 }, { obj: 'adamant_arrowheads', n: 2220 }, { obj: 'rune_arrowheads', n: 570 }, { obj: 'cert_copper_ore', n: 5 }, { obj: 'cert_tin_ore', n: 5 },
        ]);
    });

    test('standalone.ts takes it: logged in on {S18, courier}, out on its close', () => {
        const e = parseLaunchConfig(c).accounts[0]!;
        expect([e.account, e.role, e.final, e.loginOn?.step, e.loginOn?.family, e.stopOn]).toEqual(['cairn_dc15', 'bone-giver', false, 'S18', 'courier', { step: 'S18', family: 'courier' }]);
    });
});

describe('courierGaps', () => {
    test('a slice running S18 refuses without --courier, naming --staff-steps; jumped or absent needs none', () => {
        expect(courierGaps(S18, {})[0]).toContain('--courier=');
        expect(courierGaps(S18, {})[0]).toContain('--staff-steps=S18');
        expect(courierGaps(S18, { courier: 'cairn_dc15' })).toEqual([]);
        expect(courierGaps([{ id: 'S19' }], {})).toEqual([]);
        expect(runsS18([{ id: 'S18', name: `${STAND_IN_STEP} S18` }])).toBe(false);
    });

    test('a cairn_ name, not on LAB_HELPERS, no other flag', () => {
        expect(courierGaps(S18, { courier: 'lab_c' })[0]).toContain('not a cairn_ helper name');
        expect(courierGaps(S18, { courier: 'cairn_dc15', labHelpers: ['cairn_dc15'] })[0]).toContain('is on LAB_HELPERS');
        expect(courierGaps(S18, { courier: 'cairn_dc15', others: { '--anvil': ['cairn_dc15'] } })[0]).toContain('named by both --anvil and --courier');
    });
});
