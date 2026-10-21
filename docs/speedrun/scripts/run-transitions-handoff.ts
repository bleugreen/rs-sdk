// Hand-offs at the route's staging tiles: trade (speedrun/lib trade.ts giveAll / receiveFrom) and
// drop-and-pick-up, receiver clock from its first click.
//
//   WEB_PORT=9600 WEB_MANAGEMENT_PORT=9601 HISCORES_WEB_PORT=9602 NODE_PORT=44600 AGENT_PORT=8600 \
//     NODE_TICKRATE=300 LAB_HELPERS=<helper> bash speedrun/lab/lab.sh <receiver> \
//     'docs/speedrun/scripts/run-transitions-handoff.ts:--giver=<helper>:--n=3'
//
// Trades: the giver requests first and the receiver clicks after seeing the request, as a helper
// delivery runs (speedrun/lab/measure-trade.ts). Cases: 1 noted stack, and 23 stacks (10 noted
// stacks + 13 unnoted items). Drops: the giver drops k = 1..3 items on its own tile; after the
// 100-tick private window (objRevealTicks, WorldConfig.ts) the receiver, standing on the next tile
// or on the pile, fires one pickup per item at once.
import { closeSession, openSession, type Session } from '../../../speedrun/lib/session';
import { giveAll, receiveFrom } from '../../../speedrun/lib/trade';
import { nextTick, waitTicks } from '../../../speedrun/lib/wait';
import { arg, botArg, labLog, result, sample } from '../../../speedrun/lab/common';
import { cheat, give, LAB_ITEMS, tele } from '../../../speedrun/lab/setup';

const n = Number(arg('n', '3'));
const recv = await openSession(botArg());
const giver = await openSession(arg('giver', 'rt104b'), { pathfinding: false });
const log = labLog('run-transitions-handoff');
const island = (s: Session) => { const p = s.sdk.getState()!.player!; return p.worldX > 3040 && p.worldX < 3160 && p.worldZ > 3040 && p.worldZ < 3140; };
for (const s of [recv, giver]) if (island(s)) { await s.bot.skipTutorial(); await waitTicks(s.sdk, 5); }

const STAGING: { name: string; at: [number, number] }[] = [
    { name: 'Lumbridge spawn (S00/S01; busiest tile on the demo)', at: [3222, 3222] },
    { name: 'Falador teleport landing (S05-S07)', at: [2965, 3378] },
    { name: 'Ardougne teleport landing / market (S08-S18)', at: [2661, 3301] },
    { name: 'Varrock west bank (S25)', at: [3185, 3436] },
];

async function clear(s: Session) { await cheat(s.sdk, '~clearinv inv'); await waitTicks(s.sdk, 1); }

async function tradeSample(label: string, stage: () => Promise<void>) {
    await clear(recv);
    await clear(giver);
    await stage();
    const req = recv.sdk.waitForTradeRequest({ from: giver.name, timeout: 20_000 });
    const g = giveAll(giver.sdk, recv.name);
    if (!(await req)) throw new Error('no trade request');
    const r = await sample(log, recv, label, () => receiveFrom(recv.sdk, giver.name));
    const gr = await g;
    result(`${label} detail`, { receiverTicks: r.ticks, giverTicks: gr.ticks, giverEvents: gr.sent, ok: r.ok && gr.ok, reason: r.reason ?? gr.reason, received: recv.sdk.getState()!.inventory.length });
}

for (const site of STAGING) {
    const [x, z] = site.at;
    await tele(recv.sdk, x, z);
    await tele(giver.sdk, x + 1, z);
    for (let i = 0; i < n; i++) {
        await tradeSample(`trade 1 noted stack @ ${site.name}`, () => give(giver.sdk, ['cert_iron_ore'], 100));
        await tradeSample(`trade 23 stacks (10 noted + 13 unnoted) @ ${site.name}`, async () => {
            await give(giver.sdk, LAB_ITEMS.slice(0, 10).map((x) => `cert_${x}`), 10);
            await give(giver.sdk, LAB_ITEMS.slice(10, 23), 1);
        });
    }
}

// Drop and pick up, at the Lumbridge spawn.
const DROP_ITEMS = ['logs', 'oak_logs', 'willow_logs'];
const [dx, dz] = [3222, 3222];
for (const onPile of [false, true]) {
    for (let k = 1; k <= 3; k++) {
        for (let i = 0; i < n; i++) {
            await clear(recv);
            await clear(giver);
            // leftovers from a failed sample would count as revealed drops
            await tele(recv.sdk, dx, dz);
            for (const g of recv.sdk.getState()!.groundItems.filter((q) => q.x === dx && q.z === dz)) { void recv.sdk.sendPickup(g.x, g.z, g.id); await waitTicks(recv.sdk, 2); }
            await clear(recv);
            await tele(giver.sdk, dx, dz);
            await tele(recv.sdk, onPile ? dx : dx + 1, dz);
            await give(giver.sdk, DROP_ITEMS.slice(0, k), 1);
            const inv = giver.sdk.getState()!.inventory;
            for (const it of inv) void giver.sdk.sendDropItem(it.slot);
            await waitTicks(giver.sdk, 3);
            await tele(giver.sdk, dx + 3, dz + 3); // the helper steps away (it would log out)
            // private to the dropper for 100 ticks, then public
            const t0 = recv.sdk.getState()!.tick;
            while (recv.sdk.getState()!.groundItems.filter((g) => g.x === dx && g.z === dz).length < k) {
                if (recv.sdk.getState()!.tick - t0 > 140) throw new Error('drops never became visible');
                await nextTick(recv.sdk);
            }
            const revealAfter = recv.sdk.getState()!.tick - t0;
            await nextTick(recv.sdk);
            // A pickup is an interaction, and a newer interaction replaces an older one, so a burst
            // of k pickups takes only the last: pick up one item at a time, each on its arrival.
            const r = await sample(log, recv, `drop pickup ${k} item(s), receiver ${onPile ? 'on the pile' : 'on the next tile'}`, async () => {
                const ts = recv.sdk.getState()!.tick;
                for (let got = 0; got < k; got++) {
                    const p = recv.sdk.getState()!.groundItems.find((g) => g.x === dx && g.z === dz);
                    if (!p) return { ok: false, reason: 'pile gone' };
                    const before = recv.sdk.getState()!.inventory.length;
                    void recv.sdk.sendPickup(p.x, p.z, p.id);
                    while (recv.sdk.getState()!.inventory.length <= before) {
                        if (recv.sdk.getState()!.tick - ts > 30) return { ok: false, reason: 'not all picked up' };
                        await nextTick(recv.sdk);
                    }
                }
                return { ok: true };
            }, { k, onPile });
            result('drop detail', { k, onPile, revealAfterTicks: revealAfter, r });
        }
    }
}

await closeSession(recv);
await closeSession(giver);
process.exit(0);
