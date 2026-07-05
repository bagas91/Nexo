/** Identidade do produto — VPS dev (espelha config/branding.ts). */
export const BRANDING = {
    productName: process.env.BRAND_PRODUCT_NAME || 'Nexo',
    tenantName: process.env.BRAND_TENANT_NAME || 'Cristian Dev',
    systemName: process.env.NOTIFY_SYSTEM_NAME || 'Nexo Dev',
    storeName: process.env.BRAND_STORE_NAME || 'Nexo Loja',
    storeUrl: process.env.BRAND_STORE_URL || 'https://exemplo.com',
    vpsUrl: process.env.BRAND_VPS_URL || 'https://cristian.vps-kinghost.net',
};
