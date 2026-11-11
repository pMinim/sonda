#!/usr/bin/env python3
"""Gera data/alunos.json a partir das relações de alunos do SIAA.

Uso:
  python scripts/gerar-alunos.py 14733=lista-gru.csv 14733=lista-paulista.csv 14814=lista-cbc.xlsx ...

Cada arquivo é uma lista de alunos de UMA oferta; o código antes do '=' é a disciplina.
Aceita .csv (separador ; ou ,) e .xlsx (precisa de openpyxl). Procura a coluna com RGM
(cabeçalho contendo "RGM" ou "matr"); se não achar, usa a primeira coluna só de dígitos.
Só o hash SHA-256(sal:rgm) vai para o JSON. Nome nunca entra.
"""
import csv, hashlib, json, re, secrets, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
SAIDA = RAIZ / "data" / "alunos.json"

def hash_rgm(sal: str, rgm: str) -> str:
    return hashlib.sha256(f"{sal}:{rgm}".encode()).hexdigest()

def ler_linhas(caminho: Path):
    if caminho.suffix.lower() == ".xlsx":
        import openpyxl  # type: ignore
        wb = openpyxl.load_workbook(caminho, read_only=True, data_only=True)
        for ws in wb.worksheets:
            for row in ws.iter_rows(values_only=True):
                yield ["" if c is None else str(c) for c in row]
    else:
        texto = caminho.read_text(encoding="utf-8-sig", errors="replace")
        sep = ";" if texto.count(";") > texto.count(",") else ","
        for row in csv.reader(texto.splitlines(), delimiter=sep):
            yield row

def extrair_rgms(caminho: Path):
    linhas = list(ler_linhas(caminho))
    col = None
    for row in linhas[:10]:
        for i, cel in enumerate(row):
            if re.search(r"rgm|matr", cel, re.I):
                col = i
                break
        if col is not None:
            break
    rgms = set()
    for row in linhas:
        cels = row if col is None else ([row[col]] if col < len(row) else [])
        for cel in cels:
            d = re.sub(r"\D", "", cel)
            if 5 <= len(d) <= 12:
                rgms.add(d)
                break
    return rgms

def main(args):
    if not args:
        print(__doc__); sys.exit(1)
    atual = json.loads(SAIDA.read_text()) if SAIDA.exists() else {}
    sal = atual.get("sal") or secrets.token_hex(8)
    alunos: dict[str, set] = {}
    for arg in args:
        cod, _, arq = arg.partition("=")
        if not arq:
            sys.exit(f"formato esperado CODIGO=arquivo, recebi {arg!r}")
        rgms = extrair_rgms(Path(arq))
        print(f"{arq}: {len(rgms)} RGM(s) → {cod}")
        for r in rgms:
            alunos.setdefault(hash_rgm(sal, r), set()).add(cod)
    # mantém os RGMs de teste já existentes (marcados em "teste")
    for h, cods in atual.get("teste", {}).items():
        alunos.setdefault(h, set()).update(cods)
    saida = {
        "sal": sal,
        "atualizadoEm": __import__("datetime").date.today().isoformat(),
        "teste": atual.get("teste", {}),
        "alunos": {h: sorted(c) for h, c in sorted(alunos.items())},
    }
    SAIDA.write_text(json.dumps(saida, ensure_ascii=False, indent=1) + "\n")
    print(f"gravado {SAIDA} com {len(alunos)} hashes")

if __name__ == "__main__":
    main(sys.argv[1:])
