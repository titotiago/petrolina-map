"""Public facilities (roadmap item 12).

- Health: official CNES registry (DataSUS open-data API, with coordinates) — public units that serve the SUS.
- Schools, squares/parks: OpenStreetMap (one Overpass query).
OSM is incomplete for social assistance and places of worship in Petrolina, so those are not used.
Both sources are cached in data/raw (delete the files to refresh). Each facility is assigned to the
catchment of its nearest polling place and summarised per place/region.
"""
import json

import numpy as np
import pandas as pd
import requests

from analysis import fmt
from common import RAW, haversine, r

CACHE = RAW / "osm_petrolina.json"
ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
QUERY = """[out:json][timeout:90];
area["IBGE:GEOCODIGO"="2611101"]->.a;
(nwr["amenity"~"^(school|kindergarten|college|university|clinic|hospital|doctors|social_facility|police|place_of_worship|community_centre|marketplace|bus_station)$"](area.a);
 nwr["healthcare"](area.a);
 nwr["leisure"~"^(park|pitch|sports_centre|playground)$"](area.a););
out center tags;"""

CATEGORIES = {
    "ubs": "Unidades básicas de saúde (SUS)", "hospital": "Hospitais e pronto atendimento (SUS)", "saude_outros": "Outros serviços SUS",
    "escola": "Escolas e creches (OSM)", "lazer": "Praças, quadras e parques (OSM)",
}
CNES_CACHE = RAW / "cnes_petrolina.json"
# CNES unit types: 1 posto de saúde, 2 centro de saúde/UBS, 32 unidade móvel fluvial... (grouped below)
CNES_UBS = {1, 2}
CNES_HOSP = {5, 7, 15, 20, 21, 73}


def fetch_cnes() -> list:
    """Page through the CNES API politely (it rate-limits); progress is kept in a .part file across runs."""
    import time
    if CNES_CACHE.exists():
        return json.loads(CNES_CACHE.read_text())
    part = CNES_CACHE.with_suffix(".part.json")
    out = json.loads(part.read_text()) if part.exists() else []
    offset = len(out)
    session = requests.Session()
    while True:
        for attempt in range(6):
            try:
                resp = session.get("https://apidadosabertos.saude.gov.br/cnes/estabelecimentos",
                                   params={"codigo_municipio": 261110, "limit": 20, "offset": offset}, timeout=60,
                                   headers={"Accept": "application/json", "User-Agent": "petrolina-map/1.0"})
                resp.raise_for_status()
                break
            except Exception:
                time.sleep(10 * (attempt + 1))
        else:
            part.write_text(json.dumps(out, ensure_ascii=False))
            raise RuntimeError(f"CNES API unavailable at offset {offset}; re-run to resume")
        page = resp.json().get("estabelecimentos", [])
        if not page:
            break
        out += page
        offset += len(page)
        if offset % 200 == 0:
            part.write_text(json.dumps(out, ensure_ascii=False))
        time.sleep(0.5)
    CNES_CACHE.write_text(json.dumps(out, ensure_ascii=False))
    part.unlink(missing_ok=True)
    return out


def fetch() -> dict:
    """Overpass query (schools, squares) with mirrors and retries; cached."""
    import time
    if CACHE.exists():
        return json.loads(CACHE.read_text())
    last = None
    for attempt in range(3):
        for url in ENDPOINTS:
            try:
                resp = requests.post(url, data={"data": QUERY}, timeout=180,
                                     headers={"User-Agent": "petrolina-map/1.0 (electoral research)", "Accept": "application/json"})
                resp.raise_for_status()
                data = resp.json()
                CACHE.write_text(resp.text)
                return data
            except Exception as e:  # busy server: try the next mirror, then wait and retry
                last = e
        time.sleep(20 * (attempt + 1))
    raise RuntimeError(f"Overpass unavailable: {last}")


def classify(t: dict) -> str | None:
    a, l = t.get("amenity", ""), t.get("leisure", "")
    if a in ("school", "kindergarten", "college", "university"):
        return "escola"
    if l:
        return "lazer"
    return None


