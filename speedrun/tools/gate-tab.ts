// The gate account's in-page probe on its own, off the attempt's clock, for an attempt whose login
// is placed against an outside cue and so runs with --gate-json and no --gate-bot (the Firemaking
// row: the account logs in about 101 ticks after the droppers' cue, which leaves no room for the
// harness's own gate tab before the login). It runs the harness's gateTabRead through the
// harness's host I/O, so the order on the recorded display is the one bracketAttempt keeps: the
// gate account logs in, probes, logs out (confirmed), the attempt account's bare window is staged,
// and only then is the gate's window closed (Chrome quits with its last window).
//
//   bun speedrun/tools/gate-tab.ts <gate env> [--trials=60] [--stage=<attempt env>] [--when=before|after]
//       [--json=<file>]
//
// --stage names the attempt account (before an attempt); leave it out for an after-probe, which
// must run only once the attempt has logged out and the recording has stopped (HARNESS.md).
// Exit 0 when gateTabProblems finds nothing, 3 when it finds a problem (the attempt must not start
// on this read), 2 on a usage error.

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { verdictText } from '../lib/hostgate';
import { gateTabProblems, gateTabRead, hostTabIO } from '../rehearse';

const argv = process.argv.slice(2);
const flag = (k: string) => argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const bot = argv.find(a => !a.startsWith('--'));
const trials = Number(flag('trials') ?? '60');
const when = flag('when') ?? 'before';
const stage = flag('stage');
const json = flag('json');
if (!bot || !Number.isInteger(trials) || trials < 1 || (when !== 'before' && when !== 'after') || (when === 'after' && stage)) {
    console.error('usage: bun speedrun/tools/gate-tab.ts <gate env> [--trials=60] [--stage=<attempt env>] [--when=before|after] [--json=<file>]');
    process.exit(2);
}

const dir = json ? dirname(json) : join(process.env.TMPDIR ?? '/tmp', 'speedrun');
mkdirSync(dir, { recursive: true });
const r = await gateTabRead(hostTabIO({ dir, prefix: `gate-tab-${Date.now()}` }), bot, trials, when, stage ? { stage } : {});
const problems = gateTabProblems(r);
if (json) writeFileSync(json, `${JSON.stringify({ ...r, problems, text: r.read ? verdictText(r.read.verdict) : null }, null, 2)}\n`);
console.log(`[gate-tab] ${r.account} ${r.label}: ${r.read ? verdictText(r.read.verdict) : `no read (${r.error ?? 'unknown'})`}`);
console.log(`[gate-tab] logout ${r.logout?.ok ? 'confirmed' : `NOT confirmed (${r.logout?.reason ?? 'not attempted'})`}; staged ${r.staged ? JSON.stringify(r.staged) : stage ? `NO (${r.stageError ?? 'no CDP'})` : '-'}; gate window ${r.tab ? JSON.stringify(r.tab) : `not closed (${r.tabError ?? 'no CDP or logout unconfirmed'})`}`);
for (const p of problems) console.log(`[gate-tab] PROBLEM: ${p}`);
process.exit(problems.length ? 3 : 0);
