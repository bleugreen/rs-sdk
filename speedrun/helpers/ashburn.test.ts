import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

test('Ashburn pins a privately configured host even with an older known_hosts file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ashburn-test-'));
    try {
        const home = join(dir, 'home');
        const bin = join(dir, 'bin');
        mkdirSync(join(home, '.rs-fleet'), { recursive: true });
        mkdirSync(bin);
        writeFileSync(join(home, '.rs-fleet', 'known_hosts_ashburn'), 'old-host ssh-ed25519 old-key\n');
        writeFileSync(join(bin, 'ssh'), '#!/bin/sh\nprintf "%s\\n" "$@"\nfor arg in "$@"; do case "$arg" in UserKnownHostsFile=*) cat "${arg#*=}";; esac; done\n', { mode: 0o700 });
        const victim = join(dir, 'untouched');
        writeFileSync(victim, 'must not overwrite');
        symlinkSync(victim, join(dir, 'ashburn_known_hosts'));
        const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, TMPDIR: dir, PATH: bin + ':' + process.env.PATH };
        delete env.ASHBURN_HOST;
        env.RS_RUN_HOST = 'run-host.example';
        const script = resolve(import.meta.dir, 'ashburn.sh');
        const result = spawnSync('bash', [script, 'true'], { env, encoding: 'utf8' });
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('ubuntu@run-host.example');
        expect(result.stdout).toContain('StrictHostKeyChecking=yes');
        const pinned = result.stdout;
        expect(readFileSync(victim, 'utf8')).toBe('must not overwrite');
        expect(readdirSync(dir).filter(n => n.startsWith('ashburn_known_hosts.'))).toEqual([]);
        expect(pinned).toContain('run-host.example ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBYCG1nNhhY0ax6lRCgxT6oxfNh4NW7mlLOdQeoWZ0wE');
        expect(pinned).toContain('old-host ssh-ed25519 old-key');
        const override = spawnSync('bash', [script, 'true'], { env: { ...env, ASHBURN_HOST: 'ubuntu@test-host' }, encoding: 'utf8' });
        expect(override.status).toBe(0);
        expect(override.stdout).toContain('ubuntu@test-host');
        expect(override.stdout).toContain('test-host ssh-ed25519');
        for (const host of ['', '-bad', 'user@host\nother', 'user@host extra']) {
            const missing = spawnSync('bash', [script, 'true'], { env: { ...env, RS_RUN_HOST: '', ASHBURN_HOST: host }, encoding: 'utf8' });
            expect(missing.status).toBe(2);
            expect(missing.stdout).toBe('');
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
