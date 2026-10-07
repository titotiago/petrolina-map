"""Federal money and public works for Petrolina — roadmap item 13 (complement to TCE-PE).

- Parliamentary amendments (emendas) whose application municipality is Petrolina: Portal da Transparência
  bulk file (EmendasParlamentares.zip, no key), filtered by IBGE code 2611101.
- Special transfers ("emendas Pix"): Transferegov API (no key), by the municipality's CNPJ.
- Federal works: Obrasgov API (no key), paging UF=PE and keeping those that mention Petrolina; geometry per work.
- Municipal procurement (licitações): Prefeitura export endpoint (no key).

Raw files are cached in data/raw/federal; outputs in data/externos. Usage: python -I pipeline/externos/federal.py
"""
import io
import json
import time
import zipfile
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "federal"
OUT = ROOT / "data" / "externos"
IBGE = "2611101"
CNPJ = "10358190000177"
UA = {"User-Agent": "petrolina-map/1.0 (pesquisa)", "Accept": "application/json"}


def _get(url, params=None, timeout=120, tries=4, headers=None):
    for attempt in range(tries):
        try:
            r = requests.get(url, params=params, timeout=(15, timeout), headers=headers or UA)
            r.raise_for_status()
            return r
        except requests.RequestException:
            time.sleep(8 * (attempt + 1))
    raise RuntimeError(f"failed: {url} {params}")


