import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { RunCues, prepareCueDir } from '../runner/cue-keeper';
import { readCue } from '../helpers/altar-cue';
import { kitCheck as grandTreeKitCheck } from '../quests/grand-tree';
import type { BotWorldState } from '../../sdk/types';
import { buildChain, KIT_PARTNER_ROWS, PLACEMENT, sliceUntil, type ChainStep, type CueSink, type RunConfig } from '../runner/chain';
import { handOffFrom } from '../runner/handoff';
import { MANIFEST } from '../tools/slot-ledger';
import { baseToXp, levelForXp, xpForLevel } from '../lib/xp';
import { baseState, FakeSdk, flush, withRunes } from '../lib/fake-sdk';
import { TickLog, type TickRow } from '../lib/ticks';
import { h4PlanOf } from '../quests/dorics-quest';
import { tradeKind } from '../runner/handoff';
import { applyLedgerSubs, assertBoneDelivery, castXpTeleport, formatRehearsalReport, kitCheckWithout, labelSubstituteRows, rehearsalReport, SUBSTITUTE, substitutedChain, substituteRefusal, strikeUpperBound, teleportFor, teleportPlan, TELEPORT_XP, type Substitutions } from './twin-rehearsal';

const manifest = readFileSync(MANIFEST, 'utf8');
const cues: CueSink = { open: async () => {}, stop: () => {} };
const partners: Record<string, string> = {};
for (const r of [...Object.keys(PLACEMENT), ...KIT_PARTNER_ROWS]) partners[r] = 'cairn_mule2';
const cfg = { partners, firemakingTiles: [[3222, 3219], [3221, 3219]], rings: { giver: 'cairn_mule2' }, bones: { group: ['cairn_e07', 'cairn_e08', 'cairn_h65', 'cairn_e10'] }, courier: { giver: 'cairn_e15', below: 5 }, anvil: { giver: 'cairn_a01' }, cueDir: '/tmp/rs496-test-cue' } as unknown as RunConfig;

const SUBS: Substitutions = {
    ledger: {
        H3: { in: 'law rune x47 [s]; air rune x221 [s]; fire rune x9 [s]; mind rune x32 [s]' },
        H4k: { replace: { 'rune axe': 'steel axe' } },
        H7: { drop: ['amulet of magic'] },
        H8: { drop: ['agility potion(3)'] },
    },
    S03: { walkTo: { x: 3222, z: 3219 } },
    S04: 'teleport-xp',
    S07: 'babydragon',
    S11a: 25,
};

const names = (p: { receive: { name: string }[] }) => p.receive.map(r => r.name.toLowerCase());

describe('applyLedgerSubs', () => {
    const text = applyLedgerSubs(manifest, SUBS.ledger!);
    test('H4k carries the steel axe, not the rune axe', () => {
        expect(names(handOffFrom(text, 'H4k'))).toContain('steel axe');
        expect(names(handOffFrom(text, 'H4k'))).not.toContain('rune axe');
        expect(names(handOffFrom(manifest, 'H4k'))).toContain('rune axe');
    });
    test('H7 drops the amulet of magic from its in and its equip, keeping the rest', () => {
        const p = handOffFrom(text, 'H7');
        expect(names(p)).not.toContain('amulet of magic');
        expect(names(p)).toContain('staff of fire');
        expect(JSON.stringify(p.wield).toLowerCase()).not.toContain('amulet');
        expect(JSON.stringify(handOffFrom(manifest, 'H7').wield).toLowerCase()).toContain('amulet');
    });
    test('H3 becomes the rune package', () => {
        const p = handOffFrom(text, 'H3');
        expect(names(p).sort()).toEqual(['air rune', 'fire rune', 'law rune', 'mind rune']);
        expect(p.receive.find(r => r.name.toLowerCase() === 'law rune')!.count).toBe(47);
    });
    test('every other row is byte-identical', () => {
        const a = manifest.split('\n');
        const b = text.split('\n');
        expect(b.length).toBe(a.length);
        const changed = a.flatMap((l, i) => (l !== b[i] ? [l.split(' | ')[0]] : []));
        expect(changed.sort()).toEqual(['| H3', '| H4k', '| H7', '| H8']);
    });
    test('a row or an item that is not there refuses', () => {
        expect(() => applyLedgerSubs(manifest, { H99: { in: 'x' } })).toThrow(/no such row/);
        expect(() => applyLedgerSubs(manifest, { H4k: { replace: { 'dragon axe': 'steel axe' } } })).toThrow(/no dragon axe/);
        expect(() => applyLedgerSubs(manifest, { H7: { drop: ['ring of wealth'] } })).toThrow(/no ring of wealth/);
    });
});

