(function () {
  'use strict';
  var CHAVE = 'estuda-odonto-v1';
  var app = document.getElementById('app');
  var topo = document.getElementById('topo');
  var cache = {};
  var ctx = { sal: null, alunos: null, disciplinas: null, codigos: null, app: { nome: '', assinatura: '' } };
  var rodape = document.getElementById('rodape');
  var obsTitulo = null;
  var linkIcone = document.querySelector('link[rel="icon"]');
  var ICONE = linkIcone ? linkIcone.getAttribute('href') : 'assets/favicon.svg';
  var filtroErradas = false;   // pedido de abrir o quiz só com as erradas
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
  function apagarRgm() { mudar(function (e) { delete e.rgm; }); ctx.codigos = null; }

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
  function sha256(txt) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    });
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
    return Promise.all([getJson('data/disciplinas.json'), getJson('data/alunos.json')]).then(function (r) {
      ctx.disciplinas = r[0]; ctx.sal = r[1].sal; ctx.alunos = r[1].alunos;
      ctx.app = r[0].app || ctx.app;
      if (ctx.app.nome) document.title = ctx.app.nome;
    });
  }
  function codigosDo(rgm) {
    return sha256(ctx.sal + ':' + rgm).then(function (h) { return ctx.alunos[h] || null; });
  }
  function garantirAluno() {
    return carregarBase().then(function () {
      var rgm = ler().rgm;
      if (!rgm) return null;
      if (ctx.codigos) return ctx.codigos;
      return codigosDo(rgm).then(function (c) { ctx.codigos = c; return c; });
    });
  }
  function disc(cod) {
    return ctx.disciplinas.disciplinas.filter(function (d) { return d.codigo === cod; })[0];
  }

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
      desenharRodape(h === 'entrada' || !h);
      if (!h) { return ir(codigos ? 'minhas' : 'entrada'); }
      if (h === 'entrada') return telaEntrada();
      if (!codigos) { ctx.codigos = null; return ir('entrada'); }
      if (h === 'minhas') return telaMinhas(codigos);
      if (h.indexOf('d-') === 0) return telaDisciplina(h.slice(2), codigos);
      if (h.indexOf('t-') === 0) return telaTopico(h.slice(2), codigos);
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
      carregarBase().then(function () { return codigosDo(rgm); }).then(function (c) {
        if (!c) { msg.textContent = 'RGM não encontrado nas turmas do Prof. Pedro neste semestre. Confira o número ou fale com o professor.'; return; }
        mudar(function (e) { e.rgm = rgm; });
        ctx.codigos = c;
        ir('minhas');
      }).catch(function () { msg.textContent = 'Não foi possível verificar agora. Tente novamente.'; });
    });
    app.appendChild(el('section', { class: 'entrada' }, [
      el('img', { class: 'marca-app', src: ICONE, alt: '', width: 64, height: 64 }),
      el('h1', { class: 'large-title', text: ctx.app.nome }),
      el('p', { class: 'assinatura', text: ctx.app.assinatura }),
      el('p', { class: 'muted', text: 'Resumos, flashcards e quiz das disciplinas do Prof. Pedro Minim.' }),
      form,
      el('p', { class: 'privacidade', text: 'Seu RGM fica só no seu aparelho. O app não guarda nome nem envia nada.' })
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

  /* ---------- disciplina ---------- */
  var STATUS = { 'pronto': ['pronto', 'Pronto'], 'em-revisao': ['revisao', 'Em revisão pelo professor'], 'em-breve': ['breve', 'Conteúdo em breve'] };
  function telaDisciplina(cod, codigos) {
    var d = disc(cod);
    if (!d || codigos.indexOf(cod) < 0 || d.status !== 'ativa') return ir('minhas');
    cabecalho(d.sigla, 'minhas', 'Disciplinas');
    app.innerHTML = '';
    getJson('data/' + cod + '/topicos.json').then(function (tj) {
      var abertos = tj.topicos.filter(function (t) { return t.status !== 'em-breve'; });
      return Promise.all(abertos.map(function (t) {
        return getJson('data/' + cod + '/topicos/' + t.slug + '.json').catch(function () { return null; });
      })).then(function (dados) {
        var porSlug = {}; abertos.forEach(function (t, i) { porSlug[t.slug] = dados[i]; });
        app.appendChild(el('h1', { class: 'large-title', text: d.nome }));
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
      });
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
        var painel = el('div', { id: 'painel', role: 'tabpanel' });
        var abas = el('div', { class: 'abas', role: 'tablist', 'data-sel': '0' });
        [['resumo', 'Resumo'], ['flashcards', 'Flashcards'], ['quiz', 'Quiz']].forEach(function (a) {
          abas.appendChild(el('button', { class: 'aba', type: 'button', role: 'tab', 'data-aba': a[0], 'aria-selected': 'false', text: a[1],
            onclick: function () { filtroErradas = false; mostrarAba(a[0]); } }));
        });
        function mostrarAba(nome) {
          mudar(function (e) { e.aba = nome; });
          abas.setAttribute('data-sel', ['resumo', 'flashcards', 'quiz'].indexOf(nome));
          Array.prototype.forEach.call(abas.children, function (b) { b.setAttribute('aria-selected', b.getAttribute('data-aba') === nome ? 'true' : 'false'); });
          painel.innerHTML = '';
          if (nome === 'resumo') abaResumo(painel, top);
          else if (nome === 'flashcards') abaFlash(painel, top);
          else abaQuiz(painel, top);
        }
        app.appendChild(abas); app.appendChild(painel);
        mostrarAba(aba);
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
  function abaFlash(box, top) {
    var cards = top.flashcards || [];
    var porId = {}; cards.forEach(function (c) { porId[c.id] = c; });
    function dominados() { return (ler().flash || {})[top.slug] || {}; }
    function iniciar(ids) { flashSes = { fila: ids.slice(), total: ids.length, virado: false, erros: {}, }; desenhar(); }
    function pendentes() { var d = dominados(); return cards.filter(function (c) { return !d[c.id]; }).map(function (c) { return c.id; }); }
    function marcar(id, v) {
      mudar(function (e) { e.flash = e.flash || {}; e.flash[top.slug] = e.flash[top.slug] || {}; if (v) e.flash[top.slug][id] = true; else delete e.flash[top.slug][id]; });
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

  /* quiz */
  function abaQuiz(box, top) {
    var qs = top.questoes || [];
    function salvas() { return ((ler().quiz || {})[top.slug]) || {}; }
    function iniciar(lista) { quizSes = { fila: lista.slice(), i: 0, resp: {}, escolha: null, ordem: {} }; desenhar(); }
    function embaralhar(arr) {
      var a = arr.slice();
      for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var tmp = a[i]; a[i] = a[j]; a[j] = tmp; }
      return a;
    }
    function desenhar() {
      var s = quizSes;
      box.innerHTML = '';
      if (s.i >= s.fila.length) return placar();
      var q = s.fila[s.i];
      box.appendChild(el('div', { class: 'contador', text: 'Questão ' + (s.i + 1) + ' de ' + s.fila.length }));
      box.appendChild(el('p', { class: 'enunciado', text: q.enunciado }));
      if (!s.ordem[q.id]) s.ordem[q.id] = embaralhar(q.alternativas);
      var alts = s.ordem[q.id];
      var certa = alts.findIndex(function (a) { return a.correta; });
      var altsBox = el('div', { class: 'alts' });
      alts.forEach(function (a, idx) {
        var resp = s.escolha !== null;
        var cls = 'alt' + (resp ? (idx === certa ? ' certa' : (idx === s.escolha ? ' errada' : '')) + (idx === s.escolha ? ' escolhida' : '') : '');
        altsBox.appendChild(el('button', { class: cls, type: 'button', 'data-alt': idx, disabled: resp,
          onclick: function () { responder(q, idx, certa); } }, [
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
          onclick: function () { s.i++; s.escolha = null; desenhar(); window.scrollTo(0, 0); } }));
        box.appendChild(fb);
      }
    }
    function responder(q, idx, certa) {
      var s = quizSes; if (s.escolha !== null) return;
      s.escolha = idx; s.resp[q.id] = idx === certa;
      mudar(function (e) { e.quiz = e.quiz || {}; e.quiz[top.slug] = e.quiz[top.slug] || {}; e.quiz[top.slug][q.id] = { esc: idx, ok: idx === certa }; });
      desenhar();
      var f = box.querySelector('.feedback'); if (f && f.scrollIntoView) f.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
    function placar() {
      var s = quizSes;
      var erradas = s.fila.filter(function (q) { return !s.resp[q.id]; });
      var acertos = s.fila.length - erradas.length;
      box.appendChild(el('div', { class: 'resumo-final', 'data-placar': '1' }, [
        el('div', { class: 'grande', text: 'Você acertou ' + acertos + ' de ' + s.fila.length })]));
      if (erradas.length) {
        box.appendChild(el('h2', { text: 'Para rever' }));
        box.appendChild(el('ul', { class: 'lista-erradas' }, erradas.map(function (q) { return el('li', { text: q.enunciado }); })));
      }
      box.appendChild(el('div', { class: 'linha-botoes' }, [
        erradas.length ? el('button', { class: 'btn', type: 'button', text: 'Refazer as erradas', onclick: function () { iniciar(erradas); } }) : null,
        el('button', { class: 'btn sec', type: 'button', text: 'Refazer tudo', onclick: function () { iniciar(qs); } })
      ]));
    }
    var lista = qs;
    if (filtroErradas) {
      var sv = salvas();
      var er = qs.filter(function (q) { return sv[q.id] && !sv[q.id].ok; });
      if (er.length) lista = er;
      filtroErradas = false;
    }
    iniciar(lista);
  }

  window.addEventListener('hashchange', render);
  render();
})();
