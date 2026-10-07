"""Polling places, boundaries, regions and census tracts."""
import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import Point

from common import IBGE_MUN, PIPE, RAW, haversine, norm, place_id, read

METRIC = 31984  # SIRGAS 2000 / UTM 24S
REGIONS_CSV = PIPE / "regions.csv"
GEOCODE_FIX = PIPE / "geocode_fix.csv"


def ibge(name: str) -> gpd.GeoDataFrame:
    g = gpd.read_file(RAW / f"{name}.gpkg")
    return g[g.CD_MUN == IBGE_MUN].to_crs(4326)


def load_boundaries():
    bairros = ibge("PE_bairros_CD2022").dissolve("NM_BAIRRO", aggfunc={"CD_BAIRRO": "first", "v0001": "first", "v0002": "first", "AREA_KM2": "sum"}).reset_index()
    distritos = ibge("PE_distritos_CD2022")[["CD_DIST", "NM_DIST", "v0001", "AREA_KM2", "geometry"]]
    municipio = distritos.dissolve()[["geometry"]]
    return bairros, distritos, municipio


def locais(year: int) -> pd.DataFrame:
    """One row per polling place (1st round), with sections and electorate."""
    l = read(f"locais_{year}.csv")
    l = l[l.NR_TURNO == "1"]
    l["QT"] = pd.to_numeric(l.QT_ELEITOR_SECAO, errors="coerce").fillna(0).astype(int)
    l["id"] = [place_id(z, n) for z, n in zip(l.NR_ZONA, l.NR_LOCAL_VOTACAO)]
    g = l.groupby("id").agg(
        zona=("NR_ZONA", "first"), local=("NR_LOCAL_VOTACAO", "first"), nome=("NM_LOCAL_VOTACAO", "first"),
        endereco=("DS_ENDERECO", "first"), bairro_tse=("NM_BAIRRO", "first"), lat=("NR_LATITUDE", "first"),
        lon=("NR_LONGITUDE", "first"), eleitores=("QT", "sum"), secoes=("NR_SECAO", lambda s: sorted(int(x) for x in s)),
    ).reset_index()
    g["lat"] = pd.to_numeric(g.lat.str.replace(",", "."), errors="coerce")
    g["lon"] = pd.to_numeric(g.lon.str.replace(",", "."), errors="coerce")
    g.loc[(g.lat == -1) | (g.lon == -1), ["lat", "lon"]] = np.nan
    g["year"] = year
    return g


def fill_coords(p: pd.DataFrame, others: list[pd.DataFrame], bairros: gpd.GeoDataFrame) -> pd.DataFrame:
    p = p.copy()
    p["geo_src"] = np.where(p.lat.notna(), "tse", None)
    # 1) same place name with coordinates in another year
    ref = pd.concat(others).dropna(subset=["lat"])
    ref = ref.assign(k=ref.nome.map(norm)).drop_duplicates("k").set_index("k")
    for i in p.index[p.lat.isna()]:
        k = norm(p.at[i, "nome"])
        if k in ref.index:
            p.loc[i, ["lat", "lon"]] = ref.loc[k, ["lat", "lon"]].values
            p.at[i, "geo_src"] = "tse_outro_ano"
    # 2) manual fixes
    if GEOCODE_FIX.exists():
        fx = pd.read_csv(GEOCODE_FIX, dtype={"id": str})
        for _, f in fx.iterrows():
            m = p.id == f.id
            p.loc[m, ["lat", "lon"]] = [f.lat, f.lon]
            p.loc[m, "geo_src"] = "manual"
    # 3) centroid of the IBGE bairro with the same name
    cent = bairros.set_index(bairros.NM_BAIRRO.map(norm)).to_crs(METRIC).centroid.to_crs(4326)
    for i in p.index[p.lat.isna()]:
        k = norm(p.at[i, "bairro_tse"])
        if k in cent.index:
            p.at[i, "lat"], p.at[i, "lon"] = cent[k].y, cent[k].x
            p.at[i, "geo_src"] = "centroide_bairro"
    # 4) mean position of other polling places (any year) in the same TSE bairro
    allp = pd.concat([p] + others).dropna(subset=["lat"])
    allp = allp.assign(k=allp.bairro_tse.map(norm)).groupby("k")[["lat", "lon"]].mean()
    for i in p.index[p.lat.isna()]:
        k = norm(p.at[i, "bairro_tse"])
        if k in allp.index:
            p.loc[i, ["lat", "lon"]] = allp.loc[k].values
            p.at[i, "geo_src"] = "aprox_bairro_tse"
    return p


