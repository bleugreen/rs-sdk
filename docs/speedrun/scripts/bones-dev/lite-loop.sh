#!/bin/bash
# Keep one lite client logged in through the bones dev gateway (127.0.0.1:$PORT), with
# exponential jittered backoff between logins (at least 300 s after "Too many login attempts").
# Exits when $R/run/stop-ACCOUNT exists.
# usage: lite-loop.sh ACCOUNT [initial_delay_s]
a=$1; delay=${2:-0}; backoff=30
R=${BONES_DEV:-$HOME/rs-dev/babyblue}; PORT=${BONES_PORT:-7782}; log=$R/logs/lite-$a.log
echo $$ > $R/run/$a.liteloop.pid
cd $R/server/webclient
while [ ! -e $R/run/stop-$a ]; do
  if [ "$delay" -gt 0 ]; then echo "[lite-loop] $(date -u +%T) waiting ${delay}s before login" >> $log; sleep $delay; fi
  [ -e $R/run/stop-$a ] && break
  start=$(date +%s)
  GATEWAY_URL=ws://127.0.0.1:$PORT ~/.bun/bin/bun src/lite/runner.ts $a >> $log 2>&1 &
  echo $! > $R/run/$a.runner.pid
  wait $!
  lived=$(( $(date +%s) - start ))
  [ $lived -gt 600 ] && backoff=30
  if tail -30 $log | grep -q 'Too many login attempts'; then [ $backoff -lt 300 ] && backoff=300; fi
  delay=$(( backoff + RANDOM % (backoff / 2 + 1) ))
  backoff=$(( backoff * 2 )); [ $backoff -gt 600 ] && backoff=600
  echo "[lite-loop] $(date -u +%T) session lasted ${lived}s; next login in ${delay}s" >> $log
done
rm -f $R/run/$a.runner.pid $R/run/$a.liteloop.pid
echo "[lite-loop] $(date -u +%T) stopped" >> $log
