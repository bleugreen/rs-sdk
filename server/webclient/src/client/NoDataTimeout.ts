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
 * 120 s outlasts the minute-long network waves seen on the demo, where the original 15 s did not.
 * speedrun/runner/page-hold.ts derives run.ts's own wait for a silent page from this value.
 */
export const NO_DATA_TIMEOUT_MS = 120_000;
