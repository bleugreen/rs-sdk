import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CUE_FILE, nameHash, readCue, type Cue } from '../helpers/altar-cue';
import { deliveryCueAuthorizes, STALE_CUE_MS } from '../helpers/mule';
import { cancelMulePreparation, holdMule, readMulePreparation, writeMuleReady, type WorldTile } from '../helpers/mule-readiness';
import { muleDelivery } from '../helpers/mule-itinerary';
import { baseState, FakeSdk } from '../lib/fake-sdk';
import { holdInputs } from '../tools/mule-hold';
import { muleScope } from './chain';
import { CUE_REFRESH_TICKS, CueKeeper } from './cue-keeper';
import { DeliveryOwner, deliveryOwnerFor, type DeliveryRow } from './delivery-owner';

const SCORED = 'Scored Name';
const RUN = 'a1-20261023';
const MULE = 'cairn_mule1';
const rows: DeliveryRow[] = ['H1', 'H4', 'H4k'].map(row => ({ row, account: MULE, at: muleDelivery(row).at }));
const dirOf = (tag: string) => mkdtempSync(join(tmpdir(), `delivery-${tag}-`));

afterEach(() => setSystemTime());

/**
 * A stand-in for a `deliveryRun` carrier's readiness publishing (mule.ts publishDelivery): on every
 * frame it reports ready, staged at the prepared row's tile, under the live prepare's generation,
 * except for rows in `served` (mule.ts 'delivery already served': it never re-stages them).
 */
function carrier(sdk: FakeSdk, dir: string, o: { served?: Set<string> } = {}): () => void {
    return sdk.onStateUpdate(s => {
        const c = readMulePreparation(dir, MULE);
        if (c?.op !== 'prepare') return;
        const at = rows.find(r => r.row === c.row)!.at;
        const served = o.served?.has(c.row) ?? false;
        writeMuleReady(dir, {
            runId: c.runId, account: MULE, row: c.row, session: c.session, receiverHash: c.receiverHash,
            phase: served ? 'off' : 'ready', tile: { ...at }, staged: !served, preparationSeq: c.seq, tick: s.tick, ms: Date.now(),
        });
    });
}

function rig(tag: string, o: { owner?: boolean; served?: Set<string> } = {}) {
    const dir = dirOf(tag);
    const sdk = new FakeSdk(baseState({ tick: 1, inGame: true }));
    const owner = new DeliveryOwner(dir, RUN, SCORED, rows);
    const keeper = new CueKeeper(dir, SCORED, o.owner === false ? null : owner);
    const offs = [keeper.attach(sdk), carrier(sdk, dir, o)];
    const timer = setInterval(() => sdk.tick(), 2);
    const ctx = { sdk: sdk as never };
    return { dir, sdk, owner, keeper, ctx, done: () => { clearInterval(timer); offs.forEach(f => f()); } };
}

const cueIn = (dir: string) => JSON.parse(readFileSync(join(dir, CUE_FILE), 'utf8')) as Cue;
const authorizes = (dir: string, row: string, serve = SCORED, session = `${RUN}:${row}`) => deliveryCueAuthorizes(readCue(dir), { session, row, serve });

