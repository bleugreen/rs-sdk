/**
 * How long the in-game client goes without a packet from the server before it declares the connection
 * lost itself (Client.ts lostCon: in game off, then a reconnect login).
 *
 * A socket that actually closes (close or error, a reset or a FIN) is noticed within about a second
 * whatever this is: io/ClientStream.ts fails the next write, sent every second, and Client.ts calls
 * lostCon on it. So this governs only a socket that stays open and silent: a network hold. Held, such
 * a socket resumes and the hold costs only its own ticks; the server keeps it for TIMEOUT_NO_RESPONSE
 * (engine World.ts, 1,000 ticks). A page that gives up on it sooner reconnects while the server still
 * holds the old login, and is refused as already logged in until that runs out.
 *
 * The silence the page sees is longer than the outage: once the network comes back, TCP's retransmission
 * backoff (cumulative ~51/102/205/325 s) holds the first packet until the next retry. A 60 s outage on
 * the demo read as 121.6 s of silence, just past the 120 s this was before; backoff can nearly double an
 * outage. 240 s covers outages up to about 100 s (the original 15 s covered none of the minute-long
 * network waves seen on the demo). speedrun/runner/page-hold.ts derives run.ts's own wait for a silent
 * page from this value.
 */
export const NO_DATA_TIMEOUT_MS = 240_000;
