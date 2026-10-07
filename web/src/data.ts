// Data loading, types and client-side aggregation (places -> any grouping).

export interface Place {
  id: string; nome: string; endereco: string; bairro_tse: string; bairro_ibge: string; distrito: string;
  regiao: string; eleitores: number; geo_src: string; zona: number; local: number; lat: number; lon: number;
  secoes: number[]; perfil: Record<string, number>; pop_censo_area: number;
}
export interface TopLocal { id: string; votos: number; pct_local: number; lq: number }
export interface Vereador {
  numero: string; nome: string; nome_completo: string; partido: string; partido_chave: string; federacao: string | null;
  campo: string | null; situacao: string; eleito: boolean; votos: number; rank: number | null; rank_partido: number;
  pct_validos: number; pct_qe: number; genero: string; idade: number | null; instrucao: string; ocupacao: string; cor: string;
  financas?: {
    receita_total: number; despesa_total: number; rec_partido: number; rec_proprios: number; rec_pf: number;
    rec_outros_cand: number; rec_fundo_especial: number; rec_vaquinha: number;
    doadores_candidatos: { nome: string; cargo: string; partido: string; valor: number }[];
    top_doadores_pf: { nome: string; valor: number }[];
    top_fornecedores: { nome: string; tipo: string; valor: number }[];
    despesas_por_tipo: Record<string, number>;
  };
  custo_por_voto?: number | null; bens: number;
  territorio?: {
    hhi: number; locais_efetivos: number; top10_pct: number; centro: [number, number]; raio50_km: number; raio80_km: number;
    regiao_base: string; regiao_base_pct: number; por_regiao: Record<string, number>; lidera_em: string[];
    top_locais: TopLocal[]; tipo: string;
  };
  perfil_eleitor?: Record<string, number>;
  hist_2020?: { cargo: string; partido: string; situacao: string; numero: string; votos: number | null; variacao?: number;
    ganhou_mais?: { id: string; delta: number }[]; perdeu_mais?: { id: string; delta: number }[]; por_local?: Record<string, number> };
  trajetoria: string;
  cand_2026?: { cargo: string; partido: string; situacao: string; numero: string; votos_petrolina: number | null };
  afinidade_2026?: Record<string, { numero: string; r: number; votos_petrolina: number }[]>;
  margem_suplente?: number | null;
  vulnerabilidade?: { score: number; rank: number; fatores: Record<string, number>; motivos: string[] };
  concorrencia_interna?: { numero: string; nome: string; votos: number; eleito: boolean; sobreposicao: number; ameaca: number }[];
  assinatura?: { var: string; rotulo: string; r: number }[];
  lisa?: { moran: number; redutos: string[] };
  dominio_locais?: number;
  efeito_simao?: number;
  rivais_perfil?: { numero: string; perfil: number; terr_secao: number; quadrante: string }[];
  apelo_pp?: Record<string, number>;
}
export interface LisaPack { moran: number; classe: Record<string, string>; redutos: string[] }
export interface Dominio { lider: string; lider_pct: number; segundo: string; segundo_pct: number; n_fortes: number; terra_de_ninguem: boolean; conflito: number; fortes: { numero: string; pct: number }[] }
export interface Segmento { id: number; rotulo: string; locais: string[]; eleitores: number; media: Record<string, number>; z: Record<string, number>; vereadores: { numero: string; nome: string; votos: number; eleito: boolean }[] }
export interface Geografia {
  lisa: Record<string, LisaPack>;
  dominios: { locais: Record<string, Dominio>; dominio: Record<string, number>; conflitos: { a: string; b: string; a_nome: string; b_nome: string; locais: string[] }[] };
  segmentos: { k: number; features: Record<string, string>; cidade: Record<string, number>; segmentos: Segmento[]; por_local: Record<string, number> };
}
export interface CandMeta { nome: string; partido: string; situacao: string }
export interface Partido {
  partido: string; votos: number; nominais: number; legenda: number; pct: number; qp: number; cadeiras: number; pct_qe: number;
  candidatos: number; votos_sem_cadeira: number; faltou_p_mais_uma: number; primeiro_suplente: { numero: string; votos: number } | null; campo: string | null;
}
export interface Cadeiras {
  assentos: number; qe: number; validos: number; ultima_media_vencedora: number; corte_votos_min_eleito: number;
  partidos: Partido[]; eleitos_simulados: { cand: string; partido: string; votos: number; via: string }[]; confere_com_oficial: boolean;
}
export interface Insight { id: number; categoria: string; titulo: string; texto: string; relevancia: number; view: Record<string, unknown>; dados: Record<string, unknown> }
export interface Regiao {
  locais: number; eleitores: number; pct_eleitorado: number; bairros_ibge: string[];
  comparecimento: Record<string, { aptos: number; comp: number; abst: number; brancos_nulos: number }>;
  prefeito_2020: Record<string, number>; prefeito_2024: Record<string, number>; margem_prefeito_2020: number; margem_prefeito_2024: number;
  vereadores_top: { numero: string; nome: string; votos: number; pct: number; eleito: boolean }[];
  vereador_nec: number; pct_voto_em_eleitos: number; pct_legenda: number; vereador_por_campo: Record<string, number>;
  divergencia_governo: number; vereadores_com_base: number; vereadores_esperados: number; representacao: number;
  vereadores_base_nomes: string[]; receita_vereadores_base: number;
  r2026_governador: { numero: string; pct: number }[]; r2026_senador: { numero: string; pct: number }[];
  r2026_dep_federal: { numero: string; pct: number }[]; r2026_dep_estadual: { numero: string; pct: number }[];
  censo: { populacao: number; domicilios: number; pop_10_19: number; novos_eleitores_2028_est: number; taxa_alfab: number; eleitores_por_hab: number };
  perfil: Record<string, number>;
}
export interface Sobreposicao { ids: string[]; nomes: string[]; eleitos: boolean[]; matriz: number[][]; pares: { a: string; b: string; a_nome: string; b_nome: string; sobreposicao: number; ambos_eleitos: boolean }[] }

