/**
 * Sugestões de IA para campos do catálogo (NCM, peso, dimensões).
 * Prefere ChatGPT (OpenAI). Não grava no Bling até o usuário confirmar o rascunho.
 */

import { getAvailableProviders, generateWithSystem, isOpenAiQuotaBlocked, markOpenAiQuotaBlocked, isGeminiQuotaBlocked, markGeminiQuotaBlocked } from '../utils/aiService.js';
import chatDB from '../db/database.js';
import logger from '../utils/logger.js';
import { logAudit } from '../utils/auditService.js';
import { BRANDING } from '../utils/branding.js';

/** Lazy para evitar ciclo com catalogQualityService. */
async function applyFix(externalId, patch, opts) {
    const { fixCatalogProduct } = await import('./catalogQualityService.js');
    return fixCatalogProduct(externalId, patch, opts);
}

/** Marca comercial padrão — a IA não inventa; sempre usa esta se o produto estiver sem marca. */
function defaultCatalogBrand() {
    return String(BRANDING.catalogBrand || 'Virginia Arruda').trim() || 'Virginia Arruda';
}

function resolveProductBrand(product, editedBrand) {
    const fromEdit = String(editedBrand || '').trim();
    if (fromEdit) return fromEdit;
    const fromProduct = String(product?.brand || '').trim();
    if (fromProduct) return fromProduct;
    return defaultCatalogBrand();
}

const ALLOWED_FIELDS = new Set(['ncm', 'weight', 'dimensions', 'description']);
/** Por onda: respeita cota free Gemini (~20 req/min). */
const BULK_WAVE = 15;
/** Máximo total enfileirado (várias ondas de 15). */
const BULK_QUEUE_MAX = 500;
const BULK_DELAY_MS = 4500;
/** Pausa entre ondas para não estourar a cota. */
const BULK_WAVE_PAUSE_MS = 20000;
/** Aplicar/descartar no Bling não gasta cota de IA. */
const APPLY_BULK_MAX = 200;

const CATALOG_SYSTEM = `Você é redator de e-commerce no Brasil (Virginia Arruda: semijoias, aromatizadores, Bíblias, itens pastorais e casa).
Textos servem para WooCommerce + Rank Math SEO e anúncio no Mercado Livre.
Responda APENAS com um único objeto JSON válido, sem markdown e sem texto fora do JSON.

Campos:
- ncm: string com exatamente 8 dígitos ou null
- weight: número em kg (ex.: 0.05) ou null
- height, width, length: cm da embalagem ou null
- focusKeyword: palavra-chave de foco Rank Math (2–6 palavras, minúsculas, SEM a marca). Ex.: "aromatizador de ambientes alecrim"
- seoTitle: título SEO Rank Math (50–60 caracteres). DEVE começar com a focusKeyword. Sem HTML.
- seoDescription: meta description Rank Math (140–160 caracteres). DEVE conter a focusKeyword. Sem HTML.
- shortDescription: igual à seoDescription (snippet Woo). Sem HTML.
- description: texto LONGO para conteúdo Woo/Rank Math (mínimo 450 palavras, ideal 550–700). Português do Brasil, parágrafos separados por \\n\\n. Sem HTML. A focusKeyword DEVE aparecer na 1ª frase e natural no restante.
- rationale: frase curta em PT-BR (máx. 12 palavras)

Regras Rank Math + Mercado Livre:
1) Identifique o TIPO real pelo nome (aromatizador ≠ semijoia ≠ Bíblia). Nunca use "semijoia" se o produto não for joia/bijuteria.
2) focusKeyword = tipo + atributo principal do nome, sem marca "Virginia Arruda".
3) seoTitle / seoDescription / shortDescription / description: naturalmente alinhados à focusKeyword (sem stuffing).
4) description: seções em prosa (o que é, benefícios, como usar, diferenciais, para quem, marca). Sem listas com "|".
5) Proibido: HTML, markdown, emoji em excesso, "melhor do Brasil", promessas médicas, inventar certificações.
6) Nunca invente SKU nem preço.
7) Semijoias: NCM 7117… ; livros/Bíblias: 4901… ; aromatizadores/casa: use NCM plausível de artigos de higiene/perfumaria se pedido.
8) Tom respeitoso em produtos religiosos.
9) Marca: NÃO invente. O sistema preenche a marca da loja.
10) Resposta só JSON.`;

function cleanText(v, max = 12000) {
    const s = String(v || '').replace(/\s+/g, ' ').trim();
    if (!s) return null;
    return s.slice(0, max);
}

