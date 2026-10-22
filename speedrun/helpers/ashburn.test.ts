import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Every address here is a documentation address (RFC 5737) or an .example name;
// ssh and rsync are stubs that print their arguments, so nothing leaves the machine.
const SCRIPT = resolve(import.meta.dir, 'ashburn.sh');
const HOST_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBYCG1nNhhY0ax6lRCgxT6oxfNh4NW7mlLOdQeoWZ0wE';

let dir: string;
let fleet: string;
let tmp: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ashburn-test-'));
    const home = join(dir, 'home');
    const bin = join(dir, 'bin');
    fleet = join(home, '.rs-fleet');
    tmp = join(dir, 'tmp');
    mkdirSync(fleet, { recursive: true });
    mkdirSync(bin);
    mkdirSync(tmp);
    // The stub prints each argument, then the pinned known_hosts it was handed (it is gone after exit).
    const printer = (name: string) =>
        `#!/bin/sh\necho "[${name}]"\nprintf '%s\\n' "$@"\nfor a in "$@"; do case "$a" in *UserKnownHostsFile=*) f="\${a#*UserKnownHostsFile=}"; f="\${f%% *}"; echo "[pin]"; cat "$f";; esac; done\n`;
    writeFileSync(join(bin, 'ssh'), printer('ssh'), { mode: 0o700 });
    writeFileSync(join(bin, 'rsync'), printer('rsync'), { mode: 0o700 });
    env = { ...process.env, HOME: home, TMPDIR: tmp, PATH: `${bin}:${process.env.PATH}` };
    delete env.RS_RUN_HOST;
    delete env.RS_RUN_TAILNET;
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = (extra: NodeJS.ProcessEnv = {}, args = ['hostname']) =>
    spawnSync('bash', [SCRIPT, ...args], { env: { ...env, ...extra }, encoding: 'utf8' });

const pin = (stdout: string) => stdout.slice(stdout.indexOf('[pin]\n') + 6);

describe('ashburn.sh', () => {
    test('refuses to run without RS_RUN_HOST, naming the variable and the host thread', () => {
        for (const value of [undefined, '']) {
            const result = run(value === undefined ? {} : { RS_RUN_HOST: value });
            expect(result.status).toBe(2);
            expect(result.stdout).toBe('');
            expect(result.stderr.trim().split('\n')).toHaveLength(1);
            expect(result.stderr).toContain('RS_RUN_HOST');
            expect(result.stderr).toContain('cairn://p/rs/host');
        }
    });

    test('a bare address logs in as ubuntu and pins the host key for it', () => {
        const result = run({ RS_RUN_HOST: '203.0.113.10' }, ['hostname; uptime']);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('StrictHostKeyChecking=yes\n');
        expect(result.stdout).toContain('\nubuntu@203.0.113.10\nhostname; uptime\n');
        expect(pin(result.stdout)).toBe(`203.0.113.10 ${HOST_KEY}\n`);
    });

    test('user@address is used as given and the tailnet address joins the pin', () => {
        const result = run({ RS_RUN_HOST: 'admin@203.0.113.10', RS_RUN_TAILNET: '203.0.113.20' });
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('\nadmin@203.0.113.10\n');
        expect(pin(result.stdout)).toBe(`203.0.113.10,203.0.113.20 ${HOST_KEY}\n`);
    });

    test('falls back to the private ashburn-ip file, and the variable wins over it', () => {
        writeFileSync(join(fleet, 'ashburn-ip'), '  203.0.113.30\r\n', { mode: 0o600 });
        const fromFile = run();
        expect(fromFile.status).toBe(0);
        expect(fromFile.stdout).toContain('\nubuntu@203.0.113.30\n');
        const fromEnv = run({ RS_RUN_HOST: '203.0.113.10' });
        expect(fromEnv.stdout).toContain('\nubuntu@203.0.113.10\n');
        expect(fromEnv.stdout).not.toContain('203.0.113.30');
    });

    test("keeps the machine's own known_hosts beside the pin and uses its key", () => {
        writeFileSync(join(fleet, 'known_hosts_ashburn'), `old-host.example ${HOST_KEY}\n`);
        writeFileSync(join(fleet, 'id_ed25519_ashburn'), 'test-only');
        const result = run({ RS_RUN_HOST: '203.0.113.10' });
        expect(result.status).toBe(0);
        expect(result.stdout).toContain(`IdentitiesOnly=yes\n-i\n${join(fleet, 'id_ed25519_ashburn')}\n`);
        expect(pin(result.stdout)).toBe(`203.0.113.10 ${HOST_KEY}\nold-host.example ${HOST_KEY}\n`);
    });

    test('writes the pin to a fresh temporary file and removes it afterwards', () => {
        const victim = join(dir, 'victim');
        writeFileSync(victim, 'must not be overwritten');
        symlinkSync(victim, join(tmp, 'ashburn_known_hosts'));
        expect(run({ RS_RUN_HOST: '203.0.113.10' }).status).toBe(0);
        expect(readFileSync(victim, 'utf8')).toBe('must not be overwritten');
        expect(readdirSync(tmp)).toEqual(['ashburn_known_hosts']);
    });

    test('push rsyncs speedrun/ to the configured host', () => {
        const result = run({ RS_RUN_HOST: '203.0.113.10' }, ['push']);
        expect(result.status).toBe(0);
        expect(result.stdout).toStartWith('[rsync]\n');
        expect(result.stdout).toContain(`${resolve(import.meta.dir, '..')}/\nubuntu@203.0.113.10:rs-sdk/speedrun/\n`);
        expect(readdirSync(tmp)).toEqual([]);
    });

    test('rejects destinations that could become ssh options or extra arguments', () => {
        const bad: NodeJS.ProcessEnv[] = [
            { RS_RUN_HOST: '-oProxyCommand=true' },
            { RS_RUN_HOST: '-x@203.0.113.10' },
            { RS_RUN_HOST: 'ubuntu@-203.0.113.10' },
            { RS_RUN_HOST: 'ubuntu@203.0.113.10\nother' },
            { RS_RUN_HOST: 'ubuntu@203.0.113.10 extra' },
            { RS_RUN_HOST: '203.0.113.10', RS_RUN_TAILNET: '203.0.113.20 extra' },
            { RS_RUN_HOST: '203.0.113.10', RS_RUN_TAILNET: '203.0.113.20,evil.example' },
        ];
        for (const extra of bad) {
            const result = run(extra);
            expect(result.status).toBe(2);
            expect(result.stdout).toBe('');
        }
        writeFileSync(join(fleet, 'ashburn-ip'), '203.0.113.30 extra\n');
        expect(run().status).toBe(2);
        expect(readdirSync(tmp)).toEqual([]);
    });
});
