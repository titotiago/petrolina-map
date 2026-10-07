// 2028 planner: (1) candidate-level slate simulator — move candidates between parties, add hypothetical
// candidates, scale for electorate growth; (2) vote plan — where a candidate can find the votes to reach a target.
import type { App } from "../app";
import { esc, fmt, pct, valid, type Place, type Vereador } from "../data";
import { OTHER, partyColor, seq, SEQ_STOPS } from "../colors";
import type { PlaceStyle } from "../map";
import { avatar, badge, bindHrefs, chip, legendRamp, tiles } from "./common";
import { renderCenarios } from "./cenarios";

// ---------------------------------------------------------------- allocation (mirrors pipeline/results.allocate)
export interface Cand { id: string; nome: string; partido: string; votos: number }
interface Eleito { id: string; partido: string; votos: number; via: string }

export function allocate(cands: Cand[], legenda: Record<string, number>, seats: number) {
  const pv: Record<string, number> = { ...legenda };
  const byP: Record<string, Cand[]> = {};
  for (const c of cands) { pv[c.partido] = (pv[c.partido] ?? 0) + c.votos; (byP[c.partido] ??= []).push(c); }
  Object.values(byP).forEach((l) => l.sort((a, b) => b.votos - a.votos));
  const total = Object.values(pv).reduce((a, b) => a + b, 0);
  let qe = total / seats;
  qe = Math.floor(qe) + (qe - Math.floor(qe) > 0.5 ? 1 : 0);
  const s: Record<string, number> = {};
  const elected: Eleito[] = [];
  const taken = new Set<string>();
  for (const p of Object.keys(pv)) {
    const qp = Math.floor(pv[p] / qe);
    const ok = (byP[p] ?? []).filter((c) => c.votos >= 0.1 * qe).slice(0, qp);
    ok.forEach((c) => { elected.push({ id: c.id, partido: p, votos: c.votos, via: "QP" }); taken.add(c.id); });
    s[p] = ok.length;
  }
  const best = (ps: string[]) => ps.reduce((b, p) => (pv[p] / (s[p] + 1) > pv[b] / (s[b] + 1) ? p : b), ps[0]);
  const elig = new Set(Object.keys(pv).filter((p) => pv[p] >= 0.8 * qe));
  while (elected.length < seats && elig.size) {
    const p = best([...elig]);
    const nx = (byP[p] ?? []).find((c) => !taken.has(c.id) && c.votos >= 0.2 * qe);
    if (!nx) { elig.delete(p); continue; }
    elected.push({ id: nx.id, partido: p, votos: nx.votos, via: "Média" }); taken.add(nx.id); s[p]++;
  }
  while (elected.length < seats) {
    const ps = Object.keys(pv).filter((p) => (byP[p] ?? []).some((c) => !taken.has(c.id)));
    if (!ps.length) break;
    const p = best(ps);
    const nx = byP[p].find((c) => !taken.has(c.id))!;
    elected.push({ id: nx.id, partido: p, votos: nx.votos, via: "Média (todos)" }); taken.add(nx.id); s[p]++;
  }
  return { qe, total, seats: s, pv, elected };
}

// ---------------------------------------------------------------- planner state (per session, in memory)
export const moves = new Map<string, string>();
export const extra: Cand[] = [];
let scale = false;
let seatsN = 23;
let filter = "";

export function renderPlanejador(app: App) {
  const modo = app.state.pmodo === "plano" || app.state.pmodo === "cenarios" ? app.state.pmodo : "chapa";
  app.map.setPoly("none");
  app.map.setOverlay([]);
  const titles: Record<string, string> = { chapa: "Simulador de chapas", cenarios: "Cenários e probabilidades", plano: "Plano de votos" };
  const head = `<div class="ph"><div class="eyebrow">Planejamento 2028</div><h2>${titles[modo]}</h2></div>
    <div class="seg">${[["chapa", "Simulador de chapas"], ["cenarios", "Cenários + Monte Carlo"], ["plano", "Plano de votos e rotas"]].map(([k, l]) => `<button class="${modo === k ? "on" : ""}" data-href="pmodo=${k}">${l}</button>`).join("")}</div>`;
  if (modo === "chapa") chapa(app, head); else if (modo === "cenarios") renderCenarios(app, head); else plano(app, head);
}