def emendas() -> pd.DataFrame:
    z = RAW / "EmendasParlamentares.zip"
    if not z.exists():
        r = requests.get("https://dadosabertos-download.cgu.gov.br/PortalDaTransparencia/saida/emendas-parlamentares/EmendasParlamentares.zip",
                         timeout=600, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        RAW.mkdir(parents=True, exist_ok=True)
        z.write_bytes(r.content)
    with zipfile.ZipFile(z) as zf:
        df = pd.read_csv(io.TextIOWrapper(zf.open("EmendasParlamentares.csv"), encoding="latin-1"), sep=";", dtype=str)
    df = df[df["Código Município IBGE"] == IBGE].copy()
    for c in ("Valor Empenhado", "Valor Liquidado", "Valor Pago"):
        df[c] = pd.to_numeric(df[c].str.replace(".", "", regex=False).str.replace(",", ".", regex=False), errors="coerce").fillna(0)
    df.to_csv(OUT / "emendas_petrolina.csv", index=False)
    return df


def emendas_favorecidos() -> pd.DataFrame:
    """Amendment money actually received by entities based in Petrolina (municipality, funds, Univasf, IF Sertão,
    hospitals, contractors) — complements the application-locality view above."""
    with zipfile.ZipFile(RAW / "EmendasParlamentares.zip") as zf:
        df = pd.read_csv(io.TextIOWrapper(zf.open("EmendasParlamentares_PorFavorecido.csv"), encoding="latin-1"), sep=";", dtype=str)
    df = df[(df["UF Favorecido"] == "PE") & (df["Município Favorecido"] == "PETROLINA")].copy()
    df["Valor Recebido"] = pd.to_numeric(df["Valor Recebido"].str.replace(".", "", regex=False).str.replace(",", ".", regex=False), errors="coerce").fillna(0)
    df["ano"] = df["Ano/Mês"].str[:4]
    df.to_csv(OUT / "emendas_favorecidos_petrolina.csv.gz", index=False, compression="gzip")
    return df


def transferencias_especiais() -> pd.DataFrame:
    r = _get("https://api.transferegov.gestao.gov.br/transferenciasespeciais/plano_acao_especial",
             {"cnpj_beneficiario_plano_acao": f"eq.{CNPJ}", "limit": 1000})
    df = pd.DataFrame(r.json())
    cols = ["ano_plano_acao", "nome_parlamentar_emenda_plano_acao", "codigo_descricao_areas_politicas_publicas_plano_acao",
            "situacao_plano_acao", "valor_custeio_plano_acao", "valor_investimento_plano_acao"]
    df = df[[c for c in cols if c in df]]
    df.to_csv(OUT / "transferencias_especiais_petrolina.csv", index=False)
    return df


def obras_federais(max_pages: int = 400) -> pd.DataFrame:
    cache = RAW / "obrasgov_pe.json"
    if cache.exists():
        items = json.loads(cache.read_text(encoding="utf-8"))
    else:
        items = []
        for page in range(max_pages):
            c = _get("https://api.obrasgov.gestao.gov.br/obrasgov/api/projeto-investimento",
                     {"uf": "PE", "pagina": page, "tamanhoDaPagina": 100}).json().get("content", [])
            if not c:
                break
            items += c
            print(f"  obrasgov PE página {page}: {len(items)} projetos", flush=True)
            time.sleep(1.0)
        RAW.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
    pet = [o for o in items if "PETROLINA" in json.dumps(o, ensure_ascii=False).upper()]
    rows = []
    for o in pet:
        geo = None
        try:
            g = _get("https://api.obrasgov.gestao.gov.br/obrasgov/api/geometria", {"idUnico": o["idUnico"]}, tries=2).json()
            geo = g[0].get("geometriaWkt") if isinstance(g, list) and g else (g.get("geometriaWkt") if isinstance(g, dict) else None)
        except Exception:
            pass
        lat = lon = None
        if geo and geo.upper().startswith("POINT"):
            lon, lat = (float(x) for x in geo[geo.index("(") + 1:geo.index(")")].split()[:2])
            if not (-9.9 <= lat <= -8.5 and -41.0 <= lon <= -40.1):  # outside Petrolina → discard bad geometry
                lat = lon = None
        rows.append({"id": o["idUnico"], "nome": o.get("nome"), "descricao": o.get("descricao"), "situacao": o.get("situacao"),
                     "especie": o.get("especie"), "inicio_previsto": o.get("dataInicialPrevista"), "fim_previsto": o.get("dataFinalPrevista"),
                     "lat": lat, "lon": lon})
        time.sleep(0.5)
    df = pd.DataFrame(rows)
    df.to_csv(OUT / "obras_federais_petrolina.csv", index=False)
    return df


def licitacoes() -> pd.DataFrame:
    rows = []
    for y in range(2021, 2027):
        page = 0
        while True:
            try:
                r = _get("https://licitacoes.petrolina.pe.gov.br:8082/licitacao/exportar/json",
                         {"dataInicio": f"01/01/{y}", "dataFim": f"31/12/{y}", "page": page, "size": 500}, timeout=90, tries=2,
                         headers={"User-Agent": UA["User-Agent"], "Accept": "*/*"})  # this export endpoint answers 406 to Accept: application/json
                data = r.json()
            except Exception as e:
                print(f"  licitações {y} p{page}: indisponível ({e})")
                break
            data = data.get("content", data) if isinstance(data, dict) else data
            if not data:
                break
            for d in data:
                d["ano_consulta"] = y
            rows += data
            if len(data) < 500:
                break
            page += 1
            time.sleep(1.0)
        print(f"  licitações {y}: {sum(1 for x in rows if x['ano_consulta'] == y)}", flush=True)
    df = pd.DataFrame(rows)
    if len(df):
        df.to_csv(OUT / "licitacoes_petrolina.csv", index=False)
    return df


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    import sys
    only = set(sys.argv[1:])
    if not only or "emendas" in only:
        e = emendas()
        print(f"emendas: {len(e)} linhas, R$ {e['Valor Empenhado'].sum():,.0f} empenhados, R$ {e['Valor Pago'].sum():,.0f} pagos")
        f = emendas_favorecidos()
        print(f"emendas recebidas por entidades de Petrolina: {len(f)} pagamentos, R$ {f['Valor Recebido'].sum():,.0f}")
        t = transferencias_especiais()
        print(f"transferências especiais: {len(t)}")
    if only and "licitacoes" not in only and "obras" in only:
        o = obras_federais()
        print(f"obras federais em Petrolina: {len(o)} ({o.lat.notna().sum() if len(o) else 0} com coordenadas)")
        raise SystemExit
    lic = licitacoes()
    print(f"licitações: {len(lic)}")
    o = obras_federais()
    print(f"obras federais em Petrolina: {len(o)} ({o.lat.notna().sum() if len(o) else 0} com coordenadas)")