export interface Extras {
  heranca: { nome: string; partido_2020: string; votos_2020: number; status_2024: string; votos_2024: number | null; herdeiros: { numero: string; nome: string; partido: string; eleito: boolean; r: number }[] }[];
  projecao: { aptos: Record<string, number>; validos_vereador_2028: number; qe_2028: number; qe_2024: number; taxa_voto_valido: number;
    por_regiao: Record<string, Record<string, number>>; por_local: Record<string, number> };
  bancadas: Record<string, { "2020": number; "2024": number }>;
  abstencao: Record<string, number>;
}

export interface PerfilPar { a: string; b: string; a_nome: string; b_nome: string; ambos_eleitos: boolean; terr_local: number | null; terr_secao: number; perfil: number; disputa: number; quadrante: string }
export interface PerfilDisputa {
  features: Record<string, string>; cidade: Record<string, number>; limiares: { territorio: number; perfil: number; perfil_oposto: number };
  ids: string[]; n_secoes: number;
  candidatos: Record<string, { nome: string; partido: string; eleito: boolean; composicao: Record<string, number>; apelo_pp: Record<string, number>; apelo_t: Record<string, number>; nitidez: number }>;
  matriz_perfil: number[][]; matriz_terr_secao: number[][]; pares: PerfilPar[];
}

export interface DB {
  locais: Place[]; byId: Map<string, Place>;
  votos: Record<string, Record<string, Record<string, Record<string, number>>>>; // year -> cargo -> place -> numero -> votes
  detalhe: Record<string, Record<string, Record<string, number[]>>>; // year -> cargo -> place -> cols
  vereadores: Vereador[]; vByNum: Map<string, Vereador>;
  meta: Record<string, Record<string, Record<string, CandMeta>>>;
  cadeiras: Cadeiras; regioes: Record<string, Regiao>; insights: Insight[]; sobreposicao: Sobreposicao;
  geografia: Geografia;
  extras: Extras;
  perfilDisputa: PerfilDisputa;
  geo: { areas: GeoJSON.FeatureCollection; regioes: GeoJSON.FeatureCollection; bairros: GeoJSON.FeatureCollection; setores: GeoJSON.FeatureCollection; distritos: GeoJSON.FeatureCollection };
  info: { gerado_em: string; fontes: string[]; notas: string[] };
}

