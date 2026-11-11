#!/usr/bin/env python3
"""Valida os dados do app (stdlib apenas). Sai com código 1 se algo falhar."""
import json, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
DATA = RAIZ / "data"
erros = []
resumos = []

def erro(msg): erros.append(msg)

def carregar(caminho):
    try:
        return json.loads(Path(caminho).read_text(encoding="utf-8"))
    except FileNotFoundError:
        erro(f"{caminho.relative_to(RAIZ)}: arquivo não existe"); return None
    except json.JSONDecodeError as e:
        erro(f"{caminho.relative_to(RAIZ)}: JSON inválido ({e})"); return None

def ids_unicos(itens, rotulo, onde):
    vistos = set()
    for it in itens:
        i = it.get("id")
        if not i: erro(f"{onde}: {rotulo} sem id")
        elif i in vistos: erro(f"{onde}: id repetido em {rotulo}: {i}")
        vistos.add(i)

def checar_onde(obj, rotulo, onde):
    if "onde" in obj and (not isinstance(obj["onde"], str) or not obj["onde"].strip()):
        erro(f"{onde}: {rotulo} tem 'onde' vazio ou que não é texto")

def validar_topico(caminho, slug_esperado):
    onde = str(caminho.relative_to(RAIZ))
    t = carregar(caminho)
    if t is None: return
    if t.get("slug") != slug_esperado:
        erro(f"{onde}: slug '{t.get('slug')}' difere do esperado '{slug_esperado}'")
    fontes = {f.get("id") for f in t.get("fontes", [])}
    ids_unicos(t.get("fontes", []), "fonte", onde)
    for f in t.get("fontes", []):
        if "curta" in f and (not isinstance(f["curta"], str) or not f["curta"].strip()):
            erro(f"{onde}: fonte '{f.get('id')}' tem 'curta' vazio ou que não é texto")
    for chave, rot in (("resumo", "seção"), ("flashcards", "flashcard"), ("questoes", "questão"), ("figuras", "figura")):
        if chave == "figuras":
            continue
        ids_unicos(t.get(chave, []), rot, onde)
        for it in t.get(chave, []):
            if it.get("fonte") not in fontes:
                erro(f"{onde}: {rot} '{it.get('id')}' tem fonte '{it.get('fonte')}' que não existe em fontes[]")
            checar_onde(it, f"{rot} '{it.get('id')}'", onde)
    secoes = {s.get("id") for s in t.get("resumo", [])}
    for f in t.get("figuras", []):
        src = f.get("src")
        if not src or not (caminho.parent / src).exists() and not (RAIZ / src).exists() and not (caminho.parent.parent / src).exists():
            erro(f"{onde}: figura '{src}' não existe no disco")
        if f.get("apos") not in secoes:
            erro(f"{onde}: figura '{src}' aponta para seção inexistente '{f.get('apos')}'")
        for campo in ("alt", "legenda"):
            if not str(f.get(campo, "")).strip():
                erro(f"{onde}: figura '{src}' sem '{campo}'")
    for q in t.get("questoes", []):
        alts = q.get("alternativas", [])
        if len(alts) < 3: erro(f"{onde}: questão '{q.get('id')}' tem menos de 3 alternativas")
        n = sum(1 for a in alts if a.get("correta") is True)
        if n != 1: erro(f"{onde}: questão '{q.get('id')}' tem {n} alternativas corretas (esperado 1)")
        for k, a in enumerate(alts):
            if not str(a.get("justificativa", "")).strip():
                erro(f"{onde}: questão '{q.get('id')}' alternativa {k+1} sem justificativa")
            if "fonte" in a and a["fonte"] not in fontes:
                erro(f"{onde}: questão '{q.get('id')}' alternativa {k+1} tem fonte '{a['fonte']}' que não existe em fontes[]")
            checar_onde(a, f"questão '{q.get('id')}' alternativa {k+1}", onde)
        fig = q.get("figura")
        if fig and not (RAIZ / fig).exists() and not (caminho.parent / fig).exists():
            erro(f"{onde}: questão '{q.get('id')}' referencia figura '{fig}' inexistente")

    pontos = [it for ch in ("resumo", "flashcards", "questoes") for it in t.get(ch, [])]
    alts_todas = [a for q in t.get("questoes", []) for a in q.get("alternativas", [])]
    resumos.append((onde, len(pontos) + len(alts_todas),
                    sum(1 for p in pontos + alts_todas if p.get("onde")),
                    sum(1 for a in alts_todas if a.get("fonte")), len(alts_todas)))

