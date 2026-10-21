// Static census for engine-sweep (rs/67): which OPHELD*/OPHELDU/OPHELDT/IF_BUTTON/
// INV_BUTTON* triggers can produce an item or grant xp with nothing on the path that
// costs a tick (p_delay, p_arrivedelay, a queue, a dialog pause, a count dialog).
//
//   bun speedrun/lab/census-delayfree.ts [--all] [--json]
//
// Reads server/content/scripts/**/*.rs2 only. It follows @label, jump(label) and
// ~proc calls (transitively, without branching analysis), so a trigger is reported as
// "delay-free" only when NO reachable block contains a tick-costing command (a message box
// alone does not count: it is tagged FREE+box, see BOX below). That is
// conservative in one direction: a trigger whose delay sits on a rarely taken branch is
// reported as gated. Gated rows are printed with --all.
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = join(import.meta.dir, '../../server/content/scripts');
const TRIGGERS = /^(opheld[1-5]|opheldu|opheldt|if_button|inv_button[1-5])$/;
const EFFECT = /\b(inv_add|inv_changeslot|inv_setslot|inv_moveitem|inv_moveitem_cert|inv_moveitem_uncert|inv_moveitem_tobank|inv_movefromslot|inv_movetoslot|both_moveinv|stat_advance)\b/;
const DELAY = /\b(p_delay|p_arrivedelay)\b/;
const QUEUE = /\b(queue|weakqueue|strongqueue|longqueue)\*?\s*\(/;
// A make-X menu or a conversation sits on the success path; a message box is almost always
// a refusal branch ("You need a Cooking level of ..."), so it is reported separately.
const MENU = /\bp_countdialog\b|~(chatnpc|chatplayer|chatnpcnoturn|p_choice[0-9]|skill_multi[0-9]|multi[0-9])\b/;
const BOX = /\bp_pausebutton\b|~(mesbox|objbox|doubleobjbox|objboxnoclose)\b/;

type Block = { kind: string; name: string; file: string; line: number; body: string };

function walk(dir: string, out: string[] = []): string[] {
    for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (p.endsWith('.rs2')) out.push(p);
    }
    return out;
}

const blocks: Block[] = [];
const byName = new Map<string, Block>(); // 'label:x' / 'proc:x'
for (const file of walk(ROOT)) {
    if (file.includes('/_test/')) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    let cur: Block | null = null;
    lines.forEach((l, i) => {
        const m = l.match(/^\[([a-z_0-9]+),([^\]]+)\]/);
        const kind = m?.[1];
        const name = m?.[2];
        if (m && kind !== undefined && name !== undefined) {
            const block: Block = { kind, name, file: relative(ROOT, file), line: i + 1, body: '' };
            blocks.push(block);
            if (kind === 'label' || kind === 'proc') byName.set(`${kind}:${name}`, block);
            block.body += l.slice(m[0].length) + '\n';
            cur = block;
        } else if (cur) {
            cur.body += l.replace(/\/\/.*$/, '') + '\n';
        }
    });
}

function reach(b: Block): Block[] {
    const seen = new Set<Block>([b]);
    const stack = [b];
    while (stack.length) {
        const x = stack.pop()!;
        const refs = [...x.body.matchAll(/@([a-z_0-9]+)|jump\(([a-z_0-9]+)\)|~([a-z_0-9]+)/g)];
        for (const r of refs) {
            const key = r[3] ? `proc:${r[3]}` : `label:${r[1] ?? r[2]}`;
            const y = byName.get(key);
            if (y && !seen.has(y)) {
                seen.add(y);
                stack.push(y);
            }
        }
    }
    return [...seen];
}

type Row = { trigger: string; file: string; line: number; effect: string[]; gate: string[] };
const rows: Row[] = [];
for (const b of blocks) {
    if (!TRIGGERS.test(b.kind)) continue;
    const all = reach(b);
    const effect = new Set<string>();
    const gate = new Set<string>();
    for (const x of all) {
        for (const m of x.body.matchAll(new RegExp(EFFECT, 'g'))) if (m[1] !== undefined) effect.add(m[1]);
        if (DELAY.test(x.body)) gate.add('delay');
        if (QUEUE.test(x.body)) gate.add('queue');
        if (MENU.test(x.body)) gate.add('menu');
        if (BOX.test(x.body)) gate.add('box');
    }
    if (effect.size === 0) continue;
    rows.push({ trigger: `[${b.kind},${b.name}]`, file: b.file, line: b.line, effect: [...effect].sort(), gate: [...gate].sort() });
}

const all = process.argv.includes('--all');
if (process.argv.includes('--json')) {
    console.log(JSON.stringify(rows, null, 1));
} else {
    const isFree = (r: Row) => r.gate.every(g => g === 'box');
    const free = rows.filter(isFree);
    console.log(`# ${rows.length} triggers with an item/xp effect; ${free.length} with no delay, queue or menu on any reachable path ('FREE+box': a message box is reachable, usually a refusal branch)`);
    for (const r of all ? rows : free) {
        const tag = isFree(r) ? (r.gate.length ? 'FREE+box' : 'FREE') : r.gate.join('+');
        console.log(`${tag}\t${r.trigger}\t${r.file}:${r.line}\t${r.effect.join(',')}`);
    }
}
