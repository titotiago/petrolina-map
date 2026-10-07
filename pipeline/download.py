"""Download raw TSE / IBGE sources into data/raw (cached; re-run safe)."""
import sys
from pathlib import Path

import requests

RAW = Path(__file__).resolve().parent.parent / "data" / "raw"
TSE = "https://cdn.tse.jus.br/estatistica/sead/odsele"
IBGE = "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios"

SOURCES = {
    # 2024 municipal
    "votacao_secao_2024_PE.zip": f"{TSE}/votacao_secao/votacao_secao_2024_PE.zip",
    "detalhe_votacao_secao_2024.zip": f"{TSE}/detalhe_votacao_secao/detalhe_votacao_secao_2024.zip",
    "votacao_partido_munzona_2024.zip": f"{TSE}/votacao_partido_munzona/votacao_partido_munzona_2024.zip",
    "eleitorado_local_votacao_2024.zip": f"{TSE}/eleitorado_locais_votacao/eleitorado_local_votacao_2024.zip",
    "perfil_eleitor_secao_2024_PE.zip": f"{TSE}/perfil_eleitor_secao/perfil_eleitor_secao_2024_PE.zip",
    "consulta_cand_2024.zip": f"{TSE}/consulta_cand/consulta_cand_2024.zip",
    "consulta_coligacao_2024.zip": f"{TSE}/consulta_coligacao/consulta_coligacao_2024.zip",
    "bem_candidato_2024.zip": f"{TSE}/bem_candidato/bem_candidato_2024.zip",
    "prestacao_contas_candidatos_2024.zip": f"{TSE}/prestacao_contas/prestacao_de_contas_eleitorais_candidatos_2024.zip",
    # 2020 municipal (trend)
    "votacao_secao_2020_PE.zip": f"{TSE}/votacao_secao/votacao_secao_2020_PE.zip",
    "detalhe_votacao_secao_2020.zip": f"{TSE}/detalhe_votacao_secao/detalhe_votacao_secao_2020.zip",
    "eleitorado_local_votacao_2020.zip": f"{TSE}/eleitorado_locais_votacao/eleitorado_local_votacao_2020.zip",
    "consulta_cand_2020.zip": f"{TSE}/consulta_cand/consulta_cand_2020.zip",
    # 2026 general, 1st round
    "votacao_secao_2026_PE.zip": f"{TSE}/votacao_secao/votacao_secao_2026_PE.zip",
    "detalhe_votacao_secao_2026.zip": f"{TSE}/detalhe_votacao_secao/detalhe_votacao_secao_2026.zip",
    "eleitorado_local_votacao_2026.zip": f"{TSE}/eleitorado_locais_votacao/eleitorado_local_votacao_2026.zip",
    "consulta_cand_2026.zip": f"{TSE}/consulta_cand/consulta_cand_2026.zip",
    # IBGE Census 2022 (meshes with basic attributes + per-tract aggregates)
    "PE_setores_CD2022.gpkg": f"{IBGE}/malha_com_atributos/setores/gpkg/UF/PE/PE_setores_CD2022.gpkg",
    "PE_bairros_CD2022.gpkg": f"{IBGE}/malha_com_atributos/bairros/gpkg/UF/PE/PE_bairros_CD2022.gpkg",
    "PE_distritos_CD2022.gpkg": f"{IBGE}/malha_com_atributos/distritos/gpkg/UF/PE/PE_distritos_CD2022.gpkg",
    "ibge_dicionario_malha.xlsx": f"{IBGE}/malha_com_atributos/Dicionario_de_dados_malha_agregados.xlsx",
    "ibge_setores_demografia.zip": f"{IBGE}/Agregados_por_Setor_csv/Agregados_por_setores_demografia_BR.zip",
    "ibge_setores_alfabetizacao.zip": f"{IBGE}/Agregados_por_Setor_csv/Agregados_por_setores_alfabetizacao_BR.zip",
    "ibge_setores_basico.zip": f"{IBGE}/Agregados_por_Setor_csv/Agregados_por_setores_basico_BR_20260520.zip",
    "ibge_dicionario_setores.xlsx": f"{IBGE}/dicionario_de_dados_agregados_por_setores_censitarios_20260520.xlsx",
}


def fetch(name: str, url: str) -> None:
    dest = RAW / name
    if dest.exists() and dest.stat().st_size > 0:
        print(f"cached  {name} ({dest.stat().st_size / 1e6:.1f} MB)")
        return
    tmp = dest.with_suffix(".part")
    with requests.get(url, stream=True, timeout=120) as r:
        if r.status_code != 200:
            print(f"MISSING {name}: HTTP {r.status_code} {url}")
            return
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    tmp.rename(dest)
    print(f"fetched {name} ({dest.stat().st_size / 1e6:.1f} MB) last-modified={r.headers.get('last-modified')}")


if __name__ == "__main__":
    RAW.mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[1:])
    for name, url in SOURCES.items():
        if not only or any(o in name for o in only):
            fetch(name, url)
