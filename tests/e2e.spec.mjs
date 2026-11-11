// Teste e2e (Playwright). Uso: node tests/e2e.spec.mjs   (sai 0 se tudo passar, 1 se falhar)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
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
// O RGM de teste 000000 saiu de data/alunos.json (o site não o aceita mais).
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

try {
  // 0
  console.log('0. Sem RGM de teste nos dados publicados');
  const reais = JSON.parse(readFileSync(path.join(RAIZ, 'data', 'alunos.json'), 'utf8'));
  for (const rgm of ['000000', '999999']) ok(!(hashRgm(reais.sal, rgm) in reais.alunos), `${rgm} não entra no site`);

  // 1
  console.log('1. RGM inexistente');
  let ctx = await novoCtx(), page = await ctx.newPage();
  page.on('pageerror', e => { falhas++; console.log('  FALHA erro de página: ' + e.message); });
  await entrar(page, '999999');
  await page.waitForSelector('#msg-erro:not(:empty)');
  ok((await page.textContent('#msg-erro')).startsWith('RGM não encontrado nas turmas do Prof. Pedro neste semestre.'), 'mensagem de não encontrado');
  ok(page.url().endsWith('#entrada') || !page.url().includes('#minhas'), 'permanece na entrada');
  await page.screenshot({ path: `${CAPTURAS}/entrada.png` });
  await semRolagem(page, 'entrada');
  await ctx.close();

  // 2
  console.log('2. RGM 111111');
  ctx = await novoCtx(); page = await ctx.newPage();
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

  await page.goto(BASE + '#minhas');
  await page.reload();
  await semRolagem(page, 'minhas (recarregada)');
  // trocar RGM
  await page.click('text=Trocar RGM');
  await page.waitForSelector('#rgm');
  ok(page.url().endsWith('#entrada'), 'Trocar RGM volta à entrada');
  await ctx.close();

  // 3
  console.log('3. RGM 000000');
  ctx = await novoCtx(); page = await ctx.newPage();
  await entrar(page, '000000');
  await page.waitForSelector('[data-disc]');
  ok(await page.locator('[data-disc]').count() === 7, '7 disciplinas');
  ok(await page.locator('[data-breve]').count() === 6, '6 "em breve"');
  ok((await page.locator('.selo.breve').count()) === 6, '6 selos "Conteúdo em breve"');
  await semRolagem(page, 'minhas (7)');
  // dark
  await ctx.close();
  ctx = await comTeste(await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })); page = await ctx.newPage();
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
