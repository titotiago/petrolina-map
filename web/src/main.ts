import "./style.css";
import { parseHash, toHash, type App, type State, type Tab } from "./app";
import { aggDet, aggVotes, esc, fmt, load, pct, valid } from "./data";
import { ElectionMap } from "./map";
import { renderVereadores } from "./ui/vereadores";
import { renderRegioes } from "./ui/regioes";
import { renderInsights } from "./ui/insights";
import { renderCadeiras } from "./ui/cadeiras";
import { renderSobreposicao } from "./ui/sobreposicao";
import { renderExplorar } from "./ui/explorar";
import { renderGeografia } from "./ui/geografia";
import { renderPlanejador } from "./ui/planejador";
import { renderComparar } from "./ui/comparar";
import { renderTransferencias } from "./ui/transferencias";
import { renderMandatos } from "./ui/mandatos";
import { areaReport, renderPlace } from "./ui/place";
import { bindHrefs } from "./ui/common";

// lucide-style 24px stroke icons
const I = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON: Record<string, string> = {
  vereadores: I('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>'),
  sobreposicao: I('<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>'),
  geografia: I('<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>'),
  regioes: I('<path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>'),
  insights: I('<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>'),
  cadeiras: I('<rect x="3" y="12" width="4" height="9" rx="1"/><rect x="10" y="7" width="4" height="14" rx="1"/><rect x="17" y="3" width="4" height="18" rx="1"/>'),
  mapa: I('<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>'),
  sobre: I('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  planejador: I('<path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4"/><circle cx="12" cy="12" r="4"/>'),
  mandatos: I('<path d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6"/>'),
  transferencias: I('<path d="M4 7h11l-3-3M20 17H9l3 3"/>'),
  comparar: I('<path d="M8 3v18M16 3v18M3 8h5M16 16h5"/><rect x="3" y="3" width="18" height="18" rx="2"/>'),
};
const NAV: [string, [Tab, string, string][]][] = [
  ["Câmara 2028", [["vereadores", "Vereadores", "Os 23 eleitos, suplentes e nomes a observar"], ["sobreposicao", "Sobreposição", "Quem disputa o mesmo eleitorado"], ["comparar", "Comparar candidatos", "Até 3 candidatos lado a lado"], ["cadeiras", "Cadeiras 2024", "Quociente, sobras e simulação partidária"], ["mandatos", "Mandatos e recursos", "Produção da Câmara, gasto da prefeitura, emendas e obras"]]],
  ["Estratégia 2028", [["planejador", "Planejador 2028", "Simulador de chapas e plano de votos por local"]]],
  ["Território", [["geografia", "Geografia do voto", "Domínio, conflito, redutos e perfis de território"], ["regioes", "Regiões", "Representação, desempenho e perfil por região"], ["mapa", "Explorar mapa", "Qualquer eleição, cargo e métrica"]]],
  ["Síntese", [["insights", "Achados", "Principais conclusões para 2028"], ["transferencias", "Transferência de votos", "Para onde foi o voto entre eleições (estimativa)"], ["sobre", "Fontes & método", "Dados, definições e limitações"]]],
];
const TAB_INFO = new Map(NAV.flatMap(([, items]) => items.map(([k, l, d]) => [k, { label: l, desc: d }] as const)));

// theme: stored per viewer (convenience only)
try { const t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; } catch { /* storage unavailable */ }

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div class="shell">
    <aside class="side">
      <div class="brand"><div class="brand-mark">PE</div><div><div class="brand-name">Petrolina 2028</div><div class="brand-sub">Inteligência eleitoral</div></div></div>
      <nav id="tabs" role="tablist">${NAV.map(([g, items]) => `<div class="nav-group">${g}</div>${items.map(([k, l]) => `<button class="nav-item" role="tab" data-tab="${k}">${ICON[k]}<span>${l}</span></button>`).join("")}`).join("")}</nav>
      <div class="side-foot"><span id="gen"></span><button id="theme" class="icon-btn" title="Alternar tema claro/escuro" aria-label="Alternar tema">◐ Tema</button></div>
    </aside>
    <div class="main">
      <header class="topbar"><div class="topbar-title"><h1 id="ttl">Carregando…</h1><p id="tsub"></p></div>
        <div class="search"><input id="q" list="qlist" placeholder="Buscar candidato, local, bairro ou região…" aria-label="Busca"><datalist id="qlist"></datalist></div>
        <div class="kpis" id="kpis"></div></header>
      <main class="layout">
        <section class="mapbox"><div id="map"></div>
          <div class="map-ctrl"><div class="seg small" id="vis"><button data-v="areas">Áreas de influência</button><button data-v="pontos">Pontos</button></div>
            <button class="btn small" id="fit-city">Cidade</button><button class="btn small" id="fit-all">Município</button>
            <button class="btn small primary" id="locate" title="Mostrar o local de votação mais próximo de onde você está">◎ Onde estou</button></div>
          <div id="legend" class="legend"></div></section>
        <aside id="panel" class="panel"><p class="muted">Carregando dados…</p></aside>
      </main>
    </div>
  </div>`;

const panel = document.querySelector<HTMLElement>("#panel")!;
const legendEl = document.querySelector<HTMLElement>("#legend")!;

let userPos: { lat: number; lon: number } | null = null;

// offline / installable app (production builds only)
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}

load().then((db) => {
  const map = new ElectionMap(document.querySelector<HTMLElement>("#map")!, db);
  const ids = db.locais.map((p) => p.id);
  const d24 = aggDet(db, "2024", "prefeito", ids);
  const m24 = aggVotes(db, "2024", "prefeito", ids);
  document.querySelector("#kpis")!.innerHTML = [
    ["Eleitores 2024", fmt(d24.aptos)], ["Comparecimento", pct(d24.comp / d24.aptos)], ["Simão (2024)", pct((m24["44"] ?? 0) / valid(m24))],
    ["Quociente", fmt(db.cadeiras.qe)], ["Locais", String(ids.length)],
  ].map(([l, v]) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`).join("");
  // global search
  const qopts: [string, Partial<State>][] = [
    ...db.vereadores.filter((v) => v.votos >= 100).map((v) => [`Vereador · ${v.nome} (${v.partido} ${v.numero})`, { tab: "vereadores", cand: v.numero }] as [string, Partial<State>]),
    ...db.locais.map((p) => [`Local · ${p.nome} — ${p.bairro_tse}`, { place: p.id }] as [string, Partial<State>]),
    ...Object.keys(db.regioes).map((r) => [`Região · ${r}`, { tab: "regioes", region: r }] as [string, Partial<State>]),
    ...db.geo.bairros.features.map((f) => String((f.properties as Record<string, unknown>).NM_BAIRRO)).map((b) => [`Bairro · ${b}`, { tab: "regioes", region: `__bairro:${b}` }] as [string, Partial<State>]),
  ];
  const qmap = new Map(qopts);
  document.querySelector("#qlist")!.innerHTML = qopts.map(([l]) => `<option value="${esc(l)}">`).join("");
  const q = document.querySelector<HTMLInputElement>("#q")!;
  q.addEventListener("change", () => {
    const hit = qmap.get(q.value);
    if (!hit) return;
    if (hit.region?.startsWith("__bairro:")) app.lassoIds = db.locais.filter((p) => p.bairro_ibge === hit.region!.slice(9)).map((p) => p.id);
    app.go({ cand: undefined, region: undefined, place: undefined, ...hit });
    q.value = "";
    q.blur();
  });
  document.querySelector("#gen")!.textContent = `Dados de ${db.info.gerado_em.split("-").reverse().join("/")}`;
  const app: App = {
    db, map, panel, state: parseHash(), lassoIds: null,
    legend: (html) => { legendEl.innerHTML = html; legendEl.hidden = !html; },
    go(patch, replace) {
      const next = { ...this.state, ...patch } as State;
      for (const k of Object.keys(patch) as (keyof State)[]) if (patch[k] === "" ) delete next[k];
      if (patch.tab && patch.tab !== this.state.tab) {
        if (!("cand" in patch)) delete next.cand;
        if (!("region" in patch)) delete next.region;
        if (!("place" in patch)) delete next.place;
      }
      const h = toHash(next);
      if (replace) history.replaceState(null, "", h); else if (h !== location.hash) history.pushState(null, "", h);
      this.state = next;
      render();
    },
  };
  map.onPlaceClick((id) => app.go({ place: id }));
  map.onPolyClick((kind, key) => {
    if (kind === "regioes") app.go({ tab: "regioes", region: key, place: undefined });
    if (kind === "bairros") {
      app.lassoIds = db.locais.filter((p) => p.bairro_ibge === key).map((p) => p.id);
      app.go({ tab: "regioes", region: `__bairro:${key}`, place: undefined });
    }
  });
  window.addEventListener("popstate", () => { app.state = parseHash(); render(); });
  document.querySelector("#vis")!.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-v]");
    if (b) app.go({ vis: b.dataset.v as "areas" | "pontos" });
  });
  document.querySelector("#fit-city")!.addEventListener("click", () => map.fitCity());
  document.querySelector("#fit-all")!.addEventListener("click", () => map.fitAll());
  document.querySelector("#locate")!.addEventListener("click", () => {
    if (!navigator.geolocation) return alertPanel("Seu navegador não permite localização.");
    const btn = document.querySelector<HTMLButtonElement>("#locate")!;
    btn.textContent = "Localizando…";
    navigator.geolocation.getCurrentPosition((pos) => {
      btn.textContent = "◎ Onde estou";
      userPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      const near = nearestPlaces(userPos, 1)[0];
      if (near.km > 60) return alertPanel("Você parece estar fora de Petrolina — a localização só é útil dentro do município.");
      app.go({ place: near.p.id });
    }, () => { btn.textContent = "◎ Onde estou"; alertPanel("Não foi possível obter sua localização (permissão negada ou sinal fraco)."); }, { enableHighAccuracy: true, timeout: 15000 });
  });
  function alertPanel(msg: string) { panel.insertAdjacentHTML("afterbegin", `<div class="callout alert">${esc(msg)}</div>`); }
  function nearestPlaces(pos: { lat: number; lon: number }, n: number) {
    const kmTo = (p: { lat: number; lon: number }) => { const dLat = ((p.lat - pos.lat) * Math.PI) / 180, dLon = ((p.lon - pos.lon) * Math.PI) / 180;
      const h = Math.sin(dLat / 2) ** 2 + Math.cos((pos.lat * Math.PI) / 180) * Math.cos((p.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
    return db.locais.map((p) => ({ p, km: kmTo(p) })).sort((a, b) => a.km - b.km).slice(0, n);
  }
  document.querySelector("#tabs")!.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]");
    if (t) app.go({ tab: t.dataset.tab as Tab, cand: undefined, region: undefined, place: undefined, pair: undefined });
  });
  document.querySelector("#theme")!.addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("theme", document.documentElement.dataset.theme); } catch { /* ignore */ }
    location.reload();
  });

  function render() {
    const s = app.state;
    document.querySelectorAll<HTMLElement>("#tabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === s.tab)));
    map.vis = s.vis ?? (s.tab === "mapa" && s.layer === "setores" ? "pontos" : "areas");
    map.setPois([]);
    map.setRoute([]);
    document.querySelectorAll<HTMLElement>("#vis [data-v]").forEach((b) => b.classList.toggle("on", b.dataset.v === map.vis));
    const info = TAB_INFO.get(s.tab);
    document.querySelector("#ttl")!.textContent = info?.label ?? "";
    document.querySelector("#tsub")!.textContent = info?.desc ?? "";
    panel.scrollTop = 0;
    if (s.tab === "regioes" && s.region?.startsWith("__bairro:")) {
      const name = s.region.slice(9);
      const ids = db.locais.filter((p) => p.bairro_ibge === name).map((p) => p.id);
      map.setPoly("bairros", new Map([[name, "#2a78d6"]]), (k) => esc(k), name, 0.15);
      map.fitPlaces(ids, 14);
      panel.innerHTML = `<div class="drawer-head"><button class="back" data-href="region=">← voltar</button></div><h2>Bairro ${esc(name)}</h2>
        ${ids.length ? areaReport(app, ids) : "<p>Nenhum local de votação dentro deste bairro (os eleitores votam em bairros vizinhos).</p>"}`;
      bindHrefs(panel, (h) => app.go(Object.fromEntries(new URLSearchParams(h))));
    } else {
      ({ vereadores: renderVereadores, regioes: renderRegioes, insights: renderInsights, cadeiras: renderCadeiras, sobreposicao: renderSobreposicao,
        mapa: renderExplorar, candidatos: renderVereadores, sobre: renderSobre, geografia: renderGeografia, planejador: renderPlanejador, comparar: renderComparar, transferencias: renderTransferencias, mandatos: renderMandatos })[s.tab](app);
    }
    if (s.place && db.byId.has(s.place)) {
      panel.innerHTML = renderPlace(app, s.place);
      if (userPos) {
        const near = nearestPlaces(userPos, 4);
        const here = near.find((x) => x.p.id === s.place);
        panel.insertAdjacentHTML("afterbegin", `<div class="callout"><b>◎ Você está ${here ? `a ${here.km.toFixed(1).replace(".", ",")} km deste local` : "perto de"}</b>
          <div class="small">Outros locais próximos: ${near.filter((x) => x.p.id !== s.place).slice(0, 3).map((x) => `<a data-href="place=${x.p.id}">${esc(x.p.nome)}</a> (${x.km.toFixed(1).replace(".", ",")} km)`).join(" · ")}</div></div>`);
        map.setOverlay([{ center: [userPos.lat, userPos.lon], km: 0.08, color: "#2a78d6" }]);
      }
      bindHrefs(panel, (h) => app.go(Object.fromEntries(new URLSearchParams(h))));
      const p = db.byId.get(s.place)!;
      map.map.easeTo({ center: [p.lon, p.lat], zoom: Math.max(map.map.getZoom(), 12.5), duration: 500 });
    }
  }
  render();
  map.whenReady().then(() => { if (!app.state.place && !app.state.region && !app.state.cand) map.fitCity(); });
}).catch((e) => {
  panel.innerHTML = `<p class="warn">Falha ao carregar os dados: ${esc(e)}. Rode <code>python3 -I pipeline/build.py</code>.</p>`;
});

