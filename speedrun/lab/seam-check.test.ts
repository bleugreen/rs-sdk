import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { BotWorldState } from '../../sdk/types';
import { QUESTS, type QuestKey } from '../data/quest-stages';
import { annotation } from '../lib/attempt';
import { baseState, FakeSdk } from '../lib/fake-sdk';
import { objPack } from '../lib/obj-pack';
import { isComplete } from '../lib/quests';
import { TickLog, type TickRow } from '../lib/ticks';
import { xpForLevel } from '../lib/xp';
import { buildChain, KIT_PARTNER_ROWS, PLACEMENT, type RunConfig } from '../runner/chain';
import { MANIFEST } from '../tools/slot-ledger';
import { boundaryAt, chunkStart, SKILLS, type Boundary } from './boundary';
import { CHUNK_END_STEP, checkSeam, formatSeam, lastStepReached, throughChunk, unresolvedItem, watchChunkEnd, type ChunkEnd } from './seam-check';

const manifest = readFileSync(MANIFEST, 'utf8');
const runOrder = readFileSync(join(import.meta.dir, '../../docs/speedrun/RUN-ORDER.md'), 'utf8');
const partners = Object.fromEntries([...Object.keys(PLACEMENT), ...KIT_PARTNER_ROWS, 'H4m'].map(id => [id, 'p']));
const cfg: RunConfig = { partners, firemakingTiles: '3240,3296', rings: { giver: 'r' }, bones: { giver: 'b' }, courier: { giver: 'c', below: 3 }, anvil: { giver: 'a' }, cueDir: '/tmp/seam-test' };
const chain = buildChain(cfg, { cues: { open: async () => {}, stop: () => {} } });
const at = (chunk: string): Boundary => boundaryAt(chain, chunkStart(chain, chunk), { runOrder, manifest });
const pack = objPack();
const log = TickLog.memory('seam-test');

/** The end state that equals what boundaryAt stages for the chunk after it. */
function endEqual(b: Boundary, over: Partial<ChunkEnd> = {}): ChunkEnd {
    const prev = chain[b.start - 1]!;
    const status = (key: QuestKey) => {
        const q = b.quests.find(x => x.key === key);
        if (!QUESTS[key].questList) return null;
        return q ? (isComplete(key, q.value) ? 'complete' : 'started') : 'not_started';
    };
    return {
        lastStep: { index: b.start - 1, id: prev.id, name: prev.name, ok: true },
        code: 0,
        tick: 5000,
        skills: SKILLS.map(s => ({ name: s, level: b.levels[s].level, xp: xpForLevel(b.levels[s].level) })),
        inventory: b.inv.map(i => ({ id: pack.ids.get(i.obj)!, name: i.name, count: i.n })),
        equipment: b.worn.map(i => ({ id: pack.ids.get(i.obj)!, name: i.name, count: i.n })),
        questTab: true,
        quests: (Object.keys(QUESTS) as QuestKey[]).map(key => ({ key, status: status(key) })),
        questPoints: b.qp,
        bank: null,
        tile: { x: b.tile!.x, z: b.tile!.z, level: b.tile!.level ?? 0 },
        ...over,
    };
}

const endRow = (end: ChunkEnd): TickRow => annotation(log, 'lab', 'note', CHUNK_END_STEP, { startTick: end.tick, meta: { ...end } });
const stageRow = (chunk: string): TickRow => annotation(log, 'lab', 'gate', `(stage) ${chunk}`, {});

