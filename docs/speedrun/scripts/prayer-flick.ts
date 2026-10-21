#!/usr/bin/env bun
/**
 * Prayer-flick drain lab: does toggling prayers off and on at least every 4 ticks
 * keep them up with zero prayer drain? (`prayer.rs2`: the drain is a 5-tick timer
 * started when a prayer goes on from all-off and cleared when the last goes off.)
 *
 *   bun docs/speedrun/scripts/prayer-flick.ts <bot> [--ticks=150] [--period=4] [--modes=hold,flick1,flick3]
 *
 * Modes (Prayer set to 99 so nothing runs out; points used are what matter):
 *   hold    Protect from Melee + Ultimate Strength + Incredible Reflexes on, held.
 *   flick1  Protect from Melee only; every <period> ticks send off then on in one tick.
 *   flick3  all three; every <period> ticks send off x3 + on (Protect) in tick A,
 *           then on x2 (Ultimate Strength, Incredible Reflexes) in tick A+1.
 * Logs, per mode: prayer points used, ticks observed, and the share of ticks on which
 * each wanted prayer showed as active in the published state.
 */
import { runScript } from '../../../sdk/runner';
import type { BotWorldState } from '../../../sdk/types';

const argv = process.argv.slice(2);
const flag = (name: string, def: string) => argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const TICKS = Number(flag('ticks', '150'));
const PERIOD = Number(flag('period', '4'));
const MODES = flag('modes', 'hold,flick1,flick3').split(',');
const PFM = 14, US = 10, IR = 11;

await runScript(async ({ bot, sdk }) => {
    const nextTick = (after: number) => new Promise<BotWorldState>(resolve => {
        const now = sdk.getState();
        if (now && now.tick > after) return resolve(now);
        const off = sdk.onStateUpdate(st => { if (st.tick > after) { off(); resolve(st); } });
    });
    const ticks = async (n: number) => { let st = sdk.getState()!; for (let i = 0; i < n; i++) st = await nextTick(st.tick); return st; };
    const fire = (p: Promise<unknown>) => { p.catch(() => {}); };
    const toggle = (i: number) => fire(sdk.sendTogglePrayer(i));
    const active = (st: BotWorldState) => st.prayers?.activePrayers ?? [];
    const points = (st: BotWorldState) => st.prayers?.prayerPoints ?? -1;

    await sdk.waitForCondition(st => (st.player?.worldX ?? 0) > 0, 15000);
    await bot.skipTutorial().catch(() => {});
    await ticks(2);

    for (const mode of MODES) {
        // all off, then restore points
        let st = sdk.getState()!;
        for (const [i, on] of active(st).entries()) if (on) toggle(i);
        await ticks(3);
        await sdk.sendSay('::setstat prayer 99'); st = await ticks(4);
        const wanted = mode === 'flick1' ? [PFM] : [PFM, US, IR];
        for (const i of wanted) toggle(i);
        st = await ticks(2);
        const start = points(st);
        const startTick = st.tick;
        const up = new Map<number, number>(wanted.map(i => [i, 0]));
        let observed = 0;
        let phase = 0;
        while (st.tick - startTick < TICKS) {
            if (mode === 'flick1' && phase % PERIOD === 0) { toggle(PFM); toggle(PFM); }
            if (mode === 'flick3' && phase % PERIOD === 0) { toggle(PFM); toggle(US); toggle(IR); toggle(PFM); }
            if (mode === 'flick3' && phase % PERIOD === 1) { toggle(US); toggle(IR); }
            st = await nextTick(st.tick);
            phase++;
            observed++;
            for (const i of wanted) if (active(st)[i]) up.set(i, up.get(i)! + 1);
        }
        const used = start - points(st);
        const share = wanted.map(i => `${i}:${(up.get(i)! / observed).toFixed(2)}`).join(' ');
        console.log(`RESULT mode=${mode} period=${PERIOD} ticks=${st.tick - startTick} observed=${observed} points_start=${start} points_end=${points(st)} used=${used} active_share=${share}`);
    }
    let st = sdk.getState()!;
    for (const [i, on] of active(st).entries()) if (on) toggle(i);
    await ticks(2);
});
