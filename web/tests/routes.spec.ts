import { expect, test } from "@playwright/test";

// Every view (and the main interactive modes) must render without console errors or a failed panel.
const ROUTES = [
  "tab=vereadores", "tab=vereadores&filtro=todos", "tab=vereadores&cand=13123", "tab=vereadores&cand=44333&vmode=lisa",
  "tab=vereadores&cand=13123&vmode=delta2020", "tab=sobreposicao", "tab=sobreposicao&sview=matriz&pair=44333,12123",
  "tab=sobreposicao&smodo=perfil", "tab=sobreposicao&smodo=disputa&pair=12123,44010", "tab=comparar", "tab=cadeiras",
  "tab=planejador", "tab=planejador&pmodo=cenarios", "tab=planejador&pmodo=plano", "tab=planejador&pmodo=plano&alvo=13123&metodo=modelo",
  "tab=geografia", "tab=geografia&gmodo=conflito", "tab=geografia&gmodo=lisa", "tab=geografia&gmodo=segmentos&seg=1",
  "tab=geografia&gmodo=registro", "tab=geografia&gmodo=polarizacao", "tab=geografia&gmodo=polarizacao&seg=var",
  "tab=geografia&gmodo=censo", "tab=geografia&gmodo=equipamentos", "tab=regioes", "tab=regioes&region=Centro",
  "tab=regioes&region=__bairro:Centro", "tab=mapa", "tab=mapa&year=2016&cargo=prefeito", "tab=mapa&year=2022-2&cargo=presidente",
  "tab=mapa&year=2026&cargo=presidente&metric=delta_numero&num=13", "tab=mapa&layer=setores&smetric=renda_media",
  "tab=insights", "tab=transferencias", "tab=transferencias&fluxo=lula_prefeito", "tab=sobre", "place=83-1627",
];

test("all views render without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/tile|Failed to load resource|demotiles|arcgis/i.test(m.text())) errors.push(m.text()); });
  await page.goto("/#tab=vereadores");
  await expect(page.locator("#panel h2").first()).toBeVisible({ timeout: 30_000 });
  for (const r of ROUTES) {
    await page.evaluate((h) => (location.hash = h), r);
    await page.waitForTimeout(250);
    const text = await page.locator("#panel").innerText();
    expect(text, r).not.toMatch(/Falha ao carregar|undefined|NaN/);
  }
  expect(errors).toEqual([]);
});

test("slate simulator moves a candidate", async ({ page }) => {
  await page.goto("/#tab=planejador");
  const sel = page.locator("tr", { hasText: "WENDERSON" }).locator("select");
  await sel.selectOption("PP");
  await expect(page.locator(".tile", { hasText: "Entram" })).toContainText("WENDERSON");
});

test("monte carlo and routes run", async ({ page }) => {
  await page.goto("/#tab=planejador&pmodo=cenarios");
  await page.locator("#nsims").fill("400");
  await page.locator("#nsims").dispatchEvent("change");
  await page.locator("#runmc").click();
  await expect(page.locator("#panel")).toContainText("Chance de se eleger", { timeout: 60_000 });
  await page.goto("/#tab=planejador&pmodo=plano");
  await page.locator("#rgo").click();
  await expect(page.locator("#panel")).toContainText("Dia 1");
});

test("global search navigates", async ({ page }) => {
  await page.goto("/#tab=vereadores");
  await page.locator("#q").fill("Região · Centro");
  await page.locator("#q").dispatchEvent("change");
  await expect(page).toHaveURL(/region=Centro/);
});

test("where am I shows the nearest polling place", async ({ browser }) => {
  const ctx = await browser.newContext({ geolocation: { latitude: -9.3891, longitude: -40.5030 }, permissions: ["geolocation"], viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto("/#tab=vereadores");
  await expect(page.locator("#panel h2").first()).toBeVisible({ timeout: 30_000 });
  await page.locator("#locate").click();
  await expect(page.locator("#panel")).toContainText("Você está", { timeout: 15_000 });
  await expect(page).toHaveURL(/place=/);
  await ctx.close();
});
