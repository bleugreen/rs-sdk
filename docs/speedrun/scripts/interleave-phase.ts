// Phase-locked interleaving: a per-phase packet plan on the gathering clock (rs/38).
//
//   bun docs/speedrun/scripts/interleave-phase.ts <bot> --skill=wc|fish --plan="1:hhhc,2:hhhb,3:-,0:hhhc"
//       [--helper=arrows|none] [--extra=bury|enchant] [--ticks=450] [--level=99] [--tag=x]
//
// Phase p of observed tick o is (o - (x - 1)) mod cycle, where x is the observed tick of the
// most recent gathering xp drop. Packets sent while handling o land on the server tick after
// the one o reports, so phase 0 is the send tick that lands ON the roll tick, phase 1 the
// arming tick after it (the clock re-arms when %action_delay < map_clock), and so on
// (measured: interleave-gather.ts --skip=roll, catches follow phase-0 sends by one tick).
// Plan letters per phase, sent in order:
//   h  delay-free helper (--helper; a product drop takes the first h when there is one)
//   b  bury the first bones (OPHELD1, bury_bone.rs2: p_stopaction + p_delay(0))
//   e  Lvl-1 Enchant on a sapphire ring (OPHELDT com 1155, enchant.rs2: xp, then p_delay(1))
//   c  re-click the gathering target
//   -  send nothing
// Unlocked (start, new target, or no xp for 6 cycles): click once, then send nothing until
// an xp drop locks the phase. Supplies for b/e are topped up with ::give (standing in for a
// helper trade) on a '-' phase. Log: $LAB_LOG/interleave-phase-<tag>.log.
import { runScript } from '../../../sdk/runner';
import type { BotWorldState, InventoryItem } from '../../../sdk/types';
import { appendFileSync, writeFileSync } from 'fs';

const args: Record<string, string> = Object.fromEntries(
    process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
        const [key, ...v] = a.slice(2).split('=');
        return [key, v.length ? v.join('=') : 'true'];
    })
);
const skillName = args.skill ?? 'wc';
const helperName = args.helper ?? 'arrows';
const extraName = args.extra ?? 'bury';
const TICKS = Number(args.ticks ?? 450);
const LEVEL = Number(args.level ?? 99);
const PLAN_SRC = args.plan ?? '1:hhhc,2:hhhb,3:-,0:hhhc';
const TAG = `${skillName}-${PLAN_SRC.replace(/[:,]/g, '_')}-${helperName}-${extraName}${args.tag ? '-' + args.tag : ''}`;
const LOG = args.log ?? `${process.env.LAB_LOG ?? process.env.TMPDIR ?? '/tmp'}/interleave-phase-${TAG}.log`;
writeFileSync(LOG, `# interleave-phase ${process.argv.slice(2).join(' ')}\n`);
const log = (line: string) => appendFileSync(LOG, line + '\n');

type Target = { kind: 'loc'; x: number; z: number; id: number; op: number } | { kind: 'npc'; index: number; op: number; x: number; z: number };
const GATHERS = {
    wc: { skill: 'woodcutting', tele: '0,48,50,15,34', give: [['rune_axe', 1]] as [string, number][], kind: 'loc', name: /^willow/i, option: /^chop/i, product: /^willow logs$/i, cycle: 4 },
    fish: { skill: 'fishing', tele: '0,48,53,31,38', give: [['fly_fishing_rod', 1], ['feather', 20000]] as [string, number][], kind: 'npc', name: /^fishing spot$/i, option: /^lure$/i, product: /^raw /i, cycle: 5 }
} as const;
const gather = GATHERS[skillName as keyof typeof GATHERS];
if (!gather) { console.error('--skill=wc|fish'); process.exit(2); }
const plan = new Map<number, string>();
// ':' or '_' between phase and letters (interleave-lab.sh splits script arguments on ':').
for (const part of PLAN_SRC.split(',')) { const [p, acts] = part.split(/[:_]/); plan.set(Number(p), acts === '-' ? '' : acts!); }
if ([...plan.keys()].some(k => Number.isNaN(k))) { console.error(`bad --plan ${PLAN_SRC}`); process.exit(2); }

const EXTRAS = {
    bury: { skill: 'prayer', give: [['dragon_bones', 12]] as [string, number][], item: /^dragon bones$/i, low: 4, refill: 'dragon_bones' },
    enchant: { skill: 'magic', give: [['sapphire_ring', 12], ['cosmicrune', 5000], ['waterrune', 5000]] as [string, number][], item: /^sapphire ring$/i, low: 4, refill: 'sapphire_ring' }
} as const;
const extra = EXTRAS[extraName as keyof typeof EXTRAS];
const HELPER_ITEMS: [string, number][] = helperName === 'arrows' ? [['headless_arrow', 60000], ['bronze_arrowheads', 60000]] : [];

