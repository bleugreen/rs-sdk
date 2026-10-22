// 5x5 sliding puzzles (the Monkey Madness hangar's reinitialisation panel, and
// the same grid shape as the treasure-trail puzzles): a solver that returns
// the click order, a reader for the board as the client publishes it, and a
// driver that plays a solution on an open panel.
//
// Board model (server/content/scripts/quests/quest_mm/scripts/mm_puzzle.rs2):
// the panel is a 25-slot inventory; slot i holds tile i+1 when solved and
// slot 24 is the gap. A click on a tile next to the gap (OPHELD5 on the grid
// component) moves it into the gap; a click anywhere else does nothing. The
// server scrambles with a 255-step random walk of the gap from slot 24.
//
// Per-tick batching. The client fills each OPHELD packet's object id from its
// own view of the slot, and the server drops a packet whose id is not what
// the slot really holds (OpHeldHandler.ts, inv.hasAt). The client's view only
// moves when the server transmits the inventory, so within one tick a move is
// safe exactly when its slot is unchanged since the last published board:
// `safeBatch` takes the leading run of such moves, capped by the per-tick
// rate. A solver path that never steps back stays safe until the gap revisits
// a slot (a 2x2 loop), so batches are usually as long as the rate allows.

import type { BotSDK } from '../../sdk/index';
import type { BotWorldState } from '../../sdk/types';
import { waitUntil, type StateSource } from './wait';

/** board[slot] = tile 1..24, 0 = the gap. */
export type Board = readonly number[];

export const SIZE = 5;
export const CELLS = SIZE * SIZE;
export const SOLVED: Board = Object.freeze([...Array.from({ length: CELLS - 1 }, (_, i) => i + 1), 0]);

export function neighbours(slot: number): number[] {
    const r: number[] = [];
    if (slot % SIZE !== 0) r.push(slot - 1);
    if (slot % SIZE !== SIZE - 1) r.push(slot + 1);
    if (slot >= SIZE) r.push(slot - SIZE);
    if (slot < CELLS - SIZE) r.push(slot + SIZE);
    return r;
}

export function gapOf(b: Board): number {
    return b.indexOf(0);
}

export function isSolved(b: Board): boolean {
    return b.length === CELLS && b.every((t, i) => t === SOLVED[i]);
}

/** The slots a click would move: the gap's neighbours. */
export function legalSlots(b: Board): number[] {
    return neighbours(gapOf(b));
}

/** The board after clicking `slot`. Throws unless `slot` is next to the gap. */
export function applyMove(b: Board, slot: number): Board {
    const gap = gapOf(b);
    if (!neighbours(gap).includes(slot)) throw new Error(`applyMove: slot ${slot} is not next to the gap at ${gap}`);
    const nb = b.slice();
    nb[gap] = nb[slot]!;
    nb[slot] = 0;
    return nb;
}

/** True when `b` is a permutation of the 24 tiles and one gap. */
export function isBoard(b: readonly number[]): boolean {
    if (b.length !== CELLS) return false;
    const seen = new Set(b);
    return seen.size === CELLS && b.every(t => Number.isInteger(t) && t >= 0 && t < CELLS);
}

/**
 * Whether `b` can reach SOLVED. On an odd-width grid a position is solvable
 * iff its tile permutation (gap ignored) has an even number of inversions.
 */
export function isSolvable(b: Board): boolean {
    const tiles = b.filter(t => t !== 0);
    let inv = 0;
    for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) if (tiles[i]! > tiles[j]!) inv++;
    return inv % 2 === 0;
}

/** Manhattan distance plus 2 per linear-conflict pair in each row and column. */
export function heuristic(b: ArrayLike<number>): number {
    let h = 0;
    for (let s = 0; s < CELLS; s++) {
        const t = b[s]!;
        if (!t) continue;
        const g = t - 1;
        h += Math.abs((s % SIZE) - (g % SIZE)) + Math.abs(Math.floor(s / SIZE) - Math.floor(g / SIZE));
    }
    for (let line = 0; line < SIZE; line++) {
        for (let a = 0; a < SIZE; a++) {
            const ra = b[line * SIZE + a]!;
            if (ra && Math.floor((ra - 1) / SIZE) === line) {
                for (let c = a + 1; c < SIZE; c++) {
                    const rc = b[line * SIZE + c]!;
                    if (rc && Math.floor((rc - 1) / SIZE) === line && rc < ra) h += 2;
                }
            }
            const ca = b[a * SIZE + line]!;
            if (ca && (ca - 1) % SIZE === line) {
                for (let c = a + 1; c < SIZE; c++) {
                    const cc = b[c * SIZE + line]!;
                    if (cc && (cc - 1) % SIZE === line && cc < ca) h += 2;
                }
            }
        }
    }
    return h;
}

