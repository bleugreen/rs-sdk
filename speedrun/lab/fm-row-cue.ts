// Lab check of fm-row's `cueAt: 'written'` on a server whose tick is not the nominal one: the
// engine runs at NODE_TICKRATE (350 reproduces the demo's slow minutes) while the dropper is
// told a nominal tickMs of 300, as a dropper on the demo is. Through lab.sh, which starts the
// engine and both lite clients:
//
//   NODE_TICKRATE=350 LAB_HELPERS=rs274d speedrun/lab/lab.sh rs274w speedrun/lab/fm-row-cue.ts:--dropper=rs274d
//
// Options: --dropper, --late=30 (s from the go file to the dropper's start), --nominal=300,
//   --warm=25 (s the writer watches its ticks before writing), --watch=40 (s the dropper may run
//   after its cue), --writer-period (record the writer's observed period in the go file).
//
// The writer is the lab's own client. It writes the go file and records the tick it saw at
// every arrival time. Both clients get each server tick within a few ms, so the cue's true tick
// in the dropper's numbering is the dropper's seen tick less the writer's ticks from the go
// file to the moment the dropper saw it (its `cue` line's seenMs), to within a tick. Exit 0
// when the cue the dropper ends on is within 2 ticks of that.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { writeJsonAtomicSync } from '../helpers/altar-cue';
import { GO_FILE } from '../helpers/fm-row';
import { closeSession, openSession } from '../lib/session';
import { tickMs, TickPeriod } from '../lib/wait';
import { arg, botArg, result } from './common';

const ROOT = resolve(import.meta.dir, '..', '..');
const writer = botArg();
const dropper = arg('dropper', 'rs274d');
const late = Number(arg('late', '30'));
const nominal = Number(arg('nominal', '300'));
const warm = Number(arg('warm', '25'));
const watch = Number(arg('watch', '40'));
const writerPeriod = process.argv.includes('--writer-period');

const session = await openSession(writer, { pathfinding: false });
const frames: Array<{ tick: number; ms: number }> = [];
const period = new TickPeriod();
session.sdk.onStateUpdate(s => {
    if (frames.at(-1)?.tick !== s.tick) frames.push({ tick: s.tick, ms: Date.now() });
    period.see(s.tick, Date.now());
});
await Bun.sleep(warm * 1000);
const writerTickAt = (ms: number) => frames.findLast(f => f.ms <= ms)!.tick;

const dir = mkdtempSync(join(tmpdir(), 'fm-row-cue-lab-'));
const writtenMs = Date.now();
const writtenTick = writerTickAt(writtenMs);
const observedByWriter = period.msPerTick(20_000);
writeJsonAtomicSync(join(dir, GO_FILE), { v: 1, ms: writtenMs, ...(writerPeriod && observedByWriter !== null ? { tickMs: observedByWriter } : {}) });
console.log(`fm-row-cue lab: writer ${writer} wrote the go file at its tick ${writtenTick} (observed ${observedByWriter?.toFixed(1)} ms/tick); dropper ${dropper} starts in ${late} s with nominal ${nominal} ms`);
await Bun.sleep(late * 1000);

interface Line {
    message?: string;
    seenTick?: number;
    seenMs?: number;
    cueTick?: number;
    tickMs?: number;
    tickMsFrom?: string;
    [k: string]: unknown;
}
const options = { start: 'cue', cueAt: 'written', tickMs: nominal, cueDir: dir, restock: { kind: 'cheat' } };
const role = Bun.spawn([process.execPath, 'speedrun/helpers/fm-row.ts', dropper], {
    cwd: ROOT,
    env: { ...process.env, ROLE_OPTIONS: JSON.stringify(options), HELPER_LAB_TELE: '1' },
    stdout: 'pipe',
    stderr: 'inherit'
});
const cues: Line[] = [];
let cueAt = 0;
const done = (async () => {
    const decoder = new TextDecoder();
    let buf = '';
    const reader = role.stdout.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buf += decoder.decode(value, { stream: true });
        for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) {
            const text = buf.slice(0, i).trim();
            if (!text.startsWith('{')) continue;
            const line = JSON.parse(text) as Line;
            if (line.message !== 'drop') console.log(`dropper ${text}`);
            if (line.message === 'cue' || line.message === 'cue: refined') {
                cues.push(line);
                cueAt ||= Date.now();
                if (line.tickMsFrom === 'observed') return;
            }
        }
    }
})();
const deadline = Date.now() + 180_000;
while (Date.now() < deadline && (cueAt === 0 || Date.now() - cueAt < watch * 1000)) {
    if ((await Promise.race([done.then(() => true), Bun.sleep(500).then(() => false)])) === true) break;
}
role.kill('SIGTERM');
await Promise.race([role.exited, Bun.sleep(10_000)]);
await closeSession(session);

const first = cues[0];
if (!first?.seenMs || first.seenTick === undefined) {
    result('fm-row-cue', { error: 'the dropper logged no cue', cues });
    process.exit(1);
}
const trueElapsed = writerTickAt(first.seenMs) - writtenTick;
const trueCue = first.seenTick - trueElapsed;
const placed = (l: Line) => ({ cueTick: l.cueTick, tickMs: l.tickMs, from: l.tickMsFrom, off: l.cueTick! - trueCue });
const last = cues.at(-1)!;
result('fm-row-cue', {
    engineTickMs: tickMs(),
    nominal,
    writerObservedTickMs: observedByWriter === null ? null : Math.round(observedByWriter * 10) / 10,
    secondsFromGoToSeen: (first.seenMs - writtenMs) / 1000,
    trueTicksFromGoToSeen: trueElapsed,
    trueCueTick: trueCue,
    atNominalOff: first.seenTick - Math.round((first.seenMs - writtenMs) / nominal) - trueCue,
    placements: cues.map(placed)
});
process.exit(Math.abs(last.cueTick! - trueCue) <= 2 ? 0 : 1);
