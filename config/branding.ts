/** Identidade do produto (VPS dev) vs. estúdio desenvolvedor (crédito discreto). */
export const BRANDING = {
  productName: 'Nexo',
  productTagline: 'Dev · cristian.vps-kinghost.net',
  productInitial: 'N',
  tenantName: 'Cristian Dev',
  tenantLabel: 'Ambiente de desenvolvimento',
  systemName: 'Nexo Dev',
  storeName: 'Nexo Loja',
  storeUrl: 'https://exemplo.com',
  vpsUrl: 'https://cristian.vps-kinghost.net',
  /** Marca comercial dos produtos no Bling/ML (não confundir com nome do app). */
  catalogBrand: 'Virginia Arruda',
  studioName: 'BagStudio',
  studioAuthor: 'Cristian Santos',
  version: '1.0.0-dev',
} as const;

export const studioCreditShort = `Desenvolvido por ${BRANDING.studioName}`;
export const studioCreditFull = `Desenvolvido por ${BRANDING.studioName} · ${BRANDING.studioAuthor}`;