class Heap {
    private f: number[] = [];
    private v: number[] = [];
    get size(): number {
        return this.f.length;
    }
    push(f: number, v: number): void {
        const F = this.f, V = this.v;
        F.push(f);
        V.push(v);
        let i = F.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (F[p]! <= F[i]!) break;
            [F[p], F[i]] = [F[i]!, F[p]!];
            [V[p], V[i]] = [V[i]!, V[p]!];
            i = p;
        }
    }
    pop(): number {
        const F = this.f, V = this.v;
        const top = V[0]!;
        const lf = F.pop()!, lv = V.pop()!;
        if (F.length) {
            F[0] = lf;
            V[0] = lv;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1, r = l + 1;
                let m = i;
                if (l < F.length && F[l]! < F[m]!) m = l;
                if (r < F.length && F[r]! < F[m]!) m = r;
                if (m === i) break;
                [F[m], F[i]] = [F[i]!, F[m]!];
                [V[m], V[i]] = [V[i]!, V[m]!];
                i = m;
            }
        }
        return top;
    }
}

export interface SolveOptions {
    /**
     * f = g + weight*h; above 1 trades solution length for search time.
     * Default 2: over 60 seeded 255-step scrambles, 1.5 gives 67 moves mean
     * but searches up to 5.7 s (p90 1.2 s), while 2 gives 76 moves and at
     * most 0.8 s. At 5 clicks a tick the extra moves cost about 2 ticks, and
     * the search's wall time is ticks too.
     */
    weight?: number;
    /** Give up after this many expansions; default 3,000,000. */
    maxExpansions?: number;
}

/**
 * The click order (slots, OPHELD5 targets) that solves `b`, by weighted A*,
 * or null when the search gives up or the board is unsolvable. `[]` when
 * already solved.
 */
export function solvePuzzle(b: Board, o: SolveOptions = {}): number[] | null {
    if (!isBoard(b)) throw new Error(`solvePuzzle: not a board: ${JSON.stringify(b)}`);
    if (!isSolvable(b)) return null;
    if (isSolved(b)) return [];
    const weight = o.weight ?? 2;
    const limit = o.maxExpansions ?? 3_000_000;
    const key = (x: Uint8Array) => String.fromCharCode(...x);
    const goal = key(Uint8Array.from(SOLVED));

    // Node storage: parallel arrays indexed by node id.
    const boards: Uint8Array[] = [];
    const gaps: number[] = [];
    const depth: number[] = [];
    const parent: number[] = [];
    const moved: number[] = [];
    const best = new Map<string, number>();
    const heap = new Heap();

    const s0 = Uint8Array.from(b);
    boards.push(s0);
    gaps.push(s0.indexOf(0));
    depth.push(0);
    parent.push(-1);
    moved.push(-1);
    best.set(key(s0), 0);
    heap.push(weight * heuristic(s0), 0);

    let expanded = 0;
    while (heap.size) {
        const id = heap.pop();
        const cur = boards[id]!;
        const k = key(cur);
        const d = depth[id]!;
        if ((best.get(k) ?? Infinity) < d) continue;
        if (k === goal) {
            const path: number[] = [];
            for (let n = id; parent[n]! >= 0; n = parent[n]!) path.push(moved[n]!);
            return path.reverse();
        }
        if (++expanded > limit) return null;
        const gap = gaps[id]!;
        for (const slot of neighbours(gap)) {
            if (slot === gaps[parent[id]!]) continue; // never undo the last move
            const nb = cur.slice();
            nb[gap] = nb[slot]!;
            nb[slot] = 0;
            const nk = key(nb);
            if ((best.get(nk) ?? Infinity) <= d + 1) continue;
            best.set(nk, d + 1);
            const nid = boards.length;
            boards.push(nb);
            gaps.push(slot);
            depth.push(d + 1);
            parent.push(id);
            moved.push(slot);
            heap.push(d + 1 + weight * heuristic(nb), nid);
        }
    }
    return null;
}

/**
 * The board on the open panel, or null when the component is not published
 * (panel closed) or holds anything but the 24 tiles and one gap. `tileIds[n]`
 * is the object id of tile n+1. A slot missing from the published items is
 * empty.
 */
