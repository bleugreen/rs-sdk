// r8-package: R8's respawn packages, the kit a spawn helper hands SCORED at the Lumbridge respawn
// after a player kill in a Wilderness phase, derived from the inventory ledger (STEP-MANIFEST.md), never
// typed by hand. `r8Package` is the one definition: a later consumer (a staging script, a spawn
// helper's mule options, a recovery path) calls it rather than keeping a list of its own.
//
// For a phase (R8_PHASES: ledger row ids only, no items):
//   1. the target is the canonical walk's held set at the start of the row SCORED resumes at;
//   2. of that, the package carries what the ledger still needs after it: an item a later row
//      consumes or hands in, wields (+NAME), or wears through a step before it leaves; one whose first
//      later appearance is a swap, trade, deposit or drop is returned unused and left out (the rule
//      docs/speedrun/scripts/r8-deaths.ts classes lost items by);
//   3. plus what the replayed legs consume (the teleport runes back from Lumbridge) and the sharks
//      that heal 1 HP back to the phase's HP (a shark heals 20; r8-deaths.ts's figure);
//   4. less the units the engine keeps (lib/death-keep.ts, death.rs2), at every death point the phase
//      covers: a unit kept at one point and dropped at another stays in the package;
//   5. the cannon set and its balls stay out (rs/41's ruling): a deployed cannon waits on the ground
//      for its owner, a carried one lost comes from cairn_h92's repeat of its hand-off.
// Each package then has to pass `respawnCheck`: the slot ledger walked from the respawn state (the
// kept units in the pack, the package traded in, the worn set put back on, the sharks eaten) through
// the replayed legs, the cannon's re-supply and the phase's rows. A row short, over 28 slots, or
// using something not held refuses that form: its package is then null, so it cannot be staged. The
// check runs per death point and per form, since each death keeps its own units.
//
// The package comes in two forms: by id (`byId`, a fixed amount: the target less the kept units) and
// top-up (`topUp`, `to N` counting what SCORED holds, as the ledger's top-up lines, which stays right
// whatever the engine kept).
//
//   bun speedrun/helpers/r8-package.ts [--phase R8a] [--json] [--manifest PATH] [--protect-item]
//       every phase's package, its kept units, its walks; exit 1 when a phase has neither form stageable
import { readFileSync } from 'node:fs';

import { contentObjs, keepPriciest, objOf, type HeroUnit, type ObjTable } from '../lib/death-keep';
import { FAILING, MANIFEST, parseLedger, render, walk, type Held, type InEntry, type Kind, type LedgerEntry, type LedgerRow } from '../tools/slot-ledger';
import { packageOf, type Package, type PackageItem } from './mule';

export const INVENTORY_SLOTS = 28;

/** The cannon set and its balls: never in a respawn package (rs/41, 2026-10-22). */
export const CANNON = ['cannon base', 'cannon stand', 'cannon barrels', 'cannon furnace', 'cannonball'] as const;

/** The food the package heals with, and what one heals (consume_normal.dbrow, r8-deaths.ts). */
export const FOOD = { name: 'shark', kind: 'u' as Kind, heals: 20 };

export interface R8Death {
    /** The ledger row whose held set is the kit SCORED dies with. */
    row: string;
    /** The cannon is set up on the ground: neither carried nor ranked for the keep. */
    deployed?: true;
}

export interface R8Phase {
    /** The package id and its cue scope's step (`{ step: id, family: 'mule' }`). */
    id: string;
    what: string;
    deaths: readonly R8Death[];
    /** Ledger rows walked again from Lumbridge before `resume`: the teleport legs. */
    replay: readonly string[];
    /** The row SCORED resumes at; the package restores the held set at its start. */
    resume: string;
    /** The last row the respawn check walks. */
    to: string;
    /** The HP the phase is priced at (r8-deaths.ts), healed from 1 with FOOD. */
    hp: number;
    /** Who re-supplies a carried cannon the death lost, and where in the walk (after the replay). */
    cannonBy: string;
}

