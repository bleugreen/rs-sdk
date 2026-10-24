import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { objPack } from '../lib/obj-pack';
import type { RuneName } from '../lib/travel';
import { loadModules, type Counts } from '../tools/rune-pins';
import { MANIFEST } from '../tools/slot-ledger';
import { buildChain, CENSUS_STEP, KIT_PARTNER_ROWS, ledgerRows, PLACEMENT, resolveFrom, type RunConfig } from './chain';
import { formatCensus, lastCensus, runeCensus, runePlan, runesHeld, type RunePlan } from './rune-census';

const PARTNERS: Record<string, string> = { ...Object.fromEntries([...Object.keys(PLACEMENT), ...KIT_PARTNER_ROWS, 'H4m'].map(id => [id, `p_${id.toLowerCase()}`])), H12a: 'p_h12', H12b: 'p_h12' };
const CONFIG: RunConfig = {
    partners: PARTNERS,
    firemakingTiles: '3222,3219;3221,3219;3220,3219',
    rings: { giver: 'ring_giver' },
    bones: { giver: 'bone_giver' },
    courier: { giver: 'courier', below: 3 },
    anvil: { giver: 'anvil_helper' },
    cueDir: join(tmpdir(), 'rune-census-test-cue'),
    h12o: { account: 'cairn_h45', cueDir: join(tmpdir(), 'rune-census-h45-cue'), loginDir: join(tmpdir(), 'rune-census-h45-login'), leadTicks: 300 },
};
const chain = buildChain(CONFIG, { cues: { open: async () => {}, stop: () => {} } });
const rows = ledgerRows(readFileSync(MANIFEST, 'utf8'));
const plan: RunePlan = runePlan(chain, rows, await loadModules());
const at = (ref: string) => resolveFrom(chain, ref)!;
/** Plenty of every rune but `law`. */
const withLaw = (law: number): Counts => ({ lawrune: law, waterrune: 50, airrune: 500, firerune: 50, earthrune: 50 });
const line = (c: ReturnType<typeof runeCensus>, rune: RuneName) => c.lines.find(l => l.rune === rune)!;

describe('the plan: the chain read through the ledger, the legs and the modules', () => {
    test('every ledger row that brings a rune lands on a chain step', () => {
        expect(plan.unplaced).toEqual([]);
        const supplies = plan.steps.flatMap(s => s.supplies.map(x => `${x.row}@${s.name}`));
        // Kit rows land at the segment that trades them, and a module's own rows at its last step.
        expect(supplies).toContain('H4@S05:A-h4-swap');
        expect(supplies).toContain('H12@S15:A-narnode');
        expect(supplies).toContain('H17e@S21 runecraft');
        expect(supplies).toContain('S07 last load@woodcutting:drop-axe');
        expect(supplies).toContain('H11@H11 hand-off');
    });

    test("a split leg's teleport is in part a; a worn staff's element is not spent", () => {
        const step = (ref: string) => plan.steps[at(ref)]!;
        expect(step('T13-14a').use).toEqual({ lawrune: 2, waterrune: 2 });
        expect(step('T13-14b').use).toEqual({});
        // The staff of water is worn from S01 to H7, so T04-05's Falador teleport spends no water.
        expect(step('T04-05').use).toEqual({ lawrune: 1, airrune: 3 });
    });

    test("a module's RUNE_USE lands on its segment steps and RUNE_NEED at the segment that checks it; Monkey Madness, declaring none, spends its ledger row", () => {
        expect(plan.steps[at('S13:K-nulodion')]!.use.lawrune).toBe(1);
        expect(plan.steps[at('S13:L-lawgof-complete')]!.use.lawrune).toBe(2);
        expect(plan.steps[at('S13:A-lawgof-start')]!.need.lawrune).toBe(3);
        expect(plan.steps[at('S15:A-narnode')]!.use).toEqual({ lawrune: 3, waterrune: 2, airrune: 3, firerune: 1 });
    });
});

