/**
 * How long the in-game client goes without a packet from the server before it declares the connection
 * lost itself (Client.ts lostCon: in game off, then a reconnect login).
 *
 * A socket that actually closes (close or error, a reset or a FIN) is noticed within about a second
 * whatever this is: io/ClientStream.ts fails the next write, sent every second, and Client.ts calls
 * lostCon on it. So this governs only a socket that stays open and silent: a network hold. Held, such
 * a socket can resume and the hold costs only its own ticks.
 *
 * speedrun/runner/page-hold.ts derives run.ts's wait for a silent page from this value, and past it
 * run.ts's drop recovery closes the old tab and logs in on a fresh one (runner/drop-relog.ts, close
 * first): on the demo, a socket left silent by a 60 s block mostly never resumed (the server's stream
 * to us stuck in TCP backoff, the page claiming in game throughout), and closing the tab removed the
 * account's body within ~10 s. So on that common dead path this window is the whole cost, and it is
 * kept as short as is safe: it must outlast the network hold itself, because a close sent while the
 * path is still blocked is dropped (an RST is not retransmitted) and the body lingers. The holds seen
 * were >= 60 s, so below 120 s is unsafe. A held socket whose first packet comes back later than this
 * (TCP backoff read a 60 s outage as 121.6 s of silence) is relogged instead of adopted: one relog.
 */
export const NO_DATA_TIMEOUT_MS = 120_000;
