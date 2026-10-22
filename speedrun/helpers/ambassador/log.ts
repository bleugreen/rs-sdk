#!/usr/bin/env bun
// The ambassador's record: every chat line it saw, every decision, every line it sent
// or held back, as JSONL under <root>/fleet-run/ambassador/ (one file per UTC day),
// plus state.json (the limiter's memory) and the MUTE kill-switch file. On the fleet
// host <root> is ~/rs-fleet; in a dev copy it is that copy.
//
// Read it:
//   bun speedrun/helpers/ambassador/log.ts [--follow] [--since 30m|2h|1d] [--date YYYY-MM-DD]
//                                          [--kinds seen,sent] [--json] [--dir DIR]
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
export const DEFAULT_LOG_DIR = join(ROOT, 'fleet-run', 'ambassador');

export type LogKind =
    | 'start'
    | 'stop'
    | 'seen'
    | 'decision'
    | 'sent'
    | 'blocked'
    | 'retry'
    | 'ratelimited'
    | 'stale'
    | 'muted'
    | 'injection'
    | 'model_switch'
    | 'error'
    | 'heartbeat';

export interface LogRecord {
    t: string;
    kind: LogKind;
    tick?: number;
    [key: string]: unknown;
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export class ChatLog {
    constructor(
        readonly dir: string = DEFAULT_LOG_DIR,
        private readonly now: () => number = Date.now
    ) {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    pathFor(date: string): string {
        return join(this.dir, `chat-${date}.jsonl`);
    }

    get mutePath(): string {
        return join(this.dir, 'MUTE');
    }

    get statePath(): string {
        return join(this.dir, 'state.json');
    }

    /** While this file exists the ambassador keeps listening and logging but sends nothing. */
    muted(): boolean {
        return existsSync(this.mutePath);
    }

    write(kind: LogKind, data: Record<string, unknown> = {}): LogRecord {
        const at = this.now();
        const record: LogRecord = { t: new Date(at).toISOString(), kind, ...data };
        appendFileSync(this.pathFor(day(at)), `${JSON.stringify(record)}\n`, { mode: 0o600 });
        return record;
    }

    loadState(): unknown {
        try {
            return JSON.parse(readFileSync(this.statePath, 'utf8'));
        } catch {
            return null;
        }
    }

    /** Temp file + rename, so a crash mid-write never leaves a torn state.json. */
    saveState(state: unknown): void {
        const tmp = `${this.statePath}.tmp`;
        writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
        renameSync(tmp, this.statePath);
    }
}

/** Records in [sinceMs, untilMs), across the daily files that window touches. */
export function readRecords(dir: string, sinceMs: number, untilMs: number = Date.now()): LogRecord[] {
    const out: LogRecord[] = [];
    for (let d = Date.parse(day(sinceMs)); d <= untilMs; d += 86_400_000) {
        const path = join(dir, `chat-${day(d)}.jsonl`);
        if (!existsSync(path)) continue;
        for (const line of readFileSync(path, 'utf8').split('\n')) {
            if (!line.trim()) continue;
            try {
                const r = JSON.parse(line) as LogRecord;
                const at = Date.parse(r.t);
                if (at >= sinceMs && at < untilMs) out.push(r);
            } catch {
                // a torn last line from a crash
            }
        }
    }
    return out;
}

/** '30m', '2h', '1d' or plain minutes. */
export function parseSpan(spec: string): number {
    const m = /^(\d+(?:\.\d+)?)\s*([smhd]?)$/.exec(spec.trim());
    if (!m) throw new Error(`bad span "${spec}": use e.g. 30m, 2h, 1d`);
    const unit = { s: 1000, m: 60_000, h: 3600_000, d: 86_400_000, '': 60_000 }[m[2] as 's' | 'm' | 'h' | 'd' | '']!;
    return Number(m[1]) * unit;
}

const q = (s: unknown) => JSON.stringify(String(s ?? ''));

/** One readable line per record, for people following the conversation. */
export function formatRecord(r: LogRecord): string {
    const time = r.t.slice(11, 19);
    const ch = r.channel === 'pm' ? 'PM ' : '';
    switch (r.kind) {
        case 'seen':
            return `${time}   ${ch}${r.sender}${r.ours ? ' (ours)' : ''}: ${r.text}`;
        case 'sent':
            return `${time} > ${ch}${r.to ? `@${r.to} ` : ''}${r.finalText || r.text}${r.ok === false ? `  [NOT SENT: ${r.message}]` : ''}${r.filtered ? ' [word-filtered]' : ''}`;
        case 'decision':
            return r.valid === false
                ? `${time} ? invalid model reply (${r.error})`
                : `${time} ? ${r.respond ? `reply ${ch}to ${r.to}: ${q(r.text)}` : 'no reply'}${r.injection ? ' [model: injection]' : ''} (${r.ms} ms)`;
        case 'blocked':
        case 'retry':
        case 'ratelimited':
        case 'stale':
        case 'muted':
            return `${time} x ${r.kind} ${r.reason ?? ''} ${r.text ? q(r.text) : ''}`.trimEnd();
        case 'injection':
            return `${time} ! injection (${r.source}) from ${r.sender}: ${(r.patterns as string[] | undefined)?.join(',') ?? r.reason ?? ''} ${q(r.text)}`;
        default: {
            const { t: _t, kind, ...rest } = r;
            return `${time} - ${kind} ${JSON.stringify(rest)}`;
        }
    }
}

function flag(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    if (i >= 0) return process.argv[i + 1];
    return process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main(): Promise<void> {
    const dir = flag('dir') ?? DEFAULT_LOG_DIR;
    const kinds = flag('kinds')?.split(',').map(s => s.trim()).filter(Boolean);
    const json = process.argv.includes('--json');
    const follow = process.argv.includes('--follow');
    const date = flag('date');
    const since = date ? Date.parse(`${date}T00:00:00Z`) : Date.now() - parseSpan(flag('since') ?? (follow ? '15m' : '1h'));
    const until = date ? since + 86_400_000 : Date.now() + 1;
    const show = (r: LogRecord) => {
        if (kinds && !kinds.includes(r.kind)) return;
        console.log(json ? JSON.stringify(r) : formatRecord(r));
    };
    for (const r of readRecords(dir, since, until)) show(r);
    if (!follow) return;
    let path = join(dir, `chat-${day(Date.now())}.jsonl`);
    let offset = existsSync(path) ? statSync(path).size : 0;
    let carry = '';
    for (;;) {
        await new Promise(r => setTimeout(r, 1000));
        const today = join(dir, `chat-${day(Date.now())}.jsonl`);
        if (today !== path) {
            path = today;
            offset = 0;
            carry = '';
        }
        if (!existsSync(path)) continue;
        const size = statSync(path).size;
        if (size <= offset) continue;
        const buf = readFileSync(path).subarray(offset, size).toString('utf8');
        offset = size;
        const lines = (carry + buf).split('\n');
        carry = lines.pop() ?? '';
        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                show(JSON.parse(line) as LogRecord);
            } catch {
                // partial line
            }
        }
    }
}

if (import.meta.main) await main();
