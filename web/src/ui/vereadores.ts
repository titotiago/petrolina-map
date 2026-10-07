// Councillor-first views: the 23 elected (+ alternates / names to watch) and a full profile per candidate.
import type { App } from "../app";
import { aggVotes, brl, candName, esc, fmt, pct, ranked, title, valid, type Vereador } from "../data";
import { cat, div, DIV_STOPS, OTHER, scaler, seq, SEQ_STOPS, partyColor } from "../colors";
import type { PlaceStyle } from "../map";
import { avatar, badge, bars, bindHrefs, chip, csvDownload, dbars, legendCats, legendRamp, meter, partyLegend, sparkline, table, tiles } from "./common";

const SIT = (s: string) => (s === "ELEITO POR QP" ? "QP" : s === "ELEITO POR MÉDIA" ? "Média" : title(s));

function tipFor(app: App) {
  return (id: string) => {
    const p = app.db.byId.get(id)!;
    const v = app.db.votos["2024"].vereador[id] ?? {};
    const t = valid(v);
    const top = ranked(v).filter(([n]) => n.length > 2).slice(0, 3);
    return `<b>${esc(p.nome)}</b><br>${esc(p.regiao)} · ${fmt(p.eleitores)} eleitores<br>${top.map(([n, x]) => `${app.db.vByNum.get(n)?.eleito ? "★ " : ""}${esc(app.db.vByNum.get(n)?.nome ?? n)} — ${pct(x / t)}`).join("<br>")}`;
  };
}

/** Map: each place coloured by the camp of its most-voted councillor candidate. */
function mapLeaders(app: App) {
  const st = new Map<string, PlaceStyle>();
  for (const p of app.db.locais) {
    const v = app.db.votos["2024"].vereador[p.id] ?? {};
    const top = ranked(v).find(([n]) => n.length > 2);
    if (!top) continue;
    const c = app.db.vByNum.get(top[0]);
    st.set(p.id, { color: partyColor(c?.partido), label: c?.nome, stroke: c?.eleito ? undefined : OTHER() });
  }
  app.map.setPlaces(st, tipFor(app));
  app.map.setOverlay([]);
  const leaders = app.db.locais.map((p) => ranked(app.db.votos["2024"].vereador[p.id] ?? {}).find(([n]) => n.length > 2)?.[0]).map((n) => (n ? app.db.vByNum.get(n)?.partido : null));
  app.legend(partyLegend(leaders, "Partido do candidato a vereador mais votado em cada local (nº de locais)", [], partyColor));
}

