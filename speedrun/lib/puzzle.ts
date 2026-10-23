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

/** Manhattan distance of tile `t` (1..24) at `slot` from its home. */
function manhattan(t: number, slot: number): number {
    const g = t - 1;
    return Math.abs((slot % SIZE) - (g % SIZE)) + Math.abs(((slot / SIZE) | 0) - ((g / SIZE) | 0));
}

/** 2 per pair of tiles in row `r` that both belong to it and are reversed. */
function rowConflict(b: ArrayLike<number>, base: number, r: number): number {
    let h = 0;
    for (let a = 0; a < SIZE; a++) {
        const ra = b[base + r * SIZE + a]!;
        if (!ra || ((ra - 1) / SIZE | 0) !== r) continue;
        for (let c = a + 1; c < SIZE; c++) {
            const rc = b[base + r * SIZE + c]!;
            if (rc && ((rc - 1) / SIZE | 0) === r && rc < ra) h += 2;
        }
    }
    return h;
}

/** 2 per pair of tiles in column `col` that both belong to it and are reversed. */
function colConflict(b: ArrayLike<number>, base: number, col: number): number {
    let h = 0;
    for (let a = 0; a < SIZE; a++) {
        const ca = b[base + a * SIZE + col]!;
        if (!ca || (ca - 1) % SIZE !== col) continue;
        for (let c = a + 1; c < SIZE; c++) {
            const cc = b[base + c * SIZE + col]!;
            if (cc && (cc - 1) % SIZE === col && cc < ca) h += 2;
        }
    }
    return h;
}

/** Manhattan distance plus 2 per linear-conflict pair in each row and column. */
export function heuristic(b: ArrayLike<number>): number {
    let h = 0;
    for (let s = 0; s < CELLS; s++) if (b[s]) h += manhattan(b[s]!, s);
    for (let line = 0; line < SIZE; line++) h += rowConflict(b, 0, line) + colConflict(b, 0, line);
    return h;
}

/** A binary min-heap of (f, node id) in typed arrays. Equal f pops in no particular order. */
class Heap {
    private f = new Float64Array(1 << 16);
    private v = new Int32Array(1 << 16);
    size = 0;
    push(f: number, v: number): void {
        if (this.size === this.f.length) {
            const nf = new Float64Array(this.f.length * 2), nv = new Int32Array(this.v.length * 2);
            nf.set(this.f);
            nv.set(this.v);
            this.f = nf;
            this.v = nv;
        }
        const F = this.f, V = this.v;
        let i = this.size++;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (F[p]! <= f) break;
            F[i] = F[p]!;
            V[i] = V[p]!;
            i = p;
        }
        F[i] = f;
        V[i] = v;
    }
    pop(): number {
        const F = this.f, V = this.v;
        const top = V[0]!;
        const n = --this.size;
        if (n > 0) {
            const lf = F[n]!, lv = V[n]!;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1, r = l + 1;
                let m = -1, mf = lf;
                if (l < n && F[l]! < mf) (m = l), (mf = F[l]!);
                if (r < n && F[r]! < mf) m = r;
                if (m < 0) break;
                F[i] = F[m]!;
                V[i] = V[m]!;
                i = m;
            }
            F[i] = lf;
            V[i] = lv;
        }
        return top;
    }
}

/**
 * The best depth seen per state key (hi, lo), open addressing with linear
 * probing in typed arrays, kept at most half full. `get` returns -1 when the
 * key is absent.
 */
