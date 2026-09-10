export function isPlaceholderToken(token) {
    const t = String(token || '').trim();
    return !t || t.includes('demo') || t.includes('•••');
}

export function getStoredBlingToken(cfg) {
    return String(cfg?.accessToken || cfg?.apiKey || '').trim();
}

/** Evita que saves da UI sobrescrevam tokens OAuth reais com placeholder demo. */
export function mergeBlingConfig(current, incoming) {
    const cur = current || {};
    const inc = incoming || {};
    const next = { ...cur, ...inc };
    const curToken = getStoredBlingToken(cur);
    const incToken = getStoredBlingToken(inc);
    const curReal = !isPlaceholderToken(curToken);

    if (curReal && isPlaceholderToken(incToken)) {
        next.accessToken = cur.accessToken || cur.apiKey;
        next.apiKey = cur.apiKey || cur.accessToken;
    }
    if (cur.refreshToken && isPlaceholderToken(inc.refreshToken || '')) {
        next.refreshToken = cur.refreshToken;
    }
    if (cur.clientId && !String(inc.clientId || '').trim()) {
        next.clientId = cur.clientId;
    }
    if (cur.clientSecret && !String(inc.clientSecret || '').trim()) {
        next.clientSecret = cur.clientSecret;
    }
    if (curReal && inc.connected === false && isPlaceholderToken(incToken)) {
        next.connected = cur.connected !== false;
    }
    if (isPlaceholderToken(getStoredBlingToken(next))) {
        next.connected = false;
    }
    return next;
}

/** Não expõe token real na API — evita overwrite acidental no frontend. */
export function maskBlingConfigForClient(cfg) {
    if (!cfg) return cfg;
    const token = getStoredBlingToken(cfg);
    if (isPlaceholderToken(token)) return cfg;
    const masked = {
        ...cfg,
        accessToken: '••••••••',
        apiKey: '••••••••',
        refreshToken: cfg.refreshToken ? '••••••••' : '',
        tokenConfigured: true,
    };
    if (cfg.clientSecret) masked.clientSecret = '••••••••';
    return masked;
}
