import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { baseState, FakeSdk } from '../lib/fake-sdk';
import { OBJ_PACK } from '../lib/items';
import { buildChain, KIT_PARTNER_ROWS, PLACEMENT } from '../runner/chain';
import { applyStandIn, labRefusal, STAND_INS, type LabWorld, type StandIn } from './stand-ins';

const LAB: LabWorld = { staffLevel: '4', server: 'localhost', gateway: 'ws://localhost:8300/gateway' };
const partners = Object.fromEntries([...Object.keys(PLACEMENT), ...KIT_PARTNER_ROWS].map(id => [id, `p_${id}`]));
const chain = buildChain({ partners, firemakingTiles: '3240,3296', rings: { giver: 'r' }, bones: { giver: 'b' }, courier: { giver: 'c', below: 3 }, anvil: { giver: 'a' }, cueDir: '/tmp/x' }, { cues: { open: async () => {}, stop: () => {} } });

describe('the guard: stand-ins run on a lab only', () => {
    test('a staff-enabled loopback lab in the gateway block passes', () => {
        expect(labRefusal(LAB)).toBeNull();
        expect(labRefusal({ ...LAB, server: '127.0.0.1', gateway: 'ws://127.0.0.1:8307' })).toBeNull();
    });
    test('refuses without staff (LOCAL_STAFF_LEVEL below 4 or unset)', () => {
        expect(labRefusal({ ...LAB, staffLevel: undefined })).toContain('LOCAL_STAFF_LEVEL');
        expect(labRefusal({ ...LAB, staffLevel: '2' })).toContain('LOCAL_STAFF_LEVEL');
    });
    test('refuses a remote world', () => {
        expect(labRefusal({ ...LAB, server: '10.0.0.5' })).toContain('local lab world only');
    });
    test('refuses a gateway off loopback or outside the lab block', () => {
        expect(labRefusal({ ...LAB, gateway: 'ws://10.0.0.5:8300' })).toContain('not loopback');
        expect(labRefusal({ ...LAB, gateway: 'ws://localhost:7780' })).toContain('outside the lab block');
    });
    test('refuses anything naming a demo or run host, even through a loopback tunnel', () => {
        expect(labRefusal({ ...LAB, server: 'rs-sdk-demo.fly.dev' })).toContain('demo or run host');
        expect(labRefusal({ ...LAB, gateway: 'wss://rs-sdk-demo.fly.dev/gateway' })).toContain('demo or run host');
        expect(labRefusal({ ...LAB, server: 'rs-ashburn-run' })).toContain('demo or run host');
    });
    test('the applier refuses off a lab before sending anything', async () => {
        const sdk = new FakeSdk(baseState({ inGame: true }));
        const si: StandIn = { stepId: 'S99', name: 'fixture', owner: 'test', quest: 'mm', varps: [], xp: [], qp: { add: 0, source: 'a fixture' }, give: [], take: [], end: { x: 0, z: 0, source: 'a fixture' } };
        await expect(applyStandIn({ sdk: sdk as never }, si, { ...LAB, server: 'rs-sdk-demo.fly.dev' })).rejects.toThrow('STAND-IN S99');
        expect(sdk.sent).toEqual([]);
    });
});

describe('the table', () => {
    test("every refusing quest step on the chain has a stand-in, and no stand-in shares an id with a real step (delete its row when the module lands)", () => {
        const missing = new Set(chain.filter(s => s.kind === 'missing').map(s => s.id));
        const real = new Set(chain.filter(s => s.kind === 'step').map(s => s.id));
        expect([...missing].sort()).toEqual(STAND_INS.map(s => s.stepId).sort());
        for (const si of STAND_INS) expect(real.has(si.stepId)).toBe(false);
    });

    test('every obj it gives is in obj.pack, and every value cites a source', () => {
        const names = new Set(readFileSync(OBJ_PACK.replace(/obj\.pack$/, 'obj.pack'), 'utf8').split('\n').map(l => l.split('=')[1]?.trim()));
        for (const si of STAND_INS) {
            for (const g of si.give) expect(`${si.stepId} ${g.obj} ${names.has(g.obj)}`).toBe(`${si.stepId} ${g.obj} true`);
            for (const v of [...si.varps, ...si.xp, ...si.give, ...si.take, si.qp, si.end, ...(si.wear ?? []), ...(si.unwear ?? [])]) expect(v.source.length).toBeGreaterThan(5);
        }
    });

});
