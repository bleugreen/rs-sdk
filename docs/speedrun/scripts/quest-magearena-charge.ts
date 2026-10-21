// Charge cast rate after the Mage Arena unlock (%magearena = 8).
//
//   bun docs/speedrun/scripts/quest-magearena-charge.ts <botname>
//
// For each burst size B (clicks sent per tick) it clicks Charge (magic:charge, com 1193) for ROUNDS
// ticks and records Magic xp per server tick from state updates. charge.rs2 runs to completion with
// no delay; the engine decodes at most 5 USER_EVENT packets (IF_BUTTON is one) per player per tick
// (ClientGameProtCategory.ts), so B > 5 shows whether the surplus carries over.
// Env: BURSTS (default 1,3,5,10), ROUNDS (default 20), STAFF (default 'staff of fire').
import { runScript } from '../../../sdk/runner';
import { cheat, log, sleep, tick, waitTicks } from './quest-unlocks-lib';

const CHARGE = 1193;
const BURSTS = (process.env.BURSTS ?? '1,3,5,10').split(',').map(Number);
const ROUNDS = Number(process.env.ROUNDS ?? 20);

await runScript(async ({ bot, sdk }) => {
    await cheat(sdk, 'getvar magearena');
    await cheat(sdk, 'setstat magic 80');
    await cheat(sdk, 'give bloodrune 5000');
    await cheat(sdk, 'give airrune 5000');
    await cheat(sdk, 'give firerune 5000');
    await waitTicks(sdk, 3);
    for (const m of sdk.getNewChat({ types: [0] })) console.log('chat:', m.text);

    // xp per server tick
    const xpAt = new Map<number, number>();
    sdk.onStateUpdate((s) => {
        const xp = s.skills.find((k) => k.name === 'Magic')?.experience;
        if (xp !== undefined) xpAt.set(s.tick, xp);
    });

    for (const burst of BURSTS) {
        await waitTicks(sdk, 5);
        const xp0 = sdk.getSkill('Magic')?.experience ?? 0;
        const t0 = tick(sdk);
        for (let r = 0; r < ROUNDS; r++) {
            const t = tick(sdk);
            await Promise.all(Array.from({ length: burst }, () => sdk.sendClickComponent(CHARGE)));
            while (tick(sdk) === t) await sleep(5);
            const d = sdk.getDialog();
            if (d?.isOpen) await sdk.sendClickDialog(d.options[0]?.index ?? 0); // level-up
        }
        // let queued packets drain
        await waitTicks(sdk, 10);
        const t1 = tick(sdk);
        const xp1 = sdk.getSkill('Magic')?.experience ?? 0;
        // per-tick casts (1800 game xp per cast at 25x = 4500? read the delta per tick)
        const perTick: number[] = [];
        let prev = xp0;
        for (let t = t0 + 1; t <= t1; t++) {
            const x = xpAt.get(t);
            if (x === undefined) continue;
            perTick.push(x - prev);
            prev = x;
        }
        const castXp = 180 * 25; // charge: experience 1800 (tenths) = 180 base, 25x
        const casts = (xp1 - xp0) / castXp;
        const active = perTick.filter((d) => d > 0);
        log(sdk, `BURST ${burst}/tick x ${ROUNDS} rounds: ${casts} casts over ${t1 - t0} ticks; casts per active tick ${JSON.stringify(active.map((d) => d / castXp))}`);
        log(sdk, `   = ${(casts / ROUNDS).toFixed(2)} casts per click-round, ${((casts * 180) / ROUNDS).toFixed(0)} base xp per round tick`);
    }
    for (const m of sdk.getNewChat({ types: [0] }).slice(-5)) console.log('chat:', m.text);
}, { timeout: 10 * 60_000, printState: false });