const xpOf = (s: BotWorldState, skill: string) => s.skills.find(k => k.name.toLowerCase() === skill)?.experience ?? 0;
const slotOf = (s: BotWorldState, re: RegExp): InventoryItem | undefined => s.inventory.find(i => re.test(i.name));

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial?.();
    await sdk.waitForTicks(2);
    for (const item of [...(sdk.getState()?.inventory ?? [])]) await sdk.sendDropItem(item.slot);
    await sdk.waitForTicks(2);
    for (const st of ['attack', 'strength', 'defence', 'hitpoints', 'ranged']) await sdk.sendSay(`::setstat ${st} 99`);
    await sdk.sendSay(`::setstat ${gather.skill} ${LEVEL}`);
    await sdk.sendSay('::setstat fletching 99');
    await sdk.sendSay(`::setstat ${extra.skill} 99`);
    for (const [obj, n] of [...gather.give, ...HELPER_ITEMS, ...extra.give]) await sdk.sendSay(`::give ${obj} ${n}`);
    const [, mx, mz, lx, lz] = gather.tele.split(',').map(Number);
    for (let attempt = 0; attempt < 5; attempt++) {
        await sdk.sendSay(`::tele ${gather.tele}`);
        await sdk.waitForTicks(6);
        const p = sdk.getState()?.player;
        if (p && Math.abs(p.worldX - (mx! * 64 + lx!)) <= 1 && Math.abs(p.worldZ - (mz! * 64 + lz!)) <= 1) break;
    }
    await sdk.waitForTicks(3);
    for (const d of [0, 1, 2]) if (sdk.getState()?.dialog?.isOpen) { await sdk.sendClickDialog(0); await sdk.waitForTicks(1 + d); }
    {
        const s = sdk.getState()!;
        console.log(`setup: at ${s.player?.worldX},${s.player?.worldZ}; inventory ${s.inventory.map(i => `${i.name}x${i.count}`).join(', ')}`);
    }

    const findTarget = (s: BotWorldState): Target | null => {
        if (gather.kind === 'loc') {
            const l = s.nearbyLocs.filter(l => gather.name.test(l.name) && l.optionsWithIndex.some(o => gather.option.test(o.text))).sort((a, b) => a.distance - b.distance)[0];
            return l ? { kind: 'loc', x: l.x, z: l.z, id: l.id, op: l.optionsWithIndex.find(o => gather.option.test(o.text))!.opIndex } : null;
        }
        const spots = s.nearbyNpcs.filter(n => gather.name.test(n.name) && n.optionsWithIndex.some(o => gather.option.test(o.text)));
        // Sticky: keep the current spot while it exists (two spots at equal distance would
        // otherwise flip the target and drop the phase lock).
        const n = (current?.kind === 'npc' && spots.find(x => x.index === (current as any).index)) || spots.sort((a, b) => a.distance - b.distance)[0];
        return n ? { kind: 'npc', index: n.index, x: n.x, z: n.z, op: n.optionsWithIndex.find(o => gather.option.test(o.text))!.opIndex } : null;
    };
    const same = (a: Target | null, b: Target | null) => !!a && !!b && a.kind === b.kind && (a.kind === 'loc' ? a.x === b.x && a.z === b.z && a.id === (b as any).id : a.index === (b as any).index);
    const click = (tgt: Target) => {
        if (tgt.kind === 'loc') sdk.sendInteractLoc(tgt.x, tgt.z, tgt.id, tgt.op).catch(() => {});
        else sdk.sendInteractNpc(tgt.index, tgt.op).catch(() => {});
        return 'click';
    };

    const start = sdk.getState()!;
    const startTick = start.tick;
    const g0 = xpOf(start, gather.skill), h0 = xpOf(start, 'fletching'), e0 = xpOf(start, extra.skill);
    let lastG = g0, lastE = e0;
    const gTicks: number[] = [];
    const eTicks: number[] = [];
    let lockX: number | null = null; // observed tick of the last gather xp drop while locked
    let current: Target | null = null;
    let clickedAt = -1;
    let lockedTicks = 0, unlockedTicks = 0, unlocks = 0, extraSent = 0, helperSent = 0, refills = 0;
    const phaseOf = (o: number) => (((o - (lockX! - 1)) % gather.cycle) + gather.cycle) % gather.cycle;

    await new Promise<void>(resolve => {
        let acted = -1;
        const off = sdk.onStateUpdate((s: BotWorldState) => {
            if (!s?.inGame) return;
            const t = s.tick;
            const g = xpOf(s, gather.skill);
            if (g > lastG) { gTicks.push(t); log(`T${t} GATHER +${g - lastG}${lockX === null ? ' (locks)' : ''}`); lastG = g; lockX = t; }
            const e = xpOf(s, extra.skill);
            if (e > lastE) { eTicks.push(t); log(`T${t} EXTRA +${e - lastE}`); lastE = e; }
            if (t - startTick >= TICKS) { off(); resolve(); return; }
            if (acted === t) return;
            acted = t;

            const tgt = findTarget(s);
            if (!tgt) { log(`T${t} no target`); return; }
            if (!same(tgt, current) || (lockX !== null && t - lockX > 6 * gather.cycle && t - clickedAt > 6 * gather.cycle)) {
                // New target (depleted tree, moved spot) or a lost lock: plain click, then wait for xp.
                if (current) unlocks++;
                current = tgt; lockX = null; clickedAt = t;
                click(tgt);
                log(`T${t} unlocked: click ${tgt.kind === 'loc' ? `${tgt.id}@${tgt.x},${tgt.z}` : `#${tgt.index}`}`);
                return;
            }
            if (lockX === null) {
                unlockedTicks++;
                // Waiting for the first xp drop: keep the inventory open (drop + re-click) and
                // re-click if nothing happens for 4 cycles.
                const prod = s.inventory.find(i => gather.product.test(i.name));
                if (prod && s.inventory.length >= 26) { sdk.sendDropItem(prod.slot).catch(() => {}); click(tgt); log(`T${t} unlocked: drop + click`); }
                else if (t - clickedAt > 4 * gather.cycle) { clickedAt = t; click(tgt); log(`T${t} unlocked: re-click`); }
                return;
            }
            lockedTicks++;
            const ph = phaseOf(t);
            const acts = plan.get(ph) ?? '';
            const sent: string[] = [];
            let dropped = false;
            for (const a of acts) {
                if (a === 'h') {
                    const prod = !dropped ? s.inventory.find(i => gather.product.test(i.name)) : undefined;
                    if (prod) { sdk.sendDropItem(prod.slot).catch(() => {}); dropped = true; sent.push('drop'); continue; }
                    if (helperName === 'none') continue;
                    const x = slotOf(s, /^headless arrow$/i), y = slotOf(s, /^bronze arrow(head|tip)s$/i);
                    if (x && y) { sdk.sendUseItemOnItem(x.slot, y.slot).catch(() => {}); helperSent++; sent.push('h'); }
                } else if (a === 'b' || a === 'e') {
                    const it = slotOf(s, extra.item);
                    if (!it) { sent.push('no-extra'); continue; }
                    if (a === 'b') {
                        const op = it.optionsWithIndex.find(o => /^bury$/i.test(o.text))?.opIndex ?? 1;
                        sdk.sendUseItem(it.slot, op).catch(() => {});
                    } else {
                        sdk.sendSpellOnItem(it.slot, 1155).catch(() => {});
                    }
                    extraSent++;
                    sent.push(a === 'b' ? 'bury' : 'enchant');
                } else if (a === 'c') {
                    sent.push(click(tgt));
                }
            }
            if (acts === '' && s.inventory.filter(i => extra.item.test(i.name)).length < extra.low) {
                sdk.sendSay(`::give ${extra.refill} 8`).catch(() => {});
                refills++;
                sent.push('refill');
            }
            log(`T${t} ph${ph} send [${sent.join(', ')}]`);
        });
    });

    const end = sdk.getState()!;
    const span = end.tick - startTick;
    const gaps: number[] = [];
    for (let i = 1; i < gTicks.length; i++) gaps.push(gTicks[i]! - gTicks[i - 1]!);
    const hist: Record<number, number> = {};
    for (const g of gaps) hist[g] = (hist[g] ?? 0) + 1;
    const gBase = (xpOf(end, gather.skill) - g0) / 25;
    const summary = [
        `== interleave-phase ${TAG} (NODE_TICKRATE=${process.env.NODE_TICKRATE ?? '?'}) ==`,
        `plan ${PLAN_SRC} on the ${gather.cycle}-tick ${gather.skill} clock; span ${span} ticks (${lockedTicks} locked, ${unlockedTicks} waiting for a lock, ${unlocks} unlocks)`,
        `gather: ${gTicks.length} xp drops, ${gBase} base = ${(gBase / span).toFixed(3)} per tick; gap histogram ${Object.entries(hist).map(([k, v]) => `${k}:${v}`).join(' ')}`,
        `extra ${extraName}: ${eTicks.length} landed of ${extraSent} sent = ${(eTicks.length / span).toFixed(3)} per tick (${((xpOf(end, extra.skill) - e0) / 25).toFixed(1)} base ${extra.skill}); refills ${refills}`,
        `helper ${helperName}: ${helperSent} sent, ${((xpOf(end, 'fletching') - h0) / 487).toFixed(1)} landed = ${((xpOf(end, 'fletching') - h0) / 487 / span).toFixed(2)} per tick`,
        `log ${LOG}`
    ].join('\n');
    log(summary);
    console.log(summary);
}, { timeout: 60 * 60_000, printState: false });