// ---------------------------------------------------------------- slate simulator
function chapa(app: App, head: string) {
  const { db } = app;
  const proj = db.extras.projecao;
  const k = scale ? proj.aptos["2028"] / proj.aptos["2024"] : 1;
  const legenda = Object.fromEntries(db.cadeiras.partidos.map((p) => [p.partido, Math.round(p.legenda * k)]));
  const cands: Cand[] = [
    ...db.vereadores.map((v) => ({ id: v.numero, nome: v.nome, partido: moves.get(v.numero) ?? v.partido_chave, votos: Math.round(v.votos * k) })),
    ...extra.map((c) => ({ ...c, partido: moves.get(c.id) ?? c.partido })),
  ];
  const res = allocate(cands, legenda, seatsN);
  const base = allocate(db.vereadores.map((v) => ({ id: v.numero, nome: v.nome, partido: v.partido_chave, votos: v.votos })),
    Object.fromEntries(db.cadeiras.partidos.map((p) => [p.partido, p.legenda])), 23);
  const was = new Set(base.elected.map((e) => e.id));
  const now = new Set(res.elected.map((e) => e.id));
  const entra = res.elected.filter((e) => !was.has(e.id));
  const sai = base.elected.filter((e) => !now.has(e.id));
  const parties = [...new Set([...db.cadeiras.partidos.map((p) => p.partido), ...extra.map((c) => c.partido)])];
  const nameOf = (id: string) => cands.find((c) => c.id === id)?.nome ?? id;
  const list = cands.filter((c) => c.votos >= 400 || moves.has(c.id) || extra.some((e) => e.id === c.id))
    .filter((c) => !filter || c.nome.toLowerCase().includes(filter.toLowerCase()) || c.partido.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => b.votos - a.votos);
  // map: places coloured by the party with most councillor votes after moves
  const st = new Map<string, PlaceStyle>();
  const partyOf = new Map(cands.map((c) => [c.id, c.partido]));
  for (const p of db.locais) {
    const v = db.votos["2024"].vereador[p.id] ?? {};
    const agg: Record<string, number> = {};
    for (const [n, x] of Object.entries(v)) { const pp = partyOf.get(n); if (pp) agg[pp] = (agg[pp] ?? 0) + x; }
    const top = Object.entries(agg).sort((a, b) => b[1] - a[1])[0];
    if (top) st.set(p.id, { color: partyColor(top[0]), opacity: 0.55 });
  }
  app.map.setPlaces(st, (id) => `<b>${esc(db.byId.get(id)!.nome)}</b>`);
  app.legend(`<div class="lg-title">Partido com mais votos de vereador no local, considerando as mudanças de chapa</div>`);
  app.panel.innerHTML = `${head}
    <p class="lead">Mova candidatos entre partidos/federações (supondo que levem os votos de 2024), crie candidatos hipotéticos e veja quem se elege. Aplica as regras completas: QE, quociente partidário, 10% e 20% do QE, sobras e 3ª fase.</p>
    <div class="row"><label>Cadeiras <input id="seats" type="number" min="9" max="55" value="${seatsN}" style="width:80px"></label>
      <label style="flex-direction:row;align-items:center;gap:6px;text-transform:none"><input id="scale" type="checkbox" ${scale ? "checked" : ""}> Escalar votos para o eleitorado projetado de 2028 (×${(proj.aptos["2028"] / proj.aptos["2024"]).toFixed(3).replace(".", ",")})</label>
      <button class="btn small" id="reset">Restaurar 2024</button></div>
    ${tiles([
      { label: "Quociente eleitoral", value: fmt(res.qe), sub: `${fmt(res.total)} votos válidos` },
      { label: "Entram", value: String(entra.length), sub: entra.map((e) => esc(nameOf(e.id))).join(", ") || "nenhuma mudança" },
      { label: "Saem", value: String(sai.length), sub: sai.map((e) => esc(nameOf(e.id))).join(", ") || "nenhuma mudança" },
    ])}
    <h3>Câmara simulada</h3>
    <div class="elected">${res.elected.sort((a, b) => b.votos - a.votos).map((e) => `<span class="chip ${was.has(e.id) ? "" : "new"}" title="${esc(e.via)}"><i style="background:${partyColor(e.partido)}"></i>${esc(nameOf(e.id))} · ${esc(e.partido)}</span>`).join(" ")}</div>
    <h4>Cadeiras por partido</h4>
    <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Partido</th><th class="num">Votos</th><th class="num">% QE</th><th class="num">Cadeiras</th><th class="num">vs 2024</th></tr></thead><tbody>
      ${Object.entries(res.pv).filter(([p, v]) => v > 0 || base.seats[p]).sort((a, b) => b[1] - a[1]).map(([p, v]) => { const d = (res.seats[p] ?? 0) - (base.seats[p] ?? 0); return `<tr><td>${chip(p, partyColor(p))}</td><td class="num">${fmt(v)}</td><td class="num">${pct(v / res.qe, 0)}</td><td class="num">${res.seats[p] ?? 0}</td><td class="num ${d > 0 ? "up" : d < 0 ? "down" : ""}">${d > 0 ? "+" : ""}${d || ""}</td></tr>`; }).join("")}
    </tbody></table></div>
    <h3>Candidatos</h3>
    <div class="row"><input id="flt" placeholder="filtrar por nome ou partido" value="${esc(filter)}" style="flex:1"></div>
    <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Candidato</th><th class="num">Votos</th><th>Partido / federação 2028</th></tr></thead><tbody>
      ${list.map((c) => `<tr class="${now.has(c.id) ? "sel" : ""}"><td>${now.has(c.id) ? "★ " : ""}${esc(c.nome)}${moves.has(c.id) ? ` <span class="badge media">mudou</span>` : ""}</td><td class="num">${fmt(c.votos)}</td>
        <td><select data-c="${c.id}">${parties.map((p) => `<option ${p === c.partido ? "selected" : ""}>${esc(p)}</option>`).join("")}</select></td></tr>`).join("")}
    </tbody></table></div>
    <h3>Adicionar candidato hipotético</h3>
    <div class="row"><input id="hn" placeholder="Nome" style="flex:1"><input id="hv" type="number" placeholder="Votos" style="width:100px">
      <select id="hp">${parties.map((p) => `<option>${esc(p)}</option>`).join("")}</select><button class="btn small primary" id="hadd">Adicionar</button></div>
    <p class="muted small">Votos de legenda mantidos de 2024. Simulações ficam só nesta sessão do navegador.</p>`;
  const P = app.panel;
  bindHrefs(P, (h) => app.go(Object.fromEntries(new URLSearchParams(h))));
  const rerender = () => chapa(app, head);
  P.querySelector<HTMLInputElement>("#seats")!.addEventListener("change", (e) => { seatsN = Math.max(1, +(e.target as HTMLInputElement).value || 23); rerender(); });
  P.querySelector<HTMLInputElement>("#scale")!.addEventListener("change", (e) => { scale = (e.target as HTMLInputElement).checked; rerender(); });
  P.querySelector("#reset")!.addEventListener("click", () => { moves.clear(); extra.length = 0; scale = false; seatsN = 23; rerender(); });
  P.querySelector<HTMLInputElement>("#flt")!.addEventListener("change", (e) => { filter = (e.target as HTMLInputElement).value; rerender(); });
  P.querySelectorAll<HTMLSelectElement>("select[data-c]").forEach((s) => s.addEventListener("change", () => {
    const id = s.dataset.c!;
    const orig = db.vByNum.get(id)?.partido_chave ?? extra.find((c) => c.id === id)?.partido;
    if (s.value === orig) moves.delete(id); else moves.set(id, s.value);
    rerender();
  }));
  P.querySelector("#hadd")!.addEventListener("click", () => {
    const nome = P.querySelector<HTMLInputElement>("#hn")!.value.trim();
    const votos = +P.querySelector<HTMLInputElement>("#hv")!.value;
    if (!nome || !votos) return;
    extra.push({ id: `h${extra.length + 1}`, nome: nome.toUpperCase() + " (hip.)", partido: P.querySelector<HTMLSelectElement>("#hp")!.value, votos });
    rerender();
  });
}

