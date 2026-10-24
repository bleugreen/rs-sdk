import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { h4mLoadRows } from '../helpers/mule-ledger';
import { deliverySession, writeMuleReady } from '../helpers/mule-readiness';
import { nameHash } from '../helpers/altar-cue';
import { parseLaunchConfig } from '../helpers/standalone';
import { objPack } from '../lib/obj-pack';
import { deliveryRefusal } from '../runner/delivery-owner';
import { MANIFEST } from '../tools/slot-ledger';
import {
    carrierGaps, carrierLaunch, carrierNames, carrierPartners, carrierReady, CARRIER_PORT_OFFSET, carrierStock, cueRootOf, firstRows, labBinding,
    labCarriersFile, productionBinding, PRODUCTION_BINDING, seedGives,
} from './carrier-launch';

const manifest = readFileSync(MANIFEST, 'utf8');
const json = JSON.parse(readFileSync(PRODUCTION_BINDING, 'utf8'));
const prod = productionBinding(json);
const LAB = ['cairn_dm1', 'cairn_dw55', 'cairn_de03'];
const names = carrierNames(LAB);
const ROOT = '/tmp/dress-lab/rc';
const base = { manifest, prod, names, cueRoot: ROOT, serve: 'labscored1', deliveryRun: 'lab-dress-1' };
/** carriers-gen.ts as run day runs it: the production names, the same ledger. */
const production = labCarriersFile({ ...base, names: { cairn_mule1: 'cairn_mule1', cairn_h55: 'cairn_h55', cairn_h03: 'cairn_h03' } });
const steps = (e: { options: { packages: { scope?: { step: string } }[] } }) => e.options.packages.map(p => p.scope!.step);

describe('the lab carriers file', () => {
    test("the production json's binding: mule1 the east rows and H4e, h55 the west, h03 H20 alone", () => {
        expect(prod.accounts.H20).toBe('cairn_h03');
        expect(prod.accounts.H6).toBe('cairn_h55');
        expect(prod.accounts.H1).toBe('cairn_mule1');
        expect(prod.onRequest).toEqual(['H4e']);
        expect(new Set(Object.values(prod.accounts))).toEqual(new Set(['cairn_mule1', 'cairn_h55', 'cairn_h03']));
    });

    test("the generator's packages, byte for byte, under the lab names; each account's rows are the production json's, H4m's loads on h55 while the ledger has the row", () => {
        const lab = labCarriersFile(base);
        expect(lab.accounts.map(e => e.account)).toEqual(LAB);
        const loads = h4mLoadRows(manifest);
        for (const [i, e] of lab.accounts.entries()) {
            const p = production.accounts[i]!;
            expect(e.options.packages).toEqual(p.options.packages);
            const prodRows = (json.accounts as { account: string; options: { packages: { scope: { step: string } }[] } }[]).find(a => a.account === p.account)!.options.packages.map(k => k.scope.step);
            const own = new Set(steps(e));
            for (const r of prodRows) expect(own.has(r)).toBe(true);
            const extra = steps(e).filter(r => !prodRows.includes(r));
            expect(extra).toEqual(p.account === 'cairn_h55' ? loads : []);
        }
        expect(loads.length).toBeGreaterThan(0);
        expect(steps(lab.accounts[1]!).slice(steps(lab.accounts[1]!).indexOf('H4p'), steps(lab.accounts[1]!).indexOf('H4p') + 1 + loads.length)).toEqual(['H4p', ...loads]);
    });

    test('serve is the lab SCORED, the token is the lab run, the cue dir is the run\'s <root>/mule; run.ts\'s delivery preflight accepts the file', () => {
        const lab = labCarriersFile(base);
        for (const e of lab.accounts) {
            expect([e.role, e.cueDir, e.options.cueDir, e.options.serve, e.options.deliveryRun, e.options.serveMode]).toEqual(['mule', `${ROOT}/mule`, `${ROOT}/mule`, 'labscored1', 'lab-dress-1', 'request']);
        }
        const rows = lab.accounts.flatMap(e => e.options.packages.filter(p => !p.onRequest).map(p => ({ row: p.scope!.step, account: e.account, at: p.at })));
        expect(deliveryRefusal({ run: 'lab-dress-1', rows, receiver: 'labscored1', dir: `${ROOT}/mule`, launcher: lab })).toBeNull();
        expect(deliveryRefusal({ run: 'lab-dress-2', rows, receiver: 'labscored1', dir: `${ROOT}/mule`, launcher: lab })).toContain('deliveryRun');
    });

    test("a slice's rows: only those, on their carriers; H4p brings H4m's loads; no carrier row gives no file", () => {
        expect(labCarriersFile({ ...base, rows: ['H18', 'H19', 'S20'] }).accounts.map(e => [e.account, steps(e)])).toEqual([['cairn_dm1', ['H18', 'H19']]]);
        expect(labCarriersFile({ ...base, rows: ['H4p'] }).accounts.map(e => [e.account, steps(e)])).toEqual([['cairn_dw55', ['H4p', ...h4mLoadRows(manifest)]]]);
        expect(labCarriersFile({ ...base, rows: ['S05'] }).accounts).toEqual([]);
    });

    test("the run config's partners: each bound row and H4m's loads to its lab carrier", () => {
        const p = carrierPartners(manifest, prod, names);
        expect([p.H1, p.H6, p.H20, p.H4e]).toEqual(['cairn_dm1', 'cairn_dw55', 'cairn_de03', 'cairn_dm1']);
        for (const r of h4mLoadRows(manifest)) expect(p[r]).toBe('cairn_dw55');
    });

    test('three lab names in role order; a missing production account throws; the mule dir must be <root>/mule', () => {
        expect(names).toEqual({ cairn_mule1: 'cairn_dm1', cairn_h55: 'cairn_dw55', cairn_h03: 'cairn_de03' });
        expect(() => carrierNames(LAB.slice(0, 2))).toThrow('takes 3');
        expect(() => labBinding(prod, { cairn_mule1: 'a', cairn_h55: 'b' })).toThrow('cairn_h03');
        expect(cueRootOf('/r/rc/mule')).toBe('/r/rc');
        expect(() => cueRootOf('/r/rc/carriers')).toThrow('<cue root>/mule');
    });
});