function renderSobre(app: App) {
  const { db } = app;
  app.map.setPoly("regioes", new Map(), () => "");
  app.map.setPlaces(new Map(), (id) => esc(db.byId.get(id)!.nome));
  app.legend("");
  const approx = db.locais.filter((p) => p.geo_src !== "tse");
  app.panel.innerHTML = `<div class="ph"><div class="eyebrow">Transparência</div><h2>Fontes e metodologia</h2></div>
    <p>Dados gerados em ${esc(db.info.gerado_em)}.</p>
    <ul>${db.info.fontes.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
    <h3>Notas</h3><ul>${db.info.notas.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
    <h3>Definições</h3><ul>
      <li><b>Região-base</b> de um vereador: região onde obteve a maior parte dos votos.</li>
      <li><b>Locais efetivos</b> = 1/HHI da distribuição dos votos pelos locais. <b>Concentrado</b>: ≥55% dos votos em 10 locais; <b>regional</b>: ≥40% numa região; senão <b>espalhado</b>.</li>
      <li><b>Força relativa</b> (×): participação no local ÷ participação média na cidade.</li>
      <li><b>Sobreposição</b> entre dois candidatos: Σ min(pᵢ, qᵢ) das distribuições territoriais dos votos (por local ou por seção).</li>
      <li><b>Perfil do eleitor</b>: como os eleitores do candidato diferem dos eleitores das mesmas escolas (idade, escolaridade, gênero), estimado cruzando o voto e o perfil de cada seção. Normalizado por teste de permutação dentro de cada escola; <b>nitidez</b> ≈1 = indistinguível do acaso. A semelhança entre dois candidatos é o cosseno desses perfis, reduzido quando algum é pouco nítido. Inferência ecológica: o voto é secreto.</li>
      <li><b>Afinidade 2026</b>: correlação entre as participações por local do vereador (2024) e do candidato de 2026.</li>
      <li><b>Novos eleitores 2028</b>: Censo 2022, pessoas com 10–14 anos + 40% das de 15–19 (estimativa grosseira).</li>
      <li>Campos (cores): partido → coligação do candidato a prefeito em 2024 (TSE consulta_coligacao).</li>
    </ul>
    ${approx.length ? `<h3>Locais com coordenada aproximada</h3><ul>${approx.map((p) => `<li>${esc(p.nome)} — ${esc(p.geo_src)}</li>`).join("")}</ul>` : ""}
    <p class="muted small">Renda por setor censitário ainda não está publicada pelo IBGE nos agregados de 2022 usados aqui.</p>`;
}
