/**
 * Config WhatsApp Cloud API (Meta) — e-commerce / CRM.
 */

const MASK = '••••••••';

export function isPlaceholderSecret(value) {
    const t = String(value || '').trim();
    return !t || t.includes('•••') || t === MASK;
}

export function mergeMetaWhatsAppConfig(current, incoming) {
    const cur = current || {};
    const inc = incoming || {};
    const next = {
        ...cur,
        ...inc,
        phoneNumberId: String(inc.phoneNumberId ?? cur.phoneNumberId ?? '').trim(),
        wabaId: String(inc.wabaId ?? cur.wabaId ?? '').trim(),
        displayPhone: String(inc.displayPhone ?? cur.displayPhone ?? '').trim(),
        verifyToken: String(inc.verifyToken ?? cur.verifyToken ?? '').trim(),
        graphVersion: String(inc.graphVersion ?? cur.graphVersion ?? 'v21.0').trim() || 'v21.0',
    };

    if (isPlaceholderSecret(inc.accessToken)) {
        next.accessToken = cur.accessToken || '';
    } else if (inc.accessToken != null) {
        next.accessToken = String(inc.accessToken).trim();
    }

    if (isPlaceholderSecret(inc.appSecret)) {
        next.appSecret = cur.appSecret || '';
    } else if (inc.appSecret != null) {
        next.appSecret = String(inc.appSecret).trim();
    }

    const configured = !!(next.phoneNumberId && next.accessToken && !isPlaceholderSecret(next.accessToken));
    next.connected = configured && inc.connected !== false;
    next.updatedAt = Date.now();
    return next;
}

export function maskMetaWhatsAppConfigForClient(cfg) {
    if (!cfg) {
        return {
            connected: false,
            phoneNumberId: '',
            wabaId: '',
            displayPhone: '',
            verifyToken: '',
            graphVersion: 'v21.0',
            accessTokenConfigured: false,
            appSecretConfigured: false,
        };
    }
    return {
        connected: !!cfg.connected && !!(cfg.phoneNumberId && cfg.accessToken),
        phoneNumberId: cfg.phoneNumberId || '',
        wabaId: cfg.wabaId || '',
        displayPhone: cfg.displayPhone || '',
        verifyToken: cfg.verifyToken || '',
        graphVersion: cfg.graphVersion || 'v21.0',
        accessToken: cfg.accessToken ? MASK : '',
        appSecret: cfg.appSecret ? MASK : '',
        accessTokenConfigured: !!(cfg.accessToken && !isPlaceholderSecret(cfg.accessToken)),
        appSecretConfigured: !!(cfg.appSecret && !isPlaceholderSecret(cfg.appSecret)),
        updatedAt: cfg.updatedAt || null,
        lastError: cfg.lastError || null,
        lastWebhookAt: cfg.lastWebhookAt || null,
    };
}

export function hasMetaWhatsAppCredentials(cfg) {
    return !!(
        cfg
        && String(cfg.phoneNumberId || '').trim()
        && String(cfg.accessToken || '').trim()
        && !isPlaceholderSecret(cfg.accessToken)
    );
}