/**
 * R8's phases (rs/158, 2026-10-22, from r8-deaths.ts's stretches at b6a49fa1). H11 and H13 are trades
 * at the Ardougne landing, so their kit is what T13-14's and T15-16's Wilderness legs carry. The end
 * stretch is two packages: a death on T26-27 or in S27 resumes at S27, one in S17 at S17. The ledger
 * has no T27-17 row, so R8d2 replays no leg (the trip back to the course is not in the ledger).
 */
export const R8_PHASES: readonly R8Phase[] = [
    { id: 'R8a', what: 'T13-14 with H11 (the Wilderness carry to the spiders) or in S14', deaths: [{ row: 'H11' }, { row: 'S14', deployed: true }], replay: ['T13-14'], resume: 'S14', to: 'H12', hp: 42, cannonBy: "cairn_h92's H11 repeat" },
    { id: 'R8b', what: 'T14-15 (the spiders to the Ardougne cast, the cannon packed)', deaths: [{ row: 'T14-15' }], replay: ['T14-15'], resume: 'H11r', to: 'H12', hp: 42, cannonBy: "cairn_h92's H11 repeat" },
    { id: 'R8c', what: 'T15-16 with H13 (the Wilderness carry to the arena) or in S16', deaths: [{ row: 'H13' }, { row: 'S16' }], replay: ['T15-16'], resume: 'S16', to: 'T16-18', hp: 42, cannonBy: 'none (no cannon)' },
    { id: 'R8d1', what: 'T26-27 with H23 or in S27 (cannon deployed or packed)', deaths: [{ row: 'H23' }, { row: 'S27', deployed: true }, { row: 'S27' }], replay: ['T26-27'], resume: 'S27', to: 'S17', hp: 97, cannonBy: "cairn_h92's H23 repeat" },
    { id: 'R8d2', what: 'S17 mid-course', deaths: [{ row: 'S17' }], replay: [], resume: 'S17', to: 'S17', hp: 97, cannonBy: 'none (not needed after S27)' },
];

export interface KeptUnit {
    name: string;
    id?: number;
    kind: Kind;
    worn: boolean;
    cost: number;
    /** The obj config's debug name; null when no config matched (priced 0). */
    debug: string | null;
}

export interface R8Line {
    /** The ledger's name for the item. */
    item: string;
    /** obj.pack id; undefined when no obj config matched (the package is then refused). */
    id?: number;
    kind: Kind;
    /** What SCORED has to hold once traded: the target, the replay's runes, the heal. */
    need: number;
    /** Units kept at every death point. */
    kept: number;
    /** need - kept: the fixed form's amount. */
    give: number;
    why: string;
}

/** How the helper serves the package: fixed amounts (`byId`), or top-ups counting what SCORED holds. */
export type R8Form = 'fixed' | 'topUp';

export interface R8Walk {
    form: R8Form;
    death: R8Death;
    kept: KeptUnit[];
    /** Cannon items the check takes as re-supplied (deployed, or cannonBy), less any kept. */
    cannon: { item: string; count: number }[];
    entries: LedgerEntry[];
}

export interface R8Package {
    phase: R8Phase;
    scope: { step: string; family: 'mule' };
    lines: R8Line[];
    /** The fixed form, by id: `{ id, amount }` per line with something to give. */
    byId: PackageItem[];
    /** The top-up form, by id: `{ id, topUp: { max: need } }` per line. */
    topUp: PackageItem[];
    /** The helper's inventory slots the fixed form fills. */
    slots: number;
    /** Units kept at every death point (step 4). */
    kept: KeptUnit[];
    /** Held at the resume row but returned unused afterwards, so not carried. */
    notNeeded: string[];
    /** One respawn walk per form and death point. */
    walks: R8Walk[];
    /** Why a form is refused, each tagged with its form, or `both` for a fault in the package itself. */
    refusals: string[];
    /** The fixed form as a mule package (mule.ts packageOf), scoped; null when it is refused. */
    package: Package | null;
    /** The top-up form as a mule package, read from SCORED's ask in `scope`; null when it is refused. */
    topUpPackage: Package | null;
}

