// A test suite's own interface baseline.
//
// Every InterfaceTable copies from one module-level baseline (interfaces.ts), and
// `bun test` runs all its files in one module registry, so a suite inherits
// whatever baseline the files before it captured: the real cache's, an empty
// stub, or another suite's hand-built components. Which one depends on file
// order, which Bun does not take from the command line and which differs between
// machines. A suite that builds LiteClients without the real cache therefore
// installs the components it needs here, rather than inferring a baseline from
// whether a client happens to construct.
//
// The previous baseline is put back afterwards, not just forgotten: loadCache()
// is memoized and will not recapture, so a real-cache suite that runs later would
// otherwise find no baseline, or this suite's stub, behind a loaded cache.

import { afterAll, beforeAll } from 'bun:test';

import './browser-globals.js';

import IfType from '#/config/IfType.js';

import { captureBaseInterfaces, InterfaceTable, resetBaseInterfaces } from '../interfaces.js';

/** A component carrying only `fields`, for a stub baseline. */
export function stubComponent(id: number, fields: Partial<IfType> = {}): IfType {
    return Object.assign(Object.create(IfType.prototype) as IfType, { id, ...fields });
}

/**
 * Make `components` (placed at their ids) the interface baseline for the
 * enclosing suite - the file, or the describe block this is called in - and
 * restore the baseline and `IfType.list` that were in effect before it.
 */
export function useStubBaseline(components: readonly IfType[] = []): void {
    let restore = (): void => {};
    beforeAll(() => {
        restore = installBaseline(components);
    });
    afterAll(() => {
        restore();
    });
}

function installBaseline(components: readonly IfType[]): () => void {
    const previousList = IfType.list;
    let previousBase: IfType[] | null;
    try {
        // A copy of the captured baseline holding the same component objects,
        // which is all any later InterfaceTable copies from it.
        previousBase = new InterfaceTable().list;
    } catch {
        previousBase = null;
    }

    const list: IfType[] = [];
    for (const com of components) {
        list[com.id] = com;
    }
    resetBaseInterfaces();
    IfType.list = list;
    captureBaseInterfaces();

    return () => {
        resetBaseInterfaces();
        if (previousBase) {
            IfType.list = previousBase;
            captureBaseInterfaces();
        }
        IfType.list = previousList;
    };
}
