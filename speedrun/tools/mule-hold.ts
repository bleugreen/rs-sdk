#!/usr/bin/env bun
// The initial hold on a banked delivery carrier (runner/delivery-owner.ts holdCarrier), run by the run
// host BEFORE the helper launcher starts the carrier: a running carrier with no control file stages
// its first row at once, and a hold written after that never passes heldFor. The hold keeps it
// logged in, stationary and unstaged until run.ts's own prepare for that row.
//
//   bun speedrun/tools/mule-hold.ts --config <launcher config json> --account <carrier>
//
// Everything is read from the carrier's generated entry (helpers/mule-ledger.ts): the run id
// (options.deliveryRun), the receiver (options.serve), the cue directory (the entry's cueDir, else
// options.cueDir) and the first row and its meeting tile (the first package not served on request).
// A repeat of the same hold is a no-op; a hold after this run's prepare, or over another run's live
// control, is refused (mule-readiness.ts holdMule). Exit 0 held, 1 refused, 2 usage.

import { readFileSync } from 'fs';
import { canonName } from '../helpers/altar-cue';
import { holdCarrier } from '../runner/delivery-owner';
import { worldTile } from '../helpers/mule-readiness';

function arg(argv: readonly string[], name: string): string | undefined {
    const i = argv.indexOf(name);
    const v = i >= 0 ? argv[i + 1] : undefined;
    return v && !v.startsWith('--') ? v : undefined;
}

interface Entry {
    account?: string;
    cueDir?: string;
    options?: { deliveryRun?: unknown; serve?: unknown; cueDir?: unknown; packages?: { onRequest?: boolean; at?: unknown; scope?: { step?: unknown; family?: unknown } }[] };
}

/** The hold's inputs from a launcher config's carrier entry, or why there are none. */
export function holdInputs(config: unknown, account: string): { dir: string; runId: string; account: string; row: string; receiver: string; at: ReturnType<typeof worldTile> } | { refusal: string } {
    const accounts = (config as { accounts?: Entry[] } | null)?.accounts;
    if (!Array.isArray(accounts)) return { refusal: 'the launcher config has no accounts list' };
    const entry = accounts.find(a => typeof a?.account === 'string' && canonName(a.account) === canonName(account));
    if (!entry) return { refusal: `${account} is not in the launcher config` };
    const o = entry.options ?? {};
    if (typeof o.deliveryRun !== 'string') return { refusal: `${account} runs no deliveryRun: only a banked delivery carrier is held` };
    if (typeof o.serve !== 'string' || !o.serve.trim()) return { refusal: `${account} names no serve receiver` };
    const dir = typeof entry.cueDir === 'string' ? entry.cueDir : o.cueDir;
    if (typeof dir !== 'string') return { refusal: `${account} names no cue directory` };
    const first = (o.packages ?? []).find(p => p && !p.onRequest);
    if (!first || typeof first.scope?.step !== 'string' || first.scope.family !== 'mule') return { refusal: `${account} has no ordered delivery package` };
    try {
        return { dir, runId: o.deliveryRun, account: entry.account!, row: first.scope.step, receiver: o.serve, at: worldTile(first.at, `${first.scope.step} at`) };
    } catch (e) {
        return { refusal: (e as Error).message };
    }
}

export function main(argv: readonly string[]): number {
    const path = arg(argv, '--config');
    const account = arg(argv, '--account');
    if (!path || !account) {
        console.error('usage: bun speedrun/tools/mule-hold.ts --config <launcher config json> --account <carrier>');
        return 2;
    }
    const inputs = holdInputs(JSON.parse(readFileSync(path, 'utf8')), account);
    if ('refusal' in inputs) {
        console.error(`[mule-hold] REFUSED: ${inputs.refusal}`);
        return 1;
    }
    try {
        const { dir, ...hold } = inputs;
        const h = holdCarrier(dir, hold);
        console.log(`[mule-hold] held ${h.account} on ${h.row} for run ${h.runId} (attempt ${h.attempt}, seq ${h.seq}) in ${dir}`);
        return 0;
    } catch (e) {
        console.error(`[mule-hold] REFUSED: ${(e as Error).message}`);
        return 1;
    }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