export interface R8Options {
    /** The manifest's markdown (STEP-MANIFEST.md by default). */
    manifest?: string;
    objs?: ObjTable;
    /** Units the engine keeps: 3, or 4 under Protect Item. */
    keep?: number;
}

// ------------------------------------------------------------------ the ledger's later use of an item

const lc = (s: string) => s.toLowerCase();
const doseless = (s: string) => lc(s).replace(/\(\d\)$/, '');
/** `name` (an entry's) names the stack `held`: the same name, or a dose family of it. */
const names = (name: string, held: string) => lc(name) === lc(held) || doseless(name) === doseless(held);
/**
 * Steps whose worn kit is not a use: S17's agility course, where the run ends (r8-deaths.ts: 'the run
 * ends on the course', 'S17's course uses no kit'). Its sharks are still consumed.
 */
export const NO_KIT_STEPS: readonly string[] = ['S17'];
const isStep = (r: LedgerRow) => /^S\d/.test(r.row) && !NO_KIT_STEPS.includes(r.row);
const isCannon = (name: string) => (CANNON as readonly string[]).includes(lc(name));
const USES = new Set(['consume', 'hand-in']);

/** Why the ledger still needs `item` from row `from` on, or null when it is returned unused. */
export function laterUse(rows: readonly LedgerRow[], entries: readonly LedgerEntry[], from: number, item: string): string | null {
    let wornThrough: string | null = null;
    for (let i = from; i < rows.length; i++) {
        const r = rows[i]!;
        const o = r.out.find(e => names(e.name, item));
        if (o && USES.has(o.reason)) return `${o.reason} at ${r.row}`;
        if (o) return wornThrough ? `worn through ${wornThrough}` : null;
        if (r.equip.some(e => e.on && names(e.name, item))) return `wielded at ${r.row}`;
        if (!wornThrough && isStep(r) && entries[i]!.stacks.worn.some(w => names(item, w.name))) wornThrough = r.row;
    }
    return wornThrough ? `worn through ${wornThrough}` : null;
}

// ------------------------------------------------------------------ the respawn check

const slotsOf = (lines: readonly { kind: Kind; count: number }[]) => lines.reduce((n, l) => n + (l.count <= 0 ? 0 : l.kind === 'u' ? l.count : 1), 0);

function row(id: string, inn: InEntry[], out: LedgerRow['out'], equip: LedgerRow['equip'], need: number): LedgerRow {
    return { row: id, line: 0, in: inn, out, equip, need, source: 'r8-package (respawn check)', evidence: [] };
}

export interface RespawnInput {
    phase: R8Phase;
    /** The kept units, back in the pack. */
    kept: readonly KeptUnit[];
    /** The package traded in. */
    give: readonly { item: string; id?: number; kind: Kind; count: number }[];
    /** The cannon items re-supplied after the replay. */
    cannon: readonly { item: string; id?: number; kind: Kind; count: number }[];
    /** Sharks eaten from 1 HP once traded. */
    heal: number;
    /** The canonical held set at the resume row: what is worn goes back on. */
    target: { inv: readonly Held[]; worn: readonly Held[] };
    /** Names held on the way that the respawn lost and that are returned unused. */
    lost: readonly string[];
}

/**
 * The slot ledger from the respawn state through the phase: the package's trade (a hand-off row, so
 * it must fit the slots the kept units leave), the worn set put back on, the sharks eaten, the
 * replayed legs, the cannon's re-supply, then the ledger's rows from `resume` to `to`. An out or
 * equip line for an item the respawn lost and the run returns unused is dropped (nobody holds it to
 * hand back); a consume or hand-in of something not held stays, and errors.
 */
