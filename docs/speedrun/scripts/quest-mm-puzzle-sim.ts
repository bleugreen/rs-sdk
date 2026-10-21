// Monkey Madness hangar puzzle, offline (docs/speedrun/quests/monkey_madness.md):
// how many tile moves does a bot need to solve the 5x5 reinitialisation
// puzzle? The server scrambles it with a 255-step random walk of the gap from
// slot 24, each step to a uniformly random neighbour (mm_puzzle.rs2:71-85,
// trail_puzzle.rs2:182-215). For each simulated scramble this reports
//   reduced: the walk with immediate back-steps cancelled, reversed (always a
//            valid solution, so an upper bound);
//   wastar:  weighted A* (Manhattan + linear conflict, weight W) from the scramble.
// A move is one INV_BUTTON click; the server decodes at most 5 USER_EVENT
// packets per tick and carries the rest over (ClientGameProtCategory.ts, 
// NetworkPlayer.ts), so ticks ~ moves / 5.
// Run: bun docs/speedrun/scripts/quest-mm-puzzle-sim.ts [samples=40] [W=1.5]

const N = Number(process.argv[2] ?? 40);
const W = Number(process.argv[3] ?? 1.5);

function neighbours(slot: number): number[] {
    const r: number[] = [];
    if (slot % 5 !== 0) r.push(slot - 1);
    if (slot % 5 !== 4) r.push(slot + 1);
    if (slot >= 5) r.push(slot - 5);
    if (slot <= 19) r.push(slot + 5);
    return r;
}

function scramble(): { board: number[]; walk: number[] } {
    // board[slot] = tile (1..24), 0 = gap; solved has tile k at slot k-1, gap at 24.
    const board = Array.from({ length: 25 }, (_, i) => (i < 24 ? i + 1 : 0));
    let gap = 24;
    const walk: number[] = [24];
    for (let m = 0; m < 255; m++) {
        const ns = neighbours(gap);
        const next = ns[Math.floor(Math.random() * ns.length)];
        board[gap] = board[next];
        board[next] = 0;
        gap = next;
        walk.push(gap);
    }
    return { board, walk };
}

// Cancel immediate back-steps (a b a -> a); the remaining walk reversed solves the board.
function reducedLength(walk: number[]): number {
    const st: number[] = [];
    for (const g of walk) {
        if (st.length >= 2 && st[st.length - 2] === g) st.pop();
        else st.push(g);
    }
    return st.length - 1;
}

function heuristic(b: Uint8Array): number {
    let h = 0;
    for (let s = 0; s < 25; s++) {
        const t = b[s];
        if (!t) continue;
        const g = t - 1;
        h += Math.abs((s % 5) - (g % 5)) + Math.abs(Math.floor(s / 5) - Math.floor(g / 5));
    }
    // Linear conflict per row and column.
    for (let r = 0; r < 5; r++) {
        for (let a = 0; a < 5; a++) {
            const ta = b[r * 5 + a];
            if (!ta || Math.floor((ta - 1) / 5) !== r) continue;
            for (let c = a + 1; c < 5; c++) {
                const tc = b[r * 5 + c];
                if (tc && Math.floor((tc - 1) / 5) === r && tc < ta) h += 2;
            }
        }
    }
    for (let col = 0; col < 5; col++) {
        for (let a = 0; a < 5; a++) {
            const ta = b[a * 5 + col];
            if (!ta || (ta - 1) % 5 !== col) continue;
            for (let c = a + 1; c < 5; c++) {
                const tc = b[c * 5 + col];
                if (tc && (tc - 1) % 5 === col && tc < ta) h += 2;
            }
        }
    }
    return h;
}

// Binary heap keyed on f.
class Heap<T> {
    private a: Array<{ f: number; v: T }> = [];
    get size() { return this.a.length; }
    push(f: number, v: T) {
        const a = this.a;
        a.push({ f, v });
        let i = a.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (a[p].f <= a[i].f) break;
            [a[p], a[i]] = [a[i], a[p]];
            i = p;
        }
    }
    pop(): T {
        const a = this.a;
        const top = a[0].v;
        const last = a.pop()!;
        if (a.length) {
            a[0] = last;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1, r = l + 1;
                let m = i;
                if (l < a.length && a[l].f < a[m].f) m = l;
                if (r < a.length && a[r].f < a[m].f) m = r;
                if (m === i) break;
                [a[m], a[i]] = [a[i], a[m]];
                i = m;
            }
        }
        return top;
    }
}

function wastar(start: number[], limit = 3_000_000): number | null {
    const key = (b: Uint8Array) => String.fromCharCode(...b);
    const s0 = Uint8Array.from(start);
    const goal = key(Uint8Array.from(Array.from({ length: 25 }, (_, i) => (i < 24 ? i + 1 : 0))));
    const g = new Map<string, number>([[key(s0), 0]]);
    const heap = new Heap<{ b: Uint8Array; gap: number; d: number }>();
    heap.push(W * heuristic(s0), { b: s0, gap: s0.indexOf(0), d: 0 });
    let expanded = 0;
    while (heap.size) {
        const { b, gap, d } = heap.pop();
        const k = key(b);
        if (k === goal) return d;
        if ((g.get(k) ?? Infinity) < d) continue;
        if (++expanded > limit) return null;
        for (const n of neighbours(gap)) {
            const nb = b.slice();
            nb[gap] = nb[n];
            nb[n] = 0;
            const nk = key(nb);
            if ((g.get(nk) ?? Infinity) <= d + 1) continue;
            g.set(nk, d + 1);
            heap.push(d + 1 + W * heuristic(nb), { b: nb, gap: n, d: d + 1 });
        }
    }
    return null;
}

const reduced: number[] = [], solved: number[] = [], h0: number[] = [];
for (let i = 0; i < N; i++) {
    const { board, walk } = scramble();
    reduced.push(reducedLength(walk));
    h0.push(heuristic(Uint8Array.from(board)));
    const w = wastar(board);
    if (w !== null) solved.push(w);
}
const st = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return { n: s.length, min: s[0], p50: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], max: s[s.length - 1], mean: Math.round(s.reduce((a, b) => a + b, 0) / s.length * 10) / 10 };
};
console.log(`RESULT mm_puzzle_moves ${JSON.stringify({ samples: N, weight: W, reducedWalk: st(reduced), wastar: st(solved), heuristicLowerBound: st(h0), ticksAt5PerTick_wastar_mean: Math.ceil(st(solved).mean / 5) })}`);