describe('a mule cue opened by the run CueKeeper passes the carrier\'s own authorization', () => {
    test('right row and receiver authorize; a wrong row, a wrong receiver or a stopped cue refuse', async () => {
        const r = rig('auth');
        try {
            await r.keeper.open(muleScope('H1'), r.ctx, { fresh: true });
            const cue = cueIn(r.dir);
            expect(cue.session).toBe(`${RUN}:H1`);
            expect(authorizes(r.dir, 'H1')).toBe(true);
            // The carrier pending H4 (its session RUN:H4) refuses H1's cue, and H1 under H4's session too.
            expect(authorizes(r.dir, 'H4')).toBe(false);
            expect(deliveryCueAuthorizes(readCue(r.dir), { session: `${RUN}:H4`, row: 'H1', serve: SCORED })).toBe(false);
            expect(authorizes(r.dir, 'H1', 'Another Receiver')).toBe(false);
            // Another run's carrier (a different deliveryRun) refuses it.
            expect(authorizes(r.dir, 'H1', SCORED, 'a2-20261023:H1')).toBe(false);
            r.keeper.stop(muleScope('H1'), undefined, { final: false });
            expect(cueIn(r.dir).stop).toBe(true);
            expect(authorizes(r.dir, 'H1')).toBe(false);
        } finally {
            r.done();
        }
    });

    test('a cue older than STALE_CUE_MS refuses', async () => {
        const r = rig('stale');
        try {
            await r.keeper.open(muleScope('H1'), r.ctx, { fresh: true });
            const cue = cueIn(r.dir);
            expect(deliveryCueAuthorizes(cue, { session: cue.session, row: 'H1', serve: SCORED, now: cue.ms + STALE_CUE_MS })).toBe(true);
            expect(deliveryCueAuthorizes(cue, { session: cue.session, row: 'H1', serve: SCORED, now: cue.ms + STALE_CUE_MS + 1 })).toBe(false);
        } finally {
            r.done();
        }
    });

    test('the open delivery cue is rewritten every CUE_REFRESH_TICKS, so a row whose step runs >150 ticks (80 s at 400 ms) still authorizes at the click', async () => {
        const dir = dirOf('fresh');
        const sdk = new FakeSdk(baseState({ tick: 1, inGame: true }));
        const owner = new DeliveryOwner(dir, RUN, SCORED, rows);
        const keeper = new CueKeeper(dir, SCORED, owner);
        const plain = dirOf('fresh-plain');
        const legacy = new CueKeeper(plain, SCORED);
        const offs = [keeper.attach(sdk), legacy.attach(sdk), carrier(sdk, dir)];
        let now = Date.now();
        const timer = setInterval(() => sdk.tick(), 2);
        try {
            await keeper.open(muleScope('H4'), { sdk: sdk as never }, { fresh: true });
            await legacy.open(muleScope('H4'), { sdk: sdk as never }, { fresh: true });
            clearInterval(timer);
            const first = cueIn(dir);
            setSystemTime(now);
            for (let i = 0; i < 200; i++) {
                setSystemTime((now += 400));
                sdk.tick();
            }
            const last = cueIn(dir);
            expect(last.session).toBe(first.session);
            expect(last.seq).toBeGreaterThanOrEqual(first.seq + Math.floor(200 / CUE_REFRESH_TICKS) - 1);
            expect(last.stop ?? false).toBe(false);
            expect(Date.now() - last.ms).toBeLessThanOrEqual(CUE_REFRESH_TICKS * 400);
            expect(authorizes(dir, 'H4')).toBe(true);
            // Without a run owner the cue is never rewritten: 80 s on, the carrier would refuse it.
            expect(cueIn(plain).seq).toBe(1);
            expect(Date.now() - cueIn(plain).ms).toBeGreaterThan(STALE_CUE_MS);
            // Just before the trade click the open cue is rewritten once more.
            const before = cueIn(dir).seq;
            setSystemTime((now += 400));
            expect(keeper.refresh(muleScope('H4'))).toBe(true);
            expect(cueIn(dir).seq).toBe(before + 1);
            expect(cueIn(dir).ms).toBe(Date.now());
            expect(keeper.refresh(muleScope('H1'))).toBe(false);
        } finally {
            clearInterval(timer);
            offs.forEach(f => f());
        }
    });
});

