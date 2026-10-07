// 2028 scenarios (roadmap 9) + Monte Carlo seat probabilities (roadmap 10).
// Base = 2024 councillor votes per polling place; adjustments: projected 2028 electorate, region × camp swings,
// per-candidate change, and the party moves made in the slate simulator.
import type { App } from "../app";
import { esc, fmt, pct } from "../data";
import { partyColor } from "../colors";
import type { PlaceStyle } from "../map";
import { allocate, extra, moves, type Cand } from "./planejador";
import { bindHrefs, chip, tiles } from "./common";

const GOV = "SIMÃO DURANDO";
const swings: Record<string, { gov: number; opo: number }> = {};
const candAdj = new Map<string, number>();
let useMoves = true, useGrowth = true, nSims = 2000;
let mc: { pElected: Map<string, number>; seats: Map<string, number[]>; n: number } | null = null;

function scenario(app: App) {
  const { db } = app;
  const proj = db.extras.projecao;
  const a24: Record<string, number> = {};
  for (const [id, row] of Object.entries(db.detalhe["2024"].vereador)) a24[id] = row[0];
  const totals = new Map<string, number>();
  for (const p of db.locais) {
    const g = useGrowth ? (proj.por_local[p.id] ?? a24[p.id] ?? 1) / (a24[p.id] || 1) : 1;
    const sw = swings[p.regiao] ?? { gov: 0, opo: 0 };
    for (const [n, x] of Object.entries(db.votos["2024"].vereador[p.id] ?? {})) {
      if (n.length <= 2) continue;
      const c = db.vByNum.get(n);
      const camp = c?.campo === GOV ? sw.gov : sw.opo;
      totals.set(n, (totals.get(n) ?? 0) + x * g * (1 + camp / 100));
    }
  }
  const k = useGrowth ? proj.aptos["2028"] / proj.aptos["2024"] : 1;
  const cands: Cand[] = db.vereadores.map((v) => ({
    id: v.numero, nome: v.nome, partido: (useMoves ? moves.get(v.numero) : undefined) ?? v.partido_chave,
    votos: Math.round((totals.get(v.numero) ?? 0) * (1 + (candAdj.get(v.numero) ?? 0) / 100)),
  }));
  if (useMoves) extra.forEach((c) => cands.push({ ...c, partido: moves.get(c.id) ?? c.partido, votos: Math.round(c.votos * k) }));
  const legenda = Object.fromEntries(db.cadeiras.partidos.map((p) => [p.partido, Math.round(p.legenda * k)]));
  return { cands, legenda };
}

