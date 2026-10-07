// Seat math for 2024 (reconstructed and checked against TSE) + a 2028 simulator.
import type { App } from "../app";
import { esc, fmt, pct } from "../data";
import { partyColor } from "../colors";
import { bars, bindHrefs, table } from "./common";

export interface SimResult { qe: number; seats: Record<string, number>; via: { partido: string; fase: string; media: number }[] }

/** Party-level allocation (QP + leftovers by highest average, parties >= 80% QE; then all parties). */
export function simulate(votes: Record<string, number>, seats: number): SimResult {
  const total = Object.values(votes).reduce((a, b) => a + b, 0);
  let qe = total / seats;
  qe = Math.floor(qe) + (qe - Math.floor(qe) > 0.5 ? 1 : 0);
  const s: Record<string, number> = {};
  const via: SimResult["via"] = [];
  for (const [p, v] of Object.entries(votes)) {
    s[p] = Math.floor(v / qe);
    for (let i = 0; i < s[p]; i++) via.push({ partido: p, fase: "QP", media: v });
  }
  let used = Object.values(s).reduce((a, b) => a + b, 0);
  const pick = (elig: string[]) => elig.reduce((best, p) => (votes[p] / (s[p] + 1) > votes[best] / (s[best] + 1) ? p : best), elig[0]);
  const elig = Object.keys(votes).filter((p) => votes[p] >= 0.8 * qe);
  while (used < seats && elig.length) {
    const p = pick(elig);
    via.push({ partido: p, fase: "Média", media: votes[p] / (s[p] + 1) });
    s[p]++; used++;
  }
  const all = Object.keys(votes).filter((p) => votes[p] > 0);
  while (used < seats && all.length) {
    const p = pick(all);
    via.push({ partido: p, fase: "Média (todos)", media: votes[p] / (s[p] + 1) });
    s[p]++; used++;
  }
  return { qe, seats: s, via };
}

export function renderCadeiras(app: App) {
  const { db } = app;
  const c = db.cadeiras;
  app.map.setPoly("regioes", new Map(), () => "");
  app.map.setPlaces(new Map(), (id) => esc(db.byId.get(id)!.nome));
  app.map.setOverlay([]);
  app.legend("");
  const parties = c.partidos.filter((p) => p.votos > 50);
  app.panel.innerHTML = `
    <div class="ph"><div class="eyebrow">Sistema proporcional</div><h2>Como as 23 cadeiras foram distribuídas</h2></div>
    <p class="lead">Votos válidos para vereador: <b>${fmt(c.validos)}</b> ÷ 23 = <b>quociente eleitoral (QE) ${fmt(c.qe)}</b>. Cada partido/federação ganha uma vaga por QE completo (quociente partidário); as vagas restantes vão pelas maiores médias entre quem fez ≥ 80% do QE, com candidato ≥ 20% do QE.
    ${c.confere_com_oficial ? `<span class="ok">✓ Reconstrução confere com o resultado oficial do TSE.</span>` : `<span class="warn">Reconstrução difere do oficial.</span>`}</p>
    <h3>Cadeiras por partido/federação</h3>
    ${bars(parties.filter((p) => p.cadeiras > 0).map((p) => ({ label: p.partido, value: p.cadeiras, color: partyColor(p.partido), note: `${fmt(p.votos)} votos` })), { max: 6, format: (x) => `${x}` })}
    <div id="ptable"></div>
    <p class="muted small">"Faltou p/ +1" = votos adicionais que o partido precisaria (mantidos os demais) para superar a última média vencedora (${fmt(c.ultima_media_vencedora)}).</p>
    <h3>Simulador 2028</h3>
    <p class="muted small">Edite os votos (nominais + legenda) de cada partido/federação e o número de cadeiras. Simulação no nível do partido: não aplica as cláusulas individuais de 10%/20% do QE.</p>
    <div class="row"><label>Cadeiras <input id="nseats" type="number" min="9" max="55" value="${c.assentos}"></label><button class="btn small" id="reset">Restaurar 2024</button></div>
    <div id="sim" class="sim"></div><div id="simout"></div>`;
  table(app.panel.querySelector("#ptable")!, parties, [
    { key: "partido", label: "Partido/federação", get: (p) => p.partido, fmt: (_, p) => `<span class="sw" style="background:${partyColor(p.partido)}"></span>${esc(p.partido)}` },
    { key: "votos", label: "Votos", get: (p) => p.votos, num: true },
    { key: "legenda", label: "Legenda", get: (p) => p.legenda, num: true },
    { key: "pct_qe", label: "% QE", get: (p) => p.pct_qe, num: true, fmt: (x: number) => pct(x, 0) },
    { key: "qp", label: "QP", get: (p) => p.qp, num: true },
    { key: "cadeiras", label: "Cadeiras", get: (p) => p.cadeiras, num: true },
    { key: "faltou", label: "Faltou p/ +1", get: (p) => p.faltou_p_mais_uma, num: true },
    { key: "sup", label: "1º suplente", get: (p) => p.primeiro_suplente?.votos ?? null, num: true, fmt: (x: number | null, p) => (x == null ? "–" : `<a data-href="tab=vereadores&cand=${p.primeiro_suplente!.numero}">${esc(db.vByNum.get(p.primeiro_suplente!.numero)?.nome ?? "")}</a> ${fmt(x)}`) },
  ], { sort: "votos" });
  bindHrefs(app.panel, (h) => app.go(Object.fromEntries(new URLSearchParams(h))));
  const votes: Record<string, number> = Object.fromEntries(parties.map((p) => [p.partido, p.votos]));
  const sim = app.panel.querySelector<HTMLElement>("#sim")!;
  const out = app.panel.querySelector<HTMLElement>("#simout")!;
  const nseats = app.panel.querySelector<HTMLInputElement>("#nseats")!;
  const drawInputs = () => {
    sim.innerHTML = parties.map((p) => `<label><span><span class="sw" style="background:${partyColor(p.partido)}"></span>${esc(p.partido)}</span><input type="number" min="0" step="100" data-p="${esc(p.partido)}" value="${votes[p.partido]}"></label>`).join("");
    sim.querySelectorAll<HTMLInputElement>("input").forEach((i) => i.addEventListener("input", () => { votes[i.dataset.p!] = Math.max(0, +i.value || 0); run(); }));
  };
  const run = () => {
    const r = simulate(votes, Math.max(1, +nseats.value || 23));
    const base = Object.fromEntries(parties.map((p) => [p.partido, p.cadeiras]));
    const rows = Object.entries(r.seats).filter(([p, x]) => x > 0 || (base[p] ?? 0) > 0).sort((a, b) => b[1] - a[1]);
    out.innerHTML = `<p>QE simulado: <b>${fmt(r.qe)}</b></p><table class="tbl compact"><thead><tr><th>Partido</th><th class="num">Cadeiras</th><th class="num">vs 2024</th></tr></thead><tbody>
      ${rows.map(([p, x]) => `<tr><td>${esc(p)}</td><td class="num">${x}</td><td class="num ${x - (base[p] ?? 0) > 0 ? "up" : x - (base[p] ?? 0) < 0 ? "down" : ""}">${x - (base[p] ?? 0) > 0 ? "+" : ""}${x - (base[p] ?? 0)}</td></tr>`).join("")}</tbody></table>`;
  };
  nseats.addEventListener("input", run);
  app.panel.querySelector("#reset")!.addEventListener("click", () => { parties.forEach((p) => (votes[p.partido] = p.votos)); nseats.value = String(c.assentos); drawInputs(); run(); });
  drawInputs();
  run();
}