describe('the census', () => {
    test("rehearsal (b): law 3 held at S13 against K's 1, L's 2 and T13-14a's 2 refuses before starting, naming the rune, the step and the supply", () => {
        const c = runeCensus(plan, at('S13'), withLaw(3));
        expect(c.ok).toBe(false);
        const law = line(c, 'lawrune');
        expect(law).toMatchObject({ held: 3, needed: 5, margin: -2, supply: { row: 'H11', index: at('H11') }, short: { name: 'T13-14a', need: 2, left: 0 } });
        expect(law.uses.map(u => [u.name, u.n])).toEqual([['S13:K-nulodion', 1], ['S13:L-lawgof-complete', 2], ['T13-14a', 2]]);
        expect(c.refusal).toBe(
            `rune census from #${at('S13')} S13:A-lawgof-start: law rune short by 2: held 3, needed 5 before H11 brings more (#${at('H11')} H11 hand-off); `
                + `#${at('T13-14a')} T13-14a would run short (needs 2, 0 left) [spent by #${at('S13:K-nulodion')} S13:K-nulodion 1, #${at('S13:L-lawgof-complete')} S13:L-lawgof-complete 2, #${at('T13-14a')} T13-14a 2]`,
        );
        // Only law is short: the water and air lines pass.
        expect(c.lines.filter(l => l.short).map(l => l.rune)).toEqual(['lawrune']);
    });

    test("rehearsal (b)'s re-run itself: T12-13a cast again with the 5 law left after run (a)'s cast refuses (needs 7 before H11)", () => {
        const c = runeCensus(plan, at('T12-13a'), withLaw(5));
        expect(line(c, 'lawrune')).toMatchObject({ held: 5, needed: 7, margin: -2, supply: { row: 'H11' }, short: { name: 'T13-14a', left: 0 } });
    });

    test('a sufficient census passes: the planned 5 law at S13 reaches H11 with nothing to spare', () => {
        const c = runeCensus(plan, at('S13'), withLaw(5));
        expect(c.ok).toBe(true);
        expect(c.refusal).toBeNull();
        expect(line(c, 'lawrune')).toMatchObject({ held: 5, needed: 5, margin: 0, short: null, supply: { row: 'H11' } });
    });

    test("a resume right after a supplier hand-off counts that hand-off's delivery: H11's 4 law held, the walk runs on to H12", () => {
        const after = runeCensus(plan, at('T13-14b'), withLaw(4));
        expect(after.ok).toBe(true);
        expect(line(after, 'lawrune')).toMatchObject({ held: 4, needed: 2, margin: 2, supply: { row: 'H12', name: 'S15:A-narnode' } });
        // From H11 itself it is still ahead, so the walk stops there; and before the census of T13-14a
        // with none held, it waits on H11.
        expect(line(runeCensus(plan, at('H11'), withLaw(4)), 'lawrune')).toMatchObject({ held: 4, needed: 0, supply: { row: 'H11' } });
        expect(line(runeCensus(plan, at('T13-14a'), withLaw(0)), 'lawrune')).toMatchObject({ needed: 2, supply: { row: 'H11' }, short: { name: 'T13-14a' } });
    });

    test('a supply this attempt has already served is not counted again: the walk goes past it', () => {
        // T11-12a re-run after H9 was served: its 7 law are in the pack and H9 brings no more.
        const served = runeCensus(plan, at('T11-12a'), withLaw(7), { served: row => row === 'H9' });
        expect(line(served, 'lawrune')).toMatchObject({ held: 7, needed: 9, supply: { row: 'H11' }, short: { name: 'T13-14a' } });
        // Not yet served: T11-12a's own 2 are all it needs before H9.
        expect(line(runeCensus(plan, at('T11-12a'), withLaw(2)), 'lawrune')).toMatchObject({ needed: 2, margin: 0, supply: { row: 'H9' } });
    });

    test('the planned run never refuses: from every step, the pack the plan leaves there passes', () => {
        let held: Counts = {};
        const refused: string[] = [];
        plan.steps.forEach((s, i) => {
            const c = runeCensus(plan, i, held);
            if (!c.ok) refused.push(c.refusal!);
            for (const sup of s.supplies) {
                for (const [r, n] of Object.entries(sup.runes) as [RuneName, number][]) held = { ...held, [r]: (held[r] ?? 0) + n };
                for (const r of sup.uncounted) held = { ...held, [r]: (held[r] ?? 0) + 1000 };
            }
            for (const [r, n] of Object.entries(s.use) as [RuneName, number][]) held = { ...held, [r]: (held[r] ?? 0) - n };
        });
        expect(refused).toEqual([]);
    });

    test('the printed census: one line per rune held or needed, the short one marked', () => {
        const text = formatCensus(runeCensus(plan, at('S13'), { lawrune: 3, waterrune: 5 }), 'the live pack after login, by id');
        expect(text[0]).toBe(`rune census from #${at('S13')} S13:A-lawgof-start (held: the live pack after login, by id), 2 short:`);
        expect(text.find(l => l.includes('law rune'))).toStartWith('  SHORT    law rune: held 3, needed 5 before H11 brings more');
        expect(text.find(l => l.includes('water rune'))).toStartWith('  ok       water rune: held 5, needed 5 before H11 brings more');
        // Air: K's Falador teleport spends 3, none held.
        expect(text.find(l => l.includes('air rune'))).toStartWith('  SHORT    air rune: held 0, needed 3 before H12 brings more');
    });
});

describe('what is held', () => {
    const idOf = (debug: string) => [...objPack().names].find(([, n]) => n === debug)![0];

    test('runes are read by obj id: an item whose id is no rune is not one, whatever its name', () => {
        const law = idOf('lawrune');
        const shark = idOf('shark');
        expect(runesHeld([{ name: 'Law rune', count: 3, id: law }, { name: 'Law rune', count: 9, id: shark }, { name: 'Water rune', count: 4 }, { name: 'Shark', count: 5, id: shark }])).toEqual({ lawrune: 3, waterrune: 4 });
    });

    test("the tick log's last (census) row: the pack before the step it names, by id when every item carries one", () => {
        const law = idOf('lawrune');
        const row = (before: string, tick: number, inventory: unknown[]) => ({ step: CENSUS_STEP, kind: 'note', startTick: tick, at: `t${tick}`, meta: { before, id: 'x', inventory, free: 20, worn: [] } });
        const rowsIn = [
            row('S12:A-lady-start', 100, [{ name: 'Law rune', count: 7, id: law }]),
            { step: 'S12:A-lady-start', kind: 'step', startTick: 101, at: 't101' },
            row('S13:A-lawgof-start', 200, [{ name: 'Law rune', count: 3, id: law }]),
            { step: 'S13:A-lawgof-start', kind: 'step', startTick: 201, at: 't201', meta: { inventory: [] } },
        ];
        expect(lastCensus(rowsIn)).toEqual({ before: 'S13:A-lawgof-start', tick: 200, at: 't200', inventory: [{ name: 'Law rune', count: 3, id: law }], byId: true });
        expect(lastCensus([row('S02 magic', 5, [{ name: 'Air rune', count: 25 }])])!.byId).toBe(false);
        expect(lastCensus([])).toBeNull();
    });
});
