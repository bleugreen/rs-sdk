// What the ambassador remembers about each player it has talked to: when, how often,
// what about, its own last lines to them, and whether it has already told them what it
// is. Kept in the role's per-account state (ctx.state, key PLAYERS_KEY) so it survives
// restarts and redeploys; shown to the model with each batch so it can pick up a
// thread instead of starting over, and consulted by the loop so "I'm a bot run by AI
// agents" is said to a player at most once. Pure: the clock is a parameter.
import { canon } from './policy';
import { isSelfId, type SentLine } from './variety';

export const PLAYERS_KEY = 'players';

export const MEMORY = {
    /** Players kept, most recently talked to first. */
    players: 400,
    topics: 6,
    /** Our own latest lines to each player. */
    said: 3
} as const;

export interface PlayerNote {
    /** Display name as last seen. */
    name: string;
    /** ms of our first and latest line to them. */
    first: number;
    last: number;
    /** Lines we have sent them. */
    lines: number;
    /** ms when we told them we are a bot run by AI agents, if we have. */
    introduced?: number;
    /** What we talked about, latest last (the model's own topic labels). */
    topics: string[];
    /** Our latest lines to them, oldest first. */
    said: string[];
}

/** What the model is shown about one player. */
export interface PlayerRecall {
    talked_before: boolean;
    times_you_spoke_to_them?: number;
    last_spoke?: string;
    you_already_told_them_you_are_a_bot?: boolean;
    topics?: string[];
    your_last_lines_to_them?: string[];
}

const strs = (v: unknown, max: number, len = 120): string[] =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').map(s => s.slice(0, len)).slice(-max) : [];

function ago(ms: number): string {
    const m = Math.round(ms / 60_000);
    if (m < 1) return 'just now';
    if (m < 90) return `${m} min ago`;
    const h = Math.round(m / 60);
    return h < 36 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

export class PlayerMemory {
    private readonly notes = new Map<string, PlayerNote>();

    /** Accept stored state of unknown provenance; malformed entries are dropped. */
    static parse(raw: unknown): PlayerMemory {
        const m = new PlayerMemory();
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return m;
        for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
            if (!v || typeof v !== 'object') continue;
            const n = v as Partial<PlayerNote>;
            if (typeof n.last !== 'number') continue;
            m.notes.set(canon(key), {
                name: typeof n.name === 'string' ? n.name.slice(0, 20) : key,
                first: typeof n.first === 'number' ? n.first : n.last,
                last: n.last,
                lines: typeof n.lines === 'number' ? n.lines : 0,
                ...(typeof n.introduced === 'number' ? { introduced: n.introduced } : {}),
                topics: strs(n.topics, MEMORY.topics, 40),
                said: strs(n.said, MEMORY.said)
            });
        }
        return m;
    }

    get size(): number {
        return this.notes.size;
    }

    get(name: string): PlayerNote | undefined {
        return this.notes.get(canon(name));
    }

    introduced(name: string): boolean {
        return this.get(name)?.introduced !== undefined;
    }

    /** One line we sent to `to` (with the model's topic labels for it). */
    recordSent(at: number, to: string, text: string, topics: readonly string[] = []): void {
        const key = canon(to);
        const n = this.notes.get(key) ?? { name: to, first: at, last: at, lines: 0, topics: [], said: [] };
        n.name = to;
        n.last = at;
        n.lines++;
        if (n.introduced === undefined && isSelfId(text)) n.introduced = at;
        for (const t of topics) {
            const topic = t.trim().toLowerCase().slice(0, 40);
            if (!topic) continue;
            n.topics = [...n.topics.filter(x => x !== topic), topic].slice(-MEMORY.topics);
        }
        n.said = [...n.said, text].slice(-MEMORY.said);
        // Re-insert so the map stays ordered by recency, then forget the longest-silent.
        this.notes.delete(key);
        this.notes.set(key, n);
        while (this.notes.size > MEMORY.players) this.notes.delete(this.notes.keys().next().value!);
    }

    /** Rebuild from the chat log when there is no stored memory yet (the first start after a deploy). */
    seed(lines: readonly SentLine[]): void {
        for (const l of [...lines].sort((a, b) => a.at - b.at)) if (l.to) this.recordSent(l.at, l.to, l.text);
    }

    /** What the model is shown about these players. */
    recall(names: readonly string[], now: number): Record<string, PlayerRecall> {
        const out: Record<string, PlayerRecall> = {};
        for (const name of new Set(names)) {
            const n = this.get(name);
            out[name] = n
                ? {
                      talked_before: true,
                      times_you_spoke_to_them: n.lines,
                      last_spoke: ago(now - n.last),
                      you_already_told_them_you_are_a_bot: n.introduced !== undefined,
                      ...(n.topics.length ? { topics: n.topics } : {}),
                      your_last_lines_to_them: n.said
                  }
                : { talked_before: false };
        }
        return out;
    }

    toJSON(): Record<string, PlayerNote> {
        return Object.fromEntries(this.notes);
    }
}
