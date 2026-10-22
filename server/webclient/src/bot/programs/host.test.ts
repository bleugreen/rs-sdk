import { describe, expect, test } from 'bun:test';

import '../../lite/test-support/browser-globals.js';

import { ProgramHost } from './host.js';
import { makeState } from './testkit.js';

const ok = () => ({ success: true, message: 'ok' });

describe('ProgramHost', () => {
    test('registers the speedrun programs', () => {
        const host = new ProgramHost(ok, { log: () => {} });
        expect(host.controls().list()).toEqual(['agility', 'knife-cycle', 'knife-mine', 'pickpocket', 'probe', 'rc-cycle']);
    });

    test('answers the program overlay action and validates it', () => {
        const host = new ProgramHost(ok, { log: () => {} });
        host.onTick(makeState({ tick: 10 }), 1);
        const r = host.command({ type: 'program', op: 'start', name: 'probe', params: { trials: 2 }, reason: 'SDK' });
        expect(r.success).toBe(true);
        expect(host.status()?.name).toBe('probe');
        expect(host.command({ type: 'program', op: 'start', reason: 'SDK' }).success).toBe(false);
        expect(host.command({ type: 'program', op: 'stop', reason: 'SDK' }).success).toBe(true);
        expect(host.status()?.phase).toBe('stopped');
    });

    test('autostarts from the page parameters after the in-game delay', () => {
        const lines: string[] = [];
        const host = new ProgramHost(ok, { search: '?bot=x&program=probe&programArgs=' + encodeURIComponent('{"trials":3}') + '&programDelay=2', log: l => lines.push(l) });
        expect(host.active).toBe(true);
        host.onTick(makeState({ tick: 1, inGame: false }), 1);
        host.onTick(makeState({ tick: 2 }), 1);
        expect(host.status()).toBeNull();
        host.onTick(makeState({ tick: 3 }), 1);
        expect(host.status()?.params).toEqual({ trials: 3 });
        expect(host.status()?.startedTick).toBe(3);
    });

    test('run() resolves with the final status and the end is logged as one JSON line', async () => {
        const lines: string[] = [];
        const host = new ProgramHost(ok, { log: l => lines.push(l) });
        host.onTick(makeState({ tick: 1 }), 1);
        const done = host.controls().run('knife-cycle', { method: 'willow', maxTicks: 2 });
        for (let t = 2; t <= 5; t++) host.onTick(makeState({ tick: t, inventory: ['Knife', 'Logs'] }), 1);
        const s = await done;
        expect(s.phase).toBe('done');
        const end = lines.find(l => l.startsWith('[program] end '))!;
        expect(JSON.parse(end.slice('[program] end '.length)).runId).toBe(s.runId);
        expect(host.history).toHaveLength(1);
    });
});