describe('substituteRefusal', () => {
    test('refuses the scored side, fleet names and the run owners', () => {
        expect(substituteRefusal('SCORED', 'rs/496', SUBS)).toMatch(/scored/);
        expect(substituteRefusal('cairn_mule2', 'rs/496', SUBS)).toMatch(/cairn_/);
        expect(substituteRefusal('cairn', 'rs/496', SUBS)).toMatch(/forbidden|cairn_/);
        expect(substituteRefusal('mossvale_r9', undefined, SUBS)).toMatch(/claim owner/);
        expect(substituteRefusal('mossvale_r9', 'run', SUBS)).toMatch(/scored run/);
        expect(substituteRefusal('mossvale_r9', 'host', SUBS)).toMatch(/scored run/);
    });
    test('refuses with no substitution file, so the plain chain stays run.ts', () => {
        expect(substituteRefusal('mossvale_r9', 'rs/496', null)).toMatch(/no substitution file/);
        expect(substituteRefusal('mossvale_r9', 'rs/496', {})).toMatch(/no substitution file/);
    });
    test('a throwaway under its own claim may run it', () => {
        expect(substituteRefusal('mossvale_r9', 'rs/496', SUBS)).toBeNull();
    });
});

describe('teleport xp plan', () => {
    test('from Magic 25: 9 Varrock, 9 Falador, 28 Camelot to 59 (46 law runes)', () => {
        expect(teleportPlan(xpForLevel(25))).toEqual({ varrock: 9, falador: 9, camelot: 28 });
    });
    test('below 25 it plans from 25 (the strikes take it there)', () => {
        expect(teleportPlan(582)).toEqual(teleportPlan(xpForLevel(25)));
    });
    test('the spell at each band', () => {
        expect([25, 36, 37, 44, 45, 58].map(teleportFor)).toEqual(['varrock', 'varrock', 'falador', 'falador', 'camelot', 'camelot']);
    });
});

describe('substitutedChain', () => {
    const plain = sliceUntil(buildChain(cfg, { cues, manifest }), 'H11r');
    const sub = sliceUntil(substitutedChain(cfg, cues, SUBS, manifest), 'H11r');
    test('S04 becomes the H3 rune hand-off then teleport xp; S03 gets its row walk; S10b A-kit loses the amulet', () => {
        const subNames = sub.filter(s => s.name.startsWith(SUBSTITUTE)).map(s => s.name);
        expect(subNames).toContain(`${SUBSTITUTE} S03 walk to the dropper row`);
        expect(subNames).toContain(`${SUBSTITUTE} H3 runes for rings`);
        expect(subNames).toContain(`${SUBSTITUTE} S04 teleport xp`);
        expect(subNames).toContain(`${SUBSTITUTE} S10b:A-kit (no amulet of magic)`);
        for (const id of ['H4k', 'S07', 'H7', 'S10b', 'S11b', 'S12']) expect(sub.filter(s => s.id === id).every(s => s.name.startsWith(SUBSTITUTE))).toBe(true);
        expect(subNames).toContain(`${SUBSTITUTE} S05:A-h4-swap`);
        expect(sub.length).toBe(plain.length + 2);
    });
    test('every other step keeps its id, name and order', () => {
        const keep = (c: typeof plain) => c.filter(s => s.id !== 'S04' && !s.name.includes('S03 walk to the dropper row') && !s.name.includes('S10b:A-kit')).map(s => `${s.id} ${s.name.replace(/^SUBSTITUTE /, '')}`);
        expect(keep(sub)).toEqual(keep(plain));
    });
    test('the S04 hand-off is cued as mule2\'s {H3, mule} package', () => {
        const h3 = sub.find(s => s.name === `${SUBSTITUTE} H3 runes for rings`)!;
        expect(h3.cue).toEqual({ step: 'H3', family: 'mule' });
    });
    test('no substitution: the plain chain', () => {
        expect(substitutedChain(cfg, cues, {}, manifest).map(s => s.name)).toEqual(buildChain(cfg, { cues, manifest }).map(s => s.name));
    });
});

