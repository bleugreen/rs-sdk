// Lab acceptance for the Tree Gnome Village module (speedrun/quests/tree-gnome-village.ts, S10b):
//
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> 'speedrun/lab/quests/tree-gnome-village.ts:--from=A:--until=N:--runs=3:--dialogue=both:--launch'
//
// Every fixture is SCORED at that segment's start: its arrival levels (Attack, Strength and Defence
// 1, 10 Hitpoints, Magic 59, Prayer 94: STEP-MANIFEST.md entry 14, not quest-gnome-setup.ts's
// 70/70/70), %treequest at the segment's stage and Plague City read (%elenaquest 30), and its pack:
// what the inventory ledger leaves after S09's exit drops (rune axe, knife, spade, four buckets, the
// law, air and water stacks; the staff of water and gas mask worn), plus H7 from A on. H7 is given
// by ::give in fixture A, so A here is the wear-and-drop only; the trade itself (4 ticks, rs/285's
// RT section 3) is outside these figures. Ticks are from the arrival tile, Elkoy (2504,3191).
//
// --montai-fight stages D's Montai talk straight after a kill: SCORED is moved beside Montai, a Giant
// (the maze's, level 28) is spawned and killed by Fire Blast under Protect from Melee, and segment D
// then talks at once (its walk to Montai is already inside tolerance). rs/342 saw two Montai talks
// stall 42 and 108 ticks right after a maze-giant fight; this checks whether a post-kill talk click
// still drops. D's ticks in this mode are from beside Montai, not from the arrival tile.
//
// --no-retaliate turns auto-retaliate off in every fixture (main's run-wide setting for SCORED, until
// the shared login helper sets it): with it on, the stronghold commander's attack turns SCORED on him
// and segment H's door and ladder clicks are swallowed.
//
// --warlord=fire_bolt runs the fallback spell. Besides the runner's table this prints the aggro
// census: every NPC seen within 16 tiles of SCORED (name, combat level, nearest approach), each one
// seen in combat or targeting while near, and every hit SCORED took with its source.

import type { BotWorldState } from '../../../sdk/types';
import { arg, result } from '../common';
import { COMBAT_SPELLS, fight, setPrayer } from '../../lib/combat';
import { waitUntil } from '../../lib/wait';
import { chebyshev } from '../../lib/world';
import { BOLREN, JUMP_IN, MONTAI, quest, stepId, steps, WARLORD, type Options } from '../../quests/tree-gnome-village';
import { cheat, mustTele } from '../setup';
import { labMain, type LabQuest, type QuestFixture } from './run';

const WARLORD_SPELL = arg('warlord', 'fire_blast');
if (WARLORD_SPELL !== 'fire_blast' && WARLORD_SPELL !== 'fire_bolt') throw new Error(`--warlord=${WARLORD_SPELL}: want fire_blast or fire_bolt`);
const MONTAI_FIGHT = process.argv.includes('--montai-fight');
const NO_RETALIATE = process.argv.includes('--no-retaliate');
/** The controls tab's auto-retaliate off button (interface.pack controls:com_3, player_controls.rs2). */
const IF_AUTO_RETALIATE_OFF = 151;

/** SCORED arriving at S10b. */
const LEVELS = { attack: 1, strength: 1, defence: 1, hitpoints: 10, magic: 59, prayer: 94 } as const;

/** The pack after S09's exit (mining.ts EXIT_DROPS) on the inventory ledger: SCORED's own items. */
const PACK = { rune_axe: 1, knife: 1, spade: 1, bucket_empty: 4, lawrune: 1, airrune: 5, waterrune: 2 } as const;
/** H7's pack items (the staff and amulet are worn from A on). */
const H7_PACK = { logs: 6, shark: 2, '3doseantipoison': 1, deathrune: 110, chaosrune: 40, airrune: 550 } as const;
/** H7's runes after the warlord (~26 Fire Blasts: 26 death, 104 air). */
const AFTER_WARLORD = { shark: 2, '3doseantipoison': 1, deathrune: 84, chaosrune: 40, airrune: 451 } as const;
const KIT_WORN = ['staff_of_fire', 'amulet_of_magic', 'gasmask'] as const;

