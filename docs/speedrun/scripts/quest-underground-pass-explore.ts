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
//   walk:x,z              bot.walkTo, tolerance 0
//   click:x,z             one raw run click (no pathfinding)
//   loc:regex:option[:x,z]   interact with a loc (nearest match, or at x,z)
//   npc:regex:option         interact with an NPC
//   talk:regex[:c1|c2...]    talk-to and answer with talkThrough
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
import * as L from './quest-arthur-lab';

const steps = process.argv.slice(3);
const re = (s: string) => new RegExp(s, 'i');

await runScript(async ({ bot, sdk }) => {
    let msgSeen = sdk.getState()?.gameMessages.length ?? 0;
    const flush = () => {
        const msgs = sdk.getState()?.gameMessages ?? [];
        const out = msgs.slice(msgSeen).map(m => m.text);
        msgSeen = msgs.length;
        return out;
    };
    const show = (label: string, t0: number, extra: unknown = '') => {
        const s = sdk.getState()!;
        const p = L.pos(sdk);
        console.log(`[${label}] +${s.tick - t0}t pos=(${p.x},${p.z},${p.level}) hp=${s.player?.hp}/${s.player?.maxHp} dlg=${s.dialog.isOpen ? 'open' : '-'} ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`);
        const m = flush();
        if (m.length) console.log('   msgs:', JSON.stringify(m));
    };
    const settle = async (maxTicks = 30) => {
        // wait until the player has stood still with no dialogue for 2 ticks
        let still = 0;
        let last = L.pos(sdk);
        for (let i = 0; i < maxTicks && still < 5; i++) {
            await sdk.waitForTicks(1);
            const p = L.pos(sdk);
            const s = sdk.getState()!;
            if (s.dialog.isOpen) break;
            still = p.x === last.x && p.z === last.z && p.level === last.level && s.player?.animId === -1 ? still + 1 : 0;
            last = p;
        }
    };
    await bot.dismissBlockingUI();
    flush();
    for (const step of steps) {
        const [cmd, ...a] = step.split(':');
        const t0 = L.tick(sdk);
        try {
            if (cmd === 'tele') {
                const [x, z, l] = a[0].split(',').map(Number);
                await L.tele(sdk, x, z, l ?? 0);
                show(step, t0);
            } else if (cmd === 'setvar') {
                await L.cheat(sdk, `setvar ${a[0]} ${a[1]}`);
                show(step, t0);
            } else if (cmd === 'getvar') {
                const v = await L.getVar(sdk, a[0]);
                show(step, t0, `${a[0]}=${v}${v !== null ? ` bits=${(v >>> 0).toString(2)}` : ''}`);
            } else if (cmd === 'stat') {
                await L.cheat(sdk, `setstat ${a[0]} ${a[1]}`, 1);
                show(step, t0);
            } else if (cmd === 'give') {
                await L.cheat(sdk, `give ${a[0]} ${a[1] ?? 1}`, 2);
                show(step, t0);
            } else if (cmd === 'drop') {
                for (const it of sdk.getInventory().filter(i => re(a[0]).test(i.name))) {
                    await sdk.sendDropItem(it.slot);
                    await sdk.waitForTicks(1);
                }
                show(step, t0);
            } else if (cmd === 'wear') {
                const r = await bot.equipItem(re(a[0]));
                show(step, t0, r.message);
            } else if (cmd === 'remove') {
                const r = await bot.unequipItem(re(a[0]));
                show(step, t0, r.message);
            } else if (cmd === 'scan') {
                const r = Number(a[0] ?? 12);
                const locs = await sdk.scanNearbyLocs(r);
                const interesting = locs.filter(l => l.options.length > 0);
                console.log(`[scan r=${r}] at`, L.pos(sdk));
                for (const l of interesting) console.log(`   loc ${l.name} #${l.id} (${l.x},${l.z}) d=${l.distance} reach=${l.reachable} ops=${JSON.stringify(l.options)}`);
                for (const n of sdk.getNearbyNpcs()) console.log(`   npc ${n.name} lvl${n.combatLevel} (${n.x},${n.z}) tile=(${n.tileX},${n.tileZ}) idx=${n.index} reach=${n.reachable}`);
                for (const g of await sdk.scanGroundItems(r)) console.log(`   obj ${g.name} x${g.count} (${g.x},${g.z}) reach=${g.reachable}`);
                flush();
            } else if (cmd === 'walk') {
                const [x, z] = a[0].split(',').map(Number);
                const w = await L.timedWalk(sdk, bot, x, z, 0);
                show(step, t0, w);
            } else if (cmd === 'click') {
                const [x, z] = a[0].split(',').map(Number);
                await sdk.sendWalk(x, z, true);
                let last = L.pos(sdk);
                let still = 0;
                for (let i = 0; i < 80 && still < 3; i++) {
                    await sdk.waitForTicks(1);
                    const p = L.pos(sdk);
                    still = p.x === last.x && p.z === last.z ? still + 1 : 0;
                    last = p;
                }
                show(step, t0);
            } else if (cmd === 'loc' || cmd === 'useloc') {
                const [itemRe, locRe, where] = cmd === 'loc' ? [null, a[0], a[2]] : [a[0], a[1], a[2]];
                const locs = await sdk.scanNearbyLocs(30);
                let cands = locs.filter(l => re(locRe).test(l.name));
                if (where) {
                    const [x, z] = where.split(',').map(Number);
                    cands = cands.filter(l => l.x === x && l.z === z);
                }
                cands.sort((p, q) => p.distance - q.distance);
                const loc = cands[0];
                if (!loc) throw new Error(`no loc ${locRe} ${where ?? ''}`);
                if (itemRe) {
                    const it = sdk.findInventoryItem(re(itemRe));
                    if (!it) throw new Error(`no item ${itemRe}`);
                    await sdk.sendUseItemOnLoc(it.slot, loc.x, loc.z, loc.id);
                } else {
                    const opt = loc.optionsWithIndex.find(o => re(a[1]).test(o.text));
                    if (!opt) throw new Error(`loc ${loc.name} has no option ${a[1]}: ${JSON.stringify(loc.options)}`);
                    await sdk.sendInteractLoc(loc.x, loc.z, loc.id, opt.opIndex);
                }
                await settle(60);
                show(step, t0, `${loc.name}@(${loc.x},${loc.z})`);
            } else if (cmd === 'rawloc' || cmd === 'rawuse') {
                // rawloc:id:x,z:opIndex / rawuse:item:id:x,z - for bridge-flag locs the client does not list
                const [id, where, op] = cmd === 'rawloc' ? [a[0], a[1], a[2]] : [a[1], a[2], null];
                const [x, z] = where.split(',').map(Number);
                if (cmd === 'rawloc') await sdk.sendInteractLoc(x, z, Number(id), Number(op ?? 1));
                else {
                    const it = sdk.findInventoryItem(re(a[0]));
                    if (!it) throw new Error(`no item ${a[0]}`);
                    await sdk.sendUseItemOnLoc(it.slot, x, z, Number(id));
                }
                await settle(60);
                show(step, t0);
            } else if (cmd === 'npc' || cmd === 'usenpc') {
                const npcRe = cmd === 'npc' ? a[0] : a[1];
                const n = sdk.getNearbyNpcs().filter(m => re(npcRe).test(m.name)).sort((p, q) => (p.distance ?? 0) - (q.distance ?? 0))[0];
                if (!n) throw new Error(`no npc ${npcRe}`);
                if (cmd === 'npc') {
                    const opt = n.optionsWithIndex?.find((o: { text: string }) => re(a[1]).test(o.text));
                    if (!opt) throw new Error(`npc ${n.name} has no option ${a[1]}`);
                    await sdk.sendInteractNpc(n.index, opt.opIndex);
                } else {
                    const it = sdk.findInventoryItem(re(a[0]));
                    if (!it) throw new Error(`no item ${a[0]}`);
                    await sdk.sendUseItemOnNpc(it.slot, n.index);
                }
                await settle(60);
                show(step, t0, `${n.name}`);
            } else if (cmd === 'talk') {
                const choices = (a[1] ?? '').split('|').filter(Boolean).map(re);
                const r = await bot.talkTo(re(a[0]));
                if (!r.success) throw new Error(r.message);
                const d = await L.talkThrough(sdk, choices.length ? choices : [/./]);
                show(step, t0, { pages: d.pages, options: d.options, dlgTicks: d.ticks });
                for (const t of d.transcript) console.log('     ', t);
            } else if (cmd === 'dlg') {
                const choices = (a[0] ?? '').split('|').filter(Boolean).map(re);
                const d = await L.talkThrough(sdk, choices.length ? choices : [/./]);
                show(step, t0, { pages: d.pages, options: d.options, dlgTicks: d.ticks });
                for (const t of d.transcript) console.log('     ', t);
            } else if (cmd === 'useitem') {
                const x = sdk.findInventoryItem(re(a[0]));
                const y = sdk.findInventoryItem(re(a[1]));
                if (!x || !y) throw new Error(`missing ${a[0]} or ${a[1]}`);
                await sdk.sendUseItemOnItem(x.slot, y.slot);
                await settle(20);
                show(step, t0);
            } else if (cmd === 'take') {
                const r = await bot.pickupItem(re(a[0]));
                show(step, t0, r.message);
            } else if (cmd === 'wait') {
                let last = L.pos(sdk);
                for (let i = 0; i < Number(a[0]); i++) {
                    await sdk.waitForTicks(1);
                    const p = L.pos(sdk);
                    if (p.x !== last.x || p.z !== last.z || p.level !== last.level) console.log(`   +${L.tick(sdk) - t0}t (${p.x},${p.z},${p.level})`);
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
