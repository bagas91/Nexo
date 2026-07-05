/**
 * Livros da Bíblia — nomes em português/inglês → abreviação e número (ordem protestante 1–66).
 */

const BOOKS = [
    { abbrev: 'gn', number: 1, names: ['genesis', 'gênesis', 'geneses', 'gn'] },
    { abbrev: 'ex', number: 2, names: ['exodo', 'êxodo', 'ex'] },
    { abbrev: 'lv', number: 3, names: ['levitico', 'levítico', 'lv'] },
    { abbrev: 'nm', number: 4, names: ['numeros', 'números', 'nm'] },
    { abbrev: 'dt', number: 5, names: ['deuteronomio', 'deuteronômio', 'dt'] },
    { abbrev: 'js', number: 6, names: ['josue', 'josué', 'js'] },
    { abbrev: 'jz', number: 7, names: ['juizes', 'juízes', 'jz'] },
    { abbrev: 'rt', number: 8, names: ['rute', 'rt'] },
    { abbrev: '1sm', number: 9, names: ['1 samuel', '1samuel', '1sm'] },
    { abbrev: '2sm', number: 10, names: ['2 samuel', '2samuel', '2sm'] },
    { abbrev: '1rs', number: 11, names: ['1 reis', '1reis', '1rs'] },
    { abbrev: '2rs', number: 12, names: ['2 reis', '2reis', '2rs'] },
    { abbrev: '1cr', number: 13, names: ['1 cronicas', '1 crônicas', '1cronicas', '1cr'] },
    { abbrev: '2cr', number: 14, names: ['2 cronicas', '2 crônicas', '2cronicas', '2cr'] },
    { abbrev: 'ed', number: 15, names: ['esdras', 'ed'] },
    { abbrev: 'ne', number: 16, names: ['neemias', 'ne'] },
    { abbrev: 'et', number: 17, names: ['ester', 'et'] },
    { abbrev: 'job', number: 18, names: ['jo', 'job', 'jó'] },
    { abbrev: 'sl', number: 19, names: ['salmos', 'salmo', 'sl', 'ps', 'psalm', 'psalms'] },
    { abbrev: 'pv', number: 20, names: ['proverbios', 'provérbios', 'pv'] },
    { abbrev: 'ec', number: 21, names: ['eclesiastes', 'ec'] },
    { abbrev: 'ct', number: 22, names: ['cantares', 'canticos', 'cânticos', 'ct'] },
    { abbrev: 'is', number: 23, names: ['isaias', 'isaías', 'is'] },
    { abbrev: 'jr', number: 24, names: ['jeremias', 'jr'] },
    { abbrev: 'lm', number: 25, names: ['lamentacoes', 'lamentações', 'lm'] },
    { abbrev: 'ez', number: 26, names: ['ezequiel', 'ez'] },
    { abbrev: 'dn', number: 27, names: ['daniel', 'dn'] },
    { abbrev: 'os', number: 28, names: ['oseias', 'oséias', 'os'] },
    { abbrev: 'jl', number: 29, names: ['joel', 'jl'] },
    { abbrev: 'am', number: 30, names: ['amos', 'amós', 'am'] },
    { abbrev: 'ob', number: 31, names: ['obadias', 'ob'] },
    { abbrev: 'jn', number: 32, names: ['jonas', 'jn'] },
    { abbrev: 'mq', number: 33, names: ['miqueias', 'miquéias', 'mq'] },
    { abbrev: 'na', number: 34, names: ['naum', 'na'] },
    { abbrev: 'hc', number: 35, names: ['habacuque', 'hc'] },
    { abbrev: 'sf', number: 36, names: ['sofonias', 'sofônias', 'sf'] },
    { abbrev: 'ag', number: 37, names: ['ageu', 'ag'] },
    { abbrev: 'zc', number: 38, names: ['zacarias', 'zc'] },
    { abbrev: 'ml', number: 39, names: ['malaquias', 'malaquias', 'ml'] },
    { abbrev: 'mt', number: 40, names: ['mateus', 'mt'] },
    { abbrev: 'mc', number: 41, names: ['marcos', 'mc'] },
    { abbrev: 'lc', number: 42, names: ['lucas', 'lc'] },
    { abbrev: 'jo', number: 43, names: ['joao', 'joão', 'john'] },
    { abbrev: 'at', number: 44, names: ['atos', 'at'] },
    { abbrev: 'rm', number: 45, names: ['romanos', 'rm'] },
    { abbrev: '1co', number: 46, names: ['1 corintios', '1corintios', '1co'] },
    { abbrev: '2co', number: 47, names: ['2 corintios', '2corintios', '2co'] },
    { abbrev: 'gl', number: 48, names: ['galatas', 'gálatas', 'gl'] },
    { abbrev: 'ef', number: 49, names: ['efesios', 'efésios', 'ef'] },
    { abbrev: 'fp', number: 50, names: ['filipenses', 'fp'] },
    { abbrev: 'cl', number: 51, names: ['colossenses', 'cl'] },
    { abbrev: '1ts', number: 52, names: ['1 tessalonicenses', '1tessalonicenses', '1ts'] },
    { abbrev: '2ts', number: 53, names: ['2 tessalonicenses', '2tessalonicenses', '2ts'] },
    { abbrev: '1tm', number: 54, names: ['1 timoteo', '1 timóteo', '1timoteo', '1tm'] },
    { abbrev: '2tm', number: 55, names: ['2 timoteo', '2 timóteo', '2timoteo', '2tm'] },
    { abbrev: 'tt', number: 56, names: ['tito', 'tt'] },
    { abbrev: 'fm', number: 57, names: ['filemom', 'fm'] },
    { abbrev: 'hb', number: 58, names: ['hebreus', 'hb'] },
    { abbrev: 'tg', number: 59, names: ['tiago', 'tg'] },
    { abbrev: '1pe', number: 60, names: ['1 pedro', '1pedro', '1pe'] },
    { abbrev: '2pe', number: 61, names: ['2 pedro', '2pedro', '2pe'] },
    { abbrev: '1jo', number: 62, names: ['1 joao', '1 joão', '1joao', '1jo'] },
    { abbrev: '2jo', number: 63, names: ['2 joao', '2 joão', '2joao', '2jo'] },
    { abbrev: '3jo', number: 64, names: ['3 joao', '3 joão', '3joao', '3jo'] },
    { abbrev: 'jd', number: 65, names: ['judas', 'jd'] },
    { abbrev: 'ap', number: 66, names: ['apocalipse', 'revelacao', 'revelação', 'ap'] }
];

