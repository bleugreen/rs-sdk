import { describe, expect, test } from 'bun:test';

import '../../lite/test-support/browser-globals.js';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerPrograms } from './index.js';
import { ProgramRuntime, RUNTIME_PARAMS } from './runtime.js';

/** The module each registered program's factory lives in. */
const SOURCES: Record<string, string> = {
    probe: 'probe.ts',
    'knife-cycle': 'knife-cycle.ts',
    'knife-mine': 'knife-mine.ts',
    pickpocket: 'pickpocket.ts',
    agility: 'agility.ts',
    'rc-cycle': 'rc-cycle.ts',
    'item-cycle': 'item-cycle.ts'
};

const runtime = registerPrograms(new ProgramRuntime({ dispatch: () => ({ success: true, message: '' }) }));

describe('registered programs', () => {
    test('every registered program declares its parameter keys', () => {
        expect(runtime.names().length).toBeGreaterThan(0);
        for (const name of runtime.names()) {
            const own = runtime.accepts(name)!.filter(k => !RUNTIME_PARAMS.includes(k));
            expect({ name, declares: own.length > 0 }).toEqual({ name, declares: true });
        }
    });

    // A key the factory reads but does not declare would fault on every start that
    // uses it, so a new opt-in that skips the declaration fails here first.
    test("each declaration matches the keys its factory's module reads", () => {
        expect(Object.keys(SOURCES).sort()).toEqual(runtime.names());
        for (const name of runtime.names()) {
            const src = readFileSync(join(import.meta.dir, SOURCES[name]!), 'utf8');
            const read = [...new Set([...src.matchAll(/\bparams\.([A-Za-z_]\w*)/g)].map(m => m[1]!))].filter(k => k !== 'params').sort();
            const own = runtime.accepts(name)!.filter(k => !RUNTIME_PARAMS.includes(k)).sort();
            expect({ name, keys: own }).toEqual({ name, keys: read });
        }
    });

    test('an undeclared key faults a real program before it runs', () => {
        const s = runtime.start('knife-cycle', { method: 'willow', successes: 10, dropeach: true });
        expect(s.phase).toBe('fault');
        expect(s.fault).toContain('knife-cycle does not declare dropeach');
    });
});