class DepthTable {
    private mask: number;
    private hi: Uint32Array;
    private lo: Uint32Array;
    private d: Int32Array;
    private n = 0;
    constructor(bits = 17) {
        this.mask = (1 << bits) - 1;
        this.hi = new Uint32Array(1 << bits);
        this.lo = new Uint32Array(1 << bits);
        this.d = new Int32Array(1 << bits).fill(-1);
    }
    private slot(hi: number, lo: number): number {
        let i = (lo ^ (hi * 0x9e3779b1)) & this.mask;
        while (this.d[i]! >= 0 && (this.hi[i] !== hi || this.lo[i] !== lo)) i = (i + 1) & this.mask;
        return i;
    }
    get(hi: number, lo: number): number {
        return this.d[this.slot(hi, lo)]!;
    }
    set(hi: number, lo: number, depth: number): void {
        let i = this.slot(hi, lo);
        if (this.d[i]! < 0) {
            if (2 * ++this.n > this.mask) {
                this.rehash();
                i = this.slot(hi, lo);
            }
            this.hi[i] = hi;
            this.lo[i] = lo;
        }
        this.d[i] = depth;
    }
    private rehash(): void {
        const { hi, lo, d } = this;
        this.mask = this.mask * 2 + 1;
        this.hi = new Uint32Array(this.mask + 1);
        this.lo = new Uint32Array(this.mask + 1);
        this.d = new Int32Array(this.mask + 1).fill(-1);
        for (let j = 0; j < d.length; j++) {
            if (d[j]! < 0) continue;
            const i = this.slot(hi[j]!, lo[j]!);
            this.hi[i] = hi[j]!;
            this.lo[i] = lo[j]!;
            this.d[i] = d[j]!;
        }
    }
}

/**
 * Zobrist tables: a 53-bit state key is the XOR of a 21-bit and a 32-bit
 * random word per (slot, tile), updated in O(1) per move. Two states sharing
 * a key (about 1 in 10^4 over a whole hard search) only prune one of them;
 * every returned path is replayed on real boards, so it is always legal.
 */
const ZOBRIST = (() => {
    let s = 0x2545f491;
    const next = () => {
        s ^= s << 13;
        s ^= s >>> 17;
        s ^= s << 5;
        return s >>> 0;
    };
    const hi = new Uint32Array(CELLS * CELLS), lo = new Uint32Array(CELLS * CELLS);
    for (let i = 0; i < hi.length; i++) {
        hi[i] = next() & 0x1fffff;
        lo[i] = next();
    }
    return { hi, lo };
})();
const NEIGHBOURS: readonly number[][] = Array.from({ length: CELLS }, (_, s) => neighbours(s));

