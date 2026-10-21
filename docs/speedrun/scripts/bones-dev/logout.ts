// Log ACCOUNT out through the dev gateway without closing its game connection.
// Only a fresh session.ts LOGOUT acknowledgement plus runner exit permits adoption.
//   bun docs/speedrun/scripts/bones-dev/logout.ts ACCOUNT RUNNER_PID
import { closeSync, fstatSync, openSync, readSync, readFileSync, statSync } from 'node:fs';
import { BotSDK } from '../../../../sdk/index';

type LogoutSdk = Pick<BotSDK, 'connect' | 'waitForCondition' | 'getState' | 'sendUseItem' | 'sendClickComponent'>;

/** Follow only bytes appended to this attempt's log, never an earlier session's logout. */
export function logoutEvidence(path: string, account: string): () => boolean {
    const initial = statSync(path);
    let offset = initial.size;
    let pending = '';
    let acknowledged = false;
    // A line already in progress at the boundary cannot be fresh evidence.
    const fd = openSync(path, 'r');
    let skipLine = false;
    try {
        const opened = fstatSync(fd);
        if (opened.dev !== initial.dev || opened.ino !== initial.ino || opened.size < offset) {
            throw new Error('lite log changed while capturing logout boundary');
        }
        const last = Buffer.alloc(1);
        if (offset > 0) {
            readSync(fd, last, 0, 1, offset - 1);
            skipLine = last[0] !== 10;
        }
    } finally { closeSync(fd); }

    return () => {
        const current = statSync(path);
        if (current.dev !== initial.dev || current.ino !== initial.ino || current.size < offset) {
            throw new Error('lite log replaced or truncated; logout unconfirmed');
        }
        const fd = openSync(path, 'r');
        try {
            const opened = fstatSync(fd);
            if (opened.dev !== initial.dev || opened.ino !== initial.ino || opened.size < current.size) {
                throw new Error('lite log replaced or truncated while reading');
            }
            const buffer = Buffer.alloc(64 * 1024);
            while (offset < current.size) {
                const count = readSync(fd, buffer, 0, Math.min(buffer.length, current.size - offset), offset);
                if (!count) throw new Error('lite log became unreadable');
                offset += count;
                pending += buffer.toString('utf8', 0, count);
                let newline: number;
                while ((newline = pending.indexOf('\n')) !== -1) {
                    const line = pending.slice(0, newline).trimEnd();
                    pending = pending.slice(newline + 1);
                    if (skipLine) { skipLine = false; continue; }
                    if (line.startsWith(`[lite-runner] '${account}' logged into `)) {
                        throw new Error('new login during logout attempt');
                    }
                    const prefix = `[lite] ${account}: session ended (`;
                    if (line.startsWith(prefix)) {
                        if (line !== prefix + 'logged-out)') throw new Error(`unclean session end: ${line}`);
                        acknowledged = true;
                    }
                    if (line.startsWith('[lite-runner] Game session ended (')
                        && line !== '[lite-runner] Game session ended (logged-out)') {
                        throw new Error(`unclean runner end: ${line}`);
                    }
                }
            }
        } finally { closeSync(fd); }
        return acknowledged;
    };
}

const FOOD = /^(shark|lobster|swordfish|tuna|salmon|trout|bass|pike)$/i;

export async function logout(sdk: LogoutSdk, options: {
    alive: () => boolean;
    evidence: () => boolean;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    timeoutMs?: number;
}): Promise<void> {
    const { alive, evidence } = options;
    const sleep = options.sleep ?? (ms => Bun.sleep(ms));
    const now = options.now ?? Date.now;
    const deadline = now() + (options.timeoutMs ?? 540_000);
    const finished = () => {
        // Read before testing the PID: the runner logs the acknowledgement before exiting.
        const acknowledged = evidence();
        if (!alive()) {
            if (!acknowledged) throw new Error('runner missing without fresh logout acknowledgement');
            return true;
        }
        return false;
    };
    if (!alive()) throw new Error('no live runner; logout unconfirmed');
    await sdk.connect();
    await sdk.waitForCondition(s => s.inGame, 30_000);
    let nextClick = 0;
    let nextEat = 0;
    while (now() < deadline) {
        if (finished()) return;
        // After the ack, do not send more input: wait only for this runner to exit.
        if (!evidence()) {
            const s = sdk.getState();
            if (!s?.inGame) throw new Error('client not in game; logout unconfirmed');
            const hp = s.skills.find(k => k.name === 'Hitpoints');
            if (hp && hp.level < hp.baseLevel * 0.5 && now() >= nextEat) {
                const food = s.inventory.find(it => FOOD.test(it.name) && it.optionsWithIndex.some(o => /^eat$/i.test(o.text)));
                const op = food?.optionsWithIndex.find(o => /^eat$/i.test(o.text));
                if (food && op) {
                    void sdk.sendUseItem(food.slot, op.opIndex).catch(() => {});
                    nextEat = now() + 3_000;
                }
            }
            if (!s.player?.combat?.inCombat && now() >= nextClick) {
                // Action acceptance is not LOGOUT evidence. The log remains authoritative.
                void sdk.sendClickComponent(2458).catch(() => {});
                nextClick = now() + 8_000;
            }
        }
        await sleep(200);
    }
    if (!finished()) throw new Error('timed out awaiting logout acknowledgement and runner exit');
}

if (import.meta.main) {
    const [account, runnerPid] = process.argv.slice(2);
    let sdk: BotSDK | undefined;
    try {
        if (!account || !/^[a-zA-Z0-9_-]+$/.test(account) || !runnerPid || !/^[1-9]\d*$/.test(runnerPid)) {
            throw new Error('usage: logout.ts ACCOUNT RUNNER_PID');
        }
        const alive = () => { try { process.kill(Number(runnerPid), 0); return true; } catch { return false; } };
        if (!alive()) throw new Error('no live runner; logout unconfirmed');
        const evidence = logoutEvidence(`logs/lite-${account}.log`, account);
        const env = Object.fromEntries(readFileSync(`bots/${account}/bot.env`, 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
        sdk = new BotSDK({ botUsername: account, password: env.PASSWORD!, gatewayUrl: `ws://127.0.0.1:${process.env.BONES_PORT ?? '7782'}`, connectionMode: 'control', autoReconnect: false, autoLaunchBrowser: false, showChat: false });
        await logout(sdk, { alive, evidence });
        console.log(`${account}: server-acknowledged logout and runner exit ${new Date().toISOString()}`);
    } catch (error) {
        console.error(`${account ?? 'account'}: logout unconfirmed; do not adopt into fleet`, error);
        process.exitCode = 1;
    } finally {
        // Control socket only: never signal or disconnect the lite game client.
        await sdk?.disconnect();
    }
}
