# @cosmicfut/data

Pipeline que converte o conteúdo do jogo original (Brasfoot 2026, de terceiros) nos arquivos
de dados e assets do COSMICFUT. **Node puro, sem dependências.**

```bash
npm run build                      # usa a pasta padrão do jogo
npm run build -- --source "D:\Brasfoot 2026" --verbose
npm run build:data-only            # só JSON, sem copiar assets
```

Opções: `--source <pasta do jogo>`, `--out <apps/web/public>`, `--skip-assets`, `--verbose`.

- A pasta do jogo é **somente leitura**: o build só lê (`readFileSync` / `copyFileSync` com a pasta como origem).
  Existe uma trava que aborta se a saída estiver dentro da pasta do jogo.
- Saída: `apps/web/public/data/` e `apps/web/public/assets/{crests,crests-mini,kits,flags,flags-large,trophies,audio}`.
- **Idempotente:** JSON só é regravado se o conteúdo mudar (exceto `meta.json`, por causa do `generatedAt`). Asset só é copiado
  se faltar ou se tiver tamanho/mtime diferente. Arquivos obsoletos nas pastas gerenciadas (`data/clubs`, `data/names`
  e as pastas de assets acima) são removidos. `assets/ui` não é tocada.
- Todo JSON sai em UTF-8 sem BOM e é minificado. O build valida o parse de todo JSON, a ausência de BOM, a existência de
  todo asset referenciado e o formato dos ids. Retorna exit code 1 se algo falhar.

## Fontes lidas

| Origem | Uso |
|---|---|
| `teams/*.ban` | clubes e jogadores (serialização Java `e.t` / `e.g`, ver `src/ban.mjs`) |
| `BF26/conf_ligas_nacionais/*.cfg` | 37 ligas nacionais (`ArrayList<ConfigLigaType>`); usa só as divisões com `valido=true` |
| `conf_estadual/*.cfg` | 27 estaduais; usa as divisões com `nTimes>0` |
| `arquivos/default_lang.xml` | nomes dos países `P0..P223` |
| `arquivos/valores_divisoes.txt`, `premios.txt` | economia |
| `arquivos/calendario_*.txt` | calendários (`dd/MM` → `MM-DD`) |
| `arquivos/names`, `surnames` | pools de nomes (linhas repetidas viram peso `w`) |
| `teams/escudos`, `escudosMini`, `camisas{,2,3}`, `BF26/aflags`, `aflagslarge`, `trofeus/*.png`, `sons/*.wav` | assets |

`BF26/cerimoniafifa`, `trofeus/videos` e os `.exe` não são usados.

## Ids

- **Clube:** `slugify(nome do arquivo .ban)`, que é ASCII minúsculo com `-` como separador. Ex.: `realmadrid_esp.ban` → `realmadrid-esp`.
  O nome original do arquivo fica em `sourceId`. Usamos o nome do arquivo e não o campo interno `d`, porque o `d` às vezes vem
  sujo (ex.: `"TESTE2 - Cópia"`). Os assets são procurados pelo nome do arquivo, depois por `d`, ignorando maiúsculas.
- **Jogador:** `${clubId}:${index}`, em que o índice percorre `elenco (l)` e depois `base (m)`.
- **Liga:** `${sigla}-${divisão}`, ex.: `BRA-1`.

## Formato de `players-market.json`

Ele usa colunas posicionais para ficar compacto (~4,4 MB, ~85 mil jogadores):

```jsonc
{
  "version": 1,
  "fields": ["clubIdx","playerIdx","name","pos","age","overall","potential","value","wage","nationalityId","youth"],
  "positions": ["GK","FB","CB","MF","FW"],   // pos = índice nesta lista
  "clubs": ["12deoctubre-par", ...],          // clubIdx -> clubId
  "rows": [[0, 0, "Mauro Cardozo", 0, 38, 70, 70, 230000, 11000, 150, 0], ...]
}
```

O id do jogador é `clubs[clubIdx] + ':' + playerIdx`, e `youth` vale 0 ou 1. Os detalhes completos ficam em `clubs/<id>.json`.

## Atributos derivados (overall, potencial, salário, valor)

O jogo original **não guarda** overall, salário nem valor. Os sinais disponíveis são o nível do clube (1–24), a reputação (0–5),
o `hash` do jogador (0–10, variação individual), `craque`, `destaque` (titular), `top mundial` e a idade.
Todo o cálculo é determinístico: o RNG (mulberry32) é semeado por `FNV-1a(id do jogador)`. Código em `src/ratings.mjs`.

