# Roadmap — Petrolina 2028

Plano de implementação de todas as melhorias recomendadas para o mapa eleitoral (https://titotiago.github.io/petrolina-map/). São 18 features, organizadas em 5 fases. A ordem segue dependências técnicas e valor: primeiro os dados, depois a infraestrutura de qualidade e por fim os módulos que dependem de backend.

> **Princípios mantidos em todas as fases**
> - Toda análise nova é **adicional**: as visões existentes continuam funcionando como hoje.
> - O pipeline Python continua sendo a única fonte de dados do site, e o site continua 100% estático e público.
> - Os dados privados da equipe (lideranças, anotações) **nunca** vão para o repositório nem para o site público (ver Fase 5).
> - Cada fase termina com: totais conferidos contra o TSE, todas as rotas testadas, build ok, deploy e o `INSIGHTS.md` atualizado.

---

## Visão geral

| # | Feature | Fase | Valor | Esforço | Depende de |
|---|---|---|---|---|---|
| 1 | Testes de dados e de interface no CI | 1 | Alto | Baixo | — |
| 2 | Atualização automática (TSE → site) | 1 | Alto | Baixo | 1 |
| 3 | Eleição 2022 (presidente, governador, senador, deputados) | 2 | Muito alto | Baixo | 1 |
| 4 | Presidente 2026 + 2º turno 2026 | 2 | Alto | Baixo | 1, 2 |
| 5 | Eleição 2016 (prefeito e vereador) | 2 | Médio | Baixo | 1 |
| 6 | Linha do tempo 2016 → 2026 | 2 | Alto | Médio | 3, 4, 5 |
| 7 | Desempenho esperado × real por local | 3 | Muito alto | Médio | 3 |
| 8 | Transferência de votos (inferência ecológica) | 3 | Alto | Médio | 3, 5 |
| 9 | Cenários 2028 por swing | 3 | Alto | Médio | 3, 4 |
| 10 | Simulação de Monte Carlo das cadeiras | 3 | Alto | Médio | 9 |
| 11 | Renda por setor censitário (IBGE) | 3 | Médio | Baixo | publicação do IBGE |
| 12 | Equipamentos públicos (OpenStreetMap) | 3 | Médio | Médio | — |
| 13 | Investimentos da prefeitura por bairro | 4 | Alto | Alto | coleta externa |
| 14 | Atuação parlamentar dos vereadores | 4 | Alto | Alto | coleta externa |
| 15 | Dossiê em PDF (vereador, região, duelo) | 4 | Alto | Médio | 7 |
| 16 | Rotas de campo otimizadas | 4 | Médio | Médio | 7 |
| 17 | App de campo (PWA, offline, "onde estou") | 5 | Alto | Médio | 16 |
| 18 | Área da equipe: login, anotações, lideranças (CRM) | 5 | Muito alto | Alto | decisão de backend |

**Estimativa total:** cerca de 8 a 11 semanas de trabalho, contando as fases 1 a 3 (cerca de 4 semanas) e a coleta e validação das fontes externas da fase 4. O maior risco de prazo está nos itens 13 e 14, que dependem de fontes municipais.

---

## Fase 1 — Fundação: qualidade e automação

### 1. Testes de dados e de interface no CI
**Objetivo:** impedir regressões como o erro da aba Geografia (dado ausente quebrando a interface) e garantir que os números batem com o TSE.

**Testes de dados** (`pipeline/tests/`, pytest):
- Os totais por cargo e ano são iguais à soma bruta do TSE (o `build.py` já confere isso; vira um teste).
- O resultado de prefeito de 2024 confere com o oficial: Simão 59,16%, Júlio 28,66%, Lara 5,90%, Odacy 5,69%.
- A alocação reconstruída das 23 cadeiras é igual à oficial, incluindo a divisão entre QP e média.
- Todo local tem coordenada, região e área de influência.
- Os esquemas JSON de `web/public/data/*.json` são validados com JSON Schema, e o TypeScript lê os mesmos tipos.

**Testes de interface** (Playwright, `web/tests/`):
- Percorrer todas as rotas (as 27 atuais, mais as novas): sem erro de console, painel sem "Falha", mapa carregado.
- Fluxos críticos: abrir o perfil de um vereador, o duelo, o laço (lasso), o simulador de chapas (mover um candidato e conferir a mudança) e a busca global.
- Capturas de tela de referência nos temas claro e escuro, para detectar mudança visual.

**CI:** o workflow de Pages passa a rodar `pytest` + `tsc` + Playwright antes do deploy. Se algum teste falha, não há publicação.

**Pronto quando:** um PR que quebra um JSON ou uma rota é barrado no CI.

### 2. Atualização automática (TSE → site)
**Objetivo:** o site se atualiza sozinho quando o TSE publica dados novos (2º turno de 2026, prestação de contas, retotalizações, e depois 2028).

**Como:**
- GitHub Action agendado (semanal, mais disparo manual): roda `download.py` com cache por `Last-Modified` e `ETag`. Se algum arquivo mudou, roda `extract.py` e `build.py` e depois os testes da feature 1.
- Se tudo passa, abre um **pull request automático** com um diff resumido ("+X votos no 2º turno", "QE inalterado", "3 achados novos"). Um humano aprova o merge, e o deploy segue.
- Os dados brutos do TSE (cerca de 3 GB) ficam fora do repositório, em cache do Actions ou num release com artefato. Só os JSON finais são versionados.
- O `meta.json` registra a data e a versão de cada fonte; o site mostra "Dados do TSE atualizados em…".

**Riscos:** limite de disco e tempo do runner (o download de 1,3 GB da prestação de contas). Mitigação: baixar só os membros PE, via HTTP range, ou rodar a prestação de contas mensalmente.

---

## Fase 2 — Mais eleições no mapa

> Fontes confirmadas no CDN do TSE: `votacao_secao_2022_PE.zip` (122 MB), `votacao_secao_2022_BR.zip` (271 MB), `votacao_secao_2026_BR.zip` (162 MB, presidente 2026), `votacao_secao_2016_PE.zip` (62 MB), `detalhe_votacao_secao_2022.zip`, `eleitorado_local_votacao_2022.zip`, `consulta_cand_2016.zip`.

### 3. Eleição 2022
**Objetivo:** a camada ideológica (Lula × Bolsonaro, governador, senador e deputados) para entender o "tipo" de território de cada vereador num 2028 polarizado.

**Pipeline:**
- Adicionar 2022 em `download.py` e `extract.py`. Para presidente, filtrar Petrolina no arquivo nacional.
- Associar os locais de 2022 aos de 2024 com o `map_to_base`, que já existe.
- Gerar `resultados.json` com o ano 2022 (presidente nos 1º e 2º turnos, governador, senador, deputado federal e estadual).
- **Índice de alinhamento ideológico por local:** % Lula − % Bolsonaro no 2º turno de 2022.
- Por vereador, a **correlação com esse alinhamento** (análoga ao "efeito Simão"), que mostra se a base dele é mais lulista ou bolsonarista.
- **Deputados 2022 × vereadores 2024:** afinidade territorial entre eles (a mesma métrica usada para 2026), para mapear os puxadores de voto.

**Interface:**
- O explorador ganha 2022 nos seletores de eleição e cargo.
- O perfil do vereador ganha a seção "Alinhamento ideológico da base".
- A Geografia ganha o modo "Polarização 2022".
- Novos achados, ex.: "vereadores governistas com base bolsonarista".

**Pronto quando:** os totais de 2022 em Petrolina conferem com o TSE e o 2º turno presidencial aparece por local.

### 4. Presidente 2026 + 2º turno 2026
**Objetivo:** completar 2026, que hoje não tem presidente nem 2º turno.
- Presidente do 1º turno: arquivo nacional, filtrado por Petrolina.
- 2º turno (presidente e, se houver, governador): entra pela automação da feature 2 quando o TSE publicar. O pipeline já filtra por `NR_TURNO`; falta um seletor de turno na interface.
- Achados: "para onde foi o voto de 2022 → 2026" por local e "comparecimento no 2º turno".

### 5. Eleição 2016
**Objetivo:** trajetória longa (três eleições municipais) e ciclos de renovação da Câmara.
- Prefeito e vereador de 2016, com locais associados aos de 2024, e candidatos ligados pelo título eleitoral (como já é feito para 2020).
- No perfil do vereador: votos em 2016, 2020 e 2024, e a tendência.
- Achados: "taxa de reeleição 2016→2020→2024", "vereadores com três mandatos" e "partidos que mais perderam cadeiras em oito anos".

### 6. Linha do tempo 2016 → 2026
**Objetivo:** ver a evolução no mesmo mapa.
- Um controle deslizante de ano no topo do mapa (2016, 2020, 2022, 2024, 2026), mantendo cargo e métrica quando fizer sentido.
- Modo "animar" e modo "variação entre dois anos" (escolhe-se A e B; o mapa mostra a diferença).
- Por candidato: um gráfico sparkline de votos ao longo dos anos no perfil e no comparador.

---

## Fase 3 — Análises avançadas

### 7. Desempenho esperado × real por local
**Objetivo:** saber onde cada candidato está acima ou abaixo do que o perfil do local "prevê". É o principal insumo para o plano de votos.

**Método:**
- Para cada candidato relevante, um modelo de regressão (ex.: binomial / GLM com regularização) da participação por seção em função de:
  - perfil do eleitorado (idade, escolaridade, gênero);
  - voto no prefeito (2024) e alinhamento de 2022;
  - comparecimento;
  - variáveis do Censo da área de influência.
- **Validação cruzada por região**, para evitar que o modelo apenas "decore" a geografia.
- **Resíduo** = real − esperado. Positivo é capilaridade pessoal (rede); negativo é potencial não realizado.

**Interface:**
- Nova visão no perfil do vereador, "Potencial × realizado".
- No mapa, o resíduo em escala divergente.
- O plano de votos passa a usar o **teto do modelo** além do teto dos vizinhos. O usuário escolhe o método ou usa uma combinação dos dois.

**Pronto quando:** o modelo tem R² fora da amostra reportado na página Fontes, e o plano de votos mostra a origem de cada meta.

### 8. Transferência de votos (inferência ecológica)
**Objetivo:** estimar números (e não só correlações), por exemplo:
- quanto do eleitor de Miguel em 2020 foi para Simão, Júlio, nulo ou abstenção em 2024;
- para onde foram os votos dos vereadores que saíram;
- 2022 → 2026 no governo do estado.

**Método:** inferência ecológica R×C (modelo multinomial-Dirichlet hierárquico, como `PyEI`) por seção, com intervalos de credibilidade.

**Interface:** diagramas de fluxo (Sankey) na aba Achados e no perfil ("de onde vieram meus votos"), sempre com a faixa de incerteza.

**Riscos:**
- custo computacional (MCMC), por isso roda offline no pipeline com cache;
- interpretação: a página precisa deixar claro que são estimativas.

### 9. Cenários 2028 por swing
**Objetivo:** "e se…" no nível de território.

**Cenários prontos:**
- aplicar a variação 2024→2026 (por região) sobre a base de 2024;
- aplicar a variação 2020→2024;
- crescimento do eleitorado projetado (já calculado).

**Cenários manuais:** controles por região (ex.: "governo −5 p.p. na Zona Leste", "abstenção +3 p.p. entre jovens") e por candidato (crescimento %).

**Saída:** votos projetados por candidato, as 23 cadeiras resultantes (motor de alocação existente) e as mudanças em relação a 2024.

Integra-se ao **Planejador 2028**, na nova aba "Cenários". Os cenários podem ser salvos na URL para compartilhar.

### 10. Simulação de Monte Carlo das cadeiras
**Objetivo:** probabilidades em vez de um único resultado.
- Sobre um cenário (feature 9) ou uma chapa (simulador atual): sortear N = 5.000 eleições com incerteza por candidato e por local, calibrada pela variação histórica entre 2020 e 2024.
- **Saída:**
  - P(eleito) por candidato;
  - distribuição de cadeiras por partido;
  - "margem de segurança";
  - quais candidatos são decisivos para a última vaga.
- Roda no navegador (Web Worker) para manter o site estático e responder em menos de 2 s.

### 11. Renda por setor censitário
**Objetivo:** a camada socioeconômica que falta.
- Monitorar a publicação do IBGE (agregados de rendimento por setor do Censo 2022). A feature 2 verifica a cada execução.
- Quando sair: variável no Censo (setores), média por área de influência, nas assinaturas de vereador e nos perfis de território.
- Plano B, se demorar: proxies de domicílio (saneamento, tipo de domicílio) dos agregados "características do domicílio", que já estão disponíveis.

### 12. Equipamentos públicos (OpenStreetMap)
**Objetivo:** cobertura de serviços versus voto.
- Extrair do OSM (Overpass, com cache no repositório) escolas, UBS e postos de saúde, CRAS, praças e linhas de ônibus.
- Por área de influência: distância média ao serviço e densidade.
- Achados como "áreas sem UBS a menos de 2 km e voto no governo".
- Camada opcional no mapa com ícones.

**Risco:** completude do OSM em Petrolina. Validar por amostragem e permitir complementar com um CSV manual.

---

## Fase 4 — Fontes externas e entregáveis

### 13. Investimentos da prefeitura por bairro
**Objetivo:** cruzar obras e gastos com a variação de voto do grupo governista.

**Descoberta (1ª semana):** mapear as fontes no portal da transparência de Petrolina, no Diário Oficial do município, no TCE-PE (sistema SAGRES / Tome Conta) e no sistema de obras públicas (Obrasgov, para recursos federais).

**Coleta:** um script dedicado (`pipeline/externos/obras.py`) com extração, normalização de bairro e endereço e geocodificação. Os resultados ficam em CSV versionado com a data da coleta.

**Análise:** investimento por região e área (2021–2024 e 2025–2028) × variação do voto do grupo Coelho, controlando pelo perfil.

**Risco:** qualidade e granularidade dos dados públicos. Se o portal não tiver endereço, o resultado fica por região, com aviso.

### 14. Atuação parlamentar dos vereadores
**Objetivo:** a produtividade do mandato como argumento para 2028.

**Descoberta:** portal da Câmara Municipal de Petrolina (projetos, indicações, requerimentos, presenças e votações) e o sistema SAPL, se a Câmara o usar.

**Coleta:** um script com cache e controle de taxa de requisições, respeitando o `robots.txt`.

**Métricas por vereador:**
- proposições por tipo;
- aprovadas;
- presença;
- **geografia das indicações**: quais bairros cada vereador cita, comparados com onde ele tem voto ("trabalha onde é votado?").

**Interface:** seção "Mandato" no perfil e achados (ex.: "vereadores com muitas indicações fora da própria base").

### 15. Dossiê em PDF
**Objetivo:** levar a análise para reuniões, sem depender do site.
- Modelos: **vereador** (perfil, território, perfil do eleitor, rivais, potencial × realizado, plano de votos, finanças), **região** e **duelo**.
- Geração no navegador: uma página de impressão dedicada (CSS `@media print`, A4) mais "Salvar como PDF", com o mapa capturado como imagem. Alternativa: geração em lote no CI (Playwright → PDF) com todos os dossiês prontos para download.
- Rodapé com a fonte e a data dos dados em cada página.

### 16. Rotas de campo otimizadas
**Objetivo:** transformar o plano de votos num roteiro de visitas.
- Entrada: a lista priorizada de locais (plano de votos), o ponto de partida, o número de dias e a duração por visita.
- Otimização: um TSP com janelas e agrupamento por dia (vizinho mais próximo + 2-opt no navegador).
- Distâncias por rua via o serviço público do OSRM; ou, se indisponível, distância em linha reta × fator de correção.
- Saída: o mapa com a rota numerada, a agenda por dia, a exportação para Google Maps (links com paradas) e o PDF da feature 15.

---

## Fase 5 — Operação de campanha

### 17. App de campo (PWA)
**Objetivo:** uso no celular, na rua e sem internet.
- Manifesto e service worker: instala como app; dados e tiles da área urbana guardados em cache para uso offline.
- **"Onde estou":** usa o GPS para mostrar o local de votação mais próximo e o resumo da área: quem é forte, perfil do eleitor, posição no plano de votos e a próxima parada da rota (feature 16).
- Layout de celular dedicado, com navegação inferior e cartões grandes.

### 18. Área da equipe: login, anotações e lideranças (CRM)
**Objetivo:** transformar o mapa em ferramenta de operação, com conhecimento da equipe sobre o território.

**Arquitetura (o site público continua igual):**
- Backend: **Supabase** (Postgres + autenticação + políticas de acesso por linha, RLS), no plano gratuito para começar.
- O site público só carrega o módulo de equipe após o login. Nenhum dado privado vai para o repositório ou para o GitHub Pages.
- Perfis: administrador, coordenador de região e agente de campo, com permissões por região.

**Funcionalidades:**
- **Anotações** por local, bairro, região ou candidato, com menções e histórico.
- **Lideranças:** cadastro com nome, contato, bairro, influência, relação com os candidatos e última visita, exibido como camada no mapa.
- **Registro de visitas** (integrado às rotas e ao PWA, com check-in por GPS).
- Painel de cobertura: quais locais prioritários já receberam visita.

**LGPD e segurança:**
- Dados pessoais de lideranças exigem uma base legal e um aviso de privacidade.
- Criptografia em trânsito, RLS e registros de acesso.
- Exportação e exclusão de dados mediante pedido do titular.
- Rodar uma revisão de segurança antes do lançamento.

**Decisões necessárias (do usuário):** quem administra as contas, se o Supabase é aceitável (ou outra opção, como Firebase ou servidor próprio) e o domínio.

---

## Status (07/10/2026)

| # | Feature | Status |
|---|---|---|
| 1 | Testes de dados e de interface no CI | ✅ pytest + Playwright bloqueiam o deploy |
| 3 | Eleição 2022 | ✅ 1º e 2º turnos, polarização, puxadores 2022 |
| 4 | Presidente 2026 + 2º turno | ✅ presidente 1º turno; 2º turno entra ao rodar o pipeline quando o TSE publicar |
| 5 | Eleição 2016 | ✅ trajetória e renovação |
| 6 | Linha do tempo | ✅ no explorador (animação + variação entre eleições) |
| 7 | Esperado × real | ✅ validação por blocos espaciais; usado só quando R² ≥ 0,25 |
| 8 | Transferência de votos | ✅ 4 fluxos com intervalos de 90% |
| 9 | Cenários 2028 | ✅ |
| 10 | Monte Carlo | ✅ |
| 11 | Renda por setor | ✅ renda do responsável + entorno urbano |
| 12 | Equipamentos públicos | ✅ CNES (saúde, oficial) + OSM (escolas/praças); assistência social e templos sem fonte confiável |
| 13 | Investimentos | ✅ TCE-PE (1,5% do gasto cita bairro), emendas, transferências especiais, obras federais, licitações |
| 14 | Atuação parlamentar | ✅ indicações e requerimentos 2021–2026; lista de votações nominais; presença não coletada (PDF escaneado) |
| 16 | Rotas de campo | ✅ |
| 17 | PWA | ✅ instalável, offline, "Onde estou" |
| 2, 15, 18 | Atualização automática, dossiê PDF, área da equipe | ⏸ adiados |

## Decisões tomadas (07/10/2026)

| Tema | Decisão |
|---|---|
| Backend / área da equipe (item 18) | **Adiado.** Não será implementado agora. |
| Dossiê em PDF (item 15) | **Adiado.** |
| Atualização automática (item 2) | **Adiado.** Os dados são extraídos uma vez e ficam **estáticos** no repositório; a forma de atualização será definida depois. |
| Domínio próprio | **Fora de escopo** por ora; segue em `titotiago.github.io/petrolina-map`. |
| Investimentos (13) × atuação parlamentar (14) | **Ambos.** Extrair todos os dados possíveis das fontes municipais, salvar como CSV/JSON versionado com data da coleta e documentar o que não estiver disponível. |

**Escopo ativo:** itens 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16 e 17.

## Ordem de execução
1. **Semana 1:** item 1 (testes). Com testes, toda mudança seguinte é segura.
2. **Semanas 2 a 3:** itens 3, 4, 5 e 6. Mais eleições e linha do tempo.
3. **Semanas 4 a 6:** itens 7, 9, 10, 8, 11 e 12, nessa ordem. Primeiro o modelo, que alimenta os cenários e o plano de votos.
4. **Semanas 6 a 9:** item 16, em paralelo com a descoberta e coleta dos itens 13 e 14.
5. **Semanas 9 a 10:** item 17.

Itens 2, 15 e 18 ficam registrados acima para uma fase futura. Cada item vira um PR próprio com testes, a atualização do README e do `INSIGHTS.md` e o deploy validado no site publicado.
