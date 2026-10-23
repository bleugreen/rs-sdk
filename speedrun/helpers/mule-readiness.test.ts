import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BotWorldState, PlayerState } from '../../sdk/types';
import { baseState } from '../lib/fake-sdk';
import { nameHash } from './altar-cue';
import {
    cancelMulePreparation, deliverySession, heldFor, holdMule, isMulePreparation, isMuleReady, isWorldTile, muleCanReady, muleHealthy,
    readMuleAttempt, resumeMuleAttempt,
    mulePreparationPath, muleReadyPath, prepareMule, readMulePreparation, readMuleReady,
    readyFor, sameWorldTile, worldTile, writeMuleReady, type MuleReady, type MuleReadyExpected,
} from './mule-readiness';

const at = { x: 2951, z: 3451, level: 0 };
const expected: MuleReadyExpected = {
    runId: 'run-2026.10.22_01', account: 'cairn_mule1', row: 'H4', receiver: 'Scored One', at,
};
function status(overrides: Partial<MuleReady> = {}): MuleReady {
    return {
        runId: expected.runId, account: expected.account, row: expected.row,
        session: deliverySession(expected.runId, expected.row), receiverHash: nameHash(expected.receiver),
        phase: 'ready', tile: at, staged: true, preparationSeq: 0, tick: 100, ms: 10_000, ...overrides,
    };
}
function state(overrides: Partial<BotWorldState> = {}): BotWorldState {
    return baseState({
        player: { worldX: at.x, worldZ: at.z, level: at.level, x: 20, z: 30, hp: 10, isDead: false } as PlayerState,
        ...overrides,
    });
}

describe('explicit world tiles', () => {
    test('requires all three coordinates, without coercion', () => {
        expect(worldTile(at)).toEqual(at);
        expect(worldTile(at)).not.toBe(at);
        for (const invalid of [
            undefined, null, '', {}, [], [2951, 3451, 0], { x: at.x, z: at.z },
            { ...at, x: '' }, { ...at, x: null }, { ...at, x: '2951' },
            { ...at, x: 1.5 }, { ...at, z: NaN }, { ...at, z: Infinity },
            { ...at, x: Number.MAX_SAFE_INTEGER + 1 }, { ...at, x: -1 },
            { ...at, level: null }, { ...at, level: '' }, { ...at, level: 0.5 },
            { ...at, level: -1 }, { ...at, level: 4 },
        ]) {
            expect(isWorldTile(invalid)).toBe(false);
            expect(() => worldTile(invalid, 'package.at')).toThrow('package.at');
        }
    });
    test('comparison includes the plane', () => {
        expect(sameWorldTile(at, { ...at })).toBe(true);
        expect(sameWorldTile(at, { ...at, level: 1 })).toBe(false);
        expect(sameWorldTile(at, { ...at, z: at.z + 1 })).toBe(false);
        expect(sameWorldTile(null, null)).toBe(false);
    });
});

describe('delivery sessions', () => {
    test('stable for one run and row, distinct across either component', () => {
        expect(deliverySession('run-1', 'H4.1')).toBe('run-1:H4.1');
        expect(deliverySession('run-1', 'H4')).not.toBe(deliverySession('run-1', 'H4k'));
        expect(deliverySession('run-1', 'H4')).not.toBe(deliverySession('run-2', 'H4'));
    });
    test('rejects empty or ambiguous components', () => {
        for (const value of ['', ' ', '\t', ' a', 'a ', 'a:b', 'a/b', null, undefined, 1]) {
            expect(() => deliverySession(value as string, 'H4')).toThrow();
            expect(() => deliverySession('run', value as string)).toThrow();
        }
    });
});

