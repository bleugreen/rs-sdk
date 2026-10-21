import { afterEach, describe, expect, mock, test } from 'bun:test';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logout, logoutEvidence } from '../../docs/speedrun/scripts/bones-dev/logout';
import { baseState } from '../lib/fake-sdk';

const account = 'cairn_h51';
const ack = '[lite] cairn_h51: session ended (logged-out) \n';
const directories: string[] = [];
function scratch() {
    const path = mkdtempSync(join(tmpdir(), 'bones-handover-'));
    directories.push(path);
    return path;
}
afterEach(() => {
    for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});
function log(initial = '') {
    const path = join(scratch(), 'lite.log');
    writeFileSync(path, initial);
    return { path, evidence: logoutEvidence(path, account), append: (text: string) => appendFileSync(path, text) };
}

describe('fresh lite logout evidence', () => {
    test('requires a complete new account-specific acknowledgement', () => {
        const f = log(ack);
        expect(f.evidence()).toBe(false);
        f.append('[lite] cairn_h52: session ended (logged-out)\n');
        f.append('[lite-runner] Game session ended (logged-out)\n');
        expect(f.evidence()).toBe(false);
        f.append(ack.trimEnd());
        expect(f.evidence()).toBe(false);
        f.append('\n');
        expect(f.evidence()).toBe(true);
    });

    test('does not accept a pre-existing partial logout line completed later', () => {
        const f = log(ack.trimEnd());
        f.append('\n');
        expect(f.evidence()).toBe(false);
        f.append(ack);
        expect(f.evidence()).toBe(true);
    });

    for (const reason of ['disconnected', 'idle', 'error', 'stopped']) {
        test('rejects session end ' + reason + ' even following an acknowledgement', () => {
            const f = log();
            f.append(ack + '[lite-runner] Game session ended (' + reason + ')\n');
            expect(f.evidence).toThrow('unclean runner end');
        });
    }

    test('rejects an account-specific disconnect and a replacement login', () => {
        const f = log();
        f.append('[lite] cairn_h51: session ended (disconnected)\n');
        expect(f.evidence).toThrow('unclean session end');
        const g = log();
        g.append(ack + "[lite-runner] 'cairn_h51' logged into localhost\n");
        expect(g.evidence).toThrow('new login');
    });

    test('fails closed for missing, truncated and rotated logs', () => {
        const f = log('a previous session with enough bytes\n');
        writeFileSync(f.path, '');
        expect(f.evidence).toThrow('truncated');
        const g = log();
        renameSync(g.path, g.path + '.old');
        writeFileSync(g.path, ack);
        expect(g.evidence).toThrow('replaced');
        const h = log();
        rmSync(h.path);
        expect(h.evidence).toThrow();
        expect(() => logoutEvidence(h.path, account)).toThrow();
    });
});

function attempt(initial = '') {
    const f = log(initial);
    let live = true;
    let time = 0;
    let step = () => {};
    const state = baseState();
    const sdk = {
        connect: mock(async () => {}),
        waitForCondition: mock(async () => state),
        getState: () => state,
        sendUseItem: mock(async () => ({ success: true, message: 'ok' })),
        sendClickComponent: mock(async (_component: number) => ({ success: true, message: 'ok' })),
    };
    return {
        ...f, sdk, state,
        exit: () => { live = false; },
        step: (fn: () => void) => { step = fn; },
        run: () => logout(sdk, {
            alive: () => live, evidence: f.evidence, timeoutMs: 1_000,
            now: () => time, sleep: async ms => { time += ms; step(); },
        }),
    };
}

describe('logout controller', () => {
    test('succeeds only after fresh acknowledgement and runner exit', async () => {
        const h = attempt(ack);
        let polls = 0;
        h.step(() => {
            polls++;
            if (polls === 1) { h.append(ack); h.state.inGame = false; }
            if (polls === 3) h.exit();
        });
        await h.run();
        expect(polls).toBe(3);
        expect(h.sdk.sendClickComponent.mock.calls).toEqual([[2458]]);
    });

    test('rejects an already-missing client, including reconnect backoff with old ack', async () => {
        const h = attempt(ack);
        h.exit();
        await expect(h.run()).rejects.toThrow('no live runner');
        expect(h.sdk.connect).not.toHaveBeenCalled();
    });

    for (const previous of ['', ack]) {
        test('runner crash is not logout, with ' + (previous ? 'stale ack' : 'no ack'), async () => {
            const h = attempt(previous);
            h.step(h.exit);
            await expect(h.run()).rejects.toThrow('without fresh logout acknowledgement');
        });
    }

    for (const reason of ['disconnected', 'idle', 'error']) {
        test('rejects ' + reason + ' while logging out', async () => {
            const h = attempt(ack);
            h.step(() => {
                h.append('[lite] cairn_h51: session ended (' + reason + ')\n');
                h.exit();
            });
            await expect(h.run()).rejects.toThrow('unclean session end');
        });
    }

    test('rejects a missing in-game client without sending input', async () => {
        const h = attempt();
        h.state.inGame = false;
        await expect(h.run()).rejects.toThrow('client not in game');
        expect(h.sdk.sendClickComponent).not.toHaveBeenCalled();
    });

    test('initial connection or state failure cannot become success', async () => {
        const h = attempt();
        h.sdk.connect.mockImplementation(async () => { throw new Error('gateway disconnected'); });
        await expect(h.run()).rejects.toThrow('gateway disconnected');
        const g = attempt();
        g.sdk.waitForCondition.mockImplementation(async () => { throw new Error('no client'); });
        await expect(g.run()).rejects.toThrow('no client');
        expect(g.sdk.sendClickComponent).not.toHaveBeenCalled();
    });

    test('acknowledgement without runner exit is insufficient', async () => {
        const h = attempt();
        h.step(() => h.append(ack));
        await expect(h.run()).rejects.toThrow('timed out');
        expect(h.sdk.sendClickComponent).toHaveBeenCalledTimes(1);
    });

    test('action acceptance without acknowledgement is insufficient', async () => {
        const h = attempt();
        await expect(h.run()).rejects.toThrow('timed out');
    });
});