### Overall (elenco principal)

1. Média-alvo do clube: `T = 47 + (nível − 1) × 37/23 + 0,4 × (reputação − 2,5)`. Isso dá cerca de 46 no nível 1 e cerca de 85 no nível 24.
2. Score individual: `r = (hash − 5) + (destaque ? +3 : −2) + (craque ? +5 : 0) + ajusteIdade(idade) + ruído(±2)`.
   - `ajusteIdade`: ≤17 −9 · 18 −7 · 19 −5 · 20 −3,5 · 21 −2 · 22 −1 · 23 0 · 24–29 +0,5 · 30 0 · 31 −0,5 · 32 −1,5 · 33 −2,5 · 34 −3,5 · 35+ −4,5 −1,2/ano.
3. Recentralização: `overall = T + (r − média de r no elenco)`. A média do elenco fica sempre no alvo do nível.
   O limite é 30..89, ou 92 para craques.
4. Top mundial: `max(overall, 88 + 0,45×hash + craque + ruído(0..1,5) + 0,3×max(0, nível−20))`, limitado a **88–95**.
5. Arquivos editados com `hash > 10` (raros, valores 11–89): o hash é tratado como overall explícito.

**Base (lista `m`):** `T − 14 + 0,8×(hash−5) + destaque×2 + craque×4 + 1,5×(idade−17) ± 2`, limitado a 25..80.

### Potencial

`potencial = overall + gap(idade) × (0,6 + 0,04×hash ± 0,15) + bônus`, limitado a overall..97.
- `gap`: 15→22, 16→20, 17→18, 18→16, 19→14, 20→12, 21→10, 22→8, 23→6, 24→4, 25→3, 26→2, 27→1, 28+→0.
- Bônus: craque com menos de 27 anos +3, destaque com menos de 23 +2, top mundial com menos de 24 +2.

### Valor de mercado

```
eff   = idade ≤ 23 ? overall + 0,35 × (potencial − overall) : overall
valor = 2.000.000 × e^(0,17 × (eff − 70)) × multIdade × (0,75 + 0,1 × reputação)
multIdade: ≤20 1,1 · 21–27 1,0 · 28–29 0,9 · 30 0,75 · 31 0,6 · 32 0,48 · 33 0,38 · 34+ 0,3×0,8^(idade−34)
```
O valor é arredondado para números "redondos", com mínimo de 10.000. Referência: ovr 70 ≈ 2 M, 80 ≈ 11 M, 85 ≈ 26 M e 90 ≈ 60 M, com reputação 5 multiplicando por 1,25.

### Salário mensal

```
salário = 12.000 × e^(0,14 × (overall − 70)) × (0,7 + 0,12 × reputação) × (idade ≤ 20 ? 0,5 : idade ≤ 22 ? 0,75 : 1)
```
O mínimo é 300. Referência com reputação 4: ovr 60 ≈ 3 mil, 70 ≈ 14 mil, 80 ≈ 56 mil e 90 ≈ 230 mil.
A escala foi escolhida para caber na economia do original: caixa inicial de 15 M e patrocínio de 6 M para a 1ª divisão. A engine pode recalibrar.

### Resultado (build atual)

As médias de elenco por nível ficam assim: 1→46,1 · 6→54,3 · 12→64,3 · 18→74,4 · 21→79,4 · 24→85,2.
Real Madrid tem média 84,9 e top-11 de 90,5. Palmeiras tem média 78,1, com titulares (destaque) em 80,8 e reservas em 74,3.

## Escala real (dados dos curadores) — `src/real.mjs`

Desde 13/11 os números finais **não** são os da seção anterior: ela vira só o ponto de partida (overall/potencial
derivados), recalibrado para a vida real. **1 "$" do jogo = 1 €.** Opção `--real <pasta>` (padrão `packages/data/real`).

**Entrada:** todos os `real/*.json`, em ordem alfabética. Em duplicatas, vale o último arquivo, com aviso. Arquivo
ausente, parcial ou inválido é ignorado, também com aviso.
- **`clubs-*.json`:** `{ "<clubId>": { balance, revenue, wageBill, squadValue, confidence } }`. Valores em euros.
  `revenue` e `wageBill` são anuais.
- **`players-*.json`:** `[{ clubId, name, overall, potential, value, wage }]`, com `wage` em € por **mês**.

