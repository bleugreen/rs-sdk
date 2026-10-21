#!/usr/bin/env bun
/**
 * Stall lab: clicks the nearest stall matching --loc with a Steal option once
 * per server tick for --ticks ticks, and logs the server tick of every xp drop
 * and every owner/guard refusal ("Get your hands off there!").
 *
 *   bun docs/speedrun/scripts/thieving-stall.ts <bot> [--loc=REGEX] [--level=N] [--tele=l,mx,mz,lx,lz] [--ticks=N]
 *
 * Defaults: Ardougne market baker's stalls at level 5, 600 ticks.
 */
import { runScript } from '../../../sdk/runner';
import type { BotWorldState } from '../../../sdk/types';

const argv = process.argv.slice(2);
const flag = (name: string, def: string) => argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const LOC = new RegExp(flag('loc', "^Baker's stall$"), 'i');
const LEVEL = Number(flag('level', '5'));
const TELE = flag('tele', '0,41,51,32,45');
const TICKS = Number(flag('ticks', '600'));

await runScript(async ({ bot, sdk }) => {
    const nextTick = (after: number) => new Promise<BotWorldState>(resolve => {
        const now = sdk.getState();
        if (now && now.tick > after) return resolve(now);
        const off = sdk.onStateUpdate(s => { if (s.tick > after) { off(); resolve(s); } });
    });
    await sdk.waitForCondition(s => (s.player?.worldX ?? 0) > 0, 15000);
    await bot.skipTutorial().catch(() => {});
    await sdk.sendSay(`::tele ${TELE}`);
    let s = await nextTick(sdk.getState()!.tick); s = await nextTick(s.tick);
    await sdk.sendSay('::setstat hitpoints 99'); s = await nextTick(s.tick); s = await nextTick(s.tick);
    await sdk.sendSay(`::setstat thieving ${LEVEL}`); s = await nextTick(s.tick); s = await nextTick(s.tick);

    const xpOf = (st: BotWorldState) => st.skills.find(k => k.name === 'Thieving')!.experience;
    const seen = new Set<number>(s.gameMessages.map(m => m.observationId ?? -1));
    let lastXp = xpOf(s);
    const start = s.tick;
    const steals: number[] = [];
    const msgs: Record<string, number> = {};
    let clicks = 0;
    while (s.tick - start < TICKS) {
        s = await nextTick(s.tick);
        for (const m of s.gameMessages) {
            if (m.observationId === undefined || seen.has(m.observationId)) continue;
            seen.add(m.observationId);
            const key = m.text.replace(/\d+/g, 'N');
            msgs[key] = (msgs[key] ?? 0) + 1;
        }
        const xp = xpOf(s);
        if (xp > lastXp) steals.push(s.tick);
        lastXp = xp;
        if (s.dialog.isOpen) await sdk.sendClickDialog(0);
        if (s.skills.find(k => k.name === 'Thieving')!.baseLevel !== LEVEL) await sdk.sendSay(`::setstat thieving ${LEVEL}`);
        const stall = s.nearbyLocs
            .filter(l => LOC.test(l.name) && l.optionsWithIndex.some(o => /steal/i.test(o.text)))
            .sort((a, b) => a.distance - b.distance)[0];
        const op = stall?.optionsWithIndex.find(o => /steal/i.test(o.text));
        if (stall && op) { await sdk.sendInteractLoc(stall.x, stall.z, stall.id, op.opIndex); clicks++; }
    }
    const gaps: Record<number, number> = {};
    for (let i = 1; i < steals.length; i++) gaps[steals[i] - steals[i - 1]] = (gaps[steals[i] - steals[i - 1]] ?? 0) + 1;
    console.log(JSON.stringify({ loc: LOC.source, level: LEVEL, ticks: TICKS, steals: steals.length, stealsPerTick: +(steals.length / TICKS).toFixed(4), gaps, clicks, messages: msgs }, null, 1));
}, { timeout: 0, printState: false });
