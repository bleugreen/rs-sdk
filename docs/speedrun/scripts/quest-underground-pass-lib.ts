// Shared helpers for the Underground Pass measurement scripts: a message log
// that survives the client's capped buffer, an idle wait, verified teleports,
// a route executor that walks quest-underground-pass-route.ts plans for real
// (clicking each crossing's loc and re-planning after a failed roll), timed
// actions, dialogues and a fight loop. Every figure is in server ticks as
// observed by the lite client.

import type { BotSDK } from '../../../sdk/index';
import type { BotActions } from '../../../sdk/actions';
import * as L from './quest-arthur-lab';
import { plan, type T, type Edge } from './quest-underground-pass-route';

export interface Row { label: string; ticks: number; [k: string]: unknown }

export class Lab {
    rows: Row[] = [];
    /** clicks re-sent (one per quiet tick) because the first was dropped during a forced move */
    resends = 0;
    log: string[] = [];
    private seen = new Set<string>();
    constructor(public sdk: BotSDK, public bot: BotActions) {
        const key = (m: { tick: number; text: string; observationId?: number }) => `${m.tick}|${m.observationId ?? ''}|${m.text}`;
        for (const m of sdk.getState()?.gameMessages ?? []) this.seen.add(key(m));
        sdk.onStateUpdate(st => {
            for (const m of st.gameMessages ?? []) {
                const k = key(m);
                if (!this.seen.has(k)) { this.seen.add(k); this.log.push(m.text); }
            }
        });
    }
    tick() { return L.tick(this.sdk); }
    pos(): T { const p = L.pos(this.sdk); return [p.x, p.z, p.level]; }
    hp() { return this.sdk.getState()?.player?.hp ?? 0; }
    since(n: number) { return this.log.slice(n); }
    record(row: Row) { this.rows.push(row); console.log(`  ${row.label}: ${row.ticks}t ${JSON.stringify({ ...row, label: undefined, ticks: undefined })}`); }

    /** Wait until no movement, no new message and no dialogue for `still` ticks; dismisses level-ups. */
    async idle(still = 3, max = 80): Promise<number> {
        let n = 0;
        let last = this.pos();
        let lastLog = this.log.length;
        let levelUps = 0;
        for (let i = 0; i < max; i++) {
            await this.sdk.waitForTicks(1);
            const p = this.pos();
            if (this.sdk.getState()!.dialog.isOpen) {
                if (L.isLevelUpDialog(this.sdk)) { levelUps++; await L.dismissLevelUps(this.sdk); }
                n = 0;
                continue;
            }
            n = p[0] === last[0] && p[1] === last[1] && p[2] === last[2] && this.log.length === lastLog ? n + 1 : 0;
            last = p;
            lastLog = this.log.length;
            if (n >= still) break;
        }
        return levelUps;
    }

    async teleTo(x: number, z: number, l = 0) {
        for (let k = 0; k < 3; k++) {
            await L.tele(this.sdk, x, z, l);
            if (await L.waitUntil(this.sdk, () => { const p = this.pos(); return p[0] === x && p[1] === z && p[2] === l; }, 8) !== null) return;
            await this.idle();
        }
        throw new Error(`could not teleport to ${x},${z},${l}`);
    }
    async cheat(cmd: string, settle = 2) { await L.cheat(this.sdk, cmd, settle); }
    async give(name: string, n = 1, re?: RegExp) {
        await this.cheat(`give ${name} ${n}`, 2);
        if (re) await L.waitUntil(this.sdk, () => this.sdk.countInventoryItems(re) > 0, 10);
    }
    async getVar(name: string) { return L.getVar(this.sdk, name); }

    /** Run `start`, wait for `done` (or just idle), record click-to-idle ticks (minus the idle settle). */
    async act(label: string, start: () => Promise<unknown>, done?: () => boolean, extra: Record<string, unknown> = {}, max = 120) {
        await this.idle();
        const hp0 = this.hp();
        const m0 = this.log.length;
        const t0 = this.tick();
        await start();
        let doneAt: number | null = null;
        if (done) doneAt = await L.waitUntil(this.sdk, done, max);
        const levelUps = await this.idle();
        const row = { label, ticks: this.tick() - t0 - 3, doneAfter: doneAt === null ? null : doneAt - t0, hpLost: hp0 - this.hp(), levelUps, msgs: this.since(m0).slice(0, 6), ...extra };
        this.record(row);
        return row;
    }

