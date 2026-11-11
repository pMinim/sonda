#!/usr/bin/env python3
"""Gera dist/artifact.html a partir de index.html, com CSS e JS inline.
Remove doctype/html/head/body (mantém o conteúdo interno). Os JSON continuam via fetch('data/...')."""
import base64, json, re
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
html = (RAIZ / "index.html").read_text(encoding="utf-8")

def inline_css(m):
    href = re.search(r'href="([^"]+)"', m.group(0)).group(1)
    if href.startswith(("http:", "https:", "//")): return m.group(0)
    return "<style>\n" + (RAIZ / href).read_text(encoding="utf-8") + "\n</style>"

def inline_js(m):
    src = re.search(r'src="([^"]+)"', m.group(0)).group(1)
    if src.startswith(("http:", "https:", "//")): return m.group(0)
    codigo = (RAIZ / src).read_text(encoding="utf-8").replace("</script", "<\\/script")
    return "<script>\n" + codigo + "\n</script>"

html = re.sub(r'<link\b[^>]*rel="stylesheet"[^>]*>', inline_css, html)
html = re.sub(r'<script\b[^>]*\bsrc="[^"]+"[^>]*>\s*</script>', inline_js, html)
# título vem de data/disciplinas.json (app.nome); favicon embutido como data URI
nome = json.loads((RAIZ / "data" / "disciplinas.json").read_text(encoding="utf-8"))["app"]["nome"]
html = re.sub(r"<title>.*?</title>", lambda m: "<title>" + nome + "</title>", html, flags=re.S)
def inline_icon(m):
    href = re.search(r'href="([^"]+)"', m.group(0)).group(1)
    svg = (RAIZ / href).read_bytes().replace(b"\r\n", b"\n")  # mesma saída no Windows (CRLF) e no Mac
    dados = base64.b64encode(svg).decode("ascii")
    return '<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,' + dados + '">'
html = re.sub(r'<link\b[^>]*rel="icon"[^>]*>', inline_icon, html)
html = re.sub(r"<!doctype[^>]*>", "", html, flags=re.I)
html = re.sub(r"</?(html|head|body)\b[^>]*>", "", html, flags=re.I)
html = re.sub(r"\n{3,}", "\n\n", html).strip() + "\n"
# imagens das marcas usadas via JS (assets/favicon.svg) apontam para o arquivo publicado junto
saida = RAIZ / "dist" / "artifact.html"
saida.parent.mkdir(exist_ok=True)
saida.write_text(html, encoding="utf-8")
print(f"gravado {saida} ({len(html)//1024} KB)")
