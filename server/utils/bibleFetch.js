/**
 * Busca texto bíblico em português (bolls.life — tradução ARA por padrão).
 *
 * Env opcional:
 *   BIBLE_TRANSLATION=ARA
 *   BIBLE_API_TOKEN=   # reservado para abibliadigital, se necessário no futuro
 */

import logger from './logger.js';

const DEFAULT_TRANSLATION = process.env.BIBLE_TRANSLATION || 'ARA';

async function fetchFromBolls(bookNumber, chapter, verse) {
    const translation = DEFAULT_TRANSLATION;
    const url = `https://bolls.life/get-verse/${encodeURIComponent(translation)}/${bookNumber}/${chapter}/${verse}/`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) {
        throw new Error(`Bíblia API HTTP ${res.status}`);
    }
    const data = await res.json().catch(() => null);
    const text = data?.text?.trim();
    if (!text || /not found/i.test(text)) {
        throw new Error('Versículo não encontrado na tradução configurada.');
    }
    return text;
}

/**
 * @param {{ bookNumber: number, chapter: number, verse: number }} ref
 */
export async function fetchVerseText(ref) {
    try {
        const text = await fetchFromBolls(ref.bookNumber, ref.chapter, ref.verse);
        return { text, source: `bolls.life/${DEFAULT_TRANSLATION}` };
    } catch (err) {
        logger.warn(`Bible fetch falhou (${ref.bookNumber}:${ref.chapter}:${ref.verse}):`, err?.message || err);
        throw new Error('Não foi possível buscar o versículo. Verifique a referência e tente novamente.');
    }
}

export default { fetchVerseText };
