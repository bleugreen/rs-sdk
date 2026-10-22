import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

test('Ashburn uses private destination and pinned keys and fails closed without them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ashburn-test-'));
    try {
        const home = join(dir, 'home');
        const bin = join(dir, 'bin');
        const fleet = join(home, '.rs-fleet');
        mkdirSync(fleet, { recursive: true });
        mkdirSync(bin);
        writeFileSync(join(bin, 'ssh'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o700 });
        const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, PATH: bin + ':' + process.env.PATH };
        delete env.ASHBURN_HOST;
        const script = resolve(import.meta.dir, 'ashburn.sh');
        const run = (extra: NodeJS.ProcessEnv = {}) => spawnSync('bash', [script, 'true'], { env: { ...env, ...extra }, encoding: 'utf8' });
        expect(run().status).toBe(2);
        writeFileSync(join(fleet, 'ashburn-host'), 'ubuntu@run-host.example\n', { mode: 0o600 });
        expect(run().status).toBe(2);
        writeFileSync(join(fleet, 'known_hosts_ashburn'), 'run-host.example ssh-ed25519 test-key\n');
        writeFileSync(join(fleet, 'id_ed25519_ashburn'), 'test-only');
        const result = run();
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('ubuntu@run-host.example');
        expect(result.stdout).toContain('StrictHostKeyChecking=yes');
        expect(result.stdout).toContain('UserKnownHostsFile=' + join(fleet, 'known_hosts_ashburn'));
        expect(result.stdout).toContain('IdentitiesOnly=yes');
        const override = run({ ASHBURN_HOST: 'ubuntu@override.example' });
        expect(override.status).toBe(0);
        expect(override.stdout).toContain('ubuntu@override.example');
        for (const host of ['-bad', 'user@host\nother', 'user@host extra']) {
            const invalid = run({ ASHBURN_HOST: host });
            expect(invalid.status).toBe(2);
            expect(invalid.stdout).toBe('');
        }
        unlinkSync(join(fleet, 'ashburn-host'));
        expect(run().status).toBe(2);
        expect(run({ ASHBURN_HOST: 'ubuntu@override.example' }).status).toBe(0);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
