// Packets during pickpocket delays and stuns (rs/38 question 3).
//
//   bun docs/speedrun/scripts/interleave-thieve.ts <bot> [--helper=arrows|none] [--stun=none|alch|helpers]
//       [--level=99] [--ticks=450] [--tag=x]
//
// Knight of Ardougne (Ardougne market, the rs/2 thieving target), Thieving --level. Every
// observed tick the bot sends [h, h, h, pickpocket] (helpers first, the click last; --helper=none
// sends only the click, which is rs/2's click-every-tick baseline). Expected from the engine:
//   success: click lands on T, pick_pocket p_delay(0) -> every packet on T+1 is rejected
//            (OpHeld*/OpNpc handlers return on player.delayed), so helpers land on T only;
//   failure: p_delay(0) x3 -> T+1..T+3 rejected, then %stunned until T+11 with the player NOT
//            delayed (thieving.rs2:26-49), so packets on T+4..T+10 run normally.
// --stun=alch: when "You've been stunned!" is seen, send one High Alchemy (OPHELDT com 1178,
//   alchemy.rs2: xp, then p_delay(3)) and nothing else until the stun should end; shows whether a
//   5-tick blackout fits inside the stun without delaying the next attempt.
// --stun=helpers: inside a stun send 5 helpers per tick (no click).
// Log: $LAB_LOG/interleave-thieve-<tag>.log; summary on stdout.
import { runScript } from '../../../sdk/runner';
import type { BotWorldState, InventoryItem } from '../../../sdk/types';
import { appendFileSync, writeFileSync } from 'fs';

