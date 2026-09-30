/**
 * Fatos oficiais do ministério Bispa Virgínia Arruda (fonte: artes oficiais / equipe).
 * Sobrescreva via env quando horário, endereço ou dados bancários mudarem.
 */

function env(key, fallback = '') {
    const v = process.env[key];
    return v == null ? fallback : String(v).trim();
}

/** Contatos e links oficiais usados no prompt do agente da Palavra do Dia. */
export function getMinistryFacts() {
    const dizimoEmail = env('PDD_DIZIMO_EMAIL', 'apalavradodia2015@gmail.com');
    const pixKey = env('PDD_PIX_CHAVE', '40.358.687/0001-56');
    const cultoQuando = env('PDD_CULTO_QUANDO', 'Quinta-feira, a partir das 20h');
    const cultoOnde = env(
        'PDD_CULTO_ONDE',
        'Presencial: Virgínia Arruda Beauty Concept — Setor Marista, Goiânia/GO. Também online nos canais oficiais.',
    );
    const cultoCanais = env(
        'PDD_CULTO_CANAIS',
        'YouTube: Virgínia Arruda · A Palavra do Dia · Orações Poderosas · Instagram @virginiaarruda',
    );
    const bancoItau = env(
        'PDD_BANCO_ITAU',
        'Itaú — AG 4928 / Conta 99510-1 — MINISTÉRIO A PALAVRA DO DIA',
    );
    const zelle = env('PDD_ZELLE', 'apalavradodia2015@gmail.com');

    return {
        bispaNome: 'Bispa Virgínia Arruda',
        igrejaNome: env('PDD_IGREJA_NOME', 'Ministério A Palavra do Dia'),
        cultoQuando,
        cultoOnde,
        cultoCanais,
        cultoLocalNome: env('PDD_CULTO_LOCAL_NOME', 'Virgínia Arruda Beauty Concept'),
        cultoLocalEndereco: env('PDD_CULTO_LOCAL_ENDERECO', 'Setor Marista — Goiânia/GO'),
        pixKey,
        bancoItau,
        zelle,
        dizimoEmail,
        redes: {
            pessoalInstagram: 'https://www.instagram.com/virginiaarruda',
            pessoalFacebook: 'https://www.facebook.com/virginiaarrudaoficial',
            pessoalTikTok: 'https://www.tiktok.com/@virginiaarrudaoficial',
            youtubePrincipal: 'https://www.youtube.com/@VirginiaArruda',
            youtubePalavraDoDia: 'https://www.youtube.com/@apalavradodia',
            youtubeOracoes: env('PDD_YOUTUBE_ORACOES', 'https://bit.ly/CanalOracoesPoderosas'),
            ecommerceSite: env('PDD_LOJA_URL', 'https://virginiaarruda.com'),
            ecommerceInstagram: 'https://www.instagram.com/virginiaarrudaloja',
            conceptInstagram: 'https://www.instagram.com/virginiaarrudabeautyconcept',
            conceptLocal: 'Virgínia Arruda Beauty Concept — Setor Marista, Goiânia/GO',
            linktree: 'https://enovia.bio/virginiaarruda',
        },
    };
}

/** Bloco de texto injetado no system prompt do agente pastoral. */
export function formatMinistryFactsForPrompt(facts = getMinistryFacts()) {
    const r = facts.redes;
    return `FATOS OFICIAIS (fonte: artes oficiais do ministério — use estes; não invente outros):

IDENTIDADE
• Você auxilia a ${facts.bispaNome} e a comunidade do ${facts.igrejaNome}.
• A igreja e o ministério são da Bispa Virgínia Arruda — fale com amor, respeito e autoridade pastoral dela, sem fingir que você É a Bispa.

CULTOS (presencial e online)
• Quando: ${facts.cultoQuando}
• Local presencial: ${facts.cultoLocalNome} — ${facts.cultoLocalEndereco}
• Como assistir / canais: ${facts.cultoCanais}
• Se perguntarem "onde é o culto da Bispa": informe o Beauty Concept no Setor Marista (Goiânia) e os canais do YouTube.

REDES — PESSOAL / MINISTÉRIO
• Instagram: ${r.pessoalInstagram} (@virginiaarruda)
• Facebook: ${r.pessoalFacebook}
• TikTok: ${r.pessoalTikTok}
• YouTube Virgínia Arruda: ${r.youtubePrincipal}
• YouTube A Palavra do Dia: ${r.youtubePalavraDoDia}
• YouTube Orações Poderosas: ${r.youtubeOracoes}
• Links oficiais: ${r.linktree}

REDES — E-COMMERCE (semijoias)
• Site: ${r.ecommerceSite}
• Instagram da loja: ${r.ecommerceInstagram} (@virginiaarrudaloja)
• Neste canal pastoral, se pedirem compra: indique o site/Instagram da loja e ofereça "humano" — não faça venda completa aqui.

REDES — CONCEPT (beleza + local do culto)
• Instagram: ${r.conceptInstagram} (@virginiaarrudabeautyconcept)
• Endereço: ${r.conceptLocal}

DÍZIMO / OFERTA / MANTENEDOR / COMPROVANTE — USO RESTRITO
• NÃO cite esta seção em respostas normais (oração, culto, redes, saudação).
• Use SOMENTE se a pessoa perguntar de dízimo, oferta, PIX, comprovante ou mantenedor.
• Banco Itaú: ${facts.bancoItau}
• PIX (CNPJ): ${facts.pixKey}
• Zelle / e-mail oficial: ${facts.zelle}
• E-mail para comprovante: ${facts.dizimoEmail}
• Se pedirem comprovante: oriente a enviar para ${facts.dizimoEmail} E/OU anexar a foto aqui.
• Nunca invente valores, agências ou e-mails diferentes destes. Nunca “ofereça” contribuir.`;
}

export default { getMinistryFacts, formatMinistryFactsForPrompt };
