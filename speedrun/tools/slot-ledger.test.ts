import { describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { evidenceLabel, main, MANIFEST, parseItem, parseLedger, render, summary, walk, type LedgerEntry } from './slot-ledger';

const HEAD = '| row | in | out | equip | needAtStart | source |\n|---|---|---|---|---|---|\n';
const table = (...rows: string[]) => HEAD + rows.join('\n') + '\n';
const run = (md: string) => {
    const { rows, errors } = parseLedger(md);
    expect(errors).toEqual([]);
    return walk(rows);
};
const byRow = (entries: LedgerEntry[], row: string) => entries.find(e => e.row.row === row)!;
const fixture = (name: string) => readFileSync(join(import.meta.dir, 'fixtures/slot-ledger', `${name}.md`), 'utf8');

/** 26 unstackables and one stack: 27 used, 1 free. */
const NEARLY_FULL = '| S00 | junk x26 [u]; air rune x10 [s] | - | - | 27 | the kit (m) |';

describe('parseLedger: the agreed grammar', () => {
    test('in, out and equip entries, notes, all, ? and the source labels', () => {
        const { rows, errors } = parseLedger(table(
            '| H4 | clay x6 [u] (Doric; the quest); law rune x2 [s]; wine x? [n] | enchanted ring x20 (swap: `swap()`; same trade); coins all (drop) | +staff of fire; -staff of water | 14 | SUPPLIES H4 (r); rs/285 (m); guess (i) |',
        ));
        expect(errors).toEqual([]);
        expect(rows[0]).toMatchObject({
            row: 'H4',
            in: [{ name: 'clay', count: 6, kind: 'u' }, { name: 'law rune', count: 2, kind: 's' }, { name: 'wine', count: null, kind: 'n' }],
            out: [{ name: 'enchanted ring', count: 20, reason: 'swap' }, { name: 'coins', count: 'all', reason: 'drop' }],
            equip: [{ name: 'staff of fire', on: true }, { name: 'staff of water', on: false }],
            need: 14,
            evidence: ['m', 'r', 'i'],
        });
    });

    test('the table inside the Inventory ledger section, not a header quoted in a fence or another section', () => {
        const md = ['# Manifest', '', HEAD + '| X1 | - | - | - | 0 | elsewhere (r) |', '', '## Inventory ledger', '', '```', HEAD.trim(), '```', '', HEAD + '| S00 | a x1 [u] | - | - | ? | (r) |', 'after the table', '| S99 | - | - | - | 0 | not a row (r) |', '', '## Next section', ''].join('\n');
        const { rows, errors } = parseLedger(md);
        expect(errors).toEqual([]);
        expect(rows.map(r => [r.row, r.need])).toEqual([['S00', null]]);
    });

    test('malformed entries are errors naming the line, not guesses', () => {
        const { errors } = parseLedger(table('| S00 | clay x6 | - | - | 0 | (r) |', '| S01 | - | clay x6 (lost) | - | 0 | (r) |', '| S02 | - | - | staff | 0 | (r) |', '| S03 | - | - | - | many | (r) |', '| S04 | - | - |'));
        expect(errors).toHaveLength(5);
        expect(errors[0]).toMatch(/line 3 \(S00\): in entry "clay x6"/);
        expect(errors[1]).toMatch(/reason "lost"/);
        expect(errors[2]).toMatch(/equip entry "staff"/);
        expect(errors[3]).toMatch(/needAtStart "many"/);
        expect(errors[4]).toMatch(/line 7 \(S04\): 3 cells, expected 6/);
        expect(parseLedger('# nothing here').errors[0]).toMatch(/no table with the header/);
    });
});

describe('walk', () => {
    test('a scripted table that passes, row by row', () => {
        const entries = run(table(
            '| S00 | axe x1 [u]; air rune x25 [s] | - | - | 2 | the kit (r) |',
            '| H1 | staff x1 [u]; air rune x81 [s]; fire rune x80 [s] | - | - | 2 | SUPPLIES H1 (r) |',
            '| S01 | - | axe x1 (drop) | +staff | 0 | (r) |',
            '| H2 | essence x26 [u] | - | - | 26 | SUPPLIES H2 (m) |',
        ));
        expect(entries.map(e => [e.row.row, e.free, e.used, e.verdict])).toEqual([
            ['S00', 28, 2, 'pass'],
            ['H1', 26, 4, 'pass'],
            ['S01', 24, 2, 'pass'],
            ['H2', 26, 28, 'pass'],
        ]);
        expect(summary(entries).ok).toBe(true);
    });

    test("a hand-off's drops: after the need check, before the in must fit; a worn one leaves at no slot cost", () => {
        const rows = [
            '| S00 | khazard helmet x1 [u]; junk x26 [u] | - | +khazard helmet | 27 | (r) |',
            '| H13 | staff of fire x1 [u]; knife x1 [u]; air rune x1 [s] | junk x2 (drop); khazard helmet x1 (drop: unworn first) | +staff of fire | 1 | (r) |',
        ];
        const { rows: parsed, errors } = parseLedger(table(...rows));
        expect(errors).toEqual([]);
        expect(parsed[1]!.out.map(o => [o.name, o.count, o.reason])).toEqual([['junk', 2, 'drop'], ['khazard helmet', 1, 'drop']]);
        const entries = walk(parsed);
        // 2 free at the need check; the drops make it 4, so the trade's 3 fit; the staff's wield frees 1.
        expect(byRow(entries, 'H13')).toMatchObject({ free: 2, used: 26, verdict: 'pass', held: expect.not.stringContaining('khazard') });
        expect(byRow(entries, 'H13').worn).toBe('staff of fire x1');
        // Without the junk's drop the trade's 3 slots do not fit: the drops are what make the room.
        const short = run(table(rows[0]!, rows[1]!.replace('junk x2 (drop); ', '')));
        expect(byRow(short, 'H13')).toMatchObject({ verdict: 'SHORT' });
        expect(byRow(short, 'H13').notes.join('; ')).toMatch(/the trade adds 3 slots, 2 free/);
    });

    test('a table that fails at a named step, and the walk goes on to the end', () => {
        const entries = run(table(NEARLY_FULL, '| H5 | essence x2 [u] | - | - | 2 | (r) |', '| S06 | - | essence x2 (consume) | - | 0 | (r) |'));
        const h5 = byRow(entries, 'H5');
        expect(h5).toMatchObject({ free: 1, need: 2, verdict: 'SHORT' });
        expect(h5.notes.join('; ')).toMatch(/1 free against 2: 1 short; the trade adds 2 slots, 1 free/);
        expect(byRow(entries, 'S06')).toMatchObject({ verdict: 'OVERFLOW', used: 27 });
        const s = summary(entries);
        expect(s.ok).toBe(false);
        expect(s.failed[0]!.row.row).toBe('H5');
        expect(s.text).toMatch(/first failing row: H5/);
    });

    test('stackables merge into one slot; a stack consumed to zero frees it', () => {
        const entries = run(table(
            '| S00 | air rune x25 [s]; mind rune x15 [s] | - | - | 2 | (r) |',
            '| H1 | air rune x81 [s] | - | - | 0 | (r) |',
            '| S02 | - | mind rune x15 (consume) | - | 0 | (r) |',
            '| S03 | - | air rune x6 (consume) | - | 0 | (r) |',
        ));
        expect(byRow(entries, 'H1')).toMatchObject({ used: 2, held: 'air rune x106, mind rune x15' });
        expect(byRow(entries, 'S02')).toMatchObject({ used: 1, held: 'air rune x106' });
        expect(byRow(entries, 'S03').held).toBe('air rune x100');
        expect(run(table('| S00 | - | air rune x1 (consume) | - | 0 | (r) |'))[0]!).toMatchObject({ verdict: 'ERROR' });
        expect(run(table('| S00 | air rune x2 [s] | - | - | 0 | (r) |', '| S01 | - | air rune x3 (consume) | - | 0 | (r) |'))[1]!.notes[0]).toMatch(/air rune: 3 out, 2 held/);
    });

    test('noted items take one slot per name and merge; the same name unnoted is a different kind', () => {
        const entries = run(table(
            '| H21c | unfermented wine x520 [n] | - | - | 1 | (r) |',
            '| H21d | uncut diamond x391 [n]; unfermented wine x10 [n] | - | - | 1 | (r) |',
            '| S25d | - | uncut diamond all (deposit) | - | 0 | (r) |',
        ));
        expect(byRow(entries, 'H21c')).toMatchObject({ used: 1, held: 'unfermented wine x520 (noted)' });
        expect(byRow(entries, 'H21d')).toMatchObject({ used: 2, held: 'unfermented wine x530 (noted), uncut diamond x391 (noted)' });
        expect(byRow(entries, 'S25d').used).toBe(1);
        const mixed = run(table('| H1 | wine x5 [n] | - | - | 1 | (r) |', '| H2 | wine x1 [u] | - | - | 1 | (r) |'));
        expect(mixed[1]!.verdict).toBe('ERROR');
        expect(mixed[1]!.notes[0]).toMatch(/held as \[n\], added as \[u\]/);
    });

    test('worn items take no slots: +NAME frees one, -NAME takes one, an out may name a worn item', () => {
        const entries = run(table(
            '| H7 | staff of fire x1 [u]; rune arrow x200 [s]; shield x1 [u] | - | +staff of fire; +rune arrow; +shield | 3 | (r) |',
            '| H12 | magic shortbow x1 [u] | staff of fire x1 (swap: unwielded) | +magic shortbow; -shield | 1 | (r) |',
            '| S15 | - | rune arrow x50 (consume) | - | 0 | (r) |',
        ));
        expect(byRow(entries, 'H7')).toMatchObject({ used: 0, worn: 'staff of fire x1, rune arrow x200, shield x1' });
        // The swap takes the staff from the worn set at no slot cost; the shield comes back into the pack.
        expect(byRow(entries, 'H12')).toMatchObject({ free: 28, used: 1, held: 'shield x1', worn: 'rune arrow x200, magic shortbow x1' });
        expect(byRow(entries, 'S15').worn).toBe('rune arrow x150, magic shortbow x1');
        const notHeld = run(table('| S16 | - | - | +staff of fire | 0 | (r) |', '| S17 | - | - | -cape | 0 | (r) |'));
        expect(notHeld.map(e => [e.verdict, e.notes[0]])).toEqual([['ERROR', '+staff of fire: not held'], ['ERROR', '-cape: not worn']]);
    });

    test('a swap out frees its slots before the need check; any other out only after it', () => {
        const swap = run(table(NEARLY_FULL, '| H4 | ore x2 [u] | junk x2 (swap) | - | 2 | (r) |'));
        expect(byRow(swap, 'H4')).toMatchObject({ free: 3, verdict: 'pass', used: 27 });
        const drop = run(table(NEARLY_FULL, '| S05 | ore x2 [u] | junk x2 (drop) | - | 2 | (r) |'));
        expect(byRow(drop, 'S05')).toMatchObject({ free: 1, verdict: 'SHORT', used: 27 });
    });

    test('a step may take in more than its need once its outs leave; a hand-off must fit as one trade', () => {
        const step = run(table(NEARLY_FULL, '| S06 | runes x? [s] | junk x26 (consume) | - | 0 | (r) |'));
        expect(byRow(step, 'S06').verdict).toBe('pass');
        const handOff = run(table(NEARLY_FULL, '| H5 | essence x3 [u] | - | - | 1 | (r) |'));
        expect(byRow(handOff, 'H5').verdict).toBe('SHORT');
        expect(byRow(handOff, 'H5').notes).toContain('needAtStart 1 understates the 3 slots its in adds');
    });

    test('? counts: a ? need, and an unstackable at x? held, make rows unknown until it leaves; --strict fails them', () => {
        const entries = run(table(
            '| S00 | a x1 [u] | - | - | ? | (r) |',
            '| S10b | quest items x? [u] | - | - | 0 | (i) |',
            '| S11a | - | - | - | 0 | (r) |',
            '| S11b | - | quest items all (hand-in) | - | 0 | (r) |',
        ));
        expect(entries.map(e => e.verdict)).toEqual(['unknown', 'unknown', 'unknown', 'pass']);
        expect(byRow(entries, 'S10b').notes).toEqual(['held at an unknown count: quest items', '? counts: in quest items x?']);
        expect(summary(entries).ok).toBe(true);
        expect(summary(entries, true).ok).toBe(false);
        // A known shortfall is still a failure while something is unknown.
        const short = run(table('| S00 | stuff x? [u]; junk x27 [u] | - | - | 0 | (r) |', '| H1 | b x2 [u] | - | - | 2 | (r) |'));
        expect(byRow(short, 'H1').verdict).toBe('SHORT');
    });

    test('inferred-row marking: a row resting only on (i) citations, or on none, is INFERRED', () => {
        const entries = run(table('| A | - | - | - | 0 | rs/196 (m); MAN (i) |', '| B | - | - | - | 0 | SUPPLIES (r); a guess (i) |', '| C | - | - | - | 0 | from the docs (i) |', '| D | - | - | - | 0 | unlabelled |'));
        expect(entries.map(e => evidenceLabel(e.row))).toEqual(['m', 'r', 'INFERRED', 'INFERRED']);
        const text = render(entries);
        expect(text.split('\n')[0]).toMatch(/^row +\| evidence \| free/);
        expect(text.split('\n')[3]).toMatch(/^C +\| INFERRED \|/);
        expect(summary(entries).text).toMatch(/2 INFERRED/);
    });
});

describe('top-ups: NAME to N [K] brings the held count up to N', () => {
    const top = (held: string, entry: string, need = 0) => run(table(held, `| H10 | ${entry} | - | - | ${need} | (r) |`));

    test('the parse: count N and topUp; an ordinary x N entry carries no topUp; to ? is not a top-up', () => {
        const { rows } = parseLedger(table('| H10 | shark to 9 [u] (rs/257); law rune to 4 [s]; shark x8 [u] | - | - | 8 | (r) |'));
        expect(rows[0]!.in).toEqual([
            { name: 'shark', count: 9, kind: 'u', topUp: true },
            { name: 'law rune', count: 4, kind: 's', topUp: true },
            { name: 'shark', count: 8, kind: 'u' },
        ]);
        expect(parseLedger(table('| H10 | shark to ? [u] | - | - | 0 | (r) |')).errors[0]).toMatch(/in entry "shark to \? \[u\]": expected NAME xCOUNT \[s\|u\|n\] or NAME to N/);
    });

    test('unstackable: held below N takes N - held slots; at N or above, none and no change', () => {
        const s3 = '| S09 | shark x3 [u] | - | - | 0 | (r) |';
        expect(byRow(top(s3, 'shark to 9 [u]', 6), 'H10')).toMatchObject({ verdict: 'pass', used: 9, held: 'shark x9' });
        expect(byRow(top('| S09 | shark x9 [u] | - | - | 0 | (r) |', 'shark to 9 [u]'), 'H10')).toMatchObject({ used: 9, held: 'shark x9' });
        expect(byRow(top('| S09 | shark x11 [u] | - | - | 0 | (r) |', 'shark to 9 [u]'), 'H10')).toMatchObject({ used: 11, held: 'shark x11' });
        // Worn ones count towards N: one worn and two in the pack, to 4, brings one.
        const worn = run(table('| S09 | ring x3 [u] | - | +ring | 0 | (r) |', '| H10 | ring to 4 [u] | - | - | 1 | (r) |'));
        expect(byRow(worn, 'H10')).toMatchObject({ used: 3, held: 'ring x3', worn: 'ring x1' });
        // A hand-off's trade must fit what the top-up brings, not N.
        const tight = run(table('| S09 | junk x22 [u]; shark x3 [u] | - | - | 0 | (r) |', '| H10 | shark to 9 [u] | - | - | 6 | (r) |'));
        expect(byRow(tight, 'H10')).toMatchObject({ free: 3, verdict: 'SHORT' });
        expect(byRow(tight, 'H10').notes).toContain('the trade adds 6 slots, 3 free');
    });

    test('stackable: one slot when the pack holds none and some comes, else none; the count goes to N', () => {
        expect(byRow(top('| S09 | - | - | - | 0 | (r) |', 'law rune to 4 [s]', 1), 'H10')).toMatchObject({ used: 1, held: 'law rune x4' });
        expect(byRow(top('| S09 | law rune x2 [s] | - | - | 0 | (r) |', 'law rune to 4 [s]'), 'H10')).toMatchObject({ used: 1, held: 'law rune x4' });
        expect(byRow(top('| S09 | law rune x7 [s] | - | - | 0 | (r) |', 'law rune to 4 [s]'), 'H10')).toMatchObject({ used: 1, held: 'law rune x7' });
        // A quivered stack counts towards N; what comes lands in the pack as a stack of its own.
        const quiver = (n: number) => run(table(`| S14 | rune arrow x${n} [s] | - | +rune arrow | 0 | (r) |`, '| H10 | rune arrow to 200 [s] | - | - | 0 | (r) |'));
        expect(byRow(quiver(150), 'H10')).toMatchObject({ used: 1, held: 'rune arrow x50', worn: 'rune arrow x150' });
        expect(byRow(quiver(200), 'H10')).toMatchObject({ used: 0, held: '-', worn: 'rune arrow x200' });
        // Noted items follow the stackable rule.
        expect(byRow(top('| S09 | - | - | - | 0 | (r) |', 'wine to 10 [n]', 1), 'H10')).toMatchObject({ used: 1, held: 'wine x10 (noted)' });
    });

    test('an ordinary x N entry still adds N whatever is held; a top-up of a stack held at x? is noted unknown', () => {
        expect(byRow(top('| S09 | shark x3 [u] | - | - | 0 | (r) |', 'shark x8 [u]', 8), 'H10')).toMatchObject({ used: 11, held: 'shark x11' });
        const vague = byRow(top('| S09 | air rune x? [s] | - | - | 0 | (r) |', 'air rune to 6 [s]'), 'H10');
        expect(vague).toMatchObject({ used: 1, held: 'air rune x?' });
        expect(vague.notes).toContain('? counts: in air rune to 6: held at an unknown count');
    });
});

describe('item identity: NAME @ID, NAME(*) and <NAME> (rs/365)', () => {
    test('the parse: an id, a family and a placeholder; an unmarked entry carries none of them', () => {
        const { rows, errors } = parseLedger(table(
            '| H21d | guam potion (unf) @91 x41 [n] (obj `guamvial`); <bars> x25 [u]; prayer potion(*) x2 [u]; torch x1 [u] (unlit, obj `torch_unlit`) | antipoison(*) all (swap: dead); <platebody> x5 (swap); hammer @2347 x1 (swap) | - | 2 | (r) |',
        ));
        expect(errors).toEqual([]);
        expect(rows[0]!.in).toEqual([
            { name: 'guam potion (unf)', id: 91, count: 41, kind: 'n' },
            { name: 'bars', placeholder: true, count: 25, kind: 'u' },
            { name: 'prayer potion', family: true, count: 2, kind: 'u' },
            { name: 'torch', count: 1, kind: 'u' },
        ]);
        expect(rows[0]!.out).toEqual([
            { name: 'antipoison', family: true, count: 'all', reason: 'swap' },
            { name: 'platebody', placeholder: true, count: 5, reason: 'swap' },
            { name: 'hammer', id: 2347, count: 1, reason: 'swap' },
        ]);
        expect(Object.keys(parseItem('antipoison(3)'))).toEqual(['name']);
    });

    test('a malformed mark is an error naming the line, not part of a name', () => {
        const { errors } = parseLedger(table('| S00 | torch @lit x1 [u] | - | - | 0 | (r) |', '| S01 | <bars x1 [u] | - | - | 0 | (r) |', '| S02 | - | torch @594(*) x1 (drop) | - | 0 | (r) |'));
        expect(errors).toHaveLength(3);
        expect(errors[0]).toMatch(/line 3 \(S00\): item "torch @lit": expected NAME, NAME @ID, NAME\(\*\) or <NAME>/);
        expect(errors[1]).toMatch(/item "<bars"/);
        expect(errors[2]).toMatch(/item "torch @594\(\*\)"/);
    });

    test("rs/158's case 1, ambiguous game names: two ids under one name are two stacks", () => {
        const unf = run(table(
            '| H21d | unfinished potion @91 x41 [n]; unfinished potion @101 x405 [n] | - | - | 2 | (r) |',
            '| S25d | - | unfinished potion @91 all (deposit) | - | 0 | (r) |',
        ));
        expect(byRow(unf, 'H21d')).toMatchObject({ used: 2, held: 'unfinished potion x41 (noted), unfinished potion x405 (noted)' });
        expect(byRow(unf, 'S25d')).toMatchObject({ used: 1, held: 'unfinished potion x405 (noted)' });
        // By name they are one stack, a slot short of the truth.
        expect(byRow(run(table('| H21d | unfinished potion x41 [n]; unfinished potion x405 [n] | - | - | 1 | (r) |')), 'H21d').used).toBe(1);
        // H15 to T19-20: the unlit torch in, the lit one beside it, the unlit one burnt, the lit one dropped.
        const torch = run(table(
            '| H15 | torch @596 x1 [u] | - | - | 1 | (r) |',
            '| S19 | torch @594 x1 [u] | torch @596 x1 (consume) | - | 1 | (r) |',
            '| T19-20 | - | torch @594 x1 (drop) | - | 0 | (r) |',
        ));
        expect(torch.map(e => [e.row.row, e.verdict, e.used])).toEqual([['H15', 'pass', 1], ['S19', 'pass', 1], ['T19-20', 'pass', 0]]);
        // An unmarked name over two id stacks is ambiguous, unless it takes all of them.
        const both = '| S19 | torch @596 x1 [u]; torch @594 x1 [u] | - | - | 2 | (r) |';
        expect(run(table(both, '| T19 | - | torch x1 (drop) | - | 0 | (r) |'))[1]!.notes[0]).toBe('torch names 2 stacks (torch @596, torch @594); name it by id');
        expect(byRow(run(table(both, '| T19 | - | torch all (drop) | - | 0 | (r) |')), 'T19')).toMatchObject({ verdict: 'pass', used: 0 });
    });

    test('case 2, dose-changing potions: NAME(*) takes from every dose form held, each a stack of its own', () => {
        const e = run(table(
            '| H7 | antipoison(3) x1 [u] | - | - | 1 | (r) |',
            '| H12 | antipoison(4) x1 [u]; prayer potion(4) x2 [u] | - | - | 3 | (r) |',
            '| H13 | - | antipoison(*) all (swap: whatever doses are left) | - | 0 | (r) |',
            '| H14 | - | prayer potion(*) x2 (swap) | - | 0 | (r) |',
        ));
        expect(byRow(e, 'H12')).toMatchObject({ used: 4, held: 'antipoison(3) x1, antipoison(4) x1, prayer potion(4) x2' });
        expect(byRow(e, 'H13')).toMatchObject({ verdict: 'pass', used: 2, held: 'prayer potion(4) x2' });
        expect(byRow(e, 'H14')).toMatchObject({ verdict: 'pass', used: 0 });
        // A count comes out of the forms in turn, and no more than is held.
        const mixed = '| H12 | prayer potion(4) x1 [u]; prayer potion(2) x2 [u] | - | - | 3 | (r) |';
        expect(byRow(run(table(mixed, '| H14 | - | prayer potion(*) x2 (swap) | - | 0 | (r) |')), 'H14')).toMatchObject({ used: 1, held: 'prayer potion(2) x1' });
        expect(run(table(mixed, '| H14 | - | prayer potion(*) x4 (swap) | - | 0 | (r) |'))[1]!.notes[0]).toBe('prayer potion(*): 4 out, 3 held');
        // A family in is its own stack; a potion of another name is not one of its doses.
        const own = run(table('| H13 | prayer potion(*) x2 [u]; super prayer potion(4) x1 [u] | - | - | 3 | (r) |', '| H14 | - | prayer potion(*) all (swap) | - | 0 | (r) |'));
        expect(byRow(own, 'H13').held).toBe('prayer potion(*) x2, super prayer potion(4) x1');
        expect(byRow(own, 'H14')).toMatchObject({ used: 1, held: 'super prayer potion(4) x1' });
    });

    test('case 3, category placeholders: <NAME> takes its slots, and an unconverted row finds it by name', () => {
        const e = run(table(
            '| H21a | hammer x1 [u]; <bars> x25 [u] | - | - | 26 | (r) |',
            '| S25a | <platebody> x5 [u] | bars x25 (consume: smithed) | - | 0 | (r) |',
            '| H21d | - | <platebody> x5 (swap) | - | 0 | (r) |',
        ));
        expect(byRow(e, 'H21a')).toMatchObject({ used: 26, held: 'hammer x1, bars x25' });
        expect(byRow(e, 'S25a')).toMatchObject({ verdict: 'pass', used: 6, held: 'hammer x1, platebody x5' });
        expect(byRow(e, 'H21d')).toMatchObject({ verdict: 'pass', used: 1 });
    });

    test('case 4, noted stacks: an id at [n] is one slot; a table converted one row at a time walks as by name', () => {
        const byName = '| H21d | guam potion (unf) x41 [n] | - | - | 1 | (r) |';
        const byId = '| H21d | guam potion (unf) @91 x41 [n] | - | - | 1 | (r) |';
        expect(byRow(run(table(byId)), 'H21d')).toMatchObject({ used: 1, held: 'guam potion (unf) x41 (noted)' });
        expect(byRow(run(table(byName, '| S25d | - | guam potion (unf) @91 all (deposit) | - | 0 | (r) |')), 'S25d')).toMatchObject({ verdict: 'pass', used: 0 });
        expect(byRow(run(table(byId, '| S25d | - | guam potion (unf) all (deposit) | - | 0 | (r) |')), 'S25d')).toMatchObject({ verdict: 'pass', used: 0 });
        // An id in on a stack an unconverted row brought in by name merges with it (and gives it the id)...
        expect(byRow(run(table(byName, '| H21e | guam potion (unf) @91 x9 [n] | - | - | 0 | (r) |')), 'H21e')).toMatchObject({ used: 1, held: 'guam potion (unf) x50 (noted)' });
        // ...but an id stack is not another id's.
        expect(byRow(run(table(byId, '| H21e | guam potion (unf) @101 x9 [n] | - | - | 1 | (r) |')), 'H21e').used).toBe(2);
    });
});

describe("rs/158's fold-in 18 table: the id grammar beside the names", () => {
    // fold-in-18.walk.txt was written by the parser before rs/365, on fold-in-18.md.
    const golden = fixture('fold-in-18').length ? readFileSync(join(import.meta.dir, 'fixtures/slot-ledger/fold-in-18.walk.txt'), 'utf8') : '';
    const output = (md: string) => {
        const entries = run(md);
        return `${render(entries)}\n\n${summary(entries).text}\n`;
    };

    test('walks byte-identical to the parser before ids', () => {
        expect(output(fixture('fold-in-18'))).toBe(golden);
    });

    test('with its touched rows written as NAME @ID, NAME(*) and <NAME>, walks the same', () => {
        const ids = fixture('fold-in-18-ids');
        for (const form of ['guam potion (unf) @91 x41 [n]', 'torch @596 x1 [u]', 'antipoison(*) all', 'prayer potion(*) all', '<bars> x25 [u]', '<gem ring> x20 [u]']) expect(ids).toContain(form);
        expect(output(ids)).toBe(golden);
    });
});

describe("tonight's routes (fixtures inferred from the documents)", () => {
    test('as first routed: H4 refused, 22 free against 23 (rs/285)', () => {
        const entries = run(fixture('route-original'));
        const s = summary(entries);
        expect(s.failed[0]!.row.row).toBe('H4');
        expect(byRow(entries, 'H4')).toMatchObject({ free: 22, need: 23, verdict: 'SHORT' });
        expect(entries.every(e => evidenceLabel(e.row) === 'INFERRED')).toBe(true);
    });

    test("after H4's rule: H4 with 1 to spare, then S06's load refused, 13 free against 27 (rs/196's census)", () => {
        const entries = run(fixture('route-h4-rule'));
        expect(byRow(entries, 'H4')).toMatchObject({ free: 24, need: 23, verdict: 'pass' });
        expect(byRow(entries, 'H5')).toMatchObject({ free: 13, need: 27, verdict: 'SHORT' });
        expect(summary(entries).failed.map(e => e.row.row)).toEqual(['H5']);
    });

    test("rs/158's fixed route passes to S07's arrival, S06 at 26 a load into exactly 26 free", () => {
        const entries = run(fixture('route-fixed'));
        expect(summary(entries).ok).toBe(true);
        expect(entries.every(e => e.verdict === 'pass')).toBe(true);
        expect(byRow(entries, 'H5')).toMatchObject({ free: 26, need: 26, used: 28 });
        expect(byRow(entries, 'H4k')).toMatchObject({ free: 28, used: 9, worn: 'staff of water x1' });
    });
});

describe('main', () => {
    const dir = mkdtempSync(join(tmpdir(), 'slot-ledger-'));
    const file = (name: string, text: string) => {
        const p = join(dir, name);
        writeFileSync(p, text);
        return p;
    };
    const quiet = () => [spyOn(console, 'log').mockImplementation(() => {}), spyOn(console, 'error').mockImplementation(() => {})];

    test('exit 0 on a pass, 1 on a failing row, 2 on a missing or malformed table', () => {
        const spies = quiet();
        try {
            expect(main([file('pass.md', table('| S00 | a x1 [u] | - | - | 1 | (r) |'))])).toBe(0);
            expect(main([file('fail.md', table(NEARLY_FULL, '| H5 | e x2 [u] | - | - | 2 | (r) |'))])).toBe(1);
            expect(main([file('unknown.md', table('| S00 | a x1 [u] | - | - | ? | (r) |'))])).toBe(0);
            expect(main([file('unknown2.md', table('| S00 | a x1 [u] | - | - | ? | (r) |')), '--strict'])).toBe(1);
            expect(main([file('none.md', '# no table')])).toBe(2);
            expect(main([file('bad.md', table('| S00 | a | - | - | 0 | (r) |'))])).toBe(2);
            expect(main([join(dir, 'missing.md')])).toBe(2);
        } finally {
            spies.forEach(s => s.mockRestore());
        }
    });
});

describe('STEP-MANIFEST.md', () => {
    const text = existsSync(MANIFEST) ? readFileSync(MANIFEST, 'utf8') : '';
    test.skipIf(!/^## Inventory ledger/m.test(text))('its Inventory ledger parses in the agreed grammar', () => {
        const { rows, errors } = parseLedger(text);
        expect(errors).toEqual([]);
        expect(rows[0]!.row).toBe('S00');
        expect(() => walk(rows)).not.toThrow();
    });
    test('its Inventory ledger has no failing row', () => {
        const s = summary(walk(parseLedger(text).rows));
        expect(s.failed.map(e => `${e.row.row}: ${e.notes.join('; ')}`)).toEqual([]);
    });
});