describe('receiver readiness', () => {
    test('fresh exact match with canonical account and receiver names', () => {
        expect(readyFor(status({ account: ' Cairn Mule1 ' }), expected, 10_000)).toBe(true);
        expect(readyFor(status(), { ...expected, receiver: 'scored_one' }, 10_001)).toBe(true);
    });
    test('default and explicit freshness bounds reject stale and future records', () => {
        expect(readyFor(status(), expected, 13_000)).toBe(true);
        expect(readyFor(status(), expected, 13_001)).toBe(false);
        expect(readyFor(status(), expected, 9_999)).toBe(false);
        expect(readyFor(status(), expected, 10_001, 0)).toBe(false);
        expect(readyFor(status(), expected, 10_000, 0)).toBe(true);
        expect(readyFor(status({ ms: Date.now() - 10_000 }), expected)).toBe(false);
        for (const value of [NaN, Infinity, -1]) {
            expect(readyFor(status(), expected, value)).toBe(false);
            expect(readyFor(status(), expected, 10_000, value)).toBe(false);
        }
    });
    test('requires the exact run, row, session, account, receiver, tile and plane', () => {
        for (const change of [
            { runId: 'old-run', session: 'old-run:H4' },
            { row: 'H4k', session: deliverySession(expected.runId, 'H4k') },
            { session: 'unrelated-session' }, { account: 'cairn_mule2' },
            { receiverHash: nameHash('other_receiver') }, { tile: null },
            { tile: { ...at, x: at.x + 1 } }, { tile: { ...at, z: at.z + 1 } },
            { tile: { ...at, level: 1 } }, { staged: false },
        ]) expect(readyFor(status(change), expected, 10_000)).toBe(false);
    });
    test('staging, bank travel, trading, fault and off phases are never ready', () => {
        for (const phase of ['staging', 'travel', 'trading', 'fault', 'off', 'held'] as const) {
            expect(isMuleReady(status({ phase }))).toBe(true);
            expect(readyFor(status({ phase }), expected, 10_000)).toBe(false);
        }
    });
    test('malformed, missing and unknown fields fail closed', () => {
        for (const bad of [null, [], '', {}, { ...status(), phase: 'bank' },
            { ...status(), staged: 1 }, { ...status(), tick: -1 }, { ...status(), ms: null },
            { ...status(), ms: 1.5 }, { ...status(), receiverHash: 'not-a-hash' },
            { ...status(), account: '' }, { ...status(), password: 'must-not-be-written' },
            { ...status(), tile: { x: at.x, z: at.z } },
            { ...status(), tile: { ...at, password: 'must-not-be-written' } },
        ]) {
            expect(isMuleReady(bad)).toBe(false);
            expect(readyFor(bad, expected, 10_000)).toBe(false);
        }
        for (const key of Object.keys(status())) {
            const missing = { ...status() } as Record<string, unknown>;
            delete missing[key];
            expect(isMuleReady(missing)).toBe(false);
        }
        for (const invalid of [
            { ...expected, row: '' }, { ...expected, runId: 'bad:run' },
            { ...expected, receiver: '' }, { ...expected, account: '' },
            { ...expected, at: { x: 2951, z: 3451 } }, null,
        ]) expect(readyFor(status(), invalid as MuleReadyExpected, 10_000)).toBe(false);
    });
});

describe('status files', () => {
    const dirs: string[] = [];
    afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
    function directory(): string {
        const dir = mkdtempSync(join(tmpdir(), 'mule-readiness-'));
        dirs.push(dir);
        return dir;
    }
    test('atomic per-account write canonicalizes names and contains no receiver name', () => {
        const dir = directory();
        expect(readMuleReady(dir, expected.account)).toBeNull();
        writeMuleReady(dir, status({ preparationSeq: 1 }));
        expect(readMuleReady(dir, expected.account)).toBeNull();
        writeMuleReady(dir, status({ account: 'Cairn Mule1' }));
        expect(muleReadyPath(dir, 'Cairn Mule1')).toBe(muleReadyPath(dir, 'cairn_mule1'));
        const loaded = readMuleReady(dir, expected.account);
        expect(loaded).toEqual(status());
        expect(readyFor(loaded, expected, 10_000)).toBe(true);
        expect(readFileSync(muleReadyPath(dir, expected.account), 'utf8')).not.toContain(expected.receiver);
        expect(readdirSync(dir)).toHaveLength(1);
        writeMuleReady(dir, status({ phase: 'travel', ms: 10_001 }));
        expect(readMuleReady(dir, expected.account)?.phase).toBe('travel');
        writeMuleReady(dir, status({ account: 'cairn_mule2' }));
        expect(readdirSync(dir)).toHaveLength(2);
    });
    test('malformed JSON, unknown schema and another account in the file fail closed', () => {
        const dir = directory();
        const path = muleReadyPath(dir, expected.account);
        for (const raw of ['{', 'null', '{}', JSON.stringify({ ...status(), phase: 'unknown' }),
            JSON.stringify(status({ account: 'someone_else' }))]) {
            writeFileSync(path, raw);
            expect(readMuleReady(dir, expected.account)).toBeNull();
        }
        expect(readMuleReady(dir, '')).toBeNull();
        expect(() => writeMuleReady(dir, { ...status(), password: 'secret' } as MuleReady)).toThrow();
        expect(() => muleReadyPath(dir, '')).toThrow();
        expect(muleReadyPath(dir, '../../outside')).toStartWith(join(dir, 'mule-'));
    });
});

