#!/usr/bin/env bun
// Precondition seams (rs/621): the scored chain exactly as run.ts builds it (runner/chain.ts buildChain
// on a run config and a STEP-MANIFEST), walked in order with a synthetic SCORED standing where the
// chain leaves it, each step's own `preconditions` evaluated there. `run.ts --dry-run` checks gates
// only; this asks the question a live step asks first. Pure: no login, no cue writes, no game.
//
// Where SCORED stands: a leg leaves it at its `dest` (a split leg's part a at the landing); a hand-off
// or cue step leaves it where it is; any other step ends on a tile the chain does not fix, so the
// steps after it are NOT EVALUATED until a leg fixes the position again.
// The rest of the state is lab/boundary.ts boundaryAt at that index: RUN-ORDER's levels, the quests
// before it, and the slot ledger's pack and worn set. A hand-off's partner is put in view; nearby NPCs
// and locs are empty, so a check on a live NPC or loc refuses here and is a synthetic-state limit,
// not a seam. A leg after a step is evaluated at its catalogue `start` (legs never check it).
//
//   bun speedrun/lab/precondition-seams.ts <run-config.json> <STEP-MANIFEST.md> <RUN-ORDER.md> [--json]

import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { BotWorldState, InventoryItem } from '../../sdk/types';
import { baseState } from '../lib/fake-sdk';
import { objPack } from '../lib/obj-pack';
import { isComplete } from '../lib/quests';
import { buildChain, type ChainStep, type CueSink, type RunConfig } from '../runner/chain';
import type { LegStep } from '../runner/legs';
import { RelogBudget } from '../runner/relog-budget';
import { loadRunConfig } from '../run';
import { boundaryAt, SKILLS, type Boundary, type StagedItem } from './boundary';

export type Tile = { x: number; z: number; level?: number; tol?: number };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** SEAM_LEVEL_FLOOR='{"agility":25}': a floor under boundaryAt's levels, to look past a level refusal to the checks behind it. */
const FLOOR: Record<string, number> = JSON.parse(process.env.SEAM_LEVEL_FLOOR ?? '{}');

function items(list: readonly StagedItem[]): InventoryItem[] {
    const ids = objPack().ids;
    return list.map((it, slot) => ({ slot, id: ids.get(it.obj) ?? -1, name: cap(it.name), count: it.n, optionsWithIndex: [] }) as unknown as InventoryItem);
}

/** SCORED at `at` holding what `b` stages. */
export function stateAt(at: Tile, b: Boundary, near: readonly string[] = []): BotWorldState {
    const hp = b.levels.hitpoints.level;
    const quests = Object.fromEntries(b.quests.map(q => [q.key, isComplete(q.key, q.value) ? 'complete' : 'in_progress']));
    const varps = { option_run: 1, ...Object.fromEntries(b.quests.map(q => [q.varp, q.value])) };
    return baseState({
        player: {
            name: 'SCORED', combatLevel: 3, hp, maxHp: hp, x: at.x, z: at.z, worldX: at.x, worldZ: at.z, level: at.level ?? 0,
            runEnergy: 100, runWeight: 0, animId: -1, spotanimId: -1, combat: { inCombat: false }, isDead: false, lifeId: 0,
        } as unknown as BotWorldState['player'],
        skills: SKILLS.map(name => {
            const level = Math.max(b.levels[name].level, FLOOR[name] ?? 0);
            return { name: cap(name), level, baseLevel: level, experience: 0 };
        }),
        inventory: items(b.inv),
        equipment: items(b.worn),
        quests,
        questPoints: b.qp,
        varps,
        nearbyPlayers: near.map((name, index) => ({ kind: 'player', index, name, combatLevel: 3, x: at.x, z: at.z, worldX: at.x, worldZ: at.z, distance: 1, reachable: true })),
    } as unknown as Partial<BotWorldState>);
}

