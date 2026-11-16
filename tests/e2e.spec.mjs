// Teste e2e (Playwright). Uso: node tests/e2e.spec.mjs   (sai 0 se tudo passar, 1 se falhar)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = 8765, BASE = `http://localhost:${PORTA}/index.html`;
const CAPTURAS = path.join(RAIZ, '.capturas');
mkdirSync(CAPTURAS, { recursive: true });

let falhas = 0;
const ok = (c, msg) => { if (c) console.log('  ok   ' + msg); else { falhas++; console.log('  FALHA ' + msg); } };

const srv = spawn(process.platform === 'win32' ? 'py' : 'python3', [...(process.platform === 'win32' ? ['-3'] : []), '-m', 'http.server', String(PORTA), '--bind', '127.0.0.1'], { cwd: RAIZ, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));

const browser = await chromium.launch();
// Os RGMs de teste 000000 e 111111 saíram de data/alunos.json (o site não os aceita; só valem os dos alunos e o do professor).
// O teste os acrescenta só no navegador dele, interceptando o alunos.json servido.
const TESTE = { '000000': ['13735', '13744', '14720', '14723', '14733', '14814', '14816'], '111111': ['14733'] };
const hashRgm = (sal, rgm) => createHash('sha256').update(`${sal}:${rgm}`).digest('hex');
async function comTeste(ctx) {
  await ctx.route('**/data/alunos.json', async route => {
    const resp = await route.fetch(); const j = await resp.json();
    for (const [rgm, cods] of Object.entries(TESTE)) j.alunos[hashRgm(j.sal, rgm)] = cods;
    await route.fulfill({ response: resp, json: j });
  });
  return ctx;
}
const novoCtx = async () => comTeste(await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: 'light' }));
const semRolagem = async (page, onde) => {
  const r = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  ok(r[0] <= r[1], `sem rolagem horizontal em ${onde} (${r[0]} <= ${r[1]})`);
};
async function entrar(page, rgm) {
  await page.goto(BASE);
  await page.fill('#rgm', rgm);
  await page.click('button[type=submit]');
}
// toda página criada falha o teste se der erro de JavaScript
async function novaPagina(ctx) {
  const p = await ctx.newPage();
  p.on('pageerror', e => { falhas++; console.log('  FALHA erro de página: ' + e.message); });
  return p;
}
const CHAVE = 'estuda-odonto-v1';
const topicoJson = slug => JSON.parse(readFileSync(path.join(RAIZ, 'data', '14733', 'topicos', slug + '.json'), 'utf8'));
const lerEstado = page => page.evaluate(k => JSON.parse(localStorage.getItem(k) || '{}'), CHAVE);
// mantém só o RGM e põe no lugar o estado montado pelo teste
const injetar = (page, ext) => page.evaluate(([k, ext]) => {
  const e = JSON.parse(localStorage.getItem(k) || '{}'); const novo = { rgm: e.rgm };
  localStorage.setItem(k, JSON.stringify(Object.assign(novo, ext)));
}, [CHAVE, ext]);
async function abrirDisciplina(page) {
  await page.goto(BASE + '#d-14733');
  await page.reload();
  await page.waitForSelector('.area');
}
// responde o quiz que está na tela até o placar; certaFn(i, questão) diz se a resposta é a correta
async function responderQuiz(page, certaFn) {
  let i = 0;
  for (;;) {
    await page.waitForSelector('.alt, [data-placar]');
    if (await page.locator('[data-placar]').count()) return i;
    const enun = (await page.textContent('.enunciado')).trim();
    const qj = questoesDe(page.__slug).find(x => x.enunciado.trim() === enun);
    const alvo = qj.alternativas.find(x => !!x.correta === certaFn(i, qj));
    await page.locator('.alt', { hasText: alvo.texto }).first().click();
    await page.waitForSelector('.feedback');
    await page.click('[data-acao=proxima]');
    i++;
  }
}
const questoesDe = slug => topicoJson(slug).questoes;
async function abrirQuiz(page, slug) {
  page.__slug = slug;
  await page.click(`[data-topico="${slug}"] a`);
  await page.waitForSelector('.aba');
  await page.click('[data-aba=quiz]');
}
const TJ = JSON.parse(readFileSync(path.join(RAIZ, 'data', '14733', 'topicos.json'), 'utf8')).topicos;
const COM_CONTEUDO = TJ.filter(t => t.status !== 'em-breve');
const isoDias = (dias, h = 12) => new Date(2026, 9, 1 + dias, h, 0, 0).toISOString();