const args: Record<string, string> = Object.fromEntries(
    process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
        const [key, ...v] = a.slice(2).split('=');
        return [key, v.length ? v.join('=') : 'true'];
    })
);
const HELPER = args.helper ?? 'arrows';
const STUN = args.stun ?? 'none';
const LEVEL = Number(args.level ?? 99);
const TICKS = Number(args.ticks ?? 450);
const TAG = `${HELPER}-stun_${STUN}-lv${LEVEL}${args.tag ? '-' + args.tag : ''}`;
const LOG = `${process.env.LAB_LOG ?? process.env.TMPDIR ?? '/tmp'}/interleave-thieve-${TAG}.log`;
writeFileSync(LOG, `# interleave-thieve ${process.argv.slice(2).join(' ')}\n`);
const log = (l: string) => appendFileSync(LOG, l + '\n');
const xpOf = (s: BotWorldState, k: string) => s.skills.find(x => x.name.toLowerCase() === k)?.experience ?? 0;
const slotOf = (s: BotWorldState, re: RegExp): InventoryItem | undefined => s.inventory.find(i => re.test(i.name));

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial?.();
    await sdk.waitForTicks(2);
    for (const item of [...(sdk.getState()?.inventory ?? [])]) await sdk.sendDropItem(item.slot);
    await sdk.waitForTicks(2);
    for (const st of ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'fletching']) await sdk.sendSay(`::setstat ${st} 99`);
    await sdk.sendSay(`::setstat thieving ${LEVEL}`);
    if (HELPER === 'arrows') { await sdk.sendSay('::give headless_arrow 60000'); await sdk.sendSay('::give bronze_arrowheads 60000'); }
    if (STUN === 'alch') { await sdk.sendSay('::give naturerune 1000'); await sdk.sendSay('::give firerune 5000'); await sdk.sendSay('::give iron_bar 10'); }
    await sdk.sendSay('::tele 0,41,51,29,37');
    await sdk.waitForTicks(8);
    for (const d of [0, 1, 2]) if (sdk.getState()?.dialog?.isOpen) { await sdk.sendClickDialog(0); await sdk.waitForTicks(1 + d); }
    sdk.getNewChat({ types: [0] });

    const s0 = sdk.getState()!;
    const t0 = s0.tick;
    const th0 = xpOf(s0, 'thieving'), f0 = xpOf(s0, 'fletching'), m0 = xpOf(s0, 'magic');
    let lastTh = th0, lastF = f0, lastM = m0;
    const succTicks: number[] = [];
    const failTicks: number[] = [];
    let stunSeen = -1; // observed tick of the last "stunned" message
    let alchs = 0, alchLanded = 0, helpersSent = 0, refills = 0, drains = 0;
    // helper actions landed per observed tick, split by context
    let helpersInStun = 0, helpersOutside = 0, stunTicks = 0;
    const PER_ACTION = 487; // bronze arrows, game xp per 15-arrow action

    await new Promise<void>(resolve => {
        let acted = -1;
        const off = sdk.onStateUpdate((s: BotWorldState) => {
            if (!s?.inGame) return;
            const t = s.tick;
            if (acted === t) return;
            acted = t;
            const th = xpOf(s, 'thieving');
            if (th > lastTh) { succTicks.push(t); log(`T${t} SUCCESS`); lastTh = th; }
            const f = xpOf(s, 'fletching');
            const inStun = stunSeen >= 0 && t > stunSeen && t <= stunSeen + 7;
            if (inStun) stunTicks++;
            if (f > lastF) {
                const n = (f - lastF) / PER_ACTION;
                if (inStun) helpersInStun += n; else helpersOutside += n;
                log(`T${t} HELPER ${n.toFixed(1)}${inStun ? ' (stun)' : ''}`);
                lastF = f;
            }
            const m = xpOf(s, 'magic');
            if (m > lastM) { alchLanded++; log(`T${t} ALCH xp`); lastM = m; }
            for (const msg of sdk.getNewChat({ types: [0] })) {
                if (/fail to pick/i.test(msg.text)) { failTicks.push(t); log(`T${t} FAIL`); }
                if (/stunned/i.test(msg.text)) { stunSeen = t; log(`T${t} STUNNED`); }
            }
            if (t - t0 >= TICKS) { off(); resolve(); return; }

            const knight = s.nearbyNpcs.filter(n => /^knight of ardougne$/i.test(n.name)).sort((a, b) => a.distance - b.distance)[0];
            if (!knight) { log(`T${t} no knight`); return; }
            const op = knight.optionsWithIndex.find(o => /pickpocket/i.test(o.text))?.opIndex ?? 3;
            const sent: string[] = [];
            const helper = () => {
                const x = slotOf(s, /^headless arrow$/i), y = slotOf(s, /^bronze arrow(head|tip)s$/i);
                if (!x || !y) return;
                sdk.sendUseItemOnItem(x.slot, y.slot).catch(() => {});
                helpersSent++;
                sent.push('h');
            };
            if (inStun && STUN === 'alch') {
                if (t === stunSeen + 1) {
                    const bar = slotOf(s, /^iron bar$/i);
                    if (bar) { sdk.sendSpellOnItem(bar.slot, 1178).catch(() => {}); alchs++; sent.push('alch'); }
                    if (s.inventory.filter(i => /^iron bar$/i.test(i.name)).length < 3) { sdk.sendSay('::give iron_bar 6').catch(() => {}); refills++; }
                }
                // then nothing until the stun should be over; resume clicking at stunSeen+6
                if (t < stunSeen + 6) { log(`T${t} stun [${sent.join(', ')}]`); return; }
            } else if (inStun && STUN === 'helpers') {
                for (let i = 0; i < 5; i++) helper();
                log(`T${t} stun [${sent.join(', ')}]`);
                return;
            }
            // A click on a non-adjacent knight is MOVE_OPCLICK + OPNPC (2 events): keep the burst at
            // 4 events. After 5 ticks with no attempt, send the click alone so a backlog drains.
            const lastAttempt = Math.max(succTicks.at(-1) ?? t0, failTicks.at(-1) ?? t0);
            const stalled = !inStun && t - lastAttempt > 5;
            const nHelpers = HELPER !== 'arrows' || stalled ? 0 : knight.distance > 1 ? 2 : 3;
            if (stalled) drains++;
            for (let i = 0; i < nHelpers; i++) helper();
            sdk.sendInteractNpc(knight.index, op).catch(() => {});
            sent.push('pick');
            log(`T${t} send [${sent.join(', ')}]`);
        });
    });

    const end = sdk.getState()!;
    const span = end.tick - t0;
    const thBase = (xpOf(end, 'thieving') - th0) / 25;
    const helpers = (xpOf(end, 'fletching') - f0) / PER_ACTION;
    const outsideTicks = span - stunTicks;
    const summary = [
        `== interleave-thieve ${TAG} (NODE_TICKRATE=${process.env.NODE_TICKRATE ?? '?'}) ==`,
        `span ${span} ticks: ${succTicks.length} successes, ${failTicks.length} failures; thieving ${thBase} base = ${(thBase / span).toFixed(3)} per tick; ticks per attempt ${(span / Math.max(1, succTicks.length + failTicks.length)).toFixed(2)}`,
        `helpers: ${helpers.toFixed(1)} landed of ${helpersSent} sent = ${(helpers / span).toFixed(2)} per tick; outside stuns ${helpersOutside.toFixed(1)} over ${outsideTicks} ticks (${(helpersOutside / Math.max(1, outsideTicks)).toFixed(2)}/tick), inside stuns ${helpersInStun.toFixed(1)} over ${stunTicks} ticks (${(helpersInStun / Math.max(1, stunTicks)).toFixed(2)}/tick)`,
        `alchs: ${alchLanded} landed of ${alchs} sent; refills ${refills}; click-only drain ticks ${drains}`,
        `log ${LOG}`
    ].join('\n');
    log(summary);
    console.log(summary);
}, { timeout: 60 * 60_000, printState: false });