const ARRIVAL_TILE = { x: 2504, z: 3191 };

const sum = (...packs: Array<Readonly<Record<string, number>>>) => {
    const out: Record<string, number> = {};
    for (const p of packs) for (const [k, n] of Object.entries(p)) out[k] = (out[k] ?? 0) + n;
    return out;
};

const fx = (letter: string, treequest: number, tile: QuestFixture['tile'], items: Record<string, number>, worn: readonly string[] = KIT_WORN, note?: string): QuestFixture => ({
    letter,
    levels: LEVELS,
    vars: { treequest, elenaquest: 30 },
    // Worn items first, then quest items, then the rest: a full pack drops a give silently.
    items: sum(Object.fromEntries(worn.map(w => [w, 1])), items),
    worn,
    tile,
    ...(note ? { note } : {}),
});

const noLogs = (({ logs: _l, ...rest }) => rest)(H7_PACK);

export const FIXTURES: readonly QuestFixture[] = [
    fx('A', 0, ARRIVAL_TILE, sum({ staff_of_fire: 1, amulet_of_magic: 1 }, PACK, H7_PACK), ['staff_of_water', 'gasmask'], 'the arrival tile, H7 just received'),
    fx('B', 0, ARRIVAL_TILE, sum(PACK, H7_PACK)),
    fx('C', 0, { x: 2515, z: 3161 }, sum(PACK, H7_PACK)),
    fx('D', 1, ARRIVAL_TILE, sum(PACK, H7_PACK)),
    fx('E', 2, { x: MONTAI.x - 1, z: MONTAI.z - 2 }, sum(PACK, H7_PACK)),
    fx('F', 3, { x: MONTAI.x - 1, z: MONTAI.z - 2 }, sum(PACK, noLogs)),
    fx('G', 4, { x: MONTAI.x - 1, z: MONTAI.z - 2 }, sum(PACK, noLogs)),
    fx('H', 5, { x: 2511, z: 3210 }, sum(PACK, noLogs)),
    fx('I', 6, { x: 2503, z: 3253 }, sum({ orb_of_protection: 1 }, PACK, noLogs)),
    fx('J', 6, JUMP_IN, sum({ orb_of_protection: 1 }, PACK, noLogs)),
    fx('K', 7, ARRIVAL_TILE, sum(PACK, noLogs)),
    fx('L', 8, WARLORD, sum({ orbs_of_protection: 1 }, PACK, AFTER_WARLORD)),
    fx('M', 8, JUMP_IN, sum({ orbs_of_protection: 1 }, PACK, AFTER_WARLORD)),
];

/**
 * Reference ticks per segment, fixed column, from the arrival tile: tree_gnome_village.md's
 * measured stock step list (100 ms, bot.walkTo) less each conversation's stock-to-fixed saving,
 * and the warlord at rs/56's 133 by Fire Blast. Sum 793 = the manifest's fixed fallback.
 */
export const REFERENCE: Readonly<Record<string, number>> = {
    A: 2, B: 114, C: 38, D: 27, E: 6, F: 17, G: 15, H: 82, I: 64, J: 43, K: 224, L: 98, M: 30, N: 33,
};

// ------------------------------------------------------------------ aggro census

interface Seen { name: string; level: number; closest: number; engaged: number; firstTick: number }
const census = new Map<string, Seen>();
const hits: Array<{ tick: number; damage: number; from: string; at: string }> = [];
const hitKeys = new Set<string>();
const low = { hp: Infinity, at: '', tick: 0 };
/** Standing still 5+ ticks with no dialogue open: who was within 4 tiles (a blocked corridor, a held click). */
const stalls: Array<{ tick: number; at: string; ticks: number; npcs: string[] }> = [];
const still = { x: -1, z: -1, since: 0, logged: false };
const censusWatch: { stop?: () => void } = {};
const QUEST_NPCS = /^(King Bolren|Elkoy|Commander Montai|Khazard warlord|Khazard commander|Gnome|Tracker gnome|Gnome troop|Local gnome)/i;