export function respawnCheck(rows: readonly LedgerRow[], r: RespawnInput): LedgerEntry[] {
    const at = (id: string) => {
        const i = rows.findIndex(x => x.row === id);
        if (i < 0) throw new Error(`no ledger row ${id}`);
        return i;
    };
    const inv: Held[] = [];
    for (const k of r.kept) {
        const h = inv.find(x => lc(x.name) === lc(k.name));
        if (h) h.count! += 1;
        else inv.push({ name: k.name, ...(k.id !== undefined ? { id: k.id } : {}), kind: k.kind, count: 1 });
    }
    const entry = (l: RespawnInput['give'][number]): InEntry => ({ name: l.item, ...(l.id !== undefined ? { id: l.id } : {}), count: l.count, kind: l.kind });
    const give = r.give.filter(l => l.count > 0);
    const held = new Set([...r.kept.map(k => lc(k.name)), ...give.map(l => lc(l.item)), ...r.cannon.map(l => lc(l.item))]);
    const rewear = r.target.worn.filter(w => held.has(lc(w.name))).map(w => ({ name: w.name, on: true }));
    const walked: LedgerRow[] = [row(`H94 ${r.phase.id}`, give.map(entry), [], rewear, slotsOf(give))];
    if (r.heal > 0) walked.push(row(`${r.phase.id} eat`, [], [{ name: FOOD.name, count: r.heal, reason: 'consume' }], [], 0));
    const later = [...r.phase.replay.map(id => rows[at(id)]!)];
    const cannon = r.cannon.filter(l => l.count > 0);
    const ledgerRows = rows.slice(at(r.phase.resume), at(r.phase.to) + 1);
    if (at(r.phase.to) < at(r.phase.resume)) throw new Error(`${r.phase.id}: ${r.phase.to} comes before ${r.phase.resume}`);
    const lost = new Set(r.lost.map(lc));
    const strip = (x: LedgerRow): LedgerRow => {
        const back = (name: string) => [...lost].some(l => names(name, l));
        const kept = { ...x, out: x.out.filter(o => USES.has(o.reason) || !back(o.name)), equip: x.equip.filter(e => !back(e.name)) };
        for (const e of x.in) for (const l of [...lost]) if (names(e.name, l)) lost.delete(l);
        return kept;
    };
    walked.push(...later.map(strip));
    if (cannon.length) walked.push(row(`H ${r.phase.cannonBy}`, cannon.map(entry), [], [], slotsOf(cannon)));
    walked.push(...ledgerRows.map(strip));
    return walk(walked, { inv, worn: [] });
}

// ------------------------------------------------------------------ the package

const heals = (hp: number) => Math.max(0, Math.ceil((hp - 1) / FOOD.heals));

/**
 * The respawn package for `phase`, derived from the ledger and checked from the respawn state. The
 * one definition of an R8 package: steps 1-5 and the check in the header.
 */