// ---------------------------------------------------------------- vote plan
function plano(app: App, head: string) {
  const { db, state } = app;
  const v: Vereador = db.vByNum.get(state.alvo ?? "") ?? db.vereadores.filter((x) => x.eleito).sort((a, b) => (b.vulnerabilidade?.score ?? 0) - (a.vulnerabilidade?.score ?? 0))[0];
  const proj = db.extras.projecao;
  const cut28 = Math.round(db.cadeiras.corte_votos_min_eleito * proj.qe_2028 / proj.qe_2024);
  const meta = +(state.meta ?? 0) || Math.round(Math.max(v.votos * 1.3, cut28 * 2) / 100) * 100;
  const ids = db.locais.map((p) => p.id);
  const a24 = new Map(ids.map((id) => [id, db.detalhe["2024"].vereador[id]?.[0] ?? 0]));
  const rows = db.locais.map((p) => {
    const vv = db.votos["2024"].vereador[p.id] ?? {};
    const val = valid(vv);
    const s = (vv[v.numero] ?? 0) / (val || 1);
    const g = (proj.por_local[p.id] ?? a24.get(p.id)!) / (a24.get(p.id) || 1);
    return { id: p.id, p, val, val28: val * g, s, votos: vv[v.numero] ?? 0 };
  });
  // ceilings: (a) 80th percentile of the candidate's share among the 6 nearest places; (b) the share the
  // place profile predicts (expected-vs-actual model, only when it is reliable for this candidate)
  const mod = db.modelo.candidatos[v.numero];
  const modOk = !!mod && mod.r2_oos >= 0.25;
  const metodo = state.metodo === "modelo" && modOk ? "modelo" : state.metodo === "comb" && modOk ? "comb" : "viz";
  for (const r of rows) {
    const nb = rows.map((o) => ({ o, d: Math.hypot(o.p.lat - r.p.lat, (o.p.lon - r.p.lon) * Math.cos((r.p.lat * Math.PI) / 180)) }))
      .filter((x) => x.o.id !== r.id).sort((a, b) => a.d - b.d).slice(0, 6).map((x) => x.o.s).sort((a, b) => a - b);
    const tViz = Math.max(r.s, nb[Math.floor(nb.length * 0.8)] ?? 0);
    const tMod = mod && r.val ? Math.max(r.s, (mod.esperado[r.id] ?? 0) / r.val) : r.s;
    (r as typeof r & { teto: number }).teto = metodo === "viz" ? tViz : metodo === "modelo" ? tMod : Math.max(tViz, tMod);
  }
  const R = rows as (typeof rows[number] & { teto: number; ganho: number })[];
  R.forEach((r) => (r.ganho = (r.teto - r.s) * r.val28));
  const baseline = R.reduce((t, r) => t + r.s * r.val28, 0);
  const gap = Math.max(0, meta - baseline);
  const sorted = [...R].filter((r) => r.ganho > 1).sort((a, b) => b.ganho - a.ganho);
  let acc = 0;
  const plan: typeof sorted = [];
  for (const r of sorted) { if (acc >= gap) break; plan.push(r); acc += r.ganho; }
  const lisa = db.geografia.lisa[`vereador:${v.numero}`]?.classe ?? {};
  const st = new Map<string, PlaceStyle>();
  const maxG = Math.max(...plan.map((r) => r.ganho), 1);
  plan.forEach((r, i) => st.set(r.id, { color: seq(0.25 + 0.75 * (r.ganho / maxG)), opacity: 0.85, label: String(i + 1) }));
  for (const r of R) if (!st.has(r.id) && r.votos > 0) st.set(r.id, { color: OTHER(), opacity: 0.18 });
  app.map.setPlaces(st, (id) => { const r = R.find((x) => x.id === id)!; return `<b>${esc(r.p.nome)}</b><br>Hoje: ${pct(r.s)} (${fmt(r.votos)} votos)<br>Teto na vizinhança: ${pct(r.teto)}<br>Potencial: +${fmt(r.ganho)} votos`; });
  app.legend(legendRamp(SEQ_STOPS, "menor", "maior", `Locais prioritários para ${v.nome} — número = ordem de prioridade`));
  const ok = acc >= gap;
  app.panel.innerHTML = `${head}
    <p class="lead">Onde o candidato pode buscar os votos que faltam para a meta. Para cada local, o <b>teto</b> é a participação alcançável e o <b>potencial</b> é (teto − participação atual) × votos válidos projetados para 2028.</p>
    <div class="seg small">${[["viz", "Vizinhança"], ["modelo", "Modelo de perfil"], ["comb", "Combinado"]].map(([k, l]) => `<button class="${metodo === k ? "on" : ""}" ${k !== "viz" && !modOk ? "disabled title=\"O perfil não explica o voto deste candidato\"" : ""} data-href="metodo=${k}">${l}</button>`).join("")}</div>
    <p class="muted small">${metodo === "viz" ? "Teto = o que o candidato já tem nos 6 locais mais próximos (percentil 80)." : metodo === "modelo" ? `Teto = o que o perfil do local prevê para o candidato (modelo esperado × real, R² fora da área ${mod!.r2_oos.toFixed(2).replace(".", ",")}).` : "Teto = o maior entre vizinhança e modelo de perfil."}${!modOk ? ` O modelo de perfil não está disponível para este candidato: o perfil dos locais não explica onde ele tem voto${mod ? ` (R² ${mod.r2_oos.toFixed(2).replace(".", ",")})` : ""} — o voto é de rede pessoal.` : ""}</p>
    <div class="form">
      <label class="wide">Candidato <input id="alvo" list="vlist" value="${esc(v.nome)} (${v.numero})"><datalist id="vlist">${db.vereadores.filter((x) => x.votos >= 300).map((x) => `<option value="${esc(x.nome)} (${x.numero})">`).join("")}</datalist></label>
      <label>Meta de votos <input id="meta" type="number" step="100" value="${meta}"></label>
      <label>Referência <input disabled value="corte 2028 ≈ ${fmt(cut28)}"></label>
    </div>
    <div class="hero">${avatar(v.nome, partyColor(v.partido), "")}<div><b>${esc(v.nome)}</b> ${chip(v.partido, partyColor(v.partido))} ${badge(v.situacao)}<div class="muted small">${fmt(v.votos)} votos em 2024</div></div></div>
    ${tiles([
      { label: "Base projetada 2028", value: fmt(baseline), sub: "mesma participação, eleitorado 2028" },
      { label: "Faltam", value: fmt(gap), sub: `meta ${fmt(meta)}` },
      { label: ok ? "Locais necessários" : "Potencial total", value: ok ? String(plan.length) : fmt(acc), sub: ok ? `de ${sorted.length} com potencial` : "meta acima do potencial local — exige expansão para novas áreas" },
    ])}
    <h3>Roteiro de prioridade</h3>
    <div class="table-wrap"><table class="tbl compact"><thead><tr><th>#</th><th>Local</th><th class="num">Hoje</th><th class="num">Teto</th><th class="num">+ Votos</th><th class="num">Acum.</th></tr></thead><tbody>
      ${(() => { let c = 0; return plan.map((r, i) => { c += r.ganho; const tag = lisa[r.id] === "LH" ? ` <span class="badge qp">brecha</span>` : lisa[r.id] === "HH" ? ` <span class="badge">reduto</span>` : ""; return `<tr class="clickable" data-href="place=${r.id}"><td>${i + 1}</td><td>${esc(r.p.nome)}${tag}<div class="muted small">${esc(r.p.regiao)}</div></td><td class="num">${pct(r.s)}</td><td class="num">${pct(r.teto)}</td><td class="num">+${fmt(r.ganho)}</td><td class="num">${fmt(baseline + c)}</td></tr>`; }).join(""); })()}
    </tbody></table></div>
    <p class="muted small">"Brecha" = local fraco dentro de área de força estatística (Moran local) — normalmente o voto mais barato. A estimativa não considera a reação dos concorrentes.</p>
    ${routeSection(plan.map((r) => r.p))}`;
  const P = app.panel;
  bindHrefs(P, (h) => app.go(Object.fromEntries(new URLSearchParams(h))));
  P.querySelector<HTMLInputElement>("#alvo")!.addEventListener("change", (e) => { const m = /\((\d+)\)\s*$/.exec((e.target as HTMLInputElement).value); if (m) app.go({ alvo: m[1], meta: undefined }); });
  P.querySelector<HTMLInputElement>("#meta")!.addEventListener("change", (e) => app.go({ meta: (e.target as HTMLInputElement).value }));
  app.map.fitPlaces(plan.length ? plan.map((r) => r.id) : ids, 13);
  bindRoute(app, plan.map((r) => r.p), () => plano(app, head));
}

