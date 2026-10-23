#!/usr/bin/env bun
/**
 * Polite /playerpositions sampler for the demo (public page, no login).
 *
 *   bun docs/speedrun/scripts/rival-positions-sample.ts --minutes 29 [--interval 60] --out FILE.jsonl.gz
 *
 * One GET every --interval seconds for --minutes minutes. Each sample is appended to FILE as its
 * own gzip member (a valid multi-member gzip), so a killed run keeps every finished sample:
 *   {"t": ISO time of the request, "n": players, "p": [[name, x, z, level], ...]}
 * Read it back with `gunzip -c FILE` or `rival-active.ts`. Build-slot scratch does not outlive a
 * batch on the executors, so a long watch runs as bounded chunks that each commit their file.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';

const BASE_URL = 'https://rs-sdk-demo.fly.dev';
const { values } = parseArgs({ options: { minutes: { type: 'string', default: '29' }, interval: { type: 'string', default: '60' }, out: { type: 'string' } } });
if (!values.out) throw new Error('--out FILE.jsonl.gz is required');
const out = values.out;
const intervalMs = Math.max(30, Number(values.interval)) * 1000;
const endAt = Date.now() + Number(values.minutes) * 60_000;
mkdirSync(dirname(out), { recursive: true });

let samples = 0;
let failures = 0;
while (Date.now() < endAt) {
    const started = Date.now();
    try {
        const res = await fetch(`${BASE_URL}/playerpositions`, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const players = (await res.json()) as { name: string; x: number; z: number; level: number }[];
        const line = JSON.stringify({ t: new Date(started).toISOString(), n: players.length, p: players.map(q => [q.name, q.x, q.z, q.level]) });
        appendFileSync(out, Bun.gzipSync(line + '\n'));
        samples++;
    } catch (err) {
        failures++;
        console.error(`${new Date().toISOString()} sample failed: ${err instanceof Error ? err.message : err}`);
    }
    const wait = intervalMs - (Date.now() - started);
    if (Date.now() + wait >= endAt) break;
    await Bun.sleep(Math.max(1000, wait));
}
console.log(`${samples} samples, ${failures} failures -> ${out}`);