/** Normaliza copy SEO/ML: sem HTML, espaços limpos, tamanho alvo. */
function cleanSeoText(v, { max = 200, min = 0 } = {}) {
    let s = String(v || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[*_#`]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!s) return null;
    if (s.length > max) {
        s = s.slice(0, max - 1).replace(/\s+\S*$/, '').trim();
        if (!/[.!?]$/.test(s)) s = `${s}…`;
    }
    if (min > 0 && s.length < min) return s;
    return s;
}

/** Descrição longa: preserva quebras de parágrafo. */
function cleanLongDescription(v, max = 12000) {
    let s = String(v || '')
        .replace(/<[^>]+>/g, '\n')
        .replace(/[*_#`]/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    if (!s) return null;
    if (s.length > max) s = s.slice(0, max).replace(/\s+\S*$/, '').trim();
    return s;
}

function detectProductKind(name, category = '') {
    const t = `${name || ''} ${category || ''}`.toLowerCase();
    if (/b[ií]blia|livro|harpa|devocion|agenda|caderno/.test(t)) return 'book';
    if (/aromatiz|difusor|ess[eê]ncia|vela arom|home spray|perfume|col[oô]nia|alecrim|lavanda|sândalo|incenso/.test(t)) {
        return 'home_scent';
    }
    if (/brinco|colar|pulseira|anel|semijoia|bijuter|argola|pingente|corrente|bracelete|broche/.test(t)) {
        return 'jewelry';
    }
    return 'general';
}

/** Palavra-chave de foco a partir do nome (sem marca). */
function deriveFocusKeyword(name, brand = '') {
    let s = String(name || '').replace(/\s+/g, ' ').trim();
    const brandRe = String(brand || defaultCatalogBrand()).trim();
    if (brandRe) {
        s = s.replace(new RegExp(brandRe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
    }
    s = s
        .replace(/\b(cor|tam|tamanho|ref|sku)[:.].*$/i, '')
        .replace(/[|/–—]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    const words = s.split(' ').filter(Boolean).slice(0, 6);
    const kw = words.join(' ').trim();
    return kw.slice(0, 80) || 'produto';
}

function ensureKeywordInText(text, keyword, { atStart = false } = {}) {
    const body = String(text || '').trim();
    const kw = String(keyword || '').trim();
    if (!body) return kw || null;
    if (!kw) return body;
    const has = body.toLowerCase().includes(kw.toLowerCase());
    if (has) return body;
    if (atStart) return `${kw.charAt(0).toUpperCase()}${kw.slice(1)} — ${body}`.slice(0, 5000);
    return `${body} ${kw}`.trim();
}

function wordCount(text) {
    return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @type {null | object} */
let bulkJob = null;
let bulkCancel = false;

function numOrNull(v, { min = 0, max = Infinity } = {}) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(',', '.'));
    if (!Number.isFinite(n) || n < min || n > max) return null;
    return n;
}

function cleanNcm(v) {
    const digits = String(v || '').replace(/\D/g, '');
    if (digits.length !== 8) return null;
    return digits;
}

/** Tenta fechar JSON truncado (comum quando o modelo corta no meio). */
function repairTruncatedJson(raw) {
    let s = String(raw || '').trim();
    const start = s.indexOf('{');
    if (start < 0) return null;
    s = s.slice(start);

    s = s.replace(/,\s*$/, '');

    const quotes = (s.match(/"/g) || []).length;
    if (quotes % 2 === 1) s += '"';

    const openObj = (s.match(/\{/g) || []).length;
    const closeObj = (s.match(/\}/g) || []).length;
    const openArr = (s.match(/\[/g) || []).length;
    const closeArr = (s.match(/\]/g) || []).length;
    for (let i = 0; i < openArr - closeArr; i += 1) s += ']';
    for (let i = 0; i < openObj - closeObj; i += 1) s += '}';

    try {
        return JSON.parse(s);
    } catch {
        return null;
    }
}

/** Extrai campos numéricos/string mesmo de JSON incompleto via regex. */
function salvagePartialFields(raw) {
    const text = String(raw || '');
    if (!text.includes('{')) return null;
    const out = {};
    const ncm = text.match(/"ncm"\s*:\s*"(\d{8})"/);
    if (ncm) out.ncm = ncm[1];
    const weight = text.match(/"weight"\s*:\s*([0-9]+(?:\.[0-9]+)?)/);
    if (weight) out.weight = Number(weight[1]);
    const height = text.match(/"height"\s*:\s*([0-9]+(?:\.[0-9]+)?)/);
    if (height) out.height = Number(height[1]);
    const width = text.match(/"width"\s*:\s*([0-9]+(?:\.[0-9]+)?)/);
    if (width) out.width = Number(width[1]);
    const length = text.match(/"length"\s*:\s*([0-9]+(?:\.[0-9]+)?)/);
    if (length) out.length = Number(length[1]);
    const rationale = text.match(/"rationale"\s*:\s*"([^"]*)/);
    if (rationale) out.rationale = rationale[1];
    const shortDescription = text.match(/"shortDescription"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (shortDescription) out.shortDescription = shortDescription[1].replace(/\\"/g, '"');
    const description = text.match(/"description"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (description) out.description = description[1].replace(/\\"/g, '"');
    const seoTitle = text.match(/"seoTitle"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (seoTitle) out.seoTitle = seoTitle[1].replace(/\\"/g, '"');
    const seoDescription = text.match(/"seoDescription"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (seoDescription) out.seoDescription = seoDescription[1].replace(/\\"/g, '"');
    const focusKeyword = text.match(/"focusKeyword"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (focusKeyword) out.focusKeyword = focusKeyword[1].replace(/\\"/g, '"');
    return Object.keys(out).length ? out : null;
}

function extractJson(text) {
    let raw = String(text || '').trim();
    if (!raw) return null;
    raw = raw.replace(/^\uFEFF/, '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    try {
        return JSON.parse(raw);
    } catch {
        /* try fence or substring */
    }
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
        try {
            return JSON.parse(fenced[1].trim());
        } catch {
            /* continue */
        }
    }
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try {
            return JSON.parse(raw.slice(start, end + 1));
        } catch {
            /* continue */
        }
    }
    const repaired = repairTruncatedJson(raw);
    if (repaired) return repaired;
    return salvagePartialFields(raw);
}

function normalizeFields(requested) {
    const list = Array.isArray(requested) && requested.length
        ? requested.map((f) => String(f).toLowerCase())
        : ['ncm', 'weight', 'dimensions', 'description'];
    const out = [];
    for (const f of list) {
        if (ALLOWED_FIELDS.has(f) && !out.includes(f)) out.push(f);
    }
    return out.length ? out : ['ncm', 'weight', 'dimensions', 'description'];
}

/** Catálogo: Gemini primeiro (OpenAI desta VPS está sem cota). ChatGPT volta quando houver crédito. */
function resolveCatalogProvider(requested) {
    const { providers } = getAvailableProviders();
    if (!providers.length) {
        const err = new Error('IA não configurada. Defina OPENAI_API_KEY (recomendado) ou GEMINI_API_KEY.');
        err.status = 503;
        throw err;
    }
    // Força explícita (respeita bloqueio de cota OpenAI)
    if (requested && providers.includes(requested)) {
        if (requested === 'openai' && isOpenAiQuotaBlocked() && providers.includes('gemini')) {
            logger.warn('Catalog AI: OpenAI sem cota — usando Gemini');
            return 'gemini';
        }
        return requested;
    }
    const envPref = process.env.AI_CATALOG_PROVIDER || 'gemini';
    if (envPref === 'openai' && providers.includes('openai') && !isOpenAiQuotaBlocked()) return 'openai';
    if (providers.includes('gemini')) return 'gemini';
    if (providers.includes('openai')) return 'openai';
    return providers[0];
}

/** Corta título no limite Rank Math / Mercado Livre (~60). */
function clipTitle(name, max = 60) {
    let s = String(name || '').replace(/\s+/g, ' ').trim();
    if (!s) s = 'Produto';
    if (s.length <= max) return s;
    s = s.slice(0, max - 1).replace(/\s+\S*$/, '').trim();
    return s || String(name).slice(0, max).trim();
}

function buildUserPrompt(product, fields) {
    const wantNcm = fields.includes('ncm');
    const wantWeight = fields.includes('weight');
    const wantDims = fields.includes('dimensions');
    const wantDesc = fields.includes('description');

    const keys = [];
    if (wantNcm) keys.push('ncm');
    if (wantWeight) keys.push('weight');
    if (wantDims) keys.push('height', 'width', 'length');
    if (wantDesc) keys.push('focusKeyword', 'shortDescription', 'description', 'seoTitle', 'seoDescription');
    keys.push('rationale');

    const kind = detectProductKind(product.name, product.category);
    const brand = resolveProductBrand(product);
    const focusHint = deriveFocusKeyword(product.name, brand);

    const parts = [
        'Produto para sugerir campos:',
        `Nome: ${product.name || '(sem nome)'}`,
        `SKU: ${product.sku || '(sem sku)'}`,
        `Categoria: ${product.category || '(não informada)'}`,
        `Marca atual: ${product.brand || '(vazia — sistema usa padrão da loja)'}`,
        `Tipo detectado: ${kind}`,
        `Formato: ${product.formato || 'S'}`,
        '',
        `Campos pedidos: ${fields.join(', ')}.`,
        `Marca padrão da loja (não inventar outra): ${brand}.`,
        `Sugestão de focusKeyword: "${focusHint}" (ajuste se fizer sentido, sem incluir a marca).`,
    ];
    if (wantWeight || wantDims) {
        parts.push('Peso típico de semijoia: 0.01 a 0.20 kg. Aromatizador/casa: 0.1–0.5 kg. Dimensões = embalagem em cm.');
    }
    if (wantDesc) {
        parts.push(
            'Copy SEO Rank Math + Woo + Mercado Livre:',
            `- focusKeyword obrigatória (ex.: "${focusHint}").`,
            '- seoTitle: 50–60 chars, COMEÇA com a focusKeyword.',
            '- seoDescription / shortDescription: 140–160 chars, CONTÉM a focusKeyword + benefício + CTA.',
            '- description: MÍNIMO 450 palavras, parágrafos com \\n\\n, focusKeyword na 1ª frase. Sem "|". Sem chamar de semijoia se não for joia.',
        );
    }
    parts.push(
        '',
        'IMPORTANTE: preencha TODAS as chaves pedidas com valores realistas para ESTE produto.',
        `Retorne SOMENTE JSON com as chaves: ${keys.join(', ')}.`,
    );
    if (wantDesc && !wantNcm && !wantWeight && !wantDims) {
        parts.push(
            'Exemplo (aromatizador): {"focusKeyword":"aromatizador de ambientes alecrim","seoTitle":"Aromatizador de Ambientes Alecrim 100ml","seoDescription":"Aromatizador de ambientes alecrim para deixar a casa fresca e aconchegante. Ideal para o dia a dia.","shortDescription":"Aromatizador de ambientes alecrim para deixar a casa fresca e aconchegante. Ideal para o dia a dia.","description":"O aromatizador de ambientes alecrim ... (450+ palavras em parágrafos)","rationale":"SEO Rank Math aromatizador"}',
        );
    } else {
        parts.push(
            'Exemplo: {"ncm":"71171900","weight":0.05,"height":8,"width":8,"length":3,"focusKeyword":"brinco flor esmaltada","seoTitle":"Brinco Flor Esmaltada Centro Estrela","seoDescription":"Brinco flor esmaltada com centro estrela. Peça leve e versátil para o dia a dia. Confira acabamento e fotos.","shortDescription":"Brinco flor esmaltada com centro estrela. Peça leve e versátil para o dia a dia. Confira acabamento e fotos.","description":"O brinco flor esmaltada ... (450+ palavras)","rationale":"Semijoia SEO/ML"}',
        );
    }
    return parts.join('\n');
}

function normalizeSuggestions(parsed, fields, product = {}) {
    const brand = resolveProductBrand(product, parsed.brand);
    const focusKeyword = cleanSeoText(parsed.focusKeyword, { max: 80 })
        || deriveFocusKeyword(product.name, brand);

    const suggestions = {
        ncm: null,
        weight: null,
        height: null,
        width: null,
        length: null,
        brand: null,
        focusKeyword: null,
        shortDescription: null,
        description: null,
        seoTitle: null,
        seoDescription: null,
        rationale: String(parsed.rationale || '').trim().slice(0, 280) || '',
    };

    if (fields.includes('ncm')) {
        suggestions.ncm = cleanNcm(parsed.ncm);
    }
    if (fields.includes('weight')) {
        suggestions.weight = numOrNull(parsed.weight, { min: 0.001, max: 5 });
    }
    if (fields.includes('dimensions')) {
        suggestions.height = numOrNull(parsed.height, { min: 0.1, max: 200 });
        suggestions.width = numOrNull(parsed.width, { min: 0.1, max: 200 });
        suggestions.length = numOrNull(parsed.length, { min: 0.1, max: 200 });
    }
    if (fields.includes('description')) {
        suggestions.focusKeyword = focusKeyword;
        let seoTitle = cleanSeoText(parsed.seoTitle, { max: 60 })
            || cleanSeoText(parsed.shortDescription, { max: 60 })
            || clipTitle(product.name, 60);
        seoTitle = ensureKeywordInText(seoTitle, focusKeyword, { atStart: true });
        suggestions.seoTitle = cleanSeoText(seoTitle, { max: 60 });

        let seoDescription = cleanSeoText(parsed.seoDescription, { max: 160 })
            || cleanSeoText(parsed.shortDescription, { max: 160 });
        seoDescription = ensureKeywordInText(seoDescription, focusKeyword, { atStart: true });
        suggestions.seoDescription = cleanSeoText(seoDescription, { max: 160 });
        suggestions.shortDescription = suggestions.seoDescription;

        let description = cleanLongDescription(parsed.description, 12000)
            || cleanText(parsed.description, 12000);
        description = ensureKeywordInText(description, focusKeyword, { atStart: true });
        suggestions.description = description;
    }
    suggestions.brand = brand;
    return suggestions;
}

function countFilled(suggestions) {
    return [
        suggestions.ncm,
        suggestions.weight,
        suggestions.height,
        suggestions.width,
        suggestions.length,
        suggestions.brand,
        suggestions.focusKeyword,
        suggestions.shortDescription,
        suggestions.description,
        suggestions.seoTitle,
        suggestions.seoDescription,
    ].filter((v) => v != null && v !== '').length;
}

function buildHeuristicLongDescription(name, kind, brand, focusKeyword) {
    const title = String(name || 'Produto').trim();
    const kw = focusKeyword || deriveFocusKeyword(title, brand);
    const b = brand || defaultCatalogBrand();

    if (kind === 'home_scent') {
        return [
            `O ${kw} da ${b} foi pensado para perfumar ambientes com praticidade e um toque sofisticado no dia a dia. Ideal para sala, quarto, escritório ou recepção, ele ajuda a criar uma atmosfera agradável sem complicação.`,
            `Use o ${kw} em locais ventilados e siga as orientações de aplicação do frasco. Pequenas quantidades já deixam o ambiente mais acolhedor. Combine com a rotina de limpeza ou com momentos de descanso para reforçar a sensação de bem-estar.`,
            `A fragrância foi escolhida para quem busca frescor e personalidade na casa. O ${kw} combina com decoração contemporânea e com o estilo da marca ${b}, conhecida por produtos selecionados para o lar e para o autocuidado.`,
            `Benefícios práticos: fácil de usar, ótimo para presente e para renovar o clima do ambiente. Se você procura um ${kw} com boa apresentação e uso diário, esta opção da ${b} entrega equilíbrio entre aroma e praticidade.`,
            `No home office, o ${kw} ajuda a marcar pausas e a deixar o espaço mais convidativo. Em salas de estar, ele complementa a decoração sem exageros. Em quartos, prefira aplicação moderada para manter o conforto durante o descanso.`,
            `Para presentear, o ${kw} da ${b} funciona bem em datas especiais, casa nova e kits de bem-estar. A embalagem e o aroma comunicam cuidado — um detalhe simples que eleva a experiência de quem recebe.`,
            `Cuidados: mantenha fora do alcance de crianças e pets, evite contato direto com tecidos delicados e não ingira. Em superfícies sensíveis, teste em área pequena. Em caso de dúvida sobre materiais ou rendimento, confira as fotos e a ficha do produto antes da compra.`,
            `A ${b} seleciona itens pensados para o público que valoriza fé, casa e bem-estar. O ${kw} completa sua rotina com um detalhe sensorial elegante — perfeito para uso próprio ou para presentear com intenção.`,
            `Antes de finalizar, confira imagens, volume e modo de uso. Assim você garante a melhor experiência com o ${kw} e aproveita o aroma no ambiente com segurança e constância. Escolha o ${kw} certo para o seu espaço e sinta a diferença no dia a dia.`,
            `Se já conhece a linha da ${b}, o ${kw} é uma extensão natural do cuidado com o lar. Se está conhecendo agora, comece pelo aroma que mais combina com sua rotina e mantenha o frasco em local fresco e protegido da luz forte.`,
        ].join('\n\n');
    }
    if (kind === 'book') {
        return [
            `A edição ${title} é uma escolha da ${b} para leitura, estudo e momentos de fé. Com foco em ${kw}, o volume acompanha o uso diário e também é uma ótima opção de presente.`,
            `Ideal para estudo bíblico, culto e reflexão pessoal. O ${kw} reúne legibilidade e acabamento cuidado para quem lê com frequência.`,
            `Na ${b} você encontra materiais pastorais e cristãos selecionados. Este ${kw} reforça a biblioteca doméstica ou o acervo de lideranças e ministérios.`,
            `Cuide do exemplar longe de umidade excessiva e manuseie com atenção às páginas. Confira fotos e detalhes da capa/acabamento no anúncio.`,
            `Se busca um ${kw} confiável para o dia a dia, esta edição da ${b} equilibra conteúdo e apresentação. Veja as imagens e escolha com segurança.`,
        ].join('\n\n');
    }
    if (kind === 'jewelry') {
        return [
            `O ${kw} da ${b} é uma semijoia pensada para o dia a dia e para ocasiões especiais. Com acabamento delicado, combina com looks casuais e também com produções mais elegantes.`,
            `Use o ${kw} sozinho ou em composição com outras peças. A ${b} seleciona modelos que valorizam o estilo feminino com leveza e bom acabamento.`,
            `Cuidados: evite contato prolongado com água, perfume e produtos químicos; guarde em local seco. Assim o ${kw} mantém o brilho por mais tempo.`,
            `Ideal para presente e para renovar o porta-joias. Confira fotos, cores e detalhes no anúncio antes de comprar o ${kw}.`,
            `Na ${b}, semijoias como este ${kw} unem estilo e praticidade. Escolha a sua e complete o look com confiança.`,
        ].join('\n\n');
    }
    return [
        `O ${kw} da ${b} foi selecionado para quem busca qualidade e praticidade. Ideal para o dia a dia e também como presente.`,
        `Na descrição e nas fotos você confere acabamento, uso sugerido e diferenciais do ${kw}. A marca ${b} prioriza produtos alinhados ao estilo da loja.`,
        `Siga as orientações de uso e conservação indicadas na embalagem. Em caso de dúvida, fale com o atendimento antes ou depois da compra.`,
        `Escolher o ${kw} certo fica mais fácil com imagens nítidas e ficha completa. Confira tudo no anúncio e finalize com segurança.`,
        `A ${b} reúne itens de fé, casa e estilo. Este ${kw} complementa sua rotina com um toque especial e apresentação cuidada.`,
    ].join('\n\n');
}

/** Fallback sem IA — usado quando Gemini/OpenAI estão sem cota. */
function heuristicSuggestions(product, fields) {
    const name = String(product.name || '').trim() || 'Produto';
    const brand = resolveProductBrand(product);
    const kind = detectProductKind(name, product.category);
    const focusKeyword = deriveFocusKeyword(name, brand);
    const out = {
        ncm: null,
        weight: null,
        height: null,
        width: null,
        length: null,
        brand,
        focusKeyword: null,
        shortDescription: null,
        description: null,
        seoTitle: null,
        seoDescription: null,
        rationale: 'Padrão Rank Math/ML por tipo de produto (IA sem cota)',
    };
    if (fields.includes('ncm')) {
        if (kind === 'book') out.ncm = '49019900';
        else if (kind === 'home_scent') out.ncm = '33074900';
        else out.ncm = '71171900';
    }
    if (fields.includes('weight')) {
        out.weight = kind === 'book' ? 0.4 : (kind === 'home_scent' ? 0.25 : 0.04);
    }
    if (fields.includes('dimensions')) {
        if (kind === 'book') {
            out.height = 22;
            out.width = 15;
            out.length = 4;
        } else if (kind === 'home_scent') {
            out.height = 18;
            out.width = 8;
            out.length = 8;
        } else {
            out.height = 8;
            out.width = 8;
            out.length = 3;
        }
    }
    if (fields.includes('description')) {
        out.focusKeyword = focusKeyword;
        const titleCaseKw = focusKeyword.replace(/\b\w/g, (c) => c.toUpperCase());
        out.seoTitle = cleanSeoText(titleCaseKw, { max: 60 }) || clipTitle(name, 60);
        const benefit = kind === 'home_scent'
            ? 'para deixar a casa fresca e aconchegante'
            : kind === 'book'
                ? 'para leitura, estudo e presente'
                : kind === 'jewelry'
                    ? 'com acabamento delicado para o dia a dia'
                    : 'com qualidade para o dia a dia';
        out.seoDescription = cleanSeoText(
            `${titleCaseKw} ${benefit}. Confira detalhes e fotos.`,
            { max: 160 },
        );
        out.shortDescription = out.seoDescription;
        out.description = buildHeuristicLongDescription(name, kind, brand, focusKeyword);
    }
    return out;
}

function isQuotaError(err) {
    return /quota|rate.?limit|429|RESOURCE_EXHAUSTED|free_tier|cota|crédito|billing|insufficient_quota/i
        .test(String(err?.message || err || ''));
}

/**
 * @param {string} externalId
 * @param {{ fields?: string[], name?: string, sku?: string, provider?: string, saveDraft?: boolean }} opts
 */
export async function suggestCatalogProductFields(externalId, opts = {}) {
    const id = String(externalId || '').trim();
    if (!id) throw new Error('Informe o ID do produto.');

    const stored = chatDB.getCatalogProduct('bling', id);
    if (!stored) {
        const err = new Error('Produto não encontrado no snapshot local. Rode Verificar Catálogo.');
        err.status = 404;
        throw err;
    }

    const fields = normalizeFields(opts.fields);
    const product = {
        ...stored,
        name: String(opts.name || stored.name || '').trim(),
        sku: String(opts.sku || stored.sku || '').trim(),
    };

    const preferred = resolveCatalogProvider(opts.provider);
    const { providers } = getAvailableProviders();
    const tryOrder = [];
    const pushProv = (p) => {
        if (!p || !providers.includes(p) || tryOrder.includes(p)) return;
        if (p === 'openai' && isOpenAiQuotaBlocked()) return;
        if (p === 'gemini' && isGeminiQuotaBlocked()) return;
        tryOrder.push(p);
    };
    pushProv(preferred);
    pushProv(preferred === 'openai' ? 'gemini' : 'openai');

    const userPrompt = buildUserPrompt(product, fields);
    logger.info('Catalog AI suggest', { id, fields, provider: preferred, tryOrder, name: product.name?.slice(0, 60) });

    let lastRaw = '';
    let parsed = null;
    let providerUsed = null;
    let lastErr = null;
    let usedHeuristic = false;

    for (const provider of tryOrder) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                const result = await generateWithSystem({
                    system: CATALOG_SYSTEM,
                    user: attempt === 0
                        ? userPrompt
                        : `${userPrompt}\n\nIMPORTANTE: responda somente JSON válido completo.`,
                    provider,
                    temperature: attempt === 0 ? 0.35 : 0.15,
                    maxOutputTokens: fields.includes('description') ? 8192 : 1024,
                    responseMimeType: 'application/json',
                });
                providerUsed = result.provider;
                lastRaw = result.text || '';
                parsed = extractJson(lastRaw);
                if (parsed && typeof parsed === 'object') {
                    const hasAny = parsed.ncm != null
                        || parsed.weight != null
                        || parsed.height != null
                        || parsed.width != null
                        || parsed.length != null
                        || parsed.shortDescription
                        || parsed.description
                        || parsed.seoTitle
                        || parsed.seoDescription
                        || parsed.focusKeyword;
                    if (hasAny || parsed.rationale) break;
                }
                logger.warn('Catalog AI suggest: JSON inválido, retentando', {
                    attempt: attempt + 1,
                    provider,
                    preview: lastRaw.slice(0, 160),
                });
                parsed = null;
            } catch (err) {
                lastErr = err;
                logger.warn('Catalog AI suggest provider falhou', provider, err?.message || err);
                if (provider === 'openai' && isQuotaError(err)) markOpenAiQuotaBlocked();
                if (provider === 'gemini' && isQuotaError(err)) markGeminiQuotaBlocked();
                parsed = null;
                break; // tenta próximo provider
            }
        }
        if (parsed) break;
    }

    let suggestions;
    if (parsed && typeof parsed === 'object') {
        suggestions = normalizeSuggestions(parsed, fields, product);
    } else if (isQuotaError(lastErr) || !tryOrder.length) {
        // Sem cota: ainda gera rascunho útil para o usuário revisar
        suggestions = heuristicSuggestions(product, fields);
        providerUsed = 'heuristic';
        usedHeuristic = true;
        logger.warn('Catalog AI suggest: usando heurística (IA sem cota)', { id, sku: product.sku });
    } else {
        const hint = lastErr?.message || lastRaw.slice(0, 120) || 'sem resposta';
        if (/no longer available|not found|404/i.test(hint)) {
            throw new Error(
                `Modelo de IA indisponível. Ajuste AI_GEMINI_MODEL no .env. (${hint.slice(0, 140)})`,
            );
        }
        throw new Error(`A IA não retornou JSON válido. Tente novamente. (${hint.slice(0, 160)})`);
    }

    // Marca: nunca deixa a IA inventar — fixa no padrão da loja se vazio
    suggestions.brand = resolveProductBrand(product, suggestions.brand);
    if (fields.includes('description')) {
        const brand = suggestions.brand;
        const kw = suggestions.focusKeyword || deriveFocusKeyword(product.name, brand);
        suggestions.focusKeyword = kw;
        if (!suggestions.seoTitle) suggestions.seoTitle = cleanSeoText(kw, { max: 60 });
        if (!suggestions.seoDescription) {
            suggestions.seoDescription = cleanSeoText(`${kw} — qualidade para o dia a dia. Confira detalhes.`, { max: 160 });
        }
        suggestions.shortDescription = suggestions.seoDescription;
        // Se a IA/heurística ficou curta demais para Rank Math, completa com texto por tipo
        if (wordCount(suggestions.description) < 220) {
            const kind = detectProductKind(product.name, product.category);
            suggestions.description = buildHeuristicLongDescription(product.name, kind, brand, kw);
        }
    }

    if (!countFilled(suggestions)) {
        throw new Error('A IA não conseguiu sugerir valores úteis para este produto. Tente de novo ou preencha manualmente.');
    }

    let draft = null;
    if (opts.saveDraft !== false) {
        draft = chatDB.upsertCatalogAiDraft({
            externalId: id,
            sku: product.sku,
            name: product.name,
            fields,
            suggested: suggestions,
            provider: providerUsed,
            rationale: suggestions.rationale,
        });
    }

    return {
        productId: id,
        fields,
        suggestions,
        provider: providerUsed,
        heuristic: usedHeuristic,
        draft,
        product: {
            name: product.name,
            sku: product.sku,
        },
    };
}

export function getBulkCatalogAiSuggestJob() {
    if (!bulkJob) return null;
    return {
        ...bulkJob,
        errors: (bulkJob.errors || []).slice(-80),
        pendingDrafts: chatDB.countCatalogAiDrafts('pending'),
    };
}

export function cancelBulkCatalogAiSuggest() {
    if (!bulkJob || bulkJob.status !== 'running') {
        return { ok: false, message: 'Nenhum job em andamento.' };
    }
    bulkCancel = true;
    bulkJob.message = 'Cancelamento solicitado…';
    return { ok: true };
}

/**
 * Gera rascunhos em massa — NÃO envia ao Bling.
 * Aceita muitos IDs e processa em ondas de BULK_WAVE (15), enfileirando na aprovação.
 */
export function startBulkCatalogAiSuggest(opts = {}) {
    if (bulkJob?.status === 'running') {
        return { alreadyRunning: true, job: getBulkCatalogAiSuggestJob() };
    }

    const ids = [...new Set(
        (Array.isArray(opts.externalIds) ? opts.externalIds : [])
            .map((id) => String(id || '').trim())
            .filter(Boolean),
    )].slice(0, BULK_QUEUE_MAX);

    if (!ids.length) {
        return { alreadyRunning: false, job: null, error: 'Selecione ao menos um produto Bling.' };
    }

    const fields = normalizeFields(opts.fields);
    const wavesTotal = Math.ceil(ids.length / BULK_WAVE);
    const id = `ai_bulk_${Date.now()}`;
    bulkCancel = false;
    bulkJob = {
        id,
        kind: 'ai_suggest_bulk',
        status: 'running',
        startedAt: Date.now(),
        total: ids.length,
        done: 0,
        ok: 0,
        failed: 0,
        wave: 1,
        wavesTotal,
        waveSize: BULK_WAVE,
        message: wavesTotal > 1
            ? `Fila de ${ids.length} · onda 1/${wavesTotal} (até ${BULK_WAVE} por vez)…`
            : 'Gerando rascunhos com IA…',
        currentSku: undefined,
        errors: [],
        provider: 'gemini',
        heuristic: 0,
        queued: ids.length,
        truncated: (Array.isArray(opts.externalIds) ? opts.externalIds : []).length > BULK_QUEUE_MAX,
    };

    (async () => {
        try {
            resolveCatalogProvider(opts.provider);
            for (let i = 0; i < ids.length; i += 1) {
                if (bulkCancel) {
                    bulkJob.status = 'cancelled';
                    bulkJob.message = `Cancelado após ${bulkJob.done}/${bulkJob.total}.`
                        + ` ${bulkJob.ok} rascunho(s) já na lista de aprovação.`;
                    bulkJob.finishedAt = Date.now();
                    break;
                }

                const wave = Math.floor(i / BULK_WAVE) + 1;
                // Pausa entre ondas (não antes da primeira)
                if (i > 0 && i % BULK_WAVE === 0) {
                    bulkJob.wave = wave;
                    bulkJob.message = `Onda ${wave - 1}/${wavesTotal} ok — pausa ${Math.round(BULK_WAVE_PAUSE_MS / 1000)}s antes da onda ${wave}…`;
                    bulkJob.currentSku = undefined;
                    await sleep(BULK_WAVE_PAUSE_MS);
                    if (bulkCancel) {
                        bulkJob.status = 'cancelled';
                        bulkJob.message = `Cancelado após ${bulkJob.done}/${bulkJob.total}.`
                            + ` ${bulkJob.ok} rascunho(s) já na lista de aprovação.`;
                        bulkJob.finishedAt = Date.now();
                        break;
                    }
                }

                bulkJob.wave = wave;
                const externalId = ids[i];
                const stored = chatDB.getCatalogProduct('bling', externalId);
                bulkJob.currentSku = stored?.sku || externalId;
                bulkJob.message = `Onda ${wave}/${wavesTotal} · SKU ${bulkJob.currentSku} (${bulkJob.done + 1}/${bulkJob.total})…`;

                // Se Gemini estourou cota, espera 65s uma vez antes de continuar
                if (isGeminiQuotaBlocked() && !isOpenAiQuotaBlocked()) {
                    const waitMs = Math.max(0, 65000);
                    bulkJob.message = `Cota Gemini — aguardando ${Math.round(waitMs / 1000)}s…`;
                    await sleep(waitMs);
                }

                try {
                    const result = await suggestCatalogProductFields(externalId, {
                        fields,
                        provider: opts.provider,
                        saveDraft: true,
                    });
                    bulkJob.ok += 1;
                    if (result.heuristic) bulkJob.heuristic = (bulkJob.heuristic || 0) + 1;
                } catch (err) {
                    bulkJob.failed += 1;
                    bulkJob.errors.push({
                        externalId,
                        sku: stored?.sku || '',
                        error: err?.message || String(err),
                    });
                    logger.warn('Bulk AI suggest falhou', externalId, err?.message || err);
                }
                bulkJob.done += 1;
                // Delay dentro da onda (exceto último item do job)
                if (bulkJob.done < bulkJob.total && (i + 1) % BULK_WAVE !== 0) {
                    await sleep(BULK_DELAY_MS);
                }
            }

            if (bulkJob.status === 'running') {
                bulkJob.status = 'done';
                bulkJob.finishedAt = Date.now();
                bulkJob.currentSku = undefined;
                const heur = bulkJob.heuristic || 0;
                bulkJob.message = `Rascunhos: ${bulkJob.ok} ok`
                    + (heur ? ` (${heur} por padrão/sem cota IA)` : '')
                    + ` · ${bulkJob.failed} falha(s) de ${bulkJob.total}`
                    + (wavesTotal > 1 ? ` em ${wavesTotal} ondas` : '')
                    + '. Revise e só então aplique no Bling.';
                logAudit({
                    actor: opts.actor,
                    action: 'catalog_ai_suggest_bulk',
                    targetType: 'catalog',
                    targetId: id,
                    summary: bulkJob.message,
                    meta: {
                        ok: bulkJob.ok,
                        failed: bulkJob.failed,
                        total: bulkJob.total,
                        heuristic: heur,
                        waves: wavesTotal,
                    },
                });
            }
        } catch (err) {
            logger.error('Bulk AI suggest crashed', err?.message || err);
            bulkJob.status = 'failed';
            bulkJob.finishedAt = Date.now();
            bulkJob.message = err?.message || String(err);
        } finally {
            bulkCancel = false;
        }
    })();

    return { alreadyRunning: false, job: getBulkCatalogAiSuggestJob() };
}

export function listCatalogAiDrafts(opts = {}) {
    return {
        drafts: chatDB.listCatalogAiDrafts(opts),
        pending: chatDB.countCatalogAiDrafts('pending'),
    };
}

export function updateCatalogAiDraftFields(draftId, edited) {
    const draft = chatDB.getCatalogAiDraft(draftId);
    if (!draft) {
        const err = new Error('Rascunho não encontrado.');
        err.status = 404;
        throw err;
    }
    if (draft.status !== 'pending') {
        throw new Error('Só é possível editar rascunhos pendentes.');
    }
    const merged = {
        ncm: edited?.ncm !== undefined ? cleanNcm(edited.ncm) : (draft.edited?.ncm ?? draft.suggested?.ncm ?? null),
        weight: edited?.weight !== undefined
            ? numOrNull(edited.weight, { min: 0.001, max: 5 })
            : (draft.edited?.weight ?? draft.suggested?.weight ?? null),
        height: edited?.height !== undefined
            ? numOrNull(edited.height, { min: 0.1, max: 200 })
            : (draft.edited?.height ?? draft.suggested?.height ?? null),
        width: edited?.width !== undefined
            ? numOrNull(edited.width, { min: 0.1, max: 200 })
            : (draft.edited?.width ?? draft.suggested?.width ?? null),
        length: edited?.length !== undefined
            ? numOrNull(edited.length, { min: 0.1, max: 200 })
            : (draft.edited?.length ?? draft.suggested?.length ?? null),
        brand: edited?.brand !== undefined
            ? (String(edited.brand || '').trim() || defaultCatalogBrand())
            : (draft.edited?.brand ?? draft.suggested?.brand ?? defaultCatalogBrand()),
        focusKeyword: edited?.focusKeyword !== undefined
            ? cleanSeoText(edited.focusKeyword, { max: 80 })
            : (draft.edited?.focusKeyword ?? draft.suggested?.focusKeyword ?? null),
        shortDescription: edited?.shortDescription !== undefined
            ? (cleanSeoText(edited.shortDescription, { max: 200 }) || cleanText(edited.shortDescription, 200))
            : (draft.edited?.shortDescription ?? draft.suggested?.shortDescription ?? null),
        description: edited?.description !== undefined
            ? (cleanLongDescription(edited.description, 12000) || cleanText(edited.description, 12000))
            : (draft.edited?.description ?? draft.suggested?.description ?? null),
        seoTitle: edited?.seoTitle !== undefined
            ? cleanSeoText(edited.seoTitle, { max: 60 })
            : (draft.edited?.seoTitle ?? draft.suggested?.seoTitle ?? null),
        seoDescription: edited?.seoDescription !== undefined
            ? cleanSeoText(edited.seoDescription, { max: 160 })
            : (draft.edited?.seoDescription ?? draft.suggested?.seoDescription ?? null),
        rationale: edited?.rationale !== undefined
            ? String(edited.rationale || '').slice(0, 280)
            : (draft.edited?.rationale || draft.suggested?.rationale || ''),
    };
    if (!merged.focusKeyword && (merged.seoTitle || merged.description)) {
        merged.focusKeyword = deriveFocusKeyword(draft.name, merged.brand);
    }
    return chatDB.updateCatalogAiDraft(draftId, { edited: merged });
}

export function discardCatalogAiDraft(draftId) {
    const draft = chatDB.discardCatalogAiDraft(draftId);
    if (!draft) {
        const err = new Error('Rascunho não encontrado.');
        err.status = 404;
        throw err;
    }
    return draft;
}

export function discardCatalogAiDraftsBulk(draftIds = [], opts = {}) {
    const ids = [...new Set((Array.isArray(draftIds) ? draftIds : []).map(String).filter(Boolean))]
        .slice(0, APPLY_BULK_MAX);
    if (!ids.length) {
        throw new Error('Selecione ao menos um rascunho.');
    }
    const result = chatDB.discardCatalogAiDraftsBulk(ids);
    logAudit({
        actor: opts.actor,
        action: 'catalog_ai_draft_discard_bulk',
        targetType: 'catalog',
        targetId: 'bulk',
        summary: `Descartou ${result.discarded}/${result.total} rascunhos IA`,
        meta: result,
    });
    return result;
}

function draftToPatch(draft) {
    const src = draft.edited || draft.suggested || {};
    const patch = {};
    if (src.ncm) patch.ncm = src.ncm;
    if (src.weight != null) patch.weight = src.weight;
    if (src.height != null) patch.height = src.height;
    if (src.width != null) patch.width = src.width;
    if (src.length != null) patch.length = src.length;
    // Sempre envia marca (padrão da loja se o rascunho antigo não tiver)
    patch.brand = String(src.brand || '').trim() || defaultCatalogBrand();
    if (src.focusKeyword) patch.focusKeyword = src.focusKeyword;
    else if (src.seoTitle || src.description) {
        patch.focusKeyword = deriveFocusKeyword(draft.name, patch.brand);
    }
    if (src.shortDescription) patch.shortDescription = src.shortDescription;
    if (src.description) patch.description = src.description;
    // Rank Math: Bling não tem meta SEO — grava no snapshot local.
    // Woo NÃO é atualizado daqui (sync só via Bling, para não gerar duplicata).
    if (src.seoTitle) patch.seoTitle = src.seoTitle;
    if (src.seoDescription) patch.seoDescription = src.seoDescription;
    if (!Object.keys(patch).length) {
        throw new Error('Rascunho sem campos úteis para aplicar.');
    }
    return patch;
}

/**
 * Aplica um rascunho no Bling (após conferência do usuário).
 */
export async function applyCatalogAiDraft(draftId, opts = {}) {
    const draft = chatDB.getCatalogAiDraft(draftId);
    if (!draft) {
        const err = new Error('Rascunho não encontrado.');
        err.status = 404;
        throw err;
    }
    if (draft.status !== 'pending') {
        throw new Error('Este rascunho já foi aplicado ou descartado.');
    }
    if (opts.edited) {
        updateCatalogAiDraftFields(draftId, opts.edited);
    }
    const fresh = chatDB.getCatalogAiDraft(draftId);
    const patch = draftToPatch(fresh);
    const result = await applyFix(fresh.externalId, patch, { actor: opts.actor });
    chatDB.updateCatalogAiDraft(draftId, { status: 'applied' });
    return {
        draft: chatDB.getCatalogAiDraft(draftId),
        ...result,
    };
}

/**
 * Aplica vários rascunhos (só os confirmados).
 */
export async function applyCatalogAiDraftsBulk(draftIds = [], opts = {}) {
    const ids = [...new Set((Array.isArray(draftIds) ? draftIds : []).map(String).filter(Boolean))]
        .slice(0, APPLY_BULK_MAX);
    const out = { total: ids.length, ok: 0, failed: 0, errors: [], results: [] };
    for (const id of ids) {
        try {
            const res = await applyCatalogAiDraft(id, { actor: opts.actor });
            out.ok += 1;
            out.results.push({ id, externalId: res.draft?.externalId, ok: true });
        } catch (err) {
            out.failed += 1;
            out.errors.push({ id, error: err?.message || String(err) });
            try {
                chatDB.updateCatalogAiDraft(id, { error: err?.message || String(err) });
            } catch {
                /* ignore */
            }
        }
        await sleep(350);
    }
    logAudit({
        actor: opts.actor,
        action: 'catalog_ai_draft_apply_bulk',
        targetType: 'catalog',
        targetId: 'bulk',
        summary: `Aplicou ${out.ok}/${out.total} rascunhos IA no Bling`,
        meta: { ok: out.ok, failed: out.failed },
    });
    return out;
}

export default {
    suggestCatalogProductFields,
    startBulkCatalogAiSuggest,
    getBulkCatalogAiSuggestJob,
    cancelBulkCatalogAiSuggest,
    listCatalogAiDrafts,
    updateCatalogAiDraftFields,
    discardCatalogAiDraft,
    discardCatalogAiDraftsBulk,
    applyCatalogAiDraft,
    applyCatalogAiDraftsBulk,
};