// Source the real shell script with all process controls replaced by functions.
// No PID queried here belongs to a real process; no game/gateway is launched.
const stopScript = fileURLToPath(new URL('../../docs/speedrun/scripts/bones-dev/stop.sh', import.meta.url));
const shell = `
kill() {
  echo "kill $*" >> "$BONES_DEV/calls"
  if [ "$1" = "-0" ]; then
    [ "$2" = 424242 ] && [ -e "$BONES_DEV/live" ]
  elif [ "$1" = "-INT" ] && [ "$2" = 424243 ]; then
    return 0
  else
    echo "unexpected signal $*" >&2; return 90
  fi
}
ps() {
  case "$*" in
    *424242) echo "$RUNNER_COMMAND" ;;
    *424243) echo "bun gateway.ts" ;;
  esac
}
sleep() { :; }
timeout() {
  echo "logout $*" >> "$BONES_DEV/calls"
  [ "$LOGOUT_RESULT" = success ] || return 1
  if [ "$KEEP_LIVE" != yes ]; then
    rm -f "$BONES_DEV/live" "$BONES_DEV/run/cairn_h51.runner.pid"
  fi
  if [ "$KEEP_LOOPS" != yes ]; then
    rm -f "$BONES_DEV/run/cairn_h51.liteloop.pid"
  fi
}
tmux() { echo "tmux $*" >> "$BONES_DEV/calls"; }
source "$STOP_SCRIPT" "$@"
`;
async function stop(options: { missing?: boolean; noPid?: boolean; result?: string; keepLive?: boolean; keepLoops?: boolean; command?: string; pid?: string; accounts?: string[] } = {}) {
    const root = scratch();
    mkdirSync(join(root, 'run'));
    mkdirSync(join(root, 'logs'));
    writeFileSync(join(root, 'calls'), '');
    writeFileSync(join(root, 'logs/lite-cairn_h51.log'), ack);
    writeFileSync(join(root, 'run/cairn_h51.liteloop.pid'), '424244');
    writeFileSync(join(root, 'run/gateway.pid'), '424243');
    if (!options.noPid) writeFileSync(join(root, 'run/cairn_h51.runner.pid'), options.pid ?? '424242');
    if (!options.missing) writeFileSync(join(root, 'live'), '');
    const proc = Bun.spawn(['bash', '--noprofile', '--norc', '-c', shell, 'harness', ...(options.accounts ?? [account])], {
        env: { ...process.env, BONES_DEV: root, STOP_SCRIPT: stopScript, LOGOUT_RESULT: options.result ?? 'success',
            BONES_TMUX: 'rs41-babyblue', KEEP_LIVE: options.keepLive ? 'yes' : 'no', KEEP_LOOPS: options.keepLoops ? 'yes' : 'no',
            RUNNER_COMMAND: options.command ?? 'bun src/lite/runner.ts cairn_h51' },
        stdout: 'pipe', stderr: 'pipe',
    });
    const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { root, code, output: stdout + stderr, calls: readFileSync(join(root, 'calls'), 'utf8') };
}

describe('stop.sh adoption gate (mocked process controls)', () => {
    test('confirmed logout followed by exit permits gateway teardown', async () => {
        const result = await stop();
        expect(result.code).toBe(0);
        expect(result.output).toContain('clean logout verified');
        expect(result.calls).toContain('logout 600');
        expect(result.calls).toContain('kill -INT 424243');
        expect(result.calls).toContain('tmux -L rs41-babyblue kill-server');
        expect(result.calls).not.toContain('kill -INT 424242');
    });

    for (const options of [{ missing: true }, { noPid: true }, { pid: '-1' }, { command: 'bun unrelated.ts' }]) {
        test('missing/unverified runner fails closed despite old ack: ' + JSON.stringify(options), async () => {
            const result = await stop(options);
            expect(result.code).not.toBe(0);
            expect(result.output).toContain('logout unconfirmed');
            expect(result.calls).not.toContain('logout 600');
            expect(result.calls).not.toContain('kill -INT');
            expect(result.calls).not.toContain('tmux');
            expect(existsSync(join(result.root, 'run/gateway.pid'))).toBe(true);
        });
    }

    test('unconfirmed logout leaves a live client and gateway untouched', async () => {
        const result = await stop({ result: 'failure' });
        expect(result.code).not.toBe(0);
        expect(result.output).toContain('do not adopt');
        expect(existsSync(join(result.root, 'live'))).toBe(true);
        expect(result.calls).not.toContain('kill -INT');
        expect(result.calls).not.toContain('tmux');
    });

    for (const options of [{ keepLive: true }, { keepLoops: true }]) {
        test('requires runner and loops to finish: ' + JSON.stringify(options), async () => {
            const result = await stop(options);
            expect(result.code).not.toBe(0);
            expect(result.calls).not.toContain('kill -INT');
            expect(result.calls).not.toContain('tmux');
        });
    }

    test('partial cohort success is explicit but does not authorize overall adoption', async () => {
        const result = await stop({ accounts: ['cairn_h51', 'cairn_h52'] });
        expect(result.code).not.toBe(0);
        expect(result.output).toContain('cairn_h51: clean logout verified');
        expect(result.output).toContain('cairn_h52: no verified live runner');
        expect(result.output).toContain('retry only remaining accounts');
        expect(result.calls).not.toContain('tmux');
    });
});