export function renderVereadores(app: App) {
  const { db, state } = app;
  if (state.cand && db.vByNum.has(state.cand)) return renderProfile(app, db.vByNum.get(state.cand)!);
  app.map.setPoly(state.layer === "none" ? "none" : "regioes", new Map(), () => "");
  mapLeaders(app);
  const filtro = state.filtro ?? "eleitos";
  const cut = db.cadeiras.corte_votos_min_eleito;
  let rows: Vereador[];
  if (filtro === "eleitos") rows = db.vereadores.filter((v) => v.eleito);
  else if (filtro === "observar") rows = db.vereadores.filter((v) => !v.eleito && (v.votos >= 0.6 * cut || (v.territorio?.top_locais[0]?.pct_local ?? 0) > 0.15)).slice(0, 40);
  else if (filtro === "2026") rows = db.vereadores.filter((v) => v.cand_2026);
  else rows = db.vereadores;
  const el = db.vereadores.filter((v) => v.eleito);
  const traj = (k: string) => el.filter((v) => v.trajetoria === k).length;
  app.panel.innerHTML = `
    <div class="ph"><div class="eyebrow">Câmara Municipal · 2025–2028</div><h2>Os 23 vereadores eleitos</h2></div>
    <p class="lead">23 cadeiras. Quociente eleitoral de <b>${fmt(db.cadeiras.qe)}</b> votos: nenhum eleito atingiu o QE sozinho — o mais votado fez ${pct(el[0].pct_qe, 0)} dele.</p>
    ${tiles([
      { label: "Reeleitos", value: String(traj("reeleito")), sub: `${traj("estreante")} estreantes · ${traj("concorreu em 2020") + traj("ex-vereador")} já concorreram` },
      { label: "Base do governo", value: String(el.filter((v) => v.campo === "SIMÃO DURANDO").length), sub: `oposição/outros: ${el.filter((v) => v.campo !== "SIMÃO DURANDO").length}` },
      { label: "Menor votação eleita", value: fmt(cut), sub: `${db.vereadores.filter((v) => !v.eleito && v.votos > cut).length} não eleitos tiveram mais` },
    ])}
    <div class="seg" role="tablist">${[["eleitos", "23 eleitos"], ["observar", "Nomes a observar"], ["2026", "Disputaram 2026"], ["todos", "Todos (254)"]].map(([k, l]) =>
      `<button class="${filtro === k ? "on" : ""}" data-href="filtro=${k}">${l}</button>`).join("")}</div>
    <div id="vtable"></div>
    <p class="muted small">Vulnerabilidade (0–1): margem sobre o 1º suplente do partido (30%), tendência desde 2020 (20%), eleito por média (15%), sobreposição com colega mais votado (15%), custo por voto (10%), dependência da chapa (10%). Clique numa linha para ver o perfil.</p>
    <button class="btn" id="csv">Exportar CSV</button>`;
  bindHrefs(app.panel, (h) => app.go(Object.fromEntries(new URLSearchParams(h))));
  table(app.panel.querySelector("#vtable")!, rows, [
    { key: "nome", label: "Candidato", get: (v) => v.nome, fmt: (_, v) => `<div class="namecell">${avatar(v.nome, partyColor(v.partido), "sm")}<div><b>${esc(v.nome)}</b>${chip(v.partido, partyColor(v.partido))}</div></div>` },
    { key: "votos", label: "Votos", get: (v) => v.votos, num: true },
    { key: "sit", label: "Situação", get: (v) => SIT(v.situacao), fmt: (_, v) => badge(v.situacao) },
    { key: "base", label: "Base", get: (v) => v.territorio?.regiao_base ?? null, fmt: (_, v) => esc(v.territorio ? `${v.territorio.regiao_base} (${pct(v.territorio.regiao_base_pct, 0)})` : "–"), cls: "wrap" },
    { key: "tipo", label: "Perfil", get: (v) => v.territorio?.tipo ?? null },
    { key: "d20", label: "Δ 2020", get: (v) => v.hist_2020?.variacao ?? null, num: true, fmt: (x: number | null) => (x == null ? "–" : (x > 0 ? "+" : "") + fmt(x)) },
    { key: "vul", label: "Vulnerab.", get: (v) => v.vulnerabilidade?.score ?? null, num: true, fmt: (x: number | null) => (x == null ? "–" : meter(x, x > 0.45 ? "#e34948" : x > 0.3 ? "#eda100" : "var(--series-1)")) },
    { key: "cpv", label: "R$/voto", get: (v) => v.custo_por_voto ?? null, num: true, fmt: (x: number | null) => (x == null ? "–" : x.toFixed(2).replace(".", ",")) },
  ], { sort: state.ordenar === "vulnerabilidade" ? "vul" : state.ordenar === "custo" ? "cpv" : "votos", onRow: (v) => app.go({ cand: v.numero }) });
  app.panel.querySelector("#csv")!.addEventListener("click", () => csvDownload("vereadores_petrolina_2024.csv",
    ["numero", "nome", "partido", "campo", "situacao", "votos", "regiao_base", "pct_base", "tipo", "variacao_2020", "vulnerabilidade", "receita", "despesa", "custo_por_voto", "bens"],
    rows.map((v) => [v.numero, v.nome, v.partido, v.campo, v.situacao, v.votos, v.territorio?.regiao_base, v.territorio?.regiao_base_pct, v.territorio?.tipo, v.hist_2020?.variacao, v.vulnerabilidade?.score, v.financas?.receita_total, v.financas?.despesa_total, v.custo_por_voto, v.bens])));
}

