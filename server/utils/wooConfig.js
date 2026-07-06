export function isPlaceholderCredential(value) {
    const t = String(value || '').trim();
    return !t || t.includes('demo') || t.includes('•••');
}

export function getWooConsumerKey(cfg) {
    return String(cfg?.consumerKey || '').trim();
}

export function getWooConsumerSecret(cfg) {
    return String(cfg?.consumerSecret || '').trim();
}

export function hasRealWooCredentials(cfg) {
    return !isPlaceholderCredential(getWooConsumerKey(cfg))
        && !isPlaceholderCredential(getWooConsumerSecret(cfg));
}

/** Evita que saves da UI sobrescrevam chaves reais com placeholder. */
export function mergeWooConfig(current, incoming) {
    const cur = current || {};
    const inc = incoming || {};
    const next = { ...cur, ...inc };

    if (hasRealWooCredentials(cur)) {
        if (isPlaceholderCredential(getWooConsumerKey(inc))) {
            next.consumerKey = cur.consumerKey;
        }
        if (isPlaceholderCredential(getWooConsumerSecret(inc))) {
            next.consumerSecret = cur.consumerSecret;
        }
    }
    if (cur.connected && isPlaceholderCredential(getWooConsumerKey(inc)) && isPlaceholderCredential(getWooConsumerSecret(inc))) {
        next.connected = hasRealWooCredentials(cur);
    }
    if (!hasRealWooCredentials(next)) {
        next.connected = false;
    }
    return next;
}

export function maskWooConfigForClient(cfg) {
    if (!cfg) return cfg;
    const masked = { ...cfg };
    if (!isPlaceholderCredential(getWooConsumerKey(cfg))) {
        masked.consumerKey = '••••••••';
        masked.credentialsConfigured = true;
    }
    if (!isPlaceholderCredential(getWooConsumerSecret(cfg))) {
        masked.consumerSecret = '••••••••';
        masked.credentialsConfigured = true;
    }
    return masked;
}