describe('the carriers launcher and their bank seed', () => {
    test('standalone.ts takes the launcher config as written: one mule entry per carrier, its cue dir, no final, on AGENT_PORT+12', () => {
        const lab = labCarriersFile(base);
        const c = carrierLaunch({ entries: lab.accounts, botsDir: '/tmp/b', runDir: '/tmp/r', gatewayPort: 8300 + CARRIER_PORT_OFFSET });
        expect(c.gatewayPort).toBe(8312);
        const parsed = parseLaunchConfig(c);
        expect(parsed.accounts.map(e => [e.account, e.role, e.final, e.cueDir])).toEqual(LAB.map(a => [a, 'mule', false, `${ROOT}/mule`]));
    });

    test("the stock is exactly the packages' lines by id, top-ups at their max, summed across packages", () => {
        const stock = carrierStock({ packages: [
            { name: 'a', items: [{ id: 995, topUp: { max: 100 } }, { id: 563, amount: 2 }] },
            { name: 'b', items: [{ id: 563, amount: 3 }, { id: 385, topUp: { max: 8 } }] },
        ] } as never);
        expect([...stock]).toEqual([[995, 100], [563, 5], [385, 8]]);
        expect(() => carrierStock({ packages: [{ name: 'c', items: [{ item: 'Shark', amount: 1 }] }] } as never)).toThrow('by id only');
    });

    test("every carrier's seed gives are staff names the pack knows, noted where the item has a note, and add up to its stock", () => {
        const pack = objPack();
        for (const e of labCarriersFile(base).accounts) {
            const stock = carrierStock(e.options);
            const gives = seedGives(stock, pack);
            for (const g of gives) expect(pack.ids.has(g.obj)).toBe(true);
            const total = new Map<number, number>();
            for (const g of gives) total.set(g.id, (total.get(g.id) ?? 0) + g.n);
            for (const [id, n] of stock) expect(total.get(id)).toBe(n);
        }
        // Sharks (a note exists), many: one noted stack; air runes (no note): themselves.
        expect(seedGives(new Map([[385, 15], [556, 550]]), pack)).toEqual([{ id: 385, obj: 'cert_shark', n: 15 }, { id: 556, obj: pack.names.get(556)!, n: 550 }]);
    });

    test("a carrier is ready when its status passes readyFor on its first row: this run's token, SCORED, staged on the tile, fresh", () => {
        const dir = mkdtempSync(join(tmpdir(), 'carrier-ready-'));
        const lab = labCarriersFile(base);
        const first = firstRows(lab.accounts);
        expect(first.cairn_dm1!.row).toBe('H1');
        expect(first.cairn_de03!.row).toBe('H20');
        const ready = carrierReady(dir, { serve: 'labscored1', deliveryRun: 'lab-dress-1', first });
        const now = Date.now();
        expect(ready('cairn_dm1', now)).toBe(false);
        const put = (o: { phase?: 'ready' | 'staging'; tile?: { x: number; z: number; level: number }; runId?: string; ms?: number }) => writeMuleReady(dir, {
            runId: o.runId ?? 'lab-dress-1', account: 'cairn_dm1', row: 'H1', session: deliverySession(o.runId ?? 'lab-dress-1', 'H1'), receiverHash: nameHash('labscored1'),
            phase: o.phase ?? 'ready', tile: o.tile ?? { ...first.cairn_dm1!.at, level: first.cairn_dm1!.at.level ?? 0 }, staged: (o.phase ?? 'ready') === 'ready', preparationSeq: 0, tick: 10, ms: o.ms ?? now - 500,
        });
        put({});
        expect(ready('cairn_dm1', now)).toBe(true);
        put({ phase: 'staging' });
        expect(ready('cairn_dm1', now)).toBe(false);
        put({ tile: { x: 3200, z: 3200, level: 0 } });
        expect(ready('cairn_dm1', now)).toBe(false);
        put({ runId: 'other-run' });
        expect(ready('cairn_dm1', now)).toBe(false);
        put({ ms: now - 60_000 });
        expect(ready('cairn_dm1', now)).toBe(false);
    });
});

describe('carrierGaps', () => {
    test('none named is no gap (the stub or staff supply serves the rows, as before); named, they are three distinct lab cairn_ names', () => {
        expect(carrierGaps({})).toEqual([]);
        expect(carrierGaps({ carriers: LAB })).toEqual([]);
        expect(carrierGaps({ carriers: LAB.slice(0, 2) })[0]).toContain('names 2 carrier(s)');
        expect(carrierGaps({ carriers: ['cairn_dm1', 'cairn_dm1', 'cairn_de03'] })).toContain('--carriers names a carrier twice (cairn_dm1, cairn_dm1, cairn_de03)');
        expect(carrierGaps({ carriers: ['cairn_mule1', 'cairn_dw55', 'cairn_de03'] })[0]).toContain('never the production carrier');
        expect(carrierGaps({ carriers: LAB, labHelpers: ['cairn_dw55'] })[0]).toContain('is on LAB_HELPERS');
        expect(carrierGaps({ carriers: LAB, others: { '--courier': ['cairn_de03'] } })[0]).toContain('also named by --courier');
    });
});
