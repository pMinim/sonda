#!/usr/bin/env python3
"""Publica o estado atual (HEAD) no repositório público, como um commit novo, sem levar o histórico.

O trabalho do dia a dia fica no repositório privado (remoto `origin`, pMinim/sonda-privado).
O site (GitHub Pages) sai do repositório público pMinim/sonda, que só recebe fotografias do estado
já revisado: cada publicação é um commit "Publicação AAAA-MM-DD".

Uso (na raiz do repositório, com tudo commitado):
  py -3 -X utf8 scripts/publicar.py            # publica o HEAD
  py -3 -X utf8 scripts/publicar.py --simular  # monta e confere, mas não envia

Não vai a público: ESTADO.md (notas internas) e tudo o que o .gitignore já ignora.
A publicação é recusada se aparecer lista de alunos, planilha ou material de consulta interna.
"""
import datetime, io, json, re, shutil, subprocess, sys, tempfile, zipfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
PUBLICO = "https://github.com/pMinim/sonda.git"
AUTOR = ("Pedro Minim", "228259975+pMinim@users.noreply.github.com")  # e-mail "noreply" do GitHub
FORA = {"ESTADO.md"}
PROIBIDO = re.compile(r"\.(csv|xlsx?|xlsm|pptx?|docx?|pdf|rtf)$|lista|ementa|fontes-extraidas|whatsapp|gabarito|prova", re.I)

def git(*args, cwd=RAIZ, saida=False):
    r = subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=saida)
    return r.stdout if saida else None

def main():
    simular = "--simular" in sys.argv
    if git("status", "--porcelain", "--untracked-files=no", saida=True).strip():
        sys.exit("Há alterações não commitadas em arquivos rastreados. Faça o commit antes de publicar.")
    sha = git("rev-parse", "--short", "HEAD", saida=True).decode().strip()

    tmp = Path(tempfile.mkdtemp(prefix="sonda-publicar-"))
    try:
        pub = tmp / "pub"
        clonou = subprocess.run(["git", "clone", "--quiet", "--depth", "1", PUBLICO, str(pub)], capture_output=True)
        vazio = clonou.returncode != 0 or not any(p.name != ".git" for p in pub.iterdir())
        if clonou.returncode != 0:  # repositório ainda sem commits
            pub.mkdir(parents=True, exist_ok=True)
            git("init", "--quiet", "--initial-branch=main", cwd=pub)
            git("remote", "add", "origin", PUBLICO, cwd=pub)
        for p in pub.iterdir():
            if p.name == ".git": continue
            shutil.rmtree(p) if p.is_dir() else p.unlink()

        pacote = zipfile.ZipFile(io.BytesIO(git("archive", "--format=zip", "HEAD", saida=True)))
        nomes = [n for n in pacote.namelist() if not n.endswith("/") and n not in FORA]
        ruins = [n for n in nomes if PROIBIDO.search(n)]
        if ruins:
            sys.exit("Publicação recusada, arquivo que não pode ir a público: " + ", ".join(ruins))
        for n in nomes:
            destino = pub / n
            destino.parent.mkdir(parents=True, exist_ok=True)
            destino.write_bytes(pacote.read(n))

        # alunos.json: só hashes e códigos de disciplina
        alunos = json.loads((pub / "data" / "alunos.json").read_text(encoding="utf-8"))
        if set(alunos) - {"sal", "atualizadoEm", "teste", "alunos"} or not all(re.fullmatch(r"[0-9a-f]{64}", h) for h in alunos["alunos"]):
            sys.exit("Publicação recusada: data/alunos.json tem algo além de hashes.")

        (pub / ".nojekyll").write_text("", encoding="utf-8")  # o Pages serve os arquivos como estão
        git("add", "-A", cwd=pub)
        if not git("status", "--porcelain", cwd=pub, saida=True).strip():
            print("Nada mudou em relação ao que já está publicado."); return
        mudou = git("status", "--short", cwd=pub, saida=True).decode().strip().splitlines()
        print(f"{len(nomes)} arquivos no pacote; {len(mudou)} mudança(s) em relação ao publicado" + (" (primeira publicação)" if vazio else ""))
        for linha in mudou[:15]: print("  ", linha)
        if simular:
            print("Simulação: nada foi enviado."); return
        msg = f"Publicação {datetime.date.today().isoformat()}\n\nEstado do repositório de trabalho em {sha}.\n\nCo-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
        git("-c", f"user.name={AUTOR[0]}", "-c", f"user.email={AUTOR[1]}", "commit", "--quiet", "-m", msg, cwd=pub)
        git("push", "--quiet", "origin", "HEAD:main", cwd=pub)
        print("Publicado em", PUBLICO, "a partir de", sha)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == "__main__":
    main()