describe('kitCheckWithout', () => {
    const item = (name: string, count = 1) => ({ name, count, id: 0, slot: 0 });
    const state = (inv: ReturnType<typeof item>[], worn: ReturnType<typeof item>[]) => ({ inventory: inv, equipment: worn }) as unknown as BotWorldState;
    const kit = [item('Logs', 6), item('Antipoison(3)'), item('Shark', 2), item('Death rune', 110), item('Chaos rune', 40), item('Air rune', 550)];
    test('the kit without the amulet passes once the staff of water is gone', () => {
        expect(kitCheckWithout(state(kit, [item('Staff of fire')]), ['amulet of magic'])).toBe(true);
        expect(kitCheckWithout(state([...kit, item('Staff of water')], [item('Staff of fire')]), ['amulet of magic'])).toMatch(/staff of water/);
    });
    test('it still wants the amulet when it is not dropped', () => {
        expect(kitCheckWithout(state(kit, [item('Staff of fire')]), [])).toMatch(/Amulet of magic not worn/i);
    });
});

describe('teleport plan achieves the required level', () => {
    test('each next spell is legal and the last cast is necessary for Magic 59', () => {
        let xp = xpForLevel(25);
        const plan = teleportPlan(xp);
        let beforeLast = xp;
        for (const spell of ['varrock', 'falador', 'camelot'] as const) {
            for (let i = 0; i < plan[spell]; i++) {
                expect(levelForXp(xp)).toBeGreaterThanOrEqual(TELEPORT_XP[spell].level);
                beforeLast = xp;
                xp += baseToXp(TELEPORT_XP[spell].base);
            }
        }
        expect(levelForXp(beforeLast)).toBeLessThan(59);
        expect(levelForXp(xp)).toBe(59);
        expect(levelForXp(xp)).toBeGreaterThanOrEqual(51); // Ardougne, before H11r.
        expect(Object.values(plan).reduce((a, n) => a + n, 0)).toBe(46);
    });
});

