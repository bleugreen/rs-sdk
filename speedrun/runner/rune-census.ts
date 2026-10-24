// SCORED's rune census for a start or a resume (cairn://p/rs/699): what SCORED holds of each rune,
// by obj id, against what the chain spends of it from the start step up to the next step that
// brings that rune. A resume that would run a rune short refuses before anything runs, naming the
// rune, the step that would run short and the supply it waits for: rehearsal (b) re-cast T12-13a's
// Ardougne teleport after H10, so S13 spent the law T13-14a needed and T13-14a refused with none.
//
// The figures are the ones tools/rune-pins.ts holds to STEP-MANIFEST.md's ledger, never a second
// table:
//   - a leg spends lib/travel.ts hopNeeds over its own hops (a split leg's part a carries the
//     teleport), less the element of a staff the ledger has worn at the leg's row (rune-pins legUse);
//   - a module step spends its module's RUNE_USE and wants its RUNE_NEED held at its start, each key
//     on the segment step it names (`K` on S13:K-...) or, for a ledger row id (S02, S18), on that
//     step's first chain step;
//   - a step whose module declares no RUNE_USE spends its ledger rows' rune consumes, all counted at
//     its first chain step;
//   - a supply is any ledger row whose `in` brings a rune: at its hand-off step, at the kit segment
//     that trades it (KIT_SEGMENTS), or at the last chain step of the module that trades it
//     (INTERNAL, and a step's own rows such as `S07 last load`). Last is the conservative place: the
//     census may ask for more than a run needs, never less. A supply the attempt's hand-off record
//     has already served brought what it brings into what is held, so the walk goes past it.
// At a step, its supplies come first (a kit segment trades before the module casts), then its need
// is checked against what is left, then its use is spent.
//
// Drops and swaps of runes are not walked: they leave runes the plan no longer wants, which
// rune-pins' held check and the slot ledger already judge.

import type { Hop, RuneName, RuneUse } from '../lib/travel';
import { fmtCounts, isRune, legRow, legUse, runeLabel, runeOf, type Counts, type ModuleDecl } from '../tools/rune-pins';
import { walk, type ItemRef, type LedgerRow } from '../tools/slot-ledger';
import { CENSUS_STEP, INTERNAL, KIT_SEGMENTS, type ChainStep } from './chain';

// ------------------------------------------------------------------ the plan

/** One chain step's runes. */
export interface RuneStep {
    index: number;
    id: string;
    name: string;
    /** What the step spends. */
    use: Counts;
    /** What its start wants held (RUNE_NEED; a step's own use otherwise). */
    need: Counts;
    /** Runes the step spends at a `?` count in the ledger: not judged. */
    unknown: RuneName[];
    /** The ledger rows whose delivery lands at this step. */
    supplies: RuneSupplyRow[];
}

export interface RuneSupplyRow {
    row: string;
    /** What the row's `in` brings, where it gives a count. */
    runes: Counts;
    /** Runes it brings at no count (`?`). */
    uncounted: RuneName[];
}

export interface RunePlan {
    steps: RuneStep[];
    /** Rows that bring a rune but have no place on this chain (outside an --until slice, or unplaced). */
    unplaced: string[];
}

const rowStep = (row: string) => row.split(' ')[0]!;
const segmentOf = (name: string) => /^S\d+[a-z]?:([A-Z]\d*)-/.exec(name)?.[1];
const isModuleStep = (s: ChainStep) => s.kind === 'step' || s.kind === 'missing';

function addTo(c: Counts, u: Counts | RuneUse): void {
    for (const [r, n] of Object.entries(u)) if (isRune(r) && typeof n === 'number' && n) c[r] = (c[r] ?? 0) + n;
}

/** The leg's own ledger row: its id, or a split part's whole leg (T13-14a is T13-14's), else legRow's rule. */
function legRowOf(def: { id: string; after: string; before: string }, rowIds: ReadonlySet<string>): string | null {
    const whole = /[ab]$/.test(def.id) && !rowIds.has(def.id) && rowIds.has(def.id.slice(0, -1)) ? def.id.slice(0, -1) : def.id;
    return legRow({ id: whole, after: def.after, before: def.before }, rowIds);
}

