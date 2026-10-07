"""Build every dataset the web app needs: python3 -I pipeline/build.py"""
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import analysis  # noqa: E402
import geo  # noqa: E402
import results as res  # noqa: E402
import spatial  # noqa: E402
import more  # noqa: E402
import perfil_disputa  # noqa: E402
import eleicoes_extra as ex  # noqa: E402
import osm  # noqa: E402
import modelo  # noqa: E402
import ei  # noqa: E402
from common import OUT, SEATS, r  # noqa: E402

YEARS = [2016, 2020, 2022, 2024, 2026]
ROUND2 = "2022-2"  # 2nd round of 2022 (president + governor)


def dump(name, obj):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / name
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"), default=_default)
    print(f"  {name}: {path.stat().st_size / 1024:.0f} KB")


def _default(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return None if np.isnan(o) else float(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    raise TypeError(type(o))


def geojson(gdf, props, simplify=None, precision=5):
    g = gdf.copy()
    if simplify:
        g["geometry"] = g.to_crs(geo.METRIC).simplify(simplify).to_crs(4326)
    g = g[props + ["geometry"]]
    data = json.loads(g.to_json(drop_id=True))

    def rnd(c):
        return [rnd(x) for x in c] if isinstance(c[0], list) else [round(v, precision) for v in c]

    for f in data["features"]:
        f["geometry"]["coordinates"] = rnd(f["geometry"]["coordinates"])
    return data


def main():
    print("boundaries + polling places")
    bairros, distritos, municipio = geo.load_boundaries()
    loc = {y: geo.locais(y) for y in YEARS}
    base = geo.fill_coords(loc[2024], [loc[2026], loc[2022], loc[2020], loc[2016]], bairros)
    missing = base[base.lat.isna()]
    if len(missing):
        print("  !! places without coordinates (add to pipeline/geocode_fix.csv):")
        print(missing[["id", "nome", "bairro_tse"]].to_string())
        base = base.dropna(subset=["lat"])
    base = geo.assign_areas(base, bairros, distritos)
    base = geo.regions(base, bairros)
    print("  places:", len(base), "| geocoding:", base.geo_src.value_counts().to_dict())
    if base.fora_municipio.any():
        print("  !! outside municipality:", base[base.fora_municipio][["id", "nome"]].to_dict("records"))

    idmaps = {y: geo.map_to_base(loc[y], base) for y in YEARS if y != 2024}
    for y, m in idmaps.items():
        how = pd.Series([v[1].split("_")[0] for v in m.values()]).value_counts().to_dict()
        print(f"  {y} -> 2024 place matching:", how)

    print("votes")
    votes = {y: res.votes(y, idmaps.get(y)) for y in YEARS}
    det = {y: res.detalhe(y, idmaps.get(y)) for y in YEARS}
    votes[ROUND2] = res.votes(2022, idmaps[2022], "2")
    det[ROUND2] = res.detalhe(2022, idmaps[2022], "2")
    for key in [*YEARS, ROUND2]:  # every vote must land on a mapped polling place
        y, turno = (2022, "2") if key == ROUND2 else (key, "1")
        raw = pd.concat([res.read(f) for f in res.VOTE_FILES.get(y, [f"votacao_secao_{y}.csv"])])
        raw = raw[raw.NR_TURNO == turno].QT_VOTOS.astype(int).sum()
        kept = votes[key][votes[key].place.isin(base.id)].votos.sum()
        print(f"  {key}: votes kept {kept:,} / raw {raw:,}" + ("" if kept == raw else "  !! MISMATCH"))
    cands = {y: res.candidates(y) for y in YEARS}
    cands[ROUND2] = res.candidates(2022, "2")
    camp = res.mayor_coalitions()

    print("electorate profile")
    perfil = analysis.profile_by_place()

    print("census")
    setores = geo.census(base)

    print("analysis")
    ctx = analysis.Context(base=base, votes=votes, det=det, cands=cands, camp=camp, perfil=perfil,
                           setores=setores, fin=res.finance(), bens=res.assets())
    seats = analysis.seat_math(ctx)
    cand_out = analysis.candidates_2024(ctx, seats)
    regions_out = analysis.regions_summary(ctx, cand_out)
    cand_out = analysis.vulnerability(ctx, cand_out)
    pairs = analysis.overlaps(ctx, cand_out)
    insights = analysis.insights(ctx, cand_out, regions_out, seats, pairs)

    print("spatial analysis")
    ctx._elected = {c["numero"] for c in cand_out if c["eleito"]}
    catch = spatial.catchments(base, municipio, setores)
    W = spatial.knn_weights(base)
    lisas = spatial.lisa_all(ctx, cand_out, W)
    dom = spatial.domains(ctx, cand_out)
    intra = spatial.intra_party(ctx, cand_out, None)
    segs = spatial.segments(ctx, cand_out)
    sigs = spatial.signatures(ctx, cand_out, catch)
    for c in cand_out:
        n = c["numero"]
        if n in intra:
            c["concorrencia_interna"] = intra[n]
            t = next((x for x in intra[n] if not x["eleito"] and x["ameaca"] >= 0.3), None)
            if t and c.get("vulnerabilidade"):
                c["vulnerabilidade"]["motivos"].append(f"suplente do próprio partido ({t['nome']}, {t['votos']:,} votos) disputa {t['sobreposicao'] * 100:.0f}% do mesmo território".replace(",", "."))
        if n in sigs:
            c["assinatura"] = sigs[n]
        if f"vereador:{n}" in lisas:
            c["lisa"] = {"moran": lisas[f"vereador:{n}"]["moran"], "redutos": lisas[f"vereador:{n}"]["redutos"]}
        c["dominio_locais"] = dom["dominio"].get(n, 0)

    def add(cat, title, text, score, view=None, data=None):
        insights.append({"categoria": cat, "titulo": title, "texto": text, "relevancia": round(score, 2), "view": view or {}, "dados": data or {}})
    spatial.extra_insights(ctx, cand_out, dom, intra, segs, lisas, catch, add)
    coat = more.coattails(ctx, cand_out)
    heirs = more.inheritance(ctx, cand_out)
    proj = more.projection(ctx)
    proj["qe_2024"] = seats["qe"]
    bench = more.benches(ctx)
    absd = more.abstention_drivers(ctx)
    for c in cand_out:
        if c["numero"] in coat:
            c["efeito_simao"] = coat[c["numero"]]
    more.add_insights(ctx, cand_out, coat, heirs, proj, bench, absd, seats, add)
    ideo = ex.ideology(ctx, cand_out)
    dep22 = ex.deputies_2022(ctx, cand_out)
    hist16 = ex.history_2016(ctx, cand_out)
    ren = ex.renewal(ctx)
    bench16 = ex.benches_2016(ctx)
    ex.region_layers(ctx, regions_out, ideo)
    for c in cand_out:
        n = c["numero"]
        if n in ideo["por_candidato"]:
            c["alinhamento_lula"] = ideo["por_candidato"][n]
        if n in dep22:
            c["afinidade_2022"] = dep22[n]
        if n in hist16:
            c["hist_2016"] = hist16[n]
    for p_, v in bench16.items():
        bench.setdefault(p_, {"2020": 0, "2024": 0})["2016"] = v
    for v in bench.values():
        v.setdefault("2016", 0)
    ex.add_insights(ctx, cand_out, ideo, dep22, hist16, ren, bench16, regions_out, add)
    osm_per, osm_points = osm.facilities(base)
    osm_reg = osm.summary(base, osm_per)
    osm.add_insights(base, osm_per, osm_reg, cand_out, add)
    mod = modelo.run(ctx, cand_out, catch, ideo)
    modelo.add_insights(mod, cand_out, base, add)
    transf = ei.run(ctx)
    ei.add_insights(transf, add)
    for c in cand_out:
        m = mod["candidatos"].get(c["numero"])
        if m:
            c["modelo"] = {"r2_oos": m["r2_oos"], "esperado_total": m["esperado_total"], "confiavel": m["r2_oos"] >= modelo.R2_OK,
                           "potencial": int(sum(max(0, -v) for v in m["residuo"].values()))}
    ctx._overlap = pairs
    pdisp = perfil_disputa.analyse(ctx, cand_out, pairs["ids"])
    perfil_disputa.insights(pdisp, add)
    for c in cand_out:
        if c["numero"] in pdisp["candidatos"]:
            rivals = sorted([p for p in pdisp["pares"] if c["numero"] in (p["a"], p["b"])], key=lambda p: -p["perfil"])[:5]
            c["rivais_perfil"] = [{"numero": p["b"] if p["a"] == c["numero"] else p["a"], "perfil": p["perfil"], "terr_secao": p["terr_secao"], "quadrante": p["quadrante"]} for p in rivals]
            c["apelo_pp"] = pdisp["candidatos"][c["numero"]]["apelo_pp"]
    insights.sort(key=lambda x: -x["relevancia"])
    for i, x in enumerate(insights):
        x["id"] = i + 1

    print("write")
    meta_cand = analysis.candidate_meta(ctx)
    dump("locais.json", analysis.places_out(ctx))
    dump("resultados.json", analysis.results_out(ctx))
    dump("candidatos.json", {"vereadores_2024": cand_out, "outros": meta_cand})
    dump("cadeiras.json", seats)
    dump("regioes.json", regions_out)
    dump("sobreposicao.json", pairs)
    dump("insights.json", insights)
    dump("geografia.json", {"lisa": lisas, "dominios": dom, "segmentos": segs})
    dump("perfil_disputa.json", pdisp)
    dump("modelo.json", mod)
    dump("transferencias.json", transf)
    dump("osm.json", {"categorias": osm.CATEGORIES, "pontos": osm_points, "por_regiao": osm_reg,
                      "por_local": {i: {k: (r(v, 2) if isinstance(v, float) else int(v)) for k, v in row.items()} for i, row in osm_per.iterrows()}})
    dump("extras.json", {"heranca": heirs, "projecao": proj, "bancadas": bench, "abstencao": absd, "ideologia": ideo, "renovacao": ren,
                              "volatilidade": more.volatility(cand_out)})
    el = base.set_index("id").eleitores
    catch["eleitores"] = catch.id.map(el).values
    catch["eleitor_adulto"] = catch.eleitor_adulto.map(lambda x: r(x, 3))
    catch["area_km2"] = catch.area_km2.map(lambda x: r(x, 2))
    catch["renda_media"] = catch.renda_media.map(lambda x: r(x, 0))
    catch["infra"] = catch.infra.map(lambda x: r(x, 3))
    dump("areas.geojson", geojson(catch, ["id", "area_km2", "pop", "pop15", "pop_10_14", "eleitores", "eleitor_adulto", "renda_media", "infra"], simplify=20))
    setores_props = ["CD_SETOR", "SITUACAO", "NM_BAIRRO", "NM_DIST", "v0001", "v0007", "densidade", "taxa_alfab",
                     "pct_60m", "pop_10_14", "pop_15_19", "renda_media", "renda_mediana", "infra", "pavimentacao", "iluminacao",
                     "calcada", "onibus", "local_id", "regiao"]
    st = setores.copy()
    st = st.drop_duplicates("CD_SETOR")
    for c in ["densidade", "taxa_alfab", "pct_60m", "renda_media", "renda_mediana", "infra", "pavimentacao", "iluminacao", "calcada", "onibus"]:
        st[c] = st[c].map(lambda x: r(x, 4))
    dump("setores.geojson", geojson(st, setores_props, simplify=15))
    dump("bairros.geojson", geojson(bairros, ["NM_BAIRRO", "v0001"], simplify=10))
    dump("distritos.geojson", geojson(distritos, ["NM_DIST", "v0001"], simplify=30))
    reg_geo = setores.dissolve("regiao").reset_index()
    dump("regioes.geojson", geojson(reg_geo, ["regiao"], simplify=25))
    dump("meta.json", {
        "gerado_em": date.today().isoformat(), "assentos": SEATS,
        "fontes": [
            "TSE Dados Abertos: votacao_secao, detalhe_votacao_secao, eleitorado_local_votacao, perfil_eleitor_secao, consulta_cand, consulta_coligacao, bem_candidato, prestacao_contas (2020, 2024, 2026)",
            "IBGE Censo 2022: malha de setores/bairros/distritos com atributos; agregados por setor (demografia, alfabetização)",
        ],
        "notas": [
            "Unidade geográfica mínima: local de votação (agregação das seções).",
            "Locais de 2020 e 2026 foram associados aos locais de 2024 por número+nome, nome, ou proximidade.",
            "Regiões definidas em pipeline/regions.csv (editável).",
            "2026: apenas 1º turno; votação para Presidente não incluída no arquivo estadual do TSE.",
        ],
    })
    Path(OUT.parent.parent.parent / "INSIGHTS.md").write_text(analysis.insights_md(insights, seats), encoding="utf-8")
    print("done")


if __name__ == "__main__":
    main()
