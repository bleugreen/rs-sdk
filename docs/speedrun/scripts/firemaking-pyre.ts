#!/usr/bin/env bun
/**
 * Pyre-log creation lab (Shades of Mort'ton). Using sacred oil on logs awards
 * Firemaking xp with no delay and no Firemaking level check
 * (mortton_pyre.rs2 create_sacred_logs reads pyre_level but never tests it).
 * This sets the quest varp past the sacred-oil step, fills the inventory with
 * logs and full sacred oil, fires every oil-on-log click at once and logs the
 * server tick of each xp gain.
 *
 *   bun docs/speedrun/scripts/firemaking-pyre.ts <bot> [flags]
 *
 * Flags:
 *   --logs=NAME   log debugname (default yew_logs; yew/magic need 4 doses and
 *                 give 60 base, willow/maple 3 doses for 40, normal/oak 2 for 20)
 *   --level=N     ::setstat firemaking N first (default 1)
 *   --pairs=N     logs and sacred_oil4 per round (default 14, a full inventory)
 *   --rounds=N    rounds (default 5; the restock between rounds is a cheat
 *                 here, costed by firemaking-supply.ts)
 *   --quest=N     %morttonquest value to set (default 65 = created sacred oil;
 *                 below that the click is refused)
 */
import { runScript } from '../../../sdk/runner';
import type { BotWorldState } from '../../../sdk/types';

const argv = process.argv.slice(2);
const flag = (name: string, def?: string) => {
    const hit = argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : def;
};
const LOGS = flag('logs', 'yew_logs')!;
const LEVEL = Number(flag('level', '1'));
const PAIRS = Number(flag('pairs', '14'));
const ROUNDS = Number(flag('rounds', '5'));
const QUEST = Number(flag('quest', '65'));
const logName = LOGS === 'logs' ? /^logs$/i : new RegExp(`^${LOGS.replace('_logs', '').replace(/_/g, ' ')} logs$`, 'i');

await runScript(async ({ bot, sdk }) => {
    const fm = (s: BotWorldState) => s.skills.find(k => k.name === 'Firemaking')!;
    const nextTick = (after: number) => new Promise<BotWorldState>(resolve => {
        const now = sdk.getState();
        if (now && now.tick > after) return resolve(now);
        const off = sdk.onStateUpdate(s => { if (s.tick > after) { off(); resolve(s); } });
    });
    const waitTicks = async (n: number) => { let t = sdk.getState()!.tick; for (let i = 0; i < n; i++) t = (await nextTick(t)).tick; };

    await sdk.waitForCondition(s => (s.player?.worldX ?? 0) > 0, 15000);
    await bot.skipTutorial().catch(() => {});
    await sdk.sendSay(`::setvar morttonquest ${QUEST}`); await waitTicks(2);
    await sdk.sendSay(`::setstat firemaking ${LEVEL}`); await waitTicks(2);
    const seen = new Set<number>();
    const rounds: object[] = [];
    const startXp = fm(sdk.getState()!).experience;
    for (let r = 0; r < ROUNDS; r++) {
        await sdk.sendSay('::~clearinv inv'); await waitTicks(1);
        await sdk.sendSay(`::give ${LOGS} ${PAIRS}`); await waitTicks(1);
        await sdk.sendSay(`::give sacred_oil4 ${PAIRS}`); await waitTicks(3);
        while (sdk.getState()!.dialog.isOpen) { await sdk.sendClickDialog(0); await waitTicks(1); }
        let s = sdk.getState()!;
        for (const m of s.gameMessages) if (m.observationId !== undefined) seen.add(m.observationId);
        const logs = s.inventory.filter(i => logName.test(i.name));
        const oils = s.inventory.filter(i => /sacred oil\(4\)/i.test(i.name));
        const n = Math.min(logs.length, oils.length);
        const t0 = s.tick;
        // Every click goes out at once; the engine decodes 5 user events per
        // tick and carries the rest over (ClientGameProtCategory.ts:10).
        await Promise.all(Array.from({ length: n }, (_, i) => sdk.sendUseItemOnItem(oils[i].slot, logs[i].slot)));
        const perTick: number[] = [];
        let lastXp = fm(s).experience, made = 0, idle = 0;
        const msgs: string[] = [];
        while (made < n && idle < 10) {
            s = await nextTick(s.tick);
            const xp = fm(s).experience;
            const k = Math.round((xp - lastXp) / 25 / (LOGS.match(/yew|magic/) ? 60 : LOGS.match(/willow|maple/) ? 40 : 20));
            perTick.push(k); made += k; lastXp = xp;
            idle = k ? 0 : idle + 1;
            for (const m of s.gameMessages) if (m.observationId !== undefined && !seen.has(m.observationId)) { seen.add(m.observationId); msgs.push(m.text); }
            if (s.dialog.isOpen) await sdk.sendClickDialog(0);
        }
        while (perTick.length && perTick.at(-1) === 0) perTick.pop();
        const firstXp = perTick.findIndex(k => k > 0);
        rounds.push({ round: r, clicks: n, made, ticksSentToLastXp: perTick.length, firstXpAfter: firstXp + 1, perTick: perTick.join(','), level: fm(s).baseLevel, refused: msgs.filter(m => /fresh|need/.test(m)).slice(0, 2) });
        console.log(JSON.stringify(rounds.at(-1)));
        void t0;
    }
    console.log(JSON.stringify({ logs: LOGS, startLevel: LEVEL, rounds: ROUNDS, pairs: PAIRS, baseXp: (fm(sdk.getState()!).experience - startXp) / 25, endLevel: fm(sdk.getState()!).baseLevel }));
}, { timeout: 0, printState: false });