describe('runtime substitution boundaries', () => {
    test('H4 on a ringless receiver receives the package without a ring swap', () => {
        const plan = h4PlanOf(baseState(), handOffFrom(manifest, 'H4'));
        expect(plan.give).toEqual([]);
        expect(plan.placeholders).toEqual([]);
        expect(tradeKind(plan)).toBe('receive');
    });

    test('the babydragon path keeps the final runes and axe checks, but not Prayer 99', () => {
        const sub = substitutedChain(cfg, cues, SUBS, manifest);
        const willow = sub.find(s => s.name === 'SUBSTITUTE woodcutting:willow-73-99')!;
        const normal = buildChain(cfg, { cues, manifest }).find(s => s.name === 'woodcutting:willow-73-99')!;
        const item = (name: string, slot: number) => ({ id: 0, name, slot, count: 1, optionsWithIndex: [] });
        const state = withRunes(baseState({
            skills: [{ name: 'Woodcutting', baseLevel: 99, level: 99, experience: xpForLevel(99) }, { name: 'Prayer', baseLevel: 50, level: 50, experience: xpForLevel(50) }] as BotWorldState['skills'],
            inventory: [item('Steel axe', 0), item('Knife', 1), item('Logs', 2)],
        }), { lawrune: 1, airrune: 5 });
        expect(willow.postconditions(state, {})).toBe(true);
        expect(normal.postconditions(state, {})).toMatch(/Prayer/);
        expect(willow.postconditions(withRunes(state, {}), {})).toMatch(/last load/);
    });

    test('an XP teleport confirms even if the landing tile is unchanged, then waits for the script and scene', async () => {
        const skill = (experience: number) => [{ name: 'Magic', baseLevel: 45, level: 45, experience }] as BotWorldState['skills'];
        const xp = xpForLevel(45);
        const sdk = new FakeSdk(withRunes(baseState({ tick: 10, skills: skill(xp), player: { worldX: 2757, worldZ: 3477, level: 0, hp: 10, maxHp: 10 } as BotWorldState['player'] }), { lawrune: 2, airrune: 10 }));
        let finished = false;
        const p = castXpTeleport(sdk as never, 'camelot').then(r => { finished = true; return r; });
        await flush();
        expect(sdk.sent).toEqual([{ method: 'sendClickComponent', args: [1174] }]);
        sdk.tick({ skills: skill(xp + baseToXp(55.5)) });
        await flush();
        expect(finished).toBe(false);
        for (let i = 0; i < 3; i++) { sdk.tick({ sceneReady: false }); await flush(); }
        expect(finished).toBe(false);
        sdk.tick({ sceneReady: true });
        await flush();
        expect(await p).toMatchObject({ ticks: 5, xp: baseToXp(55.5) });
        expect(sdk.sent).toHaveLength(1);
    });
});

describe('substitute reporting', () => {
    const chain = [{ id: 'S02', name: 'S02 magic' }, { id: 'S04', name: 'SUBSTITUTE S04 teleport xp' }] as ChainStep[];
    const row = (step: string, ticks: number): TickRow => ({ v: 1, runId: 'r', account: 'SCORED', sessionId: 1, step, startTick: 0, endTick: ticks, ticks, wallMs: 0, ok: true, tickMs: 400, at: '' });
    test('substitute step rows carry metadata and are absent from measured columns/totals', () => {
        const log = TickLog.memory();
        const undo = labelSubstituteRows(log, chain);
        log.append(row('S02 magic', 20));
        log.append(row('SUBSTITUTE S04 teleport xp', 400));
        log.append({ ...row('(substitute) S04', 0), kind: 'note', meta: { substitute: 'teleport-xp' } });
        expect(log.rows[1]!.meta?.substitute).toBeTruthy();
        undo();
        const r = rehearsalReport(log.rows, chain, readFileSync('docs/speedrun/RUN-ORDER.md', 'utf8'));
        expect(r.partial).toBe(true);
        expect(r.totalTicks).toBe(20);
        expect(r.steps.map(s => s.id)).toEqual(['S02']);
        expect(r.substitutes).toEqual([{ step: 'SUBSTITUTE S04 teleport xp', ticks: 400, ok: true }]);
        expect(formatRehearsalReport(r)).toContain('excluded from measured totals');
    });
});

