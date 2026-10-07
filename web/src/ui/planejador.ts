// 2028 planner: (1) candidate-level slate simulator — move candidates between parties, add hypothetical
// candidates, scale for electorate growth; (2) vote plan — where a candidate can find the votes to reach a target.
import type { App } from "../app";
import { esc, fmt, pct, valid, type Vereador } from "../data";
import { OTHER, partyColor, seq, SEQ_STOPS } from "../colors";
import type { PlaceStyle } from "../map";
import { avatar, badge, bindHrefs, chip, legendRamp, tiles } from "./common";

// ---------------------------------------------------------------- allocation (mirrors pipeline/results.allocate)
interface Cand { id: string; nome: string; partido: string; votos: number }
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
const moves = new Map<string, string>();
const extra: Cand[] = [];
let scale = false;
let seatsN = 23;
let filter = "";

export function renderPlanejador(app: App) {
  const modo = app.state.pmodo === "plano" ? "plano" : "chapa";
  app.map.setPoly("none");
  app.map.setOverlay([]);
  const head = `<div class="ph"><div class="eyebrow">Planejamento 2028</div><h2>${modo === "chapa" ? "Simulador de chapas" : "Plano de votos"}</h2></div>
    <div class="seg"><button class="${modo === "chapa" ? "on" : ""}" data-href="pmodo=chapa">Simulador de chapas</button><button class="${modo === "plano" ? "on" : ""}" data-href="pmodo=plano">Plano de votos por local</button></div>`;
  if (modo === "chapa") chapa(app, head); else plano(app, head);
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
  // ceiling = 80th percentile of the candidate's share among the 6 nearest places (reachable with a comparable effort)
  for (const r of rows) {
    const nb = rows.map((o) => ({ o, d: Math.hypot(o.p.lat - r.p.lat, (o.p.lon - r.p.lon) * Math.cos((r.p.lat * Math.PI) / 180)) }))
      .filter((x) => x.o.id !== r.id).sort((a, b) => a.d - b.d).slice(0, 6).map((x) => x.o.s).sort((a, b) => a - b);
    (r as typeof r & { teto: number }).teto = Math.max(r.s, nb[Math.floor(nb.length * 0.8)] ?? 0);
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
    <p class="lead">Onde o candidato pode buscar os votos que faltam para a meta. Para cada local, o <b>teto</b> é a participação que ele já alcança nos locais vizinhos (percentil 80 dos 6 mais próximos); o <b>potencial</b> é (teto − participação atual) × votos válidos projetados para 2028.</p>
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
    <p class="muted small">"Brecha" = local fraco dentro de área de força estatística (Moran local) — normalmente o voto mais barato. A estimativa supõe que o candidato consiga em cada local o desempenho que já tem na vizinhança; não considera a reação dos concorrentes.</p>`;
  const P = app.panel;
  bindHrefs(P, (h) => app.go(Object.fromEntries(new URLSearchParams(h))));
  P.querySelector<HTMLInputElement>("#alvo")!.addEventListener("change", (e) => { const m = /\((\d+)\)\s*$/.exec((e.target as HTMLInputElement).value); if (m) app.go({ alvo: m[1], meta: undefined }); });
  P.querySelector<HTMLInputElement>("#meta")!.addEventListener("change", (e) => app.go({ meta: (e.target as HTMLInputElement).value }));
  app.map.fitPlaces(plan.length ? plan.map((r) => r.id) : ids, 13);
}

