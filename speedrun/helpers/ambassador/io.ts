// The only surface the ambassador's conversation loop has on the game. It can read
// player chat, send one line of public chat or one private message, see where it is
// and who is near, and walk back to its own configured post. Nothing else: no trade,
// drop, follow, item or arbitrary movement call exists here, so no chat and no model
// output can produce one. io.test.ts pins the exact key set, so widening this surface
// fails CI on purpose.
import type { BotActions } from '../../../sdk/actions';
import type { BotSDK } from '../../../sdk/index';
import type { GameMessage } from '../../../sdk/types';
import { LIMITS, type ChatLine } from './policy';

/** Public chat (1 = crowned sender, 2) and private messages received (3, 7 = crowned). */
export const READ_TYPES = [1, 2, 3, 7] as const;

export interface SendOutcome {
    ok: boolean;
    /** The text as the client sent it (after its word filter). */
    finalText: string;
    filtered: boolean;
    truncated: boolean;
    message: string;
}

export interface Whereabouts {
    name: string;
    x: number;
    z: number;
    level: number;
    tick: number;
}

export interface Post {
    x: number;
    z: number;
    tolerance: number;
}

export interface AmbassadorIO {
    /** Player chat that arrived since the last call, own lines excluded, oldest first. */
    readNewChat(): ChatLine[];
    /** One public chat line, one packet. */
    say(text: string): Promise<SendOutcome>;
    /** One private message, one packet. */
    pm(to: string, text: string): Promise<SendOutcome>;
    self(): Whereabouts | null;
    /** Display names of players the client can see. */
    nearbyPlayers(): string[];
    /** Walk back to the post fixed at construction. Takes no destination by design. */
    returnToPost(): Promise<boolean>;
}

export const IO_KEYS = ['nearbyPlayers', 'pm', 'readNewChat', 'returnToPost', 'say', 'self'] as const;

export type ChatSdk = Pick<BotSDK, 'getNewChat' | 'sendSay' | 'sendPrivateMessage' | 'getState'>;
export type WalkBot = Pick<BotActions, 'walkTo'>;

function refused(message: string): SendOutcome {
    return { ok: false, finalText: '', filtered: false, truncated: false, message };
}

/** Second line of defence behind policy.checkOutput: shape rules a send can never break. */
function unsendable(text: string): string | null {
    if (!text || text.length > LIMITS.maxLen) return 'length';
    if (!/^[\x20-\x7e]+$/.test(text)) return 'not-printable-ascii';
    if (text.includes('::')) return 'command';
    return null;
}

export function toChatLine(m: GameMessage, at: number): ChatLine {
    return {
        sender: m.sender,
        channel: m.type === 3 || m.type === 7 ? 'pm' : 'public',
        text: m.text,
        type: m.type,
        tick: m.tick,
        at
    };
}

export function createIO(sdk: ChatSdk, bot: WalkBot, post: Post, now: () => number = Date.now): AmbassadorIO {
    const send = async (dispatch: () => ReturnType<BotSDK['sendSay']>): Promise<SendOutcome> => {
        const r = await dispatch();
        const data = (r.data ?? {}) as { sent?: boolean; filtered?: boolean; truncated?: boolean; finalText?: string };
        return {
            ok: r.success && data.sent !== false,
            finalText: typeof data.finalText === 'string' ? data.finalText : '',
            filtered: data.filtered === true,
            truncated: data.truncated === true,
            message: r.message
        };
    };
    const io: AmbassadorIO = {
        readNewChat() {
            const at = now();
            return sdk.getNewChat({ types: READ_TYPES }).filter(m => !m.fromSelf && m.sender).map(m => toChatLine(m, at));
        },
        async say(text) {
            const why = unsendable(text);
            if (why) return refused(`refused by io: ${why}`);
            return send(() => sdk.sendSay(text));
        },
        async pm(to, text) {
            const why = unsendable(text) ?? (/^[A-Za-z0-9 _-]{1,12}$/.test(to) ? null : 'recipient');
            if (why) return refused(`refused by io: ${why}`);
            return send(() => sdk.sendPrivateMessage(to, text));
        },
        self() {
            const s = sdk.getState();
            const p = s?.player;
            if (!s || !p) return null;
            return { name: p.name, x: p.worldX, z: p.worldZ, level: p.level, tick: s.tick };
        },
        nearbyPlayers() {
            return (sdk.getState()?.nearbyPlayers ?? []).map(p => p.name).filter(Boolean);
        },
        async returnToPost() {
            const r = await bot.walkTo(post.x, post.z, post.tolerance, { timeout: 240_000 });
            return r.success;
        }
    };
    return Object.freeze(io);
}
