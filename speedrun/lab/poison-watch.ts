// A carried-poison lab's observer: every damage_taken on the player (tick, damage, hitmark, sourceIndex, HP), every
// antipoison dose drunk, each trade open and close, each client session (a reload restarts the published tick), the
// lowest HP, and the first tick each named mark holds. One line per event through `emit`; summary() for the report.

import type { BotWorldState } from '../../sdk/types';

type Watchable = { onStateUpdate(cb: (s: BotWorldState) => void): () => void };
export type Emit = (event: string, fields: Record<string, unknown>) => void;

const ANTI = /antipoison\((\d)\)$/i;
const antiDoses = (s: BotWorldState) => s.inventory.reduce((n, i) => n + (ANTI.test(i.name) ? Number(ANTI.exec(i.name)![1]) * i.count : 0), 0);
const antiNames = (s: BotWorldState) => s.inventory.filter(i => ANTI.test(i.name)).map(i => i.name);

export interface PoisonWatch {
    stop(): void;
    summary(): Record<string, unknown>;
}

export function watchPoison(sdk: Watchable, emit: Emit, marks: Record<string, (s: BotWorldState) => boolean> = {}): PoisonWatch {
    let session = 0;
    let lastTick = -Infinity;
    let sessionFirst: number | null = null;
    const seen = new Set<string>();
    const hits: Array<Record<string, unknown>> = [];
    const drinks: Array<Record<string, unknown>> = [];
    const trades: Array<Record<string, unknown>> = [];
    const marked: Record<string, { session: number; tick: number }> = {};
    let doses: number | null = null;
    let names: string[] = [];
    let tradeOpen = false;
    let minHp: { hp: number; tick: number; session: number } | null = null;
    const stop = sdk.onStateUpdate(s => {
        if (!s.inGame || !s.player) return;
        if (s.tick < lastTick) {
            session++;
            sessionFirst = null;
            for (const k of Object.keys(marked)) delete marked[k];
        }
        lastTick = s.tick;
        if (sessionFirst === null) {
            sessionFirst = s.tick;
            emit('pw-session', { session, firstTick: s.tick, hp: s.player.hp });
        }
        for (const e of s.combatEvents ?? []) {
            if (e.type !== 'damage_taken' || e.targetType !== 'player') continue;
            const key = `${session}:${e.tick}:${e.damage}:${e.hitmark}:${e.sourceType}:${e.sourceIndex}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const h = { session, tick: e.tick, sinceLogin: e.tick - sessionFirst, damage: e.damage, hitmark: e.hitmark ?? null, sourceType: e.sourceType, sourceIndex: e.sourceIndex, hp: s.player.hp };
            hits.push(h);
            emit('pw-hit', h);
        }
        const d = antiDoses(s);
        if (doses !== null && d < doses) {
            const r = { session, tick: s.tick, sinceLogin: s.tick - sessionFirst, from: names, to: antiNames(s) };
            drinks.push(r);
            emit('pw-drink', r);
        }
        doses = d;
        names = antiNames(s);
        const open = !!s.trade?.isOpen;
        if (open !== tradeOpen) {
            const r = { session, tick: s.tick, sinceLogin: s.tick - sessionFirst, open, screen: s.trade?.screen ?? null };
            trades.push(r);
            emit('pw-trade', r);
            tradeOpen = open;
        }
        if (!minHp || s.player.hp < minHp.hp) minHp = { hp: s.player.hp, tick: s.tick, session };
        for (const [name, holds] of Object.entries(marks)) {
            if (marked[name] || !holds(s)) continue;
            marked[name] = { session, tick: s.tick };
            emit('pw-mark', { name, session, tick: s.tick, sinceLogin: s.tick - sessionFirst, hp: s.player.hp });
        }
    });
    return {
        stop,
        summary: () => ({ sessions: session + 1, hits, drinks, trades, minHp, marks: { ...marked } }),
    };
}