**Casamento de jogadores:** primeiro por `clubId` + nome exato, depois por nome normalizado (sem acento, minúsculo,
só letras e números). Se o nome se repete no elenco (titular e júnior homônimos), o dado real vai para o jogador do
elenco principal, e o júnior fica com o fallback. O build imprime quantos casaram (exatos/normalizados) e quantos
ficaram sem par.

Os jogadores com dado real ficam **exatamente** como os curadores definiram. Os demais (fallback) são calibrados
assim:

1. **Overall:** `Δ` do clube = mediana(real − derivado) dos jogadores curados do clube. Com 1–2 curados, o `Δ` é
   misturado ao modelo; sem curados, vale só o modelo. O jogador recebe `overall = derivado + Δ` (limite 30..94; base
   25..94) e `potencial = overall + gap derivado`, o que mantém o potencial maior para os jovens.
   - **Modelo:** `y ≈ a + b·(nível−12) + resíduo(país)`, ajustado por mínimos quadrados ponderados. Os pseudo-pontos
     no prior encolhem o ajuste, o resíduo por país é encolhido por n/(n+2), e o modelo não extrapola fora da faixa
     de níveis que tem dados (`fitModel`).
2. **Valor:** usa uma curva neutra igual à da engine:
   `valor = 2,5 M × e^(0,2·(eff−70)) × multIdade`, com `eff = ovr + 0,35·(pot−ovr)` até 23 anos.
   - `multIdade`: ≤20 1,15 · 21–24 1,05 · 25–27 1 · 28 0,92 · 29 0,85 · 30 0,72 · 31 0,6 · 32 0,48 · 33 0,38 ·
     34+ 0,3·0,8^(idade−34).
   - **Fator do clube `k`** (prêmio da liga/clube): é a mediana de valor real ÷ curva dos curados, misturada ao
     modelo, que parte do prior `COUNTRY_PREMIUM` por país (ING 1,6, ESP 1,1, ALE/ITA 1,0, BRA 0,6, ...).
   - **`squadValue` é alvo suave:** só fecha o total do elenco quando ≥ 70% do elenco principal é curado. Mesmo
     assim, `k` fica entre 0,5× e 2× a referência, e nunca abaixo de 60% do modelo (piso do nível). Os valores dos
     jogadores curados nunca são reescalados.
3. **Salário mensal:** `0,025 × (2,5 M × e^(0,2·(ovr−70)))^0,95 × (≤20 0,5 · ≤22 0,75) × k^0,95 × s`.
   - `s` = mediana de salário real ÷ curva dos curados, misturada ao modelo.
   - Com `wageBill` conhecido (ou `revenue` × razão folha/receita do modelo, com prior de 0,6), `s` fecha a folha
     com os salários curados fixos, entre 0,5× e 2× a referência. Mínimo de 300.
4. **Finanças do clube** (`Club.finances` e `clubs-index.json → finances`):
   - `revenue`: o valor real, ou `valor do elenco × modelo(receita/elenco)` (prior de 0,9; mínimo de 150 mil).
   - `balance`: o valor real, ou `receita × modelo(caixa/receita)` (prior de 0,15).
   - `sponsorPerSeason = 0,40 × revenue`.
   - `wageBill`: a **folha real do elenco gerado** (soma dos salários × 12). É ela que a engine usa como W0 no
     equilíbrio. A folha dos curadores, que inclui funcionários, serve só de alvo.
5. **Prêmios** (`economy.json`): os valores de `premios.txt` estão em reais e são convertidos com × 0,17 (≈ R$→€).
   Por exemplo, Libertadores 23 mi e Copa do Brasil 13 mi. Os valores originais ficam em `prizesBRL`.
   `initialMoneyByDivision`/`sponsorByDivision` continuam no arquivo, mas só para saves e dados antigos.

**Economia da engine** (`packages/engine/src/season/economy.ts`, `REAL_ECONOMY`):
- **Receitas:** TV = 0,38·R; bilheteria ≈ 0,17·R; patrocínio = 0,40·R.
  - O preço do ingresso é `0,17·R ÷ (jogos em casa × capacidade × ocupação esperada)`.
- **Custos operacionais:** `max(0,10·R, 0,92·R − W0)`.
- **Aporte do dono:** `max(0, W0 + 0,10·R − 0,95·R)`, para clubes que gastam mais do que arrecadam, como os sauditas.
- **Resultado:** com a folha inicial, o caixa fica ~estável, com um superávit de ~3% de R, mais prêmios e transferências.