function gauss(rng: () => number) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function mulberry(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Each run: candidate votes × exp(party shock + individual shock); individual σ calibrated on 2020→2024 changes. */
function monteCarlo(app: App, cands: Cand[], legenda: Record<string, number>, n: number) {
  const { a, b } = app.db.extras.volatilidade;
  const rng = mulberry(2028);
  const pElected = new Map<string, number>();
  const seats = new Map<string, number[]>();
  const parties = [...new Set([...cands.map((c) => c.partido), ...Object.keys(legenda)])];
  for (let i = 0; i < n; i++) {
    const shock = new Map(parties.map((p) => [p, 0.12 * gauss(rng)]));
    const sim = cands.map((c) => {
      const sigma = Math.min(1.2, a + b / Math.sqrt(Math.max(c.votos, 50) / 1000));
      return { ...c, votos: Math.max(0, Math.round(c.votos * Math.exp(shock.get(c.partido)! + sigma * gauss(rng) - sigma * sigma / 2))) };
    });
    const res = allocate(sim, legenda, 23);
    for (const e of res.elected) pElected.set(e.id, (pElected.get(e.id) ?? 0) + 1);
    for (const p of parties) (seats.get(p) ?? seats.set(p, []).get(p)!).push(res.seats[p] ?? 0);
  }
  pElected.forEach((v, k) => pElected.set(k, v / n));
  return { pElected, seats, n };
}

export function renderCenarios(app: App, head: string) {
  const { db } = app;
  const regions = Object.keys(db.regioes).sort((x, y) => db.regioes[y].eleitores - db.regioes[x].eleitores);
  const { cands, legenda } = scenario(app);
  const res = allocate(cands, legenda, 23);
  const base = allocate(db.vereadores.map((v) => ({ id: v.numero, nome: v.nome, partido: v.partido_chave, votos: v.votos })),
    Object.fromEntries(db.cadeiras.partidos.map((p) => [p.partido, p.legenda])), 23);
  const was = new Set(base.elected.map((e) => e.id)), now = new Set(res.elected.map((e) => e.id));
  const nameOf = (id: string) => cands.find((c) => c.id === id)?.nome ?? id;
  // map: region swing as fill on places
  const st = new Map<string, PlaceStyle>();
  for (const p of db.locais) {
    const sw = swings[p.regiao];
    if (sw && (sw.gov || sw.opo)) st.set(p.id, { color: sw.gov - sw.opo >= 0 ? partyColor("UNIÃO") : partyColor("PSDB"), opacity: Math.min(0.85, 0.25 + Math.abs(sw.gov - sw.opo) / 40) });
  }
  app.map.setPlaces(st, (id) => { const p = db.byId.get(id)!; const sw = swings[p.regiao] ?? { gov: 0, opo: 0 }; return `<b>${esc(p.nome)}</b><br>${esc(p.regiao)}<br>Governo ${sw.gov > 0 ? "+" : ""}${sw.gov}% · Oposição ${sw.opo > 0 ? "+" : ""}${sw.opo}%`; });
  app.legend(`<div class="lg-title">Regiões com ajuste no cenário (azul-marinho = governo ganha; azul-tucano = oposição ganha)</div>`);
  const mcRows = mc ? [...mc.pElected.entries()].sort((x, y) => y[1] - x[1]).slice(0, 40) : [];
  const decisivos = mc ? [...mc.pElected.entries()].filter(([, p]) => p >= 0.25 && p <= 0.75).sort((x, y) => y[1] - x[1]) : [];
  app.panel.innerHTML = `${head}
    <p class="lead">Parte dos votos de 2024 por local e aplica ajustes: crescimento do eleitorado, variação por região e campo (governo × oposição), variação por candidato e as mudanças de chapa do simulador. O Monte Carlo repete a eleição milhares de vezes com a incerteza observada entre 2020 e 2024.</p>
    <div class="row">
      <label class="chk"><input type="checkbox" id="growth" ${useGrowth ? "checked" : ""}> Eleitorado projetado 2028</label>
      <label class="chk"><input type="checkbox" id="usemoves" ${useMoves ? "checked" : ""}> Usar mudanças de chapa (${moves.size} mudança(s), ${extra.length} hipotético(s))</label>
      <button class="btn small" id="reset">Zerar ajustes</button></div>
    <h3>Variação por região e campo (%)</h3>
    <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Região</th><th class="num">Eleitores</th><th class="num">Governo</th><th class="num">Oposição</th></tr></thead><tbody>
      ${regions.map((r) => `<tr><td>${esc(r)}</td><td class="num">${fmt(db.regioes[r].eleitores)}</td>
        <td class="num"><input type="number" step="5" min="-80" max="200" value="${swings[r]?.gov ?? 0}" data-r="${esc(r)}" data-k="gov" style="width:70px"></td>
        <td class="num"><input type="number" step="5" min="-80" max="200" value="${swings[r]?.opo ?? 0}" data-r="${esc(r)}" data-k="opo" style="width:70px"></td></tr>`).join("")}
    </tbody></table></div>
    <h3>Variação por candidato (%)</h3>
    <div class="row"><input id="cadd" list="clist2" placeholder="adicionar candidato…" style="flex:1"><datalist id="clist2">${db.vereadores.filter((v) => v.votos >= 300).map((v) => `<option value="${esc(v.nome)} (${v.numero})">`).join("")}</datalist></div>
    ${[...candAdj.entries()].map(([n, v]) => `<div class="row"><span style="flex:1">${esc(db.vByNum.get(n)?.nome ?? n)}</span><input type="number" step="5" value="${v}" data-c="${n}" style="width:80px"> %<button class="btn small" data-del="${n}">×</button></div>`).join("")}
    <h3>Resultado do cenário</h3>
    ${tiles([
      { label: "Quociente", value: fmt(res.qe), sub: `${fmt(res.total)} votos válidos` },
      { label: "Entram", value: String(res.elected.filter((e) => !was.has(e.id)).length), sub: res.elected.filter((e) => !was.has(e.id)).map((e) => esc(nameOf(e.id))).join(", ") || "—" },
      { label: "Saem", value: String(base.elected.filter((e) => !now.has(e.id)).length), sub: base.elected.filter((e) => !now.has(e.id)).map((e) => esc(nameOf(e.id))).join(", ") || "—" },
    ])}
    <h3>Probabilidades (Monte Carlo)</h3>
    <div class="row"><label>Simulações <input id="nsims" type="number" min="200" max="10000" step="200" value="${nSims}" style="width:100px"></label><button class="btn small primary" id="runmc">Rodar simulação</button></div>
    ${mc ? `<p class="muted small">${fmt(mc.n)} eleições simuladas. Incerteza individual σ = ${db.extras.volatilidade.a.toString().replace(".", ",")} + ${db.extras.volatilidade.b.toString().replace(".", ",")}/√(votos/1000), calibrada em ${db.extras.volatilidade.n} candidatos que disputaram 2020 e 2024, mais um choque comum por partido (σ = 0,12).</p>
      ${decisivos.length ? `<div class="callout"><b>Disputa em aberto</b> (25–75% de chance): ${decisivos.map(([id, pr]) => `${esc(nameOf(id))} ${pct(pr, 0)}`).join(" · ")}</div>` : ""}
      <h4>Chance de se eleger</h4>
      <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Candidato</th><th>Partido</th><th class="num">Votos no cenário</th><th class="num">Chance</th></tr></thead><tbody>
        ${mcRows.map(([id, pr]) => { const c = cands.find((x) => x.id === id)!; return `<tr><td>${was.has(id) ? "★ " : ""}${esc(c.nome)}</td><td>${chip(c.partido, partyColor(c.partido))}</td><td class="num">${fmt(c.votos)}</td><td class="num"><span class="meter"><span><i style="width:${Math.round(pr * 100)}%;background:${pr >= 0.75 ? "var(--ok)" : pr >= 0.25 ? "#eda100" : "#e34948"}"></i></span>${pct(pr, 0)}</span></td></tr>`; }).join("")}
      </tbody></table></div>
      <h4>Cadeiras por partido (mediana e faixa de 80%)</h4>
      <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Partido</th><th class="num">Mediana</th><th class="num">Faixa 80%</th><th class="num">2024</th></tr></thead><tbody>
        ${[...mc.seats.entries()].map(([p, arr]) => { const s2 = [...arr].sort((x, y) => x - y); const q = (f: number) => s2[Math.floor(f * (s2.length - 1))]; return { p, med: q(0.5), lo: q(0.1), hi: q(0.9) }; }).filter((x) => x.hi > 0).sort((x, y) => y.med - x.med || y.hi - x.hi)
          .map((x) => `<tr><td>${chip(x.p, partyColor(x.p))}</td><td class="num">${x.med}</td><td class="num">${x.lo}–${x.hi}</td><td class="num">${base.seats[x.p] ?? 0}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="muted small">Clique em "Rodar simulação" para estimar a chance de cada candidato com o cenário atual.</p>`}`;
  const P = app.panel;
  bindHrefs(P, (h) => app.go(Object.fromEntries(new URLSearchParams(h))));
  const rerender = (keepMc = false) => { if (!keepMc) mc = null; renderCenarios(app, head); };
  P.querySelector<HTMLInputElement>("#growth")!.addEventListener("change", (e) => { useGrowth = (e.target as HTMLInputElement).checked; rerender(); });
  P.querySelector<HTMLInputElement>("#usemoves")!.addEventListener("change", (e) => { useMoves = (e.target as HTMLInputElement).checked; rerender(); });
  P.querySelector("#reset")!.addEventListener("click", () => { for (const k of Object.keys(swings)) delete swings[k]; candAdj.clear(); rerender(); });
  P.querySelectorAll<HTMLInputElement>("input[data-r]").forEach((i) => i.addEventListener("change", () => {
    const r = i.dataset.r!; swings[r] ??= { gov: 0, opo: 0 }; swings[r][i.dataset.k as "gov" | "opo"] = +i.value || 0; rerender();
  }));
  P.querySelector<HTMLInputElement>("#cadd")!.addEventListener("change", (e) => { const m = /\((\d+)\)\s*$/.exec((e.target as HTMLInputElement).value); if (m) { candAdj.set(m[1], 0); rerender(); } });
  P.querySelectorAll<HTMLInputElement>("input[data-c]").forEach((i) => i.addEventListener("change", () => { candAdj.set(i.dataset.c!, +i.value || 0); rerender(); }));
  P.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((b) => b.addEventListener("click", () => { candAdj.delete(b.dataset.del!); rerender(); }));
  P.querySelector<HTMLInputElement>("#nsims")!.addEventListener("change", (e) => { nSims = Math.max(200, Math.min(10000, +(e.target as HTMLInputElement).value || 2000)); });
  P.querySelector("#runmc")!.addEventListener("click", () => {
    const btn = P.querySelector<HTMLButtonElement>("#runmc")!;
    btn.textContent = "Simulando…"; btn.disabled = true;
    setTimeout(() => { mc = monteCarlo(app, cands, legenda, nSims); rerender(true); }, 30);
  });
}
