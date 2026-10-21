// Lab measurement of the altar givers (speedrun/helpers/altar-giver.ts) against
// the stand-in receiver (altar-receiver.ts), launched with the run-machine
// launcher (standalone.ts) against the local lab engine. Through lab.sh, which
// starts the engine (its own lite runner and gateway are not used):
//
//   NODE_TICKRATE=300 LAB_RUNNERS=0 WEB_PORT=9470 WEB_MANAGEMENT_PORT=9471 HISCORES_WEB_PORT=9472 NODE_PORT=44170 AGENT_PORT=8470 \
//     speedrun/lab/lab.sh altarlab speedrun/lab/altar-givers.ts:--variant=tuned:--cycles=21
//
// Variants:
//   tuned                 givers log in first, receiver last (after they are ready), tuned schedule
//   tuned-receiver-first  the receiver logs in first: the givers are handled after it each tick
//   robust-receiver-first the same login order on the robust schedule
//   bank                  givers restock at the altar's bank (staff-made stock), so batches measure the round trip
// Options: --altar=air|body|nature (default air; air banks at Falador east, body at Edgeville),
//          --cycles=N (default 21), --givers=N (1-3, default 3), --essence=N (default 27),
//          --path=relay|direct|mixed (default relay): how the givers reach their clients; mixed
//          alternates by slot (slot 0 direct, slot 1 relay, slot 2 direct), so both paths give
//          turns in the same minutes. The stand-in receiver always uses the relay.
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..', '..');
const arg = (k: string, d: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const variant = arg('variant', 'tuned');
const cycles = Number(arg('cycles', '21'));
const n = Number(arg('givers', '3'));
const essence = Number(arg('essence', '27'));
const altar = arg('altar', 'air');
const path = arg('path', 'relay');
if (!['relay', 'direct', 'mixed'].includes(path)) throw new Error(`--path must be relay, direct or mixed (got ${path})`);
const giverPath = (slot: number) => (path === 'mixed' ? (slot % 2 === 0 ? 'direct' : 'relay') : path);
const webPort = process.env.WEB_PORT ?? '9300';

const base = mkdtempSync(join(tmpdir(), 'altar-lab-'));
const botsDir = join(base, 'bots');
const runDir = join(base, 'run');
const givers = ['cairn_h70', 'cairn_h71', 'cairn_h72'].slice(0, n);
const receiver = 'cairn_h75';
for (const account of [...givers, receiver]) {
    mkdirSync(join(botsDir, account), { recursive: true, mode: 0o700 });
    writeFileSync(
        join(botsDir, account, 'bot.env'),
        `BOT_USERNAME=${account}\nPASSWORD=${randomBytes(6).toString('hex')}\nSERVER=localhost:${webPort}\nSHOW_CHAT=false\nTELEMETRY=false\nPROFANITY_FILTER=false\n`,
        { mode: 0o600 }
    );
}

const receiverFirst = variant.endsWith('receiver-first');
const giverEntries = givers.map((account, slot) => ({
    account,
    role: 'altar-giver',
    path: giverPath(slot),
    options: { altar, slot, essence, restock: variant === 'bank' ? { kind: 'bank', labStock: true } : { kind: 'cheat' } }
}));
const receiverEntry = {
    account: receiver,
    role: 'altar-receiver',
    receiver: true,
    final: true,
    ...(receiverFirst ? {} : { after: 'ready' }),
    options: {
        altar,
        cycles,
        givers,
        schedule: variant.startsWith('robust') ? 'robust' : 'tuned',
        // Measure what the login order does rather than let the receiver correct for it.
        autoRobust: false,
        restock: { kind: 'cheat' }
    }
};
const config = {
    gatewayPort: Number(process.env.ALTAR_GW_PORT ?? 8475),
    botsDir,
    runDir,
    loginSpacingMs: 2000,
    accounts: receiverFirst ? [receiverEntry, ...giverEntries] : [...giverEntries, receiverEntry]
};
const configPath = join(base, 'launch.json');
writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log(`variant ${variant}, ${altar} altar: ${givers.length} givers (${givers.map((g, i) => `${g} ${giverPath(i)}`).join(', ')}), ${cycles} turns, run files in ${base}`);

const child = Bun.spawn([process.execPath, 'speedrun/helpers/standalone.ts', configPath], {
    cwd: ROOT,
    env: { ...process.env, HELPER_LAB_TELE: '1', RC_CUE_DIR: join(runDir, 'rc-cue') },
    stdout: 'inherit',
    stderr: 'inherit'
});
const killer = setTimeout(() => child.kill('SIGINT'), Number(process.env.ALTAR_LAB_TIMEOUT_MS ?? 20 * 60_000));
const code = await child.exited;
clearTimeout(killer);

// Per-giver turn outcomes from the role logs.
const logDir = join(runDir, 'logs');
for (const f of readdirSync(logDir).filter(f => f.endsWith('.role.log')).sort()) {
    const outcomes: Record<string, number> = {};
    for (const line of readFileSync(join(logDir, f), 'utf8').split('\n')) {
        const m = /"message":"turn".*?"outcome":"(\w[\w-]*)"/.exec(line);
        if (m) outcomes[m[1]!] = (outcomes[m[1]!] ?? 0) + 1;
    }
    const account = f.replace('.role.log', '');
    const slot = givers.indexOf(account);
    if (Object.keys(outcomes).length) console.log(`giver ${account}${slot >= 0 ? ` (${giverPath(slot)})` : ''} ${JSON.stringify(outcomes)}`);
}
process.exit(code);
