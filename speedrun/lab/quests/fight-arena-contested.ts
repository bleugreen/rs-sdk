// Two-bot lab case for S12 on a shared world (rs/520): another player's Khazard Ogre out of its
// cage, in that player's fight, nearer to SCORED than SCORED's own when segment G's fight starts.
//
//   LAB_RUNNERS=0 LAB_HELPERS=<rival> speedrun/lab/lab.sh <bot> 'speedrun/lab/quests/fight-arena-contested.ts:--from=F:--until=G:--runs=3:--launch:--rival=<rival>'
//
// The rival (Attack and Strength 1, Defence and Hitpoints 99) stands inside the arena near SCORED's
// entry tile (2607,3152, quest_arena.rs2 arena_enter), adds an ogre at its feet (::npcadd) and keeps
// it busy without killing it. G's release then finds that ogre in combat out of its cage and adds
// SCORED's own (jeremy_servil.rs2 ogre_attack_justin): two Khazard Ogres, the rival's nearer.
// lib/combat's fight() with adoptHitter must leave the rival's alone and kill SCORED's; the check
// fails a run that fought the rival's ogre, that was refused or waited, or that took damage.

import type { NearbyNpc } from '../../../sdk/types';
import { closeSession, openSession, type Session } from '../../lib/session';
import type { TickRow } from '../../lib/ticks';
import { waitUntil } from '../../lib/wait';
import { opIndex } from '../../lib/world';
import { quest } from '../../quests/fight-arena';
import { arg } from '../common';
import { cheat, leaveTutorial, mustTele, setStats } from '../setup';
import { lab } from './fight-arena';
import { labMain, type LabQuest } from './run';

const OGRE = /^Khazard Ogre$/i;
/** Inside the arena, 5 tiles from SCORED's entry tile and 10 from the ogre's cage (0_40_49_46_29). */
const RIVAL_TILE = { x: 2601, z: 3155 } as const;

let rival: Session | null = null;
let rivalOgre = -1;

const rivalsOgre = (s: { nearbyNpcs: NearbyNpc[] } | null): NearbyNpc | null =>
    s?.nearbyNpcs.filter(n => OGRE.test(n.name) && (n.hp ?? 1) > 0 && n.distance <= 6).sort((a, b) => a.distance - b.distance)[0] ?? null;

/** The rival in its fight with an ogre of its own: one spawned if none is at hand, attacked until it hits back. */
async function rivalFight(): Promise<void> {
    rival ??= await openSession(arg('rival', 'srlab2'));
    await leaveTutorial(rival);
    const sdk = rival.sdk;
    await setStats(sdk, { attack: 1, strength: 1, defence: 99, hitpoints: 99 });
    await mustTele(sdk, RIVAL_TILE.x, RIVAL_TILE.z);
    let ogre = rivalsOgre(sdk.getState());
    if (!ogre) {
        await cheat(sdk, 'npcadd arena_ogre', 2);
        const w = await waitUntil(sdk, s => rivalsOgre(s) !== null, { maxTicks: 10 });
        if (!w.ok) throw new Error('rival: ::npcadd arena_ogre showed no ogre');
        ogre = rivalsOgre(w.state)!;
    }
    rivalOgre = ogre.index;
    const t0 = sdk.getState()!.tick;
    const engaged = await waitUntil(sdk, s => {
        if (s.tick > t0 && (s.tick - t0) % 4 === 1) void sdk.sendInteractNpc(rivalOgre, opIndex(ogre!, /^attack$/i) ?? 2);
        return (s.combatEvents ?? []).some(e => e.tick > t0 && ((e.sourceType === 'npc' && e.sourceIndex === rivalOgre) || (e.targetType === 'npc' && e.targetIndex === rivalOgre)));
    }, { maxTicks: 30 });
    if (!engaged.ok) throw new Error(`rival: no fight with ogre ${rivalOgre} within 30 ticks`);
    console.log(`rival: fighting ogre ${rivalOgre} at ${ogre.x},${ogre.z} (rival at ${RIVAL_TILE.x},${RIVAL_TILE.z})`);
}

const contested: LabQuest<NonNullable<typeof lab.options>> = {
    ...lab,
    title: `${lab.title}; with a rival's ogre in its fight nearby (rs/520)`,
    async prepare(session, fixture) {
        await lab.prepare?.(session, fixture);
        await rivalFight();
    },
    async check(session, fixture, rows: readonly TickRow[]) {
        const base = await lab.check?.(session, fixture, rows);
        const fights = rows.filter(r => r.kind === 'note' && r.step.endsWith(':fight')).map(r => r.meta as { what: string; target: number; switches: number; refused: number[]; waited: number });
        const ogre = fights.find(f => /ogre/i.test(f.what));
        const stillRivals = rivalsOgre(rival?.sdk.getState() ?? null)?.index === rivalOgre;
        console.log(`contention: rival's ogre ${rivalOgre} (${stillRivals ? 'still in the rival\'s fight' : 'gone from the rival'}); SCORED fought ${JSON.stringify(ogre)}`);
        if (base) return base;
        if (!ogre) return 'no ogre fight note';
        if (ogre.target === rivalOgre) return `SCORED fought the rival's ogre (${rivalOgre})`;
        if (ogre.refused.length || ogre.waited) return `SCORED was refused (${ogre.refused.join(', ')}) or waited ${ogre.waited} ticks`;
        return undefined;
    },
};

if (import.meta.main) {
    try {
        await labMain(contested);
    } finally {
        if (rival) await closeSession(rival);
    }
    console.log(`${quest} contested done`);
    process.exit(0);
}
