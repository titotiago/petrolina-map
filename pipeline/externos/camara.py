"""Câmara Municipal de Petrolina (petrolina.pe.leg.br) — roadmap item 14.

The site has no API (WordPress REST disabled), so listings are read from the public HTML pages, politely
(1 request/second, cached per page in data/raw/camara so re-runs resume and never re-download).

Collected: indicações and requerimentos (date, number, author, ementa, PDF link) for 2021 → today, and the
list of roll-call vote PDFs (votações nominais). Attendance (presença) is published as scanned images and is
not collected.

Usage: python -I pipeline/externos/camara.py [indicacoes|requerimentos|votacoes]
"""
import re
import sys
import time
from html import unescape
from pathlib import Path

import pandas as pd
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "data" / "raw" / "camara"
OUT = ROOT / "data" / "externos"
BASE = "https://petrolina.pe.leg.br"
YEARS = range(2021, 2027)
HEADERS = {"User-Agent": "petrolina-map/1.0 (pesquisa eleitoral; contato via GitHub titotiago/petrolina-map)"}
session = requests.Session()


def get(url: str, cache: Path) -> str:
    if cache.exists():
        return cache.read_text(encoding="utf-8")
    for attempt in range(4):
        try:
            r = session.get(url, headers=HEADERS, timeout=60)
            if r.status_code == 404:
                return ""
            r.raise_for_status()
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(r.text, encoding="utf-8")
            time.sleep(1.0)
            return r.text
        except requests.RequestException:
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"failed: {url}")


def parse_listing(html: str, tipo: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    rows = []
    for it in soup.select("div.indication, div.requirement, div.request, div.item-list, article"):
        a = it.select_one("div.title a, h1 a, h2 a")
        if not a:
            continue
        title = unescape(a.get_text(" ", strip=True))
        date = it.select_one("div.date p")
        desc = it.select_one("div.description p, div.description")
        m = re.search(r"n[ºo°]\s*([\d.]+)\s*/\s*(\d{4})", title, re.IGNORECASE)
        autor = re.split(r"\s[–-]\s", title, maxsplit=1)
        rows.append({
            "tipo": tipo, "data": date.get_text(strip=True) if date else "", "titulo": title,
            "numero": m.group(1) if m else "", "ano": m.group(2) if m else "",
            "autor": autor[1].strip() if len(autor) > 1 else "",
            "ementa": unescape(desc.get_text(" ", strip=True)) if desc else "", "pdf": a.get("href", ""),
        })
    return rows


def total_pages(html: str) -> int:
    nums = [int(x) for x in re.findall(r"/page/(\d+)", html)]
    return max(nums) if nums else 1


def crawl(tipo: str) -> pd.DataFrame:
    rows = []
    for y in YEARS:
        first = get(f"{BASE}/{tipo}/?periodo={y}", CACHE / tipo / str(y) / "1.html")
        n = total_pages(first)
        rows += parse_listing(first, tipo)
        for page in range(2, n + 1):
            html = get(f"{BASE}/{tipo}/page/{page}/?periodo={y}", CACHE / tipo / str(y) / f"{page}.html")
            rows += parse_listing(html, tipo)
        print(f"  {tipo} {y}: {n} páginas, {sum(1 for r in rows if r['ano'] == str(y) or r['data'].endswith(str(y)))} itens")
    df = pd.DataFrame(rows).drop_duplicates(["tipo", "numero", "ano", "titulo"])
    OUT.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT / f"camara_{tipo}.csv", index=False)
    return df


def votacoes() -> pd.DataFrame:
    rows = []
    first = get(f"{BASE}/votacoes-nominais/", CACHE / "votacoes" / "1.html")
    n = total_pages(first)
    for page in range(1, n + 1):
        html = first if page == 1 else get(f"{BASE}/votacoes-nominais/page/{page}/", CACHE / "votacoes" / f"{page}.html")
        soup = BeautifulSoup(html, "html.parser")
        for a in soup.select("a[href$='.pdf']"):
            rows.append({"titulo": a.get_text(" ", strip=True), "pdf": a["href"]})
    df = pd.DataFrame(rows).drop_duplicates("pdf")
    OUT.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT / "camara_votacoes_lista.csv", index=False)
    return df


# ---------------------------------------------------------------- roll-call votes (PDF tables with a text layer)
VOTE_RE = r"(Favor[áa]vel|Contr[áa]ri[oa]|Absten[çc][ãa]o|Aus[êe]ncia\s+Justificada|Ausente(?:\s+na\s+vota[çc][ãa]o)?|Presidente|Obstru[çc][ãa]o)\s*$"


def parse_vote_pdf(path: Path) -> dict | None:
    from pypdf import PdfReader
    try:
        text = "\n".join((p.extract_text() or "") for p in PdfReader(str(path)).pages)
    except Exception:
        return None
    if "VOTA" not in text.upper():
        return None
    head = re.search(r"(Projeto de (?:Lei|Resolu[çc][ãa]o|Decreto)[^\n]*|Veto[^\n]*|Requerimento[^\n]*|Emenda[^\n]*|Proposta[^\n]*)", text, re.I)
    data = re.search(r"Data:\s*(\d{2}/\d{2}/\d{4})", text)
    placar = re.search(r"(\d+)\s*x\s*(\d+)", text)
    votes = []
    for line in text.splitlines():
        line = " ".join(line.split())
        m = re.search(VOTE_RE, line, re.I)
        if not m or line.upper().startswith(("VEREADOR", "DATA", "1", "2")):
            continue
        name = line[: m.start()].strip(" -:")
        if len(name) < 3:
            continue
        v = m.group(1).lower()
        cat = ("favoravel" if v.startswith("favor") else "contrario" if v.startswith("contr") else "abstencao" if v.startswith("abst")
               else "justificada" if "justific" in v else "presidente" if v.startswith("presid") else "obstrucao" if v.startswith("obstr") else "ausente")
        votes.append({"nome": name, "voto": cat})
    if not votes:
        return None
    return {"materia": head.group(1).strip() if head else "", "data": data.group(1) if data else "",
            "placar": f"{placar.group(1)}x{placar.group(2)}" if placar else "", "votos": votes}


def votacoes_detalhe() -> pd.DataFrame:
    lst = pd.read_csv(OUT / "camara_votacoes_lista.csv")
    rows = []
    for url in lst.pdf:
        f = CACHE / "votacoes_pdf" / url.rsplit("/", 1)[-1]
        if not f.exists():
            for attempt in range(3):
                try:
                    r = session.get(url, headers=HEADERS, timeout=120)
                    r.raise_for_status()
                    f.parent.mkdir(parents=True, exist_ok=True)
                    f.write_bytes(r.content)
                    time.sleep(1.0)
                    break
                except requests.RequestException:
                    time.sleep(5 * (attempt + 1))
            if not f.exists():
                continue
        d = parse_vote_pdf(f)
        if d:
            for v in d["votos"]:
                rows.append({"pdf": url, "materia": d["materia"], "data": d["data"], "placar": d["placar"], **v})
    df = pd.DataFrame(rows)
    df.to_csv(OUT / "camara_votacoes_nominais.csv", index=False)
    print(f"votações nominais: {df.pdf.nunique() if len(df) else 0} PDFs com tabela, {len(df)} votos individuais")
    return df


if __name__ == "__main__":
    which = sys.argv[1:] or ["indicacoes", "requerimentos", "votacoes"]
    for w in which:
        df = votacoes() if w == "votacoes" else votacoes_detalhe() if w == "votos" else crawl(w)
        print(f"{w}: {len(df)} registros")
