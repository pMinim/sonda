(function () {
  'use strict';
  var CHAVE = 'estuda-odonto-v1';
  var app = document.getElementById('app');
  var topo = document.getElementById('topo');
  var cache = {};
  var ctx = { teste: false, disciplinas: null, codigos: null, app: { nome: '', assinatura: '' } };
  var rodape = document.getElementById('rodape');
  var obsTitulo = null;
  var linkIcone = document.querySelector('link[rel="icon"]');
  var ICONE = linkIcone ? linkIcone.getAttribute('href') : 'assets/favicon.svg';
  var filtroErradas = false;   // pedido de abrir o quiz só com as erradas
  var destinoResumo = null;    // pedido de abrir um tema já na aba Resumo, numa seção ({ slug, sec }); telaTopico consome uma vez
  var INTERVALOS = [1, 2, 4];  // dias até a questão voltar: errou, 1ª volta, 2ª volta
  var flashSes = null, quizSes = null;

  /* ---------- estado ---------- */
  var memoria = null;
  function ler() {
    try { var s = localStorage.getItem(CHAVE); if (s) return JSON.parse(s) || {}; } catch (e) {}
    return memoria || {};
  }
  function gravar(est) {
    memoria = est;
    try { localStorage.setItem(CHAVE, JSON.stringify(est)); } catch (e) {}
  }
  function mudar(fn) { var est = ler(); fn(est); gravar(est); }
  function apagarRgm() { mudar(function (e) { delete e.rgm; delete e.acesso; }); ctx.codigos = null; ctx.teste = false; }

  /* ---------- utilidades ---------- */
  function el(tag, attrs, filhos) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    (filhos || []).forEach(function (f) { if (f != null) n.appendChild(typeof f === 'string' ? document.createTextNode(f) : f); });
    return n;
  }
  function getJson(url) {
    if (!cache[url]) cache[url] = fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    });
    return cache[url];
  }
  function md(txt) {
    var wrap = el('div', { class: 'md' });
    if (window.marked) {
      wrap.innerHTML = window.marked.parse(txt);
      Array.prototype.slice.call(wrap.querySelectorAll('table')).forEach(function (t) {
        var d = el('div', { class: 'tabela' }); t.parentNode.insertBefore(d, t); d.appendChild(t);
      });
    } else { wrap.style.whiteSpace = 'pre-wrap'; wrap.textContent = txt; }
    return wrap;
  }
  function diasAte(iso) {
    var p = iso.split('-').map(Number);
    var hoje = new Date();
    var a = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    return Math.round((Date.UTC(p[0], p[1] - 1, p[2]) - a) / 86400000);
  }
  function dataBr(iso) { var p = iso.split('-'); return p[2] + '/' + p[1]; }
  /* datas da fila de revisão: texto AAAA-MM-DD na data LOCAL do aparelho */
  function z2(n) { return (n < 10 ? '0' : '') + n; }
  function isoDe(dt) { return dt.getFullYear() + '-' + z2(dt.getMonth() + 1) + '-' + z2(dt.getDate()); }
  function hojeIso() { return isoDe(new Date()); }
  function somaDias(iso, n) {
    var p = iso.split('-').map(Number);
    return isoDe(new Date(p[0], p[1] - 1, p[2] + n, 12, 0, 0));
  }
  function rotQuestoes(n) { return n + (n === 1 ? ' questão' : ' questões'); }
  function embaralhar(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var tmp = a[i]; a[i] = a[j]; a[j] = tmp; }
    return a;
  }
  var SVG_VOLTAR = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';

  var SVG_OK = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M7.5 12.5l3 3 6-7"/></svg>';
  var SVG_ERRO = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7"/></svg>';

  function cabecalho(titulo, destino, rotulo) {
    topo.innerHTML = '';
    if (obsTitulo) { obsTitulo.disconnect(); obsTitulo = null; }
    if (!titulo) { topo.hidden = true; return; }
    topo.hidden = false;
    topo.className = 'topo rolou';
    var dentro = el('div', { class: 'topo-in' });
    dentro.appendChild(el('a', { class: 'voltar', href: '#' + destino, 'aria-label': 'Voltar', html: SVG_VOLTAR + '<span>' + (rotulo || 'Voltar') + '</span>' }));
    dentro.appendChild(el('span', { class: 'titulo-topo', text: titulo }));
    dentro.appendChild(el('span', { class: 'topo-espaco', 'aria-hidden': 'true' }));
    topo.appendChild(dentro);
  }
  /* título pequeno da barra só aparece quando o título grande sai da tela */
  function ligarTitulo() {
    var h = app.querySelector('h1');
    if (topo.hidden || !h || !window.IntersectionObserver) return;
    topo.classList.remove('rolou');
    obsTitulo = new IntersectionObserver(function (es) { topo.classList.toggle('rolou', !es[0].isIntersecting); }, { rootMargin: '-52px 0px 0px 0px' });
    obsTitulo.observe(h);
  }
  function desenharRodape(oculto) {
    rodape.innerHTML = '';
    rodape.hidden = oculto || !ctx.app.assinatura;
    if (rodape.hidden) return;
    rodape.appendChild(el('img', { src: ICONE, alt: '', width: 16, height: 16 }));
    rodape.appendChild(el('span', { text: ctx.app.assinatura }));
  }
  function telaErro(msg, destino) {
    app.innerHTML = '';
    app.appendChild(el('p', { class: 'erro', text: msg }));
    app.appendChild(el('a', { class: 'btn sec', href: '#' + destino, text: 'Voltar' }));
  }

  /* ---------- dados do aluno ---------- */
  function carregarBase() {
    return getJson('data/disciplinas.json').then(function (d) {
      ctx.disciplinas = d;
      ctx.app = d.app || ctx.app;
      if (ctx.app.nome) document.title = ctx.app.nome;
    });
  }
  /* O RGM é conferido no servidor (POST /entrar), que devolve só as disciplinas do aluno.
     O aparelho guarda as disciplinas (e.acesso), nunca o RGM.
     Resolve com {codigos, teste} ou null (RGM não encontrado); rejeita com 'limite' ou erro de rede. */
  function codigosDo(rgm) {
    if (window.SONDA_DEMO) { // preview no claude.ai: sem servidor, mostra as disciplinas ativas
      return Promise.resolve({ codigos: ctx.disciplinas.disciplinas.filter(function (d) { return d.status === 'ativa'; }).map(function (d) { return d.codigo; }), teste: true });
    }
    if (!ctx.app.envio) return Promise.reject(new Error('sem servidor'));
    return fetch(ctx.app.envio.replace(/\/+$/, '') + '/entrar', { method: 'POST', body: JSON.stringify({ rgm: rgm }) }).then(function (r) {
      if (r.status === 404) return null;
      if (r.status === 429) throw new Error('limite');
      if (!r.ok) throw new Error('entrar ' + r.status);
      return r.json().then(function (j) { return { codigos: Array.isArray(j.codigos) ? j.codigos : [], teste: !!j.teste }; });
    });
  }
  function guardarAcesso(a) {
    mudar(function (e) { delete e.rgm; e.acesso = { cods: a.codigos, teste: a.teste }; });
    ctx.codigos = a.codigos; ctx.teste = a.teste;
  }
  function garantirAluno() {
    return carregarBase().then(function () {
      if (ctx.codigos) return ctx.codigos;
      var est = ler();
      if (est.acesso && Array.isArray(est.acesso.cods)) {
        ctx.codigos = est.acesso.cods.filter(function (c) { return typeof c === 'string' && disc(c); });
        ctx.teste = !!est.acesso.teste;
        return ctx.codigos;
      }
      if (!est.rgm) return null;
      // aparelho da versão anterior, que guardava o RGM: confere uma vez no servidor e apaga o RGM
      return codigosDo(String(est.rgm)).then(function (a) {
        if (!a) { apagarRgm(); return null; }
        guardarAcesso(a); return ctx.codigos;
      }, function () {
        // sem internet ou limite do servidor: não trava o app na tela de erro;
        // apaga o RGM antigo e manda para a tela de entrada, onde o aluno digita de novo
        apagarRgm(); return null;
      });
    });
  }
  function disc(cod) {
    return ctx.disciplinas.disciplinas.filter(function (d) { return d.codigo === cod; })[0];
  }

  /* ---------- envio para o painel da turma ---------- */
  /* Sai do aparelho só o que está em cada evento: disciplina, tema, questão ou cartão, alternativa marcada e se acertou.
     Não vai RGM nem nada derivado dele: est.aid é um número sorteado aqui, que só serve para contar aparelhos.
     Sem endereço em disciplinas.json (app.envio) nada é enviado; o RGM de teste também não envia. */
  var enviando = false;
  function sorteio() {
    var b = new Uint8Array(16); crypto.getRandomValues(b);
    return Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  function enviar(ev) {
    if (!ctx.app.envio || ctx.teste) return;
    mudar(function (e) {
      if (!/^[0-9a-f]{32}$/.test(e.aid || '')) e.aid = sorteio();
      e.pend = (Array.isArray(e.pend) ? e.pend : []).concat([ev]).slice(-200);
    });
    despachar();
  }
  /* manda até 50 eventos pendentes; o que não chegar fica guardado e vai na próxima */
  function despachar(saindo) {
    var est = ler(), pend = Array.isArray(est.pend) ? est.pend : [];
    if (!ctx.app.envio || ctx.teste || !pend.length || !est.aid || enviando) return;
    var lote = pend.slice(0, 50), url = ctx.app.envio.replace(/\/+$/, '') + '/e';
    var corpo = JSON.stringify({ aid: est.aid, ev: lote });
    function tirar() { mudar(function (e) { e.pend = (Array.isArray(e.pend) ? e.pend : []).slice(lote.length); if (!e.pend.length) delete e.pend; }); }
    if (saindo) { try { if (navigator.sendBeacon && navigator.sendBeacon(url, corpo)) tirar(); } catch (e) {} return; }
    enviando = true;
    fetch(url, { method: 'POST', body: corpo, keepalive: true }).then(function (r) {
      enviando = false;
      if (r.ok) { tirar(); despachar(); }
    }).catch(function () { enviando = false; });
  }
  window.addEventListener('pagehide', function () { despachar(true); });

  /* ---------- roteamento ---------- */
  function rota() {
    var h = (location.hash || '').replace(/^#/, '');
    return h;
  }
  function ir(h) { if (location.hash === '#' + h) render(); else location.hash = h; }

  function render() {
    var h = rota();
    flashSes = null; quizSes = null;
    garantirAluno().then(function (codigos) {
      if (codigos) despachar();
      desenharRodape(h === 'entrada' || !h);
      if (!h) { return ir(codigos ? 'minhas' : 'entrada'); }
      if (h === 'entrada') return telaEntrada();
      if (!codigos) { ctx.codigos = null; return ir('entrada'); }
      if (h === 'minhas') return telaMinhas(codigos);
      if (h.indexOf('d-') === 0) return telaDisciplina(h.slice(2), codigos);
      if (h.indexOf('t-') === 0) return telaTopico(h.slice(2), codigos);
      if (h.indexOf('r-') === 0) return telaRevisao(h.slice(2), codigos);
      ir('minhas');
    }).catch(function (e) {
      cabecalho(null);
      telaErro('Não foi possível carregar os dados. Tente recarregar a página.', 'entrada');
      if (window.console) console.error(e);
    });
    window.scrollTo(0, 0);
  }

  /* ---------- entrada ---------- */
  function telaEntrada() {
    cabecalho(null);
    app.innerHTML = '';
    var msg = el('p', { class: 'erro', id: 'msg-erro', role: 'alert' });
    var campo = el('input', { type: 'text', id: 'rgm', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', required: true });
    var form = el('form', null, [
      el('label', { for: 'rgm', text: 'RGM' }), campo, msg,
      el('button', { class: 'btn', type: 'submit', text: 'Entrar' })
    ]);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var rgm = campo.value.replace(/\D/g, '');
      msg.textContent = '';
      if (!rgm) { msg.textContent = 'Digite o seu RGM (só números).'; return; }
      carregarBase().then(function () { return codigosDo(rgm); }).then(function (a) {
        if (!a || !a.codigos.length) { msg.textContent = 'RGM não encontrado nas turmas do Prof. Pedro neste semestre. Confira o número ou fale com o professor.'; return; }
        guardarAcesso(a);
        ir('minhas');
      }).catch(function (e) {
        msg.textContent = e && e.message === 'limite'
          ? 'Muitas tentativas seguidas. Espere um minuto e tente de novo.'
          : 'Não foi possível verificar agora. Confira a internet e tente novamente.';
      });
    });
    app.appendChild(el('section', { class: 'entrada' }, [
      el('img', { class: 'marca-app', src: ICONE, alt: '', width: 64, height: 64 }),
      el('h1', { class: 'large-title', text: ctx.app.nome }),
      el('p', { class: 'assinatura', text: ctx.app.assinatura }),
      el('p', { class: 'muted', text: 'Resumos, flashcards e quiz das disciplinas do Prof. Pedro Minim.' }),
      form
    ]));
  }

  /* ---------- minhas disciplinas ---------- */
  function provaTxt(p) {
    if (!p) return null;
    var n = diasAte(p.data);
    if (n < 0) return null;
    return { txt: 'Próxima prova: ' + p.nome + ', ' + dataBr(p.data), dias: (n === 0 ? 'é hoje' : n === 1 ? 'falta 1 dia' : 'faltam ' + n + ' dias') };
  }
  function telaMinhas(codigos) {
    cabecalho(null);
    app.innerHTML = '';
    app.appendChild(el('h1', { class: 'large-title', text: 'Minhas disciplinas' }));
    app.appendChild(el('p', { class: 'muted', text: ctx.disciplinas.professor + ' · ' + ctx.disciplinas.instituicao + ' · ' + ctx.disciplinas.semestre }));
    var lista = el('div', { class: 'cards' });
    codigos.forEach(function (cod) {
      var d = disc(cod); if (!d) return;
      var ativa = d.status === 'ativa';
      var turmas = el('ul', null, d.turmas.map(function (t) {
        var p = provaTxt(t.proximaProva);
        return el('li', null, [t.nome + (p ? ' — ' + p.txt + ' ' : ''), p ? el('span', { class: 'selo dias', text: p.dias, style: 'margin-top:0' }) : null]);
      }));
      var corpo = [el('h3', { text: d.nome }), el('div', { class: 'sigla', text: d.sigla + ' · ' + d.codigo }), turmas];
      if (!ativa) corpo.push(el('span', { class: 'selo breve', text: 'Conteúdo em breve' }));
      lista.appendChild(ativa
        ? el('a', { class: 'cartao', href: '#d-' + d.codigo, 'data-disc': d.codigo }, corpo)
        : el('div', { class: 'cartao desab', 'aria-disabled': 'true', 'data-disc': d.codigo, 'data-breve': '1' }, corpo));
    });
    app.appendChild(lista);
    app.appendChild(el('button', { class: 'link-discreto', type: 'button', text: 'Trocar RGM', onclick: function () { apagarRgm(); ir('entrada'); } }));
  }

  /* ---------- progresso ---------- */
  function progressoTopico(slug, top) {
    var est = ler();
    var qz = (est.quiz && est.quiz[slug]) || {}, fl = (est.flash && est.flash[slug]) || {};
    var resp = 0, ac = 0;
    (top.questoes || []).forEach(function (q) { var r = qz[q.id]; if (r) { resp++; if (r.ok) ac++; } });
    var dom = 0;
    (top.flashcards || []).forEach(function (f) { if (fl[f.id]) dom++; });
    return { resp: resp, ac: ac, nq: (top.questoes || []).length, dom: dom, nf: (top.flashcards || []).length, erradas: resp - ac };
  }

  /* ---------- fila de revisão ---------- */
  /* est.fila[slug][idQuestao] = { p: índice do intervalo, em: 'AAAA-MM-DD' (dia em que a questão volta) } */
  function entradaValida(e) {
    return !!e && typeof e === 'object' && (e.p === 0 || e.p === 1 || e.p === 2) && typeof e.em === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.em);
  }
  function objeto(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  /* a regra única: toda resposta de quiz passa por aqui, dentro do mesmo mudar() que grava a resposta */
  function regraFila(est, slug, id, ok) {
    var hoje = hojeIso();
    if (!ok) {
      if (!objeto(est.fila)) est.fila = {};
      if (!objeto(est.fila[slug])) est.fila[slug] = {};
      est.fila[slug][id] = { p: 0, em: somaDias(hoje, INTERVALOS[0]) };
      return;
    }
    var tema = objeto(est.fila) && objeto(est.fila[slug]) ? est.fila[slug] : null;
    var e = tema ? tema[id] : null;
    if (!entradaValida(e) || e.em > hoje) return;
    if (e.p < INTERVALOS.length - 1) tema[id] = { p: e.p + 1, em: somaDias(hoje, INTERVALOS[e.p + 1]) };
    else {
      delete tema[id];
      if (!Object.keys(tema).length) delete est.fila[slug];
    }
  }
  /* cod = disciplina em que o aluno está; alt = posição da alternativa no arquivo do tema; rev = veio da revisão */
  function gravarResposta(slug, id, esc, ok, cod, alt, rev) {
    var prim = false;
    mudar(function (e) {
      e.quiz = e.quiz || {}; e.quiz[slug] = e.quiz[slug] || {};
      prim = !e.quiz[slug][id];
      e.quiz[slug][id] = { esc: esc, ok: ok };
      regraFila(e, slug, id, ok);
    });
    enviar({ t: 'q', c: cod, s: slug, i: id, a: alt, ok: ok ? 1 : 0, p: prim ? 1 : 0, r: rev ? 1 : 0 });
  }
  /* entradas válidas da fila de uma disciplina (tema com conteúdo, questão que existe, entrada bem formada) */
  function filaValida(abertos, porSlug) {
    var f = ler().fila, out = [];
    if (!objeto(f)) return out;
    abertos.forEach(function (t, ordem) {
      var dados = porSlug[t.slug], ft = f[t.slug];
      if (!dados || !objeto(ft)) return;
      var porId = {};
      (dados.questoes || []).forEach(function (q) { porId[q.id] = q; });
      Object.keys(ft).forEach(function (id) {
        var e = ft[id];
        if (!Object.prototype.hasOwnProperty.call(porId, id) || !entradaValida(e)) return;
        out.push({ slug: t.slug, titulo: t.titulo, ordem: ordem, q: porId[id], top: dados, p: e.p, em: e.em });
      });
    });
    return out;
  }
  function carregarTemas(cod) {
    return getJson('data/' + cod + '/topicos.json').then(function (tj) {
      var abertos = tj.topicos.filter(function (t) { return t.status !== 'em-breve'; });
      return Promise.all(abertos.map(function (t) {
        /* tema compartilhado: o arquivo mora na disciplina de origem, como na tela do tema */
        return getJson('data/' + (t.compartilhadoDe || cod) + '/topicos/' + t.slug + '.json').catch(function () { return null; });
      })).then(function (dados) {
        var porSlug = {}; abertos.forEach(function (t, i) { porSlug[t.slug] = dados[i]; });
        return { tj: tj, abertos: abertos, porSlug: porSlug };
      });
    });
  }

  /* ---------- disciplina ---------- */
  var STATUS = { 'pronto': ['pronto', 'Pronto'], 'em-revisao': ['revisao', 'Em revisão pelo professor'], 'em-breve': ['breve', 'Conteúdo em breve'] };
  function telaDisciplina(cod, codigos) {
    var d = disc(cod);
    if (!d || codigos.indexOf(cod) < 0 || d.status !== 'ativa') return ir('minhas');
    cabecalho(d.sigla, 'minhas', 'Disciplinas');
    app.innerHTML = '';
    carregarTemas(cod).then(function (r) {
      var tj = r.tj, abertos = r.abertos, porSlug = r.porSlug;
      {
        app.appendChild(el('h1', { class: 'large-title', text: d.nome }));
        var painelRev = painelRevisar(cod, filaValida(abertos, porSlug));
        if (painelRev) app.appendChild(painelRev);
        var painelDes = painelDesempenho(d, abertos, porSlug);
        if (painelDes) app.appendChild(painelDes);
        var areas = d.areas && d.areas.length ? d.areas.slice() : [];
        tj.topicos.forEach(function (t) { if (areas.indexOf(t.area) < 0) areas.push(t.area); });
        ligarTitulo();
        areas.forEach(function (a) {
          var tops = tj.topicos.filter(function (t) { return t.area === a; });
          if (!tops.length) return;
          var sec = el('section', { class: 'area' }, [el('h2', { text: a })]);
          var cards = el('div', { class: 'cards' });
          tops.forEach(function (t) { cards.appendChild(cartaoTopico(t, porSlug[t.slug])); });
          sec.appendChild(cards); app.appendChild(sec);
        });
      }
    }).catch(function () { telaErro('Não foi possível carregar os tópicos.', 'minhas'); });
  }
  function cartaoTopico(t, dados) {
    var st = STATUS[t.status] || STATUS['em-breve'];
    var corpo = [el('h3', { text: t.titulo }), el('p', { class: 'muted pequeno', text: t.resumoCurto, style: 'margin:4px 0 0' }),
      el('span', { class: 'selo ' + st[0], text: st[1] })];
    if (t.status === 'em-breve') return el('div', { class: 'cartao desab', 'aria-disabled': 'true', 'data-topico': t.slug }, corpo);
    var wrap = el('div', { class: 'cartao', 'data-topico': t.slug });
    var link = el('a', { href: '#t-' + t.slug, style: 'text-decoration:none;color:inherit;display:block' }, corpo);
    wrap.appendChild(link);
    if (dados) {
      var p = progressoTopico(t.slug, dados);
      wrap.appendChild(el('div', { class: 'progresso' }, [
        el('span', { class: 'prog-quiz', text: 'Quiz: ' + p.ac + '/' + p.nq + ' acertos' + (p.resp ? ' (' + p.resp + ' respondidas)' : '') }),
        el('span', { class: 'prog-flash', text: 'Flashcards: ' + p.dom + '/' + p.nf + ' dominados' })
      ]));
      var b = el('button', { class: 'btn sec errei-bloco', type: 'button', 'data-errei': t.slug, text: 'Estudar o que errei', disabled: p.erradas === 0,
        onclick: function () { filtroErradas = true; mudar(function (e) { e.aba = 'quiz'; }); ir('t-' + t.slug); } });
      wrap.appendChild(b);
    }
    return wrap;
  }

  /* ---------- para revisar hoje ---------- */
  function painelRevisar(cod, itens) {
    if (!itens.length) return null;
    var hoje = hojeIso();
    var venc = itens.filter(function (i) { return i.em <= hoje; });
    var sec = el('section', { class: 'revisar', 'data-revisar': '1' }, [el('h2', { text: 'Para revisar hoje' })]);
    if (!venc.length) {
      var prox = itens.reduce(function (m, i) { return i.em < m ? i.em : m; }, itens[0].em);
      var n = itens.filter(function (i) { return i.em === prox; }).length;
      sec.appendChild(el('p', { class: 'muted pequeno', 'data-revisar-vazia': '1', text: 'Nada para hoje. Próxima revisão: ' + dataBr(prox) + ' (' + rotQuestoes(n) + ').' }));
      return sec;
    }
    sec.appendChild(el('p', { class: 'muted pequeno', text: 'Questões que você errou voltam aqui no dia marcado.' }));
    var grupos = {}, ordemG = [];
    venc.forEach(function (i) {
      if (!grupos[i.slug]) { grupos[i.slug] = { slug: i.slug, titulo: i.titulo, ordem: i.ordem, n: 0 }; ordemG.push(i.slug); }
      grupos[i.slug].n++;
    });
    var linhas = ordemG.map(function (s) { return grupos[s]; }).sort(function (a, b) { return (b.n - a.n) || (a.ordem - b.ordem); });
    sec.appendChild(el('div', { class: 'revisar-lista' }, linhas.map(function (g) {
      return el('div', { class: 'revisar-linha', 'data-revisar-tema': g.slug, 'data-qtd': g.n }, [
        el('span', { class: 'revisar-nome', text: g.titulo }),
        el('span', { class: 'revisar-qtd', text: rotQuestoes(g.n) })]);
    })));
    sec.appendChild(el('a', { class: 'btn', href: '#r-' + cod, 'data-acao': 'revisar', text: 'Começar a revisão · ' + rotQuestoes(venc.length) }));
    sec.appendChild(el('p', { class: 'privacidade', text: 'Errou: volta amanhã. Acertou no dia marcado: volta mais tarde, e depois da terceira vez sai da fila. A fila fica guardada só neste aparelho.' }));
    return sec;
  }

  /* ---------- painel de desempenho ---------- */
  var SVG_NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs, filhos) {
    var n = document.createElementNS(SVG_NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (attrs[k] != null && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    });
    (filhos || []).forEach(function (f) { if (f) n.appendChild(f); });
    return n;
  }
  function rodadasDe(slug) {
    var r = (ler().rodadas || {})[slug];
    if (!Array.isArray(r)) return [];
    return r.filter(function (x) { return x && typeof x.ac === 'number' && typeof x.n === 'number' && x.n > 0; });
  }
  function dataRodada(em) {
    var d = new Date(em);
    if (isNaN(d.getTime())) return '--/--';
    function z(n) { return (n < 10 ? '0' : '') + n; }
    return z(d.getDate()) + '/' + z(d.getMonth() + 1);
  }
  function listaE(itens) {
    if (itens.length < 2) return itens.join('');
    return itens.slice(0, -1).join(', ') + ' e ' + itens[itens.length - 1];
  }
  var NUM_EXT = ['zero', 'uma', 'duas', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito'];
  function graficoEvolucao(pts) {
    var W = 300, H = 108, X0 = 44, X1 = 276, YB = 88, YT = 24;
    var n = pts.length, nmax = 0, mesmoN = true;
    pts.forEach(function (r) { if (r.n > nmax) nmax = r.n; if (r.n !== pts[0].n) mesmoN = false; });
    var xs = pts.map(function (r, i) { return n === 1 ? (X0 + X1) / 2 : X0 + i * (X1 - X0) / (n - 1); });
    var ys = pts.map(function (r) { return YB - (r.ac / r.n) * (YB - YT); });
    function f(v) { return String(Math.round(v * 10) / 10); }
    var filhos = [
      svgEl('line', { class: 'ev-base', x1: 28, y1: YB, x2: 292, y2: YB }),
      svgEl('line', { class: 'ev-max', x1: 28, y1: YT, x2: 292, y2: YT, 'stroke-dasharray': '3 3' }),
      svgEl('text', { class: 'ev-eixo', x: 12, y: YB + 3, 'text-anchor': 'middle', text: '0' }),
      svgEl('text', { class: 'ev-eixo', x: 12, y: YT + 3, 'text-anchor': 'middle', text: String(nmax) })
    ];
    if (n > 1) filhos.push(svgEl('polyline', { class: 'ev-linha', points: xs.map(function (x, i) { return f(x) + ',' + f(ys[i]); }).join(' ') }));
    pts.forEach(function (r, i) {
      var ult = i === n - 1;
      filhos.push(svgEl('circle', { class: 'pt' + (ult ? ' ult' : ''), cx: f(xs[i]), cy: f(ys[i]), r: ult ? 5 : 4 }));
      filhos.push(svgEl('text', { class: 'ev-num', x: f(xs[i]), y: f(ys[i] - 9), 'text-anchor': 'middle', text: mesmoN ? String(r.ac) : r.ac + '/' + r.n }));
      filhos.push(svgEl('text', { class: 'ev-data', x: f(xs[i]), y: H - 4, 'text-anchor': 'middle', text: dataRodada(r.em) }));
    });
    var rot = mesmoN
      ? listaE(pts.map(function (r) { return String(r.ac); })) + (n === 1 && pts[0].ac === 1 ? ' acerto' : ' acertos') + ' em ' + pts[0].n
      : listaE(pts.map(function (r) { return r.ac + ' de ' + r.n; })) + ' acertos';
    var qtd = n === 1 ? 'em uma rodada' : 'em ' + (NUM_EXT[n] || n) + ' rodadas';
    return svgEl('svg', { class: 'ev-svg', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Evolução no quiz: ' + rot + ', ' + qtd }, filhos);
  }
  function regiaoEvolucao(slug, idReg, rods) {
    var compl = rods.filter(function (r) { return !r.parcial; });
    var temParcial = rods.length > compl.length;
    var reg = el('div', { class: 'desemp-evol', id: idReg, 'data-evolucao': slug, hidden: true });
    if (!compl.length) {
      reg.setAttribute('data-rodadas', '0');
      reg.appendChild(el('p', { class: 'muted pequeno', text: 'Ainda não há rodada completa do quiz registrada neste aparelho. A linha de evolução começa na próxima vez que você terminar o quiz deste tema.' }));
    } else {
      var pts = compl.slice(-8);
      reg.setAttribute('data-rodadas', String(pts.length));
      reg.appendChild(graficoEvolucao(pts));
      var p1 = pts[0], p2 = pts[pts.length - 1];
      var mesmoN = pts.every(function (r) { return r.n === p1.n; });
      var leg;
      if (pts.length === 1) leg = '1 rodada · ' + p1.ac + (p1.ac === 1 ? ' acerto' : ' acertos') + ' em ' + p1.n;
      else if (mesmoN) leg = pts.length + ' rodadas · de ' + p1.ac + ' para ' + p2.ac + ' acertos em ' + p1.n;
      else leg = pts.length + ' rodadas · de ' + p1.ac + '/' + p1.n + ' para ' + p2.ac + '/' + p2.n + ' acertos';
      reg.appendChild(el('p', { class: 'muted pequeno ev-leg', text: leg }));
    }
    if (temParcial && compl.length) reg.appendChild(el('p', { class: 'muted pequeno ev-leg', text: 'As rodadas só com as erradas não entram na linha.' }));
    reg.appendChild(el('a', { class: 'btn sec', href: '#t-' + slug, text: 'Abrir o tema' }));
    return reg;
  }
  function faixa(rotulo, cls, num, den) {
    var pct = den ? Math.round(100 * num / den) : 0;
    return el('span', { class: 'faixa' }, [
      el('span', { class: 'faixa-rot', text: rotulo }),
      el('span', { class: 'barra', 'aria-hidden': 'true' }, [el('span', { class: 'barra-in ' + cls, style: 'width:' + pct + '%' })]),
      el('span', { class: 'faixa-num', text: num + '/' + den })
    ]);
  }
  function painelDesempenho(d, abertos, porSlug) {
    var itens = [], total = 0;
    abertos.forEach(function (t, ordem) {
      var dados = porSlug[t.slug]; if (!dados) return;
      total++;
      var p = progressoTopico(t.slug, dados), rods = rodadasDe(t.slug);
      if (p.resp > 0 || p.dom > 0 || rods.length > 0) itens.push({ slug: t.slug, titulo: t.titulo, p: p, rods: rods, ordem: ordem });
    });
    if (!itens.length) return null;
    function fr(a, b) { return b ? a / b : 0; }
    itens.sort(function (a, b) {
      return (fr(a.p.ac, a.p.nq) - fr(b.p.ac, b.p.nq)) || (fr(a.p.dom, a.p.nf) - fr(b.p.dom, b.p.nf)) || (a.ordem - b.ordem);
    });
    var sec = el('section', { class: 'desempenho', 'data-desempenho': '1' });
    sec.appendChild(el('h2', { text: 'Seu desempenho em ' + d.sigla }));
    sec.appendChild(el('p', { class: 'muted pequeno desemp-cont', text: itens.length + ' de ' + total + ' temas começados' }));
    (d.turmas || []).forEach(function (t) {
      var pr = provaTxt(t.proximaProva); if (!pr) return;
      sec.appendChild(el('p', { class: 'muted pequeno desemp-prova' }, [
        t.proximaProva.nome + ' · ' + t.nome.replace(/\s*[—–]\s*/g, ' · ') + ' ',
        el('span', { class: 'selo dias', text: pr.dias })
      ]));
    });
    var lista = el('div', { class: 'desemp-lista' });
    itens.forEach(function (it) {
      var idReg = 'evol-' + it.slug;
      var reg = regiaoEvolucao(it.slug, idReg, it.rods);
      var btn = el('button', { class: 'desemp-linha', type: 'button', 'aria-expanded': 'false', 'aria-controls': idReg,
        'data-desemp-tema': it.slug, 'data-quiz': it.p.ac + '/' + it.p.nq, 'data-flash': it.p.dom + '/' + it.p.nf }, [
        el('span', { class: 'desemp-cab' }, [el('span', { class: 'desemp-titulo', text: it.titulo }), el('span', { class: 'desemp-chev', 'aria-hidden': 'true' })]),
        faixa('Quiz', 'q', it.p.ac, it.p.nq),
        faixa('Flashcards', 'f', it.p.dom, it.p.nf)
      ]);
      btn.addEventListener('click', function () {
        var abre = btn.getAttribute('aria-expanded') !== 'true';
        btn.setAttribute('aria-expanded', abre ? 'true' : 'false');
        reg.hidden = !abre;
      });
      lista.appendChild(el('div', { class: 'desemp-item' }, [btn, reg]));
    });
    sec.appendChild(lista);
    /* com muitos temas começados, só os mais fracos ficam à vista; o resto abre por um botão */
    var VISIVEIS = 5;
    if (itens.length > VISIVEIS) {
      var extras = Array.prototype.slice.call(lista.children, VISIVEIS);
      var txtTodos = 'Mostrar os ' + itens.length + ' temas começados', txtMenos = 'Mostrar só os ' + VISIVEIS + ' mais fracos';
      extras.forEach(function (n) { n.hidden = true; });
      var todos = el('button', { class: 'btn sec desemp-todos', type: 'button', 'data-desemp-todos': '1', 'aria-expanded': 'false', text: txtTodos });
      todos.addEventListener('click', function () {
        var abre = todos.getAttribute('aria-expanded') !== 'true';
        todos.setAttribute('aria-expanded', abre ? 'true' : 'false');
        todos.textContent = abre ? txtMenos : txtTodos;
        extras.forEach(function (n) { n.hidden = !abre; });
      });
      sec.appendChild(todos);
    }
    sec.appendChild(el('p', { class: 'privacidade', text: 'Seu desempenho individual fica só neste aparelho; se você trocar de aparelho ou limpar os dados do navegador, ele recomeça. As respostas são enviadas sem nome nem RGM para o professor acompanhar a turma, e são apagadas no fim do semestre.' }));
    return sec;
  }

  /* ---------- tópico ---------- */
  function acharTopico(slug, codigos) {
    var ativos = codigos.filter(function (c) { var d = disc(c); return d && d.status === 'ativa'; });
    return Promise.all(ativos.map(function (c) { return getJson('data/' + c + '/topicos.json').then(function (tj) { return { cod: c, tj: tj }; }); })).then(function (rs) {
      for (var i = 0; i < rs.length; i++) {
        var t = rs[i].tj.topicos.filter(function (x) { return x.slug === slug && x.status !== 'em-breve'; })[0];
        if (t) return { cod: rs[i].cod, meta: t };
      }
      return null;
    });
  }
  function telaTopico(slug, codigos) {
    var dest = destinoResumo; destinoResumo = null;
    if (dest && dest.slug !== slug) dest = null;
    acharTopico(slug, codigos).then(function (ach) {
      if (!ach) { cabecalho('Tópico', 'minhas'); return telaErro('Tópico não encontrado.', 'minhas'); }
      return getJson('data/' + (ach.meta.compartilhadoDe || ach.cod) + '/topicos/' + slug + '.json').then(function (top) {
        cabecalho(top.titulo, 'd-' + ach.cod, disc(ach.cod).sigla);
        app.innerHTML = '';
        var cab = el('div', { class: 'cab-topico' }, [el('h1', { class: 'large-title', text: top.titulo }),
          el('div', { class: 'meta', text: top.area + ' · ' + top.origem })]);
        if (top.status === 'em-revisao') cab.appendChild(el('span', { class: 'selo revisao', text: 'Em revisão pelo professor' }));
        app.appendChild(cab);
        ligarTitulo();
        var aba = ler().aba; if (['resumo', 'flashcards', 'quiz'].indexOf(aba) < 0) aba = 'resumo';
        if (filtroErradas) aba = 'quiz';
        if (dest) { aba = 'resumo'; filtroErradas = false; }
        var painel = el('div', { id: 'painel', role: 'tabpanel' });
        var abas = el('div', { class: 'abas', role: 'tablist', 'data-sel': '0' });
        [['resumo', 'Resumo'], ['flashcards', 'Flashcards'], ['quiz', 'Quiz']].forEach(function (a) {
          abas.appendChild(el('button', { class: 'aba', type: 'button', role: 'tab', 'data-aba': a[0], 'aria-selected': 'false', text: a[1],
            onclick: function () { filtroErradas = false; mostrarAba(a[0]); } }));
        });
        function mostrarAba(nome, secId) {
          mudar(function (e) { e.aba = nome; });
          abas.setAttribute('data-sel', ['resumo', 'flashcards', 'quiz'].indexOf(nome));
          Array.prototype.forEach.call(abas.children, function (b) { b.setAttribute('aria-selected', b.getAttribute('data-aba') === nome ? 'true' : 'false'); });
          painel.innerHTML = '';
          if (nome === 'resumo') { abaResumo(painel, top); if (secId) irParaSecao(painel, secId); }
          else if (nome === 'flashcards') abaFlash(painel, top, ach.cod);
          else abaQuiz(painel, top, function (id) { mostrarAba('resumo', id); }, ach.cod);
        }
        app.appendChild(abas); app.appendChild(painel);
        mostrarAba(aba, dest ? dest.sec : null);
      });
    }).catch(function () { cabecalho('Tópico', 'minhas'); telaErro('Não foi possível carregar o tópico.', 'minhas'); });
  }

  function fonteRef(top, id) {
    var f = (top.fontes || []).filter(function (x) { return x.id === id; })[0];
    return f ? f.ref : id;
  }
  function fonteCurta(top, id) {
    var f = (top.fontes || []).filter(function (x) { return x.id === id; })[0];
    return f ? (f.curta || f.ref) : id;
  }
  function fonteTxt(top, id, onde) {
    return 'Fonte: ' + fonteRef(top, id) + (onde ? ' — ' + onde : '');
  }

  /* rola até uma seção do resumo, marca o destino e põe o foco nela (a margem de rolagem fica no CSS) */
  function irParaSecao(box, id) {
    var sec = null;
    Array.prototype.forEach.call(box.querySelectorAll('.secao'), function (n) { if (n.getAttribute('data-secao') === id) sec = n; });
    if (!sec) return;
    sec.setAttribute('data-destino', '1');
    sec.setAttribute('tabindex', '-1');
    function rolar() { sec.scrollIntoView({ block: 'start', behavior: 'auto' }); }
    try { sec.focus({ preventScroll: true }); } catch (e) { sec.focus(); }
    rolar();
    if (window.requestAnimationFrame) window.requestAnimationFrame(rolar);
  }

  /* resumo */
  function abaResumo(box, top) {
    var figs = top.figuras || [];
    function fig(f) {
      return el('figure', { class: 'figura' }, [
        el('img', { src: f.src, alt: f.alt || f.legenda || '', loading: 'lazy', width: f.largura || null, height: f.altura || null }),
        (f.legenda || f.credito) ? el('figcaption', null, [f.legenda || '', f.credito ? el('span', { class: 'credito', text: f.credito }) : null]) : null]);
    }
    (top.resumo || []).forEach(function (s) {
      var sec = el('section', { class: 'secao', 'data-secao': s.id }, [el('h2', { text: s.titulo }), md(s.texto),
        el('div', { class: 'fonte', text: fonteTxt(top, s.fonte, s.onde) })]);
      box.appendChild(sec);
      figs.filter(function (f) { return f.apos === s.id; }).forEach(function (f) { box.appendChild(fig(f)); });
    });
    var rod = el('section', { class: 'fontes-rodape' }, [el('h2', { text: 'Fontes' }),
      el('ul', null, (top.fontes || []).map(function (f) { return el('li', { text: f.ref }); }))]);
    box.appendChild(rod);
    box.querySelectorAll('.secao, .figura, .fontes-rodape').forEach(function (n, i) { if (i) n.style.marginTop = '28px'; });
  }

  /* flashcards */
  function abaFlash(box, top, cod) {
    var cards = top.flashcards || [];
    var porId = {}; cards.forEach(function (c) { porId[c.id] = c; });
    function dominados() { return (ler().flash || {})[top.slug] || {}; }
    function iniciar(ids) { flashSes = { fila: ids.slice(), total: ids.length, virado: false, erros: {}, }; desenhar(); }
    function pendentes() { var d = dominados(); return cards.filter(function (c) { return !d[c.id]; }).map(function (c) { return c.id; }); }
    function marcar(id, v) {
      mudar(function (e) { e.flash = e.flash || {}; e.flash[top.slug] = e.flash[top.slug] || {}; if (v) e.flash[top.slug][id] = true; else delete e.flash[top.slug][id]; });
      if (v) enviar({ t: 'f', c: cod, s: top.slug, i: id });
    }
    function desenhar() {
      box.innerHTML = '';
      var s = flashSes;
      if (!s.fila.length) return final();
      var c = porId[s.fila[0]];
      var feitos = s.total - s.fila.length;
      box.appendChild(el('div', { class: 'contador', 'data-contador': '1', text: (feitos + 1) + ' de ' + s.total }));
      var carta = el('button', { class: 'flash' + (s.virado ? ' verso' : ''), type: 'button', 'data-flash': s.virado ? 'verso' : 'frente',
        'aria-label': s.virado ? 'Verso do cartão. Toque para ver a frente.' : 'Frente do cartão. Toque para virar.',
        onclick: function () { s.virado = !s.virado; desenhar(); } });
      carta.appendChild(el('span', { class: 'lado', text: s.virado ? 'Resposta' : 'Pergunta' }));
      var corpo = md(s.virado ? c.verso : c.frente); carta.appendChild(corpo);
      if (s.virado) carta.appendChild(el('span', { class: 'fonte', text: fonteTxt(top, c.fonte, c.onde) }));
      box.appendChild(carta);
      if (!s.virado) { box.appendChild(el('div', { class: 'dica-virar', text: 'Toque no cartão para virar' })); return; }
      box.appendChild(el('div', { class: 'linha-botoes' }, [
        el('button', { class: 'btn bad', type: 'button', 'data-acao': 'errei', text: 'Errei', onclick: function () {
          s.erros[c.id] = true; s.fila.shift(); s.fila.push(c.id); s.virado = false; desenhar(); } }),
        el('button', { class: 'btn ok', type: 'button', 'data-acao': 'acertei', text: 'Acertei', onclick: function () {
          marcar(c.id, true); s.fila.shift(); s.virado = false; desenhar(); } })
      ]));
    }
    function final() {
      var s = flashSes, nerr = Object.keys(s.erros).length;
      var dom = cards.filter(function (c) { return dominados()[c.id]; }).length;
      var acertosDe1 = s.total - nerr;
      box.appendChild(el('div', { class: 'resumo-final', 'data-final': '1' }, [
        el('div', { class: 'grande', text: 'Você dominou ' + dom + ' de ' + cards.length }),
        s.total ? el('p', { class: 'muted', text: 'Nesta rodada, ' + acertosDe1 + ' de ' + s.total + ' de primeira.' }) : el('p', { class: 'muted', text: 'Todos os cartões já estão dominados.' }),
        nerr ? el('button', { class: 'btn', type: 'button', text: 'Repetir os que errei', onclick: function () { iniciar(Object.keys(s.erros)); } }) : null,
        el('button', { class: 'btn sec', type: 'button', text: 'Recomeçar', onclick: function () {
          mudar(function (e) { if (e.flash) delete e.flash[top.slug]; });
          iniciar(cards.map(function (c) { return c.id; })); } })
      ]));
    }
    iniciar(pendentes());
  }

  /* quiz: a questão na tela (comum à aba Quiz e à revisão; o.tema só na revisão, onde cada questão traz o tema dela) */
  function desenharQuestao(box, s, q, top, o) {
    box.appendChild(el('div', { class: 'contador', text: o.contador }));
    if (o.tema) box.appendChild(el('div', { class: 'rev-tema', 'data-revisao-tema': o.tema.slug, text: o.tema.titulo }));
    box.appendChild(el('p', { class: 'enunciado', text: q.enunciado }));
    if (!s.ordem[o.chave]) s.ordem[o.chave] = embaralhar(q.alternativas);
    var alts = s.ordem[o.chave];
    var certa = alts.findIndex(function (a) { return a.correta; });
    var altsBox = el('div', { class: 'alts' });
    alts.forEach(function (a, idx) {
      var resp = s.escolha !== null;
      var cls = 'alt' + (resp ? (idx === certa ? ' certa' : (idx === s.escolha ? ' errada' : '')) + (idx === s.escolha ? ' escolhida' : '') : '');
      altsBox.appendChild(el('button', { class: cls, type: 'button', 'data-alt': idx, disabled: resp,
        onclick: function () { o.aoResponder(idx, certa); } }, [
        el('span', { class: 'marca', 'aria-hidden': 'true', html: resp ? (idx === certa ? SVG_OK : (idx === s.escolha ? SVG_ERRO : '')) : '' }),
        el('span', { class: 'letra', text: 'ABCDEFG'[idx] + ')' }), el('span', { text: a.texto })]));
    });
    box.appendChild(altsBox);
    if (s.escolha !== null) {
      var ok = s.escolha === certa;
      var fb = el('div', { class: 'feedback', 'data-feedback': ok ? 'certa' : 'errada' }, [
        el('div', { class: 'veredito ' + (ok ? 'ok' : 'bad') }, [el('span', { class: 'marca', 'aria-hidden': 'true', html: ok ? SVG_OK : SVG_ERRO }), el('span', { text: ok ? 'Correto' : 'Errado' })])]);
      var grupoJust = el('div', { class: 'grupo' });
      alts.forEach(function (a, idx) {
        var marca = idx === certa ? 'Correta' : 'Errada';
        var p = el('div', { class: 'just' }, [el('strong', { class: idx === certa ? 'certa' : 'errada', text: 'ABCDEFG'[idx] + ') ' + marca + (idx === s.escolha ? ' (sua resposta)' : '') + '. ' }), a.justificativa]);
        if (a.fonte) p.appendChild(el('span', { class: 'fonte-alt', text: ' (' + fonteCurta(top, a.fonte) + (a.onde ? ' — ' + a.onde : '') + ')' }));
        if (idx === s.escolha) p.style.color = 'var(--fg)';
        grupoJust.appendChild(p);
      });
      fb.appendChild(grupoJust);
      fb.appendChild(el('div', { class: 'fonte pequeno muted', text: fonteTxt(top, q.fonte, q.onde) }));
      fb.appendChild(el('button', { class: 'btn', type: 'button', 'data-acao': 'proxima', text: s.i + 1 < s.fila.length ? 'Próxima' : 'Ver placar',
        onclick: function () { s.i++; s.escolha = null; o.aoAvancar(); window.scrollTo(0, 0); } }));
      box.appendChild(fb);
    }
  }
  function rolarFeedback(box) {
    var f = box.querySelector('.feedback'); if (f && f.scrollIntoView) f.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }
  /* uma linha de "O que reler"; tema (só na revisão) = { slug, titulo }; k = posição (o primeiro botão é o principal) */
  function linhaReler(l, k, titulo, tema, aoReler) {
    var erro = l.e > 0;
    var nome = el('span', { class: 'reler-nome', text: titulo });
    var quem = tema ? el('div', { class: 'reler-quem' }, [nome, el('span', { class: 'reler-tema', text: tema.titulo })]) : nome;
    var linha = el('div', { class: 'reler-linha' + (erro ? '' : ' certa'), 'data-reler-secao': l.id, 'data-reler-tema': tema ? tema.slug : false, 'data-erros': l.e, 'data-total': l.t }, [
      el('div', { class: 'reler-info' }, [quem, el('span', { class: 'reler-cont', text: (erro ? 'errou ' + l.e : 'acertou ' + l.t) + ' de ' + l.t })])]);
    if (erro) linha.appendChild(el('button', { class: 'btn reler-btn' + (k ? ' sec' : ''), type: 'button', 'data-acao': 'reler', text: 'Reler esta seção', onclick: aoReler }));
    return linha;
  }

  function abaQuiz(box, top, irResumo, cod) {
    var qs = top.questoes || [];
    function salvas() { return ((ler().quiz || {})[top.slug]) || {}; }
    function iniciar(lista, parcial) { quizSes = { fila: lista.slice(), i: 0, resp: {}, escolha: null, ordem: {}, gravada: false, parcial: !!parcial || lista.length !== qs.length }; desenhar(); }
    function desenhar() {
      var s = quizSes;
      box.innerHTML = '';
      if (s.i >= s.fila.length) return placar();
      var q = s.fila[s.i];
      desenharQuestao(box, s, q, top, { contador: 'Questão ' + (s.i + 1) + ' de ' + s.fila.length, chave: q.id,
        aoResponder: function (idx, certa) { responder(q, idx, certa); }, aoAvancar: desenhar });
    }
    function responder(q, idx, certa) {
      var s = quizSes; if (s.escolha !== null) return;
      s.escolha = idx; s.resp[q.id] = idx === certa;
      gravarResposta(top.slug, q.id, idx, idx === certa, cod, q.alternativas.indexOf(s.ordem[q.id][idx]), false);
      /* a rodada é gravada ao responder a última questão da fila, uma única vez por sessão */
      if (s.i === s.fila.length - 1 && !s.gravada) {
        s.gravada = true;
        var acs = 0; s.fila.forEach(function (x) { if (s.resp[x.id]) acs++; });
        var rod = { em: new Date().toISOString(), ac: acs, n: s.fila.length };
        if (s.parcial) rod.parcial = true;
        mudar(function (e) {
          e.rodadas = e.rodadas || {};
          var lst = Array.isArray(e.rodadas[top.slug]) ? e.rodadas[top.slug] : [];
          lst.push(rod);
          e.rodadas[top.slug] = lst.slice(-60);
        });
        enviar({ t: 'r', c: cod, s: top.slug, ac: acs, n: s.fila.length, pa: s.parcial ? 1 : 0 });
      }
      desenhar();
      rolarFeedback(box);
    }
    /* "O que reler": as questões da rodada agrupadas pela seção do resumo onde está a resposta */
    function relerBloco() {
      var s = quizSes, ordemSec = {}, titulos = {}, porSec = {}, ids = [];
      (top.resumo || []).forEach(function (r, i) { ordemSec[r.id] = i; titulos[r.id] = r.titulo; });
      s.fila.forEach(function (q) {
        if (!q.secao || ordemSec[q.secao] == null) return;
        if (!porSec[q.secao]) { porSec[q.secao] = { id: q.secao, e: 0, t: 0, ord: ordemSec[q.secao] }; ids.push(q.secao); }
        porSec[q.secao].t++;
        if (!s.resp[q.id]) porSec[q.secao].e++;
      });
      if (!ids.length) return null;
      var linhas = ids.map(function (i) { return porSec[i]; });
      var com = linhas.filter(function (l) { return l.e > 0; }).sort(function (a, b) {
        return (b.e - a.e) || (b.e * a.t - a.e * b.t) || (a.ord - b.ord);
      });
      var sem = linhas.filter(function (l) { return !l.e; }).sort(function (a, b) { return a.ord - b.ord; });
      var bl = el('section', { class: 'reler', 'data-reler': '1' }, [el('h2', { text: 'O que reler' })]);
      if (!com.length) {
        bl.appendChild(el('p', { class: 'muted', text: 'Nenhum erro nesta rodada: nada para reler agora.' }));
        return bl;
      }
      var lista = el('div', { class: 'reler-lista' });
      com.concat(sem).forEach(function (l, k) {
        lista.appendChild(linhaReler(l, k, titulos[l.id], null, function () { if (irResumo) irResumo(l.id); }));
      });
      bl.appendChild(lista);
      return bl;
    }
    function placar() {
      var s = quizSes;
      var erradas = s.fila.filter(function (q) { return !s.resp[q.id]; });
      var acertos = s.fila.length - erradas.length;
      box.appendChild(el('div', { class: 'resumo-final', 'data-placar': '1' }, [
        el('div', { class: 'grande', text: 'Você acertou ' + acertos + ' de ' + s.fila.length })]));
      var bloco = relerBloco();
      if (bloco) box.appendChild(bloco);
      if (erradas.length) {
        box.appendChild(el('h2', { text: 'Para rever' }));
        box.appendChild(el('ul', { class: 'lista-erradas' }, erradas.map(function (q) { return el('li', { text: q.enunciado }); })));
      }
      box.appendChild(el('div', { class: 'linha-botoes' }, [
        erradas.length ? el('button', { class: 'btn', type: 'button', text: 'Refazer as erradas', onclick: function () { iniciar(erradas, true); } }) : null,
        el('button', { class: 'btn sec', type: 'button', text: 'Refazer tudo', onclick: function () { iniciar(qs); } })
      ]));
    }
    var lista = qs, soErradas = false;
    if (filtroErradas) {
      var sv = salvas();
      var er = qs.filter(function (q) { return sv[q.id] && !sv[q.id].ok; });
      if (er.length) { lista = er; soErradas = true; }
      filtroErradas = false;
    }
    iniciar(lista, soErradas);
  }

  /* ---------- revisão de hoje (#r-<cod>) ---------- */
  function telaRevisao(cod, codigos) {
    var d = disc(cod);
    if (!d || codigos.indexOf(cod) < 0 || d.status !== 'ativa') return ir('minhas');
    cabecalho('Revisão de hoje', 'd-' + cod, d.sigla);
    app.innerHTML = '';
    carregarTemas(cod).then(function (r) {
      if (rota() !== 'r-' + cod) return;
      var hoje = hojeIso();
      var itens = embaralhar(filaValida(r.abertos, r.porSlug).filter(function (i) { return i.em <= hoje; }));
      app.appendChild(el('div', { class: 'cab-topico' }, [el('h1', { class: 'large-title', text: 'Revisão de hoje' }), el('div', { class: 'meta', text: d.sigla })]));
      ligarTitulo();
      var box = el('div', { class: 'rev-box' });
      app.appendChild(box);
      var voltar = function () { return el('a', { class: 'btn sec', href: '#d-' + cod, text: 'Voltar à disciplina' }); };
      if (!itens.length) {
        box.appendChild(el('p', { text: 'Nada para revisar hoje.' }));
        box.appendChild(voltar());
        return;
      }
      quizSes = { rev: true, cod: cod, fila: itens.map(function (i) { i.chave = i.slug + '/' + i.q.id; return i; }), i: 0, resp: {}, escolha: null, ordem: {} };
      desenharRevisao(box, voltar);
    }).catch(function () { telaErro('Não foi possível carregar a revisão.', 'd-' + cod); });
  }
  function desenharRevisao(box, voltar) {
    var s = quizSes;
    if (!s || !s.rev) return;
    box.innerHTML = '';
    if (s.i >= s.fila.length) return placarRevisao(box, s, voltar);
    var it = s.fila[s.i];
    desenharQuestao(box, s, it.q, it.top, { contador: 'Questão ' + (s.i + 1) + ' de ' + s.fila.length, chave: it.chave, tema: { slug: it.slug, titulo: it.titulo },
      aoResponder: function (idx, certa) {
        if (s.escolha !== null) return;
        s.escolha = idx; s.resp[it.chave] = idx === certa;
        gravarResposta(it.slug, it.q.id, idx, idx === certa, s.cod, it.q.alternativas.indexOf(s.ordem[it.chave][idx]), true);
        desenharRevisao(box, voltar);
        rolarFeedback(box);
      },
      aoAvancar: function () { desenharRevisao(box, voltar); } });
  }
  function fraseFimRevisao(e, a) {
    var pe = e === 1 ? 'A que você errou volta amanhã.' : 'As ' + e + ' que você errou voltam amanhã.';
    var pa = a === 1 ? 'A que você acertou volta mais tarde ou sai da fila.' : 'As ' + a + ' que você acertou voltam mais tarde ou saem da fila.';
    return (e ? pe : '') + (e && a ? ' ' : '') + (a ? pa : '');
  }
  function placarRevisao(box, s, voltar) {
    var erradas = s.fila.filter(function (i) { return !s.resp[i.chave]; });
    var acertos = s.fila.length - erradas.length;
    box.appendChild(el('div', { class: 'resumo-final', 'data-placar': '1' }, [
      el('div', { class: 'grande', text: 'Você acertou ' + acertos + ' de ' + s.fila.length }),
      el('p', { class: 'muted', 'data-revisao-fim': '1', text: fraseFimRevisao(erradas.length, acertos) })]));
    /* "O que reler": só as seções das questões erradas, uma linha por (tema, seção) */
    var grupos = {}, chaves = [];
    s.fila.forEach(function (i) {
      var ords = {}, titulos = {};
      (i.top.resumo || []).forEach(function (r, k) { ords[r.id] = k; titulos[r.id] = r.titulo; });
      var sec = i.q.secao;
      if (!sec || ords[sec] == null) return;
      var ch = i.slug + '|' + sec;
      if (!grupos[ch]) { grupos[ch] = { id: sec, slug: i.slug, tema: i.titulo, titulo: titulos[sec], e: 0, t: 0, ordTema: i.ordem, ord: ords[sec] }; chaves.push(ch); }
      grupos[ch].t++;
      if (!s.resp[i.chave]) grupos[ch].e++;
    });
    var com = chaves.map(function (c) { return grupos[c]; }).filter(function (g) { return g.e > 0; }).sort(function (a, b) {
      return (b.e - a.e) || (a.ordTema - b.ordTema) || (a.ord - b.ord);
    });
    if (com.length) {
      var lista = el('div', { class: 'reler-lista' });
      com.forEach(function (g, k) {
        lista.appendChild(linhaReler(g, k, g.titulo, { slug: g.slug, titulo: g.tema }, function () { destinoResumo = { slug: g.slug, sec: g.id }; ir('t-' + g.slug); }));
      });
      box.appendChild(el('section', { class: 'reler', 'data-reler': '1' }, [el('h2', { text: 'O que reler' }), lista]));
    }
    box.appendChild(el('div', { class: 'linha-botoes' }, [voltar()]));
  }


  window.addEventListener('hashchange', render);
  render();
})();