def facilities(base: pd.DataFrame) -> tuple[pd.DataFrame, list]:
    data = fetch()
    rows = []
    for e in data.get("elements", []):
        lat = e.get("lat") or (e.get("center") or {}).get("lat")
        lon = e.get("lon") or (e.get("center") or {}).get("lon")
        cat = classify(e.get("tags", {}))
        if lat is None or cat is None:
            continue
        rows.append({"cat": cat, "nome": e.get("tags", {}).get("name", ""), "lat": lat, "lon": lon})
    for e in fetch_cnes():
        lat, lon = e.get("latitude_estabelecimento_decimo_grau"), e.get("longitude_estabelecimento_decimo_grau")
        if lat is None or lon is None or e.get("estabelecimento_faz_atendimento_ambulatorial_sus") != "SIM":
            continue
        t = e.get("codigo_tipo_unidade")
        cat = "ubs" if t in CNES_UBS else "hospital" if t in CNES_HOSP else "saude_outros"
        rows.append({"cat": cat, "nome": (e.get("nome_fantasia") or e.get("nome_razao_social") or "").title(), "lat": lat, "lon": lon})
    f = pd.DataFrame(rows)
    f = f[(f.lat.between(-9.9, -8.5)) & (f.lon.between(-41.0, -40.1))]  # drop mis-geocoded entries
    plat, plon = base.lat.values, base.lon.values
    f["local_id"] = [base.id.values[int(np.argmin(haversine(a, b, plat, plon)))] for a, b in zip(f.lat, f.lon)]
    per = f.pivot_table(index="local_id", columns="cat", values="nome", aggfunc="count", fill_value=0).reindex(base.id, fill_value=0)
    for c in CATEGORIES:
        if c not in per:
            per[c] = 0
    # distance from each polling place to the nearest health unit and school
    for cat, col in (("ubs", "dist_ubs_km"), ("escola", "dist_escola_km")):
        pts = f[f.cat == cat]
        per[col] = [float(haversine(a, b, pts.lat.values, pts.lon.values).min()) if len(pts) else np.nan for a, b in zip(plat, plon)]
    points = [{"c": c, "n": n, "lat": round(a, 5), "lon": round(b, 5)} for c, n, a, b in zip(f.cat, f.nome, f.lat, f.lon)]
    return per, points


def summary(base, per) -> dict:
    reg = base.set_index("id").regiao
    by_reg = per.groupby(reg.reindex(per.index)).sum(numeric_only=True)
    el = base.set_index("id").eleitores.groupby(reg).sum()
    out = {}
    for rg in by_reg.index:
        d = {c: int(by_reg.at[rg, c]) for c in CATEGORIES}
        d["por_10mil_eleitores"] = {c: r(by_reg.at[rg, c] / el[rg] * 10000, 1) for c in ("ubs", "hospital", "escola", "lazer")}
        out[rg] = d
    return out


def add_insights(base, per, regions_osm, cands, add):
    tot = per[list(CATEGORIES)].sum()
    el_reg = base.groupby("regiao").eleitores.sum()
    rs = sorted([kv for kv in regions_osm.items() if el_reg.get(kv[0], 0) >= 5000], key=lambda kv: kv[1]["por_10mil_eleitores"]["ubs"])
    add("geografia", "Unidades básicas de saúde por região (CNES)",
        f"Cadastro oficial do SUS (CNES): {int(tot['ubs'])} unidades básicas de saúde, {int(tot['hospital'])} hospitais/pronto atendimentos e "
        f"{int(tot['saude_outros'])} outros serviços SUS com coordenadas em Petrolina. Entre regiões com 5 mil+ eleitores, menos UBS por eleitor: "
        + ", ".join(f"{k} ({v['por_10mil_eleitores']['ubs']:.1f} por 10 mil)" for k, v in rs[:3])
        + "; mais: " + ", ".join(f"{k} ({v['por_10mil_eleitores']['ubs']:.1f})" for k, v in rs[-2:]) + ".",
        0.66, {"tab": "geografia", "modo": "equipamentos"})
    far = per.dist_ubs_km[per.dist_ubs_km > 3].sort_values(ascending=False)
    if len(far):
        el = base.set_index("id").eleitores
        add("geografia", "Locais longe de uma UBS",
            f"{len(far)} locais de votação ficam a mais de 3 km da UBS mais próxima (CNES), somando {fmt(el.reindex(far.index).sum())} eleitores. "
            "Mais distantes: " + ", ".join(f"{base.set_index('id').nome[i].title()} ({d:.1f} km)" for i, d in far.head(4).items()) + ".",
            0.64, {"tab": "geografia", "modo": "equipamentos"})