# ---------------------------------------------------------------- regions
URBAN_RULES = [  # (name, test(dist_km, bearing_deg))
    ("Centro", lambda d, b: d <= 1.3),
    ("Zona Norte", lambda d, b: b >= 330 or b < 30),
    ("Zona Leste", lambda d, b: 30 <= b < 200),
    ("Zona Oeste (interna)", lambda d, b: d < 4.5),
    ("Zona Oeste (externa)", lambda d, b: True),
]


def default_region(row, centro) -> str:
    bt = norm(row.bairro_tse)
    if row.bairro_ibge:
        dy = (row.b_lat - centro.y) * 111
        dx = (row.b_lon - centro.x) * 111 * np.cos(np.radians(centro.y))
        d, b = float(np.hypot(dx, dy)), float(np.degrees(np.arctan2(dx, dy)) % 360)
        return next(n for n, t in URBAN_RULES if t(d, b))
    if "NILO COELHO" in bt or "MARIA TEREZA" in bt:
        return "Projetos irrigados (Nilo Coelho / Maria Tereza)"
    if "BEBEDOURO" in bt or "MASSANGANO" in bt:
        return "Bebedouro / Massangano"
    if row.distrito in ("Rajada", "Cristália"):
        return "Rajada / Cristália"
    if row.distrito == "Curral Queimado":
        return "Curral Queimado (rural)"
    return "Zona rural da sede"


def assign_areas(p: pd.DataFrame, bairros, distritos) -> pd.DataFrame:
    pts = gpd.GeoDataFrame(p, geometry=[Point(xy) for xy in zip(p.lon, p.lat)], crs=4326)
    pts = gpd.sjoin(pts, distritos[["NM_DIST", "geometry"]], how="left", predicate="within").drop(columns="index_right")
    # nearest bairro within 1.5 km (IBGE bairros don't cover every new subdivision)
    pm = pts.to_crs(METRIC)
    bm = bairros[["NM_BAIRRO", "geometry"]].to_crs(METRIC)
    nb = gpd.sjoin_nearest(pm, bm, how="left", max_distance=1500, distance_col="dist_bairro")
    nb = nb[~nb.index.duplicated()]
    out = p.copy()
    out["distrito"] = pts.NM_DIST.fillna("Petrolina").values
    out["bairro_ibge"] = nb.NM_BAIRRO.where(out.distrito.eq("Petrolina").values).fillna("").values
    out["fora_municipio"] = pts.NM_DIST.isna().values
    return out


def regions(p: pd.DataFrame, bairros) -> pd.DataFrame:
    """Apply regions.csv (created with defaults on first run; edit and re-run to regroup)."""
    cent = bairros.to_crs(METRIC).centroid.to_crs(4326)
    bc = pd.DataFrame({"bairro_ibge": bairros.NM_BAIRRO, "b_lat": cent.y.values, "b_lon": cent.x.values})
    q = p.merge(bc, on="bairro_ibge", how="left")
    centro = cent[bairros.NM_BAIRRO == "Centro"].iloc[0]
    q["regiao_padrao"] = q.apply(lambda r: default_region(r, centro), axis=1)
    if REGIONS_CSV.exists():
        user = pd.read_csv(REGIONS_CSV, dtype=str).set_index("id").regiao
        q["regiao"] = q.id.map(user).fillna(q.regiao_padrao)
    else:
        q["regiao"] = q.regiao_padrao
    q[["id", "nome", "bairro_tse", "bairro_ibge", "distrito", "regiao"]].sort_values(["regiao", "nome"]).to_csv(REGIONS_CSV, index=False)
    return q.drop(columns=["b_lat", "b_lon", "regiao_padrao"])


