// Lab measurement of the S07 bone giver (speedrun/helpers/bone-giver.ts) against
// the stand-in receiver cairn_h75 (bone-receiver.ts), both launched by the
// run-machine launcher (standalone.ts) against the local lab engine. Through
// lab.sh, which starts the engine (its own runners and gateway are not used):
//
//   NODE_TICKRATE=300 LAB_RUNNERS=0 WEB_PORT=9480 WEB_MANAGEMENT_PORT=9481 HISCORES_WEB_PORT=9482 NODE_PORT=44180 AGENT_PORT=8480 \
//     speedrun/lab/lab.sh bonelab speedrun/lab/bone-giver.ts:--loads=10
//
// Options: --asks=15,21,... (S18 on-request top-ups of those sizes), --loads=N (default 10), --pages=2,5 (loads followed by a held level-up page), --hold=6,
//   --order=giver-first (default, the run's order) | receiver-first,
//   --givers=N: N givers (cairn_h70, h71, ...) taking turns as one group (bone-giver.ts group, S07's b01-b04),
//   the stand-in taking each load from the group's server (boneServer),
//   --final=N (with --givers): giver N (0-based) carries S07's last-load runes (finalExtras: law 1, air 5) and must
//   be the one that serves the group's last load, which the stand-in takes with the runes,
//   --mix=D,B: every giver serves S07's priority list (Dragon bones, then Babydragon bones) from its own Falador
//   west bank, seeded once with D dragon and B babydragon (restock.labSeed), every withdrawal a real one
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..', '..');
const arg = (k: string, d: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const loads = Number(arg('loads', '10'));
const pages = arg('pages', '2,5').split(',').filter(Boolean).map(Number);
const hold = Number(arg('hold', '6'));
// --asks=15,21,17: S18's top-ups (the giver in mode on-request) instead of S07's standing loads.
const asks = arg('asks', '').split(',').filter(Boolean).map(Number);
const webPort = process.env.WEB_PORT ?? '9300';

const base = mkdtempSync(join(tmpdir(), 'bone-lab-'));
const botsDir = join(base, 'bots');
const runDir = join(base, 'run');
const nGivers = Number(arg('givers', '1'));
if (!Number.isInteger(nGivers) || nGivers < 1 || nGivers > 4) throw new Error('--givers must be 1-4');
const givers = Array.from({ length: nGivers }, (_, i) => `cairn_h7${i}`);
const giver = givers[0]!;
const receiver = 'cairn_h75';
for (const account of [...givers, receiver]) {
    mkdirSync(join(botsDir, account), { recursive: true, mode: 0o700 });
    writeFileSync(
        join(botsDir, account, 'bot.env'),
        `BOT_USERNAME=${account}\nPASSWORD=${randomBytes(6).toString('hex')}\nSERVER=localhost:${webPort}\nSHOW_CHAT=false\nTELEMETRY=false\nPROFANITY_FILTER=false\n`,
        { mode: 0o600 }
    );
}

const config = {
    gatewayPort: Number(process.env.BONE_GW_PORT ?? 8485),
    botsDir,
    runDir,
    loginSpacingMs: 2000,
    // Login order decides who the engine handles first each tick. On the run every helper is in
    // before the scored account (SUPPLIES.md section 5); --order=receiver-first measures the reverse.
    accounts: (() => {
        const sites = [{ giver: { x: 2913, z: 3494 }, receiver: { x: 2914, z: 3494 } }];
        const scope = asks.length ? { step: 'S18', family: 'courier' } : { step: 'S07', family: 'bone' };
        if (asks.length && nGivers > 1) throw new Error('--givers is for the standing mode (S07)');
        // With a group, trades counts the group's loads.
        const limit = nGivers > 1 ? { group: givers, trades: loads } : { trades: loads };
        const finalAt = arg('final', '') === '' ? -1 : Number(arg('final', ''));
        if (finalAt >= 0 && !(nGivers > 1 && finalAt < nGivers)) throw new Error('--final=N needs --givers and 0 <= N < givers');
        const RUNES = [
            { item: 'Law rune', count: 1, obj: 'lawrune' },
            { item: 'Air rune', count: 5, obj: 'airrune' }
        ];
        const mix = arg('mix', '').split(',').filter(Boolean).map(Number);
        if (mix.length && (mix.length !== 2 || asks.length || mix.some(x => !Number.isInteger(x) || x < 0))) throw new Error('--mix=D,B: two whole counts, standing mode only');
        const MIX = ['Dragon bones', 'Babydragon bones'];
        const stock = mix.length
            ? { item: MIX, restock: { kind: 'bank', labSeed: [{ obj: 'cert_dragon_bones', n: mix[0]! }, { obj: 'cert_babydragon_bones', n: mix[1]! }].filter(s => s.n > 0) } }
            : { restock: { kind: 'cheat' } };
        const g = givers.map((account, i) => ({
            account,
            role: 'bone-giver',
            options: asks.length
                ? { mode: 'on-request', restock: { kind: 'cheat' }, sites, scope }
                : {
                      ...stock,
                      // The final giver's bank also gets the runes: with --mix every extra is a real withdrawal too.
                      ...(mix.length && i === finalAt ? { restock: { ...stock.restock, labSeed: [...(stock.restock as { labSeed: unknown[] }).labSeed, ...RUNES.map(r => ({ obj: r.obj, n: r.count }))] } } : {}),
                      sites,
                      scope,
                      ...limit,
                      ...(i === finalAt ? { finalExtras: mix.length ? RUNES.map(({ item, count }) => ({ item, count })) : RUNES } : {})
                  }
        }));
        const who = nGivers > 1 ? { givers } : { giver };
        const extras = finalAt >= 0 ? { finalExtras: RUNES.map(({ item, count }) => ({ item, count })) } : {};
        const r = { account: receiver, role: 'bone-receiver', receiver: true, final: true, options: asks.length ? { giver, asks, pageLoads: [], scope } : { ...who, loads, pageLoads: pages, holdTicks: hold, scope, ...extras, ...(mix.length ? { item: MIX } : {}) } };
        return arg('order', 'giver-first') === 'receiver-first' ? [r, ...g] : [...g, r];
    })()
};
const configPath = join(base, 'launch.json');
writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log(`bone giver lab: ${loads} loads, pages after loads ${pages.join(',') || 'none'} held ${hold} ticks, run files in ${base}`);

const child = Bun.spawn([process.execPath, 'speedrun/helpers/standalone.ts', configPath], {
    cwd: ROOT,
    env: { ...process.env, HELPER_LAB_TELE: '1', RC_CUE_DIR: join(runDir, 'rc-cue') },
    stdout: 'inherit',
    stderr: 'inherit'
});
const killer = setTimeout(() => child.kill('SIGINT'), Number(process.env.BONE_LAB_TIMEOUT_MS ?? 15 * 60_000));
const code = await child.exited;
clearTimeout(killer);

// Both sides, line by line: the receiver's loads and pages, the giver's trades, requests and refusals.
for (const [who, account, re] of [['receiver', receiver, /"message":"(load|page)"/] as const, ...givers.map(g => [`giver ${g}`, g, /"message":"(trade|request|bounce|phase|trip)"/] as const)]) {
    let text = '';
    try {
        text = readFileSync(join(runDir, 'logs', `${account}.role.log`), 'utf8');
    } catch {
        console.log(`${who}: no role log`);
    }
    for (const line of text.split('\n')) if (re.test(line)) console.log(`${who} ${line.slice(line.indexOf('{'))}`);
}
process.exit(code);