describe('the run owner\'s per-row sequence', () => {
    test('prepare precedes the cue, the cue waits for readiness under that prepare, the stop precedes the carrier\'s next prepare (carry-ahead)', async () => {
        const r = rig('order');
        try {
            await r.keeper.open(muleScope('H4'), r.ctx, { fresh: true });
            const control = readMulePreparation(r.dir, MULE)!;
            const cue = cueIn(r.dir);
            expect([control.op, control.row, control.session]).toEqual(['prepare', 'H4', `${RUN}:H4`]);
            expect(control.ms).toBeLessThanOrEqual(cue.ms);
            expect(r.owner.ready('H4').ok).toBe(true);
            r.keeper.stop(muleScope('H4'), undefined, { final: false });
            const stopped = cueIn(r.dir);
            const next = readMulePreparation(r.dir, MULE)!;
            expect(stopped.stop).toBe(true);
            expect([next.op, next.row, next.seq]).toEqual(['prepare', 'H4k', control.seq + 1]);
            expect(stopped.ms).toBeLessThanOrEqual(next.ms);
            // The carrier's last row prepares nothing after it.
            await r.keeper.open(muleScope('H4k'), r.ctx, { fresh: true });
            expect(readMulePreparation(r.dir, MULE)!.seq).toBe(next.seq);
            r.keeper.stop(muleScope('H4k'), undefined, { final: true });
            expect(readMulePreparation(r.dir, MULE)!.seq).toBe(next.seq);
        } finally {
            r.done();
        }
    });

    test('a matching live prepare is reused, not re-written; a failed step\'s stop prepares no next row', async () => {
        const r = rig('reuse');
        try {
            const a = r.owner.prepare('H1');
            const again = new DeliveryOwner(r.dir, RUN, SCORED, rows).prepare('H1');
            expect(again.preparationSeq).toBe(a.preparationSeq);
            await r.keeper.open(muleScope('H1'), r.ctx, { fresh: true });
            expect(readMulePreparation(r.dir, MULE)!.seq).toBe(a.preparationSeq);
            r.keeper.stop(muleScope('H1'), undefined, { final: false, failed: true });
            expect(readMulePreparation(r.dir, MULE)!.row).toBe('H1');
        } finally {
            r.done();
        }
    });

    test('a carrier never ready refuses with a reason within the bound; a fault refuses at once', async () => {
        const dir = dirOf('never');
        const sdk = new FakeSdk(baseState({ tick: 1, inGame: true }));
        const owner = new DeliveryOwner(dir, RUN, SCORED, rows);
        const timer = setInterval(() => sdk.tick(), 2);
        try {
            await expect(owner.awaitReady('H1', sdk as never, { maxTicks: 20 })).rejects.toThrow(/H1: carrier cairn_mule1 was not ready within 20 ticks.*no readiness status/);
            const c = readMulePreparation(dir, MULE)!;
            writeMuleReady(dir, { runId: RUN, account: MULE, row: 'H1', session: c.session, receiverHash: c.receiverHash, phase: 'fault', tile: null, staged: false, preparationSeq: c.seq, tick: 1, ms: Date.now() });
            await expect(owner.awaitReady('H1', sdk as never, { maxTicks: 5000 })).rejects.toThrow(/delivery fault/);
        } finally {
            clearInterval(timer);
        }
    });

    test('the initial hold (before the carrier starts) is replaced by the run\'s prepare for that row', () => {
        const dir = dirOf('hold');
        holdMule(dir, { runId: RUN, account: MULE, row: 'H1', receiver: SCORED, at: rows[0]!.at, attempt: 1 });
        const b = new DeliveryOwner(dir, RUN, SCORED, rows).prepare('H1');
        const c = readMulePreparation(dir, MULE)!;
        expect([c.op, c.row, c.seq]).toEqual(['prepare', 'H1', b.preparationSeq]);
        expect(b.preparationSeq).toBe(2);
    });
});