def main():
    disc = carregar(DATA / "disciplinas.json")
    codigos = set()
    if disc:
        app = disc.get("app")
        if not isinstance(app, dict) or not str(app.get("nome", "")).strip():
            erro("data/disciplinas.json: falta app.nome")
        elif not str(app.get("assinatura", "")).strip():
            erro("data/disciplinas.json: falta app.assinatura")
        codigos = {d["codigo"] for d in disc.get("disciplinas", [])}
    alunos = carregar(DATA / "alunos.json")
    if alunos:
        if not alunos.get("sal"): erro("data/alunos.json: falta 'sal'")
        for h, lista in alunos.get("alunos", {}).items():
            if not isinstance(lista, list) or not lista:
                erro(f"data/alunos.json: valor de {h[:8]}… não é lista de códigos"); continue
            for c in lista:
                if c not in codigos: erro(f"data/alunos.json: {h[:8]}… referencia disciplina inexistente '{c}'")
    for pasta in sorted(p for p in DATA.iterdir() if p.is_dir()):
        if pasta.name not in codigos:
            erro(f"data/{pasta.name}: pasta sem disciplina em disciplinas.json")
        tj = carregar(pasta / "topicos.json")
        if not tj: continue
        if tj.get("disciplina") != pasta.name:
            erro(f"data/{pasta.name}/topicos.json: campo 'disciplina' é '{tj.get('disciplina')}'")
        slugs = [t.get("slug") for t in tj.get("topicos", [])]
        if len(slugs) != len(set(slugs)): erro(f"data/{pasta.name}/topicos.json: slugs repetidos")
        for t in tj.get("topicos", []):
            orig = t.get("compartilhadoDe")
            if orig:
                if orig not in codigos: erro(f"data/{pasta.name}: tópico '{t['slug']}' compartilhadoDe disciplina inexistente '{orig}'")
                elif orig == pasta.name: erro(f"data/{pasta.name}: tópico '{t['slug']}' compartilhadoDe aponta para a própria disciplina")
                arq = DATA / str(orig) / "topicos" / f"{t['slug']}.json"
            else:
                arq = pasta / "topicos" / f"{t['slug']}.json"
            if t.get("status") in ("pronto", "em-revisao"):
                if not arq.exists(): erro(f"data/{pasta.name}: tópico '{t['slug']}' ({t['status']}) sem arquivo {arq.relative_to(RAIZ)}")
                else: validar_topico(arq, t["slug"])
            elif t.get("status") != "em-breve":
                erro(f"data/{pasta.name}: tópico '{t['slug']}' com status desconhecido '{t.get('status')}'")
    for d in (disc or {}).get("disciplinas", []):
        if d.get("status") == "ativa" and not (DATA / d["codigo"] / "topicos.json").exists():
            erro(f"disciplina ativa {d['codigo']} sem data/{d['codigo']}/topicos.json")
    if erros:
        print("FALHOU:"); [print(" -", e) for e in erros]; sys.exit(1)
    for o, total, com_onde, alt_fonte, n_alts in resumos:
        print(f"  {o}: {total} pontos, {com_onde} com 'onde', {alt_fonte}/{n_alts} alternativas com fonte")
    print("OK: dados válidos.")

if __name__ == "__main__":
    main()
