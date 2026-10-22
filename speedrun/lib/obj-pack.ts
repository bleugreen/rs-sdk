// Object ids from server/content/pack/obj.pack, and the note (cert) link between them.
//
// A banknote is an object of its own. The pack tool links `cert_<debugname>` to
// `<debugname>` by name (server/engine/tools/pack/config/ObjConfig.ts), and the note
// publishes its item's name, so a name never tells a note from its item. In this
// revision a name does not tell some items apart either: every unfinished potion is
// "Unfinished potion" and every grimy herb "Herb". An id does. The bank stores the
// item, never the note; a noted withdrawal arrives in the inventory as the note.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ObjPack {
    names: ReadonlyMap<number, string>;
    ids: ReadonlyMap<string, number>;
}

/** obj.pack's `id=debugname` lines. */
export function parseObjPack(text: string): ObjPack {
    const names = new Map<number, string>();
    const ids = new Map<string, number>();
    for (const line of text.split('\n')) {
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const id = Number(line.slice(0, eq));
        const name = line.slice(eq + 1).trim();
        if (!Number.isInteger(id) || !name) continue;
        names.set(id, name);
        ids.set(name, id);
    }
    return { names, ids };
}

export const OBJ_PACK_PATH = join(import.meta.dir, '..', '..', 'server', 'content', 'pack', 'obj.pack');

let loaded: ObjPack | null = null;

/** The checkout's obj.pack, read once. */
export function objPack(): ObjPack {
    if (!loaded) {
        if (!existsSync(OBJ_PACK_PATH)) throw new Error(`obj ids need ${OBJ_PACK_PATH}, which this checkout does not have`);
        loaded = parseObjPack(readFileSync(OBJ_PACK_PATH, 'utf8'));
    }
    return loaded;
}

export interface NoteLink {
    /** The item's own id: what the bank holds. */
    item: number;
    /** Its note's id, or null when the item cannot be noted (a noted withdrawal then arrives unnoted). */
    note: number | null;
}

/** The item and note ids of `id`, which may name either one. Throws on an id the pack does not have. */
export function noteLink(id: number, pack: ObjPack = objPack()): NoteLink {
    const name = pack.names.get(id);
    if (name === undefined) throw new Error(`obj ${id} is not in obj.pack`);
    if (name.startsWith('cert_')) {
        const item = pack.ids.get(name.slice('cert_'.length));
        if (item === undefined) throw new Error(`obj ${id} (${name}) links to no item`);
        return { item, note: id };
    }
    return { item: id, note: pack.ids.get(`cert_${name}`) ?? null };
}