export function readBoard(s: BotWorldState | null, componentId: number, tileIds: readonly number[]): Board | null {
    const inv = s?.interface?.inventories?.find(i => i.componentId === componentId);
    if (!inv) return null;
    const b = new Array<number>(CELLS).fill(0);
    for (const item of inv.items) {
        const t = tileIds.indexOf(item.id);
        if (t < 0 || item.slot < 0 || item.slot >= CELLS) return null;
        b[item.slot] = t + 1;
    }
    return isBoard(b) ? b : null;
}

/**
 * How many of `moves` (from the front) can go out this tick against the
 * client's `published` board: each clicked slot must still hold what the
 * client shows (see the header), and at most `max` go.
 */
export function safeBatch(published: Board, moves: readonly number[], max: number): number {
    const changed = new Set<number>([gapOf(published)]);
    let n = 0;
    for (const slot of moves) {
        if (n >= max || changed.has(slot)) break;
        changed.add(slot);
        n++;
    }
    return n;
}

export type PanelSdk = StateSource & Pick<BotSDK, 'sendUseItem'>;

export interface PanelOptions {
    /** The grid component (the hangar's is 11130, reinitialisation_puzzle:com_3). */
    componentId: number;
    /** Object id of tile n+1 at index n. */
    tileIds: readonly number[];
    /** Clicks sent per tick at most; the server decodes 5 user events a tick (runner/budget.ts). */
    perTick: number;
    /** OPHELD option; the hangar grid's trigger is OPHELD5. */
    op?: number;
    /** Give up after this many ticks; default 120. */
    maxTicks?: number;
    solve?: SolveOptions;
}

export interface PanelResult {
    /** Clicks sent, counting re-sends. */
    moves: number;
    /** Ticks from the first read to the panel closing on the solved board. */
    ticks: number;
    /** Searches run: 1 when every batch landed as planned. */
    solves: number;
    /** Length of the first solution. */
    planned: number;
}

function sameBoard(a: Board, b: Board): boolean {
    return a.every((t, i) => t === b[i]);
}

/**
 * Solve the puzzle on the open panel: read the board, search, send each tick's
 * safe batch, and re-read after every published tick. A board that is not
 * what the sent moves predict (a dropped packet, a carried-over event) is
 * re-solved from what is shown. Done when the panel closes after the board
 * the moves predict is solved (the server closes it on the solve).
 */
export async function solveOnPanel(sdk: PanelSdk, o: PanelOptions): Promise<PanelResult> {
    const op = o.op ?? 5;
    const maxTicks = o.maxTicks ?? 120;
    const s0 = sdk.getState();
    const startTick = s0?.tick ?? 0;
    let shown = readBoard(s0, o.componentId, o.tileIds);
    if (!shown) throw new Error(`solveOnPanel: component ${o.componentId} is not open or not a board`);

    const solve = (b: Board) => {
        const p = solvePuzzle(b, o.solve);
        if (!p) throw new Error(`solveOnPanel: no solution found for ${JSON.stringify(b)}`);
        return p;
    };
    let plan = solve(shown);
    const result: PanelResult = { moves: 0, ticks: 0, solves: 1, planned: plan.length };
    let expected: Board = shown;

    for (;;) {
        const tick = sdk.getState()?.tick ?? startTick;
        if (tick - startTick > maxTicks) throw new Error(`solveOnPanel: not solved after ${maxTicks} ticks`);

        const n = Math.max(1, safeBatch(shown, plan, o.perTick));
        const batch = plan.slice(0, n);
        for (const slot of batch) {
            await sdk.sendUseItem(slot, op, o.componentId);
            result.moves++;
        }
        let predicted = expected;
        for (const slot of batch) predicted = applyMove(predicted, slot);

        // The panel closes on the move that solves it; otherwise the board changes.
        const before = shown;
        const r = await waitUntil(sdk, s => {
            const b = readBoard(s, o.componentId, o.tileIds);
            return b === null || !sameBoard(b, before);
        }, { maxTicks: 2, after: tick });
        const now = readBoard(r.state, o.componentId, o.tileIds);

        if (now === null) {
            if (isSolved(predicted)) {
                result.ticks = (r.state?.tick ?? tick) - startTick;
                return result;
            }
            throw new Error('solveOnPanel: the panel closed before the board was solved');
        }
        shown = now;
        if (sameBoard(now, predicted)) {
            plan = plan.slice(n);
            expected = predicted;
        } else if (!sameBoard(now, before) || !r.ok) {
            // Something other than the plan happened, or nothing landed in two
            // ticks: start over from what the client shows.
            plan = solve(now);
            expected = now;
            result.solves++;
        }
        // A board that moved only partway still compares unequal on the next
        // read, and the branch above re-solves it then.
    }
}
