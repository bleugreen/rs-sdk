// Gathering rate with and without helper-fed actions interleaved into the same ticks (rs/38).
//
//   bun docs/speedrun/scripts/interleave-gather.ts <bot> --skill=wc|fish|mine [--helper=none|arrows|charge|potion|gem]
//       [--k=4] [--order=after|before|noclick] [--reclick=every|idle] [--ticks=300]
//       [--level=99] [--helperlevel=99] [--skip=roll] [--phase=0] [--tag=x]
//
// Every observed tick the bot sends one burst, in this order:
//   [drop one product?] [k helper actions] [re-click the gathering target]      (--order=after)
//   [drop?] [re-click] [k helper actions]                                         (--order=before)
//   [drop?] [k helper actions], re-click only when the loop is known to be dead   (--order=noclick)
// capped at the server's 5 user events per tick (ClientGameProtCategory.ts:6).
// --reclick=idle with --helper=none is the plain baseline: click once, re-click only on a
// depleted target, a dialog or a full inventory (drop-all + click).
// --skip=roll sends nothing on the predicted roll tick (fishing: its first-click label never
// rolls, freshfish.rs2:25-56), anchored open-loop on the bootstrap click; --phase shifts it.
//
// Helper actions (all delay-free, run inside the packet handler):
//   arrows  headless arrow on arrowheads (OPHELDU, arrows.rs2), 15 per action
//   charge  Charge (IF_BUTTON com 1193, charge.rs2; needs %magearena >= 8, set here)
//   potion  guam unfinished potion on eye of newt (OPHELDU, herblore.rs2)
//   gem     chisel on uncut sapphire (OPHELDU, uncut_gem.rs2)
//
// Every packet and every xp change is logged with its observed tick to --log
// (default $TMPDIR/interleave-<skill>-<helper>-<order>.log); the summary goes to stdout.
// Observed tick t = the lite client's count of server ticks; packets sent while handling t
// land in server tick t+1, and xp from server tick R is first seen at t = R+1.
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
const helperName = args.helper ?? 'none';
const K = helperName === 'none' ? 0 : Number(args.k ?? 4);
const ORDER = args.order ?? 'after';
const RECLICK = args.reclick ?? (K > 0 ? 'every' : 'idle');
const TICKS = Number(args.ticks ?? 300);
const LEVEL = Number(args.level ?? 99);
const HELPER_LEVEL = Number(args.helperlevel ?? 99);
const SKIP_ROLL = args.skip === 'roll';
const PHASE = Number(args.phase ?? 0);
const TAG = `${skillName}-${helperName}-k${K}-${ORDER}-${RECLICK}${SKIP_ROLL ? '-skiproll' : ''}${args.drain ? '-drain' : ''}${args.tag ? '-' + args.tag : ''}`;
const LOG = args.log ?? `${process.env.LAB_LOG ?? process.env.TMPDIR ?? '/tmp'}/interleave-${TAG}.log`;
writeFileSync(LOG, `# interleave-gather ${process.argv.slice(2).join(' ')}\n`);
const log = (line: string) => appendFileSync(LOG, line + '\n');

interface Gather {
    skill: string;
    tele: string;
    give: Array<[string, number]>;
    kind: 'loc' | 'npc';
    target: (s: BotWorldState) => Target | null;
    product: RegExp;
    /** Cycle length in ticks and the observed-tick offset (from the bootstrap send) of the first roll send. */
    cycle: number;
    rollSend: number;
}
type Target = { kind: 'loc'; x: number; z: number; id: number; op: number } | { kind: 'npc'; index: number; op: number; x: number; z: number };

const IRON_IDS = [2092, 2093]; // ironrock1/2 (mining-lib.ts)
const MINE_STAND: [number, number] = [3295, 3310]; // Al Kharid, 2 iron rocks adjacent (mining-cycle.ts default)
const locTarget = (name: RegExp, option: RegExp) => (s: BotWorldState): Target | null => {
    const l = s.nearbyLocs
        .filter(l => name.test(l.name) && l.optionsWithIndex.some(o => option.test(o.text)))
        .sort((a, b) => a.distance - b.distance)[0];
    return l ? { kind: 'loc', x: l.x, z: l.z, id: l.id, op: l.optionsWithIndex.find(o => option.test(o.text))!.opIndex } : null;
};
const npcTarget = (name: RegExp, option: RegExp) => (s: BotWorldState): Target | null => {
    const n = s.nearbyNpcs
        .filter(n => name.test(n.name) && n.optionsWithIndex.some(o => option.test(o.text)))
        .sort((a, b) => a.distance - b.distance)[0];
    return n ? { kind: 'npc', index: n.index, x: n.x, z: n.z, op: n.optionsWithIndex.find(o => option.test(o.text))!.opIndex } : null;
};

