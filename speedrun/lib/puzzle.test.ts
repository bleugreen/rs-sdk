import { describe, expect, test } from 'bun:test';

import type { BotWorldState } from '../../sdk/types';
import { baseState, FakeSdk, flush } from './fake-sdk';
import {
    applyMove, CELLS, gapOf, heuristic, isBoard, isSolvable, isSolved, legalSlots, neighbours, readBoard, safeBatch,
    solveOnPanel, solvePuzzle, SOLVED, type Board,
} from './puzzle';

/** A seeded PRNG so the scrambles are the same every run. */
function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** The server's scramble (mm_puzzle.rs2 shuffle_reinit_puzzle): a 255-step random walk of the gap from slot 24. */
function scramble(rand: () => number, steps = 255): { board: Board; walk: number[] } {
    let b: Board = SOLVED;
    const walk = [24];
    for (let i = 0; i < steps; i++) {
        const ns = neighbours(gapOf(b));
        const next = ns[Math.floor(rand() * ns.length)]!;
        b = applyMove(b, next);
        walk.push(next);
    }
    return { board: b, walk };
}

/** The walk with immediate back-steps cancelled: reversed, it always solves, so its length bounds a solver's. */
function reducedLength(walk: number[]): number {
    const st: number[] = [];
    for (const g of walk) {
        if (st.length >= 2 && st[st.length - 2] === g) st.pop();
        else st.push(g);
    }
    return st.length - 1;
}

const TILE_IDS = Array.from({ length: 24 }, (_, i) => 3904 + 2 * i);
const COM = 11130;

function panelState(b: Board | null, tick = 100): BotWorldState {
    const inventories = b === null ? [] : [{
        componentId: COM, size: CELLS,
        items: b.flatMap((t, slot) => (t ? [{ slot, id: TILE_IDS[t - 1]!, name: 'Sliding button', count: 1, optionsWithIndex: [] }] : [])),
    }];
    return baseState({ tick, interface: { isOpen: b !== null, interfaceId: b === null ? -1 : 11127, options: [], inventories } } as Partial<BotWorldState>);
}

