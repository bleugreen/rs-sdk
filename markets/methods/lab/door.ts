/**
 * Lab check of the pickpocket method's door recovery (docs/markets/phase2.md 'Stuck behind a door'). Lab only.
 *
 *   . markets/methods/lab/block.sh M21 && LAB_RUNNERS=0 LAB_TIMEOUT=1500 speedrun/lab/lab.sh <bot> markets/methods/lab/door.ts
 *
 * 1. Leaves Tutorial Island, Thieving and Hitpoints to 99, 200 sharks into the East Ardougne south bank.
 * 2. Bank errand: teleports into the market building at (2671,3315) where the demo's knights were shut in, with no
 *    food, and runs the knights method: its first errand is the bank walk.
 * 3. Roam walk: teleports back in carrying sharks, so the method thieves there, finds no reachable knight and roams.
 * Each phase runs until the method has banked (phase 2) or thieved at the market (phase 3), or `--minutes` passes.
 */
import { executionContext } from '../../../sdk/execution-context';
import type { BotSDK } from '../../../sdk/index';
import { memoryRoleState } from '../../../speedrun/helpers/role';
import { cheat, leaveTutorial, mustTele, setStats } from '../../../speedrun/lab/setup';
import { depositMatching } from '../../../speedrun/lib/bank';
import { walkTo } from '../../../speedrun/lib/act';
import { openDirectSession } from '../../../speedrun/lib/direct';
import { loadBotEnv } from '../../../speedrun/lib/session';
import { waitTicks, waitUntil } from '../../../speedrun/lib/wait';
import { ARDOUGNE_SOUTH_BANK, role, SPOTS } from '../pickpocket';
import { lastArg as arg } from './common-arg.ts';

const INSIDE = { x: 2671, z: 3315 };
const bot = process.argv[2] ?? '';
const minutes = Number(arg('minutes', '5'));
const env = loadBotEnv(bot);
if (!/^(localhost|127\.)/.test(env.SERVER ?? '')) {
    console.error(`door.ts: SERVER is '${env.SERVER}', not a local lab: refusing`);
    process.exit(2);
}
const log = (sdk: BotSDK | null, m: string, d: Record<string, unknown> = {}) => {
    const p = sdk?.getState()?.player;
    console.log(`DOOR ${new Date().toISOString()} tick=${sdk?.getState()?.tick ?? '-'} at=${p ? `${p.worldX},${p.worldZ}` : '-'} ${m} ${JSON.stringify(d)}`);
};

const doors = (sdk: BotSDK) =>
    sdk
        .getNearbyLocs()
        .filter(l => /door|gate/i.test(l.name) && l.distance <= 8)
        .map(l => ({ x: l.x, z: l.z, id: l.id, distance: l.distance, options: l.optionsWithIndex.map(o => o.text) }));

/** Close every open door within 8 tiles, so the room is shut as on the demo. */
async function shutDoors(sdk: BotSDK): Promise<void> {
    for (const l of sdk.getNearbyLocs().filter(l => /door/i.test(l.name) && l.distance <= 8)) {
        const close = l.optionsWithIndex.find(o => /^close$/i.test(o.text));
        if (!close) continue;
        await sdk.sendInteractLoc(l.x, l.z, l.id, close.opIndex);
        await waitTicks(sdk, 3);
    }
}

/** A teleport sent during a pickpocket delay or stun is dropped: wait it out and try again. */
async function teleIn(sdk: BotSDK): Promise<void> {
    for (let i = 0; ; i++) {
        await waitTicks(sdk, 10);
        try {
            return await mustTele(sdk, INSIDE.x, INSIDE.z);
        } catch (e) {
            if (i >= 3) throw e;
        }
    }
}

