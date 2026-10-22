// The Grand Tree (S11b) on the lab: a fixture per segment start and the acceptance runner.
//
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> 'speedrun/lab/quests/grand-tree.ts:--from=A:--to=P:--runs=3'
//
// The script launches its own client (LAB_RUNNERS=0) because each fixture ends with a relog: the
// quest tab's colours are painted by content (send_quest_progress), not by the varps, so after
// `::setvar` the tab reads the old status until login runs ~update_questlist.
//   flags: --from=<letter> --to=<letter> --runs=N --dialogue=fixed --spell=fire_bolt|fire_blast
//          --root=1..15 (P's %daconia_rock_root; random otherwise) --elena=29 (the scroll-read variant)
//
// Each run applies the fixture of its first segment (route levels, the H7 leftovers and H8, the
// quest items held at that point, %grandtree, the start tile), runs the module's Steps through
// runSteps with a TickLog, and prints one row per segment. After the runs: mean/min/max per
// segment and in total, the module's note rows (casts, climb refusals, free slots, the root drawn),
// and, on full A-P runs, the xp deltas. Ticks are from the arrival tile (the Grand Tree door).

import { wield } from '../../lib/act';
import { closeSession, openSession, relog } from '../../lib/session';
import { TickLog, type TickRow } from '../../lib/ticks';
import { waitTicks } from '../../lib/wait';
import { skillXp } from '../../lib/world';
import { BOUNDARY_STEP, runSteps } from '../../runner/step';
import { steps, stepId, type Options } from '../../quests/grand-tree';
import { arg, botArg, result } from '../common';
import { stats } from '../record';
import { cheat, clearInventory, give, mustTele, setStats, setvar } from '../setup';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N1', 'N2', 'O', 'P'] as const;
type Letter = (typeof LETTERS)[number];

/** Route levels at S11b (STEP-MANIFEST.md entry 8: 80/1/1, HP 28, Magic ~64 after the warlord, Prayer ~94, Agility 22 after S11a). */
const LEVELS = { attack: 80, strength: 1, defence: 1, hitpoints: 28, magic: 64, prayer: 94, agility: 22 };

/** Where each segment starts: %grandtree, the tile, and the quest items held from earlier segments. */
const STARTS: Record<Letter, { stage: number; at: [number, number, number]; items: string[] }> = {
    A: { stage: 0, at: [2465, 3489, 0], items: [] },
    B: { stage: 10, at: [2464, 3497, 0], items: ['grandtree_barksample', 'grandtree_translationbook'] },
    C: { stage: 20, at: [2677, 3087, 1], items: ['grandtree_translationbook', 'grandtree_scroll'] },
    D: { stage: 30, at: [2464, 3497, 0], items: ['grandtree_translationbook', 'grandtree_scroll'] },
    E: { stage: 40, at: [2477, 3463, 1], items: ['grandtree_translationbook', 'grandtree_scroll'] },
    F: { stage: 50, at: [2464, 3497, 0], items: ['grandtree_translationbook', 'grandtree_scroll'] },
    G: { stage: 60, at: [2465, 3496, 3], items: ['grandtree_translationbook', 'grandtree_scroll'] },
    H: { stage: 70, at: [2476, 3464, 1], items: ['grandtree_translationbook', 'grandtree_scroll', 'grandtree_journal'] },
    I: { stage: 80, at: [2466, 3496, 3], items: ['grandtree_translationbook', 'grandtree_scroll', 'grandtree_journal'] },
    J: { stage: 90, at: [2999, 3043, 0], items: ['grandtree_translationbook', 'grandtree_scroll', 'grandtree_journal', 'grandtree_order'] },
    K: { stage: 100, at: [2465, 3496, 3], items: ['grandtree_translationbook', 'grandtree_scroll', 'grandtree_journal', 'grandtree_order'] },
    L: { stage: 110, at: [2482, 3463, 1], items: ['grandtree_translationbook', 'grandtree_scroll', 'grandtree_journal', 'grandtree_order', 'grandtree_gloughskey', 'grandtree_invasionplans'] },
    M: { stage: 120, at: [2464, 3497, 0], items: ['grandtree_translationbook', 'grandtree_scroll', 'grandtree_journal', 'grandtree_order', 'grandtree_gloughskey', 'grandtree_twigt', 'grandtree_twigu', 'grandtree_twigz', 'grandtree_twigo'] },
    N1: { stage: 130, at: [2487, 3465, 2], items: ['grandtree_translationbook', 'grandtree_scroll', 'grandtree_journal', 'grandtree_order', 'grandtree_gloughskey'] },
    N2: { stage: 130, at: [2487, 3465, 2], items: ['grandtree_translationbook', 'grandtree_scroll', 'grandtree_journal', 'grandtree_order', 'grandtree_gloughskey'] },
    O: { stage: 140, at: [2491, 9864, 0], items: ['grandtree_translationbook', 'grandtree_scroll', 'grandtree_journal', 'grandtree_order', 'grandtree_gloughskey'] },
    P: { stage: 150, at: [2464, 9895, 0], items: ['grandtree_translationbook', 'grandtree_scroll', 'grandtree_journal', 'grandtree_order', 'grandtree_gloughskey'] },
};

