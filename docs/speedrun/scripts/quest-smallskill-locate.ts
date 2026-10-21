// Finds where NPCs, ground objs and locs are placed in the map data, by config name.
//   bun docs/speedrun/scripts/quest-smallskill-locate.ts npc:brother_omad obj:childs_blanket loc:horncrate
// Reads server/content/pack/{npc,obj,loc}.pack (id=name) and the NPC / OBJ / LOC sections
// of server/content/maps/m<mx>_<mz>.jm2, whose lines are `level lx lz: id [...]`.
// Absolute tile = map square * 64 + local (LAB.md). Prints `kind name level x z`.
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const root = join(import.meta.dir, '../../../server/content');
const packIds = (kind: string) => {
    const m = new Map<string, number>();
    for (const line of readFileSync(join(root, 'pack', kind + '.pack'), 'utf8').split('\n')) {
        const i = line.indexOf('=');
        if (i > 0) m.set(line.slice(i + 1).trim(), Number(line.slice(0, i)));
    }
    return m;
};
const section = { npc: 'NPC', obj: 'OBJ', loc: 'LOC' } as const;
const wanted = process.argv.slice(2).map(a => {
    const [kind, name] = a.split(':') as [keyof typeof section, string];
    const id = packIds(kind).get(name);
    if (id === undefined) throw new Error(`no ${kind} named ${name}`);
    return { kind, name, id };
});
for (const f of readdirSync(join(root, 'maps')).filter(f => /^m\d+_\d+\.jm2$/.test(f))) {
    const [, mx, mz] = /^m(\d+)_(\d+)/.exec(f)!.map(Number);
    let cur = '';
    for (const line of readFileSync(join(root, 'maps', f), 'utf8').split('\n')) {
        const h = /^==== (\w+) ====/.exec(line);
        if (h) { cur = h[1]!; continue; }
        const m = /^(\d+) (\d+) (\d+): (\d+)(.*)$/.exec(line);
        if (!m) continue;
        for (const w of wanted) {
            if (section[w.kind] === cur && Number(m[4]) === w.id) {
                console.log(`${w.kind} ${w.name} ${m[1]} ${mx! * 64 + Number(m[2])} ${mz! * 64 + Number(m[3])}${m[5]}`);
            }
        }
    }
}
