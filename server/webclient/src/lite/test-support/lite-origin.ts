// The game server that network-backed lite suites download the real cache from,
// and whether it answers.
//
// A suite that needs the cache is declared with
// `describe.skipIf(!liteOriginReachable)`, so an unreachable server shows up in
// bun's summary as skipped tests, not as passes that never ran. The probe is a
// module-level await, which settles before the importing file declares its
// suites. LITE_TEST_ORIGIN points the suites elsewhere (http://127.0.0.1:9
// forces the offline path); LITE_TEST_CACHE moves the on-disk archive cache.

export const LITE_ORIGIN = process.env.LITE_TEST_ORIGIN ?? 'https://rs-sdk-demo.fly.dev';
export const LITE_CACHE_DIR = process.env.LITE_TEST_CACHE ?? '/tmp/rs-sdk-lite-test-cache';

// Hook timeout for warming the cache: a fresh runner downloads the archives,
// and under --isolate every file fetches /crc itself. Far past bun's 5 s default.
export const NETWORK_WARMUP_MS = 120_000;

const PROBE_TIMEOUT_MS = 10_000;

export const liteOriginReachable: boolean = await fetch(`${LITE_ORIGIN}/crc`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }).then(
    async res => {
        await res.body?.cancel();
        return res.ok;
    },
    () => false
);

if (!liteOriginReachable) {
    console.warn(`[skip] ${LITE_ORIGIN} unreachable: suites that need the game cache are skipped`);
}
