import type { App, State } from "../app";
import { esc } from "../data";
import { cat } from "../colors";

const CATS: [string, string][] = [["vereadores", "Vereadores"], ["geografia", "Geografia do voto"], ["regioes", "Regiões"], ["2026", "Sinal de 2026"], ["financas", "Finanças"]];

export function renderInsights(app: App) {
  const { db } = app;
  app.map.setPoly("regioes", new Map(), () => "");
  app.map.setPlaces(new Map(), (id) => esc(db.byId.get(id)!.nome));
  app.map.setOverlay([]);
  app.legend("");
  app.panel.innerHTML = `<div class="ph"><div class="eyebrow">Síntese</div><h2>Principais achados para 2028</h2></div>
    <p class="lead">Gerados automaticamente a partir dos dados (TSE 2020/2024/2026 + Censo 2022), ordenados por relevância. Cada card abre a visão correspondente.</p>
    ${CATS.map(([c, label], ci) => {
      const items = db.insights.filter((i) => i.categoria === c);
      return items.length ? `<h3><span class="sw" style="background:${cat(ci)}"></span>${label}</h3>${items.map((i) => `
        <article class="card" data-i="${i.id}" tabindex="0"><h4>${esc(i.titulo)}</h4><p>${esc(i.texto)}</p><span class="link">Ver →</span></article>`).join("")}` : "";
    }).join("")}`;
  app.panel.querySelectorAll<HTMLElement>(".card").forEach((el) => {
    const open = () => {
      const ins = db.insights.find((x) => x.id === +el.dataset.i!)!;
      const v = ins.view as Record<string, string>;
      const patch: Partial<State> = { tab: (v.tab === "mapa" ? "mapa" : v.tab) as State["tab"], cand: undefined, region: undefined, place: undefined };
      if (v.filtro) patch.filtro = v.filtro;
      if (v.ordenar) patch.ordenar = v.ordenar;
      if (v.metrica) { if (v.tab === "regioes") patch.rmetric = v.metrica; else patch.metric = v.metrica; }
      if (v.modo) patch.gmodo = v.modo;
      if (v.smodo) patch.smodo = v.smodo;
      if (v.mmodo) patch.mmodo = v.mmodo;
      if (v.cargo) patch.cargo = v.cargo;
      if (v.eleicao) patch.year = String(v.eleicao);
      if (v.camada) { patch.layer = v.camada as State["layer"]; patch.smetric = v.metrica; patch.metric = "vencedor"; }
      app.go(patch);
    };
    el.addEventListener("click", open);
    el.addEventListener("keydown", (e) => (e as KeyboardEvent).key === "Enter" && open());
  });
}
