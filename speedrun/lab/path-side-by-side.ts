// The relay and the direct path probed in the same minutes (docs/speedrun/scripts/tickmanip-latency.ts
// twice, concurrently): <bot> through its lite runner and the SDK gateway, <second> on its own
// in-process client (speedrun/lib/direct.ts). Lab, through lab.sh, which runs <bot>'s runner:
//
//   NODE_TICKRATE=300 speedrun/lab/lab.sh <bot> speedrun/lab/path-side-by-side.ts:--second=<bot2>:--trials=60
//
// Elsewhere (the run host), with <bot>'s runner already up: bun speedrun/lab/path-side-by-side.ts <bot> --second=<bot2> --no-tele
// Prints both probes' full output, each line prefixed with its path, then one comparison line.
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..', '..');
const bot = process.argv[2];
const flag = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1];
const second = flag('second');
if (!bot || !second) throw new Error('usage: path-side-by-side.ts <bot> --second=<bot2> [--trials=60] [--no-tele]');
const pass = process.argv.slice(3).filter(a => a.startsWith('--trials=') || a === '--no-tele');
const probe = 'docs/speedrun/scripts/tickmanip-latency.ts';

async function run(path: 'relay' | 'direct', args: string[]): Promise<string[]> {
    const child = Bun.spawn([process.execPath, probe, ...args], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe', env: process.env });
    const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    await child.exited;
    const lines = `${out}${err}`.split('\n').filter(Boolean);
    for (const l of lines) console.log(`[${path}] ${l}`);
    return lines;
}

const [relay, direct] = await Promise.all([
    run('relay', [bot, '--path=relay', ...pass]),
    // The direct probe's own preconditions are about the demo's edge; the comparison wants the same minute regardless.
    run('direct', [bot, '--path=direct', `--bot=${second}`, '--edge=any', ...pass]),
]);
const onTime = (lines: string[]) => lines.map(l => /^on time (\d+)\/(\d+)/.exec(l)).find(Boolean);
const r = onTime(relay);
const d = onTime(direct);
console.log(`same minute: relay on time ${r ? `${r[1]}/${r[2]}` : '?'}, direct on time ${d ? `${d[1]}/${d[2]}` : '?'}`);