const at = (l: Letter) => LETTERS.indexOf(l);

/** Teleport runes left at a segment's start: H8 gives 5 law and 4 water; B and C cast Ardougne (2+2 each), J casts Varrock (1 law, 3 air, 1 fire). */
function teleportRunes(l: Letter): Record<string, number> {
    const i = at(l);
    const ard = (i > at('B') ? 1 : 0) + (i > at('C') ? 1 : 0);
    const varrock = i > at('J') ? 1 : 0;
    return { lawrune: 5 - 2 * ard - varrock, waterrune: 4 - 2 * ard, firerune: 1 - varrock };
}

type Session = Awaited<ReturnType<typeof openSession>>;

async function fixture(session: Session, l: Letter, o: { elena: number; root?: number }): Promise<void> {
    const { sdk } = session;
    const st = STARTS[l];
    await clearInventory(sdk);
    await setStats(sdk, LEVELS);
    await setvar(sdk, 'treequest', 9);
    await setvar(sdk, 'elenaquest', o.elena);
    await setvar(sdk, 'grandtree', st.stage);
    if (l === 'P' && o.root) await setvar(sdk, 'daconia_rock_root', o.root);
    await give(sdk, ['staff_of_fire', 'amulet_of_magic']);
    // Unchecked, a dropped wield left the staff in the pack and the demon fight cast nothing.
    for (const w of [/^Staff of fire$/i, /^Amulet of magic$/i]) {
        const r = await wield(sdk, w);
        if (!r.ok) throw new Error(`fixture: could not wield ${w.source}`);
    }
    // H7 leftovers after the warlord (air 440, chaos 40, death 83), its sharks and antipoison.
    const stacks: Record<string, number> = { airrune: 440 - (at(l) > at('J') ? 3 : 0), chaosrune: 40, deathrune: 83, ...teleportRunes(l) };
    for (const [obj, n] of Object.entries(stacks)) if (n > 0) await give(sdk, obj, n);
    await give(sdk, ['shark', 'shark', '4doseantipoison', ...(at(l) <= at('M') ? ['4dose1agility'] : []), ...(o.elena < 30 ? ['ardougnescroll'] : []), ...st.items]);
    await mustTele(sdk, st.at[0], st.at[1], st.at[2]);
    await cheat(sdk, '~energy', 1);
    // Repaints the quest tab from the varps just set; logging out also drops every prayer.
    await relog(session);
    await waitTicks(sdk, 2);
}

const SKILLS = ['attack', 'magic', 'agility', 'prayer', 'hitpoints'] as const;
const xpOf = (session: Session) => Object.fromEntries(SKILLS.map(k => [k, skillXp(session.sdk, k)])) as Record<(typeof SKILLS)[number], number>;

/** The engine multiplies every xp drop (WorldConfig node.xpRate, NODE_XPRATE, default 25). */
const XP_RATE = Number(process.env.NODE_XPRATE ?? 25);
/** quest_grandtree.rs2's reward: Agility 7,900, Attack 18,400, Magic 2,150 (stat_advance takes tenths). */
function xpCheck(xp: Record<string, number>): string | null {
    if (xp.attack !== 18_400 * XP_RATE) return `Attack +${xp.attack}, expected ${18_400 * XP_RATE}`;
    if (xp.agility !== 7_900 * XP_RATE) return `Agility +${xp.agility}, expected ${7_900 * XP_RATE}`;
    if (xp.magic! <= 2_150 * XP_RATE) return `Magic +${xp.magic}, expected the 2,150 reward plus the fight's xp (x${XP_RATE})`;
    return null;
}

const from = (arg('from', 'A').toUpperCase()) as Letter;
const to = (arg('to', 'P').toUpperCase()) as Letter;
if (!LETTERS.includes(from) || !LETTERS.includes(to) || at(to) < at(from)) throw new Error(`--from/--to must be segment letters ${LETTERS.join(' ')}, from <= to`);
const runs = Number(arg('runs', '1'));
const opts: Options = { dialogue: arg('dialogue', 'fixed') as Options['dialogue'], demonSpell: arg('spell', 'fire_bolt') as Options['demonSpell'] };
const root = Number(arg('root', '0')) || undefined;
const elena = Number(arg('elena', '30'));