function watch(s: BotWorldState): void {
    const p = s.player;
    if (!p) return;
    const me = { x: p.worldX, z: p.worldZ };
    if (p.hp < low.hp) Object.assign(low, { hp: p.hp, at: `${me.x},${me.z},${p.level}`, tick: s.tick });
    if (me.x !== still.x || me.z !== still.z || s.dialog.isOpen) {
        if (still.logged) stalls[stalls.length - 1]!.ticks = s.tick - still.since;
        Object.assign(still, { x: me.x, z: me.z, since: s.tick, logged: false });
    } else if (!still.logged && s.tick - still.since >= 5) {
        still.logged = true;
        stalls.push({ tick: still.since, at: `${me.x},${me.z},${p.level}`, ticks: 5, npcs: (s.nearbyNpcs ?? []).filter(n => chebyshev(n, me) <= 4).map(n => `${n.name}(${n.combatLevel})@${n.tileX ?? n.x},${n.tileZ ?? n.z}${n.inCombat ? ' fighting' : ''}`) });
    }
    for (const n of s.nearbyNpcs ?? []) {
        const d = chebyshev(n, me);
        if (d > 16) continue;
        const key = `${n.name} (${n.combatLevel})`;
        const e = census.get(key) ?? { name: n.name, level: n.combatLevel, closest: d, engaged: 0, firstTick: s.tick };
        e.closest = Math.min(e.closest, d);
        if (n.inCombat || (n.targetIndex >= 0 && d <= 3)) e.engaged++;
        census.set(key, e);
    }
    for (const ev of s.combatEvents ?? []) {
        if (ev.type !== 'damage_taken' || ev.tick !== s.tick) continue;
        const key = `${ev.tick}:${ev.observationId ?? ''}:${ev.damage}:${ev.sourceType}:${ev.sourceIndex}`;
        if (hitKeys.has(key)) continue;
        hitKeys.add(key);
        const src = ev.sourceType === 'npc' ? (s.nearbyNpcs ?? []).find(n => n.index === ev.sourceIndex)?.name ?? `npc#${ev.sourceIndex}` : ev.sourceType;
        hits.push({ tick: ev.tick, damage: ev.damage, from: src, at: `${me.x},${me.z},${p.level}` });
    }
}

const lab: LabQuest<Options> = {
    title: `Tree Gnome Village (S10b, SCORED's arrival levels 1/1/1, 10 HP, Magic 59, Prayer 94; warlord by ${WARLORD_SPELL}; from the arrival tile 2504,3191)`,
    stepId,
    steps,
    fixtures: FIXTURES,
    reference: REFERENCE,
    options: {
        warlordSpell: WARLORD_SPELL,
        onTalk: (who, r) => console.log(`TALK ${who}: open ${r.firstTick >= 0 ? r.firstTick - r.startTick : 'never'} ticks, ${r.ticks} in all, ${r.pages} pages ${r.options} options${'clicks' in r ? `, ${(r as { clicks: number }).clicks} click(s)` : ''}; shape ${r.shape ? `${r.shape.seen} vs ${r.shape.expected}${r.shape.stopped ? ` (${r.shape.stopped})` : ''}` : '-'}; first ${r.transcript.slice(0, 3).join(' | ')}`),
    },
    async prepare(session, fixture) {
        censusWatch.stop?.();
        censusWatch.stop = session.sdk.onStateUpdate(watch);
        const lv = (k: string) => session.sdk.getState()?.skills.find(x => x.name.toLowerCase() === k);
        console.log(`LEVELS hp ${lv('hitpoints')?.level} prayer ${lv('prayer')?.level} magic ${lv('magic')?.level} attack ${lv('attack')?.level}`);
        if (NO_RETALIATE) {
            const sdk = session.sdk;
            for (let i = 0; i < 8 && sdk.getState()?.autoRetaliateEnabled !== false; i++) {
                await sdk.sendClickComponent(IF_AUTO_RETALIATE_OFF);
                await waitUntil(sdk, s => s.autoRetaliateEnabled === false, { maxTicks: 4 });
            }
            if (sdk.getState()?.autoRetaliateEnabled !== false) throw new Error('--no-retaliate: auto-retaliate stayed on after 8 clicks');
            console.log('AUTO-RETALIATE off');
        }
        if (MONTAI_FIGHT && fixture.letter === 'D') await killGiantBesideMontai(session.sdk);
    },
};

