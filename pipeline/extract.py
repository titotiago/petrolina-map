"""Stream raw zips and keep only Petrolina-PE rows -> data/interim/*.csv (UTF-8).

TSE municipality code for Petrolina is 25216 (IBGE 2611101). Filtering is done
line-by-line on the latin-1 text so the 1 GB members never load into memory.
"""
import csv
import io
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "interim"
TSE_MUN = "25216"
MATCH = re.compile(rf'(^|;)"?{TSE_MUN}"?(;|$)')
SETOR = re.compile(r'^"?2611101')  # IBGE census tract codes for Petrolina

MULTILINE = {"bens_2024.csv", "receitas_2024.csv", "despesas_2024.csv", "cand_2024.csv", "cand_2020.csv", "coligacao_2024.csv", "cand_2016.csv"}

# (zip, member regex, output name, filter). filter=None keeps every row.
JOBS = [
    ("votacao_secao_2024_PE.zip", r"\.csv$", "votacao_secao_2024.csv", MATCH),
    ("detalhe_votacao_secao_2024.zip", r"_PE\.csv$", "detalhe_secao_2024.csv", MATCH),
    ("votacao_partido_munzona_2024.zip", r"_PE\.csv$", "partido_munzona_2024.csv", MATCH),
    ("eleitorado_local_votacao_2024.zip", r"\.csv$", "locais_2024.csv", MATCH),
    ("perfil_eleitor_secao_2024_PE.zip", r"\.csv$", "perfil_secao_2024.csv", MATCH),
    ("consulta_cand_2024.zip", r"_PE\.csv$", "cand_2024.csv", MATCH),
    ("consulta_coligacao_2024.zip", r"_PE\.csv$", "coligacao_2024.csv", MATCH),
    ("bem_candidato_2024.zip", r"_PE\.csv$", "bens_2024.csv", MATCH),
    ("prestacao_contas_candidatos_2024.zip", r"receitas_candidatos_2024_PE\.csv$", "receitas_2024.csv", MATCH),
    ("prestacao_contas_candidatos_2024.zip", r"despesas_contratadas_candidatos_2024_PE\.csv$", "despesas_2024.csv", MATCH),
    ("votacao_secao_2020_PE.zip", r"\.csv$", "votacao_secao_2020.csv", MATCH),
    ("detalhe_votacao_secao_2020.zip", r"_PE\.csv$", "detalhe_secao_2020.csv", MATCH),
    ("eleitorado_local_votacao_2020.zip", r"\.csv$", "locais_2020.csv", MATCH),
    ("consulta_cand_2020.zip", r"_PE\.csv$", "cand_2020.csv", MATCH),
    ("votacao_secao_2026_PE.zip", r"\.csv$", "votacao_secao_2026.csv", MATCH),
    ("detalhe_votacao_secao_2026.zip", r"_PE\.csv$", "detalhe_secao_2026.csv", MATCH),
    ("eleitorado_local_votacao_2026.zip", r"_PE\.csv$", "locais_2026.csv", MATCH),
    ("consulta_cand_2026.zip", r"_(PE|BR)\.csv$", "cand_2026.csv", None),
    # 2022 general + 2026 president (national files filtered to Petrolina)
    ("votacao_secao_2022_PE.zip", r"\.csv$", "votacao_secao_2022.csv", MATCH),
    ("votacao_secao_2022_BR.zip", r"\.csv$", "votacao_secao_2022_pres.csv", MATCH),
    ("detalhe_votacao_secao_2022.zip", r"_PE\.csv$", "detalhe_secao_2022.csv", MATCH),
    ("detalhe_votacao_secao_2022.zip", r"_BRASIL\.csv$", "detalhe_secao_2022_pres.csv", MATCH),
    ("eleitorado_local_votacao_2022.zip", r"\.csv$", "locais_2022.csv", MATCH),
    ("consulta_cand_2022.zip", r"_(PE|BR)\.csv$", "cand_2022.csv", None),
    ("votacao_secao_2026_BR.zip", r"\.csv$", "votacao_secao_2026_pres.csv", MATCH),
    # 2016 municipal
    ("votacao_secao_2016_PE.zip", r"\.csv$", "votacao_secao_2016.csv", MATCH),
    ("detalhe_votacao_secao_2016.zip", r"_PE\.csv$", "detalhe_secao_2016.csv", MATCH),
    ("eleitorado_local_votacao_2016.zip", r"\.csv$", "locais_2016.csv", MATCH),
    ("consulta_cand_2016.zip", r"_PE\.csv$", "cand_2016.csv", MATCH),
    ("ibge_setores_demografia.zip", r"\.csv$", "censo_demografia.csv", SETOR),
    ("ibge_setores_alfabetizacao.zip", r"\.csv$", "censo_alfabetizacao.csv", SETOR),
]


def run(zname, member_re, out_name, flt):
    zpath = RAW / zname
    if not zpath.exists():
        print(f"skip    {out_name}: {zname} not downloaded")
        return
    dest = OUT / out_name
    n = 0
    with zipfile.ZipFile(zpath) as z, open(dest, "w", encoding="utf-8") as out:
        members = [m for m in z.namelist() if re.search(member_re, m)]
        if not members:
            print(f"skip    {out_name}: no member matching {member_re}")
            dest.unlink()
            return
        header_written = False
        for m in members:
            with z.open(m) as fh:
                text = io.TextIOWrapper(fh, encoding="latin-1", newline="")
                header = text.readline()
                if not header_written:
                    out.write(header)
                    header_written = True
                if out_name in MULTILINE:
                    # quoted fields may contain newlines: parse properly
                    w = csv.writer(out, delimiter=";", quoting=csv.QUOTE_ALL, lineterminator="\n")
                    for row in csv.reader(text, delimiter=";"):
                        if TSE_MUN in row:
                            w.writerow([c.replace("\n", " ").replace("\r", " ") for c in row])
                            n += 1
                    continue
                for line in text:
                    if flt is None or flt.search(line):
                        out.write(line)
                        n += 1
    print(f"wrote   {out_name}: {n} rows from {', '.join(members)}")


if __name__ == "__main__":
    import sys
    OUT.mkdir(parents=True, exist_ok=True)
    only = sys.argv[1:]
    for job in JOBS:
        if not only or any(o in job[2] for o in only):
            run(*job)
