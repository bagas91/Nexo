/** Identidade do produto — produção Virginia Arruda (espelha config/branding.ts). */
export const BRANDING = {
    productName: process.env.BRAND_PRODUCT_NAME || 'Virginia Arruda',
    tenantName: process.env.BRAND_TENANT_NAME || 'Bp. Virgínia Arruda',
    systemName: process.env.NOTIFY_SYSTEM_NAME || 'Virginia Arruda',
    storeName: process.env.BRAND_STORE_NAME || 'Virginia Arruda',
    storeUrl: process.env.BRAND_STORE_URL || 'https://virginiaarruda.com',
    vpsUrl: process.env.BRAND_VPS_URL || 'https://virginiaarruda.vps-kinghost.net',
    /** Marca dos produtos no catálogo Bling / Mercado Livre. */
    catalogBrand: process.env.BRAND_CATALOG_BRAND || 'Virginia Arruda',
};