const DISPLAY_NAMES = {
    gn: 'Gênesis', ex: 'Êxodo', lv: 'Levítico', nm: 'Números', dt: 'Deuteronômio',
    js: 'Josué', jz: 'Juízes', rt: 'Rute', '1sm': '1 Samuel', '2sm': '2 Samuel',
    '1rs': '1 Reis', '2rs': '2 Reis', '1cr': '1 Crônicas', '2cr': '2 Crônicas',
    ed: 'Esdras', ne: 'Neemias', et: 'Ester', job: 'Jó', sl: 'Salmos', pv: 'Provérbios',
    ec: 'Eclesiastes', ct: 'Cantares', is: 'Isaías', jr: 'Jeremias', lm: 'Lamentações',
    ez: 'Ezequiel', dn: 'Daniel', os: 'Oséias', jl: 'Joel', am: 'Amós', ob: 'Obadias',
    jn: 'Jonas', mq: 'Miquéias', na: 'Naum', hc: 'Habacuque', sf: 'Sofonias', ag: 'Ageu',
    zc: 'Zacarias', ml: 'Malaquias', mt: 'Mateus', mc: 'Marcos', lc: 'Lucas', jo: 'João',
    at: 'Atos', rm: 'Romanos', '1co': '1 Coríntios', '2co': '2 Coríntios', gl: 'Gálatas',
    ef: 'Efésios', fp: 'Filipenses', cl: 'Colossenses', '1ts': '1 Tessalonicenses',
    '2ts': '2 Tessalonicenses', '1tm': '1 Timóteo', '2tm': '2 Timóteo', tt: 'Tito',
    fm: 'Filemom', hb: 'Hebreus', tg: 'Tiago', '1pe': '1 Pedro', '2pe': '2 Pedro',
    '1jo': '1 João', '2jo': '2 João', '3jo': '3 João', jd: 'Judas', ap: 'Apocalipse'
};