describe('the seam check', () => {
    test('an end state equal to the next boundary passes, with nothing allowed', () => {
        const b = at('S10');
        const r = checkSeam([stageRow('S05'), endRow(endEqual(b))], chain, b, 'S10');
        expect(r.failures).toEqual([]);
        expect(r.allowed).toEqual([]);
        expect(r.ok).toBe(true);
        expect(r.unchecked).toEqual(['bank: never seen open in the chunk']);
        expect(formatSeam(r)).toStartWith('RESULT seam S05->S10 {"prev":"S05","next":"S10","ok":true');
    });

    test('an H8-style rune deficit fails, naming the field, both counts and the ledger row the boundary stages from', () => {
        const b = at('S15');
        const law = b.inv.find(i => i.obj === 'lawrune')!;
        expect(law.n).toBeGreaterThan(1);
        const end = endEqual(b);
        end.inventory = end.inventory.map(i => (i.id === pack.ids.get('lawrune') ? { ...i, count: law.n - 2 } : i));
        const r = checkSeam([stageRow('S10'), endRow(end)], chain, b, 'S15');
        expect(r.ok).toBe(false);
        expect(r.failures).toEqual([{ field: `pack law rune (lawrune @${pack.ids.get('lawrune')})`, measured: law.n - 2, staged: law.n, source: `ledger, after ${b.ledgerAfter}` }]);
        expect(b.ledgerAfter).toBe('S14');
    });

    test('an allowed difference passes and is listed with its allowance: xp mid-level, a few tiles off the leg start', () => {
        const b = at('S10');
        const end = endEqual(b);
        end.skills = end.skills.map(s => (s.name === 'runecraft' ? { ...s, xp: xpForLevel(s.level) + 100 } : s));
        end.tile = { ...end.tile!, x: end.tile!.x + 3 };
        const r = checkSeam([endRow(end)], chain, b, 'S10');
        expect(r.ok).toBe(true);
        expect(r.prev).toBe('S00');
        expect(r.allowed.map(d => `${d.field}: ${d.allowance}`)).toEqual(['xp runecraft: xp-in-band', 'tile: tile-near-start']);
        expect(r.allowed[0]!.measured).toBe(xpForLevel(44) + 100);
    });

    test('a difference past an allowance fails: xp into the next level, a level off a stated one, a tile too far, a surplus stack, a quest not done', () => {
        const b = at('S10');
        const end = endEqual(b);
        end.skills = end.skills.map(s => (s.name === 'runecraft' ? { ...s, xp: xpForLevel(45) } : s.name === 'magic' ? { ...s, level: 60, xp: xpForLevel(60) } : s));
        end.tile = { ...end.tile!, z: end.tile!.z + 40 };
        end.inventory = [...end.inventory, { id: pack.ids.get('coins')!, name: 'Coins', count: 7 }];
        end.quests = end.quests.map(q => (q.key === 'doric' ? { ...q, status: 'started' } : q));
        const r = checkSeam([endRow(end)], chain, b, 'S10');
        expect(r.ok).toBe(false);
        expect(r.failures.map(d => d.field)).toEqual(['level magic', 'xp runecraft', 'quest doric', `pack coins (coins @${pack.ids.get('coins')})`, 'tile']);
    });

    test('a stack the boundary marks unresolved is allowed with the unresolved entry', () => {
        const b = at('S22');
        expect(b.unresolved.some(u => u.startsWith('body rune:'))).toBe(true);
        const end = endEqual(b);
        end.inventory = [...end.inventory, { id: pack.ids.get('bodyrune')!, name: 'Body rune', count: 12 }];
        const r = checkSeam([endRow(end)], chain, b, 'S22');
        expect(r.ok).toBe(true);
        expect(r.allowed).toEqual([expect.objectContaining({ field: `pack body rune (bodyrune @${pack.ids.get('bodyrune')})`, measured: 12, staged: 0, allowance: 'unresolved' })]);
        // Mage Arena is off the quest tab: nothing to diff, listed as unchecked rather than allowed.
        expect(r.unchecked).toContain('quest magearena: off the quest tab, no status published (staged magearena=8); its items are compared as stacks');
    });

    test('a log without a chunk-end row fails with that reason, never passes by default', () => {
        const b = at('S10');
        const r = checkSeam([stageRow('S05')], chain, b, 'S10');
        expect(r.ok).toBe(false);
        expect(r.reason).toContain(`no ${CHUNK_END_STEP} row`);
    });

    test('a chunk that stopped before the seam fails with where it stopped', () => {
        const b = at('S10');
        const r = checkSeam([endRow(endEqual(b, { lastStep: { index: 3, id: 'S07', name: 'S07 prayer', ok: false }, code: 1 }))], chain, b, 'S10');
        expect(r.ok).toBe(false);
        expect(r.reason).toContain('stopped at S07 "S07 prayer" (failed), exit 1');
    });

    test('a bank the chunk left items in fails: the next chunk starts on an empty one', () => {
        const b = at('S10');
        const r = checkSeam([endRow(endEqual(b, { bank: { tick: 4000, items: [{ id: 995, name: 'Coins', count: 5 }] } }))], chain, b, 'S10');
        expect(r.failures.map(d => d.field)).toEqual(['bank']);
    });

    test('unresolved entries name their item', () => {
        expect(unresolvedItem('body rune: the ledger carries it at an unknown count (after H17e)')).toEqual({ name: 'body rune' });
        expect(unresolvedItem('<enchanted ring> x15: magic.ts ...')).toEqual({ name: 'enchanted ring' });
        expect(unresolvedItem('monkey bones @3183 (noted): no ::give name')).toEqual({ name: 'monkey bones', id: 3183 });
    });

    test('throughChunk ends on the chunk\'s last step, and boundaryAt reads the same boundary from it', () => {
        const t = throughChunk(chain, 'S10');
        expect(t.at(-1)!.id).toMatch(/^S10[a-z]?$/);
        expect(boundaryAt(t, chunkStart(t, 'S10'), { runOrder, manifest })).toEqual(at('S10'));
    });
});