try {
  // 0
  console.log('0. Sem RGM de teste nos dados publicados');
  const reais = JSON.parse(readFileSync(path.join(RAIZ, 'data', 'alunos.json'), 'utf8'));
  for (const rgm of ['000000', '111111', '999999']) ok(!(hashRgm(reais.sal, rgm) in reais.alunos), `${rgm} não entra no site`);

  // 1
  console.log('1. RGM inexistente');
  let ctx = await novoCtx(), page = await novaPagina(ctx);
  await entrar(page, '999999');
  await page.waitForSelector('#msg-erro:not(:empty)');
  ok((await page.textContent('#msg-erro')).startsWith('RGM não encontrado nas turmas do Prof. Pedro neste semestre.'), 'mensagem de não encontrado');
  ok(page.url().endsWith('#entrada') || !page.url().includes('#minhas'), 'permanece na entrada');
  await page.screenshot({ path: `${CAPTURAS}/entrada.png` });
  await semRolagem(page, 'entrada');
  await ctx.close();

  // 2
  console.log('2. RGM 111111');
  ctx = await novoCtx(); page = await novaPagina(ctx);
  await entrar(page, '111111');
  await page.waitForSelector('[data-disc]');
  ok(await page.locator('[data-disc]').count() === 1, 'uma disciplina');
  ok((await page.locator('[data-disc]').first().textContent()).includes('COI II'), 'é COI II');
  ok(await page.locator('[data-disc="14733"]').count() === 1, 'código 14733');
  ok(!(await page.textContent('main')).includes('Cirurgia Bucal'), 'nenhuma outra disciplina listada');
  ok((await page.textContent('main')).includes('faltam'), 'contagem de dias da prova');
  await page.screenshot({ path: `${CAPTURAS}/minhas.png` });
  await semRolagem(page, 'minhas');

  // 4
  console.log('4. Fluxo de estudo');
  await page.click('[data-disc="14733"]');
  await page.waitForSelector('[data-topico="periodontite-estagio-grau"]');
  ok((await page.textContent('main')).includes('Periodontite: estágio, grau e extensão'), 'tópico listado');
  ok(await page.locator('[data-desempenho]').count() === 0, 'sem resposta nenhuma, a disciplina não tem painel de desempenho');
  const emBreve = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', '14733', 'topicos.json'), 'utf8')).topicos.filter(t => t.status === 'em-breve').length;
  ok(emBreve >= 1 && await page.locator('[data-topico][aria-disabled=true]').count() === emBreve, 'tópicos em breve desabilitados (' + emBreve + ')');
  ok(await page.locator('[data-errei="periodontite-estagio-grau"]').isDisabled(), '"Estudar o que errei" desabilitado sem respostas');
  await page.screenshot({ path: `${CAPTURAS}/disciplina.png` });
  await semRolagem(page, 'disciplina');
  await page.click('[data-topico="periodontite-estagio-grau"] a');
  await page.waitForSelector('.aba');
  await page.click('[data-aba=resumo]');
  const nsec = await page.locator('.secao').count();
  ok(nsec >= 5, `resumo com ${nsec} seções`);
  ok(await page.locator('.secao table').count() >= 2, 'resumo com tabelas');
  await semRolagem(page, 'resumo');
  await page.screenshot({ path: `${CAPTURAS}/resumo.png` });
  await page.locator('.secao[data-secao=estagios]').screenshot({ path: `${CAPTURAS}/resumo-tabela.png` });

  await page.click('[data-aba=flashcards]');
  await page.waitForSelector('.flash');
  const nFc = JSON.parse(readFileSync(path.join(RAIZ, 'data', '14733', 'topicos', 'periodontite-estagio-grau.json'), 'utf8')).flashcards.length;
  ok((await page.textContent('[data-contador]')) === `1 de ${nFc}`, `contador 1 de ${nFc}`);
  await page.click('.flash');
  ok(await page.locator('.flash[data-flash=verso]').count() === 1, 'cartão virou');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${CAPTURAS}/flashcard.png` });
  await semRolagem(page, 'flashcards');
  await page.click('[data-acao=acertei]');
  ok((await page.textContent('[data-contador]')) === `2 de ${nFc}`, `avançou para 2 de ${nFc}`);
  await page.click('.flash'); await page.click('[data-acao=acertei]');
  ok((await page.textContent('[data-contador]')) === `3 de ${nFc}`, `avançou para 3 de ${nFc}`);

  const questoesJson = JSON.parse(readFileSync(path.join(RAIZ, 'data', '14733', 'topicos', 'periodontite-estagio-grau.json'), 'utf8')).questoes;
  await page.click('[data-aba=quiz]');
  let temFonteAlt = false;
  for (let i = 0; i < 8; i++) {
    await page.waitForSelector('.alt');
    if (i === 0) await semRolagem(page, 'quiz');
    // feedback independe da ordem: pares clicam a correta, ímpares uma errada (localizadas pelo texto, vindo do JSON)
    const enun = (await page.textContent('.enunciado')).trim();
    const qj = questoesJson.find(x => x.enunciado.trim() === enun);
    ok(!!qj, `questão ${i + 1} localizada no JSON`);
    const queroCerta = i % 2 === 0;
    const alvo = qj.alternativas.find(x => !!x.correta === queroCerta);
    await page.locator('.alt', { hasText: alvo.texto }).first().click();
    await page.waitForSelector('.feedback');
    ok((await page.getAttribute('.feedback', 'data-feedback')) === (queroCerta ? 'certa' : 'errada'), `questão ${i + 1}: feedback ${queroCerta ? 'certa' : 'errada'} conforme a alternativa clicada`);
    ok(await page.locator('.just').count() === 4, `questão ${i + 1}: 4 justificativas`) ;
    const nFonteAlt = qj.alternativas.filter(x => x.fonte).length;
    if (nFonteAlt) { temFonteAlt = true; ok(await page.locator('.feedback .fonte-alt').count() === nFonteAlt, `questão ${i + 1}: ${nFonteAlt} span(s) .fonte-alt no feedback`); }
    if (i === 0) { await page.screenshot({ path: `${CAPTURAS}/quiz-feedback.png` }); await semRolagem(page, 'quiz-feedback'); }
    await page.click('[data-acao=proxima]');
  }
  if (!temFonteAlt) console.log('  sem fonte por alternativa neste tema');
  await page.waitForSelector('[data-placar]');
  ok(/Você acertou \d+ de 8/.test(await page.textContent('[data-placar]')), 'placar aparece: ' + (await page.textContent('[data-placar]')).trim());
  await page.screenshot({ path: `${CAPTURAS}/quiz-placar.png` });
  await semRolagem(page, 'placar');

  // 5
  console.log('5. Persistência após recarregar');
  await page.goto(BASE + '#d-14733');
  await page.reload();
  await page.waitForSelector('.prog-quiz');
  const pq = await page.textContent('[data-topico="periodontite-estagio-grau"] .prog-quiz'), pf = await page.textContent('[data-topico="periodontite-estagio-grau"] .prog-flash');
  ok(/Quiz: \d+\/8 acertos \(8 respondidas\)/.test(pq), 'progresso quiz: ' + pq);
  ok(new RegExp('Flashcards: 2/' + nFc + ' dominados').test(pf), 'progresso flashcards: ' + pf);
  ok(!(await page.locator('[data-errei="periodontite-estagio-grau"]').isDisabled()), '"Estudar o que errei" habilitado');
  await page.click('[data-errei="periodontite-estagio-grau"]');
  await page.waitForSelector('.alt');
  const total = await page.textContent('.contador');
  ok(/Questão 1 de \d+/.test(total) && !total.endsWith('de 8'), 'quiz filtrado: ' + total);
  // 6
  console.log('6. Figuras no resumo');
  // um tema só com fotos e um com fotos e esquema SVG
  for (const temaFig of ['dente-tratado-endodonticamente-como-restaurar', 'periodontite-estagio-grau']) {
    const figsJson = JSON.parse(readFileSync(path.join(RAIZ, 'data', '14733', 'topicos', temaFig + '.json'), 'utf8')).figuras;
    await page.goto(BASE + '#d-14733');
    await page.waitForSelector(`[data-topico="${temaFig}"] a`);
    await page.click(`[data-topico="${temaFig}"] a`);
    await page.waitForSelector('.aba');
    await page.click('[data-aba=resumo]');
    await page.waitForSelector('.figura img');
    const imgs = page.locator('.figura img');
    ok(figsJson.length >= 1 && await imgs.count() === figsJson.length, `${temaFig}: resumo com ${figsJson.length} figura(s)`);
    let carregadas = 0;
    for (let i = 0; i < await imgs.count(); i++) {
      await imgs.nth(i).scrollIntoViewIfNeeded();
      await page.waitForFunction(el => el.complete, await imgs.nth(i).elementHandle());
      if (await imgs.nth(i).evaluate(el => el.naturalWidth > 0)) carregadas++;
      await page.locator('.figura').nth(i).screenshot({ path: `${CAPTURAS}/figura-${temaFig.slice(0, 12)}-${i + 1}.png` });
    }
    ok(carregadas === figsJson.length, `${carregadas} figura(s) carregada(s)`);
    ok(await page.locator('.figura img:not([alt]), .figura img[alt=""]').count() === 0, 'toda figura tem alt');
    ok(await page.locator('.figura figcaption .credito').count() === figsJson.filter(f => f.credito).length, 'crédito nas figuras');
    await semRolagem(page, 'resumo com figuras');
  }


  // 7
  console.log('7. Painel de desempenho');
  const SLUG = 'periodontite-estagio-grau';
  const nTemas = COM_CONTEUDO.filter(t => existsSync(path.join(RAIZ, 'data', '14733', 'topicos', t.slug + '.json'))).length;
  await abrirDisciplina(page);
  ok(await page.locator('[data-desempenho]').count() === 1, 'painel aparece depois do quiz completo');
  ok(await page.locator('[data-desemp-tema]').count() === 1, 'exatamente 1 linha no painel');
  ok(await page.getAttribute('[data-desemp-tema]', 'data-quiz') === '4/8', 'data-quiz 4/8');
  ok(await page.getAttribute('[data-desemp-tema]', 'data-flash') === `2/${nFc}`, `data-flash 2/${nFc}`);
  const ptxt = await page.textContent('[data-desempenho]');
  ok(ptxt.includes(`1 de ${nTemas} temas começados`), `texto "1 de ${nTemas} temas começados"`);
  ok(ptxt.includes('Seu desempenho em COI II'), 'título com a sigla');
  ok(ptxt.includes('só neste aparelho') && await page.locator('[data-desempenho] .privacidade').count() === 1, 'aviso de privacidade');
  ok(await page.locator('[data-desempenho] .selo.dias').count() >= 1 && /falt|hoje/.test(await page.textContent('[data-desempenho] .selo.dias')), 'selo de dias da prova');
  ok(/A1 · Guarulhos · quarta noite/.test(ptxt), 'prova com o nome da turma');
  let est = await lerEstado(page);
  const r1 = (est.rodadas || {})[SLUG] || [];
  ok(r1.length === 1 && r1[0].ac === 4 && r1[0].n === 8 && !('parcial' in r1[0]) && new Date(r1[0].em).toISOString() === r1[0].em, 'rodada gravada {ac:4, n:8} sem parcial e com em ISO');
  ok(!!(est.quiz && est.quiz[SLUG] && est.flash && est.flash[SLUG]), 'formato antigo (quiz, flash) continua no estado');
  await semRolagem(page, 'painel de desempenho');
  await page.addStyleTag({ content: '#topo { visibility: hidden }' });   // a barra fixa não entra nas capturas de elemento
  await page.locator('[data-desempenho]').screenshot({ path: `${CAPTURAS}/desempenho.png` });
  // abrir e fechar
  const linha = page.locator(`[data-desemp-tema="${SLUG}"]`), reg = page.locator(`[data-evolucao="${SLUG}"]`);
  ok(await linha.getAttribute('aria-expanded') === 'false' && !(await reg.isVisible()), 'evolução começa fechada');
  await linha.click();
  ok(await linha.getAttribute('aria-expanded') === 'true' && await reg.isVisible(), 'tocar abre a evolução');
  ok(await reg.getAttribute('data-rodadas') === '1' && await reg.locator('circle.pt').count() === 1, 'evolução com 1 rodada e 1 ponto');
  ok(/1 rodada · 4 acertos em 8/.test(await reg.textContent()), 'legenda de uma rodada');
  await linha.click();
  ok(await linha.getAttribute('aria-expanded') === 'false' && !(await reg.isVisible()), 'tocar de novo fecha');

  // segunda rodada: tudo certo (o quiz recomeça inteiro ao abrir a aba)
  await abrirQuiz(page, SLUG);
  await responderQuiz(page, () => true);
  est = await lerEstado(page);
  const r2 = est.rodadas[SLUG];
  ok(r2.length === 2 && r2[1].ac === 8 && r2[1].n === 8 && !('parcial' in r2[1]), 'segunda rodada {ac:8, n:8}');
  await abrirDisciplina(page);
  await linha.click();
  ok(await reg.getAttribute('data-rodadas') === '2' && await reg.locator('circle.pt').count() === 2, 'evolução com 2 pontos');
  ok((await reg.textContent()).includes('2 rodadas · de 4 para 8 acertos em 8'), 'legenda "2 rodadas · de 4 para 8 acertos em 8"');
  ok(await page.locator('[data-desemp-tema]').count() === 1, 'continua 1 linha');
  await semRolagem(page, 'painel com evolução aberta');
  await page.locator('[data-desempenho]').screenshot({ path: `${CAPTURAS}/desempenho-evolucao.png` });

  // terceira rodada completa com erros, depois rodada parcial só com as erradas
  await abrirQuiz(page, SLUG);
  await responderQuiz(page, i => i >= 3);
  est = await lerEstado(page);
  ok(est.rodadas[SLUG].length === 3 && est.rodadas[SLUG][2].ac === 5 && !('parcial' in est.rodadas[SLUG][2]), 'terceira rodada completa {ac:5, n:8}');
  await abrirDisciplina(page);
  await page.click(`[data-errei="${SLUG}"]`);
  await page.waitForSelector('.alt');
  ok((await page.textContent('.contador')).endsWith('de 3'), 'quiz filtrado com as 3 erradas');
  await responderQuiz(page, () => true);
  est = await lerEstado(page);
  const r4 = est.rodadas[SLUG];
  ok(r4.length === 4 && r4[3].parcial === true && r4[3].ac === 3 && r4[3].n === 3, 'rodada parcial gravada {ac:3, n:3, parcial:true}');
  await abrirDisciplina(page);
  await linha.click();
  ok(await reg.getAttribute('data-rodadas') === '3' && await reg.locator('circle.pt').count() === 3, 'a parcial não entra na linha (3 pontos)');
  ok((await reg.textContent()).includes('As rodadas só com as erradas não entram na linha.'), 'aviso sobre rodadas parciais');
  await semRolagem(page, 'painel com parcial');

  await page.goto(BASE + '#minhas');
  await page.reload();
  await semRolagem(page, 'minhas (recarregada)');
  // trocar RGM
  await page.click('text=Trocar RGM');
  await page.waitForSelector('#rgm');
  ok(page.url().endsWith('#entrada'), 'Trocar RGM volta à entrada');
  await ctx.close();

  // 8
  console.log('8. Estado no formato antigo e ordem do painel');
  ctx = await novoCtx(); page = await novaPagina(ctx);
  await entrar(page, '111111'); await page.waitForSelector('[data-disc]');
  const quatro = COM_CONTEUDO.filter(t => questoesDe(t.slug).length >= 4).slice(0, 4).map(t => t.slug);
  ok(quatro.length === 4, 'quatro temas reais para montar o estado antigo');
  const [sC, sB, sA, sD] = quatro;           // na ordem do topicos.json: C, B, A, D (embaralhado de propósito)
  const qz = {}, fl = {};
  const quizDe = (slug, k) => { const o = {}; questoesDe(slug).forEach((q, i) => { o[q.id] = { esc: 0, ok: i < k }; }); return o; };
  qz[sA] = quizDe(sA, 1);                                           // 1 acerto de N
  qz[sB] = quizDe(sB, Math.floor(questoesDe(sB).length / 2));      // metade
  qz[sC] = quizDe(sC, questoesDe(sC).length);                       // todas certas
  fl[sD] = {}; topicoJson(sD).flashcards.forEach(f => { fl[sD][f.id] = true; });   // só flashcards
  await injetar(page, { aba: 'quiz', quiz: qz, flash: fl });
  await abrirDisciplina(page);
  await page.waitForSelector('[data-desempenho]');
  const info = quatro.map(slug => {
    const t = topicoJson(slug);
    return { slug, idx: COM_CONTEUDO.findIndex(x => x.slug === slug), nq: t.questoes.length, nf: t.flashcards.length,
      ac: Object.values(qz[slug] || {}).filter(r => r.ok).length, dom: Object.keys(fl[slug] || {}).length };
  });
  const esperado = info.slice().sort((a, b) => (a.ac / a.nq - b.ac / b.nq) || (a.dom / a.nf - b.dom / b.nf) || (a.idx - b.idx)).map(x => x.slug);
  const obtido = await page.locator('[data-desemp-tema]').evaluateAll(ns => ns.map(n => n.getAttribute('data-desemp-tema')));
  ok(obtido.length === 4, 'painel lista exatamente 4 temas');
  ok(JSON.stringify(obtido) === JSON.stringify(esperado), 'ordem do mais fraco para o mais forte: ' + esperado.map(s => s.slice(0, 10)).join(' < '));
  ok(JSON.stringify(obtido) !== JSON.stringify(quatro), 'a ordem do painel difere da ordem do topicos.json');
  for (const x of info) {
    const li = page.locator(`[data-desemp-tema="${x.slug}"]`);
    ok(await li.getAttribute('data-quiz') === `${x.ac}/${x.nq}` && await li.getAttribute('data-flash') === `${x.dom}/${x.nf}`, `${x.slug.slice(0, 14)}: quiz ${x.ac}/${x.nq}, flash ${x.dom}/${x.nf}`);
    const cq = await page.textContent(`[data-topico="${x.slug}"] .prog-quiz`);
    ok(cq.startsWith(`Quiz: ${x.ac}/${x.nq} acertos`), `cartão de baixo: ${cq}`);
  }
  ok((await page.textContent('[data-desempenho]')).includes(`4 de ${nTemas} temas começados`), `"4 de ${nTemas} temas começados"`);
  await page.click(`[data-desemp-tema="${sA}"]`);
  const regA = page.locator(`[data-evolucao="${sA}"]`);
  ok(await regA.isVisible() && await regA.getAttribute('data-rodadas') === '0' && (await regA.textContent()).includes('Ainda não há rodada completa'), 'formato antigo: mensagem de que não há rodada completa');
  ok(await regA.locator('svg').count() === 0, 'formato antigo: sem gráfico');
  await semRolagem(page, 'painel formato antigo');
  await page.click(`[data-evolucao="${sA}"] a.btn.sec`);
  await page.waitForSelector('.aba'); page.__slug = sA;
  await page.click('[data-aba=quiz]');
  await responderQuiz(page, () => true);
  est = await lerEstado(page);
  ok(JSON.stringify(est.quiz[sC]) === JSON.stringify(qz[sC]) && JSON.stringify(est.flash[sD]) === JSON.stringify(fl[sD]), 'formato antigo dos outros temas intacto');
  const nA = questoesDe(sA).length;
  ok(Object.keys(est.quiz[sA]).length === nA && est.rodadas[sA].length === 1 && est.rodadas[sA][0].ac === nA && est.rodadas[sA][0].n === nA, 'primeira rodada do tema antigo entrou');
  ok(!est.rodadas[sB] && !est.rodadas[sC], 'só o tema respondido ganhou rodada');
  await ctx.close();

  // 8b
  console.log('8b. Muitos temas começados: só os 5 mais fracos à vista');
  ctx = await novoCtx(); page = await novaPagina(ctx);
  await entrar(page, '111111'); await page.waitForSelector('[data-disc]');
  const sete = COM_CONTEUDO.slice(0, 7).map(t => t.slug), qz7 = {};
  sete.forEach((slug, i) => { qz7[slug] = quizDe(slug, Math.min(i, questoesDe(slug).length)); });   // 0, 1, 2… acertos
  await injetar(page, { quiz: qz7 });
  await abrirDisciplina(page);
  await page.waitForSelector('[data-desempenho]');
  const visiveis = () => page.locator('[data-desemp-tema]').evaluateAll(ns => ns.filter(n => n.offsetParent !== null).map(n => n.getAttribute('data-desemp-tema')));
  const todas7 = await page.locator('[data-desemp-tema]').evaluateAll(ns => ns.map(n => n.getAttribute('data-desemp-tema')));
  ok(todas7.length === 7 && (await visiveis()).length === 5, '7 temas começados, 5 linhas à vista');
  ok(JSON.stringify(await visiveis()) === JSON.stringify(todas7.slice(0, 5)), 'as 5 à vista são as mais fracas');
  const btnTodos = page.locator('[data-desemp-todos]');
  ok((await btnTodos.textContent()) === 'Mostrar os 7 temas começados' && await btnTodos.getAttribute('aria-expanded') === 'false', 'botão "Mostrar os 7 temas começados"');
  await btnTodos.click();
  ok((await visiveis()).length === 7 && await btnTodos.getAttribute('aria-expanded') === 'true' && (await btnTodos.textContent()) === 'Mostrar só os 5 mais fracos', 'o botão abre as 7 e muda de texto');
  await semRolagem(page, 'painel com 7 temas');
  await page.addStyleTag({ content: '#topo { visibility: hidden }' });
  await page.locator('[data-desempenho]').screenshot({ path: `${CAPTURAS}/desempenho-7-temas.png` });
  await btnTodos.click();
  ok((await visiveis()).length === 5, 'tocar de novo volta às 5');
  await ctx.close();

  // 9
  console.log('9. Várias rodadas, tema claro e escuro');
  const [t1, t2, t3] = quatro;
  const mk = (acs, n, ini) => acs.map((ac, i) => ({ em: isoDias(ini + i * 3), ac: Math.min(ac, n), n }));
  const n1 = questoesDe(t1).length, n2 = questoesDe(t2).length;
  const varias = {
    [t1]: mk([3, 5, 7], n1, 0),
    [t2]: mk([2, 4, 3, 5, 6, 5, 7, 8, 8], n2, 0),                                   // 9 rodadas: só as 8 mais recentes
    [t3]: [{ em: isoDias(0), ac: 3, n: 8 }, { em: isoDias(3), ac: 5, n: 8 }, { em: isoDias(6), ac: 2, n: 3, parcial: true }, { em: isoDias(9), ac: 7, n: 10 }]
  };
  async function semAtropelo(pg, sel, onde) {
    const r = await pg.locator(sel).evaluate(svg => {
      const vb = svg.viewBox.baseVal, ts = Array.from(svg.querySelectorAll('text')).map(t => t.getBBox());
      let fora = 0, sobre = 0;
      ts.forEach((b, i) => {
        if (b.x < vb.x || b.y < vb.y || b.x + b.width > vb.x + vb.width || b.y + b.height > vb.y + vb.height) fora++;
        ts.forEach((c, j) => { if (j > i && b.x < c.x + c.width && c.x < b.x + b.width && b.y < c.y + c.height && c.y < b.y + b.height) sobre++; });
      });
      return { fora, sobre, n: ts.length };
    });
    ok(r.fora === 0 && r.sobre === 0, `${onde}: ${r.n} rótulos, nenhum cortado (${r.fora}) nem sobreposto (${r.sobre})`);
  }
  for (const esquema of ['light', 'dark']) {
    ctx = await comTeste(await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: esquema }));
    page = await novaPagina(ctx);
    await entrar(page, '111111'); await page.waitForSelector('[data-disc]');
    await injetar(page, { quiz: {}, flash: {}, rodadas: varias });
    await abrirDisciplina(page);
    await page.waitForSelector('[data-desempenho]');
    await page.addStyleTag({ content: '#topo { visibility: hidden }' });
    ok(await page.locator('[data-desemp-tema]').count() === 3, `${esquema}: 3 linhas`);
    for (const t of [t1, t2, t3]) await page.click(`[data-desemp-tema="${t}"]`);
    ok(await page.getAttribute(`[data-evolucao="${t1}"]`, 'data-rodadas') === '3' && await page.locator(`[data-evolucao="${t1}"] circle.pt`).count() === 3, `${esquema}: 3 pontos`);
    ok(await page.getAttribute(`[data-evolucao="${t2}"]`, 'data-rodadas') === '8' && await page.locator(`[data-evolucao="${t2}"] circle.pt`).count() === 8, `${esquema}: 9 rodadas, 8 pontos`);
    ok(await page.getAttribute(`[data-evolucao="${t3}"]`, 'data-rodadas') === '3' && (await page.textContent(`[data-evolucao="${t3}"] svg`)).includes('7/10'), `${esquema}: n variável vira ac/n`);
    ok(await page.locator(`[data-evolucao="${t1}"] svg`).getAttribute('aria-label') === `Evolução no quiz: 3, 5 e 7 acertos em ${n1}, em três rodadas`, `${esquema}: aria-label do gráfico`);
    for (const t of [t1, t2, t3]) await semAtropelo(page, `[data-evolucao="${t}"] svg`, `${esquema} ${t.slice(0, 12)}`);
    await semRolagem(page, `${esquema} com três evoluções abertas`);
    await page.waitForTimeout(400);   // espera o chevron terminar de girar
    const item = t => page.locator('.desemp-item', { has: page.locator(`[data-desemp-tema="${t}"]`) });
    if (esquema === 'dark') {
      await page.locator('[data-desempenho]').screenshot({ path: `${CAPTURAS}/desempenho-dark.png` });
    } else {
      await item(t1).screenshot({ path: `${CAPTURAS}/desempenho-evolucao-varias.png` });
      await item(t2).screenshot({ path: `${CAPTURAS}/desempenho-8-rodadas.png` });
      await item(t3).screenshot({ path: `${CAPTURAS}/desempenho-n-variavel.png` });
      await page.locator('[data-desempenho]').screenshot({ path: `${CAPTURAS}/desempenho-claro-completo.png` });
    }
    await ctx.close();
  }

  // 10
  console.log('10. O que reler');
  const S10 = 'periodontite-estagio-grau';
  const TJ10 = topicoJson(S10), Q10 = TJ10.questoes, ORD10 = TJ10.resumo.map(r => r.id);
  const TIT10 = Object.fromEntries(TJ10.resumo.map(r => [r.id, r.titulo]));
  ok(Q10.length === 8 && Q10.every(q => ORD10.includes(q.secao)), 'tema com 8 questões, todas com secao válida');
  const contar = (qs, erradas) => {
    const m = {};
    qs.forEach(q => { const l = m[q.secao] = m[q.secao] || { id: q.secao, e: 0, t: 0 }; l.t++; if (erradas.has(q.id)) l.e++; });
    return Object.values(m).sort((a, b) => {
      if ((a.e > 0) !== (b.e > 0)) return a.e > 0 ? -1 : 1;
      if (!a.e) return ORD10.indexOf(a.id) - ORD10.indexOf(b.id);
      return (b.e - a.e) || (b.e * a.t - a.e * b.t) || (ORD10.indexOf(a.id) - ORD10.indexOf(b.id));
    });
  };
  const contagem10 = {}; Q10.forEach(q => { contagem10[q.secao] = (contagem10[q.secao] || 0) + 1; });
  const multi = ORD10.find((id, i) => i > 0 && contagem10[id] >= 2);
  const outra = Q10.find(q => q.secao !== multi);
  const erradas10 = new Set(Q10.filter(q => q.secao === multi).map(q => q.id).concat(outra.id));
  const linhas10 = pg => pg.locator('[data-reler-secao]').evaluateAll(ns => ns.map(n => ({ id: n.getAttribute('data-reler-secao'), e: +n.getAttribute('data-erros'), t: +n.getAttribute('data-total'), txt: n.textContent, btns: n.querySelectorAll('button').length, cls: n.querySelector('button') ? n.querySelector('button').className : '' })));
  async function novoQuiz10(esquema) {
    const c = await comTeste(await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: esquema === 'dark' ? 2 : 1, colorScheme: esquema }));
    const pg = await novaPagina(c);
    await entrar(pg, '111111'); await pg.waitForSelector('[data-disc]');
    await injetar(pg, { quiz: {}, flash: {}, rodadas: {} });
    await abrirDisciplina(pg);
    await abrirQuiz(pg, S10);
    return [c, pg];
  }
  function confere(linhas, esp, onde) {
    ok(JSON.stringify(linhas.map(l => l.id)) === JSON.stringify(esp.map(l => l.id)), `${onde}: seções e ordem esperadas (${esp.map(l => l.id + ' ' + l.e + '/' + l.t).join(', ')})`);
    ok(linhas.every((l, i) => esp[i] && l.e === esp[i].e && l.t === esp[i].t), `${onde}: data-erros e data-total batem`);
    ok(linhas.every(l => l.txt.includes(TIT10[l.id]) && l.txt.includes(l.e ? `errou ${l.e} de ${l.t}` : `acertou ${l.t} de ${l.t}`)), `${onde}: título e "errou e de t" / "acertou t de t"`);
    ok(linhas.every(l => l.btns === (l.e ? 1 : 0)), `${onde}: só as linhas com erro têm botão`);
  }
  [ctx, page] = await novoQuiz10('light');
  await responderQuiz(page, (i, q) => !erradas10.has(q.id));
  ok(await page.locator('[data-reler]').count() === 1 && (await page.textContent('[data-reler] h2')) === 'O que reler', 'placar com o bloco "O que reler"');
  let esp = contar(Q10, erradas10), lin = await linhas10(page);
  ok(new Set(lin.map(l => l.id)).size === lin.length && lin.length === new Set(Q10.map(q => q.secao)).size, 'uma linha por seção das 8 questões');
  confere(lin, esp, 'rodada completa');
  ok(esp[0].id === multi && esp[0].e === 2, `a seção com mais erros (${multi}, não a primeira do resumo) vem primeiro`);
  ok(lin[0].cls.split(' ').includes('btn') && !lin[0].cls.split(' ').includes('sec') && lin.filter(l => l.e).slice(1).every(l => l.cls.split(' ').includes('sec')), 'primeiro botão é "btn"; os demais, "btn sec"');
  ok(await page.evaluate(() => { const a = document.querySelector('[data-reler]'), b = document.querySelector('.lista-erradas'); return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); }), '"O que reler" vem antes de "Para rever"');
  ok(await page.locator('.lista-erradas li').count() === erradas10.size, '"Para rever" continua com as erradas');
  await semRolagem(page, 'placar com "O que reler"');
  const alturaBtn = await page.locator('[data-acao=reler]').evaluateAll(ns => ns.map(n => n.getBoundingClientRect().height));
  ok(alturaBtn.length > 0 && alturaBtn.every(h => h >= 48), 'botões "Reler esta seção" com 48 px ou mais');
  await page.addStyleTag({ content: '#topo { visibility: hidden }' });
  await page.locator('[data-reler]').screenshot({ path: `${CAPTURAS}/reler.png` });
  await page.addStyleTag({ content: '#topo { visibility: visible }' });

  // atalho
  await page.locator('[data-reler-secao]').first().locator('[data-acao=reler]').click();
  await page.waitForSelector('[data-aba=resumo][aria-selected=true]');
  await page.waitForSelector(`.secao[data-secao=${multi}][data-destino="1"]`);
  await page.waitForTimeout(500);
  const pos = await page.evaluate(id => ({ top: document.querySelector(`.secao[data-secao=${id}]`).getBoundingClientRect().top, barra: document.getElementById('topo').getBoundingClientRect().bottom, alt: window.innerHeight, y: window.scrollY, foco: document.activeElement === document.querySelector(`.secao[data-secao=${id}]`) }), multi);
  ok(pos.y > 0 && pos.top >= pos.barra - 2 && pos.top <= pos.barra + 24 && pos.top < pos.alt / 2, `a seção de destino fica logo abaixo da barra (topo ${Math.round(pos.top)}, barra ${Math.round(pos.barra)})`);
  ok(pos.foco, 'o foco vai para a seção de destino');
  ok(await page.locator('.secao[data-destino]').count() === 1, 'só uma seção marcada como destino');
  ok((await lerEstado(page)).aba === 'resumo', 'estado salvo com aba "resumo"');
  await page.screenshot({ path: `${CAPTURAS}/reler-destino.png` });
  await semRolagem(page, 'resumo depois do atalho');

  // rodada parcial
  await page.click('[data-aba=quiz]');
  await responderQuiz(page, (i, q) => !erradas10.has(q.id));
  await page.click('button:has-text("Refazer as erradas")');
  const refeitas = Q10.filter(q => erradas10.has(q.id));
  await responderQuiz(page, (i, q) => q.id !== outra.id);
  lin = await linhas10(page);
  confere(lin, contar(refeitas, new Set([outra.id])), 'rodada parcial');
  ok(lin.length === new Set(refeitas.map(q => q.secao)).size && lin.length < new Set(Q10.map(q => q.secao)).size, 'rodada parcial: só as seções das questões refeitas');

  // rodada sem erro
  await page.click('button:has-text("Refazer tudo")');
  await responderQuiz(page, () => true);
  ok((await page.textContent('[data-reler]')).includes('Nenhum erro nesta rodada: nada para reler agora.'), 'rodada sem erro: frase "Nenhum erro nesta rodada"');
  ok(await page.locator('[data-reler-secao]').count() === 0 && await page.locator('[data-reler] button').count() === 0, 'rodada sem erro: nenhuma linha nem botão');
  await semRolagem(page, 'placar sem erros');
  await ctx.close();

  // tema escuro
  [ctx, page] = await novoQuiz10('dark');
  await responderQuiz(page, (i, q) => !erradas10.has(q.id));
  confere(await linhas10(page), contar(Q10, erradas10), 'tema escuro');
  await semRolagem(page, 'placar escuro com "O que reler"');
  await page.addStyleTag({ content: '#topo { visibility: hidden }' });
  await page.locator('[data-reler]').screenshot({ path: `${CAPTURAS}/reler-dark.png` });
  await ctx.close();

  // robustez: questões sem secao
  ctx = await novoCtx(); page = await novaPagina(ctx);
  await ctx.route(`**/data/14733/topicos/${S10}.json`, async route => {
    const resp = await route.fetch(); const j = await resp.json();
    j.questoes.forEach(q => { delete q.secao; });
    await route.fulfill({ response: resp, json: j });
  });
  await entrar(page, '111111'); await page.waitForSelector('[data-disc]');
  await abrirDisciplina(page);
  await abrirQuiz(page, S10);
  await responderQuiz(page, (i, q) => i % 2 === 0);
  ok(await page.locator('[data-placar]').count() === 1 && await page.locator('[data-reler]').count() === 0, 'sem secao nas questões: placar sem erro de página e sem "O que reler"');
  await ctx.close();

  // 11
  console.log('11. Fila de revisão');
  {
    const zz = n => String(n).padStart(2, '0');
    const diaIso = n => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${zz(d.getMonth() + 1)}-${zz(d.getDate())}`; };
    const dm = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7);
    const HOJE = diaIso(0), ONTEM = diaIso(-1), AMANHA = diaIso(1);
    const rotQ = n => n + (n === 1 ? ' questão' : ' questões');
    const [tA, tB, tC] = COM_CONTEUDO.filter(t => questoesDe(t.slug).length >= 5).slice(0, 3);   // ordem do topicos.json: A, B, C
    const sA = tA.slug, sB = tB.slug, sC = tC.slug, TEMAS = [tA, tB, tC];
    const tit = slug => TJ.find(t => t.slug === slug).titulo;
    const qid = (slug, i) => questoesDe(slug)[i].id;
    const entrada = (p, em) => ({ p, em });
    const FILA = {
      [sA]: { [qid(sA, 0)]: entrada(1, ONTEM), [qid(sA, 1)]: entrada(0, HOJE), [qid(sA, 2)]: entrada(0, AMANHA) },
      [sB]: { [qid(sB, 0)]: entrada(0, ONTEM), [qid(sB, 1)]: entrada(1, ONTEM), [qid(sB, 2)]: entrada(2, HOJE), [qid(sB, 3)]: entrada(0, HOJE), q99: entrada(0, ONTEM) },
      [sC]: { [qid(sC, 0)]: entrada(0, ONTEM), [qid(sC, 1)]: entrada(1, HOJE), [qid(sC, 2)]: entrada(2, ONTEM) }
    };
    const nVenc = 2 + 4 + 3;
    const abrirDisc = async pg => { await pg.goto(BASE + '#d-14733'); await pg.reload(); await pg.waitForSelector('.area'); };
    const novoCtx11 = async (esquema = 'light') => {
      const c = await comTeste(await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: esquema === 'dark' ? 2 : 1, colorScheme: esquema }));
      const pg = await novaPagina(c);
      await entrar(pg, '111111'); await pg.waitForSelector('[data-disc]');
      return [c, pg];
    };
    // responde a revisão na tela até o placar; decide(slug, questão) diz se acerta; localiza a questão pelo enunciado nos JSON dos temas
    async function responderRevisao(pg, decide, aoResponder) {
      const feitos = [];
      for (;;) {
        await pg.waitForSelector('.alt, [data-placar]');
        if (await pg.locator('[data-placar]').count()) return feitos;
        const enun = (await pg.textContent('.enunciado')).trim();
        const slugTela = await pg.getAttribute('[data-revisao-tema]', 'data-revisao-tema');
        const ach = TEMAS.map(t => ({ slug: t.slug, q: questoesDe(t.slug).find(x => x.enunciado.trim() === enun) })).find(x => x.q);
        ok(!!ach && ach.slug === slugTela && (await pg.textContent('[data-revisao-tema]')).trim() === tit(ach.slug), `questão ${feitos.length + 1}: o rótulo mostra o tema dela (${slugTela.slice(0, 14)})`);
        const certa = decide(ach.slug, ach.q);
        const alvo = ach.q.alternativas.find(x => !!x.correta === certa);
        await pg.locator('.alt', { hasText: alvo.texto }).first().click();
        await pg.waitForSelector('.feedback');
        if (aoResponder) await aoResponder(feitos.length, ach, certa);
        await pg.click('[data-acao=proxima]');
        feitos.push({ slug: ach.slug, q: ach.q, certa });
      }
    }

    // 1. sem fila (inclusive o formato antigo)
    let [c11, p11] = await novoCtx11();
    await injetar(p11, { aba: 'quiz', quiz: { [sA]: { [qid(sA, 0)]: { esc: 0, ok: false }, [qid(sA, 1)]: { esc: 1, ok: false }, [qid(sA, 2)]: { esc: 0, ok: true } } }, flash: {} });
    await abrirDisc(p11);
    ok(await p11.locator('[data-desempenho]').count() === 1 && await p11.locator('[data-revisar]').count() === 0, 'formato antigo (só quiz com erradas): sem fila, sem [data-revisar]');
    await injetar(p11, {});
    await abrirDisc(p11);
    ok(await p11.locator('[data-revisar]').count() === 0, 'estado vazio: sem [data-revisar]');

    // 2. quiz normal errando k questões
    const errar = [qid(sA, 0), qid(sA, 2), qid(sA, 4)];
    await abrirQuiz(p11, sA);
    await responderQuiz(p11, (i, q) => !errar.includes(q.id));
    let e11 = await lerEstado(p11);
    ok(JSON.stringify(Object.keys(e11.fila[sA]).sort()) === JSON.stringify(errar.slice().sort()), `fila do tema tem exatamente as ${errar.length} erradas`);
    ok(errar.every(id => JSON.stringify(e11.fila[sA][id]) === JSON.stringify({ p: 0, em: AMANHA })), 'cada errada entra como {p: 0, em: amanhã}');
    await abrirDisc(p11);
    ok(await p11.locator('[data-revisar]').count() === 1 && await p11.locator('[data-revisar] h2').textContent() === 'Para revisar hoje', 'seção "Para revisar hoje" aparece');
    ok((await p11.textContent('[data-revisar-vazia]')) === `Nada para hoje. Próxima revisão: ${dm(AMANHA)} (${errar.length} questões).`, 'frase "Nada para hoje. Próxima revisão: dd/mm (3 questões)."');
    ok(await p11.locator('[data-acao=revisar]').count() === 0 && await p11.locator('[data-revisar-tema]').count() === 0, 'sem botão nem lista quando nada vence');
    await semRolagem(p11, 'disciplina com fila só para depois');
    await p11.addStyleTag({ content: '#topo { visibility: hidden }' });
    await p11.locator('[data-revisar]').screenshot({ path: `${CAPTURAS}/revisar-vazia.png` });
    await c11.close();

    // 3. fila injetada
    const estBase = { aba: 'quiz', quiz: { [sA]: { [qid(sA, 3)]: { esc: 0, ok: true } } }, flash: {}, rodadas: {}, fila: FILA };
    [c11, p11] = await novoCtx11();
    await injetar(p11, estBase);
    await abrirDisc(p11);
    await p11.waitForSelector('[data-revisar]');
    let linhasR = await p11.locator('[data-revisar-tema]').evaluateAll(ns => ns.map(n => [n.getAttribute('data-revisar-tema'), +n.getAttribute('data-qtd'), n.textContent]));
    ok(JSON.stringify(linhasR.map(l => l.slice(0, 2))) === JSON.stringify([[sB, 4], [sC, 3], [sA, 2]]), 'linhas por tema, mais questões primeiro: 4, 3, 2 (a de amanhã e a inexistente não contam)');
    ok(linhasR.every(l => l[2].includes(tit(l[0])) && l[2].endsWith(rotQ(l[1]))), 'cada linha traz o título do tema e "n questões"');
    ok((await p11.textContent('[data-acao=revisar]')) === `Começar a revisão · ${rotQ(nVenc)}`, `botão "Começar a revisão · ${nVenc} questões"`);
    const btnR = await p11.locator('[data-acao=revisar]').evaluate(n => ({ w: n.getBoundingClientRect().width, pw: n.parentElement.getBoundingClientRect().width, h: n.getBoundingClientRect().height, href: n.getAttribute('href'), cls: n.className }));
    ok(btnR.href === '#r-14733' && btnR.cls.split(' ').includes('btn') && btnR.h >= 48 && Math.abs(btnR.w - btnR.pw) < 2, 'botão principal, largura total, 48 px, leva a #r-14733');
    const txtR = await p11.textContent('[data-revisar]');
    ok(txtR.includes('Questões que você errou voltam aqui no dia marcado.'), 'frase de explicação');
    ok((await p11.textContent('[data-revisar] .privacidade')) === 'Errou: volta amanhã. Acertou no dia marcado: volta mais tarde, e depois da terceira vez sai da fila. Fica guardado só neste aparelho.', 'rodapé com "só neste aparelho"');
    ok(await p11.locator('[data-revisar-vazia]').count() === 0, 'com questão vencida não há a frase de "Nada para hoje"');
    ok(await p11.evaluate(() => {
      const r = document.querySelector('[data-revisar]'), d = document.querySelector('[data-desempenho]'), h = document.querySelector('h1');
      return !!d && !!(h.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(r.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING);
    }), '[data-revisar] vem depois do título e antes de [data-desempenho]');
    await semRolagem(p11, 'disciplina com fila vencida');
    await p11.addStyleTag({ content: '#topo { visibility: hidden }' });
    await p11.locator('[data-revisar]').screenshot({ path: `${CAPTURAS}/revisar.png` });
    await p11.addStyleTag({ content: '#topo { visibility: visible }' });

    // 4. a revisão
    await p11.click('[data-acao=revisar]');
    await p11.waitForSelector('.alt');
    ok(p11.url().endsWith('#r-14733'), 'rota #r-14733');
    ok((await p11.textContent('h1')) === 'Revisão de hoje' && (await p11.textContent('.cab-topico .meta')) === 'COI II', 'título "Revisão de hoje" e sigla da disciplina');
    ok((await p11.textContent('.contador')) === `Questão 1 de ${nVenc}`, `contador "Questão 1 de ${nVenc}"`);
    ok(await p11.locator('.voltar').getAttribute('href') === '#d-14733', 'voltar do cabeçalho leva a #d-14733');
    const destino = {   // o que cada questão vencida deve fazer
      [`${sB}/${qid(sB, 0)}`]: true, [`${sB}/${qid(sB, 1)}`]: true, [`${sB}/${qid(sB, 2)}`]: true, [`${sB}/${qid(sB, 3)}`]: false,
      [`${sC}/${qid(sC, 0)}`]: true, [`${sC}/${qid(sC, 1)}`]: false, [`${sC}/${qid(sC, 2)}`]: false,
      [`${sA}/${qid(sA, 0)}`]: true, [`${sA}/${qid(sA, 1)}`]: false
    };
    let primeira = true;
    const feitos = await responderRevisao(p11, (slug, q) => destino[`${slug}/${q.id}`], async (i, ach) => {
      if (i === 0) {
        ok(await p11.locator('.feedback .just').count() === 4 && (await p11.textContent('.feedback .fonte')).startsWith('Fonte: '), 'feedback com 4 justificativas e a fonte');
        if (primeira) { primeira = false; await p11.addStyleTag({ content: '#topo { visibility: hidden }' }); await p11.screenshot({ path: `${CAPTURAS}/revisao-questao.png`, fullPage: true }); }
        await semRolagem(p11, 'revisão com feedback');
      }
    });
    ok(feitos.length === nVenc && new Set(feitos.map(f => f.slug + '/' + f.q.id)).size === nVenc, `as ${nVenc} questões vencidas, cada uma uma vez`);
    ok(new Set(feitos.map(f => f.slug)).size === 3, 'a revisão mistura as questões dos três temas');
    e11 = await lerEstado(p11);
    const esperadoFila = {
      [sA]: { [qid(sA, 0)]: entrada(2, diaIso(4)), [qid(sA, 1)]: entrada(0, AMANHA), [qid(sA, 2)]: entrada(0, AMANHA) },
      [sB]: { [qid(sB, 0)]: entrada(1, diaIso(2)), [qid(sB, 1)]: entrada(2, diaIso(4)), [qid(sB, 3)]: entrada(0, AMANHA), q99: entrada(0, ONTEM) },
      [sC]: { [qid(sC, 0)]: entrada(1, diaIso(2)), [qid(sC, 1)]: entrada(0, AMANHA), [qid(sC, 2)]: entrada(0, AMANHA) }
    };
    ok(JSON.stringify(e11.fila[sB][qid(sB, 3)]) === JSON.stringify({ p: 0, em: AMANHA }) && JSON.stringify(e11.fila[sC][qid(sC, 2)]) === JSON.stringify({ p: 0, em: AMANHA }), 'errada (p 0 ou p 2) vira {p: 0, em: amanhã}');
    ok(JSON.stringify(e11.fila[sC][qid(sC, 0)]) === JSON.stringify({ p: 1, em: diaIso(2) }) && JSON.stringify(e11.fila[sA][qid(sA, 0)]) === JSON.stringify({ p: 2, em: diaIso(4) }), 'certa com p 0 vira {p: 1, em: hoje+2}; certa com p 1 vira {p: 2, em: hoje+4}');
    ok(!(qid(sB, 2) in e11.fila[sB]), 'certa com p 2 sai da fila');
    ok(JSON.stringify(e11.fila[sA][qid(sA, 2)]) === JSON.stringify({ p: 0, em: AMANHA }) && 'q99' in e11.fila[sB], 'a questão de amanhã e a entrada inexistente ficaram como estavam');
    const estavel = o => JSON.stringify(o, (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v);
    ok(estavel(e11.fila) === estavel(esperadoFila), 'fila final igual à esperada');
    ok(feitos.every(f => e11.quiz[f.slug][f.q.id] && e11.quiz[f.slug][f.q.id].ok === f.certa && typeof e11.quiz[f.slug][f.q.id].esc === 'number'), 'quiz[slug][id] gravado {esc, ok} para cada respondida');
    ok(Object.keys(e11.rodadas || {}).length === 0, 'a revisão não grava nada em rodadas');

    // 5. placar
    const erradasR = feitos.filter(f => !f.certa), acertosR = feitos.length - erradasR.length;
    ok(/Você acertou 5 de 9/.test(await p11.textContent('[data-placar]')) && acertosR === 5, 'placar "Você acertou 5 de 9"');
    ok((await p11.textContent('[data-revisao-fim]')) === 'As 4 que você errou voltam amanhã. As 5 que acertou voltam mais tarde ou saem da fila.', 'frase do caso misto');
    ok(await p11.locator('[data-revisao-fim]').evaluate(n => n.previousElementSibling.className.includes('grande')), 'a frase vem logo abaixo do placar');
    const esperaReler = (() => {
      const m = {};
      feitos.forEach(f => {
        const top = topicoJson(f.slug), ord = top.resumo.map(r => r.id);
        const ch = f.slug + '|' + f.q.secao;
        const l = m[ch] = m[ch] || { slug: f.slug, id: f.q.secao, e: 0, t: 0, ot: TJ.findIndex(t => t.slug === f.slug), os: ord.indexOf(f.q.secao), titulo: top.resumo.find(r => r.id === f.q.secao).titulo };
        l.t++; if (!f.certa) l.e++;
      });
      return Object.values(m).filter(l => l.e > 0).sort((a, b) => (b.e - a.e) || (a.ot - b.ot) || (a.os - b.os));
    })();
    const lr = await p11.locator('[data-reler-secao]').evaluateAll(ns => ns.map(n => ({ id: n.getAttribute('data-reler-secao'), tema: n.getAttribute('data-reler-tema'), txt: n.textContent, cls: n.querySelector('button').className })));
    ok(JSON.stringify(lr.map(l => l.tema + '|' + l.id)) === JSON.stringify(esperaReler.map(l => l.slug + '|' + l.id)), `"O que reler": ${esperaReler.length} (tema, seção) das erradas, na ordem esperada`);
    ok(lr.every((l, i) => l.txt.includes(esperaReler[i].titulo) && l.txt.includes(tit(l.tema)) && l.txt.includes(`errou ${esperaReler[i].e} de ${esperaReler[i].t}`)), 'cada linha: título da seção, título do tema, "errou e de t"');
    ok(lr[0].cls.split(' ').includes('btn') && !lr[0].cls.split(' ').includes('sec') && lr.slice(1).every(l => l.cls.split(' ').includes('sec')), 'primeiro botão "btn", os demais "btn sec"');
    ok(await p11.locator('[data-reler] [data-acao=reler]').count() === esperaReler.length && (await p11.locator('[data-reler] [data-acao=reler]').first().textContent()) === 'Reler esta seção', 'botões "Reler esta seção"');
    ok((await p11.locator('.rev-box > .linha-botoes a.btn.sec').textContent()) === 'Voltar à disciplina' && (await p11.locator('.rev-box > .linha-botoes a.btn.sec').getAttribute('href')) === '#d-14733', 'link "Voltar à disciplina"');
    await semRolagem(p11, 'placar da revisão');
    await p11.addStyleTag({ content: '#topo { visibility: hidden }' });
    await p11.screenshot({ path: `${CAPTURAS}/revisao-placar.png`, fullPage: true });
    await p11.addStyleTag({ content: '#topo { visibility: visible }' });
    // atalho
    const alvoR = esperaReler[0];
    await p11.locator('[data-reler-secao]').first().locator('[data-acao=reler]').click();
    await p11.waitForSelector('[data-aba=resumo][aria-selected=true]');
    await p11.waitForSelector(`.secao[data-secao=${alvoR.id}][data-destino="1"]`);
    await p11.waitForTimeout(500);
    ok(p11.url().endsWith('#t-' + alvoR.slug), `abre #t-${alvoR.slug.slice(0, 14)}… na aba Resumo`);
    const pos11 = await p11.evaluate(id => ({ top: document.querySelector(`.secao[data-secao=${id}]`).getBoundingClientRect().top, barra: document.getElementById('topo').getBoundingClientRect().bottom, alt: window.innerHeight, y: window.scrollY }), alvoR.id);
    ok(pos11.y > 0 && pos11.top >= pos11.barra - 2 && pos11.top <= pos11.barra + 24 && pos11.top < pos11.alt / 2, `a seção de destino fica logo abaixo da barra (topo ${Math.round(pos11.top)}, barra ${Math.round(pos11.barra)})`);
    ok(await p11.locator('.secao[data-destino]').count() === 1, 'só uma seção marcada como destino');
    await p11.goto(BASE + '#d-14733'); await p11.reload(); await p11.waitForSelector('.area');
    ok((await p11.textContent('[data-revisar-vazia]')) === `Nada para hoje. Próxima revisão: ${dm(AMANHA)} (5 questões).`, 'depois da revisão: "Próxima revisão: amanhã (5 questões)."');
    // sair da revisão descarta a sessão: voltar a #r- mostra só o que ainda vence
    await p11.goto(BASE + '#r-14733'); await p11.reload(); await p11.waitForSelector('.rev-box');
    ok((await p11.textContent('.rev-box')).includes('Nada para revisar hoje.'), 'reabrir a revisão sem nada vencido mostra "Nada para revisar hoje."');
    await c11.close();

    // 8. tema escuro
    [c11, p11] = await novoCtx11('dark');
    await injetar(p11, estBase);
    await abrirDisc(p11);
    await p11.waitForSelector('[data-revisar-tema]');
    await semRolagem(p11, 'disciplina com fila (escuro)');
    await p11.addStyleTag({ content: '#topo { visibility: hidden }' });
    await p11.locator('[data-revisar]').screenshot({ path: `${CAPTURAS}/revisar-dark.png` });
    await p11.click('[data-acao=revisar]');
    await p11.waitForSelector('.alt');
    await semRolagem(p11, 'revisão (escuro)');
    await responderRevisao(p11, (slug, q) => q.id !== qid(slug, 0));
    await semRolagem(p11, 'placar da revisão (escuro)');
    await p11.screenshot({ path: `${CAPTURAS}/revisao-placar-dark.png`, fullPage: true });
    await c11.close();

    // 5b. só acertos, só erros e singular
    const duas = { [sA]: { [qid(sA, 0)]: entrada(0, ONTEM), [qid(sA, 1)]: entrada(1, HOJE) } };
    const uma = { [sA]: { [qid(sA, 0)]: entrada(0, HOJE) } };
    async function rodar11(fila, certa) {
      const [c, p] = await novoCtx11();
      await injetar(p, { quiz: {}, flash: {}, rodadas: {}, fila });
      await abrirDisc(p); await p.waitForSelector('[data-revisar-tema]');
      const info = { btn: await p.textContent('[data-acao=revisar]'), linha: await p.locator('[data-revisar-tema]').first().textContent(), qtd: await p.locator('[data-revisar-tema]').first().getAttribute('data-qtd') };
      await p.click('[data-acao=revisar]');
      await responderRevisao(p, () => certa);
      info.fim = await p.textContent('[data-revisao-fim]'); info.reler = await p.locator('[data-reler]').count(); info.placar = (await p.textContent('[data-placar]')).trim();
      await c.close();
      return info;
    }
    let r = await rodar11(duas, true);
    ok(r.btn === 'Começar a revisão · 2 questões' && r.fim === 'As 2 que acertou voltam mais tarde ou saem da fila.' && r.reler === 0, 'só acertos: frase própria e sem bloco "O que reler"');
    r = await rodar11(duas, false);
    ok(r.fim === 'As 2 que você errou voltam amanhã.' && r.reler === 1, 'só erros: frase própria e com "O que reler"');
    r = await rodar11(uma, false);
    ok(r.btn === 'Começar a revisão · 1 questão' && r.linha.endsWith('1 questão') && r.qtd === '1' && r.fim === 'A que você errou volta amanhã.' && r.placar.includes('Você acertou 0 de 1'), 'singular: 1 questão, errou');
    r = await rodar11(uma, true);
    ok(r.fim === 'A que acertou volta mais tarde ou sai da fila.' && r.placar.includes('Você acertou 1 de 1'), 'singular: acertou');

    // 6. a regra fora da revisão (quiz normal do tema)
    {
      const q0 = qid(sA, 0), q1 = qid(sA, 1), q2 = qid(sA, 2);
      let [c, p] = await novoCtx11();
      await injetar(p, { quiz: {}, flash: {}, rodadas: {}, fila: { [sA]: { [q0]: entrada(1, AMANHA), [q1]: entrada(0, ONTEM), [q2]: entrada(2, ONTEM) } } });
      await abrirDisc(p); await abrirQuiz(p, sA);
      await responderQuiz(p, (i, q) => q.id !== q2);
      const ef = (await lerEstado(p)).fila[sA];
      ok(JSON.stringify(ef[q0]) === JSON.stringify({ p: 1, em: AMANHA }), 'quiz normal: acertar questão ainda não vencida não muda a entrada');
      ok(JSON.stringify(ef[q1]) === JSON.stringify({ p: 1, em: diaIso(2) }), 'quiz normal: acertar questão vencida avança (p 0 para p 1, hoje+2)');
      ok(JSON.stringify(ef[q2]) === JSON.stringify({ p: 0, em: AMANHA }), 'quiz normal: errar questão em p 2 volta a {p: 0, em: amanhã}');
      ok(Object.keys(ef).length === 3, 'quiz normal: acertar questão fora da fila não cria entrada');
      await c.close();
      [c, p] = await novoCtx11();
      await injetar(p, { quiz: {}, flash: {}, rodadas: {}, fila: { [sA]: { [q1]: entrada(2, ONTEM) } } });
      await abrirDisc(p); await abrirQuiz(p, sA);
      await responderQuiz(p, () => true);
      const e2 = await lerEstado(p);
      ok(!e2.fila || !(sA in e2.fila), 'acertar a vencida em p 2 tira a questão da fila e apaga a chave do tema');
      await c.close();
    }

    // 7. rota da revisão com fila vazia
    [c11, p11] = await novoCtx11();
    await injetar(p11, { quiz: {}, flash: {}, rodadas: {} });
    await p11.goto(BASE + '#r-14733'); await p11.reload(); await p11.waitForSelector('.rev-box');
    ok((await p11.textContent('.rev-box')).includes('Nada para revisar hoje.') && (await p11.textContent('h1')) === 'Revisão de hoje', 'fila vazia: "Nada para revisar hoje."');
    ok((await p11.locator('.rev-box a.btn.sec').textContent()) === 'Voltar à disciplina' && (await p11.locator('.rev-box a.btn.sec').getAttribute('href')) === '#d-14733', 'fila vazia: link "Voltar à disciplina"');
    await semRolagem(p11, 'revisão sem nada');
    await injetar(p11, { quiz: {}, flash: {}, rodadas: {}, fila: { [sA]: { lixo: 5, [qid(sA, 0)]: { p: 9, em: 'ontem' }, q99: entrada(0, ONTEM) }, 'tema-que-nao-existe': { q01: entrada(0, ONTEM) }, [sB]: 'texto' } });
    await abrirDisc(p11);
    ok(await p11.locator('[data-revisar]').count() === 0, 'entradas malformadas, inexistentes ou de tema sem conteúdo são ignoradas (sem erro)');
    await c11.close();
  }

  // 3
  console.log('3. RGM 000000');
  ctx = await novoCtx(); page = await novaPagina(ctx);
  await entrar(page, '000000');
  await page.waitForSelector('[data-disc]');
  ok(await page.locator('[data-disc]').count() === 7, '7 disciplinas');
  const nBreve = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'disciplinas.json'), 'utf8')).disciplinas.filter(d => d.status !== 'ativa').length; ok(await page.locator('[data-breve]').count() === nBreve, nBreve + ' "em breve"');
  ok((await page.locator('.selo.breve').count()) === nBreve, nBreve + ' selos "Conteúdo em breve"');
  await semRolagem(page, 'minhas (7)');
  // tema compartilhado (compartilhadoDe): a disciplina que o mostra carrega o arquivo da origem, e o progresso aparece nela
  const compartilhados = [];
  for (const d of JSON.parse(readFileSync(path.join(RAIZ, 'data', 'disciplinas.json'), 'utf8')).disciplinas.filter(d => d.status === 'ativa')) {
    const tj = JSON.parse(readFileSync(path.join(RAIZ, 'data', d.codigo, 'topicos.json'), 'utf8'));
    tj.topicos.filter(t => t.compartilhadoDe && t.status !== 'em-breve').forEach(t => compartilhados.push({ cod: d.codigo, slug: t.slug, orig: t.compartilhadoDe }));
  }
  if (!compartilhados.length) console.log('  sem tema compartilhado aberto em disciplina ativa');
  for (const c of compartilhados) {
    const qsC = JSON.parse(readFileSync(path.join(RAIZ, 'data', c.orig, 'topicos', c.slug + '.json'), 'utf8')).questoes;
    const ontem = (() => { const x = new Date(); x.setDate(x.getDate() - 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; })();
    await injetar(page, { quiz: { [c.slug]: { [qsC[0].id]: { esc: 0, ok: false } } }, fila: { [c.slug]: { [qsC[0].id]: { p: 0, em: ontem } } } });
    const falhos = [];
    const ouvir = r => { if (r.status() >= 400) falhos.push(r.url()); };
    page.on('response', ouvir);
    await page.goto(BASE + '#d-' + c.cod); await page.reload();
    await page.waitForSelector('[data-desempenho]');
    page.off('response', ouvir);
    ok(falhos.length === 0, `${c.cod}: nenhum arquivo com erro ao abrir a disciplina (${falhos.map(u => u.split('/data/')[1]).join(', ') || 'nenhum'})`);
    ok(await page.locator(`[data-desemp-tema="${c.slug}"]`).count() === 1, `${c.cod}: tema compartilhado ${c.slug} no painel de desempenho`);
    ok(await page.locator(`[data-revisar-tema="${c.slug}"]`).count() === 1, `${c.cod}: tema compartilhado ${c.slug} em "Para revisar hoje"`);
  }
  // dark
  await ctx.close();
  ctx = await comTeste(await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })); page = await novaPagina(ctx);
  await entrar(page, '111111'); await page.waitForSelector('[data-disc]');
  await page.screenshot({ path: `${CAPTURAS}/minhas-dark.png` });
  await ctx.close();
} catch (e) {
  falhas++; console.log('  FALHA exceção: ' + e.message);
} finally {
  await browser.close(); srv.kill();
}
console.log(falhas ? `\n${falhas} falha(s)` : '\nTodos os testes passaram');
process.exit(falhas ? 1 : 0);
