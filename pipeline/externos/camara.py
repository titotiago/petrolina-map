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


if __name__ == "__main__":
    which = sys.argv[1:] or ["indicacoes", "requerimentos", "votacoes"]
    for w in which:
        df = votacoes() if w == "votacoes" else crawl(w)
        print(f"{w}: {len(df)} registros")
