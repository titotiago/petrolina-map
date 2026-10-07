// Council activity and public money (roadmap 13–14): Câmara indicações/requerimentos, prefeitura spending located
// by neighbourhood (TCE-PE), federal amendments and federal works.
import type { App } from "../app";
import { brl, esc, fmt, pct } from "../data";
import { partyColor, scaler, seq, SEQ_STOPS } from "../colors";
import type { PlaceStyle } from "../map";
import { avatar, bars, bindHrefs, chip, legendCats, legendRamp, table } from "./common";

const MODES: [string, string][] = [["camara", "Câmara"], ["investimentos", "Gasto da prefeitura"], ["emendas", "Emendas federais"], ["obras", "Obras federais"]];

export function renderMandatos(app: App) {
  const modo = MODES.some(([k]) => k === app.state.mmodo) ? app.state.mmodo! : "camara";
  app.map.setPoly("none");
  app.map.setOverlay([]);
  app.map.setPlaces(new Map(), (id) => esc(app.db.byId.get(id)!.nome));
  const head = `<div class="ph"><div class="eyebrow">Mandatos e recursos</div><h2>${esc(MODES.find(([k]) => k === modo)![1])}</h2></div>
    <div class="seg">${MODES.map(([k, l]) => `<button class="${k === modo ? "on" : ""}" data-href="mmodo=${k}">${l}</button>`).join("")}</div>`;
  const body = modo === "camara" ? camara(app) : modo === "investimentos" ? investimentos(app) : modo === "emendas" ? emendas(app) : obras(app);
  app.panel.innerHTML = head + body;
  bindHrefs(app.panel, (h) => app.go(Object.fromEntries(new URLSearchParams(h))));
  const t = app.panel.querySelector<HTMLElement>("#vtab");
  if (t && app.db.mandatos.camara) {
    const C = app.db.mandatos.camara;
    const rows = app.db.vereadores.filter((v) => v.eleito && C.vereadores[v.numero]);
    table(t, rows, [
      { key: "nome", label: "Vereador", get: (v) => v.nome, fmt: (_, v) => `<div class="namecell">${avatar(v.nome, partyColor(v.partido), "sm")}<div><b>${esc(v.nome)}</b>${chip(v.partido, partyColor(v.partido))}</div></div>` },
      { key: "total", label: "Total", get: (v) => C.vereadores[v.numero].total, num: true },
      { key: "ind", label: "Indicações", get: (v) => C.vereadores[v.numero].por_tipo.indicacoes ?? 0, num: true },
      { key: "req", label: "Requerim.", get: (v) => C.vereadores[v.numero].por_tipo.requerimentos ?? 0, num: true },
      { key: "pres", label: "Presença", get: (v) => C.vereadores[v.numero].votacoes?.presenca ?? null, num: true, fmt: (x: number | null) => (x == null ? "–" : pct(x, 0)) },
      { key: "dis", label: "Contra maioria", get: (v) => C.vereadores[v.numero].votacoes?.contra_maioria ?? null, num: true, fmt: (x: number | null) => (x == null ? "–" : pct(x, 0)) },
      { key: "base", label: "Na base × votos", get: (v) => C.vereadores[v.numero].pct_indicacoes_base ?? null, num: true,
        fmt: (x: number | null, v) => (x == null ? "–" : `${pct(x, 0)} × ${pct(C.vereadores[v.numero].pct_votos_base ?? 0, 0)}`) },
    ], { sort: "total", onRow: (v) => app.go({ cand: v.numero }) });
  }
}

