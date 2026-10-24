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
//   west bank, seeded once with D dragon and B babydragon (restock.labSeed), every withdrawal a real one,
//   --return (with --mix and --givers): S07's trade-and-return rehearsal: the stand-in buries nothing and hands
//   each load straight back to its giver (bone-receiver.ts returnLoads, bone-giver.ts acceptReturn), paced at a
//   load's bury time (--pace=T ticks, default 69)
//   --s07-sites: the givers use bone-giver.ts's own default sites (S07_SITES, the oak then the willow) instead of
//   the oak tile alone, so they rotate away from an empty site and back,
//   --receiver-after=S: the stand-in logs in S seconds after the givers, from a launcher of its own (the givers
//   arrive first and find no receiver, as on the run), and the lab ends when it has taken its loads,
//   --gate: sample run.ts's role-phase gate (runner/phase-gate.ts) on the givers' status files every second, as
//   for a run whose next helper step is S07, and print each change and a summary
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
const s07Sites = process.argv.includes('--s07-sites');
const receiverAfter = Number(arg('receiver-after', '0'));
const sampleGate = process.argv.includes('--gate');
if (s07Sites && asks.length) throw new Error('--s07-sites is for the standing mode (S07)');

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
        const ret = process.argv.includes('--return');
        if (ret && !(mix.length && nGivers > 1)) throw new Error('--return needs --mix and --givers');
        const pace = Number(arg('pace', '69'));
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
                      ...(s07Sites ? {} : { sites }),
                      scope,
                      ...limit,
                      // The returning stand-in idles through its pace, so a standing request goes stale and opens only on a
                      // re-send (the run's burying account keeps bouncing it fresh): re-send every 30 ticks instead of 100.
                      ...(ret ? { acceptReturn: true, resendTicks: Number(arg('resend', '30')) } : {}),
                      ...(i === finalAt ? { finalExtras: mix.length ? RUNES.map(({ item, count }) => ({ item, count })) : RUNES } : {})
                  }
        }));
        const who = nGivers > 1 ? { givers } : { giver };
        const extras = finalAt >= 0 ? { finalExtras: RUNES.map(({ item, count }) => ({ item, count })) } : {};
        const r = { account: receiver, role: 'bone-receiver', receiver: true, final: true, options: asks.length ? { giver, asks, pageLoads: [], scope } : { ...who, loads, pageLoads: pages, holdTicks: hold, scope, ...extras, ...(mix.length ? { item: MIX } : {}), ...(ret ? { returnLoads: true, paceTicks: pace } : {}) } };
        return arg('order', 'giver-first') === 'receiver-first' ? [r, ...g] : [...g, r];
    })()
};
// --receiver-after: the givers' launcher holds the givers only, and the stand-in gets a launcher (gateway, run dir) of its own.
const late = receiverAfter > 0;
const giverConfig = late ? { ...config, accounts: config.accounts.filter(a => a.account !== receiver) } : config;
const receiverRunDir = late ? join(base, 'run-receiver') : runDir;
const receiverConfig = late ? { ...config, gatewayPort: config.gatewayPort + 1, runDir: receiverRunDir, accounts: config.accounts.filter(a => a.account === receiver) } : null;
const configPath = join(base, 'launch.json');
writeFileSync(configPath, JSON.stringify(giverConfig, null, 2));
console.log(`bone giver lab: ${loads} loads, pages after loads ${pages.join(',') || 'none'} held ${hold} ticks, ${s07Sites ? 'the S07 default sites' : 'the oak tile'}${late ? `, the receiver ${receiverAfter} s after the givers` : ''}, run files in ${base}`);

const cueDir = join(runDir, 'rc-cue');
const launch = (path: string) => Bun.spawn([process.execPath, 'speedrun/helpers/standalone.ts', path], {
    cwd: ROOT,
    env: { ...process.env, HELPER_LAB_TELE: '1', RC_CUE_DIR: cueDir },
    stdout: 'inherit',
    stderr: 'inherit'
});
const t0 = Date.now();
const child = launch(configPath);

// The role-phase gate as run.ts evaluates it for a run whose next helper step is S07: printed on each change.
const gate = { refused: 0, passed: 0, changes: [] as string[] };
let sampler: ReturnType<typeof setInterval> | null = null;
if (sampleGate) {
    const { membersFromLauncher, phaseGates, readStatusFile } = await import('../runner/phase-gate');
    const members = membersFromLauncher(giverConfig);
    let last = '';
    let lastVerdict = '';
    sampler = setInterval(() => {
        const lines = phaseGates({ path: ['S07'], members, read: readStatusFile(cueDir), launcher: null, now: Date.now(), source: 'the lab launch config' });
        const ok = lines.length > 0 && lines.every(l => l.ok);
        if (ok) gate.passed++;
        else gate.refused++;
        const secs = Math.round((Date.now() - t0) / 1000);
        const verdict = ok ? 'PASS' : 'REFUSED';
        if (verdict !== lastVerdict) gate.changes.push(`+${secs}s ${verdict}`);
        lastVerdict = verdict;
        const key = lines.map(l => `${l.ok} ${l.detail.replace(/\d+ s\b/g, '')}`).join('|');
        if (key === last) return;
        last = key;
        console.log(`gate +${secs}s ${verdict}`);
        for (const l of lines) console.log(`  [gate] ${l.ok ? 'ok     ' : 'REFUSED'} ${l.gate}: ${l.detail}`);
    }, 1000);
}

let rchild: ReturnType<typeof launch> | null = null;
const timeoutMs = Number(process.env.BONE_LAB_TIMEOUT_MS ?? 15 * 60_000);
const killer = setTimeout(() => {
    child.kill('SIGINT');
    rchild?.kill('SIGINT');
}, timeoutMs);
let code: number;
if (receiverConfig) {
    const receiverPath = join(base, 'launch-receiver.json');
    writeFileSync(receiverPath, JSON.stringify(receiverConfig, null, 2));
    // Bounded by the lab's timeout: a givers' launcher that exits early ends the wait too.
    await Promise.race([Bun.sleep(receiverAfter * 1000), child.exited]);
    console.log(`receiver: launching at +${Math.round((Date.now() - t0) / 1000)}s`);
    rchild = launch(receiverPath);
    code = await rchild.exited;
    // The givers end on their group's loads; give them a moment to publish 'off', then stop their launcher.
    await Promise.race([child.exited, Bun.sleep(20_000)]);
    child.kill('SIGINT');
    await child.exited;
} else {
    code = await child.exited;
}
clearTimeout(killer);
if (sampler) {
    clearInterval(sampler);
    console.log(`GATE SUMMARY ${JSON.stringify({ refusedSamples: gate.refused, passedSamples: gate.passed, changes: gate.changes })}`);
}

// Both sides, line by line: the receiver's loads and pages, the giver's trades, requests and refusals.
for (const [who, account, re] of [['receiver', receiver, /"message":"(load|page|givers)"/] as const, ...givers.map(g => [`giver ${g}`, g, /"message":"(trade|request|bounce|phase|trip|return|final bank|bank short|travel fault: next site)"/] as const)]) {
    let text = '';
    try {
        text = readFileSync(join(account === receiver ? receiverRunDir : runDir, 'logs', `${account}.role.log`), 'utf8');
    } catch {
        console.log(`${who}: no role log`);
    }
    for (const line of text.split('\n')) if (re.test(line)) console.log(`${who} ${line.slice(line.indexOf('{'))}`);
}
process.exit(code);
