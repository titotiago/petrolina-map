"""Data tests on the generated site files (web/public/data). Run: python -m pytest pipeline/tests -q

They check the published numbers against official results and the internal consistency the UI relies on,
so a pipeline change that breaks a file or a total is caught before deploy."""
import json
from pathlib import Path

import pytest

D = Path(__file__).resolve().parents[2] / "web" / "public" / "data"


def _reject(c):
    raise ValueError(f"invalid JSON constant {c} (browsers reject NaN/Infinity)")


def load(name):
    return json.loads((D / name).read_text(encoding="utf-8"), parse_constant=_reject)


@pytest.fixture(scope="module")
def res():
    return load("resultados.json")


@pytest.fixture(scope="module")
def locais():
    return load("locais.json")


def city(res, year, cargo):
    tot = {}
    for v in res["votos"][year][cargo].values():
        for n, x in v.items():
            tot[n] = tot.get(n, 0) + x
    return tot


def test_mayor_2024_matches_official(res):
    t = city(res, "2024", "prefeito")
    valid = sum(v for n, v in t.items() if n not in ("95", "96"))
    official = {"44": 59.16, "45": 28.66, "22": 5.90, "13": 5.69}
    for n, pct in official.items():
        assert round(t[n] / valid * 100, 2) == pct


def test_seat_allocation_matches_official():
    c = load("cadeiras.json")
    assert c["confere_com_oficial"] is True
    assert len(c["eleitos_simulados"]) == 23
    assert c["qe"] == 7903


def test_23_elected_councillors():
    v = load("candidatos.json")["vereadores_2024"]
    el = [x for x in v if x["eleito"]]
    assert len(el) == 23
    assert sum(1 for x in el if x["situacao"] == "ELEITO POR QP") == 17


def test_every_place_is_complete(locais):
    areas = {f["properties"]["id"] for f in load("areas.geojson")["features"]}
    assert len(locais) == 122
    for p in locais:
        assert p["lat"] and p["lon"] and p["regiao"], p["id"]
        assert -9.9 < p["lat"] < -8.5 and -41.0 < p["lon"] < -40.1, p["id"]
        assert p["id"] in areas, p["id"]


def test_all_elections_present(res):
    expected = {"2016": {"prefeito", "vereador"}, "2020": {"prefeito", "vereador"}, "2024": {"prefeito", "vereador"},
                "2022": {"presidente", "governador", "senador", "dep_federal", "dep_estadual"}, "2022-2": {"presidente", "governador"},
                "2026": {"presidente", "governador", "senador", "dep_federal", "dep_estadual"}}
    for y, cargos in expected.items():
        assert cargos <= set(res["votos"][y]), y
        for c in cargos:
            assert sum(city(res, y, c).values()) > 100_000, (y, c)


def test_turnout_details_consistent(res):
    for y, cargos in res["detalhe"].items():
        for c, places in cargos.items():
            for pid, (aptos, comp, abst, *_rest) in places.items():
                assert comp <= aptos and comp + abst == aptos, (y, c, pid)


def test_regions_sum_to_city(locais):
    r = load("regioes.json")
    assert sum(x["eleitores"] for x in r.values()) == sum(p["eleitores"] for p in locais)


def test_ui_references_exist():
    """Every candidate/place id referenced by derived files must exist (prevents UI crashes)."""
    cands = {c["numero"] for c in load("candidatos.json")["vereadores_2024"]}
    places = {p["id"] for p in load("locais.json")}
    ov = load("sobreposicao.json")
    assert set(ov["ids"]) <= cands
    pdisp = load("perfil_disputa.json")
    assert set(pdisp["ids"]) <= cands
    g = load("geografia.json")
    assert set(g["dominios"]["locais"]) <= places
    assert set(g["segmentos"]["por_local"]) == places
    for f in load("transferencias.json").values():
        assert len(f["T"]) == len(f["de"]) and all(abs(sum(row) - 1) < 0.02 for row in f["T"])


def test_insights_are_well_formed():
    ins = load("insights.json")
    assert len(ins) >= 40
    for i in ins:
        assert i["titulo"] and i["texto"] and "nan" not in i["texto"].lower().split() and "None" not in i["texto"], i["titulo"]


def test_every_file_is_strict_json():
    for f in D.iterdir():
        if f.suffix in (".json", ".geojson"):
            load(f.name)