function camara(app: App) {
  const { db, state } = app;
  const C = db.mandatos.camara;
  if (!C) return `<p class="muted">Dados da Câmara ainda não coletados. Rode <code>python -I pipeline/externos/camara.py</code> e o build.</p>`;
  const v = state.cand && C.vereadores[state.cand] ? state.cand : null;
  const counts = v ? C.por_vereador_bairro[v] ?? {} : Object.fromEntries(C.bairros.map((b) => [b.bairro, b.n]));
  const max = Math.max(...Object.values(counts), 1);
  const color = v ? partyColor(db.vByNum.get(v)?.partido) : "#2a78d6";
  app.map.setPois(C.bairros.filter((b) => counts[b.bairro]).map((b) => ({ lat: b.lat, lon: b.lon, color, r: 4 + 22 * Math.sqrt(counts[b.bairro] / max),
    name: `<b>${esc(b.bairro)}</b><br>${esc(b.regiao)}<br>${fmt(counts[b.bairro])} indicações/requerimentos${v ? ` de ${esc(C.vereadores[v].nome)}` : ""}` })));
  app.legend(legendCats([{ label: v ? `${C.vereadores[v].nome}: pedidos por bairro` : "Todos os vereadores: pedidos por bairro", color }], "Indicações e requerimentos que citam um bairro (tamanho = quantidade)"));
  const V = v ? C.vereadores[v] : null;
  return `<p class="lead">${fmt(C.total)} indicações e requerimentos coletados do site da Câmara de Petrolina (${C.anos[0]}–${C.anos[C.anos.length - 1]}); ${fmt(C.localizadas)} citam um bairro identificável. Clique num vereador para ver onde ele concentra os pedidos.</p>
    ${V ? `<div class="callout"><div class="drawer-head"><b>${esc(V.nome)}</b><a data-href="cand=">ver todos</a></div>
      <p>${fmt(V.total)} pedidos (${Object.entries(V.por_tipo).map(([k, x]) => `${fmt(x)} ${k}`).join(", ")}); ${fmt(V.localizadas)} com bairro.
      ${V.pct_indicacoes_base != null ? `<b>${pct(V.pct_indicacoes_base, 0)}</b> dos pedidos localizados vão para a região-base, de onde vêm <b>${pct(V.pct_votos_base ?? 0, 0)}</b> dos votos.` : ""}</p>
      <h4>Por ano</h4>${bars(Object.entries(V.por_ano).map(([a, x]) => ({ label: a, value: x })), { format: (x) => fmt(x) })}
      <h4>Bairros mais citados</h4>${bars(V.top_bairros.map((b) => ({ label: b.bairro, value: b.n })), { format: (x) => fmt(x) })}
      <h4>Pedidos recentes</h4><ul class="plain">${V.exemplos.map((e) => `<li><span class="muted small">${esc(e.data)} · ${esc(e.tipo)}</span><br>${esc(e.ementa)} <a href="${esc(e.pdf)}" target="_blank" rel="noopener">PDF</a></li>`).join("")}</ul></div>` : ""}
    <h3>Vereadores eleitos em 2024</h3><div id="vtab"></div>
    <p class="muted small">"Na base × votos" compara a parcela dos pedidos (com bairro) feitos para a região-base do vereador com a parcela dos votos que vem de lá. ${C.votacoes ? `Presença e "contra maioria" vêm de ${fmt(C.votacoes.n_votacoes)} votações nominais (PDFs da Câmara; ${fmt(C.votacoes.unanimes)} unânimes). Presença = votou ou presidiu; ausência justificada conta como ausência.` : ""} As listas de presença em sessão são imagens escaneadas e não foram usadas.</p>`;
}

function investimentos(app: App) {
  const { db } = app;
  const I = db.mandatos.investimentos;
  if (!I) return `<p class="muted">Dados do TCE-PE ainda não coletados.</p>`;
  const sc = scaler(Object.values(I.regioes).map((r) => r.por_eleitor), 1);
  const st = new Map<string, PlaceStyle>();
  for (const p of db.locais) { const r = I.regioes[p.regiao]; if (r) st.set(p.id, { color: seq(0.1 + 0.9 * sc.f(r.por_eleitor)), opacity: 0.7 }); }
  app.map.setPlaces(st, (id) => { const p = db.byId.get(id)!; const r = I.regioes[p.regiao]; return `<b>${esc(p.regiao)}</b><br>Gasto localizado: ${brl(r?.total ?? 0)}<br>Por eleitor: ${brl(r?.por_eleitor ?? 0)}<br>Investimento (capital): ${brl(r?.investimento ?? 0)}`; });
  app.legend(legendRamp(SEQ_STOPS, brl(sc.lo), brl(sc.hi), "Gasto da prefeitura com bairro identificado, por eleitor da região"));
  const regs = Object.entries(I.regioes).sort((a, b) => b[1].por_eleitor - a[1].por_eleitor);
  return `<p class="lead">Empenhos da prefeitura (TCE-PE, ${I.anos[0]}–${I.anos[I.anos.length - 1]}): ${brl(I.total_empenhado)} em ${fmt(I.n_empenhos)} empenhos. Só <b>${pct(I.localizado / I.total_empenhado)}</b> (${brl(I.localizado)}) citam um bairro na descrição — trate como amostra, não como orçamento por bairro.</p>
    <h3>Por região</h3>
    <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Região</th><th class="num">Localizado</th><th class="num">Capital</th><th class="num">Por eleitor</th></tr></thead><tbody>
      ${regs.map(([k, r]) => `<tr class="clickable" data-href="tab=regioes&region=${encodeURIComponent(k)}"><td>${esc(k)}</td><td class="num">${brl(r.total)}</td><td class="num">${brl(r.investimento)}</td><td class="num">${brl(r.por_eleitor)}</td></tr>`).join("")}
    </tbody></table></div>
    <h3>Bairros com mais gasto citado</h3>${bars(I.top_bairros.slice(0, 12).map((b) => ({ label: b.bairro, sub: b.regiao, value: b.valor })), { format: (x) => brl(x) })}
    <h3>Por função</h3>${bars(Object.entries(I.por_funcao).map(([k, x]) => ({ label: k, value: x })), { format: (x) => brl(x) })}
    <h3>Maiores investimentos localizados</h3>
    <ul class="plain">${I.maiores_investimentos.slice(0, 12).map((e) => `<li><b>${brl(e.valor)}</b> · ${esc(e.bairro)} (${esc(e.regiao)}) · <span class="muted small">${esc(e.data)} · ${esc(e.fornecedor)}</span><br><span class="small">${esc(e.historico)}</span></li>`).join("")}</ul>`;
}

