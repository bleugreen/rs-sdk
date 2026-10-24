// The attempt record: what this attempt has completed where the game state alone cannot show it,
// for the resume walk (runner/resume.ts). One file, <run dir>/attempt-record.json beside relogs.json,
// holding two kinds of mark:
// - a hand-off row (`H14`): runner/handoff.ts marks it once the post-hand-off state shows; the
//   hand-off's own `done`, chain.ts's rollbackWitnesses (`until`) and the rune census's `served`
//   read it (handoff.ts, Resume);
// - a step name (`S16:F-guardian`, the Step's `name` as runSteps runs it): runner/step.ts runSteps
//   marks it once the step's postconditions pass, whether the step was entered through `run` or
//   through `resume`; a milestone that leaves no lasting game fact reads it in `done` through
//   `Observed.record` (the Mage Arena's segments, whose cape and staff S16's exit drops).
// The two kinds are kept apart, so a step name can never answer for a ledger row.
//
// Entries are keyed by the attempt (run.ts attemptOf: the run id of its tick log's first row, the
// same in every process that resumes it), so a fresh attempt sees none and nothing has to clear the
// file. Every read checks the file on disk, so a resumed process sees what an earlier one marked;
// a read that finds it unchanged (inode, size, mtime) reuses the last parse, so a walk asking once
// per milestone parses it once. Entries are only ever added, so every write changes the size.
//
// A missing or empty file is nothing recorded. A file that does not parse refuses: a record that
// cannot be read must not pass for an empty one, which would send the walk back over work done.

import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

export const ATTEMPT_RECORD_FILE = 'attempt-record.json';

export type MarkKind = 'handoff' | 'step';

export interface RecordEntry {
    /** The attempt (run.ts attemptOf). */
    attempt: string;
    kind: MarkKind;
    /** The ledger row (`H14`) or the step name (`S16:F-guardian`). */
    key: string;
    /** The client tick the mark was made at (-1: none). */
    tick: number;
    at: string;
}

/** One kind of mark in this attempt: `has` reads it, `mark` records it (once). */
export interface Marks {
    has(key: string): boolean;
    mark(key: string, tick: number): void;
}

interface Parsed {
    /** inode, size and mtime of the file the entries were read from. */
    sig: string;
    entries: RecordEntry[];
    /** This attempt's marks, `kind\0key`. */
    mine: Set<string>;
}

const slot = (kind: MarkKind, key: string) => `${kind}\0${key}`;

export class AttemptRecord {
    readonly file: string;
    /** The hand-off rows this attempt completed (runner/handoff.ts). */
    readonly handOffs: Marks;
    /** The steps whose postconditions passed in this attempt (runner/step.ts runSteps; `Observed.record`). */
    readonly steps: Marks;
    private parsed: Parsed | null = null;

    constructor(readonly dir: string, readonly attempt: string, private readonly pid: number = process.pid) {
        this.file = join(dir, ATTEMPT_RECORD_FILE);
        this.handOffs = this.marks('handoff');
        this.steps = this.marks('step');
    }

    entries(): RecordEntry[] {
        return this.read().entries;
    }

    has(kind: MarkKind, key: string): boolean {
        return this.read().mine.has(slot(kind, key));
    }

    /** Record `key` in this attempt (once). */
    mark(kind: MarkKind, key: string, tick: number): void {
        if (this.has(kind, key)) return;
        const entries: RecordEntry[] = [...this.entries(), { attempt: this.attempt, kind, key, tick, at: new Date().toISOString() }];
        mkdirSync(this.dir, { recursive: true });
        const tmp = `${this.file}.${this.pid}.tmp`;
        writeFileSync(tmp, JSON.stringify({ v: 1, entries }, null, 2) + '\n', { mode: 0o600 });
        renameSync(tmp, this.file);
        this.parsed = null;
    }

    private marks(kind: MarkKind): Marks {
        return { has: key => this.has(kind, key), mark: (key, tick) => this.mark(kind, key, tick) };
    }

    private read(): Parsed {
        let sig: string;
        try {
            const st = statSync(this.file);
            sig = `${st.ino}:${st.size}:${st.mtimeMs}`;
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
            this.parsed = null;
            return { sig: '', entries: [], mine: new Set() };
        }
        if (this.parsed?.sig === sig) return this.parsed;
        const entries = parseRecord(readFileSync(this.file, 'utf8'), this.file);
        const mine = new Set(entries.filter(e => e.attempt === this.attempt).map(e => slot(e.kind, e.key)));
        this.parsed = { sig, entries, mine };
        return this.parsed;
    }
}

/** The entries of a record file's text: none for an empty file; throws when it does not parse. */
export function parseRecord(text: string, file: string): RecordEntry[] {
    if (!text.trim()) return [];
    let f: unknown;
    try {
        f = JSON.parse(text);
    } catch {
        throw new Error(`${file} does not parse: fix or remove it before the run goes on`);
    }
    const entries = f && typeof f === 'object' ? (f as { entries?: unknown }).entries : undefined;
    return Array.isArray(entries) ? (entries as RecordEntry[]) : [];
}