const GATHERS: Record<string, Gather> = {
    // Draynor willows, rune axe: 4-tick clock (woodcut.rs2:153-160), first click arms it.
    wc: { skill: 'woodcutting', tele: '0,48,50,15,34', give: [['rune_axe', 1]], kind: 'loc', target: locTarget(/^willow/i, /^chop/i), product: /^willow logs$/i, cycle: 4, rollSend: 3 },
    // Barbarian Village lure, 5-tick clock (freshfish.rs2:77-87).
    fish: { skill: 'fishing', tele: '0,48,53,31,38', give: [['fly_fishing_rod', 1], ['feather', 20000]], kind: 'npc', target: npcTarget(/^fishing spot$/i, /^lure$/i), product: /^raw /i, cycle: 5, rollSend: 4 },
    // Al Kharid iron, rune pickaxe: 3-tick clock (mining.rs2:76-79,118-122). Target chosen below.
    mine: { skill: 'mining', tele: `0,${MINE_STAND[0] >> 6},${MINE_STAND[1] >> 6},${MINE_STAND[0] & 63},${MINE_STAND[1] & 63}`, give: [['rune_pickaxe', 1]], kind: 'loc', target: () => null, product: /ore$|^uncut|^clue/i, cycle: 3, rollSend: 2 }
};

interface Helper {
    skill: string;
    give: Array<[string, number]>;
    setup?: string[];
    /** Inventory/handler action; returns a description, or null when supplies are missing. */
    act: (sdk: any, s: BotWorldState) => string | null;
    /** Does the packet clear the gathering interaction (clearPendingAction)? */
    clears: boolean;
}
const slotOf = (s: BotWorldState, re: RegExp): InventoryItem | undefined => s.inventory.find(i => re.test(i.name));
const useOn = (a: RegExp, b: RegExp) => (sdk: any, s: BotWorldState) => {
    const x = slotOf(s, a), y = slotOf(s, b);
    if (!x || !y) return null;
    sdk.sendUseItemOnItem(x.slot, y.slot).catch(() => {});
    return `use ${x.name}@${x.slot} on ${y.name}@${y.slot}`;
};
const HELPERS: Record<string, Helper> = {
    none: { skill: '', give: [], act: () => null, clears: false },
    arrows: { skill: 'fletching', give: [['headless_arrow', 60000], ['bronze_arrowheads', 60000]], act: useOn(/^headless arrow$/i, /^bronze arrow(head|tip)s$/i), clears: true },
    charge: {
        skill: 'magic', give: [['bloodrune', 30000], ['airrune', 30000], ['firerune', 30000]], setup: ['::setvar magearena 8'],
        act: (sdk) => { sdk.sendClickComponent(1193).catch(() => {}); return 'charge'; }, clears: false
    },
    potion: { skill: 'herblore', give: [['guamvial', 6], ['eye_of_newt', 6]], act: useOn(/^guam potion \(unf\)$|^guam potion$/i, /^eye of newt$/i), clears: true },
    gem: { skill: 'crafting', give: [['chisel', 1], ['uncut_sapphire', 10]], act: useOn(/^chisel$/i, /^uncut sapphire$/i), clears: true }
};

const gather = GATHERS[skillName];
const helper = HELPERS[helperName];
if (!gather || !helper || !['after', 'before', 'noclick'].includes(ORDER)) {
    console.error(`usage: --skill=${Object.keys(GATHERS).join('|')} --helper=${Object.keys(HELPERS).join('|')} --order=after|before|noclick`);
    process.exit(2);
}

