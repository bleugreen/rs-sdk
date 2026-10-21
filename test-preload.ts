// Keeps every test file's scratch space on tmpfs. Suites create throwaway SQLite
// databases (fsync on every commit), git repositories and compiled-script output
// under os.tmpdir(), and engine fixtures run as child processes that inherit
// TMPDIR. When TMPDIR is on a saturated disk, as on executors that point it at
// a build slot, each fsync and file creation waits on the device and a 2 s
// subprocess test takes a minute. Nothing in these tests needs durable storage.
//
// bun test --isolate runs this once per test file and restores process.env
// between files, so each file gets its own directory, removed by the global
// afterAll below. A run killed before then leaves its directory behind; the
// next run removes directories whose owning process has gone.
import { afterAll } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync, statfsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMPFS_MAGIC = 0x01021994;
const SHM = '/dev/shm';
const PREFIX = 'rs-sdk-test-';

function onTmpfs(path: string): boolean {
    try {
        return statfsSync(path).type === TMPFS_MAGIC;
    } catch {
        return false;
    }
}

function ownerAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code !== 'ESRCH';
    }
}

function removeAbandoned() {
    for (const name of readdirSync(SHM)) {
        if (!name.startsWith(PREFIX)) continue;
        const pid = Number(name.slice(PREFIX.length).split('-')[0]);
        if (Number.isInteger(pid) && pid > 0 && !ownerAlive(pid)) {
            rmSync(join(SHM, name), { recursive: true, force: true });
        }
    }
}

if (!onTmpfs(tmpdir()) && onTmpfs(SHM)) {
    try {
        removeAbandoned();
        const scratch = mkdtempSync(join(SHM, `${PREFIX}${process.pid}-`));
        process.env.TMPDIR = scratch;
        afterAll(() => rmSync(scratch, { recursive: true, force: true }));
    } catch {
        // /dev/shm is not writable here (a confined sandbox): keep the inherited TMPDIR.
    }
}
