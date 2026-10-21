// Underground Pass lab console: run a sequence of steps against a lab bot and
// print, after each step, the ticks it took, the position, hitpoints and the
// game messages it produced. Used to find coordinates, options and routes
// before writing the timed segment scripts.
//
//   bun docs/speedrun/scripts/quest-underground-pass-explore.ts <bot> <step>...
//
// Steps (coordinates are world x,z[,level]; regexes are case-insensitive):
//   tele:x,z[,l]          ::tele                 setvar:name:v   ::setvar
//   getvar:name           print a varp           stat:name:lvl   ::setstat
//   give:obj:n            ::give                 drop:regex      drop all matching
//   wear:regex            equip                  remove:regex    unequip
//   scan[:r]              locs, NPCs, ground items within r tiles (default 12)
//   walk:x,z              walkTo (the SDK pathfinder), tolerance 0
//   click:x,z             one raw run click (no pathfinding)
//   loc:regex:option[:x,z]   interact with a loc (nearest match, or at x,z)
//   npc:regex:option         interact with an NPC
//   talk:regex[:c1|c2...]    talk-to and answer (choices are a priority list)
//   dlg[:c1|c2...]           answer an already open dialogue
//   useloc:item:loc[:x,z]    use an inventory item on a loc
//   usenpc:item:npc          use an inventory item on an NPC
//   useitem:a:b              use item a on item b
//   rawloc:id:x,z[:op]       interact by loc id (bridge-flag locs the client does not list)
//   rawuse:item:id:x,z       use an item on a loc by id
//   take:regex               pick up a ground item
//   wait:n                   wait n ticks, printing position changes
//   inv / equip              print inventory / equipment

import { runScript } from '../../../sdk/runner';
import { opLoc, pickup, slotOf, talkTo, walkTo, wield } from '../../../speedrun/lib/act';
import { converse } from '../../../speedrun/lib/converse';
import { currentTick, waitUntil } from '../../../speedrun/lib/wait';
import { findLoc, findNpc, messagesSince, opIndex, pos } from '../../../speedrun/lib/world';
import { dropMatching, getvar, give, setstat, setvar, tele } from '../../../speedrun/lab/setup';

const steps = process.argv.slice(3);
const re = (s: string) => new RegExp(s, 'i');
/** x,z[,level] */
const coords = (s: string): [number, number, number] => {
    const [x, z, l] = s.split(',').map(Number);
    if (x === undefined || z === undefined || Number.isNaN(x) || Number.isNaN(z)) throw new Error(`bad coordinates ${s}`);
    return [x, z, l ?? 0];
};

