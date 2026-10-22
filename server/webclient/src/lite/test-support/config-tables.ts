// A suite that swaps in its own config definitions puts the real tables back.
//
// LocType, NpcType and ObjType decode from module-level tables (idx, dat, recent)
// that loadCache() fills once and then memoizes. Without --isolate every file
// shares one module registry, so a suite that replaces those tables and leaves
// them hands its stubs to every file after it: a real-cache suite's loadCache()
// is a no-op, and LocType.list() reads a one-entry table ("LocType.list: no loc
// 684"). A suite that assigns those statics calls useOwnConfigTables at file or
// describe scope.

import { afterAll, beforeAll } from 'bun:test';

/**
 * Snapshot every static field of `types` before the enclosing suite and restore
 * them after it, whatever the suite assigned in between.
 */
export function useOwnConfigTables(...types: object[]): void {
    let saved: [object, Record<string, unknown>][] = [];
    beforeAll(() => {
        saved = types.map(type => [type, { ...type }]);
    });
    afterAll(() => {
        for (const [type, statics] of saved) {
            Object.assign(type, statics);
        }
    });
}
