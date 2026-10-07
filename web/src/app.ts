// App state + routing shared by all views. State lives in the URL hash so any view is shareable.
import type { DB } from "./data";
import type { ElectionMap } from "./map";

export type Tab = "vereadores" | "mandatos" | "transferencias" | "planejador" | "comparar" | "geografia" | "regioes" | "insights" | "mapa" | "cadeiras" | "sobreposicao" | "candidatos" | "sobre";
export interface State {
  tab: Tab;
  cand?: string;      // vereador number (2024)
  vmode?: "share" | "votos" | "delta2020" | "lq" | "lisa";
  region?: string;
  rmetric?: string;
  place?: string;
  year: string;
  cargo: string;
  metric: string;
  num?: string;       // candidate number in explorer
  layer: "regioes" | "bairros" | "setores" | "none";
  smetric?: string;   // census metric
  pair?: string;      // "a,b" overlap pair
  filtro?: string;
  vis?: "areas" | "pontos";
  gmodo?: string;     // geography view mode
  seg?: string;       // selected segment
  sview?: string;     // overlap: matriz | rede
  smodo?: string;     // overlap: territorio | perfil | disputa
  todos?: string;     // include alternates in pair plots
  ordenar?: string;
  pmodo?: string;     // planner: chapa | plano
  alvo?: string;      // planner: candidate for vote plan
  meta?: string;      // planner: target votes
  cmp?: string;       // comparator: "a,b,c"
  metodo?: string;
  fluxo?: string;     // transfers view
  mmodo?: string;     // mandates view    // vote plan: viz | modelo | comb
}

export interface App {
  db: DB;
  map: ElectionMap;
  state: State;
  go(patch: Partial<State>, replace?: boolean): void;
  panel: HTMLElement;
  legend(html: string): void;
  lassoIds: string[] | null;
}

const DEFAULT: State = { tab: "vereadores", year: "2024", cargo: "prefeito", metric: "vencedor", layer: "regioes" };

export function parseHash(): State {
  const p = new URLSearchParams(location.hash.slice(1));
  const s: Record<string, string> = {};
  p.forEach((v, k) => (s[k] = v));
  return { ...DEFAULT, ...(s as unknown as Partial<State>) };
}
export function toHash(s: State): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(s)) if (v != null && v !== "" && (DEFAULT as unknown as Record<string, unknown>)[k] !== v) p.set(k, String(v));
  return "#" + p.toString();
}