def map_to_base(other: pd.DataFrame, base: pd.DataFrame) -> dict:
    """Map another year's place ids to 2024 ids: same id+name, else same name, else nearest point."""
    by_id = base.set_index("id")
    by_name = {norm(n): i for n, i in zip(base.nome, base.id)}
    by_bairro = {norm(b): i for b, i in base.sort_values("eleitores")[["bairro_tse", "id"]].values}  # largest place per TSE bairro
    m = {}
    for _, o in other.iterrows():
        if o.id in by_id.index and norm(by_id.at[o.id, "nome"]) == norm(o.nome):
            m[o.id] = (o.id, "id")
        elif norm(o.nome) in by_name:
            m[o.id] = (by_name[norm(o.nome)], "nome")
        elif pd.notna(o.lat):
            d = haversine(o.lat, o.lon, base.lat.values, base.lon.values)
            m[o.id] = (base.id.values[int(np.argmin(d))], f"proximo_{d.min():.2f}km")
        elif norm(o.bairro_tse) in by_bairro:
            m[o.id] = (by_bairro[norm(o.bairro_tse)], "bairro")
        elif o.id in by_id.index:
            m[o.id] = (o.id, "id_sem_nome")
        else:
            m[o.id] = (base.sort_values("eleitores").id.iloc[-1], "sem_referencia")
            print(f"  !! {o.id} {o.nome} has no coordinates/name/bairro match; assigned to largest place")
    return m


# ---------------------------------------------------------------- census
def census(p: pd.DataFrame) -> gpd.GeoDataFrame:
    s = ibge("PE_setores_CD2022")[["CD_SETOR", "SITUACAO", "NM_DIST", "NM_BAIRRO", "AREA_KM2", "v0001", "v0002", "v0007", "geometry"]]
    dem = pd.read_csv(RAW.parent / "interim" / "censo_demografia.csv", sep=";", dtype=str).rename(columns={"CD_setor": "CD_SETOR"})
    alf = pd.read_csv(RAW.parent / "interim" / "censo_alfabetizacao.csv", sep=";", dtype=str).rename(columns={"CD_setor": "CD_SETOR"})
    for df in (dem, alf):
        for c in df.columns[1:]:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    d = pd.DataFrame({"CD_SETOR": dem.CD_SETOR})
    # Demografia: V01009.. male bands, V01020.. female bands (0-4,5-9,10-14,15-19,20-24,25-29,30-39,40-49,50-59,60-69,70+)
    d["pop_10_14"] = dem.V01011.fillna(0) + dem.V01022.fillna(0)
    d["pop_15_19"] = dem.V01012.fillna(0) + dem.V01023.fillna(0)
    d["pop_60m"] = dem[["V01018", "V01019", "V01029", "V01030"]].fillna(0).sum(axis=1)
    a = pd.DataFrame({"CD_SETOR": alf.CD_SETOR})
    a["pop15"] = alf[[f"V00{i}" for i in range(644, 657)]].fillna(0).sum(axis=1)
    a["alfab15"] = alf[[f"V00{i}" for i in range(748, 761)]].fillna(0).sum(axis=1)
    s = s.merge(d, on="CD_SETOR", how="left").merge(a, on="CD_SETOR", how="left")
    for c in ["v0001", "v0002", "v0007", "AREA_KM2"]:
        s[c] = pd.to_numeric(s[c], errors="coerce")
    s["densidade"] = s.v0001 / s.AREA_KM2.replace(0, np.nan)
    s["taxa_alfab"] = s.alfab15 / s.pop15.replace(0, np.nan)
    s["pct_60m"] = s.pop_60m / s.v0001.replace(0, np.nan)
    # nearest polling place (catchment) -> region
    c = s.to_crs(METRIC).representative_point().to_crs(4326)
    lat, lon = c.y.values, c.x.values
    idx = [int(np.argmin(haversine(a, b, p.lat.values, p.lon.values))) for a, b in zip(lat, lon)]
    s["local_id"] = p.id.values[idx]
    s["regiao"] = p.regiao.values[idx]
    return s
