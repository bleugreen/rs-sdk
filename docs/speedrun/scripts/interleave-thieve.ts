// Packets during pickpocket delays and stuns (rs/38 question 3).
//
//   bun docs/speedrun/scripts/interleave-thieve.ts <bot> [--outside=3] [--stunplan="1:hhhb,3:hhhb,5:hhhb"]
//       [--level=80] [--ticks=600] [--tag=x]
//
// Knight of Ardougne (Ardougne market, the rs/2 thieving target) at Thieving --level. Outside a
// stun the bot sends [h x --outside, pickpocket] every observed tick (helpers first, the click
// last; --outside=0 is rs/2's click-every-tick baseline). A non-adjacent knight costs 2 events
// for the click (MOVE_OPCLICK + OPNPC), so the helpers drop by one then (4 events per tick).
//
// Engine (read): pick_pocket does p_delay(0) before rolling; a failure does p_delay(0) twice
// more, then sets %stunned = %action_delay = map_clock + 8 (thieving.rs2:1-49, pickpocket.rs2
// :126-137). For an attempt on server tick T: success -> T+1 rejects every packet; failure ->
// T+1..T+3 reject, T+4..T+10 accept packets (the player is not delayed, the pickpocket script
// just returns), and T+11 is the earliest new attempt (rs/2 thieving.md: 11 ticks per failure).
//
// --stunplan: what to send at offsets from f, the observed tick of the "You fail to pick"
// message (printed after the first p_delay, so seen around T+2; offset k lands near T+2+k).
// Letters: h helper (bronze arrows), b bury dragon bones (OPHELD, p_delay(0)), e Lvl-1 Enchant
// sapphire ring (OPHELDT 1155, p_delay(1)), a High Alchemy on an iron bar (OPHELDT 1178,
// p_delay(3)), '-' nothing. Offsets in the plan suppress the pickpocket click; clicks resume at
// offset --resume (default 7) and at every offset the plan does not name.
// Measured per failure: ticks from f to the next observed attempt (success or failure), which
// should match the baseline if the stun-time actions do not delay the next attempt.
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
const OUTSIDE = Number(args.outside ?? 3);
const LEVEL = Number(args.level ?? 80);
const TICKS = Number(args.ticks ?? 600);
const RESUME = Number(args.resume ?? 7);
const PLAN_SRC = args.stunplan ?? '';
const plan = new Map<number, string>();
for (const part of PLAN_SRC.split(',').filter(Boolean)) { const [k, acts] = part.split(/[:_]/); plan.set(Number(k), acts === '-' ? '' : acts!); }
const TAG = `out${OUTSIDE}-${PLAN_SRC ? PLAN_SRC.replace(/[:,]/g, '_') : 'noplan'}-lv${LEVEL}${args.tag ? '-' + args.tag : ''}`;
const LOG = `${process.env.LAB_LOG ?? process.env.TMPDIR ?? '/tmp'}/interleave-thieve-${TAG}.log`;
writeFileSync(LOG, `# interleave-thieve ${process.argv.slice(2).join(' ')}\n`);
const log = (l: string) => appendFileSync(LOG, l + '\n');
const xpOf = (s: BotWorldState, k: string) => s.skills.find(x => x.name.toLowerCase() === k)?.experience ?? 0;
const slotOf = (s: BotWorldState, re: RegExp): InventoryItem | undefined => s.inventory.find(i => re.test(i.name));
const uses = (c: string) => [...plan.values()].some(a => a.includes(c));

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial?.();
    await sdk.waitForTicks(2);
    for (const item of [...(sdk.getState()?.inventory ?? [])]) await sdk.sendDropItem(item.slot);
    await sdk.waitForTicks(2);
    for (const st of ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'fletching', 'prayer']) await sdk.sendSay(`::setstat ${st} 99`);
    await sdk.sendSay(`::setstat thieving ${LEVEL}`);
    await sdk.sendSay('::give headless_arrow 60000');
    await sdk.sendSay('::give bronze_arrowheads 60000');
    if (uses('b')) await sdk.sendSay('::give dragon_bones 12');
    if (uses('e')) { await sdk.sendSay('::give sapphire_ring 12'); await sdk.sendSay('::give cosmicrune 2000'); await sdk.sendSay('::give waterrune 2000'); }
    if (uses('a')) { await sdk.sendSay('::give naturerune 1000'); await sdk.sendSay('::give firerune 5000'); await sdk.sendSay('::give iron_bar 8'); }
    await sdk.sendSay('::tele 0,41,51,29,37');
    await sdk.waitForTicks(8);
    for (const d of [0, 1, 2]) if (sdk.getState()?.dialog?.isOpen) { await sdk.sendClickDialog(0); await sdk.waitForTicks(1 + d); }
    sdk.getNewChat({ types: [0] });

    const s0 = sdk.getState()!;
    const t0 = s0.tick;
    const x0 = { th: xpOf(s0, 'thieving'), f: xpOf(s0, 'fletching'), p: xpOf(s0, 'prayer'), m: xpOf(s0, 'magic') };
    let last = { ...x0 };
    const attempts: Array<{ t: number; ok: boolean }> = [];
    const fails: number[] = []; // observed tick f of each failure message
    const recover: number[] = []; // f -> next observed attempt
    let f = -1000;
    let helpersSent = 0, extrasSent = 0, refills = 0, levelups = 0;
    let helpersInStun = 0, helpersOutside = 0;
    let buried = 0, enchanted = 0, alched = 0;
    const PER_ACTION = 487; // bronze arrows: game xp per 15-arrow action

    await new Promise<void>(resolve => {
        let acted = -1;
        const off = sdk.onStateUpdate((s: BotWorldState) => {
            if (!s?.inGame) return;
            const t = s.tick;
            if (acted === t) return;
            acted = t;
            const inStun = t - f >= 1 && t - f <= RESUME + 2;
            const th = xpOf(s, 'thieving');
            if (th > last.th) { attempts.push({ t, ok: true }); log(`T${t} SUCCESS`); last.th = th; }
            const fx = xpOf(s, 'fletching');
            if (fx > last.f) { const n = (fx - last.f) / PER_ACTION; if (inStun) helpersInStun += n; else helpersOutside += n; log(`T${t} HELPER ${n.toFixed(1)}${inStun ? ' (stun)' : ''}`); last.f = fx; }
            const px = xpOf(s, 'prayer');
            if (px > last.p) { buried += Math.round((px - last.p) / 1800); log(`T${t} BURIED`); last.p = px; }
            const mx = xpOf(s, 'magic');
            if (mx > last.m) { if (uses('a')) alched++; else enchanted++; log(`T${t} MAGIC xp`); last.m = mx; }
            for (const msg of sdk.getNewChat({ types: [0] })) {
                if (/fail to pick/i.test(msg.text) && t - f > 4) {
                    if (f > 0 && recover.length < fails.length) log(`T${t} (previous stun never recovered)`);
                    f = t; fails.push(t); attempts.push({ t, ok: false }); log(`T${t} FAIL (stun anchor)`);
                }
                if (/advanced/i.test(msg.text)) levelups++;
            }
            // first attempt after the anchor
            if (fails.length && recover.length < fails.length) {
                const next = attempts.find(a => a.t > f + 2);
                if (next) { recover.push(next.t - f); log(`T${t} recovered after ${next.t - f}`); }
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
            const k = t - f;
            if (plan.has(k)) {
                for (const a of plan.get(k)!) {
                    if (a === 'h') helper();
                    else if (a === 'b' || a === 'e' || a === 'a') {
                        const it = slotOf(s, a === 'b' ? /^dragon bones$/i : a === 'e' ? /^sapphire ring$/i : /^iron bar$/i);
                        if (!it) { sent.push(`no-${a}`); continue; }
                        if (a === 'b') sdk.sendUseItem(it.slot, it.optionsWithIndex.find(o => /^bury$/i.test(o.text))?.opIndex ?? 1).catch(() => {});
                        else sdk.sendSpellOnItem(it.slot, a === 'e' ? 1155 : 1178).catch(() => {});
                        extrasSent++;
                        sent.push(a === 'b' ? 'bury' : a === 'e' ? 'enchant' : 'alch');
                    }
                }
                log(`T${t} stun+${k} [${sent.join(', ')}]`);
                return;
            }
            if (k >= 1 && k < RESUME) { log(`T${t} stun+${k} []`); return; }
            // Outside the stun: top up supplies (lab stand-in for a helper trade), then helpers + click.
            const low = (re: RegExp) => s.inventory.filter(i => re.test(i.name)).length < 4;
            if (uses('b') && low(/^dragon bones$/i)) { sdk.sendSay('::give dragon_bones 8').catch(() => {}); refills++; }
            if (uses('e') && low(/^sapphire ring$/i)) { sdk.sendSay('::give sapphire_ring 8').catch(() => {}); refills++; }
            if (uses('a') && low(/^iron bar$/i)) { sdk.sendSay('::give iron_bar 6').catch(() => {}); refills++; }
            const n = Math.min(OUTSIDE, knight.distance > 1 ? 2 : 3);
            for (let i = 0; i < n; i++) helper();
            sdk.sendInteractNpc(knight.index, op).catch(() => {});
            sent.push('pick');
            log(`T${t} send [${sent.join(', ')}]`);
        });
    });

    const end = sdk.getState()!;
    const span = end.tick - t0;
    const thBase = (xpOf(end, 'thieving') - x0.th) / 25;
    const succ = attempts.filter(a => a.ok).length;
    const rh: Record<number, number> = {};
    for (const r of recover) rh[r] = (rh[r] ?? 0) + 1;
    const summary = [
        `== interleave-thieve ${TAG} (NODE_TICKRATE=${process.env.NODE_TICKRATE ?? '?'}) ==`,
        `span ${span} ticks: ${succ} successes, ${fails.length} failures; thieving ${thBase} base = ${(thBase / span).toFixed(3)} per tick; ticks per attempt ${(span / Math.max(1, attempts.length)).toFixed(2)}; level-ups ${levelups}`,
        `failure -> next attempt (observed ticks:count) ${Object.entries(rh).map(([a, b]) => `${a}:${b}`).join(' ')}`,
        `stun plan ${PLAN_SRC || '(none)'}: extras sent ${extrasSent}; buried ${buried}, enchanted ${enchanted}, alched ${alched} = ${fails.length ? ((buried + enchanted + alched) / fails.length).toFixed(2) : '0'} per stun; refills ${refills}`,
        `helpers: ${((xpOf(end, 'fletching') - x0.f) / PER_ACTION).toFixed(1)} landed of ${helpersSent} sent; outside stuns ${helpersOutside.toFixed(1)}, inside ${helpersInStun.toFixed(1)} (${fails.length ? (helpersInStun / fails.length).toFixed(1) : 0} per stun)`,
        `log ${LOG}`
    ].join('\n');
    log(summary);
    console.log(summary);
}, { timeout: 60 * 60_000, printState: false });