const NAME_INDEX = new Map();
const FUZZY_CANDIDATES = [];

for (const book of BOOKS) {
    const display = DISPLAY_NAMES[book.abbrev];
    FUZZY_CANDIDATES.push({ book, label: normalizeKey(display), display });
    for (const name of book.names) {
        NAME_INDEX.set(normalizeKey(name), book);
        FUZZY_CANDIDATES.push({ book, label: normalizeKey(name), display });
    }
}

function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        }
    }
    return dp[m][n];
}

function findBook(rawBookName) {
    const key = normalizeKey(rawBookName);
    const exact = NAME_INDEX.get(key);
    if (exact) return { book: exact, corrected: false };

    let best = null;
    let bestDist = Infinity;
    for (const candidate of FUZZY_CANDIDATES) {
        const dist = levenshtein(key, candidate.label);
        const maxLen = Math.max(key.length, candidate.label.length);
        const threshold = maxLen <= 4 ? 1 : maxLen <= 8 ? 2 : 3;
        if (dist <= threshold && dist < bestDist) {
            bestDist = dist;
            best = candidate;
        }
    }

    if (best && bestDist > 0) {
        return { book: best.book, corrected: true, correctedDisplay: best.display };
    }
    if (best && bestDist === 0) {
        return { book: best.book, corrected: false };
    }

    const suggestions = FUZZY_CANDIDATES
        .map((c) => ({ display: c.display, dist: levenshtein(key, c.label) }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 3)
        .map((s) => s.display)
        .filter((v, i, arr) => arr.indexOf(v) === i);

    const hint = suggestions.length ? ` Você quis dizer: ${suggestions.join(', ')}?` : '';
    throw new Error(`Livro não reconhecido: "${String(rawBookName).trim()}".${hint}`);
}

function parseReferenceParts(input) {
    const trimmed = String(input || '').trim();
    const patterns = [
        /^(.+?)\s+(\d+)\s*:\s*(\d+)\s*$/i,
        /^(.+?)\s+(\d+)\s+(\d+)\s*$/i,
        /^(.+?)\s+(\d+)\s*[,\-/]\s*(\d+)\s*$/i
    ];
    for (const pattern of patterns) {
        const match = trimmed.match(pattern);
        if (match) {
            return { bookPart: match[1].trim(), chapter: Number(match[2]), verse: Number(match[3]) };
        }
    }
    throw new Error(
        'Não entendi a referência. Ex.: Gênesis 10:30, Jeremias 32:36 ou Salmos 23 1 (typos como "Jenesis" também funcionam).'
    );
}

function normalizeKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ');
}

/**
 * @param {string} raw — ex.: "genesis 10:30", "Jeremias 32:36", "sl 23:1"
 */
export function parseBibleReference(raw) {
    const input = String(raw || '').trim();
    if (!input) throw new Error('Informe a referência bíblica (ex.: Gênesis 10:30).');

    const { bookPart, chapter, verse } = parseReferenceParts(input);
    const { book, corrected, correctedDisplay } = findBook(bookPart);

    if (!Number.isFinite(chapter) || chapter < 1 || !Number.isFinite(verse) || verse < 1) {
        throw new Error('Capítulo e versículo devem ser números positivos.');
    }

    const displayName = correctedDisplay || DISPLAY_NAMES[book.abbrev] || bookPart;
    const referenceFormatted = `${displayName} ${chapter}:${verse}`;
    const originalBook = bookPart.trim();

    return {
        abbrev: book.abbrev,
        bookNumber: book.number,
        displayName,
        chapter,
        verse,
        referenceFormatted,
        prayerTitle: `ORAÇÃO DE ${displayName.toUpperCase()}`,
        correctedFrom: corrected ? `${originalBook} ${chapter}:${verse}` : null,
        inputRaw: input
    };
}

export function getBookDisplayName(abbrev) {
    return DISPLAY_NAMES[abbrev] || abbrev;
}

export default { parseBibleReference, getBookDisplayName };