const noCues: CueSink = { open: async () => {}, stop: () => {}, isOpen: () => false };

export interface SeamRow {
    i: number;
    id: string;
    kind: string;
    name: string;
    /** Where SCORED stands, and what put it there. */
    at: Tile | null;
    from: string;
    verdict: 'PASS' | 'REFUSE' | 'NOT EVALUATED';
    why: string;
    /** What the synthetic state could not stage (boundaryAt's unresolved). */
    unresolved: string[];
}

export function precondSeams(cfg: RunConfig, docs: { manifest: string; runOrder: string }): SeamRow[] {
    const chain = buildChain(cfg, { manifest: docs.manifest, cues: noCues, relogs: new RelogBudget(mkdtempSync(join(tmpdir(), 'seam-relog-'))) });
    const out: SeamRow[] = [];
    let here: Tile | null = { x: 3222, z: 3222, level: 0 };
    let from = 'S00 (Lumbridge spawn)';
    let mover = '';
    chain.forEach((s: ChainStep, i) => {
        const row = (verdict: SeamRow['verdict'], why: string, unresolved: string[] = []): SeamRow => ({ i, id: s.id, kind: s.kind, name: s.name, at: here, from, verdict, why, unresolved });
        if (here === null && s.kind === 'leg') {
            // A leg never asks for its start tile; it is evaluated at its catalogue start (the earlier step's assumed end).
            const a = (s as unknown as LegStep).def.start;
            here = { x: a.x, z: a.z, level: a.level ?? 0, tol: a.tol ?? 0 };
            from = `${s.id} start (assumed end of ${mover})`;
        }
        if (s.id === 'S00') out.push(row('NOT EVALUATED', 'the account start'));
        else if (here === null) out.push(row('NOT EVALUATED', `follows ${mover}, whose end tile the chain does not fix`));
        else {
            let b: Boundary | null = null;
            let r: true | string;
            try {
                b = boundaryAt(chain, i, docs);
                // A placed hand-off's partner stands on the tile (a live-world fact the synthetic state supplies).
                r = s.preconditions(stateAt(here, b, s.kind === 'handoff' ? Object.values(cfg.partners) : []), {});
            } catch (e) {
                r = `threw: ${e instanceof Error ? e.message : String(e)}`;
            }
            out.push(row(r === true ? 'PASS' : 'REFUSE', r === true ? '' : r, b?.unresolved ?? []));
        }
        if (s.kind === 'leg') {
            const d = (s as unknown as LegStep).def.dest;
            here = { x: d.x, z: d.z, level: d.level ?? 0, tol: d.tol ?? 0 };
            from = `${s.id} dest`;
        } else if (s.kind === 'step' || s.kind === 'missing' || s.kind === 'fallback') {
            here = null;
            mover = `${s.id} "${s.name}"`;
        }
    });
    return out;
}

if (import.meta.main) {
    const [cfgPath, manifestPath, runOrderPath] = process.argv.slice(2);
    if (!cfgPath || !manifestPath || !runOrderPath) throw new Error('usage: precondition-seams.ts <run-config.json> <STEP-MANIFEST.md> <RUN-ORDER.md> [--json]');
    // As run.ts loads it (cueDir resolved under a scratch run dir; RC_CUE_DIR left alone).
    const cfg = loadRunConfig(cfgPath, mkdtempSync(join(tmpdir(), 'seam-run-')), {}, false);
    const res = precondSeams(cfg, { manifest: readFileSync(manifestPath, 'utf8'), runOrder: readFileSync(runOrderPath, 'utf8') });
    if (process.argv.includes('--json')) console.log(JSON.stringify(res, null, 1));
    else for (const r of res) console.log([r.i, r.id, r.kind, r.name, r.at ? `${r.at.x},${r.at.z},${r.at.level ?? 0} tol ${r.at.tol ?? 0}` : '-', r.from, r.verdict, r.why].join(' | '));
}
