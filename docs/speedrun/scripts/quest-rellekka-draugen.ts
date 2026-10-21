// Fremennik Trials, Sigli's hunt: from the first use of the Hunters' talisman
// at Rellekka's south gate to the Draugen's essence absorbed.
//
//   bun docs/speedrun/scripts/quest-rellekka-draugen.ts <bot> [att str def hp]
//
// Read (viking_sigil.rs2): the first use spawns a hidden "butterfly" in one of
// four forests (random(4), line 242; map_findsquare radius 20) and tells you a
// compass direction; within 3 tiles of it the talisman spawns the Draugen (60
// hitpoints, 60 attack/strength/defence, +100 melee defence). The butterfly is
// an ordinary NPC (viking_draugen_safe, id 1280) that the client can see, so the
// bot walks straight to it once it is in view instead of re-reading directions.
// The butterfly id is a temporary varp (draugen_butterfly_uid): a fresh login
// gives a fresh spawn, so each sample uses a bot that has not hunted yet.
// Fights with a rune scimitar and rune armour at the given stats (default 70s).

import { runScript } from '../../../sdk/runner';
import * as L from './quest-rellekka-lib';

const nums = process.argv.slice(3).filter(a => /^\d+$/.test(a)).map(Number);
const [att, str, def, hp] = [0, 1, 2, 3].map(i => nums[i] ?? 70);
const BUTTERFLY = 1280;
const DRAUGEN = 1279;
const dirs: Record<string, [number, number]> = {
    'north-west': [-1, 1], 'south-west': [-1, -1], 'north-east': [1, 1], 'south-east': [1, -1],
    east: [1, 0], west: [-1, 0], south: [0, -1], north: [0, 1]
};

await runScript(async ({ bot, sdk }) => {
    const out: Record<string, unknown> = {};
    process.on('exit', () => L.report(`Draugen ${att}/${str}/${def}`, out));
    await L.clearInv(sdk, bot);
    await L.setStats(sdk, { attack: att, strength: str, defence: def, hitpoints: hp });
    for (const g of ['rune_scimitar', 'rune_full_helm', 'rune_platebody', 'rune_platelegs', 'rune_kiteshield']) {
        await L.give(sdk, g);
        const it = sdk.getInventory().find(i => i.name.toLowerCase().replace(/ /g, '_') === g);
        if (it) await bot.equipItem(it);
    }
    await L.give(sdk, 'shark', 10);
    await L.give(sdk, 'viking_draugen_talisman_uncharged');
    await L.cheat(sdk, 'setvar viking 1');
    await L.cheat(sdk, `setvar viking_bits ${L.BITS.sigliStarted}`);
    await L.tele(sdk, 2662, 3645, 0);
    await sdk.waitForTicks(3);

    const T0 = L.tick(sdk);
    const msgs = () => sdk.getState()!.gameMessages.slice(-3).map(m => m.text).join(' | ');
    const useTalisman = async () => {
        await sdk.sendUseItem(sdk.findInventoryItem(/Hunters' talisman/)!.slot, 1);
        await sdk.waitForTicks(2);
        return msgs();
    };
    let uses = 0;
    const trail: string[] = [];
    let found: number | null = null;
    while (L.tick(sdk) - T0 < 1500) {
        if (sdk.getNearbyNpcs().some(n => n.id === DRAUGEN)) break;
        const bf = sdk.getNearbyNpcs().find(n => n.id === BUTTERFLY);
        if (bf) {
            if (found === null) found = L.tick(sdk) - T0;
            if (bf.distance > 2) {
                await bot.walkTo(bf.x, bf.z, 1);
                continue;
            }
            uses++;
            trail.push(`at butterfly: ${await useTalisman()}`);
            continue;
        }
        uses++;
        const m = await useTalisman();
        trail.push(`${JSON.stringify(L.pos(sdk))} ${m}`);
        const dir = Object.keys(dirs).find(d => m.includes(`guides you ${d}`));
        if (!dir) { await sdk.waitForTicks(1); continue; }
        const [dx, dz] = dirs[dir];
        const p = L.pos(sdk);
        await bot.walkTo(p.x + dx * 20, p.z + dz * 20, 3);
    }
    const spawned = L.tick(sdk) - T0;
    const f0 = L.tick(sdk);
    let eaten = 0;
    while (L.tick(sdk) - f0 < 600) {
        const d = sdk.getNearbyNpcs().find(n => n.id === DRAUGEN);
        if (!d) break;
        const s = sdk.getState()!;
        if (s.dialog.isOpen) { await L.dismissLevelUps(sdk); if (s.dialog.isOpen) await sdk.sendClickDialog(0); }
        if (s.player!.hp < s.player!.maxHp / 2) { await bot.eatFood(/Shark/); eaten++; }
        if (!s.player!.combat.inCombat || s.player!.combat.targetIndex !== d.index) await bot.attack(d);
        await sdk.waitForStateUpdate();
    }
    await sdk.waitForTicks(2);
    const bits = await L.getVar(sdk, 'viking_bits');
    Object.assign(out, {
        uses, butterflySeenAt: found, draugenSpawnedAt: spawned, fight: L.tick(sdk) - f0, total: L.tick(sdk) - T0, eaten,
        sigli: bits === null ? null : (bits >> 14) & 3, end: L.pos(sdk), trail
    });
    console.log('result', JSON.stringify(out));
}, { timeout: 900_000, printState: false });
