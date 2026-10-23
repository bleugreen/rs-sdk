// The run's report from its tick log (speedrun/run.ts, lab/dress-rehearsal.ts): per RUN-ORDER id,
// the ticks against RUN-ORDER.md section 2's expected and best (read from the doc at report time:
// chain.ts copies no figures), with every step more than 10% off flagged for rs/158; then the
// boundary census, each teleport hop's ticks from the legs' travel rows, overBudget summed from the
// program rows, the smithing make-button rows where present, hand-off ticks, drops and resumes, and
// what the lab supplied. STAND-IN rows are counted apart and out of every total, and any STAND-IN or
// staff supply marks the run partial: a partial run is never the 1,881 acceptance.

import type { TickRow } from '../lib/ticks';
import { formatTabMemory, type TabMemoryTrend, tabMemoryTrends } from '../lib/tab-memory';
import { BOUNDARY_STEP } from './step';
import { CENSUS_STEP, parseStepTable, type ChainStep } from './chain';
import { DROP_STEP, RESUME_STEP } from './resume';

/** The step-name prefix of a lab stand-in's rows. */
export const STAND_IN_STEP = 'STAND-IN';
/** The step-name prefix of a boundary the lab supplied with staff commands instead of a helper. */
export const STAFF_SUPPLY_STEP = 'supply: staff';
/** Off by more than this share of RUN-ORDER's expected: reported to rs/158. */
export const DIVERGENCE = 0.1;

export interface StepLine {
    id: string;
    ticks: number;
    expected: number | null;
    best: number | null;
    /** (ticks - expected) / expected. */
    off: number | null;
    flagged: boolean;
}

export interface RunReport {
    partial: boolean;
    steps: StepLine[];
    /** Every row's ticks but the stand-ins'. */
    totalTicks: number;
    boundaryTicks: number;
    standIns: { step: string; ticks: number }[];
    staffSupplies: string[];
    census: number;
    teleports: { leg: string; hop: string; ticks: number }[];
    overBudget: number;
    smithingClicks: Record<string, unknown>[];
    handOffs: { row: string; ticks: number; ok: boolean }[];
    drops: number;
    resumes: number;
    /** The browser tab's memory per chunk (lib/tab-memory.ts tabmem rows). */
    tabMemory: TabMemoryTrend[];
}

const isStandIn = (r: TickRow) => r.step.startsWith(STAND_IN_STEP);

export function runReport(rows: readonly TickRow[], chain: readonly ChainStep[], runOrder: string): RunReport {
    const idOf = new Map(chain.map(s => [s.name, s.id]));
    const table = new Map(parseStepTable(runOrder).map(r => [r.id, r]));
    const byId = new Map<string, number>();
    // A staff supply is not the trade RUN-ORDER prices: it is listed, never compared.
    const stepRows = rows.filter(r => !r.kind && idOf.has(r.step) && !isStandIn(r) && !r.step.includes(STAFF_SUPPLY_STEP));
    for (const r of stepRows) {
        const id = idOf.get(r.step)!;
        if (!/^S\d/.test(id) || /-fallback$/.test(id)) continue;
        byId.set(id, (byId.get(id) ?? 0) + r.ticks);
    }
    const steps: StepLine[] = [...byId].map(([id, ticks]) => {
        const t = table.get(id);
        const expected = t?.expected ?? null;
        const off = expected ? (ticks - expected) / expected : null;
        return { id, ticks, expected, best: t?.best ?? null, off, flagged: off !== null && Math.abs(off) > DIVERGENCE };
    });
    const standIns = rows.filter(isStandIn).map(r => ({ step: r.step, ticks: r.ticks }));
    const staffSupplies = rows.filter(r => r.step.startsWith(STAFF_SUPPLY_STEP)).map(r => r.step);
    const program = rows.filter(r => r.kind === 'program');
    const travel = rows.filter(r => r.kind === 'travel');
    return {
        partial: standIns.length > 0 || staffSupplies.length > 0,
        steps,
        totalTicks: rows.filter(r => !r.kind && !isStandIn(r)).reduce((a, r) => a + r.ticks, 0),
        boundaryTicks: rows.filter(r => r.step === BOUNDARY_STEP).reduce((a, r) => a + r.ticks, 0),
        standIns,
        staffSupplies,
        census: rows.filter(r => r.step === CENSUS_STEP).length,
        teleports: travel.flatMap(r => ((r.meta?.segments as { hop: string; ticks: number }[] | undefined) ?? []).filter(s => /teleport/i.test(s.hop)).map(s => ({ leg: r.step, hop: s.hop, ticks: s.ticks }))),
        overBudget: program.reduce((a, r) => a + (((r.meta?.counters as Record<string, number> | undefined)?.overBudget ?? (r.meta?.overBudget as number | undefined)) ?? 0), 0),
        smithingClicks: rows.filter(r => r.step.startsWith('S25a smithing') && r.meta && ('make' in r.meta || 'button' in r.meta)).map(r => ({ step: r.step, ...r.meta })),
        handOffs: rows.filter(r => !r.kind && / hand-off$/.test(r.step)).map(r => ({ row: r.step.replace(/ hand-off$/, ''), ticks: r.ticks, ok: r.ok })),
        drops: rows.filter(r => r.step === DROP_STEP).length,
        resumes: rows.filter(r => r.step === RESUME_STEP).length,
        tabMemory: tabMemoryTrends(rows),
    };
}

export function formatRunReport(r: RunReport): string {
    const pct = (x: number | null) => (x === null ? '' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`);
    const lines = [
        r.partial ? `PARTIAL: ${r.standIns.length} stand-in(s) (${r.standIns.map(s => s.step).join(', ') || 'none'}), ${r.staffSupplies.length} staff supply(ies): not the 1,881 acceptance` : 'complete: no stand-ins, no staff supplies',
        `total ${r.totalTicks} ticks (boundaries ${r.boundaryTicks}); census rows ${r.census}; overBudget ${r.overBudget}; drops ${r.drops}; resume walks ${r.resumes}`,
        '',
        'id      ticks  expected  best  off',
        ...r.steps.map(s => `${s.id.padEnd(7)} ${String(s.ticks).padStart(6)}  ${String(s.expected ?? '-').padStart(8)}  ${String(s.best ?? '-').padStart(4)}  ${pct(s.off)}${s.flagged ? '  -> rs/158' : ''}`),
        '',
        `hand-offs: ${r.handOffs.map(h => `${h.row} ${h.ticks}${h.ok ? '' : ' FAILED'}`).join(', ') || 'none'}`,
        `teleports: ${r.teleports.map(t => `${t.leg} ${t.hop} ${t.ticks}`).join('; ') || 'none'}`,
        `smithing make clicks: ${r.smithingClicks.length ? JSON.stringify(r.smithingClicks) : 'none logged (smithing.ts rows carry no make-button meta yet)'}`,
    ];
    if (r.staffSupplies.length) lines.push(`staff supplies: ${r.staffSupplies.join(', ')}`);
    lines.push(...formatTabMemory(r.tabMemory));
    return lines.join('\n');
}
