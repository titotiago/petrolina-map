// Palette roles (validated reference palette) + scales.
const isDark = () => document.documentElement.dataset.theme === "dark" ||
  (document.documentElement.dataset.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);

const CAT_L = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const CAT_D = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
export const cat = (i: number) => (isDark() ? CAT_D : CAT_L)[i % 8];
export const OTHER = () => (isDark() ? "#5f5e5a" : "#a9a8a2");

// ---------------------------------------------------------------- party colours
// Traditional identity colour of each party (as used in Brazilian electoral coverage), stepped so that
// parties that compete in Petrolina stay distinguishable. Federations take their lead party's colour.
// Edit here to re-brand; every chip, avatar, bar and map follows.
export const PARTY: Record<string, { light: string; dark: string; nome: string }> = {
  "UNIÃO": { light: "#0d3b8e", dark: "#4d7fd6", nome: "azul-marinho" },
  "DEM": { light: "#0d3b8e", dark: "#4d7fd6", nome: "azul-marinho (hoje União)" },
  "PSL": { light: "#0d3b8e", dark: "#4d7fd6", nome: "azul-marinho (hoje União)" },
  "PSDB": { light: "#1e9bdc", dark: "#4fb8ec", nome: "azul-tucano" },
  "CIDADANIA": { light: "#e5397c", dark: "#f06a9b", nome: "rosa" },
  "PP": { light: "#5160c9", dark: "#7f8cf0", nome: "azul-índigo" },
  "REPUBLICANOS": { light: "#00808c", dark: "#26b0bd", nome: "azul-petróleo" },
  "PL": { light: "#1e7b34", dark: "#3fae5a", nome: "verde" },
  "PATRIOTA": { light: "#1e7b34", dark: "#3fae5a", nome: "verde (hoje PRD)" },
  "PRD": { light: "#2f6f5e", dark: "#4f9c87", nome: "verde-escuro" },
  "PT": { light: "#c8102e", dark: "#ec4b5f", nome: "vermelho" },
  "PC do B": { light: "#8b0a1a", dark: "#c43a4a", nome: "vermelho-escuro" },
  "PCDOB": { light: "#8b0a1a", dark: "#c43a4a", nome: "vermelho-escuro" },
  "PV": { light: "#3fa34d", dark: "#62c26f", nome: "verde-claro" },
  "PDT": { light: "#e4572e", dark: "#f27a55", nome: "vermelho-alaranjado" },
  "PSB": { light: "#f2b705", dark: "#f6c935", nome: "amarelo" },
  "PSD": { light: "#ef7d00", dark: "#f59a33", nome: "laranja" },
  "AVANTE": { light: "#f6a04d", dark: "#f8b778", nome: "laranja-claro" },
  "SOLIDARIEDADE": { light: "#ff7a3d", dark: "#ff9a6b", nome: "laranja" },
  "MDB": { light: "#2e8540", dark: "#52b264", nome: "verde" },
  "PODE": { light: "#24a85a", dark: "#4cc67e", nome: "verde" },
  "DC": { light: "#7aa83b", dark: "#9cc561", nome: "verde-oliva" },
  "PSC": { light: "#7aa83b", dark: "#9cc561", nome: "verde-oliva (hoje Podemos)" },
  "PSOL": { light: "#7b2c8f", dark: "#a95dbd", nome: "roxo" },
  "REDE": { light: "#00a19a", dark: "#2cc3bc", nome: "verde-água" },
  "UP": { light: "#6d0f1a", dark: "#b0404d", nome: "bordô" },
  "PCO": { light: "#9c2a2a", dark: "#c85a5a", nome: "vermelho" },
  "PSTU": { light: "#b3261e", dark: "#d9554d", nome: "vermelho" },
  "PCB": { light: "#a11d21", dark: "#cf4e52", nome: "vermelho" },
  "NOVO": { light: "#ff6b00", dark: "#ff8f3d", nome: "laranja" },
  "AGIR": { light: "#5b3c99", dark: "#8a6ccc", nome: "roxo" },
  "PTC": { light: "#5b3c99", dark: "#8a6ccc", nome: "roxo (hoje Agir)" },
  "MOBILIZA": { light: "#8d6e63", dark: "#b39488", nome: "marrom" },
  "MISSÃO": { light: "#455a64", dark: "#78909c", nome: "cinza-azulado" },
  "DEMOCRATA": { light: "#3949ab", dark: "#6f7ee0", nome: "azul" },
  "PRTB": { light: "#33691e", dark: "#5f9445", nome: "verde" },
};
const FED_LEAD: Record<string, string> = { "Fed. PT/PC do B/PV": "PT", "Fed. PSDB/CIDADANIA": "PSDB", "Fed. PSOL/REDE": "PSOL" };
export function partyColor(p: string | null | undefined) {
  if (!p) return OTHER();
  const key = FED_LEAD[p] ?? (p.startsWith("Fed. ") ? p.slice(5).split("/")[0] : p);
  const c = PARTY[key];
  return c ? (isDark() ? c.dark : c.light) : OTHER();
}

// Mayoral camps take the colour of the mayoral candidate's party (Simão = União, Julio = PSDB, Odacy = PT, Lara = PL).
export const CAMP_PARTY: Record<string, string> = { "SIMÃO DURANDO": "UNIÃO", "DR. JULIO": "PSDB", "ODACY AMORIM": "PT", "LARA CAVALCANTI": "PL", "MARIA CLARA": "UP", "DR MARCOS": "AGIR" };
export function campColor(camp: string | null | undefined) {
  return camp && camp in CAMP_PARTY ? partyColor(CAMP_PARTY[camp]) : OTHER();
}
/** kept for callers that iterate the main camps */
export const CAMP_SLOT: Record<string, number> = { "SIMÃO DURANDO": 0, "DR. JULIO": 1, "ODACY AMORIM": 7, "LARA CAVALCANTI": 2 };

const SEQ = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b"];
/** t in [0,1] -> blue sequential step */
export function seq(t: number) {
  const i = Math.max(0, Math.min(SEQ.length - 1, Math.round(t * (SEQ.length - 1))));
  return SEQ[i];
}
export const SEQ_STOPS = SEQ;

const BLUE = ["#104281", "#256abf", "#5598e7", "#9ec5f4"];
const RED = ["#f4b3b2", "#ec8584", "#e34948", "#b02f2e"];
/** t in [-1,1]; negative -> red, positive -> blue, ~0 -> neutral grey */
export function div(t: number) {
  if (Math.abs(t) < 0.08) return isDark() ? "#383835" : "#e2e1dc";
  const k = Math.min(3, Math.floor(Math.abs(t) * 4));
  return t > 0 ? BLUE[3 - k] : RED[k];
}
export const DIV_STOPS = () => [...RED.slice().reverse(), isDark() ? "#383835" : "#e2e1dc", ...BLUE.slice().reverse()];

/** quantile-ish normaliser for a set of values */
export function scaler(values: number[], clampPct = 0.95) {
  const v = values.filter((x) => isFinite(x)).sort((a, b) => a - b);
  const lo = v[0] ?? 0;
  const hi = v[Math.floor((v.length - 1) * clampPct)] ?? 1;
  return { lo, hi, f: (x: number) => (hi === lo ? 0.5 : Math.max(0, Math.min(1, (x - lo) / (hi - lo)))) };
}