// ---------------------------------------------------------------- field routes (roadmap 16)
let rotaDias = 3, rotaPorDia = 6, rotaOn = false;
const DAY_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#7b2c8f", "#c0392b", "#00808c", "#ef7d00"];

function km(a: Place, b: Place) {
  const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function tourLen(t: Place[]) { let s = 0; for (let i = 1; i < t.length; i++) s += km(t[i - 1], t[i]); return s; }
function twoOpt(t: Place[]) {
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < t.length - 1; i++) for (let k = i + 1; k < t.length; k++) {
      const nt = [...t.slice(0, i), ...t.slice(i, k + 1).reverse(), ...t.slice(k + 1)];
      if (tourLen(nt) + 1e-9 < tourLen(t)) { t = nt; improved = true; }
    }
  }
  return t;
}
/** Split the priority places into days (angular sweep around the centroid keeps each day compact), then order each day. */
export function planRoutes(places: Place[], days: number, perDay: number) {
  const pts = places.slice(0, days * perDay);
  if (!pts.length) return [];
  const cy = pts.reduce((s, p) => s + p.lat, 0) / pts.length, cx = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
  const sorted = [...pts].sort((a, b) => Math.atan2(a.lat - cy, a.lon - cx) - Math.atan2(b.lat - cy, b.lon - cx));
  const out: Place[][] = [];
  const n = Math.ceil(sorted.length / perDay);
  for (let d = 0; d < n; d++) {
    const day = sorted.slice(d * perDay, (d + 1) * perDay);
    // nearest neighbour from the stop closest to the city centre, then 2-opt
    const start = day.reduce((b, p) => (Math.hypot(p.lat + 9.39, p.lon + 40.5) < Math.hypot(b.lat + 9.39, b.lon + 40.5) ? p : b), day[0]);
    const tour = [start];
    const rest = day.filter((p) => p !== start);
    while (rest.length) { const last = tour[tour.length - 1]; rest.sort((a, b) => km(last, a) - km(last, b)); tour.push(rest.shift()!); }
    out.push(twoOpt(tour));
  }
  return out;
}