export interface SolveOptions {
    /**
     * f = g + weight*h; above 1 trades solution length for search time.
     * Default 2: over 60 seeded 255-step scrambles, 1.5 gives 67 moves mean
     * but searches about 7x longer, while 2 gives 76 moves. At 2, 40 seeded
     * scrambles take 0.6 s in all (worst 0.16 s) on an idle x86_64 and 14 s
     * (worst 3.1 s) on a heavily loaded arm64 host. At 5 clicks a tick the
     * extra moves cost about 2 ticks, and the search's wall time, spent with
     * the panel open, is ticks too.
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
    const { hi: ZH, lo: ZL } = ZOBRIST;

    // Node storage, by node id: the board in a flat byte arena (CELLS per node; the gap is the move's
    // slot), the parent, the depth and the heuristic. One allocation per doubling, none per node: a
    // per-node array and string key made the hard scrambles 10-20x slower on a loaded host.
    let cap = 1 << 16;
    let boards = new Uint8Array(cap * CELLS);
    let gap = new Uint8Array(cap);
    let parent = new Int32Array(cap);
    let depth = new Uint16Array(cap);
    let hval = new Uint16Array(cap);
    let nodes = 0;
    const grow = () => {
        cap *= 2;
        const nb = new Uint8Array(cap * CELLS);
        nb.set(boards);
        boards = nb;
        const ng = new Uint8Array(cap);
        ng.set(gap);
        gap = ng;
        const np = new Int32Array(cap);
        np.set(parent);
        parent = np;
        const nd = new Uint16Array(cap);
        nd.set(depth);
        depth = nd;
        const nh = new Uint16Array(cap);
        nh.set(hval);
        hval = nh;
    };
    let khi = new Uint32Array(cap), klo = new Uint32Array(cap);

    let h0hi = 0, h0lo = 0;
    for (let s = 0; s < CELLS; s++) {
        h0hi ^= ZH[s * CELLS + b[s]!]!;
        h0lo ^= ZL[s * CELLS + b[s]!]!;
    }
    let goalHi = 0, goalLo = 0;
    for (let s = 0; s < CELLS; s++) {
        goalHi ^= ZH[s * CELLS + SOLVED[s]!]!;
        goalLo ^= ZL[s * CELLS + SOLVED[s]!]!;
    }
    // XOR yields a signed 32-bit int; keys are compared as unsigned.
    h0lo >>>= 0;
    goalLo >>>= 0;

    boards.set(b, 0);
    gap[0] = b.indexOf(0);
    parent[0] = -1;
    depth[0] = 0;
    hval[0] = heuristic(b);
    khi[0] = h0hi;
    klo[0] = h0lo;
    nodes = 1;
    const best = new DepthTable();
    best.set(h0hi, h0lo, 0);
    const heap = new Heap();
    heap.push(weight * hval[0]!, 0);

    let expanded = 0;
    while (heap.size) {
        const id = heap.pop();
        const d = depth[id]!;
        const kh = khi[id]!, kl = klo[id]!;
        if (best.get(kh, kl) < d) continue;
        if (kh === goalHi && kl === goalLo) {
            const path: number[] = [];
            // The slot clicked to reach node n is where its gap now is: the tile there moved into the parent's gap.
            for (let n = id; parent[n]! >= 0; n = parent[n]!) path.push(gap[n]!);
            return path.reverse();
        }
        if (++expanded > limit) return null;
        const g = gap[id]!;
        const from = parent[id]! >= 0 ? gap[parent[id]!]! : -1;
        const base = id * CELLS;
        for (const slot of NEIGHBOURS[g]!) {
            if (slot === from) continue; // never undo the last move
            const t = boards[base + slot]!;
            const nhi = (khi[id]! ^ ZH[slot * CELLS + t]! ^ ZH[g * CELLS + t]! ^ ZH[g * CELLS]! ^ ZH[slot * CELLS]!) >>> 0;
            const nlo = (klo[id]! ^ ZL[slot * CELLS + t]! ^ ZL[g * CELLS + t]! ^ ZL[g * CELLS]! ^ ZL[slot * CELLS]!) >>> 0;
            const seen = best.get(nhi, nlo);
            if (seen >= 0 && seen <= d + 1) continue;
            best.set(nhi, nlo, d + 1);
            if (nodes === cap) {
                grow();
                const a = new Uint32Array(cap), c = new Uint32Array(cap);
                a.set(khi);
                c.set(klo);
                khi = a;
                klo = c;
            }
            const nid = nodes++;
            const nbase = nid * CELLS;
            boards.copyWithin(nbase, base, base + CELLS);
            // Tile t moves from `slot` into the gap `g`. Its Manhattan term changes, and only the lines it
            // leaves and enters can change their conflicts: a sideways move keeps its row's order, so only
            // the two columns; an up/down move only the two rows.
            const sideways = ((slot / SIZE) | 0) === ((g / SIZE) | 0);
            const before = sideways
                ? colConflict(boards, nbase, slot % SIZE) + colConflict(boards, nbase, g % SIZE)
                : rowConflict(boards, nbase, (slot / SIZE) | 0) + rowConflict(boards, nbase, (g / SIZE) | 0);
            boards[nbase + g] = t;
            boards[nbase + slot] = 0;
            const after = sideways
                ? colConflict(boards, nbase, slot % SIZE) + colConflict(boards, nbase, g % SIZE)
                : rowConflict(boards, nbase, (slot / SIZE) | 0) + rowConflict(boards, nbase, (g / SIZE) | 0);
            const h = hval[id]! + manhattan(t, g) - manhattan(t, slot) + after - before;
            gap[nid] = slot;
            parent[nid] = id;
            depth[nid] = d + 1;
            hval[nid] = h;
            khi[nid] = nhi;
            klo[nid] = nlo;
            heap.push(d + 1 + weight * h, nid);
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
