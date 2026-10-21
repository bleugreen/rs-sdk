// Teleports: click-to-arrival ticks for the standard teleport spells and the
// jewellery in this content (amulet of glory, games necklace), plus whether a
// teleport is blocked in combat or in the wilderness.
// Run: bun docs/speedrun/scripts/quest-primitives-teleports.ts <botname>

import { runScript } from '../../../sdk/runner';
import type { BotSDK } from '../../../sdk/index';
import type { BotWorldState } from '../../../sdk/types';
import { give, mustTele, setvar } from '../../../speedrun/lab/setup';
import { result, stats } from '../../../speedrun/lab/record';
import { TELEPORTS } from '../../../speedrun/lib/act';
import { currentTick, waitTicks, waitUntil } from '../../../speedrun/lib/wait';
import { findNpc, invItem, opIndex, pos, type Tile } from '../../../speedrun/lib/world';

// Component ids from server/content/pack/interface.pack; Watchtower teleport is not in the scored run's table.
const SPELLS: Record<string, number> = { ...TELEPORTS, watchtower: 1541 };
const HOME = { x: 3222, z: 3218 };
const far = (p0: Tile) => (s: BotWorldState) => { const p = pos(s); return Math.abs(p.x - p0.x) + Math.abs(p.z - p0.z) > 30; };

async function castAt(sdk: BotSDK, comp: number, from = HOME) {
    await mustTele(sdk, from.x, from.z);
    await waitTicks(sdk, 2);
    const p0 = pos(sdk);
    const msgs0 = sdk.getState()!.gameMessages.length;
    const t0 = currentTick(sdk);
    await sdk.sendClickComponent(comp);
    const r = await waitUntil(sdk, far(p0), { maxTicks: 15 });
    const s = sdk.getState()!;
    return { ticks: r.ok ? r.tick - t0 : null, arrived: pos(r.ok ? r.state : s), anim: r.ok ? r.state.player?.animId : undefined, messages: s.gameMessages.slice(0, Math.max(0, s.gameMessages.length - msgs0) || 3).map(m => m.text) };
}

async function rub(sdk: BotSDK, item: RegExp, choice: RegExp, from = HOME) {
    await mustTele(sdk, from.x, from.z);
    await waitTicks(sdk, 2);
    const it = invItem(sdk, item);
    if (!it) return { error: 'no item ' + item };
    const op = opIndex(it, /rub/i);
    if (op === undefined) return { error: 'no Rub op: ' + it.optionsWithIndex.map(o => o.text).join(',') };
    const p0 = pos(sdk);
    const t0 = currentTick(sdk);
    await sdk.sendUseItem(it.slot, op);
    const d = await waitUntil(sdk, s => s.dialog.isOpen && !s.dialog.isWaiting && s.dialog.options.some(o => choice.test(o.text)), { maxTicks: 15 });
    if (!d.ok) return { error: 'no choice dialog', messages: sdk.getState()!.gameMessages.slice(-3).map(m => m.text) };
    const t1 = d.tick;
    await sdk.sendClickDialog(d.state.dialog.options.find(o => choice.test(o.text))!.index);
    const r = await waitUntil(sdk, far(p0), { maxTicks: 15 });
    return { clickToChoice: t1 - t0, choiceToArrive: r.ok ? r.tick - t1 : null, total: r.ok ? r.tick - t0 : null, arrived: pos(r.ok ? r.state : sdk), messages: sdk.getState()!.gameMessages.slice(-2).map(m => m.text), item: sdk.getState()!.inventory.filter(i => /glory|necklace/i.test(i.name)).map(i => i.name) };
}

await runScript(async ({ sdk }) => {
    await setvar(sdk, 'elenaquest', 30);
    await setvar(sdk, 'itwatchtower', 14);

    const spells: Record<string, unknown> = {};
    const allTicks: number[] = [];
    for (const [name, comp] of Object.entries(SPELLS)) {
        const runs = [];
        for (let i = 0; i < 3; i++) runs.push(await castAt(sdk, comp));
        runs.forEach(r => typeof r.ticks === 'number' && allTicks.push(r.ticks));
        spells[name] = { ticks: stats(runs.map(r => r.ticks ?? NaN)), arrived: runs[0]!.arrived, msgs: runs[0]!.messages };
        console.log(name, JSON.stringify(spells[name]));
    }
    result('teleport.spells', { perSpell: spells, all: stats(allTicks) });

    // Jewellery
    const jw = { glory: [] as Array<Awaited<ReturnType<typeof rub>>>, games: [] as Array<Awaited<ReturnType<typeof rub>>> };
    for (let i = 0; i < 3; i++) {
        if (!invItem(sdk, /glory\(/i)) await give(sdk, 'amulet_of_glory_4', 1);
        jw.glory.push(await rub(sdk, /glory\(/i, /Draynor/i));
        if (!invItem(sdk, /games necklace/i)) await give(sdk, 'necklace_of_minigames_8', 1);
        jw.games.push(await rub(sdk, /games necklace/i, /Burthorpe/i));
    }
    for (const [k, v] of Object.entries(jw)) console.log(k, JSON.stringify(v));
    result('teleport.jewellery', { glory: { samples: jw.glory, total: stats(jw.glory.map((r: any) => r.total ?? NaN)) }, games: { samples: jw.games, total: stats(jw.games.map((r: any) => r.total ?? NaN)) } });

    // Wilderness: spell and glory at level 25 and 35 (x 3100).
    const wild: Record<string, unknown> = {};
    for (const lvl of [25, 35]) {
        const z = 3520 + (lvl - 1) * 8;
        wild[`spell_lvl${lvl}`] = await castAt(sdk, TELEPORTS.varrock, { x: 3100, z });
        if (!invItem(sdk, /glory\(/i)) await give(sdk, 'amulet_of_glory_4', 1);
        wild[`glory_lvl${lvl}`] = await rub(sdk, /glory\(/i, /Draynor/i, { x: 3100, z });
        if (!invItem(sdk, /games necklace/i)) await give(sdk, 'necklace_of_minigames_8', 1);
        wild[`games_lvl${lvl}`] = await rub(sdk, /games necklace/i, /Burthorpe/i, { x: 3100, z });
    }
    result('teleport.wilderness', wild);

    // In combat: attack a goblin east of Lumbridge, cast once a hit has landed.
    const combat = [];
    for (let i = 0; i < 2; i++) {
        await mustTele(sdk, 3250, 3235);
        await waitTicks(sdk, 2);
        const npc = findNpc(sdk, /^(goblin|man|cow)$/i);
        if (!npc) { combat.push({ error: 'no npc' }); continue; }
        await sdk.sendInteractNpc(npc.index, opIndex(npc, /attack/i)!);
        const hit = await waitUntil(sdk, s => s.combatEvents.some(e => e.type === 'damage_dealt' || e.type === 'damage_taken'), { maxTicks: 30 });
        const s = sdk.getState()!;
        const p0 = pos(s);
        const t0 = currentTick(sdk);
        await sdk.sendClickComponent(TELEPORTS.lumbridge);
        const r = await waitUntil(sdk, far(p0), { maxTicks: 15 });
        combat.push({ npc: npc.name, inCombat: s.player?.combat.inCombat, hitSeen: hit.ok, ticks: r.ok ? r.tick - t0 : null, arrived: pos(r.ok ? r.state : sdk) });
    }
    result('teleport.inCombat', combat);
}, { timeout: 600_000 });
