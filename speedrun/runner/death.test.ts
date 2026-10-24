import { describe, expect, test } from 'bun:test';
import { TickLog, type TickRow } from '../lib/ticks';
import { ackRow, DEATH_STEP, deathGate, deathKey, deathRow, diedResult, EXIT_DIED, type Death } from './death';

const death: Death = {
    from: { x: 3288, z: 3810, level: 0 }, fromTick: 266, to: { x: 3222, z: 3218, level: 0 }, toTick: 267, tick: 263,
    signs: ['dead', 'respawned', 'message', 'respawn-tile'], hpBefore: 20, hpMin: 0, hpAfter: 42,
    reason: 'SCORED died before the logout landed: (3288,3810,0) on tick 266 to (3222,3218,0) on tick 267 (dead, respawned, message, respawn-tile; hp 20 at the start, lowest 0, 42 after)',
};

describe('the (death) row and the attempt it ends', () => {
    test('the row: ok false, the reason as its error, the tiles before and after, the logout that saw it with its hold', () => {
        const log = TickLog.memory('run-a');
        const held = { fromTick: 231, clickTick: 267, ticks: 36, hp: [{ tick: 231, hp: 20 }], inCombatTicks: 36, lastDamageTick: 262 };
        const row = deathRow(log, 'SCORED', 3, death, { ok: true, clickTick: 267, lastInWorldTick: 267, latencyTicks: 0, wallMs: 5, held, death });
        expect(row).toMatchObject({ kind: 'note', step: DEATH_STEP, account: 'SCORED', sessionId: 3, startTick: 263, ok: false, error: death.reason });
        expect(row.meta).toMatchObject({ from: death.from, to: death.to, signs: death.signs, logout: { ok: true, clickTick: 267, held } });
        expect(deathKey(row)).toBe('run-a@263');
    });

    test('the attempt ends DIED with exit 6 whatever the chain ended with, and the line says what to do next', () => {
        const row = deathRow(TickLog.memory('run-a'), 'SCORED', 3, death);
        const r = diedResult(row, { outcome: 'FAILED: step "S14" precondition failed: no Attack', code: 1, paused: null });
        expect(r.code).toBe(EXIT_DIED);
        expect(r.outcome).toStartWith(`DIED: ${death.reason} (the chain had ended: FAILED`);
        expect(r.outcome).toContain("R8's recovery");
        expect(r.outcome).toEndWith('then run again with --r8-recovered=run-a@263');
    });
});

describe("the start's death gate", () => {
    const rowsWith = (...rows: TickRow[]) => rows;
    const first = deathRow(TickLog.memory('run-a'), 'SCORED', 3, death);

    test('a log with no death: open, and nothing to acknowledge', () => {
        expect(deathGate([])).toEqual({ acknowledge: [] });
    });

    test('after a death a walk from game state and a --from are refused alike, naming the death and R8', () => {
        const g = deathGate(rowsWith(first));
        expect('refusal' in g && g.refusal).toBe(`${death.reason}. A run from here would resume from the respawn as if nothing happened. Do R8's recovery (RUN-HOST.md 'After a player-kill': the manual procedure, or rs/527's recover-now once it is on the floor), then run again with --r8-recovered=run-a@263`);
    });

    test('--r8-recovered must name that death; naming it acknowledges it, and the acknowledged log is open again', () => {
        expect(deathGate([first], 'run-a@999')).toMatchObject({ refusal: expect.stringContaining('(--r8-recovered=run-a@999 does not name it)') });
        expect(deathGate([first], 'run-a@263')).toEqual({ acknowledge: ['run-a@263'] });
        const ack = ackRow(TickLog.memory('run-b'), 'SCORED', ['run-a@263']);
        expect(ack).toMatchObject({ kind: 'gate', step: '(death) acknowledged', meta: { keys: ['run-a@263'], recovery: 'R8' } });
        expect(deathGate([first, ack])).toEqual({ acknowledge: [] });
    });

    test('a flag left on the command line never acknowledges: refused with nothing open, and a later death needs its own key', () => {
        const ack = ackRow(TickLog.memory('run-b'), 'SCORED', ['run-a@263']);
        expect(deathGate([first, ack], 'run-a@263')).toEqual({ refusal: '--r8-recovered=run-a@263 names no unacknowledged death in this log' });
        const second = deathRow(TickLog.memory('run-c'), 'SCORED', 4, { ...death, tick: 900 });
        expect('refusal' in deathGate([first, ack, second], 'run-a@263')).toBe(true);
        expect(deathGate([first, ack, second], 'run-c@900')).toEqual({ acknowledge: ['run-c@900'] });
    });
});