describe('sender readiness', () => {
    test('requires staged inventory at exact world tile while idle in game', () => {
        expect(muleCanReady(state(), at, true, false)).toBe(true);
        expect(muleCanReady(state(), at, false, false)).toBe(false);
        expect(muleCanReady(state(), at, true, true)).toBe(false);
        expect(muleCanReady(null, at, true, false)).toBe(false);
        for (const changed of [
            state({ inGame: false }), state({ sceneReady: false }), state({ player: null }),
            state({ player: { ...state().player!, hp: 0 } }),
            state({ player: { ...state().player!, isDead: true } }),
            state({ interface: { isOpen: true, interfaceId: 1, options: [], inventories: [] } }),
            state({ bank: { isOpen: true, items: [], noteMode: false } }),
            state({ trade: { isOpen: true, screen: 'offer', partner: null, myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false } }),
            state({ modalOpen: true }),
            state({ shop: { isOpen: true, title: '', shopItems: [], playerItems: [] } }),
            state({ dialog: { isOpen: true, options: [], isWaiting: false } }),
        ]) expect(muleCanReady(changed, at, true, false)).toBe(false);
    });
    test('does not mistake a local coordinate match or wrong plane for arrival', () => {
        for (const player of [
            { worldX: at.x + 1, worldZ: at.z, level: 0, x: at.x, z: at.z },
            { worldX: at.x, worldZ: at.z + 1, level: 0 },
            { worldX: at.x, worldZ: at.z, level: 1 },
            { worldX: at.x, worldZ: at.z },
        ]) expect(muleCanReady(state({ player: { ...player, hp: 10, isDead: false } as PlayerState }), at, true, false)).toBe(false);
    });
});

