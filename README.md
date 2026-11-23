# Sonda

Site: https://pminim.github.io/sonda/

App web estático de estudo (resumo, flashcards e quiz) para os alunos do Prof. Pedro Minim, Cruzeiro do Sul.
HTML + CSS + JS puro, sem build. Única biblioteca: `marked` (CDN) para renderizar o markdown dos resumos.
O aluno entra com o RGM; só o hash SHA-256(sal:rgm) está em `data/alunos.json`. Progresso fica no `localStorage` do aparelho.

## Rodar local

    python3 -m http.server 8765      # depois abra http://localhost:8765
    python3 scripts/validar.py       # valida os dados
    node tests/e2e.spec.mjs          # teste Playwright (sobe o servidor sozinho na porta 8765)
    python3 scripts/montar-artifact.py   # gera dist/artifact.html (CSS e JS inline)

## Adicionar disciplina

1. Em `data/disciplinas.json`, acrescente o objeto (`status`: `ativa` ou `em-breve`).
2. Se `ativa`, crie `data/<codigo>/topicos.json` (veja o de 14733) e a pasta `data/<codigo>/topicos/`.
3. Rode `python3 scripts/gerar-alunos.py <codigo>=lista.csv` para incluir os alunos.

## Adicionar tópico

1. Acrescente a entrada em `data/<codigo>/topicos.json` (`slug` só com letras minúsculas, dígitos e hífen).
2. Crie `data/<codigo>/topicos/<slug>.json` no formato de `periodontite-estagio-grau.json`: `fontes[]`, `resumo[]`, `figuras[]`, `flashcards[]`, `questoes[]`.
   Toda seção, flashcard e questão precisa de `fonte` existente em `fontes[]`; toda questão tem 1 alternativa correta e justificativa em todas.
3. Rode `python3 scripts/validar.py`.

## Gerar alunos.json

    python3 scripts/gerar-alunos.py 14733=lista-gru.csv 14733=lista-paulista.csv 14814=lista-cbc.xlsx

Cada arquivo é a relação de uma oferta (CSV ou XLSX com openpyxl). O sal existente é mantido; os RGMs de teste (`teste`) são preservados. Nenhum nome é gravado.
No Windows, use `py -3 -X utf8` no lugar de `python3`.

## Publicar

O trabalho fica num repositório privado; o site sai deste repositório público, que só recebe o estado já revisado.

    python3 scripts/publicar.py --simular   # monta e confere, sem enviar
    python3 scripts/publicar.py             # publica o HEAD como um commit novo

O GitHub Pages serve a branch `main` na raiz. As imagens trazem o crédito e a licença na legenda de cada figura.
