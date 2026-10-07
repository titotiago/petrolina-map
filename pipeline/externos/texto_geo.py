"""Find Petrolina neighbourhoods mentioned in free text (indicações, expense descriptions)."""
import re
import unicodedata
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
# strong locator words, or an address number right before the name ("Nº 121 - DOM AVELAR" → "N 121 DOM AVELAR")
LOCATOR = r"(?:\b(?:BAIRRO|BAIRROS|LOTEAMENTO|LOT|CONJUNTO|CONJ|RESIDENCIAL|PROJETO|POVOADO|DISTRITO|COMUNIDADE|NUCLEO|AGROVILA|SITIO)\s+|\b\d+[A-Z]?\s+)"
# names that are also common words / street or institution names: only accepted after a locator word
AMBIGUOUS = {"CENTRO", "JATOBA", "TOPAZIO", "CAPIM", "ATALHO", "SIMPATIA", "CAITITU", "VIVENDAS", "MANDACARU", "TAPERA",
             "CARNEIRO", "PALHINHAS", "SAO JOSE", "OURO PRETO", "BOA ESPERANCA", "NOVA DESCOBERTA", "RIO CORRENTE", "SANTA LUZIA",
             "COSME E DAMIAO", "JOAO DE DEUS", "DOM AVELAR", "DOM MALAN", "MARIA AUXILIADORA", "KM 2", "ZONA MILITAR"}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().upper()
    return " ".join(re.sub(r"[^A-Z0-9 ]", " ", s).split())


class Gazetteer:
    def __init__(self):
        reg = pd.read_csv(ROOT / "pipeline" / "regions.csv", dtype=str).fillna("")
        self.names = {}
        for _, r in reg.iterrows():
            for name in (r.bairro_tse, r.bairro_ibge):
                k = norm(name)
                if len(k) >= 4 and k != "ZONA RURAL":
                    self.names.setdefault(k, (name.title(), r.regiao))
        # common spelling variants
        for k, alias in [("JOSE E MARIA", "JOSE MARIA"), ("COHAB MASSANGANO", "COHAB MASSANGANO"), ("ANTONIO CASSIMIRO", "ANTONIO CASIMIRO"),
                         ("COHAB VI", "COHAB 6"), ("COHAB V", "COHAB 5"), ("COHAB QUATRO", "COHAB IV"), ("GERCINO COELHO", "GERSINO COELHO")]:
            if k in self.names:
                self.names.setdefault(alias, self.names[k])
        keys = sorted(self.names, key=len, reverse=True)
        # never a neighbourhood when followed by "DE" (CENTRO DE SAUDE, CENTRO DE REFERENCIA...)
        self.pats = [(k, re.compile(rf"\b{re.escape(k)}\b(?!\s+DE\b)"), re.compile(rf"{LOCATOR}{re.escape(k)}\b(?!\s+DE\b)")) for k in keys]

    def find(self, text: str):
        """First (longest) neighbourhood mentioned → (display name, region, key) or None."""
        t = norm(text)
        if not t:
            return None
        for k, plain, loc in self.pats:
            if (k not in AMBIGUOUS and plain.search(t)) or loc.search(t):
                return self.names[k] + (k,)
        return None