describe('real cue routing and inventory bounds', () => {
    test('H3 opens and stops through RunCues in the mule directory, not the main one', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'twin-cues-'));
        const mule = join(dir, 'mule');
        prepareCueDir(dir, { fresh: true });
        prepareCueDir(mule, { fresh: true });
        const keeper = new RunCues({ main: dir, mule }, 'throwaway');
        const sdk = new FakeSdk(baseState());
        const off = keeper.attach(sdk);
        try {
            for (let i = 0; i < 4; i++) sdk.tick();
            const h3 = substitutedChain({ ...cfg, cueDir: dir }, keeper, SUBS, manifest).find(s => s.name === 'SUBSTITUTE H3 runes for rings')!;
            // No partner is fabricated: fresh entry refuses until the real mule is staged in view.
            expect(h3.preconditions(sdk.getState()!, {})).toMatch(/not in view/);
            // Resume of a delivered hand-off exercises the same cue wrapper without faking a trade.
            await h3.resume!({ sdk, log: TickLog.memory(), session: { name: 'throwaway', sessionId: 1 }, c: {} } as never);
            expect(readCue(mule)).toMatchObject({ scope: { step: 'H3', family: 'mule' }, stop: true, seq: 2 });
            expect(existsSync(join(dir, 'cue.json'))).toBe(false);
        } finally { off(); keeper.close(); rmSync(dir, { recursive: true, force: true }); }
    });

    test('H1 plus H3 cover worst-case all-splash strikes, all teleports, and the next leg', () => {
        const h1 = handOffFrom(manifest, 'H1');
        const h3 = handOffFrom(applyLedgerSubs(manifest, SUBS.ledger!), 'H3');
        const n = (p: typeof h3, name: string) => p.receive.find(i => i.name.toLowerCase() === name)?.count ?? 0;
        const strikes = strikeUpperBound(xpForLevel(7));
        expect(strikes).toBe(32);
        const t = teleportPlan(xpForLevel(25));
        const airs = strikes + t.varrock * 3 + t.falador * 3 + t.camelot * 5 + 3;
        expect(n(h3, 'mind rune')).toBeGreaterThanOrEqual(strikes);
        expect(n(h1, 'air rune') + n(h3, 'air rune') - 5).toBeGreaterThanOrEqual(airs);
        expect(n(h3, 'fire rune')).toBeGreaterThanOrEqual(t.varrock);
        expect(n(h3, 'law rune')).toBeGreaterThanOrEqual(Object.values(t).reduce((a, n) => a + n, 0) + 1);
    });

    test('potion-free S11a actually reaches the Grand Tree requirement, not just its old level22', () => {
        const chain = substitutedChain(cfg, cues, SUBS, manifest);
        const step = chain.find(s => s.id === 'S11a')!;
        const state = (level: number) => withRunes(baseState({ skills: [{ name: 'Agility', baseLevel: level, level, experience: xpForLevel(level) }] as BotWorldState['skills'] }), { lawrune: 7, waterrune: 6, airrune: 550, chaosrune: 40 });
        expect(step.postconditions(state(22), {})).not.toBe(true);
        expect(step.postconditions(state(25), {})).toBe(true);
        expect(grandTreeKitCheck(state(22))).toMatch(/no Agility potion/);
        expect(grandTreeKitCheck(state(25))).toBe(true);
        expect(names(handOffFrom(applyLedgerSubs(manifest, SUBS.ledger!), 'H8'))).not.toContain('agility potion(3)');
    });

    test('five observed receiver trades include the final giver, exact load counts and teleport runes', () => {
        const group = cfg.bones.group!;
        const row = (n: number, i: number): TickRow => ({ v: 1, runId: 'r', account: 'SCORED', sessionId: 1, step: 'woodcutting:bones-load', startTick: 0, endTick: 1, ticks: 1, wallMs: 0, ok: true, tickMs: 400, at: '', kind: 'note', meta: { kind: 'wc-bones-load', giver: i === 4 ? group.at(-1) : group[i % 4], received: n } });
        const rows = [23, 23, 23, 23, 21].map(row);
        const state = withRunes(baseState(), { lawrune: 1, airrune: 5 });
        expect(() => assertBoneDelivery(rows, state, group)).not.toThrow();
        expect(() => assertBoneDelivery(rows.slice(0, 4), state, group)).toThrow(/five successful/);
        expect(() => assertBoneDelivery([...rows, rows[0]!], state, group)).toThrow(/five successful/);
        expect(() => assertBoneDelivery(rows.map((r, i) => i === 4 ? { ...r, meta: { ...r.meta, giver: group[0] } } : r), state, group)).toThrow(/final giver/);
        expect(() => assertBoneDelivery(rows, withRunes(state, {}), group)).toThrow(/Camelot runes/);
    });
});