export function r8Package(phase: R8Phase, o: R8Options = {}): R8Package {
    const { rows, errors } = parseLedger(o.manifest ?? readFileSync(MANIFEST, 'utf8'));
    if (errors.length) throw new Error(`the inventory ledger does not parse: ${errors.join('; ')}`);
    const objs = o.objs ?? contentObjs();
    const keep = o.keep ?? 3;
    const entries = walk(rows);
    const at = (id: string) => {
        const found = rows.map((r, i) => (r.row === id ? i : -1)).filter(i => i >= 0);
        if (found.length !== 1) throw new Error(found.length ? `${found.length} ledger rows named ${id}` : `no ledger row ${id}`);
        return found[0]!;
    };
    const refusals: string[] = [];
    // A name several objs share takes the id some row gives it (`NAME @ID`), as r8-deaths.ts does.
    const rowIds = new Map<string, number>();
    for (const r of rows) for (const e of [...r.in, ...r.out]) if (e.id !== undefined) rowIds.set(lc(e.name), e.id);
    const worn = new Set<string>();
    for (const e of entries) for (const w of e.stacks.worn) worn.add(lc(w.name));
    const obj = (h: { name: string; id?: number }) => {
        const id = h.id ?? rowIds.get(lc(h.name));
        return objOf(objs, { name: h.name, ...(id !== undefined ? { id } : {}), worn: worn.has(lc(h.name)) });
    };

    // 1. The target, 2. what of it the ledger still needs.
    const resume = at(phase.resume);
    if (resume === 0) throw new Error(`${phase.id}: ${phase.resume} is the ledger's first row`);
    const target = entries[resume - 1]!.stacks;
    const needs = new Map<string, { item: string; id?: number; kind: Kind; count: number; why: string[] }>();
    const add = (h: { name: string; id?: number; kind: Kind }, n: number, why: string) => {
        const k = lc(h.name);
        const cur = needs.get(k) ?? { item: h.name, ...(h.id !== undefined ? { id: h.id } : {}), kind: h.kind, count: 0, why: [] };
        cur.count += n;
        cur.why.push(why);
        needs.set(k, cur);
    };
    const notNeeded: string[] = [];
    const cannonHeld: Held[] = [];
    let cannonUsed = false;
    for (const h of [...target.inv, ...target.worn]) {
        const use = laterUse(rows, entries, resume, h.name);
        if (h.count === null) refusals.push(`${phase.id}: ${h.name} is held at an unknown count at ${phase.resume}`);
        if (isCannon(h.name)) {
            cannonHeld.push(h);
            cannonUsed ||= use !== null;
        } else if (use) add(h, h.count ?? 0, `${use}`);
        else notNeeded.push(`${h.name} x${h.count ?? '?'}`);
    }
    // The ledger has no deploy reason: the set is used where its balls are consumed, and goes as a set.
    if (!cannonUsed) notNeeded.push(...cannonHeld.map(h => `${h.name} x${h.count ?? '?'}`));

    // 3. The replayed legs' consumption, and the heal.
    for (const id of phase.replay) {
        const i = at(id);
        const before = i ? entries[i - 1]!.stacks : { inv: [], worn: [] };
        for (const e of rows[i]!.out.filter(e => USES.has(e.reason))) {
            const h = [...before.inv, ...before.worn].find(x => names(e.name, x.name));
            if (!h || typeof e.count !== 'number') {
                refusals.push(`${phase.id}: ${id}'s ${e.name} ${e.count} (${e.reason}) has no count or stack to size the replay by`);
                continue;
            }
            add(h, e.count, `${e.reason} at ${id} (replayed)`);
        }
    }
    const heal = heals(phase.hp);
    if (heal) add(FOOD, heal, `${heal} eaten from 1 HP to ${phase.hp}`);

    // 4. The keep at each death point, and what every one of them keeps.
    const keptAt = phase.deaths.map(d => {
        const s = entries[at(d.row)]!.stacks;
        const units = [...s.inv.map(h => [h, false] as const), ...s.worn.map(h => [h, true] as const)]
            .filter(([h]) => !(d.deployed && isCannon(h.name)))
            .map(([h, worn]): HeroUnit & KeptUnit => {
                const c = obj(h);
                return { name: h.name, ...(h.id !== undefined ? { id: h.id } : {}), kind: h.kind, worn, count: h.count ?? 0, cost: c && !c.destroy ? c.cost : 0, debug: c?.debug ?? null };
            });
        return keepPriciest(units, keep).kept.map(({ count: _, ...k }) => k as KeptUnit);
    });
    const tally = (ks: readonly KeptUnit[]) => ks.reduce((m, k) => m.set(lc(k.name), (m.get(lc(k.name)) ?? 0) + 1), new Map<string, number>());
    const tallies = keptAt.map(tally);
    const kept: KeptUnit[] = [];
    for (const k of keptAt[0] ?? []) {
        const n = Math.min(...tallies.map(t => t.get(lc(k.name)) ?? 0));
        if (kept.filter(x => lc(x.name) === lc(k.name)).length < n) kept.push(k);
    }
    const keptAll = tally(kept);

    // The lines in both forms.
    const lines: R8Line[] = [...needs.values()].map(n => {
        const k = Math.min(n.count, keptAll.get(lc(n.item)) ?? 0);
        const c = obj({ name: n.item, ...(n.id !== undefined ? { id: n.id } : {}) });
        if (!c || c.id === undefined) refusals.push(`${phase.id}: no obj id for ${n.item}`);
        return { item: n.item, ...(c?.id !== undefined ? { id: c.id } : {}), kind: n.kind, need: n.count, kept: k, give: n.count - k, why: n.why.join('; ') };
    });
    const byId: PackageItem[] = lines.filter(l => l.give > 0 && l.id !== undefined).map(l => ({ id: l.id!, amount: l.give }));
    const topUp: PackageItem[] = lines.filter(l => l.need > 0 && l.id !== undefined).map(l => ({ id: l.id!, topUp: { max: l.need } }));
    const slots = slotsOf(lines.map(l => ({ kind: l.kind, count: l.give })));
    if (slots > INVENTORY_SLOTS) refusals.push(`both: ${phase.id}: the package fills ${slots} slots, more than the helper's ${INVENTORY_SLOTS}`);
    for (let i = 0; i < refusals.length; i++) if (!/^both: /.test(refusals[i]!)) refusals[i] = `both: ${refusals[i]}`;

    // 5. The respawn check, per form and death point (each keeps its own units). The fixed form gives
    // `give`, sized on the units every death point keeps; a top-up gives what this death's keep leaves.
    const before = phase.replay.length ? entries[at(phase.replay[0]!) - 1]!.stacks : target;
    const walks: R8Walk[] = (['fixed', 'topUp'] as const).flatMap(form =>
        phase.deaths.map((death, d) => {
            const mine = tally(keptAt[d]!);
            const left = (item: string, n: number) => Math.max(0, n - (mine.get(lc(item)) ?? 0));
            const give = lines.map(l => ({ item: l.item, ...(l.id !== undefined ? { id: l.id } : {}), kind: l.kind, count: form === 'fixed' ? l.give : left(l.item, l.need) }));
            const cannon = cannonUsed ? cannonHeld.map(h => ({ item: h.name, ...(h.id !== undefined ? { id: h.id } : {}), kind: h.kind, count: left(h.name, h.count ?? 0) })) : [];
            const held = new Set([...keptAt[d]!.map(k => lc(k.name)), ...give.filter(l => l.count > 0).map(l => lc(l.item)), ...cannon.filter(c => c.count > 0).map(c => lc(c.item))]);
            const lost = [...new Set([...target.inv, ...target.worn, ...before.inv, ...before.worn].map(h => h.name))].filter(n => !held.has(lc(n)));
            const at = `${form}: ${phase.id} (death at ${death.row}${death.deployed ? ', deployed' : ''})`;
            let walked: LedgerEntry[] = [];
            try {
                walked = respawnCheck(rows, { phase, kept: keptAt[d]!, give, cannon, heal, target, lost });
            } catch (e) {
                refusals.push(`${at}: ${(e as Error).message}`);
            }
            for (const e of walked) if (FAILING.includes(e.verdict) || e.verdict === 'unknown') refusals.push(`${at}: ${e.row.row}: ${e.verdict}: ${e.notes.join('; ')}`);
            return { form, death, kept: keptAt[d]!, cannon: cannon.filter(c => c.count > 0).map(c => ({ item: c.item, count: c.count })), entries: walked };
        }),
    );

    const scope = { step: phase.id, family: 'mule' as const };
    const refused = (form: R8Form) => refusals.some(r => r.startsWith('both: ') || r.startsWith(`${form}: `));
    const pkg = refused('fixed') ? null : packageOf({ name: lc(phase.id), items: byId, scope });
    const topUpPackage = refused('topUp') ? null : packageOf({ name: lc(phase.id), items: topUp, scope });
    return { phase, scope, lines, byId, topUp, slots, kept, notNeeded, walks, refusals, package: pkg, topUpPackage };
}