describe('re-runs', () => {
    test('a re-run reopening an unserved row adopts its persisted session and is served; a served row is refused, never served twice', async () => {
        const served = new Set<string>();
        const r = rig('rerun', { served });
        try {
            await r.keeper.open(muleScope('H1'), r.ctx, { fresh: true });
            const first = cueIn(r.dir);
            r.keeper.stop(muleScope('H1'), undefined, { final: false, failed: true });
            // A new process: its own owner and keeper over the same directory.
            const owner = new DeliveryOwner(r.dir, RUN, SCORED, rows);
            const keeper = new CueKeeper(r.dir, SCORED, owner);
            const off = keeper.attach(r.sdk);
            try {
                await keeper.open(muleScope('H1'), r.ctx, { fresh: true });
                const reopened = cueIn(r.dir);
                expect(reopened.session).toBe(first.session);
                expect(reopened.seq).toBe(first.seq + 2);
                expect(reopened.stop ?? false).toBe(false);
                expect(authorizes(r.dir, 'H1')).toBe(true);
                keeper.stop(muleScope('H1'), undefined, { final: false, failed: true });
                // The carrier served H1 (mule.ts deliveryWasServed): it publishes 'off' for the row and never stages it again.
                served.add('H1');
                await expect(new DeliveryOwner(r.dir, RUN, SCORED, rows).awaitReady('H1', r.sdk as never, { maxTicks: 20 })).rejects.toThrow(/H1 off, staged false/);
            } finally {
                off();
            }
        } finally {
            r.done();
        }
    });
});

describe('other families and runs without a run owner', () => {
    test('a non-mule cue keeps a random session and is never rewritten; a keeper without an owner gives mule cues random sessions', async () => {
        const r = rig('families');
        const plain = rig('families-plain', { owner: false });
        try {
            await r.keeper.open({ step: 'S07', family: 'bone' }, r.ctx, { fresh: true });
            const bone = cueIn(r.dir);
            expect(bone.session).not.toContain(RUN);
            const t = r.sdk.getState()!.tick;
            for (let i = 0; i < CUE_REFRESH_TICKS * 3; i++) r.sdk.tick();
            expect(r.sdk.getState()!.tick).toBeGreaterThan(t + CUE_REFRESH_TICKS * 2);
            expect(cueIn(r.dir).seq).toBe(bone.seq);
            await plain.keeper.open(muleScope('H1'), plain.ctx, { fresh: true });
            expect(cueIn(plain.dir).session).not.toContain(RUN);
            expect(readMulePreparation(plain.dir, MULE)).toBeNull();
        } finally {
            r.done();
            plain.done();
        }
    });

    test('with a run owner, a mule row it does not know is refused, never written under a random session', async () => {
        const r = rig('unknown');
        try {
            await expect(r.keeper.open(muleScope('H6'), r.ctx, { fresh: true })).rejects.toThrow('H6/mule: not a delivery row of run a1-20261023');
        } finally {
            r.done();
        }
    });
});

