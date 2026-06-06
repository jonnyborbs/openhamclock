/**
 * General-purpose helper functions shared across route modules.
 */

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(ms) {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

// Cloudflare strips client-supplied CF-Ray / CF-Connecting-IP at its edge, so
// the presence of CF-Ray is a reliable signal the request actually transited
// CF. Without that guard, anyone hitting the Railway origin URL directly could
// forge CF-Connecting-IP and bypass per-IP rate limits and lockouts.
function getClientIP(req) {
  if (req.headers['cf-ray'] && req.headers['cf-connecting-ip']) {
    return req.headers['cf-connecting-ip'];
  }
  return req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
}

module.exports = { formatBytes, formatDuration, getClientIP };