## Etapa 3 — overalls no padrão EA Sports FC 27 (`src/tiers.mjs` + `src/real.mjs`)

A partir da Etapa 3 o **overall final** segue a escala das cartas base do FC 27 (ouro/prata/bronze, sem cartas
especiais). Os valores de mercado e salários curados (`players-*.json`) continuam os mesmos; quem não tem valor
curado tem valor e salário **recalculados pelo novo overall** (curvas da seção "Escala real"). Ordem dentro de
`applyReal`: casamento → overall (FC > curadoria > fallback) → tiers → valor → salário → finanças.

**1. Cartas FC 27** — `real/fc27-*.json` (`fc27-eng-esp.json`, `fc27-ita-ger-fra.json`, `fc27-world.json`), lidos por
`loadFc` (não por `loadReal`): arrays `{ clubId, name, overall, potential?, source: 'fc27'|'fc26-adjusted'|'estimate' }`.
Arquivo ausente é ignorado; arquivo parcial (curador escrevendo) é lido até o último objeto completo, com aviso.
Casamento igual ao da curadoria (exato → normalizado). A carta substitui o overall curado; o potencial vem da carta
ou do gap curado/derivado. **Cartas de clubes brasileiros são ignoradas** (o Brasileirão não está no FC).

**2. Fallback europeu/convidados (sem tier):** jogadores curados sem carta recebem `curado + mediana(FC − curado)` dos
colegas que têm as duas coisas (peso total a partir de 3); os sem curadoria recebem `derivado + Δ`, com
`Δ = mediana(alvo − derivado)` dos colegas cobertos (FC ou curado deslocado). Ou seja, o fallback é recentrado nas cartas.

**3. Tiers** (BRA, ARG, URU, COL, CHI, PAR, EQU, ARS). Todo o Brasil e quem não tem carta nos demais países. O overall
anterior (curado ou fallback) **só ordena** o elenco.
- **Tier por clube:** `CLUB_TIERS` (lista explícita); os demais clubes recebem um padrão: Série A → C, Série B → D,
  "só estadual" → F; fora do Brasil, 1ª divisão → D e 2ª → E.
- **R = topo da faixa de titulares.** S = 77, A = 75. Nos tiers B [71–72], C [69–71], D [67–69], E [61–66] e F [55–65],
  R é interpolado pela força (nível + 0,5 × reputação) normalizada entre os clubes do mesmo tier.
- **Faixas por status:**

  | Status | Faixa | Tier S | Tier A |
  |---|---|---|---|
  | Craque | R+1 … R+5 (S) / R+4 | 78–82 | 76–79 |
  | Titular | R−3 … R | 74–77 | 72–75 |
  | Reserva | R−8 … R−4 | 69–73 | 67–71 |
  | Base | R−15 … R−9 | 62–68 | 60–66 |

  Os titulares de B/C/D ficam entre 64 e 72.
- **Status (`squadStatus`):**
  - flag `youth` (lista `m`) → base;
  - XI = melhores por posição em 4-3-3 ou 4-4-2 (vale o de maior soma), completado pelos melhores de linha;
  - craques = os 2 melhores do XI, mais flag craque/top mundial no XI (máx. 3; o 3º sem flag só se estiver a ≤ 1 ponto do 2º);
  - ≤ 20 anos fora do XI → base; o resto → reserva.
- **Nivelamento (`levelSquad`):** dentro de cada status, o ranking leva o melhor a `hi−1` e o pior a `lo`. Soma-se a
  variação orgânica (−1..+2: hash 45%, nº de características 25%, jitter por id 30%, +0,15 para craque), limita-se
  à faixa e aplica-se um mínimo acumulado, para que ninguém passe quem estava à frente no mesmo status. Os jogadores
  com carta FC (fora do Brasil) ficam fixos e só participam da escolha do XI.
- **Potencial:** novo overall + o gap anterior. Até 23 anos, o gap tem piso de metade do `growthGap(idade)`.

O build imprime as cartas aplicadas por fonte, as contagens por tier e a **mediana do top-11 por liga**. Use
`--squads flarj,palmeiras` para listar elencos com status/overall/potencial. Testes: `npm test --workspace @cosmicfut/data`.

## Atribuição clube → liga/divisão

