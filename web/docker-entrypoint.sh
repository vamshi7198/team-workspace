#!/bin/sh
set -e
# Apply pending migrations (idempotent), then start the server.
node dist/migrate.cjs
exec node server.js