function routeSection(places: Place[]) {
  if (!places.length) return "";
  const routes = rotaOn ? planRoutes(places, rotaDias, rotaPorDia) : [];
  return `<h3>Rotas de campo</h3>
    <div class="row"><label>Dias <input id="rdias" type="number" min="1" max="15" value="${rotaDias}" style="width:70px"></label>
      <label>Visitas por dia <input id="rpdia" type="number" min="2" max="15" value="${rotaPorDia}" style="width:70px"></label>
      <button class="btn small ${rotaOn ? "" : "primary"}" id="rgo">${rotaOn ? "Ocultar rotas" : "Gerar rotas"}</button></div>
    ${routes.map((day, i) => {
      const dist = tourLen(day) * 1.35;  // straight line → street distance factor
      const url = "https://www.google.com/maps/dir/" + day.map((p) => `${p.lat},${p.lon}`).join("/");
      return `<div class="seg-card"><h4><span class="sw" style="background:${DAY_COLORS[i % DAY_COLORS.length]}"></span>Dia ${i + 1} · ${day.length} locais · ~${dist.toFixed(1).replace(".", ",")} km</h4>
        <ol class="plain">${day.map((p) => `<li>${esc(p.nome)} <span class="muted small">${esc(p.bairro_tse)}</span></li>`).join("")}</ol>
        <a href="${url}" target="_blank" rel="noopener">Abrir no Google Maps →</a></div>`;
    }).join("")}
    ${rotaOn ? `<p class="muted small">Ordem otimizada (vizinho mais próximo + 2-opt). Distância estimada em linha reta × 1,35. Para trajeto exato, abra no Google Maps.</p>` : ""}`;
}
function bindRoute(app: App, places: Place[], rerender: () => void) {
  const P = app.panel;
  P.querySelector<HTMLInputElement>("#rdias")?.addEventListener("change", (e) => { rotaDias = Math.max(1, +(e.target as HTMLInputElement).value || 3); rerender(); });
  P.querySelector<HTMLInputElement>("#rpdia")?.addEventListener("change", (e) => { rotaPorDia = Math.max(2, +(e.target as HTMLInputElement).value || 6); rerender(); });
  P.querySelector("#rgo")?.addEventListener("click", () => { rotaOn = !rotaOn; rerender(); });
  if (rotaOn) {
    const routes = planRoutes(places, rotaDias, rotaPorDia);
    let n = 0;
    app.map.setRoute(routes.map((day, i) => ({ color: DAY_COLORS[i % DAY_COLORS.length], stops: day.map((p) => ({ lat: p.lat, lon: p.lon, n: ++n })) })));
  } else app.map.setRoute([]);
}