describe('board', () => {
    test('solved, neighbours, legal slots', () => {
        expect(isSolved(SOLVED)).toBe(true);
        expect(isBoard(SOLVED)).toBe(true);
        expect(neighbours(0).sort()).toEqual([1, 5]);
        expect(neighbours(12).sort((a, b) => a - b)).toEqual([7, 11, 13, 17]);
        expect(neighbours(24).sort((a, b) => a - b)).toEqual([19, 23]);
        expect(legalSlots(SOLVED).sort((a, b) => a - b)).toEqual([19, 23]);
        expect(heuristic(SOLVED)).toBe(0);
    });

    test('applyMove moves the tile into the gap and refuses a non-neighbour', () => {
        const b = applyMove(SOLVED, 23);
        expect(b[24]).toBe(24);
        expect(b[23]).toBe(0);
        expect(isSolved(b)).toBe(false);
        expect(() => applyMove(SOLVED, 0)).toThrow(/not next to the gap/);
    });

    test('solvability by inversion parity', () => {
        expect(isSolvable(SOLVED)).toBe(true);
        const swapped = SOLVED.slice();
        [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
        expect(isSolvable(swapped)).toBe(false);
        expect(solvePuzzle(swapped)).toBeNull();
    });
});

describe('solvePuzzle', () => {
    test('already solved is no moves; one move from solved is slot 24', () => {
        expect(solvePuzzle(SOLVED)).toEqual([]);
        // The engine's one-move reshuffle (puzzle-complete flag set) leaves tile 24 at slot 23.
        expect(solvePuzzle(applyMove(SOLVED, 23))).toEqual([24]);
        expect(solvePuzzle(applyMove(SOLVED, 19))).toEqual([24]);
    });

    test('40 seeded 255-step scrambles: every click legal, ends solved, no longer than the reduced walk', () => {
        const rand = rng(201);
        const lengths: number[] = [];
        for (let i = 0; i < 40; i++) {
            const { board, walk } = scramble(rand);
            const path = solvePuzzle(board);
            expect(path).not.toBeNull();
            let b = board;
            for (const slot of path!) b = applyMove(b, slot);
            expect(isSolved(b)).toBe(true);
            expect(path!.length).toBeLessThanOrEqual(reducedLength(walk));
            lengths.push(path!.length);
        }
        // At the default weight 2 the measured range is about 50-105 moves; a broken heuristic would blow far past it.
        expect(Math.max(...lengths)).toBeLessThan(130);
        // The 40 searches take 0.6 s on an idle x86_64 and 14 s on a loaded arm64 host (bbl, about 250 agent
        // sessions), where every operation runs 15-20x slower; the bound leaves that host 4x headroom.
    }, 60_000);
});

describe('readBoard', () => {
    test('published slots map to tiles; a missing slot is the gap', () => {
        const { board } = scramble(rng(7));
        expect(readBoard(panelState(board), COM, TILE_IDS)).toEqual(board as number[]);
    });

    test('null when closed, another component, an unknown object, or two gaps', () => {
        expect(readBoard(panelState(null), COM, TILE_IDS)).toBeNull();
        expect(readBoard(panelState(SOLVED), 999, TILE_IDS)).toBeNull();
        const s = panelState(SOLVED);
        s.interface.inventories[0]!.items[0]!.id = 1;
        expect(readBoard(s, COM, TILE_IDS)).toBeNull();
        const t = panelState(SOLVED);
        t.interface.inventories[0]!.items.pop();
        expect(readBoard(t, COM, TILE_IDS)).toBeNull();
    });
});

describe('safeBatch', () => {
    test('stops at the rate, and before a slot the batch already changed', () => {
        // Gap at 24; clicks 23, 22, 17 walk the gap left, left, up: none revisits.
        expect(safeBatch(SOLVED, [23, 22, 17, 16], 5)).toBe(4);
        expect(safeBatch(SOLVED, [23, 22, 17, 16], 2)).toBe(2);
        // A 2x2 loop: 23, 18, 19, 24 returns the gap to 24, whose content the client last saw as empty.
        expect(safeBatch(SOLVED, [23, 18, 19, 24], 5)).toBe(3);
    });
});

/** A fake server for the panel: applies OPHELD5 whose object id matches, publishes once per tick, closes on solve. */
class PanelFake extends FakeSdk {
    board: Board;
    shown: Board;
    dropped = 0;
    /** Drop the nth click (0-based), as a delayed player would. */
    dropAt = new Set<number>();
    clicks = 0;
    constructor(b: Board) {
        super(panelState(b));
        this.board = b;
        this.shown = b;
    }
    sendUseItem(slot: number, op = 1, com?: number) {
        // The client fills the id from its own (published) view.
        const clientId = this.shown[slot] ? TILE_IDS[this.shown[slot]! - 1] : undefined;
        const n = this.clicks++;
        const real = this.board[slot] ? TILE_IDS[this.board[slot]! - 1] : undefined;
        if (op === 5 && com === COM && clientId !== undefined && clientId === real && !this.dropAt.has(n) && legalSlots(this.board).includes(slot)) {
            this.board = applyMove(this.board, slot);
        } else this.dropped++;
        return this.sendAction({ method: 'sendUseItem', args: [slot, op, com] });
    }
    /** End of a server tick: publish the board, or close the panel when solved. */
    serverTick() {
        this.shown = this.board;
        this.tick(panelState(isSolved(this.board) ? null : this.board, (this.state?.tick ?? 100) + 1));
    }
}

async function drive(fake: PanelFake, perTick: number) {
    const p = solveOnPanel(fake, { componentId: COM, tileIds: TILE_IDS, perTick });
    let settled = false;
    p.finally(() => (settled = true)).catch(() => {});
    for (let i = 0; i < 400 && !settled; i++) {
        await flush();
        fake.serverTick();
    }
    return p;
}

describe('solveOnPanel', () => {
    test('one move from solved: one click, closes', async () => {
        const fake = new PanelFake(applyMove(SOLVED, 23));
        const r = await drive(fake, 5);
        expect(r).toMatchObject({ moves: 1, solves: 1, planned: 1 });
        expect(fake.sent.map(a => a.args)).toEqual([[24, 5, COM]]);
        expect(isSolved(fake.board)).toBe(true);
    });

    test('a full scramble at 5 per tick: no packet dropped, solved', async () => {
        const { board } = scramble(rng(11));
        const fake = new PanelFake(board);
        const r = await drive(fake, 5);
        expect(isSolved(fake.board)).toBe(true);
        expect(fake.dropped).toBe(0);
        expect(r.solves).toBe(1);
        expect(r.moves).toBe(r.planned);
        expect(r.ticks).toBeLessThanOrEqual(r.planned);
    });

    test('a dropped click is recovered by re-solving from the shown board', async () => {
        const { board } = scramble(rng(12));
        const fake = new PanelFake(board);
        fake.dropAt.add(3);
        const r = await drive(fake, 5);
        expect(isSolved(fake.board)).toBe(true);
        expect(r.solves).toBeGreaterThan(1);
    });

    test('throws when the panel is not open', async () => {
        await expect(solveOnPanel(new FakeSdk(panelState(null)) as never, { componentId: COM, tileIds: TILE_IDS, perTick: 5 })).rejects.toThrow(/not open/);
    });
});
