#!/bin/sh
cd /hedgedoc

# Ensure upload directory permissions
chmod 700 /hedgedoc/public/uploads 2>/dev/null || true

# Run database migrations
CMD_DB_URL="$CMD_DB_URL" npx sequelize db:migrate 2>&1 || true

# Start supervisord (as root so it can write to /dev/stdout)
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