Foram investigados os campos `o`, `n`, `id`, `sid`, `aid` e `tid` do `.ban`, e nenhum deles codifica a divisão:
`sid`, `aid` e `tid` são sempre 0, `o` é 0 em 89% dos clubes sem padrão, e `id` é um índice alfabético. Os `.cfg` também não
listam clubes, só quantidades. Por isso usamos o **fallback documentado**:

- **Ligas nacionais:** dentro de cada país, os clubes são ordenados por `nível ↓`, `reputação ↓` e `nome`, e preenchem as divisões
  válidas de cima para baixo com `nTimes` clubes cada. Validação: os 20 primeiros do Brasil são exatamente os 20 da Série A 2026.
  - Se uma divisão fica com menos de **8** clubes reais, ela e as abaixo dela são omitidas, e os clubes restantes ficam com `leagueId=null`.
  - Uma divisão parcial com 8 ou mais clubes entra com `teams` igual ao número real de clubes. O `nTimes` original fica em `legacy.configuredTeams`.
  - `relegated(i) = promoted(i+1) = min(nRebaixados do cfg, times(i), times(i+1))` (Fase 1: sem o antigo corte por `⌊times/2⌋`). A última divisão não rebaixa.
  - **Brasil (Série D Real):** `BRA-4.relegated = 64` (nRebaixados) e `BRA-5.promoted = 0`; as divisões 5–10 do original ficam com `fictional: true` (só compatibilidade; a carreira as ignora). A BRA-4 inicial é montada como no modo real: 32 clubes nacionais por força + 64 vagas pelos estaduais (mín. 2 / máx. 4 por UF). As BRA-5..10 recebem o resto por força.
    Os valores crus ficam em `legacy`.
- **Estaduais:** os clubes brasileiros da UF (campo `b` do `.ban`) são ordenados do mesmo jeito e preenchem as divisões com `nTimes>0`.
  O clube mantém o `leagueId` nacional, e o estadual aparece só em `states.json`.
- **Finanças:** desde 13/11 vêm da escala real (ver "Escala real"). As tabelas `initial_money_div{divisão}` e
  `sponsor_div{divisão}` do original ficam só em `economy.json`, para compatibilidade.

## Países

`countries.json` traz o índice P<n>, a sigla, o nome e a bandeira. A tabela índice→sigla está em `src/countries.mjs`.
- 37 siglas foram confirmadas pelo campo `pais` dos `.cfg`.
- As demais vieram do nome do país e foram validadas por estatística de nomes: tokens dos nomes de jogadores e técnicos de cada
  nacionalidade foram comparados com os pools `names/`/`surnames/` de cada sigla.
- Bonaire, São Martinho Francês e São Martinho Holandês não têm sigla no jogo e ficam com `code: null`.

## Arquivos

- `src/javaser.mjs`: leitor de serialização Java (port ESM de `tools/extract/javaser.js`).
- `src/ban.mjs`: decodificador de `.ban` (port de `tools/extract/decode_ban.js`).
- `src/countries.mjs`: tabela de siglas e UFs.
- `src/ratings.mjs`: fórmulas derivadas.
- `src/real.mjs`: leitura de `real/*.json` (e das cartas `fc27-*.json`) e recalibração para a escala real (overall, valor, salário e finanças).
- `src/tiers.mjs`: (Etapa 3) tiers por clube, status no elenco e nivelamento para quem não está no FC 27.
- `src/util.mjs`: slug, correção de mojibake, RNG e arredondamento.
- `src/formats.mjs`: formatos dos estaduais convertidos à mão (Fase 1).
- `src/build.mjs`: orquestração, escrita, cópia de assets e validação.

## Competições (Fase 1)

Spec: `docs/specs/competicoes-e-temporada.md` (§2.2, §3, §7.1). Tipos em `packages/shared/src/types.ts`
(`FormatDef`, `StageDef`, `PickRule`, `TieRule`, `CompetitionsFile`, `DivisionExtra`, `StateDivisionExtra`).
Nada foi removido: só arquivos e campos novos.

- **`formats.json`** (`FormatsFile`): os 60 `(Tipo k)` de `formatos/estaduais/<n>_Times.txt`, convertidos **à mão** em
  `src/formats.mjs` (o texto tem typos como `Semi: Ida]`). Chave `"<nTimes>_<tipo>"`, ex.: `"16_2"` (Paulistão),
  `"12_2"` (Carioca: Taça Guanabara + Taça Rio + quadrangular do rebaixamento), `"31_1"` (Pernambucano: Frevo/Forró).
  Fases `table` (grupos, grupo x grupo, rodadas parciais) e `knockout` (I/V ou JU, pênaltis, playoff-semi com `byes`,
  3º lugar, títulos secundários). As fases de rebaixamento são marcadas com `relegationStage`; a engine (`stateFormat`)
  liga as contagens da divisão e as remove quando a divisão não rebaixa. O build valida ids e referências.
  - `24_1` (SP Segundona): o arquivo pula as quartas; implementado oitavas → quartas → semi → final (lacuna 6 da spec).