// ------------------------------------------------------------------ CLI

function arg(argv: readonly string[], name: string): string | undefined {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
}

const unit = (k: KeptUnit) => `${k.name}${k.id !== undefined ? ` @${k.id}` : ''} (cost ${k.cost}${k.debug ? `, [${k.debug}]` : ', no config'}${k.worn ? ', worn' : ''})`;

export function main(argv: readonly string[]): number {
    const only = arg(argv, '--phase');
    const manifestPath = arg(argv, '--manifest');
    const o: R8Options = { ...(manifestPath ? { manifest: readFileSync(manifestPath, 'utf8') } : {}), keep: argv.includes('--protect-item') ? 4 : 3 };
    const phases = R8_PHASES.filter(p => !only || p.id === only);
    if (!phases.length) throw new Error(`no phase ${only} (${R8_PHASES.map(p => p.id).join(', ')})`);
    const out = phases.map(p => r8Package(p, o));
    if (argv.includes('--json')) {
        console.log(JSON.stringify(out.map(p => ({ id: p.phase.id, scope: p.scope, byId: p.byId, topUp: p.topUp, slots: p.slots, lines: p.lines, kept: p.kept, notNeeded: p.notNeeded, stageable: { fixed: p.package !== null, topUp: p.topUpPackage !== null }, walks: p.walks.map(w => ({ form: w.form, ...w.death, kept: w.kept, cannon: w.cannon, verdicts: w.entries.map(e => `${e.row.row} ${e.verdict} ${e.used}/${INVENTORY_SLOTS}`) })), refusals: p.refusals })), null, 2));
    } else {
        for (const p of out) {
            console.log(`\n=== ${p.phase.id}: ${p.phase.what}; resume at ${p.phase.resume}${p.phase.replay.length ? ` after replaying ${p.phase.replay.join(', ')}` : ''}; walk to ${p.phase.to} ===`);
            for (const w of p.walks) {
                console.log(`death at ${w.death.row}${w.death.deployed ? ' (cannon deployed)' : ''}: keeps ${w.kept.map(unit).join(', ') || 'nothing'}`);
                if (w.cannon.length) console.log(`  cannon re-supplied (${w.death.deployed ? 'waiting on the ground' : p.phase.cannonBy}): ${w.cannon.map(c => `${c.item} x${c.count}`).join(', ')}`);
            }
            console.log(`kept at every death point: ${p.kept.map(k => k.name).join(', ') || 'nothing'}`);
            console.log(`package (${p.slots} slots), item: need - kept = give [why]`);
            for (const l of p.lines) console.log(`  ${l.item}${l.id !== undefined ? ` @${l.id}` : ''} [${l.kind}]: ${l.need} - ${l.kept} = ${l.give}  (${l.why})`);
            console.log(`not carried (returned unused): ${p.notNeeded.join(', ') || '-'}`);
            console.log(`by id: ${JSON.stringify(p.byId)}`);
            console.log(`top-up: ${JSON.stringify(p.topUp)}`);
            for (const w of p.walks) console.log(`\nrespawn walk, ${w.form} form, death at ${w.death.row}${w.death.deployed ? ' (deployed)' : ''}:\n${render(w.entries)}`);
            if (p.refusals.length) console.log(`\nrefusals:\n  ${p.refusals.join('\n  ')}`);
            console.log(`\n${p.phase.id}: fixed form ${p.package ? 'stageable' : 'REFUSED'}; top-up form ${p.topUpPackage ? 'stageable' : 'REFUSED'}`);
        }
    }
    // A phase with neither form stageable fails the run.
    return out.some(p => !p.package && !p.topUpPackage) ? 1 : 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
