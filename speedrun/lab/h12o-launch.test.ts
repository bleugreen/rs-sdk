import { describe, expect, test } from 'bun:test';
import { parseLaunchConfig } from '../helpers/standalone';
import { h12oLoginRefusal, h12oTopUp } from '../runner/chain';
import { carriedLoad, h12oGaps, h12oLaunch, H12O_LAB_LEAD_TICKS, H12O_PORT_OFFSET, labH12o, runsH12o } from './h12o-launch';

const cfg = { cueDir: '/run/rc-cue', muleCueDir: '/run/rc-cue/mule' };

describe('labH12o', () => {
    test("the run's h45-cue and h45-login beside its cue dir, the lab lead, the account: run.ts's login trigger and Monkey Madness's top-ups accept it", () => {
        const h = labH12o('cairn_d45', cfg);
        expect(h).toEqual({ account: 'cairn_d45', cueDir: '/run/h45-cue', loginDir: '/run/h45-login', leadTicks: H12O_LAB_LEAD_TICKS });
        expect(h12oLoginRefusal({ ...cfg, h12o: h })).toBeNull();
        expect(h12oTopUp({ ...cfg, h12o: h })).toMatchObject({ from: 'cairn_d45', m: true, p: true, cueDir: '/run/h45-cue' });
    });

    test("the lab config's own folders and lead win", () => {
        expect(labH12o('cairn_d45', { ...cfg, h12o: { cueDir: '/x/c', loginDir: '/x/l', leadTicks: 120 } })).toEqual({ account: 'cairn_d45', cueDir: '/x/c', loginDir: '/x/l', leadTicks: 120 });
    });
});

describe('h12oLaunch', () => {
    const h = labH12o('cairn_d45', cfg);
    const c = h12oLaunch({ h12o: h, serve: 'labscored1', botsDir: '/tmp/b', runDir: '/tmp/r', gatewayPort: 8300 + H12O_PORT_OFFSET });

    test("h45's generated entry: request mode, carried, H12oM's sharks at (2763,2704), H12oP's potion and sharks at (2803,2724), serving the lab SCORED", () => {
        expect(c.gatewayPort).toBe(8315);
        const e = c.accounts[0]!;
        expect([e.account, e.role, e.options.serve, e.options.serveMode, e.options.carried]).toEqual(['cairn_d45', 'mule', 'labscored1', 'request', true]);
        const pk = e.options.packages as { name: string; at: { x: number; z: number }; items: { id: number; topUp?: { max: number } }[]; scope: { step: string } }[];
        expect(pk.map(p => [p.scope.step, p.at.x, p.at.z])).toEqual([['H12oM', 2763, 2704], ['H12oP', 2803, 2724]]);
        expect(pk[0]!.items).toEqual([{ id: 385, topUp: { max: 15 } }]);
        expect(carriedLoad(e)).toEqual({ sharks: 24, potions: 1 });
    });

    test('standalone.ts takes it as HELPERS.md runs it: its role folder h45-cue, logged in on {H12o, mule} in h45-login, out on H12oP, no final', () => {
        const e = parseLaunchConfig(c).accounts[0]!;
        expect([e.cueDir, e.loginOn?.step, e.loginOn?.family, e.loginOn?.cueDir, e.stopOn, e.final]).toEqual(['/run/h45-cue', 'H12o', 'mule', '/run/h45-login', { step: 'H12oP', family: 'mule' }, false]);
    });
});

describe('h12oGaps', () => {
    const MM = [{ id: 'S15' }, { id: 'H12o login' }, { id: 'S15' }];
    test('a slice that fires the H12o login refuses without --h12o; with a lab name it does not; cairn_h45 itself refuses', () => {
        expect(runsH12o(MM)).toBe(true);
        expect(h12oGaps(MM, {})[0]).toContain('--h12o=');
        expect(h12oGaps(MM, { h12o: 'cairn_d45' })).toEqual([]);
        expect(h12oGaps(MM, { h12o: 'cairn_h45' })[0]).toContain('never cairn_h45');
        expect(h12oGaps(MM, { h12o: 'cairn_d45', labHelpers: ['cairn_d45'] })[0]).toContain('is on LAB_HELPERS');
        expect(h12oGaps([{ id: 'S16' }], {})).toEqual([]);
    });
});