function emendas(app: App) {
  const E = app.db.mandatos.emendas;
  if (!E) return `<p class="muted">Dados de emendas ainda não coletados.</p>`;
  const v = (a: Record<string, number>) => Object.entries(a).map(([k, x]) => `${k.replace("dep_federal_", "dep. federal ").replace("senador_", "senador ")}: ${fmt(x)}`).join(" · ");
  return `<p class="lead">Recursos de emendas parlamentares federais recebidos por entidades sediadas em Petrolina (prefeitura, fundos, universidades, hospitais, empresas): <b>${brl(E.total_recebido)}</b> (Portal da Transparência). Pagamentos a empresas da cidade podem se referir a obras em outros municípios.</p>
    <h3>Por ano</h3>${bars(Object.entries(E.por_ano).map(([a, x]) => ({ label: a, value: x })), { format: (x) => brl(x) })}
    <h3>Por tipo de emenda</h3>${bars(Object.entries(E.por_tipo).map(([k, x]) => ({ label: k, value: x })), { format: (x) => brl(x) })}
    <h3>Autores e votos em Petrolina</h3>
    <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Autor</th><th class="num">Recebido</th><th>Votos em Petrolina (2022/2026)</th></tr></thead><tbody>
      ${E.autores.map((a) => `<tr><td>${esc(a.autor)}</td><td class="num">${brl(a.valor)}</td><td class="small">${v(a.votos_petrolina) || "–"}</td></tr>`).join("")}
    </tbody></table></div>
    <h3>Maiores favorecidos</h3>${bars(E.favorecidos.map((f) => ({ label: f.nome, value: f.valor })), { format: (x) => brl(x) })}
    ${E.transferencias_especiais.length ? `<h3>Transferências especiais ("emendas Pix", Transferegov)</h3><ul class="plain">${E.transferencias_especiais.map((t) => `<li>${esc(t.ano_plano_acao)} · ${esc(t.nome_parlamentar_emenda_plano_acao)} · ${brl(Number(t.valor_investimento_plano_acao) + Number(t.valor_custeio_plano_acao))}</li>`).join("")}</ul>` : ""}`;
}

function obras(app: App) {
  const O = app.db.mandatos.obras;
  const pts = O.filter((o) => o.lat != null);
  app.map.setPois(pts.map((o) => ({ lat: o.lat!, lon: o.lon!, color: o.situacao === "Concluída" ? "#1baf7a" : o.situacao === "Paralisada" ? "#c0392b" : "#eda100", name: `<b>${esc(o.nome)}</b><br>${esc(o.situacao)}` })));
  app.legend(legendCats([{ label: "Concluída", color: "#1baf7a" }, { label: "Em execução / outra", color: "#eda100" }, { label: "Paralisada", color: "#c0392b" }], "Obras federais (Obrasgov)"));
  const bySit: Record<string, number> = {};
  O.forEach((o) => (bySit[o.situacao ?? "–"] = (bySit[o.situacao ?? "–"] ?? 0) + 1));
  return `<p class="lead">${O.length} obras com recursos federais em Petrolina no Obrasgov (${pts.length} com coordenadas no mapa).</p>
    ${bars(Object.entries(bySit).map(([k, x]) => ({ label: k, value: x })), { format: (x) => fmt(x) })}
    <ul class="plain">${O.slice(0, 60).map((o) => `<li><b>${esc(o.nome)}</b><br><span class="muted small">${esc(o.situacao)} · ${esc(o.especie)} · ${esc(o.inicio ?? "")} → ${esc(o.fim ?? "")}</span></li>`).join("")}</ul>`;
}
