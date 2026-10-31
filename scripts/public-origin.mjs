/** Read the public origin from deployment configuration, never forwarded client headers. */
export function publicOrigin(env = process.env) {
  const value = env.PUBLIC_BASE_URL || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : null);
  if (!value) return null;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PUBLIC_BASE_URL must be an HTTP(S) origin without a path or credentials.');
  }
  return url.origin;
}

export function requestUrl(path, host, origin = null) {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid request path');
  return `${origin || `http://${host}`}${path}`;
}