/** Every chain step's rune use, need and supplies, from the ledger rows, the legs' hops and the modules' exports. */
export function runePlan(chain: readonly ChainStep[], rows: readonly LedgerRow[], modules: readonly ModuleDecl[]): RunePlan {
    const rowIds = new Set(rows.map(r => r.row));
    const at = new Map(rows.map((r, i) => [r.row, i]));
    const walked = walk(rows);
    const wornBefore = (row: string) => {
        const i = at.get(row)!;
        return i > 0 ? walked[i - 1]!.stacks.worn : [];
    };
    const steps: RuneStep[] = chain.map((s, index) => ({ index, id: s.id, name: s.name, use: {}, need: {}, unknown: [], supplies: [] }));
    const firstOf = (id: string) => chain.findIndex(s => s.id === id && isModuleStep(s));
    const lastOf = (id: string) => chain.findLastIndex(s => s.id === id && isModuleStep(s));

    // Legs.
    chain.forEach((s, i) => {
        if (s.kind !== 'leg') return;
        const def = (s as unknown as { def: { id: string; after: string; before: string; hops: readonly Hop[] } }).def;
        const row = legRowOf(def, rowIds);
        const use = legUse(def.hops, row ? wornBefore(row) : []);
        addTo(steps[i]!.use, use);
        addTo(steps[i]!.need, use);
    });

    // Module steps that declare their runes.
    const declared = new Set<string>();
    for (const m of modules) {
        if (!m.RUNE_USE || typeof m.RUNE_USE !== 'object') continue;
        const use = m.RUNE_USE as Record<string, RuneUse>;
        const need = (m.RUNE_NEED && typeof m.RUNE_NEED === 'object' ? m.RUNE_NEED : {}) as Record<string, RuneUse>;
        const stepId = typeof m.stepId === 'string' ? m.stepId : undefined;
        for (const key of new Set([...Object.keys(use), ...Object.keys(need)])) {
            const group = rowIds.has(key) ? rowStep(key) : stepId;
            if (!group) continue;
            declared.add(group);
            let i = rowIds.has(key) ? firstOf(group) : chain.findIndex(s => s.id === group && isModuleStep(s) && segmentOf(s.name) === key);
            // A key naming no segment step on this chain counts at the step's start: earlier, never later.
            if (i < 0) i = firstOf(group);
            if (i < 0) continue;
            addTo(steps[i]!.use, use[key] ?? {});
            addTo(steps[i]!.need, need[key] ?? use[key] ?? {});
        }
    }

    // Module steps that declare nothing: their ledger rows' rune consumes, at their first step.
    for (const group of new Set(chain.filter(isModuleStep).map(s => s.id))) {
        if (declared.has(group)) continue;
        const i = firstOf(group);
        for (const r of rows) {
            if (rowStep(r.row) !== group || r.row === `${group} legs`) continue;
            for (const e of r.out) {
                const rune = e.reason === 'consume' ? runeOf(e) : null;
                if (!rune) continue;
                if (typeof e.count === 'number') {
                    addTo(steps[i]!.use, { [rune]: e.count });
                    addTo(steps[i]!.need, { [rune]: e.count });
                } else if (!steps[i]!.unknown.includes(rune)) steps[i]!.unknown.push(rune);
            }
        }
    }

    // Supplies.
    const unplaced: string[] = [];
    for (const r of rows) {
        const runes: Counts = {};
        const uncounted: RuneName[] = [];
        for (const e of r.in) {
            const rune = runeOf(e);
            if (!rune) continue;
            if (typeof e.count === 'number' && !e.topUp) addTo(runes, { [rune]: e.count });
            else uncounted.push(rune);
        }
        if (!Object.keys(runes).length && !uncounted.length) continue;
        let i = chain.findIndex(s => s.kind === 'handoff' && s.name === `${r.row} hand-off`);
        const kit = KIT_SEGMENTS[r.row];
        if (i < 0 && kit) i = chain.findIndex(s => s.name === kit);
        if (i < 0) {
            const group = /^S\d/.test(r.row) ? rowStep(r.row) : /^(S\d+[a-z]?)\b/.exec(INTERNAL[r.row] ?? '')?.[1];
            if (group) i = lastOf(group);
        }
        if (i < 0) unplaced.push(r.row);
        else steps[i]!.supplies.push({ row: r.row, runes, uncounted });
    }
    return { steps, unplaced };
}

// ------------------------------------------------------------------ the census

export interface RuneLine {
    rune: RuneName;
    held: number;
    /** The most the walk wants held at once: the use before each step plus that step's need. */
    needed: number;
    margin: number;
    /** The steps that spend it before the supply, in order. */
    uses: { index: number; name: string; n: number }[];
    /** Where the walk stopped: the next unserved row that brings it (null: none on the path). */
    supply: { row: string; index: number; name: string } | null;
    /** The first step that would find too few. */
    short: { index: number; name: string; need: number; left: number } | null;
    /** Steps that spend it at a `?` count (not judged). */
    unknown: string[];
}

export interface RuneCensus {
    from: number;
    start: string;
    lines: RuneLine[];
    ok: boolean;
    /** Why the start refuses (every rune that runs short), or null. */
    refusal: string | null;
}

export interface CensusOptions {
    /** A supply row already served in this attempt (runner/handoff.ts HandOffRecord.has): not a supply ahead. */
    served?: (row: string) => boolean;
}