- **`states.json`** ganha por divisão: `formatKey`, `relegated` (nRebaixados), `relegatedDirect`, `relegationPlayoff`,
  `relegationOverall` (rebaixamentoGeral) e `promotedFromBelow` (= `relegated`; a última divisão não rebaixa).
- **`leagues.json`** ganha `cfg` (todos os campos de `ConfigLigaType`: `formula`, `nGrupos`, `jogosDentroGrupo`,
  `playoffAcesso`, `vagasSobemPeloMataMata`, `duasVoltasMataMata[]`, `aperturaClausura`, `positionPrizes`…) e
  `fictional` (BRA-5..10). A engine monta o formato pelo `cfg` (`nationalFormat`): formula 0 (+ Playoff de Acesso),
  3 (Série C), 6 (Série D), 4 + Apertura/Clausura (ARG), Apertura/Clausura em formula 0 (URU).
- **`competitions.json`** (`CompetitionsFile`): registro declarativo — Séries A–D, Copa do Brasil (`BRA-CUP`, potes),
  Supercopa (`BRA-SUP`), os 67 estaduais (`EST-<UF>-<div>` com `formatKey`, calendário `estaduais`, prêmio `ESTADUAL`,
  troféu), ligas e copas dos outros países, e continentais/regionais desligados (`disabled: true`, Fase 2).
  Também traz as flags do país (`brazilCopaReal`, `brazilSerieDReal` de `NAC:BRA`), os parâmetros da Série D Real
  (64 vagas, 28 mantidos, mín. 2/máx. 4 por UF, ordem geográfica das UFs) e da Copa (pote 1 = 12, 1ª fase = 80).
- **Fase 2 (`competitions.json` v2)**: LIBERTADORES, SULAMERICANA, RECOPA, INTERCONTINENTAL, SUPERMUNDIAL e NORDESTE
  (prêmio `ESTADUAL`, "Regionais/Estaduais" do premios.txt) passam a ligados (sem `disabled`; formato montado pela
  engine em `season/continental.ts`). Novo bloco `continental` (`ContinentalConfig`): países CONMEBOL e a liga usada,
  vagas por país na Libertadores (`groups`/`f2`/`f1`, `cupSlot` do Brasil) e na Sul-Americana (`groups`/`prelim`),
  confederações (Intercontinental/Supermundial), parâmetros do Nordeste e `initial` = campeões reais de 2025 para o
  1º ano (Libertadores Flamengo, Sul-Americana Lanús, Copa do Brasil Corinthians, Brasileirão Flamengo). Copa Verde,
  Sul-Sudeste e Copa Paulista seguem `disabled`.
- **Calendários por competição**: `calendars.json` já tinha todos; o registro aponta o `calendarId` de cada competição
  (`nacional`, `estaduais`, `copa-nacional`, `supercopa`, `apertura`/`clausura`).
- **`clubs-index.json`** ganha `reputation` e `capacity` (a carreira precisa delas para os ~690 clubes do Brasil sem
  carregar os bundles).

## Etapa 4 — economia dos clubes (`src/prizes.mjs` → `economy.json` v2 + `src/real.mjs`)

**Moeda do jogo: EURO.** A UI mostra "€ 1,05 bi / € 120 mi / € 850 mil" e, opcionalmente, reais com o câmbio fixo
**1 € = R$ 6,30** ("R$ 756 mi"). Os prêmios do original (`premios.txt`, em R$) passam a ser convertidos por esse
câmbio (antes × 0,17): Copa do Brasil R$ 77 mi → € 12 mi.

**`economy.json` v2** (além dos campos antigos, mantidos para compatibilidade): `version: 2`, `currency`
(`brlPerEur` 6,30, `usdToEur` 0,87, `gbpToEur` 1,17), `tv`, `merit`, `competitionPrizes`, `wageRatio`, `matchday`,
`ownerBacked`. Cada linha de TV/merit/prêmio traz `source` e `confidence` (`high`/`medium`/`low`).

