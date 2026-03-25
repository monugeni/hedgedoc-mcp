#!/bin/sh
cd /hedgedoc

# Handle upload directory permissions (from original entrypoint)
if [ "$CMD_IMAGE_UPLOAD_TYPE" = "filesystem" ]; then
    chown -R hedgedoc ./public/uploads 2>/dev/null || true
    chmod 700 ./public/uploads 2>/dev/null || true
fi

# Start supervisord as root (so it can write to /dev/stdout)
# HedgeDoc inside supervisord will run as root too, which is fine
# since this is inside a container
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