const xpOf = (s: BotWorldState, skill: string) => s.skills.find(k => k.name.toLowerCase() === skill)?.experience ?? 0;
const sameTarget = (a: Target | null, b: Target | null) =>
    !!a && !!b && a.kind === b.kind && (a.kind === 'loc' ? a.x === b.x && a.z === b.z && a.id === (b as any).id : a.index === (b as any).index);

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial?.();
    await sdk.waitForTicks(2);
    for (const item of [...(sdk.getState()?.inventory ?? [])]) await sdk.sendDropItem(item.slot);
    await sdk.waitForTicks(2);
    // Combat 99s: a level-3 bot is attacked (and killed) at the Draynor willows, and a high
    // combat level also stops most NPC aggression.
    for (const st of ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'prayer', 'magic']) await sdk.sendSay(`::setstat ${st} 99`);
    await sdk.sendSay(`::setstat ${gather.skill} ${LEVEL}`);
    if (helper.skill) await sdk.sendSay(`::setstat ${helper.skill} ${HELPER_LEVEL}`);
    for (const [obj, n] of [...gather.give, ...helper.give]) await sdk.sendSay(`::give ${obj} ${n}`);
    for (const c of helper.setup ?? []) await sdk.sendSay(c);
    const [, mx, mz, lx, lz] = gather.tele.split(',').map(Number);
    for (let attempt = 0; attempt < 5; attempt++) {
        await sdk.sendSay(`::tele ${gather.tele}`);
        await sdk.waitForTicks(6);
        const p = sdk.getState()?.player;
        if (p && Math.abs(p.worldX - (mx! * 64 + lx!)) <= 1 && Math.abs(p.worldZ - (mz! * 64 + lz!)) <= 1) break;
    }
    await sdk.waitForTicks(3);
    {
        const s = sdk.getState()!;
        console.log(`setup: at ${s.player?.worldX},${s.player?.worldZ}; inventory ${s.inventory.map(i => `${i.name}x${i.count}`).join(', ')}; members-check chat: ${sdk.getNewChat?.({ types: [0] })?.slice(-4).map((m: any) => m.text).join(' | ') ?? ''}`);
    }
    for (const d of [0, 1, 2]) if (sdk.getState()?.dialog?.isOpen) { await sdk.sendClickDialog(0); await sdk.waitForTicks(1 + d); }

    // Per-action helper xp, measured with one action before the run.
    let perAction = 0;
    if (helper.skill) {
        const s0 = sdk.getState()!;
        const x0 = xpOf(s0, helper.skill);
        helper.act(sdk, s0);
        await sdk.waitForTicks(3);
        perAction = xpOf(sdk.getState()!, helper.skill) - x0;
        console.log(`helper ${helperName}: one action = ${perAction} game xp (${perAction / 25} base)`);
        if (perAction <= 0) { console.log('helper action gave no xp; check supplies/members'); }
    }

    // Mining: choose among live iron rocks cardinally adjacent to the stand tile.
    const adj = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => [MINE_STAND[0] + dx!, MINE_STAND[1] + dz!] as [number, number]);
    const liveRock = (s: BotWorldState, x: number, z: number) => s.nearbyLocs.find(l => l.x === x && l.z === z && IRON_IDS.includes(l.id));
    const rockTarget = (s: BotWorldState, avoid: Target | null): Target | null => {
        for (const [x, z] of adj) {
            const l = liveRock(s, x, z);
            if (!l) continue;
            const t: Target = { kind: 'loc', x: l.x, z: l.z, id: l.id, op: l.optionsWithIndex.find(o => /^mine$/i.test(o.text))?.opIndex ?? 1 };
            if (!sameTarget(t, avoid)) return t;
        }
        return null;
    };

    const start = sdk.getState()!;
    const startTick = start.tick;
    const gx0 = xpOf(start, gather.skill);
    const hx0 = helper.skill ? xpOf(start, helper.skill) : 0;
    let lastG = gx0, lastH = hx0;
    const gTicks: number[] = [];
    const helperPerTick = new Map<number, number>();
    const sentPerTick = new Map<number, number>();
    const breaks: number[] = [];
    let current: Target | null = null;
    let anchor: number | null = null; // observed tick of the bootstrap click (open-loop schedule origin)
    let rollTick = -1; // mining: observed tick on which to switch to the next rock
    let actedTick = -1;
    let packets = 0, helperSent = 0, clicks = 0, drops = 0, dialogs = 0, skipped = 0;
    let dialogSince: number | null = null;
    let lastDrop = { tick: -1, slot: -1 };
    let lastPos = '';
    let idle = 0, drains = 0;

    const clickTarget = (t: number, tgt: Target) => {
        if (tgt.kind === 'loc') sdk.sendInteractLoc(tgt.x, tgt.z, tgt.id, tgt.op).catch(() => {});
        else sdk.sendInteractNpc(tgt.index, tgt.op).catch(() => {});
        clicks++;
        return `click ${tgt.kind}${tgt.kind === 'loc' ? ` ${tgt.id}@${tgt.x},${tgt.z}` : ` #${tgt.index}`}`;
    };

    await new Promise<void>(resolve => {
        const off = sdk.onStateUpdate((s: BotWorldState) => {
            if (!s?.inGame) return;
            const t = s.tick;
            const g = xpOf(s, gather.skill);
            if (g > lastG) { gTicks.push(t); log(`T${t} GATHER +${g - lastG}`); lastG = g; }
            if (helper.skill) {
                const h = xpOf(s, helper.skill);
                if (h > lastH) { helperPerTick.set(t, (helperPerTick.get(t) ?? 0) + (h - lastH)); log(`T${t} HELPER +${h - lastH} (${perAction ? ((h - lastH) / perAction).toFixed(2) : '?'} actions)`); lastH = h; }
            }
            if (s.dialog?.isOpen) { if (dialogSince === null) { dialogSince = t; dialogs++; log(`T${t} DIALOG open`); } }
            else if (dialogSince !== null) { log(`T${t} DIALOG closed after ${t - dialogSince}`); dialogSince = null; }

            if (t - startTick >= TICKS) { off(); resolve(); return; }
            if (actedTick === t) return;
            actedTick = t;

            // ---- what the gathering loop needs this tick ----
            let tgt: Target | null;
            let mustClick = false;
            if (skillName === 'mine') {
                if (current && !liveRock(s, current.x, (current as any).z)) current = null;
                if (current === null || t >= rollTick) {
                    const next = rockTarget(s, current);
                    if (next) { current = next; rollTick = t + 3; mustClick = true; if (anchor === null) anchor = t; }
                }
                tgt = current;
            } else {
                tgt = gather.target(s);
                if (tgt && current && gather.kind === 'npc' && (current as any).index === (tgt as any).index) tgt = current;
                if (!sameTarget(tgt, current)) { mustClick = true; breaks.push(t); anchor = null; }
                current = tgt;
                if (anchor === null && tgt) { anchor = t; mustClick = true; }
            }
            if (!tgt) { log(`T${t} no target`); return; }
            // A click on an out-of-reach target is two user events (MOVE_OPCLICK + OP, lite
            // actions.ts:77-84). Over 5 per tick the surplus is decoded next tick
            // (NetworkPlayer.ts:69), and a standing 1-packet backlog puts every later click ahead
            // of its own tick's helpers, which kill it. So: no helpers while switching or walking.
            const pos = `${s.player?.worldX},${s.player?.worldZ}`;
            // Mining switches between rocks adjacent to the stand tile: no route packet.
            const walking = (mustClick && skillName !== 'mine') || pos !== lastPos;
            lastPos = pos;
            // Backlog drain (--drain): if a burst straddles a tick boundary, the late click heads
            // the next tick's 5-event window, that tick's helpers clear it, and a full burst every
            // tick keeps the 1-packet backlog forever. When the player has been idle (no skill
            // anim) for 2 ticks, send the click alone so the backlog drains.
            idle = (s.player?.animId ?? -1) === -1 ? idle + 1 : 0;
            const drainTick = args.drain === 'true' && idle >= 2 && !walking;
            if (drainTick) { drains++; idle = 0; }

            if (SKIP_ROLL && anchor !== null && !mustClick && (t - anchor - gather.rollSend - PHASE) % gather.cycle === 0 && t > anchor) {
                skipped++;
                log(`T${t} skip (roll tick)`);
                return;
            }

            const burst: string[] = [];
            const products = s.inventory.filter(i => gather.product.test(i.name));
            const free = 28 - s.inventory.length;

            if (K === 0 && RECLICK === 'idle') {
                // Plain baseline.
                if (free <= 1 && products.length) {
                    for (const p of products.slice(0, 4)) { sdk.sendDropItem(p.slot).catch(() => {}); drops++; burst.push(`drop@${p.slot}`); }
                    burst.push(clickTarget(t, tgt));
                } else if (s.dialog?.isOpen) {
                    sdk.sendClickDialog(0).catch(() => {});
                    burst.push('dialog', clickTarget(t, tgt));
                } else if (mustClick) {
                    burst.push(clickTarget(t, tgt));
                }
            } else {
                const cap = 5;
                const wantClick = ORDER !== 'noclick' ? RECLICK === 'every' || mustClick : mustClick;
                let clearsLoop = false;
                // One product drop per tick whenever there is one (the gathered item is non-stackable).
                // The state lags the server by a tick, so skip a slot dropped on the previous tick.
                const dropCand = products.find(p => !(lastDrop.tick === t - 1 && lastDrop.slot === p.slot));
                if (dropCand && (ORDER !== 'noclick' || free <= 2)) {
                    const p = dropCand;
                    lastDrop = { tick: t, slot: p.slot };
                    sdk.sendDropItem(p.slot).catch(() => {});
                    drops++; clearsLoop = true;
                    burst.push(`drop@${p.slot}`);
                }
                const needClick = wantClick || (ORDER === 'noclick' && clearsLoop) || !!s.dialog?.isOpen && helper.clears === false;
                if (ORDER === 'before' && needClick) burst.push(clickTarget(t, tgt));
                const room = cap - burst.length - (ORDER !== 'before' && needClick ? 1 : 0);
                for (let i = 0; i < Math.min((walking || drainTick) && helper.clears ? 0 : K, room); i++) {
                    const d = helper.act(sdk, s);
                    if (!d) { burst.push('helper:none'); break; }
                    helperSent++;
                    burst.push(d.split(' ')[0] === 'use' ? 'use' : d);
                    if (helper.clears) clearsLoop = true;
                }
                if (ORDER !== 'before' && (needClick || (ORDER === 'noclick' && clearsLoop && helper.clears === false))) burst.push(clickTarget(t, tgt));
            }
            if (burst.length) {
                packets += burst.length;
                sentPerTick.set(t, burst.length);
                log(`T${t} send [${burst.join(', ')}]`);
            }
        });
    });

    // ---- summary ----
    const gaps: number[] = [];
    for (let i = 1; i < gTicks.length; i++) {
        const a = gTicks[i - 1]!, b = gTicks[i]!;
        if (breaks.some(x => x > a && x <= b)) continue;
        gaps.push(b - a);
    }
    const hist: Record<number, number> = {};
    for (const gp of gaps) hist[gp] = (hist[gp] ?? 0) + 1;
    const end = sdk.getState()!;
    const span = end.tick - startTick;
    const gameG = xpOf(end, gather.skill) - gx0;
    const helperActs = perAction ? (xpOf(end, helper.skill || gather.skill) - hx0) / perAction : 0;
    const perTickHist: Record<string, number> = {};
    for (const v of helperPerTick.values()) { const n = (v / perAction).toFixed(1); perTickHist[n] = (perTickHist[n] ?? 0) + 1; }
    const summary = [
        `== interleave-gather ${TAG} (NODE_TICKRATE=${process.env.NODE_TICKRATE ?? '?'}) ==`,
        `span ${span} observed ticks; gather xp events ${gTicks.length}; base gather xp ${gameG / 25} = ${(gameG / 25 / span).toFixed(3)} per tick; ticks per event ${(span / Math.max(1, gTicks.length)).toFixed(2)}`,
        `gap histogram (ticks:count, ${gaps.length} gaps, excluding target switches) ${Object.entries(hist).map(([k, v]) => `${k}:${v}`).join(' ')}`,
        `helper ${helperName}: ${helperActs.toFixed(1)} actions landed (${helperSent} sent) = ${(helperActs / span).toFixed(2)} per tick; per-tick landing histogram (actions:ticks) ${JSON.stringify(perTickHist)}`,
        `packets ${packets}, clicks ${clicks}, drops ${drops}, dialogs ${dialogs}, skipped roll ticks ${skipped}, target switches ${breaks.length}, drain ticks ${drains}`,
        `log ${LOG}`
    ].join('\n');
    log(summary);
    console.log(summary);
}, { timeout: 60 * 60_000, printState: false });