| Tabela | Conteúdo | Exemplos (€) |
|---|---|---|
| `tv[liga]` | cota anual `min`–`max` (pelo ranking de receita na divisão), paga em 12 parcelas | PL 105–115 mi (+ merit), LaLiga 45–120 mi, Brasileirão 22–60 mi, Série B 1,5–5 mi, ARG 2,5–8 mi, só estadual 0,05–0,4 mi |
| `merit[liga]` | prêmio por posição: `first` → `last` linear até `paid` | PL £ 56 mi → £ 2,8 mi (20 posições); Brasileirão R$ 48 mi → R$ 17 mi (1º–16º) |
| `competitionPrizes[id ou prizeKey]` | `participation`, `win`/`draw` (fase de tabela), `reach` (`q1`–`q4`, `playoff`, `groups`, `r64`…`final`), `champion` | UCL 18,62 mi + 2,1/0,7 por jogo, oitavas 11, quartas 12,5, semi 15, final 18,5, título +6,5; Libertadores US$ 0,6/0,75/0,85 (fases), grupos US$ 3 mi, vitória US$ 330 mil, oitavas 1,25, quartas 1,7, semi 2,3, final 7, título +17 (US$ 24 mi); Copa do Brasil R$ 0,9 mi (1ª fase) … final R$ 33 mi + título R$ 44 mi |
| `wageRatio[liga ou país]` | folha/receita: `target` (recalibração) e `cap` (teto da diretoria) | ING 0,55/0,65 · ESP 0,60/0,70 · ITA 0,58/0,65 · ALE 0,50/0,55 · BRA 0,50/0,60 · ARG 0,42/0,50 · PIF (`owner`) 1,3/1,9 |
| `matchday[país]` | fatia da receita que vem da bilheteria (calibra o preço-base) | ESP 0,17, ING 0,15, BRA 0,13, ARG 0,25, ARS 0,05 |
| `ownerBacked` | clubes bancados pelo dono (aporte) | Al-Hilal, Al-Nassr, Al-Ittihad, Al-Ahli |

**Recalibração da folha (`real.mjs`, passo 4).** A receita e o caixa do clube são calculados antes dos salários
(4a). A folha-alvo dos jogadores é a folha curada × 0,92 (`PLAYER_WAGE_SHARE`; a curada inclui funcionários) ou,
sem ela, `receita × wageRatio.target`. O fator do fallback fecha a folha na faixa 0,3×–4× a referência (antes
0,5×–2×); se ainda faltar mais de 3% (elencos quase todos curados), os curados que **não** são as 3 maiores
estrelas sobem até 1,6× (`CURATED_UPLIFT_MAX`). Resultado: Flamengo € 64 mi → € 94 mi/ano; medianas folha/receita:
PL 0,56, LaLiga 0,52, Serie A 0,49, Bundesliga 0,36, Brasileirão 0,37 (folhas curadas), Série B 0,46, ARG 0,37.

**Engine (`packages/engine/src/season/econ.ts`).** O perfil econômico de cada clube é recalculado a cada trecho
(`clubEconomyProfile`) a partir da receita R e da folha W0 dos dados: TV da divisão atual, patrocínio (= R − TV −
merit esperado − bilheteria esperada − prêmios-base), comissão/funcionários (6% R + técnico), manutenção do estádio
(€/lugar/mês por região × classe de idade), despesas operacionais (fecham 98% de R com W0), aporte (PIF), teto da
folha, limite do cheque especial (20% R; juros de 2,5% ao mês) e preço-base do ingresso. A bilheteria é por jogo:
`público = capacidade × ocupação(preço, Moral da Torcida, fase, importância)` e
`renda = público × preço × importância × gasto por torcedor`. Ver a nota 32 do Obsidian para as fórmulas completas.

## Etapa 5 — valor de mercado dinâmico e mercado completo (engine)

Os valores do `players-market.json` / `clubs/<id>.json` continuam sendo os **dados do 1º dia**. Na carreira, a engine
(`packages/engine/src/transfers/value.ts`) recalcula o valor a cada consulta:

