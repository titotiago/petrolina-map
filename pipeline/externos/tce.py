"""Prefeitura de Petrolina spending located by neighbourhood — roadmap item 13.

Source: TCE-PE Dados Abertos (no key): DespesasMunicipais, one request per month (2021 → today), cached in
data/raw/tce. Each commitment (empenho) has a free-text HISTORICO that often names the street/neighbourhood.
We match neighbourhood names (IBGE bairros + TSE polling-place bairros) in that text; ambiguous names (e.g.
"CENTRO", which also appears in "CENTRO DE SAÚDE") only count after a locator word (BAIRRO, LOTEAMENTO...).
Only a fraction of spending names a place — results are a located *sample*, not the full budget.

Usage: python -I pipeline/externos/tce.py
"""
import json
import re
import sys
import time
import unicodedata
from datetime import date
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))
CACHE = ROOT / "data" / "raw" / "tce"
OUT = ROOT / "data" / "externos"
URL = "https://sistemas.tce.pe.gov.br/DadosAbertos/DespesasMunicipais!json"
LOCATOR = r"(?:BAIRRO|LOTEAMENTO|LOT\.?|CONJUNTO|CONJ\.?|RESIDENCIAL|PROJETO|POVOADO|DISTRITO|COMUNIDADE|N[UÚ]CLEO|AGROVILA|VILA|SITIO|S[IÍ]TIO|NO|NA|DO|DA)\s+"
AMBIGUOUS = {"CENTRO", "JATOBA", "TOPAZIO", "CAPIM", "ATALHO", "SIMPATIA", "CAITITU", "VIVENDAS", "MANDACARU", "TAPERA", "CARNEIRO", "PALHINHAS"}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().upper()
    return " ".join(re.sub(r"[^A-Z0-9 ]", " ", s).split())


def fetch_month(y: int, m: int) -> list:
    f = CACHE / f"{y}-{m:02d}.json"
    if f.exists():
        return json.loads(f.read_text(encoding="utf-8"))
    for attempt in range(4):
        try:
            r = requests.get(URL, params={"CODIGO_MUNICIPIO": "P115", "ANOREFERENCIA": y, "MESREFERENCIA": m}, timeout=180,
                             headers={"User-Agent": "petrolina-map/1.0 (pesquisa)"})
            r.raise_for_status()
            recs = json.loads(r.content.decode("latin-1")).get("resposta", {}).get("conteudo", []) or []
            CACHE.mkdir(parents=True, exist_ok=True)
            f.write_text(json.dumps(recs, ensure_ascii=False), encoding="utf-8")
            time.sleep(1.5)
            return recs
        except (requests.RequestException, ValueError):
            time.sleep(10 * (attempt + 1))
    print(f"  !! {y}-{m:02d} unavailable")
    return []


def gazetteer() -> dict:
    """normalized place name -> (display name, region)."""
    reg = pd.read_csv(ROOT / "pipeline" / "regions.csv", dtype=str).fillna("")
    g = {}
    for _, r in reg.iterrows():
        for name in (r.bairro_tse, r.bairro_ibge):
            k = norm(name)
            if len(k) >= 4 and k not in ("ZONA RURAL",):
                g.setdefault(k, (name.title(), r.regiao))
    return g


def locate(text: str, gaz: dict, pats: list) -> tuple | None:
    t = norm(text)
    for k, pat_plain, pat_loc in pats:
        if (k not in AMBIGUOUS and len(k.split()) >= 1 and pat_plain.search(t)) or pat_loc.search(t):
            return gaz[k] + (k,)
    return None


def run():
    today = date.today()
    months = [(y, m) for y in range(2021, today.year + 1) for m in range(1, 13) if (y, m) < (today.year, today.month)]
    recs = []
    for y, m in months:
        rows = fetch_month(y, m)
        recs += rows
        print(f"  {y}-{m:02d}: {len(rows)}")
    df = pd.DataFrame(recs)
    for c in ("VALOREMPENHADO", "VALORLIQUIDADO", "VALORPAGO"):
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)
    gaz = gazetteer()
    # longest names first so "SAO GONCALO DOIS" wins over "SAO GONCALO"
    keys = sorted(gaz, key=len, reverse=True)
    pats = [(k, re.compile(rf"\b{re.escape(k)}\b"), re.compile(rf"{LOCATOR}{re.escape(k)}\b")) for k in keys]
    loc = df.HISTORICO.fillna("").map(lambda h: locate(h, gaz, pats))
    df["bairro"] = loc.map(lambda x: x[0] if x else None)
    df["regiao"] = loc.map(lambda x: x[1] if x else None)
    df["investimento"] = df.CATEGORIA.fillna("").str.contains("Capital", case=False)
    OUT.mkdir(parents=True, exist_ok=True)
    keep = ["ANOREFERENCIA", "MESREFERENCIA", "DATAEMPENHO", "NOMEUNIDADEGESTORA", "FUNCAO", "SUBFUNCAO", "PROGRAMA", "ACAO",
            "ELEMENTODESPESA", "CATEGORIA", "FORNECEDOR", "CPF_CNPJ", "VALOREMPENHADO", "VALORLIQUIDADO", "VALORPAGO", "HISTORICO",
            "bairro", "regiao", "investimento"]
    df[keep].to_csv(OUT / "tce_despesas_petrolina.csv.gz", index=False, compression="gzip")
    located = df[df.regiao.notna()]
    print(f"total empenhos: {len(df):,} | R$ {df.VALOREMPENHADO.sum():,.0f} | com local identificado: {len(located):,} "
          f"(R$ {located.VALOREMPENHADO.sum():,.0f}, {located.VALOREMPENHADO.sum() / df.VALOREMPENHADO.sum() * 100:.1f}%)")
    return df


if __name__ == "__main__":
    run()