    async clickLoc(id: number, x: number, z: number, op = 1) { await this.sdk.sendInteractLoc(x, z, id, op); }
    async useOnLoc(item: RegExp, id: number, x: number, z: number) {
        const it = this.sdk.findInventoryItem(item);
        if (!it) throw new Error(`no ${item}`);
        await this.sdk.sendUseItemOnLoc(it.slot, x, z, id);
    }
    async useItem(a: RegExp, b: RegExp) {
        const x = this.sdk.findInventoryItem(a);
        const y = this.sdk.findInventoryItem(b);
        if (!x || !y) throw new Error(`missing ${a} or ${b}`);
        await this.sdk.sendUseItemOnItem(x.slot, y.slot);
    }
    npc(re: RegExp) { return this.sdk.getNearbyNpcs().filter(n => re.test(n.name)).sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0))[0] ?? null; }

    /** Talk-to (or op1 on) an NPC and answer with talkThrough; ticks from the click to the dialogue closed. */
    async talk(label: string, re: RegExp, choices: RegExp[] = [/./], op = 1) {
        await this.idle();
        await L.waitUntil(this.sdk, () => this.npc(re) !== null, 20);
        const n = this.npc(re);
        if (!n) throw new Error(`no npc ${re}`);
        const t0 = this.tick();
        await this.sdk.sendInteractNpc(n.index, op);
        const d = await L.talkThrough(this.sdk, choices);
        const row = { label, ticks: this.tick() - t0 - 3, pages: d.pages, options: d.options, dialogueTicks: d.ticks };
        this.record(row);
        return row;
    }
    /** Answer a dialogue that an action opens. */
    async dialogue(label: string, start: () => Promise<unknown>, choices: RegExp[] = [/./]) {
        await this.idle();
        const t0 = this.tick();
        await start();
        const d = await L.talkThrough(this.sdk, choices);
        await this.idle();
        const row = { label, ticks: this.tick() - t0 - 3, pages: d.pages, options: d.options, dialogueTicks: d.ticks };
        this.record(row);
        return row;
    }

    /**
     * Walk the cheapest planned route to `dst` for real. Walking runs are sent
     * as run clicks of up to `reach` tiles, the next one sent when the player
     * is within 2 tiles of the last; each crossing is clicked on its loc. A
     * failed crossing (an agility roll) re-plans from wherever the player
     * lands. Returns ticks from the first click to idle at the destination.
     */
    async travel(label: string, dst: T, opts: { allow?: (kind: string) => boolean; reach?: number; before?: (e: Edge) => Promise<void> } = {}) {
        // winding cave routes can exceed the client's 25-turn click route, so keep clicks short
        const reach = opts.reach ?? 10;
        await this.idle();
        const t0 = this.tick();
        const hp0 = this.hp();
        let tiles = 0;
        let last = this.pos();
        const off = this.sdk.onStateUpdate(st => {
            const p = st.player;
            if (!p) return;
            const d = Math.max(Math.abs(p.worldX - last[0]), Math.abs(p.worldZ - last[1]));
            if (d <= 3 && p.level === last[2]) tiles += d;
            last = [p.worldX, p.worldZ, p.level];
        });
        const crossings: string[] = [];
        const fails: string[] = [];
        let replans = 0;
        const resends0 = this.resends;
        const detail: string[] = [];
        try {
            for (let attempt = 0; attempt < 12; attempt++) {
                const p = plan(this.pos(), dst, opts.allow);
                if (!p) throw new Error(`${label}: no route from ${this.pos()} to ${dst}`);
                let failed = false;
                let i = 0;
                while (i < p.steps.length && !failed) {
                    // gather the walking run up to the next crossing
                    const run: T[] = [];
                    while (i < p.steps.length && !p.steps[i].edge) run.push(p.steps[i++].t);
                    const edge = i < p.steps.length ? p.steps[i].edge : undefined;
                    const directClick = edge && ['rockslide', 'stonebridge', 'stairs', 'unicorn_door', 'temple_door2', 'well_down', 'mudpile_up', 'pipe6', 'pipe4', 'exit_cave', 'enter_cave', 'rockpile'].includes(edge.kind);
                    // walk the run (all of it, unless the crossing's loc can be clicked from afar)
                    let k = 0;
                    // a loc clicked from afar is approached by the server; keep that to the last 8 tiles
                    const stopAt = directClick && run.length > 0 ? Math.max(0, run.length - 8) : run.length;
                    const tw = this.tick();
                    const tiles0 = tiles;
                    while (k < stopAt) {
                        const cur = this.pos();
                        let j = k;
                        while (j + 1 < stopAt && Math.max(Math.abs(run[j + 1][0] - cur[0]), Math.abs(run[j + 1][1] - cur[1])) <= reach) j++;
                        const target = run[j];
                        await this.sdk.sendWalk(target[0], target[1], true);
                        const final = j === stopAt - 1;
                        let still = 0;
                        let lq = this.pos();
                        let walkResends = 0;
                        await L.waitUntil(this.sdk, () => {
                            const q = this.pos();
                            const d = Math.max(Math.abs(q[0] - target[0]), Math.abs(q[1] - target[1]));
                            if (final ? d === 0 : d <= 2) return true;
                            still = q[0] === lq[0] && q[1] === lq[1] ? still + 1 : 0;
                            lq = q;
                            if (still >= 2) {
                                // a click during a forced move is dropped: send it again; after 6 tries
                                // accept stopping short (an NPC standing on the tile)
                                if (walkResends >= 6) return true;
                                walkResends++;
                                this.resends++;
                                still = 0;
                                void this.sdk.sendWalk(target[0], target[1], true);
                            }
                            return false;
                        }, 60);
                        k = j + 1;
                    }
                    if (stopAt > 0) detail.push(`walk ${tiles - tiles0} tiles ${this.tick() - tw}t`);
                    if (!edge) break;
                    const te = this.tick();
                    if (opts.before) await opts.before(edge);
                    const c = edge.click!;
                    const m0 = this.log.length;
                    const send = async () => {
                        if (c.item) await this.useOnLoc(c.item, c.id, c.x, c.z);
                        else await this.clickLoc(c.id, c.x, c.z, c.op ?? 1);
                    };
                    await send();
                    const to = edge.to;
                    const from = this.pos();
                    // the failure message of each rolled crossing, plus generic refusals
                    const failRe = /slip back down|slip and tumble|fall off it|fall in to the darkness|rat pit|fail to pick|just misses|can't reach|cannot|refuses|is locked|You need|being used/i;
                    // A click sent while a forced move is still running is dropped: re-send if
                    // nothing has moved or been said for 3 ticks.
                    let quiet = 0;
                    let lastQ = from;
                    let resent = 0;
                    const arrived = await L.waitUntil(this.sdk, () => {
                        const q = this.pos();
                        if (this.since(m0).some(t => failRe.test(t))) return true;
                        if (to[2] !== edge.from[2] ? q[2] === to[2] : Math.max(Math.abs(q[0] - to[0]), Math.abs(q[1] - to[1])) <= 1 && q[2] === to[2]) return true;
                        quiet = q[0] === lastQ[0] && q[1] === lastQ[1] && this.log.length === m0 ? quiet + 1 : 0;
                        lastQ = q;
                        if (quiet >= 1 && resent < 20) { quiet = 0; resent++; void send(); }
                        return false;
                    }, 90);
                    this.resends += resent;
                    const failMsg = this.since(m0).find(t => failRe.test(t));
                    if (arrived === null || failMsg) {
                        await this.idle();
                        const q = this.pos();
                        const moved = Math.max(Math.abs(q[0] - from[0]), Math.abs(q[1] - from[1])) > 3 || q[2] !== from[2];
                        fails.push(`${edge.kind}${edge.note.startsWith('(') ? ' ' + edge.note : ''}: ${failMsg ?? `no arrival at ${to}, now ${q}`}`);
                        failed = true;
                        if (!failMsg && !moved) throw new Error(`${label}: stuck at ${edge.kind} ${edge.note} from ${from} want ${to} now ${q} msgs ${JSON.stringify(this.since(m0))}`);
                        break;
                    }
                    if (!this.at(to)) {
                        // landed next to the planned tile: re-plan from here
                        await this.sdk.waitForTicks(1);
                        if (Math.max(Math.abs(this.pos()[0] - to[0]), Math.abs(this.pos()[1] - to[1])) > 0) { crossings.push(edge.kind); failed = true; break; }
                    }
                    crossings.push(edge.kind + (edge.note.startsWith('(') ? ' ' + edge.note : ''));
                    detail.push(`${edge.kind} ${this.tick() - te}t${resent ? ` (${resent} re-clicks)` : ''}`);
                    i++;
                }
                if (!failed) break;
                replans++;
            }
            await this.idle();
        } finally {
            off();
        }
        const row = { label, ticks: this.tick() - t0 - 3, tiles, crossings: crossings.length, crossingList: crossings, fails, replans, resends: this.resends - resends0, detail, hpLost: hp0 - this.hp(), at: this.pos() };
        this.record(row);
        return row;
    }
    at(t: T) { const p = this.pos(); return p[0] === t[0] && p[1] === t[1] && p[2] === t[2]; }

    /** Fight an NPC to death (or until a non-level-up dialogue opens); eats below 40% hp. */
    async fight(label: string, re: RegExp, opts: { food?: RegExp; max?: number } = {}) {
        await this.idle(1);
        await L.waitUntil(this.sdk, () => this.npc(re) !== null, 30);
        const target = this.npc(re);
        if (!target) throw new Error(`no npc ${re}`);
        const t0 = this.tick();
        const hp0 = this.hp();
        let minHp = hp0;
        let eaten = 0;
        let levelUps = 0;
        let reattacks = 0;
        await this.bot.attack(target);
        let lastSeen = this.tick();
        let gone = false;
        while (this.tick() - t0 < (opts.max ?? 600)) {
            const s = this.sdk.getState()!;
            if (s.dialog.isOpen) {
                if (!L.isLevelUpDialog(this.sdk)) break;
                levelUps++;
                await L.dismissLevelUps(this.sdk);
                const again = this.sdk.getNearbyNpcs().find(n => n.index === target.index);
                if (again) { await this.bot.attack(again); reattacks++; }
                continue;
            }
            const me = s.player!;
            minHp = Math.min(minHp, me.hp);
            const t = s.nearbyNpcs.find(n => n.index === target.index);
            if (t) lastSeen = s.tick;
            if ((!t || (t.hp !== null && t.hp === 0)) && s.tick - lastSeen >= 0) {
                if (!t) { gone = true; break; }
            }
            if (me.hp < me.maxHp * 0.4 && opts.food && this.sdk.findInventoryItem(opts.food)) {
                await this.bot.eatFood(opts.food);
                eaten++;
                const again = this.sdk.getNearbyNpcs().find(n => n.index === target.index);
                if (again) { await this.bot.attack(again); reattacks++; }
            } else if (t && me.combat && (me.combat as { inCombat?: boolean }).inCombat === false && s.tick % 4 === 0 && me.animId === -1) {
                await this.bot.attack(t);
                reattacks++;
            }
            await this.sdk.waitForStateUpdate();
        }
        const row = { label, ticks: this.tick() - t0, killed: gone, hp0, minHp, eaten, levelUps, reattacks };
        this.record(row);
        return row;
    }

    async equip(re: RegExp) { if (!this.sdk.getEquipment().some(e => re.test(e.name))) await this.bot.equipItem(re); }
    report(title: string) {
        console.log(`RESULT ${title} ${JSON.stringify(this.rows.map(r => ({ ...r, msgs: undefined })))}`);
    }
}

/** %ibanmulti with the given bits set and the grid answer (three digits 1-5) in bits 22-31. */
export function ibanmulti(bits: number[], grid = 343): number {
    let v = 0;
    for (const b of bits) v |= 1 << b;
    return (v | (grid << 22)) >>> 0;
}

export const BIT = {
    blood: 1, dove: 2, ashes: 3, shadow: 4, orb1: 5, orb2: 6, orb3: 7, orb4: 8, cat: 9, randas: 10, started: 11, crate: 12, jerro: 13,
    badge1: 14, badge2: 15, badge3: 16, koftikInsane: 17, horn: 18, history: 19, inscription: 20, brew: 21,
};
