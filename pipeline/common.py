"""Shared helpers for the Petrolina pipeline."""
import math
import re
import unicodedata
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
INTERIM = ROOT / "data" / "interim"
OUT = ROOT / "web" / "public" / "data"
PIPE = ROOT / "pipeline"

TSE_MUN = 25216
IBGE_MUN = "2611101"
SEATS = 23


def read(name: str, mun_col: str | None = "CD_MUNICIPIO") -> pd.DataFrame:
    df = pd.read_csv(INTERIM / name, sep=";", dtype=str, keep_default_na=False)
    if mun_col and mun_col in df:
        df = df[df[mun_col] == str(TSE_MUN)]
    return df


def num(s: pd.Series) -> pd.Series:
    """TSE numbers: '1.234,56' or '1234,56' -> float."""
    return pd.to_numeric(s.astype(str).str.replace(".", "", regex=False).str.replace(",", ".", regex=False), errors="coerce").fillna(0)


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
    return " ".join(re.sub(r"[^A-Z0-9 ]", " ", s.upper()).split())


def haversine(lat1, lon1, lat2, lon2):
    """km; accepts scalars or numpy arrays."""
    r = 6371.0
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dphi = p2 - p1
    dl = np.radians(lon2) - np.radians(lon1)
    a = np.sin(dphi / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * r * np.arcsin(np.sqrt(a))


def place_id(zona, local) -> str:
    return f"{int(zona)}-{int(local)}"


def r(x, nd=4):
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return None
    return round(float(x), nd)