/** The census from chain step `from` with `held` in the pack. */
export function runeCensus(plan: RunePlan, from: number, held: Counts, o: CensusOptions = {}): RuneCensus {
    const steps = plan.steps;
    const start = steps[from]?.name ?? '(the end of the path)';
    const runes = new Set<RuneName>((Object.keys(held) as RuneName[]).filter(r => (held[r] ?? 0) > 0));
    for (const s of steps.slice(from)) for (const r of [...Object.keys(s.use), ...Object.keys(s.need), ...s.unknown] as RuneName[]) runes.add(r);
    const lines = [...runes].sort((a, b) => runeLabel(a).localeCompare(runeLabel(b))).map((rune): RuneLine => {
        const have = held[rune] ?? 0;
        let spent = 0;
        let needed = 0;
        const uses: RuneLine['uses'] = [];
        const unknown: string[] = [];
        let supply: RuneLine['supply'] = null;
        let short: RuneLine['short'] = null;
        for (let i = from; i < steps.length; i++) {
            const s = steps[i]!;
            const sup = s.supplies.find(x => (rune in x.runes || x.uncounted.includes(rune)) && !o.served?.(x.row));
            if (sup) {
                supply = { row: sup.row, index: i, name: s.name };
                break;
            }
            const need = s.need[rune] ?? 0;
            const use = s.use[rune] ?? 0;
            if (s.unknown.includes(rune)) unknown.push(s.name);
            needed = Math.max(needed, spent + need);
            if (!short && spent + need > have) short = { index: i, name: s.name, need, left: Math.max(0, have - spent) };
            spent += use;
            if (use) uses.push({ index: i, name: s.name, n: use });
        }
        needed = Math.max(needed, spent);
        return { rune, held: have, needed, margin: have - needed, uses, supply, short, unknown };
    });
    const shortLines = lines.filter(l => l.short);
    const refusal = shortLines.length
        ? `rune census from #${from} ${start}: ${shortLines.map(l => `${runeLabel(l.rune)} short by ${l.needed - l.held}: held ${l.held}, needed ${l.needed} ${until(l)}; #${l.short!.index} ${l.short!.name} would run short (needs ${l.short!.need}, ${l.short!.left} left)${spends(l)}`).join('; ')}`
        : null;
    return { from, start, lines, ok: !refusal, refusal };
}

const until = (l: RuneLine) => (l.supply ? `before ${l.supply.row} brings more (#${l.supply.index} ${l.supply.name})` : 'to the end of the path (no later row brings it)');
const spends = (l: RuneLine) => (l.uses.length ? ` [spent by ${l.uses.map(u => `#${u.index} ${u.name} ${u.n}`).join(', ')}]` : '');

/** The census as lines for the console: one per rune, the short ones marked. */
export function formatCensus(c: RuneCensus, source: string): string[] {
    return [
        `rune census from #${c.from} ${c.start} (held: ${source}), ${c.lines.filter(l => l.short).length} short:`,
        ...c.lines.map(l => `  ${l.short ? 'SHORT   ' : 'ok      '} ${runeLabel(l.rune)}: held ${l.held}, needed ${l.needed} ${until(l)}, margin ${l.margin}${spends(l)}${l.unknown.length ? ` (a ? count at ${l.unknown.join(', ')}: not judged)` : ''}`),
    ];
}

// ------------------------------------------------------------------ what is held

/** The runes in a list of items, each by its obj id where it has one (rune-pins runeOf). */
export function runesHeld(items: readonly { name: string; count: number; id?: number }[]): Counts {
    const out: Counts = {};
    for (const i of items) {
        const r = runeOf({ name: i.name, ...(typeof i.id === 'number' ? { id: i.id } : {}) } as ItemRef);
        if (r) out[r] = (out[r] ?? 0) + i.count;
    }
    return out;
}

/** The last `(census)` row in a tick log: the pack before the step it names (runner/chain.ts censused). */
export interface LoggedCensus {
    /** The step about to run, by name. */
    before: string;
    tick: number;
    at: string;
    inventory: { name: string; count: number; id?: number }[];
    /** Whether every item carried its obj id (rows written before ids were recorded carry names only). */
    byId: boolean;
}

export function lastCensus(rows: readonly { step: string; kind?: string; startTick: number; at: string; meta?: Record<string, unknown> }[]): LoggedCensus | null {
    for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i]!;
        if (r.step !== CENSUS_STEP || !r.meta) continue;
        const inv = r.meta.inventory;
        if (typeof r.meta.before !== 'string' || !Array.isArray(inv)) continue;
        const inventory = (inv as { name: string; count: number; id?: number }[]).filter(x => typeof x?.name === 'string' && typeof x.count === 'number');
        return { before: r.meta.before, tick: r.startTick, at: r.at, inventory, byId: inventory.every(x => typeof x.id === 'number') };
    }
    return null;
}

export { fmtCounts };