function renderProfile(app: App, v: Vereador) {
  const { db, state } = app;
  const mode = (state.vmode as string) ?? "share";
  // ---- map
  const st = new Map<string, PlaceStyle>();
  const vals = new Map<string, number>();
  const topIds = new Set((v.territorio?.top_locais ?? []).slice(0, 5).map((t) => t.id));
  for (const p of db.locais) {
    const pv = db.votos["2024"].vereador[p.id] ?? {};
    const x = pv[v.numero] ?? 0;
    const t = valid(pv);
    const city = v.votos / valid(aggVotes(db, "2024", "vereador", db.locais.map((q) => q.id)));
    const prev = v.hist_2020?.por_local?.[p.id] ?? 0;
    vals.set(p.id, mode === "share" ? x / (t || 1) : mode === "votos" ? x : mode === "lq" ? x / (t || 1) / city : x - prev);
  }
  const arr = [...vals.values()];
  const maxE = Math.max(...db.locais.map((p) => p.eleitores));
  const lp = db.geografia.lisa[`vereador:${v.numero}`];
  if (mode === "lisa" && lp) {
    const C: Record<string, [string, string]> = { HH: ["#104281", "Reduto (forte cercado de força)"], HL: ["#86b6ef", "Ilha (forte isolado)"], LH: ["#f4b3b2", "Brecha (fraco no meio da força)"], "0": ["#7c8696", "Sem votos neste local"] };
    for (const [id, c] of Object.entries(lp.classe)) if (c !== "ns" && C[c]) st.set(id, { color: C[c][0], opacity: c === "0" ? 0.45 : 0.85 });
    app.legend(legendCats([...Object.values(C).map(([color, label]) => ({ label, color })), { label: "Sem padrão significativo", color: OTHER() }], `Moran local (I global = ${lp.moran.toFixed(2).replace(".", ",")}) — ${v.nome}`));
  } else if (mode === "delta2020") {
    const m = Math.max(...arr.map(Math.abs), 1);
    vals.forEach((x, id) => st.set(id, { color: div(x / m), radius: 3 + 12 * Math.sqrt(Math.abs(x) / m), label: topIds.has(id) ? fmt(x) : undefined }));
    app.legend(legendRamp(DIV_STOPS(), `−${fmt(m)}`, `+${fmt(m)}`, `Variação de votos 2020→2024 (${v.nome})`));
  } else {
    const sc = mode === "lq" ? { f: (x: number) => Math.min(1, x / 5), lo: 0, hi: 5 } : scaler(arr, 0.98);
    vals.forEach((x, id) => {
      const p = db.byId.get(id)!;
      if (x <= 0) return;
      st.set(id, { color: seq(0.15 + 0.85 * sc.f(x)), radius: mode === "votos" ? 3 + 14 * Math.sqrt(x / Math.max(...arr)) : 3 + 11 * Math.sqrt(p.eleitores / maxE),
        label: topIds.has(id) ? (mode === "votos" ? fmt(x) : mode === "lq" ? `${x.toFixed(1)}×` : pct(x, 0)) : undefined });
    });
    app.legend(legendRamp(SEQ_STOPS, mode === "lq" ? "1×" : mode === "votos" ? "0" : "0%", mode === "lq" ? "5× média" : mode === "votos" ? fmt(sc.hi) : pct(sc.hi, 0),
      mode === "share" ? `% dos votos de vereador no local — ${v.nome}` : mode === "votos" ? `Votos — ${v.nome}` : `Força relativa (local ÷ média da cidade) — ${v.nome}`));
  }
  app.map.setPlaces(st, (id) => {
    const p = db.byId.get(id)!;
    const pv = db.votos["2024"].vereador[id] ?? {};
    const x = pv[v.numero] ?? 0;
    return `<b>${esc(p.nome)}</b><br>${esc(p.regiao)}<br>${esc(v.nome)}: ${fmt(x)} votos (${pct(x / (valid(pv) || 1))})${v.hist_2020?.por_local ? `<br>2020: ${fmt(v.hist_2020.por_local[id] ?? 0)}` : ""}`;
  });
  if (v.territorio) {
    const c = v.territorio.centro;
    app.map.setOverlay([{ center: c, km: v.territorio.raio50_km, color: cat(0) }, { center: c, km: v.territorio.raio80_km, color: cat(1) }]);
  }
  app.map.setPoly("regioes", new Map(), () => "", v.territorio?.regiao_base, 0);
  if (!state.vmode && v.territorio) app.map.fitPlaces(v.territorio.top_locais.map((t) => t.id), 13);
  // ---- panel
  const t = v.territorio;
  const f = v.financas;
  const ov = db.sobreposicao;
  const i = ov.ids.indexOf(v.numero);
  const rivals = i >= 0 ? ov.ids.map((n, j) => ({ n, s: ov.matriz[i][j] })).filter((x) => x.n !== v.numero).sort((a, b) => b.s - a.s).slice(0, 5) : [];
  const aff = v.afinidade_2026;
  const affBlock = (k: string, l: string) => aff?.[k]?.length ? `<div><h4>${l}</h4><ol class="plain">${aff[k].map((a) => `<li>${esc(candName(db, "2026", k, a.numero))} <span class="muted">r=${a.r.toFixed(2)} · ${fmt(a.votos_petrolina)} votos</span></li>`).join("")}</ol></div>` : "";
  const h = v.hist_2020;
  const prof = v.perfil_eleitor ?? {};
  const profRows = [["jovem", "Jovens (16–24)"], ["idoso", "60+"], ["superior", "Ensino superior"], ["baixa_esc", "Analf./lê e escreve"], ["mulheres", "Mulheres"]];
  const placeName = (id: string) => db.byId.get(id)?.nome ?? id;
  app.panel.innerHTML = `
    <div class="drawer-head"><button class="back" data-href="cand=">← lista</button>
      <div class="seg small">${[["share", "% local"], ["votos", "Votos"], ["lq", "Força relativa"], ...(db.geografia.lisa[`vereador:${v.numero}`] ? [["lisa", "Redutos"]] : []), ...(h?.por_local ? [["delta2020", "Δ 2020"]] : [])].map(([k, l]) => `<button class="${mode === k ? "on" : ""}" data-href="vmode=${k}">${l}</button>`).join("")}</div></div>
    <div class="hero">${avatar(v.nome, partyColor(v.partido), "lg")}<div><h2>${esc(v.nome)}</h2>
      <div class="meta">${chip(`${v.partido} · ${v.numero}`, partyColor(v.partido))} ${badge(v.situacao)} ${v.dominio_locais ? `<span class="badge">lidera ${v.dominio_locais} locais</span>` : ""}</div></div></div>
    <div class="row"><button class="btn small primary" data-href="tab=planejador&pmodo=plano&alvo=${v.numero}">Plano de votos 2028</button>
      <button class="btn small" data-href="tab=comparar&cmp=${v.numero}${rivals[0] ? "," + rivals[0].n : ""}">Comparar com rival direto</button></div>
    <p class="muted">${esc(title(v.nome_completo))} · ${esc(v.genero)}, ${v.idade ?? "?"} anos · ${esc(v.ocupacao)} · ${esc(v.instrucao)}<br>
      ${v.eleito ? `<b>Eleito por ${SIT(v.situacao)}</b>` : esc(title(v.situacao))} · ${v.rank}º mais votado · ${v.rank_partido}º no ${esc(v.partido_chave)} · coligação: ${esc(v.campo ? title(v.campo) : "–")} · trajetória: <b>${esc(v.trajetoria)}</b></p>
    ${tiles([
      { label: "Votos", value: fmt(v.votos), sub: `${pct(v.pct_validos, 2)} dos válidos · ${pct(v.pct_qe, 0)} do QE` },
      v.eleito ? { label: "Margem s/ 1º suplente", value: fmt(v.margem_suplente), sub: "do mesmo partido/federação" } : { label: "Faltaram", value: fmt(Math.max(0, db.cadeiras.corte_votos_min_eleito - v.votos)), sub: "p/ o menor eleito (sem contar chapa)" },
      { label: "Custo por voto", value: v.custo_por_voto != null ? brl(v.custo_por_voto, 2) : "–", sub: f ? `despesas ${brl(f.despesa_total)}` : "sem prestação" },
    ])}
    ${v.vulnerabilidade ? `<div class="callout"><b>Vulnerabilidade 2028: ${v.vulnerabilidade.score.toFixed(2)}</b> (${v.vulnerabilidade.rank}º de 23 mais vulnerável)
      ${v.vulnerabilidade.motivos.length ? `<ul>${v.vulnerabilidade.motivos.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : "<p>Sem alertas fortes.</p>"}</div>` : ""}
    <h3>Trajetória</h3>
    ${sparkline([
      { label: "2016", value: v.hist_2016?.cargo === "Vereador" ? v.hist_2016.votos : null },
      { label: "2020", value: h?.cargo === "Vereador" ? (h.votos ?? null) : null },
      { label: "2024", value: v.votos },
    ], partyColor(v.partido))}
    <p class="muted small">${v.hist_2016 ? `2016: ${esc(v.hist_2016.cargo)} pelo ${esc(v.hist_2016.partido)} — ${esc(title(v.hist_2016.situacao))}. ` : "Não concorreu em 2016. "}${h ? `2020: ${esc(h.cargo)} pelo ${esc(h.partido)} — ${esc(title(h.situacao))}.` : "Não concorreu em 2020."}</p>
    ${t ? `<h3>Território</h3>
      <p>Perfil <b>${esc(t.tipo)}</b>: ${pct(t.top10_pct, 0)} dos votos vêm de 10 locais (equivale a ${t.locais_efetivos.toFixed(0)} locais "efetivos"). Metade dos votos está num raio de ${t.raio50_km.toFixed(1)} km do centro de gravidade e 80% em ${t.raio80_km.toFixed(1)} km (círculos no mapa). Lidera a votação de vereador em <b>${t.lidera_em.length}</b> locais.</p>
      <h4>Votos por região</h4>${bars(Object.entries(t.por_regiao).map(([k, x]) => ({ label: k, value: x / v.votos, note: fmt(x), href: `tab=regioes&region=${encodeURIComponent(k)}` })), { max: 1 })}
      <h4>Principais locais</h4>${bars(t.top_locais.map((l) => ({ label: placeName(l.id), value: l.pct_local, note: `${fmt(l.votos)} votos · ${l.lq.toFixed(1)}×`, href: `place=${l.id}` })), { max: Math.max(...t.top_locais.map((l) => l.pct_local)) })}
      <p class="muted small">% = participação do candidato nos votos de vereador do local; × = força relativa à média da cidade.</p>` : ""}
    ${h ? `<h3>2020 → 2024</h3><p>Em 2020: ${esc(h.cargo)} pelo ${esc(h.partido)}, ${esc(title(h.situacao))}${h.votos != null ? `, ${fmt(h.votos)} votos` : ""}${h.variacao != null ? ` → variação de <b>${h.variacao > 0 ? "+" : ""}${fmt(h.variacao)}</b>` : ""}.</p>
      ${h.ganhou_mais?.length ? `<div class="grid2"><div><h4>Onde mais cresceu</h4><ol class="plain">${h.ganhou_mais.map((g) => `<li><a data-href="place=${g.id}">${esc(placeName(g.id))}</a> +${fmt(g.delta)}</li>`).join("")}</ol></div>
      <div><h4>Onde mais perdeu</h4><ol class="plain">${(h.perdeu_mais ?? []).map((g) => `<li><a data-href="place=${g.id}">${esc(placeName(g.id))}</a> ${fmt(g.delta)}</li>`).join("")}</ol></div></div>` : ""}` : `<h3>2020 → 2024</h3><p>Não concorreu em 2020 (estreante).</p>`}
    ${v.cand_2026 ? `<div class="callout"><b>2026:</b> candidato a ${esc(v.cand_2026.cargo)} pelo ${esc(v.cand_2026.partido)} — ${esc(title(v.cand_2026.situacao))}${v.cand_2026.votos_petrolina ? `, ${fmt(v.cand_2026.votos_petrolina)} votos em Petrolina` : ""}.</div>` : ""}
    ${v.modelo ? `<h3>Esperado × real</h3><p>${v.modelo.confiavel
      ? `O perfil dos locais explica bem onde ${esc(v.nome)} tem voto (R² fora da área ${v.modelo.r2_oos.toFixed(2).replace(".", ",")}). Locais com eleitor parecido com o dele "preveem" <b>+${fmt(v.modelo.potencial)}</b> votos ainda não conquistados. <a data-href="tab=planejador&pmodo=plano&alvo=${v.numero}&metodo=modelo">ver no plano de votos</a>`
      : `O perfil dos locais <b>não</b> explica onde ${esc(v.nome)} tem voto (R² fora da área ${v.modelo.r2_oos.toFixed(2).replace(".", ",")}): a votação vem de rede pessoal e território próprio. Crescer depende de presença em novas áreas, não de "público-alvo".`}</p>` : ""}
    ${v.alinhamento_lula != null ? `<h3>Território e polarização</h3><p>Correlação por local com o voto em Lula (2º turno 2022): <b>${v.alinhamento_lula > 0 ? "+" : ""}${v.alinhamento_lula.toFixed(2).replace(".", ",")}</b> — ${v.alinhamento_lula > 0.1 ? "vota mais em áreas lulistas" : v.alinhamento_lula < -0.1 ? "vota mais em áreas onde Bolsonaro foi melhor" : "votação indiferente à divisão Lula × Bolsonaro"}. <span class="muted small">Mede o território, não a posição do candidato.</span></p>` : ""}
    ${v.afinidade_2022 ? `<h3>Puxadores de 2022</h3><p class="muted small">Deputados de 2022 cuja votação em Petrolina mais se parece com a deste vereador — indício de dobradinha passada.</p>
      <div class="grid2">${(["dep_estadual", "dep_federal"] as const).map((k) => v.afinidade_2022?.[k]?.length ? `<div><h4>${k === "dep_estadual" ? "Dep. estadual" : "Dep. federal"}</h4><ol class="plain">${v.afinidade_2022[k].map((a) => `<li>${esc(candName(db, "2022", k, a.numero))} <span class="muted">r=${a.r.toFixed(2)} · ${fmt(a.votos_petrolina)} votos</span></li>`).join("")}</ol></div>` : "").join("")}</div>` : ""}
    ${aff ? `<h3>Afinidade com 2026</h3><p class="muted small">Candidatos de 2026 cuja votação por local mais se parece com a deste vereador em 2024 (correlação). Indica sobreposição de base eleitoral — possível aliança/puxador.</p>
      <div class="grid2">${affBlock("dep_estadual", "Dep. estadual")}${affBlock("dep_federal", "Dep. federal")}</div><div class="grid2">${affBlock("senador", "Senador")}${affBlock("governador", "Governador")}</div>` : ""}
    ${Object.keys(prof).length ? `<h3>Perfil típico do eleitor</h3><p class="muted small">Peso de cada grupo nos locais onde o candidato tem votos, comparado à média da cidade (1,00× = igual).</p>
      ${bars(profRows.map(([k, l]) => ({ label: l, value: prof[k], color: prof[k] >= 1 ? cat(0) : OTHER() })), { max: 1.6, format: (x) => `${x.toFixed(2).replace(".", ",")}×` })}` : ""}
    ${v.concorrencia_interna?.length ? `<h3>Concorrência dentro do ${esc(v.partido_chave)}</h3>
      <p class="muted small">Colegas de chapa com votação relevante e sobreposição territorial. Ameaça = sobreposição × votos relativos. Em 2028 a vaga é disputada primeiro dentro da lista.</p>
      ${bars(v.concorrencia_interna.map((c) => ({ label: (c.eleito ? "★ " : "") + c.nome, value: c.ameaca, note: `${pct(c.sobreposicao, 0)} sobrep. · ${fmt(c.votos)} votos`, color: c.ameaca >= 0.3 && !c.eleito ? "#e34948" : "var(--series-1)", href: `cand=${c.numero}` })), { max: 1, format: (x) => x.toFixed(2).replace(".", ",") })}` : ""}
    ${v.assinatura?.length ? `<h3>Assinatura do eleitorado</h3>
      <p class="muted small">Correlação (ponderada por eleitores) entre a participação do candidato em cada local e características do local. Positivo = vai melhor onde a característica é mais forte.</p>
      ${dbars(v.assinatura.map((a) => ({ label: a.rotulo, value: a.r, fmt: (a.r > 0 ? "+" : "") + a.r.toFixed(2).replace(".", ",") })))}` : ""}
    ${(() => {
      const her = db.extras.heranca.filter((h) => h.herdeiros[0]?.numero === v.numero);
      const es = v.efeito_simao;
      return (es != null ? `<h3>Efeito Simão</h3><p>Correlação entre o voto do vereador e o de Simão por local: <b>${es > 0 ? "+" : ""}${es.toFixed(2).replace(".", ",")}</b> — ${es > 0.2 ? "cresce junto com o prefeito: depende do desempenho do grupo em 2028." : es < -0.15 ? "vai melhor onde Simão vai pior: base própria, independente do prefeito." : "voto pouco ligado ao do prefeito."}</p>` : "")
        + (her.length ? `<h3>Herança de 2020</h3><p>A votação de ${fmt(v.votos)} se parece com a base de ex-vereadores que saíram da Câmara: ${her.map((h) => `<b>${esc(h.nome)}</b> (${esc(h.partido_2020)}, ${fmt(h.votos_2020)} votos em 2020; r=${h.herdeiros[0].r.toFixed(2).replace(".", ",")})`).join(", ")}.</p>` : "");
    })()}
    ${lp ? `<h3>Território estatístico</h3><p>Moran's I = <b>${lp.moran.toFixed(2).replace(".", ",")}</b> ${lp.moran > 0.5 ? "— votação fortemente agrupada em manchas (base de bairro)" : lp.moran > 0.25 ? "— agrupamento moderado" : "— votação pouco agrupada (rede pessoal/temática)"}. ${lp.redutos.length} locais-reduto. <a data-href="vmode=lisa">ver no mapa</a></p>` : ""}
    ${(() => {
      const pc = db.perfilDisputa.candidatos[v.numero];
      if (!pc) return "";
      const F = Object.entries(db.perfilDisputa.features);
      const top = F.map(([k, l]) => ({ l, t: pc.apelo_t[k], pp: pc.apelo_pp[k] })).filter((f) => Math.abs(f.t) >= 2).sort((x, y) => Math.abs(y.t) - Math.abs(x.t)).slice(0, 3);
      const QN: Record<string, string> = { disputa_direta: "disputa direta", disputa_territorial: "disputa territorial", mesmo_lugar_publico_diferente: "mesmo lugar, públicos diferentes", mesmo_publico_outro_lugar: "mesmo público, outro lugar", pouca_disputa: "pouca disputa" };
      const rp = (v.rivais_perfil ?? []).filter((x) => x.perfil > 0.2);
      return `<h3>Perfil do eleitor (além da geografia)</h3>
        <p>${top.length ? `Comparado às mesmas escolas onde teve voto, o eleitor de ${esc(v.nome)} tem ${top.map((f) => `${f.t > 0 ? "mais" : "menos"} <b>${esc(f.l.toLowerCase())}</b> (${f.pp > 0 ? "+" : ""}${f.pp.toFixed(1).replace(".", ",")} p.p.)`).join(", ")}.` : `Sem perfil distinto: vota como a média das escolas onde é forte (nitidez ${pc.nitidez.toFixed(1).replace(".", ",")}).`}</p>
        ${rp.length ? `<h4>Disputam o mesmo perfil de eleitor</h4>${bars(rp.map((x) => ({ label: (db.vByNum.get(x.numero)?.eleito ? "★ " : "") + (db.vByNum.get(x.numero)?.nome ?? x.numero), sub: QN[x.quadrante], value: x.perfil, note: `território ${pct(x.terr_secao, 0)}`, color: partyColor(db.vByNum.get(x.numero)?.partido), href: `tab=sobreposicao&smodo=disputa&pair=${v.numero},${x.numero}` })), { max: 1, format: (y) => (y > 0 ? "+" : "") + y.toFixed(2).replace(".", ",") })}` : ""}`;
    })()}
    ${rivals.length ? `<h3>Quem divide o mesmo eleitorado</h3>${bars(rivals.map((r) => ({ label: (db.vByNum.get(r.n)?.eleito ? "★ " : "") + (db.vByNum.get(r.n)?.nome ?? r.n), sub: db.vByNum.get(r.n)?.partido, value: r.s, href: `tab=sobreposicao&pair=${v.numero},${r.n}` })), { max: 1 })}
      <p class="muted small">Sobreposição = fração da distribuição territorial dos votos que coincide (0–100%).</p>` : ""}
    ${f ? `<h3>Finanças de campanha</h3>${tiles([{ label: "Receitas", value: brl(f.receita_total) }, { label: "Despesas", value: brl(f.despesa_total) }, { label: "Bens declarados", value: brl(v.bens) }])}
      ${bars([["Partido", f.rec_partido], ["Próprios", f.rec_proprios], ["Pessoas físicas", f.rec_pf], ["Outros candidatos", f.rec_outros_cand], ["Vaquinha", f.rec_vaquinha]].filter(([, x]) => (x as number) > 0).map(([l, x]) => ({ label: l as string, value: x as number })), { format: (x) => brl(x) })}
      ${f.doadores_candidatos.length ? `<h4>Recebeu de outros candidatos</h4><ul class="plain">${f.doadores_candidatos.map((d) => `<li>${esc(title(d.nome))} <span class="muted">${esc(d.cargo)} · ${esc(d.partido)}</span> — ${brl(d.valor)}</li>`).join("")}</ul>` : ""}
      ${f.top_doadores_pf?.length ? `<h4>Principais doadores (pessoas físicas)</h4><ul class="plain">${f.top_doadores_pf.map((d) => `<li>${esc(title(d.nome))} — ${brl(d.valor)}</li>`).join("")}</ul>` : ""}
      ${f.top_fornecedores.length ? `<h4>Principais fornecedores</h4><ul class="plain">${f.top_fornecedores.map((d) => `<li>${esc(title(d.nome))} <span class="muted">${esc(d.tipo)}</span> — ${brl(d.valor)}</li>`).join("")}</ul>` : ""}` : `<h3>Finanças</h3><p class="muted">Sem prestação de contas registrada.</p>`}`;
  bindHrefs(app.panel, (hh) => app.go(Object.fromEntries(new URLSearchParams(hh))));
}

