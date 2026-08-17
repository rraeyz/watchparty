#!/bin/sh
# The virtual browser feature needs two processes: the main server, and the
# vmWorker that actually creates/destroys browser containers and answers on
# localhost:3100. Upstream runs these under pm2; in a single container we just
# start the worker in the background when it's enabled.
set -e

if [ -n "$VM_MANAGER_CONFIG" ]; then
  echo "[entrypoint] starting vmWorker"
  node server/vmWorker.ts &
  worker_pid=$!

  # If the worker dies, take the container down so Docker restarts both
  # together rather than leaving a half-working app.
  ( wait $worker_pid; echo "[entrypoint] vmWorker exited"; kill 1 ) &
fi

echo "[entrypoint] starting server"
exec node server/server.ts