const session = await openSession(botArg(), { launch: true });
const all: Array<{ run: number; rows: TickRow[]; xp: Record<string, number> | null }> = [];
try {
    await cheat(session.sdk, 'setvar tutorial 1000');
    for (let run = 1; run <= runs; run++) {
        await fixture(session, from, { elena, ...(root ? { root } : {}) });
        const list = steps(opts).slice(at(from), at(to) + 1);
        const log = TickLog.open(`lab-grand-tree-${from}${to}-${run}-${Date.now()}`);
        const xp0 = xpOf(session);
        let error = '';
        // A trail of what changed (position jumps, HP, combat, messages), printed when a run fails.
        const trail: string[] = [];
        let prev: { x: number; z: number; hp: number } | null = null;
        let lastMsgTick = -1;
        const unsub = session.sdk.onStateUpdate(s => {
            const p = s.player;
            if (!p) return;
            const hp = s.skills?.find(k => k.name === 'Hitpoints')?.level ?? -1;
            if (!prev || Math.max(Math.abs(p.worldX - prev.x), Math.abs(p.worldZ - prev.z)) > 3 || hp !== prev.hp) {
                const attackers = (s.nearbyNpcs ?? []).filter(n => n.distance <= 2).map(n => `${n.name}@${n.distance}`).join(',');
                trail.push(`[${s.tick}] at ${p.worldX},${p.worldZ},${p.level} hp ${hp} prayer ${s.prayers?.prayerPoints} near ${attackers}`);
            }
            for (const m of s.gameMessages ?? []) if (m.tick > lastMsgTick) trail.push(`[${m.tick}] msg(${m.type}) ${m.text}`);
            lastMsgTick = Math.max(lastMsgTick, ...(s.gameMessages ?? []).map(m => m.tick));
            prev = { x: p.worldX, z: p.worldZ, hp };
            if (trail.length > 400) trail.splice(0, trail.length - 200);
        });
        try {
            await runSteps(session, list, { log, c: {}, shouldStop: () => false });
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
            console.log(`run ${run} trail before the failure:\n  ${trail.slice(-60).join('\n  ')}`);
        } finally {
            unsub();
        }
        const xp1 = xpOf(session);
        const xp = from === 'A' && to === 'P' && !error ? Object.fromEntries(SKILLS.map(k => [k, xp1[k] - xp0[k]])) : null;
        if (xp) {
            const bad = xpCheck(xp);
            if (bad) error = `xp: ${bad}`;
        }
        all.push({ run, rows: log.rows, xp });
        for (const r of log.rows) if (!r.kind && r.step !== BOUNDARY_STEP) console.log(`run ${run} ${r.step}: ${r.ticks}${r.ok ? '' : ` FAILED ${r.error ?? ''}`}`);
        for (const r of log.rows) if (r.kind === 'note') console.log(`run ${run} note ${r.step}: ${JSON.stringify(r.meta)}`);
        const total = log.rows.filter(r => !r.kind).reduce((a, r) => a + r.ticks, 0);
        console.log(`run ${run} total ${total} (steps and boundaries)${error ? ` STOPPED: ${error}` : ''}${xp ? ` xp ${JSON.stringify(xp)}` : ''}`);
        result(`grand_tree_run`, { run, from, to, opts, total, error: error || undefined, xp, log: log.path });
    }
} finally {
    await closeSession(session);
}

// Per segment over the runs; a segment's boundary row (the ticks before it starts) is added to it.
const names = steps(opts).slice(at(from), at(to) + 1).map(s => s.name);
const perRun = all.map(({ rows }) => {
    const t: Record<string, number> = {};
    for (const r of rows) {
        if (r.kind) continue;
        const key = r.step === BOUNDARY_STEP ? String((r.meta as { to?: string } | undefined)?.to ?? '') : r.step;
        const k = names.includes(key) ? key : '(end)';
        t[k] = (t[k] ?? 0) + r.ticks;
    }
    return t;
});
console.log(`\n## ${stepId} ${from}-${to}, ${runs} run(s), dialogue ${opts.dialogue}, ${opts.demonSpell}, NODE_TICKRATE ${process.env.NODE_TICKRATE ?? '?'} (measured, from the arrival tile)\n`);
console.log('| Segment | mean | min | max | n |');
console.log('|---|---|---|---|---|');
for (const n of [...names, '(end)']) {
    const xs = perRun.map(t => t[n]).filter((x): x is number => x !== undefined);
    if (!xs.length) continue;
    const st = stats(xs);
    console.log(`| ${n} | ${st.mean} | ${st.min} | ${st.max} | ${st.n} |`);
}
const totals = perRun.map(t => Object.values(t).reduce((a, b) => a + b, 0));
const ts = stats(totals);
console.log(`| **Total** | ${ts.mean} | ${ts.min} | ${ts.max} | ${ts.n} |`);
result('grand_tree_summary', { from, to, runs, opts, totals, perRun, notes: all.flatMap(a => a.rows.filter(r => r.kind === 'note').map(r => ({ run: a.run, step: r.step, meta: r.meta }))), xp: all.map(a => a.xp) });
process.exit(0);