describe('preparation control', () => {
    const dirs: string[] = [];
    afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
    function directory(): string {
        const dir = mkdtempSync(join(tmpdir(), 'mule-preparation-'));
        dirs.push(dir);
        return dir;
    }
    test('persists selections without receiver names and increments each same-run call', () => {
        const dir = directory();
        writeFileSync(join(dir, 'cue.json'), 'untouched cue');
        expect(readMulePreparation(dir, expected.account)).toBeNull();
        const first = prepareMule(dir, { ...expected, account: 'Cairn Mule1' });
        expect(first.op).toBe('prepare');
        expect(first.seq).toBe(1);
        expect(first.account).toBe(expected.account);
        expect(readMulePreparation(dir, expected.account)).toEqual(first);
        expect(prepareMule(dir, expected).seq).toBe(2);
        expect(prepareMule(dir, { ...expected, row: 'H4k' }).seq).toBe(3);
        // Another run never replaces this run's live control; once this run is cancelled it may start at seq 1.
        expect(() => prepareMule(dir, { ...expected, runId: 'new-run' })).toThrow(`run new-run cannot replace run ${expected.runId}'s live prepare (attempt 1, seq 3)`);
        cancelMulePreparation(dir, { ...expected, attempt: 1 });
        expect(prepareMule(dir, { ...expected, runId: 'new-run' }).seq).toBe(1);
        expect(readFileSync(mulePreparationPath(dir, expected.account), 'utf8')).not.toContain(expected.receiver);
        expect(readFileSync(join(dir, 'cue.json'), 'utf8')).toBe('untouched cue');
        expect(readdirSync(dir).sort()).toEqual(['cue.json', 'mule-prepare-' + nameHash(expected.account) + '.json'].sort());
    });
    test('cancellation is durable, run-scoped and does not alter another run or account', () => {
        const dir = directory();
        const mine = { ...expected, attempt: 1 };
        expect(cancelMulePreparation(dir, mine)).toBeNull();
        expect(readdirSync(dir)).toHaveLength(0);
        const first = prepareMule(dir, expected);
        expect(cancelMulePreparation(dir, { ...mine, runId: 'other-run' })).toBeNull();
        expect(cancelMulePreparation(dir, { ...mine, account: 'other-account' })).toBeNull();
        expect(readMulePreparation(dir, expected.account)).toEqual(first);
        const cancelled = cancelMulePreparation(dir, mine);
        expect(cancelled?.op).toBe('cancel');
        expect(cancelled?.seq).toBe(2);
        expect(readMulePreparation(dir, expected.account)).toEqual(cancelled);
        // A repeated abort of the same attempt is idempotent: no new write, no new seq.
        expect(cancelMulePreparation(dir, mine)).toEqual(cancelled!);
        expect(() => prepareMule(dir, expected)).toThrow('attempt 1 <= aborted attempt 1');
        expect(prepareMule(dir, { ...expected, attempt: 2 }).seq).toBe(3);
    });
    test('same-millisecond cancel and reprepare require a new acknowledged generation', () => {
        const dir = directory();
        const clock = spyOn(Date, 'now').mockReturnValue(10_000);
        try {
            const first = prepareMule(dir, expected);
            const oldReady = status({ preparationSeq: first.seq });
            writeMuleReady(dir, oldReady);
            expect(readMuleReady(dir, expected.account)).toEqual(oldReady);
            expect(readyFor(oldReady, { ...expected, preparationSeq: first.seq })).toBe(true);
            cancelMulePreparation(dir, { ...expected, attempt: 1 });
            expect(readMuleReady(dir, expected.account)).toBeNull();
            const next = prepareMule(dir, { ...expected, attempt: 2 });
            expect(next.ms).toBe(first.ms);
            expect(next.seq).toBe(3);
            expect(readMuleReady(dir, expected.account)).toBeNull();
            expect(readyFor(oldReady, { ...expected, preparationSeq: next.seq })).toBe(false);
            // Refreshing a timestamp cannot substitute for consuming the new preparation.
            writeMuleReady(dir, { ...oldReady, ms: 10_001 });
            expect(readMuleReady(dir, expected.account)).toBeNull();
            writeMuleReady(dir, status({ preparationSeq: next.seq }));
            expect(readyFor(readMuleReady(dir, expected.account), { ...expected, preparationSeq: next.seq })).toBe(true);
        } finally {
            clock.mockRestore();
        }
    });
    test('current preparation must match status identity, location, timestamp and generation', () => {
        for (const change of [
            { runId: 'other-run' }, { row: 'H4k' }, { receiver: 'other-receiver' },
            { at: { ...at, x: at.x + 1 } }, { at: { ...at, level: 1 } },
        ]) {
            const dir = directory();
            const control = prepareMule(dir, { ...expected, ...change });
            writeMuleReady(dir, status({ preparationSeq: control.seq, ms: control.ms }));
            expect(readMuleReady(dir, expected.account)).toBeNull();
        }
        const dir = directory();
        const control = prepareMule(dir, expected);
        writeMuleReady(dir, status({ preparationSeq: control.seq, ms: control.ms - 1 }));
        expect(readMuleReady(dir, expected.account)).toBeNull();
        writeMuleReady(dir, status({ preparationSeq: 0, ms: control.ms }));
        expect(readMuleReady(dir, expected.account)).toBeNull();
        writeMuleReady(dir, status({ preparationSeq: control.seq, ms: control.ms }));
        expect(readMuleReady(dir, expected.account)).not.toBeNull();
    });
    test('malformed or misplaced control fails closed and is not overwritten', () => {
        const dir = directory();
        const valid = prepareMule(dir, expected);
        const path = mulePreparationPath(dir, expected.account);
        writeMuleReady(dir, status({ ms: valid.ms, preparationSeq: valid.seq }));
        for (const bad of [null, {}, [], { ...valid, op: 'unknown' }, { ...valid, seq: 0 },
            { ...valid, seq: 1.5 }, { ...valid, ms: null }, { ...valid, row: '' },
            { ...valid, session: 'wrong-session' }, { ...valid, receiverHash: 'no' },
            { ...valid, at: { x: at.x, z: at.z } }, { ...valid, password: 'secret' },
            { ...valid, attempt: 0 }, { ...valid, attempt: '1' }, { ...valid, abortedAttempt: 1 },
            { ...valid, abortedAttempt: -1 }, { ...valid, op: 'cancel' }, { ...valid, op: 'hold', attempt: 1, abortedAttempt: 1 },
            { op: 'cancel', runId: valid.runId, account: valid.account, seq: 2, ms: valid.ms, attempt: 1, abortedAttempt: 1, row: valid.row },
            Object.fromEntries(Object.entries(valid).filter(([key]) => key !== 'attempt')),
        ]) {
            expect(isMulePreparation(bad)).toBe(false);
            writeFileSync(path, JSON.stringify(bad));
            expect(readMulePreparation(dir, expected.account)).toBeNull();
            expect(readMuleReady(dir, expected.account)).toBeNull();
            expect(cancelMulePreparation(dir, { ...expected, attempt: 1 })).toBeNull();
            expect(() => prepareMule(dir, expected)).toThrow('invalid existing');
            expect(() => holdMule(dir, expected)).toThrow('invalid existing');
            expect(() => readMuleAttempt(dir, expected.account, expected.runId)).toThrow('invalid existing');
            expect(readFileSync(path, 'utf8')).toBe(JSON.stringify(bad));
        }
        for (const raw of ['{', JSON.stringify({ ...valid, account: 'other' })]) {
            writeFileSync(path, raw);
            expect(readMulePreparation(dir, expected.account)).toBeNull();
            expect(readMuleReady(dir, expected.account)).toBeNull();
        }
    });
    test('validates caller input and generation values without coercion', () => {
        const dir = directory();
        for (const invalid of [
            { ...expected, account: '' }, { ...expected, receiver: '' }, { ...expected, row: '' },
            { ...expected, runId: '' }, { ...expected, at: { x: at.x, z: at.z } }, null,
        ]) expect(() => prepareMule(dir, invalid as MuleReadyExpected)).toThrow();
        expect(readdirSync(dir)).toHaveLength(0);
        for (const preparationSeq of [-1, 0.5, NaN, Infinity, null, '1']) {
            expect(isMuleReady({ ...status(), preparationSeq })).toBe(false);
            expect(readyFor(status(), { ...expected, preparationSeq } as MuleReadyExpected, 10_000)).toBe(false);
        }
        expect(cancelMulePreparation(dir, { runId: '', account: expected.account, attempt: 1 })).toBeNull();
        for (const attempt of [undefined, 0, 1.5, '1', null])
            expect(() => cancelMulePreparation(dir, { runId: expected.runId, account: expected.account, attempt } as never)).toThrow('caller\'s attempt');
        expect(readMulePreparation(dir, '')).toBeNull();
    });

    test('an initial hold is idempotent, distinct from ready, and released only by a prepare', () => {
        const dir = directory();
        const hold = holdMule(dir, expected);
        expect(hold).toMatchObject({ op: 'hold', seq: 1, attempt: 1, abortedAttempt: 0, row: expected.row });
        const raw = readFileSync(mulePreparationPath(dir, expected.account), 'utf8');
        expect(raw).not.toContain(expected.receiver);
        expect(holdMule(dir, { ...expected, account: 'Cairn Mule1', attempt: 1 })).toEqual(hold);
        expect(readFileSync(mulePreparationPath(dir, expected.account), 'utf8')).toBe(raw);
        const held = status({ phase: 'held', staged: false, tile: { x: 3211, z: 3463, level: 0 }, preparationSeq: hold.seq, ms: hold.ms });
        writeMuleReady(dir, held);
        const observed = readMuleReady(dir, expected.account);
        expect(observed).toEqual(held);
        expect(heldFor(observed, { ...expected, preparationSeq: hold.seq }, hold.ms)).toBe(true);
        expect(readyFor(observed, { ...expected, preparationSeq: hold.seq }, hold.ms)).toBe(false);
        // A ready-looking status cannot satisfy a hold control.
        writeMuleReady(dir, status({ preparationSeq: hold.seq, ms: hold.ms }));
        expect(readMuleReady(dir, expected.account)).toBeNull();
        expect(() => holdMule(dir, { ...expected, row: 'H4k' })).toThrow('attempt 1 already has hold seq 1');
        const release = prepareMule(dir, expected);
        expect(release).toMatchObject({ op: 'prepare', seq: 2, attempt: 1, abortedAttempt: 0 });
        writeMuleReady(dir, held);
        expect(readMuleReady(dir, expected.account)).toBeNull();
        expect(() => holdMule(dir, expected)).toThrow('attempt 1 already has prepare seq 2');
        expect(readMulePreparation(dir, expected.account)).toEqual(release);
    });
    test('an abort fences its attempt: stale prepare and hold are refused; a higher resumed attempt re-arms', () => {
        const dir = directory();
        holdMule(dir, expected);
        const cancelled = cancelMulePreparation(dir, { ...expected, attempt: 1 });
        expect(cancelled).toMatchObject({ op: 'cancel', seq: 2, attempt: 1, abortedAttempt: 1, row: expected.row, at });
        const raw = readFileSync(mulePreparationPath(dir, expected.account), 'utf8');
        expect(() => prepareMule(dir, expected)).toThrow('mule prepare refused: attempt 1 <= aborted attempt 1');
        expect(() => holdMule(dir, expected)).toThrow('mule hold refused: attempt 1 <= aborted attempt 1');
        expect(readFileSync(mulePreparationPath(dir, expected.account), 'utf8')).toBe(raw);
        // The resumed process's fresh pre-start gate.
        const resumed = holdMule(dir, { ...expected, attempt: 2 });
        expect(resumed).toMatchObject({ op: 'hold', seq: 3, attempt: 2, abortedAttempt: 1 });
        writeMuleReady(dir, status({ phase: 'held', staged: false, preparationSeq: resumed.seq, ms: resumed.ms }));
        expect(heldFor(readMuleReady(dir, expected.account), { ...expected, preparationSeq: resumed.seq }, resumed.ms)).toBe(true);
        expect(heldFor(readMuleReady(dir, expected.account), { ...expected, preparationSeq: 1 }, resumed.ms)).toBe(false);
        // The fence is carried forward, not read from the immediately previous op.
        expect(() => prepareMule(dir, expected)).toThrow('attempt 1 <= aborted attempt 1');
        expect(prepareMule(dir, { ...expected, attempt: 2 })).toMatchObject({ seq: 4, attempt: 2, abortedAttempt: 1 });
        expect(() => prepareMule(dir, expected)).toThrow('attempt 1 <= aborted attempt 1');
        expect(cancelMulePreparation(dir, { ...expected, attempt: 2 })).toMatchObject({ seq: 5, attempt: 2, abortedAttempt: 2 });
        expect(() => prepareMule(dir, { ...expected, attempt: 2 })).toThrow('attempt 2 <= aborted attempt 2');
    });
    test('a crash cancels nothing; a new attempt supersedes it and an older attempt cannot overwrite', () => {
        const dir = directory();
        prepareMule(dir, expected);
        expect(holdMule(dir, { ...expected, attempt: 2 })).toMatchObject({ op: 'hold', seq: 2, attempt: 2, abortedAttempt: 0 });
        expect(() => prepareMule(dir, expected)).toThrow('attempt 1 < current attempt 2');
        expect(() => holdMule(dir, expected)).toThrow('attempt 1 < current attempt 2');
    });
    test('cross-run control is refused as before, and a new run restarts its own fence', () => {
        const dir = directory();
        holdMule(dir, expected);
        expect(cancelMulePreparation(dir, { ...expected, runId: 'other-run', attempt: 1 })).toBeNull();
        cancelMulePreparation(dir, { ...expected, attempt: 1 });
        const fresh = holdMule(dir, { ...expected, runId: 'next-run' });
        expect(fresh).toMatchObject({ runId: 'next-run', seq: 1, attempt: 1, abortedAttempt: 0 });
        const old = status({ phase: 'held', staged: false, preparationSeq: 1, ms: fresh.ms });
        writeMuleReady(dir, old);
        expect(readMuleReady(dir, expected.account)).toBeNull();
        expect(heldFor(old, { ...expected, runId: 'next-run', preparationSeq: 1 }, fresh.ms)).toBe(false);
    });
    test('heldFor requires identity, the exact generation, an unstaged held phase and a fresh observation', () => {
        const held = status({ phase: 'held', staged: false, preparationSeq: 3, ms: 10_000 });
        const e = { ...expected, preparationSeq: 3 };
        expect(heldFor(held, e, 10_000)).toBe(true);
        expect(heldFor(held, e, 13_001)).toBe(false);
        expect(heldFor(held, e, 9_999)).toBe(false);
        for (const change of [{ runId: 'other-run' }, { row: 'H4k' }, { account: 'other' }, { receiver: 'other' }, { preparationSeq: 2 }, { preparationSeq: 0 }])
            expect(heldFor(held, { ...e, ...change }, 10_000)).toBe(false);
        for (const bad of [{ phase: 'ready' as const }, { staged: true }, { tile: null }, { phase: 'off' as const }])
            expect(heldFor({ ...held, ...bad }, e, 10_000)).toBe(false);
        expect(readyFor(held, e, 10_000)).toBe(false);
        expect(() => holdMule(directory(), { ...expected, attempt: 0 })).toThrow('attempt');
        expect(() => prepareMule(directory(), { ...expected, attempt: 1.5 })).toThrow('attempt');
    });
    test('the writer refuses to replace another run\'s live hold or prepare and leaves the file byte-identical', () => {
        for (const live of ['hold', 'prepare'] as const) {
            const dir = directory();
            const mine = live === 'hold' ? holdMule(dir, expected) : prepareMule(dir, expected);
            const raw = readFileSync(mulePreparationPath(dir, expected.account), 'utf8');
            const other = { ...expected, runId: 'other-run' };
            const message = `run other-run cannot replace run ${expected.runId}'s live ${live} (attempt 1, seq ${mine.seq})`;
            expect(() => holdMule(dir, other)).toThrow(message);
            expect(() => prepareMule(dir, other)).toThrow(message);
            expect(() => holdMule(dir, { ...other, attempt: 9 })).toThrow(message);
            expect(cancelMulePreparation(dir, { ...other, attempt: 1 })).toBeNull();
            expect(readFileSync(mulePreparationPath(dir, expected.account), 'utf8')).toBe(raw);
            expect(readMuleAttempt(dir, expected.account, 'other-run')).toBeNull();
            // The owning run's own cancel ends it; only then may another run take the account.
            cancelMulePreparation(dir, { ...expected, attempt: 1 });
            expect(holdMule(dir, other)).toMatchObject({ runId: 'other-run', seq: 1, attempt: 1, abortedAttempt: 0 });
            expect(() => prepareMule(dir, expected)).toThrow(`run ${expected.runId} cannot replace run other-run's live hold`);
        }
    });
    test('a delayed cancel from an older attempt never aborts the resumed attempt', () => {
        const dir = directory();
        holdMule(dir, expected);
        cancelMulePreparation(dir, { ...expected, attempt: 1 });
        const resumed = holdMule(dir, { ...expected, attempt: 2 });
        const released = prepareMule(dir, { ...expected, attempt: 2 });
        const raw = readFileSync(mulePreparationPath(dir, expected.account), 'utf8');
        expect(() => cancelMulePreparation(dir, { ...expected, attempt: 1 })).toThrow('mule cancel refused: attempt 1 < current attempt 2 (prepare seq 4)');
        expect(() => cancelMulePreparation(dir, { ...expected, attempt: 3 })).toThrow('mule cancel refused: attempt 3 > current attempt 2 (prepare seq 4)');
        expect(readFileSync(mulePreparationPath(dir, expected.account), 'utf8')).toBe(raw);
        expect(readMulePreparation(dir, expected.account)).toEqual(released);
        expect(resumed.seq).toBe(3);
        // The resumed attempt's own cancel still works and fences attempt 2.
        expect(cancelMulePreparation(dir, { ...expected, attempt: 2 })).toMatchObject({ op: 'cancel', seq: 5, attempt: 2, abortedAttempt: 2 });
        expect(() => cancelMulePreparation(dir, { ...expected, attempt: 1 })).toThrow('attempt 1 < current attempt 2');
    });
    test('resume: a crash reuses the attempt; only an operator resume after a recorded abort mints the next', () => {
        const dir = directory();
        const account = expected.account;
        expect(readMuleAttempt(dir, account, expected.runId)).toBeNull();
        expect(resumeMuleAttempt(dir, account, expected.runId, false)).toEqual({ attempt: 1, minted: false });
        expect(resumeMuleAttempt(dir, account, expected.runId, true)).toEqual({ attempt: 1, minted: false });
        holdMule(dir, expected);
        prepareMule(dir, expected);
        expect(readMuleAttempt(dir, account, expected.runId)).toEqual({ attempt: 1, abortedAttempt: 0, aborted: false, op: 'prepare', seq: 2 });
        // Crash-resume: nothing was cancelled, so the same attempt continues (an operator flag mints nothing).
        expect(resumeMuleAttempt(dir, account, expected.runId, false)).toEqual({ attempt: 1, minted: false });
        expect(resumeMuleAttempt(dir, account, expected.runId, true)).toEqual({ attempt: 1, minted: false });
        cancelMulePreparation(dir, { ...expected, attempt: 1 });
        expect(readMuleAttempt(dir, account, expected.runId)).toEqual({ attempt: 1, abortedAttempt: 1, aborted: true, op: 'cancel', seq: 3 });
        expect(() => resumeMuleAttempt(dir, account, expected.runId, false)).toThrow('attempt 1 of run run-2026.10.22_01 was aborted; only an explicit operator resume mints attempt 2');
        const next = resumeMuleAttempt(dir, account, expected.runId, true);
        expect(next).toEqual({ attempt: 2, minted: true });
        // The minted attempt passes the fence through a fresh pre-start hold, never straight to prepare state.
        expect(holdMule(dir, { ...expected, attempt: next.attempt })).toMatchObject({ op: 'hold', attempt: 2, abortedAttempt: 1, seq: 4 });
        expect(resumeMuleAttempt(dir, account, expected.runId, false)).toEqual({ attempt: 2, minted: false });
        expect(readMuleAttempt(dir, account, 'other-run')).toBeNull();
        expect(() => readMuleAttempt(dir, account, '')).toThrow('deliveryRun');
    });
});

describe('one healthy-frame boundary', () => {
    test('ready and held share it: any open interface, death, or an unknown interface state is unhealthy', () => {
        expect(muleHealthy(state())).toBe(true);
        for (const changed of [
            null, undefined, state({ inGame: false }), state({ sceneReady: false }), state({ player: null }),
            state({ player: { ...state().player!, hp: 0 } }),
            state({ player: { ...state().player!, isDead: true } }),
            state({ interface: { isOpen: true, interfaceId: 1, options: [], inventories: [] } }),
            state({ bank: { isOpen: true, items: [], noteMode: false } }),
            state({ trade: { isOpen: true, screen: 'offer', partner: null, myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false } }),
            state({ modalOpen: true }),
            state({ shop: { isOpen: true, title: '', shopItems: [], playerItems: [] } }),
            state({ dialog: { isOpen: true, options: [], isWaiting: false } }),
            state({ modalOpen: undefined as unknown as boolean }),
            state({ dialog: undefined as unknown as BotWorldState['dialog'] }),
        ]) {
            expect(muleHealthy(changed)).toBe(false);
            if (changed) expect(muleCanReady(changed, at, true, false)).toBe(false);
        }
    });
});