describe('the chunk-end row', () => {
    test('written on close from the last in-game frame: ids, base levels and xp, quests, the last open bank listing, the tile, the last step', () => {
        const l = TickLog.memory('end-test');
        const sdk = new FakeSdk(baseState({ inGame: true }));
        const w = watchChunkEnd({ sdk, name: 'lab1', sessionId: 2 }, chain, l);
        const step = chain[5]!;
        l.append({ v: 1, runId: l.runId, account: 'lab1', sessionId: 2, step: step.name, startTick: 1, endTick: 9, ticks: 8, wallMs: 0, ok: true, tickMs: 600, at: '' });
        sdk.tick({ bank: { isOpen: true, items: [{ slot: 0, id: 995, name: 'Coins', count: 50 }], noteMode: false } });
        sdk.tick({ bank: { isOpen: false, items: [], noteMode: false } });
        const last: Partial<BotWorldState> = {
            skills: [{ name: 'Magic', level: 61, baseLevel: 59, experience: xpForLevel(59) + 10 }],
            inventory: [{ slot: 0, id: 563, name: 'Law rune', count: 3, optionsWithIndex: [] }],
            equipment: [{ slot: 3, id: 1383, name: 'Staff of water', count: 1, optionsWithIndex: [] }],
            quests: { doric: 'complete' },
            questPoints: 1,
            player: { worldX: 3240, worldZ: 3296, level: 0 } as BotWorldState['player'],
        };
        sdk.tick(last);
        sdk.tick({ inGame: false });
        w.close(0);
        w.close(0);
        const rows = l.rows.filter(r => r.step === CHUNK_END_STEP);
        expect(rows.length).toBe(1);
        const m = rows[0]!.meta as unknown as ChunkEnd;
        expect(m.lastStep).toEqual({ index: 5, id: step.id, name: step.name, ok: true });
        expect(m.skills).toEqual([{ name: 'magic', level: 59, xp: xpForLevel(59) + 10 }]);
        expect(m.inventory).toEqual([{ id: 563, name: 'Law rune', count: 3 }]);
        expect(m.equipment).toEqual([{ id: 1383, name: 'Staff of water', count: 1 }]);
        expect(m.quests.find(q => q.key === 'doric')!.status).toBe('complete');
        expect(m.quests.find(q => q.key === 'cook')!.status).toBe('not_started');
        expect(m.questPoints).toBe(1);
        expect(m.bank).toEqual({ tick: 101, items: [{ id: 995, name: 'Coins', count: 50 }] });
        expect(m.tile).toEqual({ x: 3240, z: 3296, level: 0 });
        expect(m.code).toBe(0);
    });

    test('with no in-game frame the row is not ok and carries no state, so its seam fails', () => {
        const l = TickLog.memory('end-test');
        const sdk = new FakeSdk(null);
        watchChunkEnd({ sdk, name: 'lab1', sessionId: 1 }, chain, l).close(3);
        const b = at('S10');
        const r = checkSeam(l.rows, chain, b, 'S10');
        expect(r.ok).toBe(false);
        expect(r.reason).toContain('carries no end state (no in-game frame observed)');
    });

    test('the last step resolves forward through repeated names', () => {
        const name = chain[1]!.name;
        const row = (step: string, ok = true): TickRow => ({ v: 1, runId: 'x', account: 'a', sessionId: 0, step, startTick: 0, endTick: 0, ticks: 0, wallMs: 0, ok, tickMs: 600, at: '' });
        expect(lastStepReached([row(name), row(chain[2]!.name, false)], chain)).toEqual({ index: 2, id: chain[2]!.id, name: chain[2]!.name, ok: false });
        expect(lastStepReached([row('(boundary)')], chain)).toBeNull();
    });
});