const j = (f: string) => fetch(`${import.meta.env.BASE_URL}data/${f}`).then((r) => r.json());

export async function load(): Promise<DB> {
  const [locais, res, cand, cadeiras, regioes, insights, sobreposicao, gReg, gBai, gSet, gDis, info, geografia, gAreas, extras, perfilDisputa] = await Promise.all([
    j("locais.json"), j("resultados.json"), j("candidatos.json"), j("cadeiras.json"), j("regioes.json"), j("insights.json"),
    j("sobreposicao.json"), j("regioes.geojson"), j("bairros.geojson"), j("setores.geojson"), j("distritos.geojson"), j("meta.json"),
    j("geografia.json"), j("areas.geojson"), j("extras.json"), j("perfil_disputa.json"),
  ]);
  const vereadores: Vereador[] = cand.vereadores_2024;
  return {
    locais, byId: new Map(locais.map((p: Place) => [p.id, p])), votos: res.votos, detalhe: res.detalhe,
    vereadores, vByNum: new Map(vereadores.map((v) => [v.numero, v])), meta: cand.outros, cadeiras, regioes, insights, sobreposicao,
    geografia, extras, perfilDisputa, geo: { areas: gAreas, regioes: gReg, bairros: gBai, setores: gSet, distritos: gDis }, info,
  };
}

// ---------------------------------------------------------------- aggregation
export const BRANCO_NULO = new Set(["95", "96", "97"]);

export function aggVotes(db: DB, year: string, cargo: string, ids: Iterable<string>): Record<string, number> {
  const out: Record<string, number> = {};
  const src = db.votos[year]?.[cargo] ?? {};
  for (const id of ids) for (const [n, v] of Object.entries(src[id] ?? {})) out[n] = (out[n] ?? 0) + v;
  return out;
}
export interface Det { aptos: number; comp: number; abst: number; nominais: number; brancos: number; nulos: number; legenda: number }
export function aggDet(db: DB, year: string, cargo: string, ids: Iterable<string>): Det {
  const s = [0, 0, 0, 0, 0, 0, 0];
  const src = db.detalhe[year]?.[cargo] ?? {};
  for (const id of ids) (src[id] ?? []).forEach((v, i) => (s[i] += v));
  return { aptos: s[0], comp: s[1], abst: s[2], nominais: s[3], brancos: s[4], nulos: s[5], legenda: s[6] };
}
export function aggPerfil(db: DB, ids: Iterable<string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) for (const [k, v] of Object.entries(db.byId.get(id)?.perfil ?? {})) out[k] = (out[k] ?? 0) + v;
  return out;
}
export function valid(v: Record<string, number>): number {
  return Object.entries(v).reduce((s, [n, x]) => (BRANCO_NULO.has(n) ? s : s + x), 0);
}
export function ranked(v: Record<string, number>, skipBN = true): [string, number][] {
  return Object.entries(v).filter(([n]) => !skipBN || !BRANCO_NULO.has(n)).sort((a, b) => b[1] - a[1]);
}
export function candName(db: DB, year: string, cargo: string, n: string): string {
  return db.meta[year]?.[cargo]?.[n]?.nome ?? n;
}
export function candParty(db: DB, year: string, cargo: string, n: string): string {
  return db.meta[year]?.[cargo]?.[n]?.partido ?? "";
}

// ---------------------------------------------------------------- formatting
export const fmt = (n: number | null | undefined) => (n == null || isNaN(n) ? "–" : Math.round(n).toLocaleString("pt-BR"));
export const pct = (x: number | null | undefined, d = 1) => (x == null || isNaN(x) ? "–" : `${(x * 100).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d })}%`);
export const pp = (x: number | null | undefined, d = 1) => (x == null || isNaN(x) ? "–" : `${x >= 0 ? "+" : ""}${(x * 100).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d })} p.p.`);
export const brl = (x: number | null | undefined, d = 0) => (x == null ? "–" : x.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: d, minimumFractionDigits: d }));
export const title = (s: string) => s.toLowerCase().replace(/(^|\s|\/|\()(\p{L})/gu, (m) => m.toUpperCase());
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