await runScript(async ({ bot, sdk }) => {
    let msgFrom = currentTick(sdk) + 1;
    const flush = () => {
        const out = messagesSince(sdk, msgFrom);
        msgFrom = currentTick(sdk) + 1;
        return out;
    };
    const show = (label: string, t0: number, extra: unknown = '') => {
        const s = sdk.getState()!;
        const p = pos(sdk);
        console.log(`[${label}] +${s.tick - t0}t pos=(${p.x},${p.z},${p.level}) hp=${s.player?.hp}/${s.player?.maxHp} dlg=${s.dialog.isOpen ? 'open' : '-'} ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`);
        const m = flush();
        if (m.length) console.log('   msgs:', JSON.stringify(m));
    };
    /** Wait until the player has not moved (nor animated, with `anim`) for `still` ticks; an open dialogue ends the wait. */
    const settle = async (maxTicks = 30, still = 5, anim = true) => {
        let last = pos(sdk);
        let since = currentTick(sdk);
        await waitUntil(
            sdk,
            s => {
                if (s.dialog.isOpen) return true;
                const p = pos(s);
                if (p.x !== last.x || p.z !== last.z || p.level !== last.level || (anim && s.player?.animId !== -1)) since = s.tick;
                last = p;
                return s.tick - since >= still;
            },
            { maxTicks }
        );
    };
    await bot.dismissBlockingUI();
    flush();
    for (const step of steps) {
        const [cmd, ...a] = step.split(':');
        const arg = (i: number): string => {
            const v = a[i];
            if (v === undefined) throw new Error(`${cmd}: missing argument ${i + 1}`);
            return v;
        };
        const t0 = currentTick(sdk);
        try {
            if (cmd === 'tele') {
                const [x, z, l] = coords(arg(0));
                const landed = await tele(sdk, x, z, l);
                show(step, t0, landed ? '' : 'did not land');
            } else if (cmd === 'setvar') {
                await setvar(sdk, arg(0), Number(arg(1)));
                show(step, t0);
            } else if (cmd === 'getvar') {
                const v = await getvar(sdk, arg(0));
                show(step, t0, `${arg(0)}=${v}${v !== null ? ` bits=${(v >>> 0).toString(2)}` : ''}`);
            } else if (cmd === 'stat') {
                await setstat(sdk, arg(0), Number(arg(1)));
                show(step, t0);
            } else if (cmd === 'give') {
                await give(sdk, arg(0), Number(a[1] ?? 1));
                show(step, t0);
            } else if (cmd === 'drop') {
                await dropMatching(sdk, [re(arg(0))]);
                show(step, t0);
            } else if (cmd === 'wear') {
                const r = await wield(sdk, re(arg(0)));
                show(step, t0, r.ok ? 'worn' : `not worn (${r.reason})`);
            } else if (cmd === 'remove') {
                const r = await bot.unequipItem(re(arg(0)));
                show(step, t0, r.message);
            } else if (cmd === 'scan') {
                const r = Number(a[0] ?? 12);
                const locs = await sdk.scanNearbyLocs(r);
                const interesting = locs.filter(l => l.options.length > 0);
                console.log(`[scan r=${r}] at`, pos(sdk));
                for (const l of interesting) console.log(`   loc ${l.name} #${l.id} (${l.x},${l.z}) d=${l.distance} reach=${l.reachable} ops=${JSON.stringify(l.options)}`);
                for (const n of sdk.getNearbyNpcs()) console.log(`   npc ${n.name} lvl${n.combatLevel} (${n.x},${n.z}) tile=(${n.tileX},${n.tileZ}) idx=${n.index} reach=${n.reachable}`);
                for (const g of await sdk.scanGroundItems(r)) console.log(`   obj ${g.name} x${g.count} (${g.x},${g.z}) reach=${g.reachable}`);
                flush();
            } else if (cmd === 'walk') {
                const [x, z] = coords(arg(0));
                const w = await walkTo(bot, sdk, x, z, 0);
                show(step, t0, { ticks: w.ticks, tiles: w.tiles, success: w.ok, message: w.message });
            } else if (cmd === 'click') {
                const [x, z] = coords(arg(0));
                await sdk.sendWalk(x, z, true);
                await settle(80, 3, false);
                show(step, t0);
            } else if (cmd === 'loc' || cmd === 'useloc') {
                const [itemRe, locRe, where] = cmd === 'loc' ? [null, arg(0), a[2]] : [arg(0), arg(1), a[2]];
                const at = where ? coords(where) : null;
                const loc = await findLoc(sdk, { name: re(locRe), ...(at ? { x: at[0], z: at[1] } : {}), ...(itemRe ? {} : { op: re(arg(1)) }), radius: 30 });
                if (!loc) throw new Error(`no loc ${locRe}${itemRe ? '' : ` with option ${arg(1)}`} ${where ?? ''}`);
                if (itemRe) await sdk.sendUseItemOnLoc(slotOf(sdk, re(itemRe)), loc.x, loc.z, loc.id);
                else await opLoc(sdk, loc, re(arg(1)));
                await settle(60);
                show(step, t0, `${loc.name}@(${loc.x},${loc.z})`);
            } else if (cmd === 'rawloc' || cmd === 'rawuse') {
                // rawloc:id:x,z:opIndex / rawuse:item:id:x,z - for bridge-flag locs the client does not list
                const [id, where, op] = cmd === 'rawloc' ? [arg(0), arg(1), a[2]] : [arg(1), arg(2), undefined];
                const [x, z] = coords(where);
                if (cmd === 'rawloc') await sdk.sendInteractLoc(x, z, Number(id), Number(op ?? 1));
                else await sdk.sendUseItemOnLoc(slotOf(sdk, re(arg(0))), x, z, Number(id));
                await settle(60);
                show(step, t0);
            } else if (cmd === 'npc' || cmd === 'usenpc') {
                const npcRe = cmd === 'npc' ? arg(0) : arg(1);
                const n = findNpc(sdk, re(npcRe));
                if (!n) throw new Error(`no npc ${npcRe}`);
                if (cmd === 'npc') {
                    const o = opIndex(n, re(arg(1)));
                    if (o === undefined) throw new Error(`npc ${n.name} has no option ${arg(1)}`);
                    await sdk.sendInteractNpc(n.index, o);
                } else {
                    await sdk.sendUseItemOnNpc(slotOf(sdk, re(arg(0))), n.index);
                }
                await settle(60);
                show(step, t0, `${n.name}`);
            } else if (cmd === 'talk' || cmd === 'dlg') {
                const choices = ((cmd === 'talk' ? a[1] : a[0]) ?? '').split('|').filter(Boolean).map(re);
                const pick = choices.length ? choices : [/./];
                const d = cmd === 'talk' ? await talkTo(sdk, re(arg(0)), pick, { keep: true }) : await converse(sdk, pick, { keep: true });
                if (!d.opened) throw new Error('no dialogue opened');
                show(step, t0, { pages: d.pages, options: d.options, dlgTicks: d.endTick - d.firstTick });
                for (const t of d.transcript) console.log('     ', t);
            } else if (cmd === 'useitem') {
                await sdk.sendUseItemOnItem(slotOf(sdk, re(arg(0))), slotOf(sdk, re(arg(1))));
                await settle(20);
                show(step, t0);
            } else if (cmd === 'take') {
                const r = await pickup(sdk, re(arg(0)));
                show(step, t0, r.ok ? `took ${r.item.name}` : `not taken (${r.reason})`);
            } else if (cmd === 'wait') {
                let last = pos(sdk);
                for (let i = 0; i < Number(arg(0)); i++) {
                    await sdk.waitForTicks(1);
                    const p = pos(sdk);
                    if (p.x !== last.x || p.z !== last.z || p.level !== last.level) console.log(`   +${currentTick(sdk) - t0}t (${p.x},${p.z},${p.level})`);
                    last = p;
                }
                show(step, t0);
            } else if (cmd === 'inv') {
                console.log('[inv]', sdk.getInventory().map(i => `${i.name}x${i.count}`).join(', '));
            } else if (cmd === 'equip') {
                console.log('[equip]', sdk.getEquipment().map(i => i.name).join(', '));
            } else {
                throw new Error(`unknown step ${step}`);
            }
        } catch (e) {
            show(step, t0, `ERROR ${(e as Error).message}`);
        }
    }
}, { timeout: 900_000, printState: false });