/** --montai-fight: a Giant killed beside Montai, ending as close to D's talk click as the runner allows. */
async function killGiantBesideMontai(sdk: Parameters<NonNullable<LabQuest['prepare']>>[0]['sdk']): Promise<void> {
    await mustTele(sdk, MONTAI.x - 1, MONTAI.z - 2);
    await cheat(sdk, 'npcadd giant', 2);
    const on = await setPrayer(sdk, 'protect_from_melee', true);
    if (!on.ok) throw new Error(`montai-fight: Protect from Melee did not turn on: ${on.reason}`);
    const f = await fight(sdk, /^Giant$/i, { spell: COMBAT_SPELLS.fire_blast.component, prayer: 'protect_from_melee', eatBelow: 6, food: /^Shark$/i, maxTicks: 300, findTicks: 10 });
    const off = await setPrayer(sdk, 'protect_from_melee', false);
    const s = sdk.getState();
    console.log(`MONTAI-FIGHT giant ${f.end} in ${f.ticks} ticks (engaged ${f.engaged}, dealt ${f.dealt}, taken ${f.taken}, hits ${f.hits}), prayer off ${off.ok ? 'ok' : off.reason}; at ${s?.player?.worldX},${s?.player?.worldZ} hp ${s?.player?.hp}, tick ${s?.tick}`);
    if (!f.ok) throw new Error(`montai-fight: the giant fight ended ${f.end}`);
}

if (import.meta.main) {
    await labMain(lab);
    censusWatch.stop?.();
    const rows = [...census.values()].filter(e => !QUEST_NPCS.test(e.name)).sort((a, b) => a.closest - b.closest);
    console.log(`\n### ${quest} aggro census (NPCs within 16 tiles, quest NPCs left out)\n\n| NPC | Level | Closest | Ticks engaged near | \n|---|---|---|---|`);
    for (const e of rows) console.log(`| ${e.name} | ${e.level} | ${e.closest} | ${e.engaged} |`);
    console.log(`\nStalls (5+ ticks still, no dialogue): ${stalls.length ? stalls.map(x => `t${x.tick} ${x.ticks}t at ${x.at} [${x.npcs.join(', ')}]`).join('; ') : 'none'}`);
    console.log(`\nLowest HP ${low.hp} at ${low.at} (tick ${low.tick})`);
    console.log(`\nHits taken (damage > 0): ${hits.filter(h => h.damage > 0).length ? hits.filter(h => h.damage > 0).map(h => `t${h.tick} ${h.damage} from ${h.from} at ${h.at}`).join('; ') : 'none'}; blocked or missed: ${hits.filter(h => h.damage === 0).length}`);
    console.log(`\nAll hits: ${hits.length ? hits.map(h => `t${h.tick} ${h.damage} from ${h.from} at ${h.at}`).join('; ') : 'none'}`);
    result(`${stepId}_census`, { census: [...census.values()], hits, lowestHp: low, stalls, near: { bolren: BOLREN } });
    process.exit(0);
}