```
valor = CurvaExp(overall efetivo) × Idade × PrêmioJovem × Liga × Contrato × Reputação
CurvaExp(e) = 2,5 M × e^(0,2·(min(e,85) − 70)) × e^(0,16·max(0, e − 85));  e = ovr + w·(pot − ovr), w = 0,5 aos 19 → 0 aos 24
Idade: ≤19 1,30 · 21 1,24 · 23 1,12 · 25–27 1 · 29 0,82 · 31 0,56 · 32 0,42 · 33 0,30 · 34 0,20 · 35+ 0,14×0,75^(idade−35)
PrêmioJovem = 1 + 0,35 × clamp((24 − idade)/6) × clamp((ovr − 70)/15)
Liga: ING-1 1,4 · ITA-1 1,15 · ESP/ALE/FRA-1 1,05 · POR-1 0,95 · HOL-1 0,85 · ARS-1 0,78 · BRA-1 0,72 · ARG-1 0,55 ·
      URU/COL/CHI/PAR/EQU-1 0,32–0,39 · 2ªs divisões e só estaduais abaixo
Contrato (meses): ≥36 → 1 · 24–36 → 0,88–1 · 12–24 → 0,60–0,88 · 6–12 → 0,15–0,60 · últimos 6 → 0,02–0,15
Reputação = 1 + (f0 − 1) × 0,75^temporadas;  f0 = valor dos dados ÷ (curva neutra × liga dos dados × contrato padrão)
```

O **fator de reputação** f0 (limitado a 0,1–10) faz o valor do 1º dia ser exatamente o dos dados (curados ou do
pipeline) e decai ~25% por temporada em direção à fórmula. Os multiplicadores de liga foram calibrados pela mediana
(valor dos dados ÷ curva neutra) de cada liga, respeitando a ordem PL > top-5 > POR/HOL/Arábia > Brasil > resto da
América do Sul (no Brasil os curados ficam acima da ordem: f0 ≈ 1,5 e decaem). Nenhum arquivo de dados mudou.

## Calendário (pular no tempo) e Registros (engine + web)

Nenhum arquivo de dados mudou. Engine: `packages/engine/src/season/skip.ts` e `records.ts`; testes em
`packages/engine/test/records-skip.test.ts`.

- **Pular no tempo (`TimeSkip`)**: avança a carreira dia a dia até a data-alvo — exatamente o laço do Continuar
  (`advanceDay` + `coachDay` + viradas), em pedaços (`step({ ms | days })`) sem mudar o resultado. O assistente escala o
  time (`lineup = null`), não negocia (propostas expiram; multa rescisória continua forçando a venda) e, na virada do
  humano sem parada, renova as peças-chave (`assistantRenewals`: 16 melhores até 32 anos + promessas até 23 com
  potencial ≥ média do XI − 3). Paradas: demissão, proposta de emprego, proposta por jogador ≥ X% do valor, fim da
  temporada do humano, ou nenhuma. A virada que vence exatamente na data-alvo é feita antes de parar. No web, o worker
  (`t: 'skip'`) cede o controle a cada ~90 ms (progresso + cancelamento fora da fila, `t: 'skipCancel'`) e salva no fim
  e no cancelamento. Só carreira solo.
- **Assistências**: `MatchResult.scorers[].assistId` (partida completa: o passe que já existia; simulação leve: RNG
  próprio `seed:light:ast`, 72% dos gols, peso posição × (overall/70)³). Artilheiros da simulação leve: posição ×
  (overall/70)³. `Competition.assists` = tabela viva.
- **Virada**: `ChampionRecord` ganha `scorers`/`assists` (top 20; 10 nos estaduais menores: `[id, nome, clube, n]`),
  `table` (ordem final), `reach` (rodada mais funda do mata-mata principal), `countryId`, `division`.
- **Carreira dos jogadores**: `SeasonState.career.lines` (`jogador|clube` → [J, G, A, Σnota×10, empréstimo]) no trecho;
  cada virada despeja em `WorldState.records.players[jogador]` = `[temporada, clube ('' = clube de origem do id), J, G,
  A, nota×10, emprestado?]`, somando na mesma temporada/clube. Poda de aposentados/sumidos sem carreira relevante
  (< 150 jogos e < 40 gols, nunca em clube humano). Consultas: `playerCareer`, `clubHistory`, `clubTrophies`,
  `championsOf`.
- **Saves**: `migrateCareer` cria `records`/`lines` vazios (sem mudar `CAREER_REV`).
- **Medições** (13/11): 2 anos de salto no navegador em 48 s (≈ 60 ms/dia, 27 mil jogos); save após 2 anos 14,8 MB,
  dos quais registros de jogadores ≈ 0,97 MB e extras do histórico ≈ 0,4 MB.