// Side-by-side comparison of up to 3 candidates: profile, territory, finance, and a map of who leads where.
import type { App } from "../app";
import { brl, esc, fmt, pct, valid, type Vereador } from "../data";
import { cat, partyColor } from "../colors";
import type { PlaceStyle } from "../map";
import { avatar, badge, bars, bindHrefs, chip, legendCats } from "./common";

export function renderComparar(app: App) {
  const { db, state } = app;
  const def = db.sobreposicao.pares.find((p) => p.ambos_eleitos);
  const ids = (state.cmp ?? (def ? `${def.a},${def.b}` : "")).split(",").filter((n) => db.vByNum.has(n)).slice(0, 3);
  const cs = ids.map((n) => db.vByNum.get(n)!);
  // distinct colours: party colour unless two share a party, then categorical slots
  const parties = cs.map((c) => c.partido);
  const color = (i: number) => (parties.filter((p) => p === parties[i]).length > 1 ? cat(i) : partyColor(parties[i]));
  app.map.setPoly("none");
  app.map.setOverlay([]);
  const st = new Map<string, PlaceStyle>();
  for (const p of db.locais) {
    const v = db.votos["2024"].vereador[p.id] ?? {};
    const t = valid(v) || 1;
    const sh = cs.map((c) => (v[c.numero] ?? 0) / t);
    const best = sh.indexOf(Math.max(...sh));
    if (sh[best] <= 0) continue;
    const second = [...sh].sort((a, b) => b - a)[1] ?? 0;
    st.set(p.id, { color: color(best), opacity: 0.3 + Math.min(0.6, (sh[best] - second) * 6) });
  }
  app.map.setPlaces(st, (id) => {
    const v = db.votos["2024"].vereador[id] ?? {};
    const t = valid(v) || 1;
    return `<b>${esc(db.byId.get(id)!.nome)}</b><br>${cs.map((c) => `${esc(c.nome)}: ${fmt(v[c.numero] ?? 0)} (${pct((v[c.numero] ?? 0) / t)})`).join("<br>")}`;
  });
  app.legend(legendCats(cs.map((c, i) => ({ label: c.nome, color: color(i) })), "Quem é mais forte em cada local — intensidade = vantagem"));
  const row = (label: string, f: (c: Vereador) => string) => `<tr><th>${esc(label)}</th>${cs.map((c) => `<td>${f(c)}</td>`).join("")}</tr>`;
  const regs = [...new Set(cs.flatMap((c) => Object.keys(c.territorio?.por_regiao ?? {})))]
    .sort((a, b) => cs.reduce((s, c) => s + (c.territorio?.por_regiao[b] ?? 0), 0) - cs.reduce((s, c) => s + (c.territorio?.por_regiao[a] ?? 0), 0)).slice(0, 8);
  const i0 = db.sobreposicao.ids.indexOf(ids[0]), i1 = db.sobreposicao.ids.indexOf(ids[1]);
  app.panel.innerHTML = `<div class="ph"><div class="eyebrow">Comparador</div><h2>Candidatos lado a lado</h2></div>
    <div class="form">${[0, 1, 2].map((i) => `<label>Candidato ${i + 1}<input data-i="${i}" list="clist" value="${cs[i] ? `${esc(cs[i].nome)} (${cs[i].numero})` : ""}" placeholder="buscar…"></label>`).join("")}
      <datalist id="clist">${db.vereadores.filter((v) => v.votos >= 300).map((v) => `<option value="${esc(v.nome)} (${v.numero})">`).join("")}</datalist></div>
    ${cs.length >= 2 && i0 >= 0 && i1 >= 0 ? `<div class="callout">Sobreposição territorial ${esc(cs[0].nome)} × ${esc(cs[1].nome)}: <b>${pct(db.sobreposicao.matriz[i0][i1], 0)}</b> · <a data-href="tab=sobreposicao&pair=${ids[0]},${ids[1]}">ver duelo</a></div>` : ""}
    <div class="table-wrap"><table class="tbl cmp"><thead><tr><th></th>${cs.map((c, i) => `<th><div class="namecell">${avatar(c.nome, color(i), "sm")}<a data-href="tab=vereadores&cand=${c.numero}">${esc(c.nome)}</a></div></th>`).join("")}</tr></thead><tbody>
      ${row("Partido", (c) => chip(c.partido, partyColor(c.partido)))}
      ${row("Situação", (c) => badge(c.situacao))}
      ${row("Votos 2024", (c) => `<b>${fmt(c.votos)}</b> <span class="muted">${c.rank}º</span>`)}
      ${row("Votos 2016 → 2020", (c) => `${c.hist_2016?.votos != null ? fmt(c.hist_2016.votos) : "–"} → ${c.hist_2020?.votos != null ? fmt(c.hist_2020.votos) : "–"}`)}
      ${row("Δ desde 2020", (c) => (c.hist_2020?.variacao != null ? `${c.hist_2020.variacao > 0 ? "+" : ""}${fmt(c.hist_2020.variacao)}` : esc(c.trajetoria)))}
      ${row("% do QE", (c) => pct(c.pct_qe, 0))}
      ${row("Margem s/ suplente", (c) => (c.margem_suplente != null ? fmt(c.margem_suplente) : "–"))}
      ${row("Vulnerabilidade", (c) => (c.vulnerabilidade ? `${c.vulnerabilidade.score.toFixed(2).replace(".", ",")} (${c.vulnerabilidade.rank}º)` : "–"))}
      ${row("Região-base", (c) => esc(c.territorio ? `${c.territorio.regiao_base} (${pct(c.territorio.regiao_base_pct, 0)})` : "–"))}
      ${row("Perfil territorial", (c) => esc(c.territorio?.tipo ?? "–"))}
      ${row("Moran's I", (c) => (c.lisa ? c.lisa.moran.toFixed(2).replace(".", ",") : "–"))}
      ${row("Locais liderados", (c) => String(c.dominio_locais ?? 0))}
      ${row("Território × Lula 2022 (r)", (c) => (c.alinhamento_lula != null ? (c.alinhamento_lula > 0 ? "+" : "") + c.alinhamento_lula.toFixed(2).replace(".", ",") : "–"))}
      ${row("Efeito Simão (r)", (c) => (c.efeito_simao != null ? (c.efeito_simao > 0 ? "+" : "") + c.efeito_simao.toFixed(2).replace(".", ",") : "–"))}
      ${row("Receitas", (c) => brl(c.financas?.receita_total))}
      ${row("Custo por voto", (c) => (c.custo_por_voto != null ? brl(c.custo_por_voto, 2) : "–"))}
      ${row("Bens declarados", (c) => brl(c.bens))}
      ${row("Idade · gênero", (c) => `${c.idade ?? "?"} · ${esc(c.genero)}`)}
      ${row("2026", (c) => (c.cand_2026 ? `${esc(c.cand_2026.cargo)} (${esc(c.cand_2026.partido)})` : "–"))}
    </tbody></table></div>
    <h3>Votos por região</h3>
    ${regs.map((r) => `<h4>${esc(r)}</h4>${bars(cs.map((c, i) => ({ label: c.nome, value: c.territorio?.por_regiao[r] ?? 0, color: color(i) })), { format: (x) => fmt(x), max: Math.max(...cs.map((c) => Math.max(...Object.values(c.territorio?.por_regiao ?? { x: 1 })))) })}`).join("")}
    <p class="muted small">Cores: partido de cada candidato (categorias distintas se dois forem do mesmo partido).</p>`;
  bindHrefs(app.panel, (h) => app.go(Object.fromEntries(new URLSearchParams(h))));
  app.panel.querySelectorAll<HTMLInputElement>("input[data-i]").forEach((inp) => inp.addEventListener("change", () => {
    const next = [...ids];
    const m = /\((\d+)\)\s*$/.exec(inp.value);
    const i = +inp.dataset.i!;
    if (m) next[i] = m[1]; else next.splice(i, 1);
    app.go({ cmp: next.filter(Boolean).join(",") });
  }));
}

