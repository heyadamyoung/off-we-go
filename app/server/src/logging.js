export function serializeRequestForLog(request) {
  const raw = request?.raw || request || {}
  const url = String(raw.url || request?.url || '/').split('?', 1)[0]
  return {
    method: raw.method || request?.method,
    url,
    host: request?.hostname || raw.headers?.host,
    remoteAddress: request?.ip || raw.socket?.remoteAddress || raw.remoteAddress,
    remotePort: raw.socket?.remotePort || raw.remotePort,
  }
}

export function productionLoggerOptions(level = 'info') {
  return {
    level,
    // Fastify's default request serializer includes the full URL. Wayfare has
    // signed media and legacy GPS credentials in query strings, so log only
    // the path and never serialize request headers.
    serializers: { req: serializeRequestForLog },
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  }
}
