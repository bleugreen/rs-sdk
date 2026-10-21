// useStubBaseline gives a suite exactly its own components whatever baseline an
// earlier file left captured, and hands that baseline back when the suite ends.

import { describe, expect, test } from 'bun:test';

import '../dom-shim.js';

import IfType from '#/config/IfType.js';

import { InterfaceTable } from '../interfaces.js';
import { stubComponent, useStubBaseline } from './stub-baseline.js';

const leftover = stubComponent(1, { text: 'left by an earlier suite' });
const needed = stubComponent(7, { text: 'what this suite reads' });

describe('with a baseline left captured by an earlier suite', () => {
    useStubBaseline([leftover]);

    describe('a suite with its own stub baseline', () => {
        useStubBaseline([needed]);

        test('sees its components and none of the leftover ones', () => {
            const table = new InterfaceTable();
            expect(table.list[7]).toBe(needed);
            expect(table.list[1]).toBeUndefined();
        });
    });

    test('the leftover baseline is back once that suite ends', () => {
        const table = new InterfaceTable();
        expect(table.list[1]).toBe(leftover);
        expect(table.list[7]).toBeUndefined();
        expect(IfType.list[1]).toBe(leftover);
    });
});