async function trap(sdk: BotSDK, label: string): Promise<void> {
    await teleIn(sdk);
    await waitTicks(sdk, 3);
    await shutDoors(sdk);
    log(sdk, `${label}: inside`, { doors: doors(sdk) });
    // what a walk out does without the method's recovery (one bot.walkTo, no retries)
    const plain = await walkTo(sdk_bot!, sdk, ARDOUGNE_SOUTH_BANK.x, ARDOUGNE_SOUTH_BANK.z, 2, 0);
    log(sdk, `${label}: plain walkTo to the bank`, { ok: plain.ok, message: plain.message });
    if (plain.ok) {
        await teleIn(sdk);
        await waitTicks(sdk, 3);
        await shutDoors(sdk);
        log(sdk, `${label}: back inside after the plain walk got out`, { doors: doors(sdk) });
    }
}

/** Run the knights method until `done` holds on a log line or `minutes` pass. */
async function runMethod(sdk: BotSDK, label: string, done: (message: string) => boolean): Promise<boolean> {
    const ctl = new AbortController();
    let met = false;
    const timer = setTimeout(() => ctl.abort(new Error('time')), minutes * 60_000);
    try {
        await executionContext.run({ signal: ctl.signal }, () =>
            role.run({
                bot: sdk_bot!,
                sdk,
                account: bot,
                options: { target: 'knight', foodPerTrip: 5, bankAt: 1000 },
                log: (message, data) => {
                    log(sdk, `${label}: pickpocket: ${message}`, data ?? {});
                    if (!met && done(message)) {
                        met = true;
                        setTimeout(() => ctl.abort(new Error('done')), 15_000);
                    }
                },
                reportBank: () => undefined,
                signal: ctl.signal,
                state: memoryRoleState()
            })
        );
    } catch (e) {
        if (!ctl.signal.aborted) log(sdk, `${label}: role threw`, { error: String(e) });
    } finally {
        clearTimeout(timer);
    }
    log(sdk, `CHECK ${label}`, { ok: met });
    return met;
}

let sdk_bot: Awaited<ReturnType<Awaited<ReturnType<typeof openDirectSession>>['connectSdk']>>['bot'] | null = null;
const session = await openDirectSession({ host: env.SERVER!, username: env.BOT_USERNAME, password: env.PASSWORD, profanityFilter: false });
const { sdk, bot: b } = await session.connectSdk({ showChat: false });
sdk_bot = b;
const outer = new AbortController();
let ok = false;
try {
    ok = await executionContext.run({ signal: outer.signal }, async () => {
        await sdk.waitForCondition(s => (s.player?.worldX ?? 0) > 0, 60_000);
        await leaveTutorial({ sdk, bot: b, name: bot, sessionId: 1 });
        await setStats(sdk, { thieving: 99, hitpoints: 99 });
        await mustTele(sdk, ARDOUGNE_SOUTH_BANK.x, ARDOUGNE_SOUTH_BANK.z);
        const opened = await b.openBank();
        if (!opened.success) throw new Error(`openBank: ${opened.message}`);
        await cheat(sdk, 'give cert_shark 200');
        await waitUntil(sdk, s => s.inventory.some(i => /^shark$/i.test(i.name)), { maxTicks: 10 });
        await depositMatching(sdk, [/^shark$/i]);
        await b.closeBank();
        log(sdk, 'staged', { thieving: 99, bankSharks: sdk.getBankItems().find(i => /^shark$/i.test(i.name))?.count ?? null, anchor: SPOTS.knight.anchor });

        await trap(sdk, 'bank errand');
        const banked = await runMethod(sdk, 'bank errand', m => m === 'banked');

        await cheat(sdk, 'give shark 5');
        await waitUntil(sdk, s => s.inventory.filter(i => /^shark$/i.test(i.name)).length >= 5, { maxTicks: 10 });
        await trap(sdk, 'roam walk');
        let roamedOut = false;
        const thieved = await runMethod(sdk, 'roam walk', m => {
            if (m === 'through the door') roamedOut = true;
            return roamedOut && (m === 'progress' || m === 'banked');
        });
        return banked && thieved;
    });
} catch (e) {
    log(sdk, 'lab failed', { error: String(e) });
} finally {
    const r = await session.logout({ timeoutMs: 30_000 });
    log(sdk, 'logout', { ok: r.ok });
}
log(null, ok ? 'CHECK door recovery: PASS' : 'CHECK door recovery: FAIL');
process.exit(ok ? 0 : 1);