describe('run.ts delivery preflight (deliveryOwnerFor)', () => {
    const chain = [{ cue: muleScope('H1') }, { cue: { step: 'S03', family: 'fmrow' } }, { cue: muleScope('H4') }, {}, { cue: muleScope('H4k') }];
    const partners = { H1: MULE, H4: MULE, H4k: MULE };
    const pkg = (row: string, at: WorldTile = muleDelivery(row).at) => ({ name: row, at, scope: { step: row, family: 'mule' }, items: [] });
    const launcher = (dir: string, o: Record<string, unknown> = {}) => JSON.stringify({
        accounts: [{ account: MULE, role: 'mule', options: { serveMode: 'request', cueDir: dir, deliveryRun: RUN, serve: SCORED, packages: rows.map(r => pkg(r.row)), ...o } }],
    });
    const pre = (dir: string, delivery: unknown, file: string | (() => string), c = chain) => deliveryOwnerFor({
        delivery: delivery as never, partners, chain: c, receiver: SCORED, dir,
        readFile: () => (typeof file === 'string' ? file : file()),
    });
    const refusal = (r: ReturnType<typeof deliveryOwnerFor>) => ('refusal' in r ? r.refusal : null);

    test('the matching config gives the run owner of the path\'s rows, in chain order', () => {
        const dir = dirOf('pre-ok');
        const r = pre(dir, { run: RUN, launcherConfig: '/x' }, launcher(dir));
        expect(refusal(r)).toBeNull();
        const owner = (r as { owner: DeliveryOwner }).owner;
        expect([owner.runId, owner.session('H4k'), owner.next('H4')?.row, owner.firstRows().map(f => f.row)]).toEqual([RUN, `${RUN}:H4k`, 'H4k', ['H1']]);
    });

    test('no mule row on the path: no owner and nothing required', () => {
        expect(pre(dirOf('pre-none'), undefined, () => { throw new Error('not read'); }, [{ cue: { step: 'S03', family: 'fmrow' } }])).toEqual({ owner: null });
    });

    test('refusals: no delivery.run, a malformed one, no launcher config, an unreadable one', () => {
        const dir = dirOf('pre-run');
        expect(refusal(pre(dir, undefined, launcher(dir)))).toContain('no delivery.run');
        expect(refusal(pre(dir, { run: 'a1 2026', launcherConfig: '/x' }, launcher(dir)))).toContain('nonempty token');
        expect(refusal(pre(dir, { run: RUN }, launcher(dir)))).toContain('no delivery.launcherConfig');
        expect(refusal(pre(dir, { run: RUN, launcherConfig: '/x' }, () => { throw new Error('ENOENT'); }))).toContain('/x: ENOENT');
    });

    test('refusals: the carrier\'s deliveryRun, serve, cue directory or package differs from the run\'s', () => {
        const dir = dirOf('pre-carrier');
        const d = { run: RUN, launcherConfig: '/x' };
        expect(refusal(pre(dir, d, launcher(dir, { deliveryRun: 'a0-20261022' })))).toContain('runs deliveryRun "a0-20261022", the run config\'s delivery.run is a1-20261023');
        expect(refusal(pre(dir, d, launcher(dir, { deliveryRun: undefined })))).toContain('runs deliveryRun null');
        expect(refusal(pre(dir, d, launcher(dir, { serve: 'someone else' })))).toContain('serves another receiver');
        expect(refusal(pre(dir, d, launcher(dirOf('elsewhere'))))).toContain('reads cue directory');
        expect(refusal(pre(dir, d, launcher(dir, { packages: [pkg('H1')] })))).toContain('H4: cairn_mule1 has no package for the row');
        expect(refusal(pre(dir, d, JSON.stringify({ accounts: [] })))).toContain('H1: cairn_mule1 is not in the launcher config');
        expect(refusal(deliveryOwnerFor({ delivery: d, partners: {}, chain, receiver: SCORED, dir, readFile: () => launcher(dir) }))).toContain('H1: the run config names no partner');
    });

    test('a carrier attempt this run aborted refuses (only an operator resume continues it)', () => {
        const dir = dirOf('pre-abort');
        new DeliveryOwner(dir, RUN, SCORED, rows).prepare('H1');
        cancelMulePreparation(dir, { runId: RUN, account: MULE, attempt: 1 });
        expect(refusal(pre(dir, { run: RUN, launcherConfig: '/x' }, launcher(dir)))).toContain('was aborted');
    });
});

describe('tools/mule-hold.ts', () => {
    test('reads the hold from the carrier\'s generated entry: run, receiver, cue directory, first ordered row and its tile', () => {
        const config = { accounts: [{ account: MULE, cueDir: '/run/cues/mule', options: { deliveryRun: RUN, serve: SCORED, packages: [{ onRequest: true, at: muleDelivery('H4').at, scope: muleScope('H4') }, { at: muleDelivery('H1').at, scope: muleScope('H1') }] } }] };
        expect(holdInputs(config, 'Cairn_Mule1')).toEqual({ dir: '/run/cues/mule', runId: RUN, account: MULE, row: 'H1', receiver: SCORED, at: muleDelivery('H1').at });
        expect(holdInputs({ accounts: [{ account: MULE, options: {} }] }, MULE)).toEqual({ refusal: 'cairn_mule1 runs no deliveryRun: only a banked delivery carrier is held' });
        expect(holdInputs({ accounts: [] }, MULE)).toEqual({ refusal: 'cairn_mule1 is not in the launcher config' });
    });

    test('receiver hashes match the cue the run writes for the held row', () => {
        expect(nameHash(SCORED)).toBe(nameHash(' scored_name '));
    });
});
