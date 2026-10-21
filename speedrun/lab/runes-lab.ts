// Lab scenarios for the runes role (speedrun/helpers/runes.ts), one engine boot:
//
//   WEB_PORT=9560 WEB_MANAGEMENT_PORT=9561 HISCORES_WEB_PORT=9562 NODE_PORT=44560 AGENT_PORT=8560 \
//     speedrun/lab/lab.sh rnlab1 speedrun/lab/runes-lab.ts:--only=talismans,magic,guild,lundail
//
// Each scenario sets the account up with staff commands, runs one phase of the
// role with its own options, and prints the role's log lines and the result.
import { memoryRoleState } from '../helpers/role';
import { Runes, type Phase } from '../helpers/runes';
import { openSession } from '../lib/session';
import { waitTicks } from '../lib/wait';
import { arg, botArg } from './common';
import { cheat, give, setstat, tele } from './setup';

interface Scenario {
    phase: Phase;
    secs: number;
    options: Record<string, unknown>;
    setup: () => Promise<void>;
}

const name = botArg();
const only = arg('only', 'talismans,magic,guild,lundail').split(',');
const s = await openSession(name);
const sdk = s.sdk;
const log = (message: string, data?: Record<string, unknown>) => console.log(JSON.stringify({ t: sdk.getState()?.tick, message, ...data }));

const scenarios: Scenario[] = [
    {
        phase: 'talismans',
        secs: 300,
        options: { targets: { 'Air talisman': 3 } },
        setup: async () => {
            await tele(sdk, 3222, 3218);
        }
    },
    {
        phase: 'magic',
        secs: 900,
        // 8 -> 10 crosses the switch from Wind Strike to Earth Strike with the staff at 9, on
        // runes bought at Aubury in chunks of 60 casts (the carry guard sees every walk).
        options: { magicLevel: 10, trainChunk: 60 },
        setup: async () => {
            await setstat(sdk, 'magic', 8);
            await tele(sdk, 3185, 3436);
            await cheat(sdk, 'give coins 5000');
            await cheat(sdk, 'give staff_of_earth 1');
            await waitTicks(sdk, 2);
        }
    },
    {
        phase: 'guild',
        secs: 900,
        // Trips of at most 60k at the caps: blood 570 alone needs three.
        options: { maxCarry: 60_000 },
        setup: async () => {
            await setstat(sdk, 'magic', 66);
            await setstat(sdk, 'hitpoints', 40);
            await cheat(sdk, 'give coins 250000');
            await tele(sdk, 2612, 3092);
        }
    },
    {
        phase: 'lundail',
        secs: 900,
        // Through the keep web both ways with a bronze axe; a short cellar wait, one restock at most.
        options: { targets: { 'Cosmic rune': 22, 'Law rune': 0 }, lundailWaitTicks: 300 },
        setup: async () => {
            await setstat(sdk, 'hitpoints', 40);
            await cheat(sdk, 'give coins 20000');
            await cheat(sdk, 'give bronze_axe 1');
            await tele(sdk, 2655, 3286);
        }
    }
];

for (const sc of scenarios.filter(x => only.includes(x.phase))) {
    log('scenario', { phase: sc.phase, options: sc.options });
    await sc.setup();
    await waitTicks(sdk, 3);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), sc.secs * 1000);
    const runes = new Runes({ bot: s.bot, sdk, account: name, options: { ...sc.options, phases: [sc.phase] }, log, reportBank: b => log('bank', { items: b.items.length }), signal: controller.signal, state: memoryRoleState() });
    const t0 = sdk.getState()?.tick ?? 0;
    try {
        await runes.run();
    } catch (e) {
        log('scenario threw', { phase: sc.phase, error: String(e) });
    }
    clearTimeout(timer);
    const st = sdk.getState();
    log('scenario done', {
        phase: sc.phase,
        ticks: (st?.tick ?? 0) - t0,
        pos: { x: st?.player?.worldX, z: st?.player?.worldZ, plane: st?.player?.level },
        inv: st?.inventory.map(i => `${i.name} x${i.count}`),
        magic: st?.skills.find(k => k.name === 'Magic')?.baseLevel
    });
}
process.exit(0);
