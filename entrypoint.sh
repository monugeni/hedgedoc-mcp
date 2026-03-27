#!/bin/sh
cd /hedgedoc

MCP_UI_SCRIPT_SOURCE="/opt/mcp/ui/mcp-download-menu.js"
MCP_UI_SCRIPT_TARGET="/hedgedoc/public/js/mcp-download-menu.js"
HEDGEDOC_FOOTER_TEMPLATE="/hedgedoc/public/views/hedgedoc/footer.ejs"

if [ -f "$MCP_UI_SCRIPT_SOURCE" ]; then
    install -m 0644 "$MCP_UI_SCRIPT_SOURCE" "$MCP_UI_SCRIPT_TARGET"
fi

if [ -z "$MCP_PUBLIC_URL" ]; then
    MCP_PUBLIC_URL="$(node -e 'const hedgedocUrl = process.env.HEDGEDOC_PUBLIC_URL || process.env.HEDGEDOC_URL || "http://localhost:8210"; const port = process.env.PORT || "8211"; const url = new URL(hedgedocUrl); url.port = port; url.pathname = ""; url.search = ""; url.hash = ""; console.log(url.toString().replace(/\/$/, ""));')"
fi
export MCP_PUBLIC_URL

MCP_PUBLIC_URL_JSON="$(node -p 'JSON.stringify(process.argv[1])' "$MCP_PUBLIC_URL")"

if [ -f "$HEDGEDOC_FOOTER_TEMPLATE" ] && ! grep -Fq 'mcp-download-menu.js' "$HEDGEDOC_FOOTER_TEMPLATE"; then
    cat >> "$HEDGEDOC_FOOTER_TEMPLATE" <<EOF

<!-- mcp-download-menu -->
<script>
window.__MCP_DOWNLOAD_BASE_URL__ = $MCP_PUBLIC_URL_JSON;
</script>
<script src="<%- serverURL %>/js/mcp-download-menu.js"></script>
EOF
fi

# Handle upload directory permissions (from original entrypoint)
if [ "$CMD_IMAGE_UPLOAD_TYPE" = "filesystem" ]; then
    chown -R hedgedoc ./public/uploads 2>/dev/null || true
    chmod 700 ./public/uploads 2>/dev/null || true
fi

# Start supervisord as root (so it can write to /dev/stdout)
# HedgeDoc inside supervisord will run as root too, which is fine
# since this is inside a container
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
