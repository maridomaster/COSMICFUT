# Especificação — Competições, Temporada e Carreira (fidelidade ao original)

Status: pesquisa concluída em 2026-11-13. Documento de **especificação**: não há código de produção aqui.
Público: quem for implementar `packages/engine/src/season/` e `packages/data`.

## 0. Convenções

### Confiança
- **Alta**: o dado está literalmente num arquivo de configuração ou de calendário do original.
- **Média**: há evidência indireta. Exemplos: nomes de método ou mensagens do executável, ou o número de datas do calendário bate exatamente com o formato real da competição.
- **Baixa**: é uma proposta nossa, coerente com o original e com o futebol real, mas sem evidência direta.

### Abreviações de fontes
| Sigla | Origem |
|---|---|
| `CAL:<id>` | `arquivos\calendario_<id>.txt`. A **raiz** é a fonte da verdade. |
| `FMT:<n>/T<k>` | `arquivos\formatos\estaduais\<n>_Times.txt`, bloco `(Tipo k)`. |
| `EST:<UF>` | `conf_estadual\<UF>.cfg`. É uma `ArrayList<ConfigLigaType>` serializada. |
| `NAC:<PAÍS>` | `BF26\conf_ligas_nacionais\<PAÍS>.cfg`. |
| `EXE:"..."` | String extraída dos bytes de `BF26\brasfoot26.exe`. |
| `EXE#metodo` | Nome de método ou campo encontrado no executável. |
| `PRM` | `arquivos\premios.txt`. |
| `VAL` | `arquivos\valores_divisoes.txt`. |
| `OPT` | `options.bcf`. |
| `ACC` | `BF26\addChampion_calls.txt`. É um grep de `GameData.java` deixado pelo autor. |
| `TM` | `docs\TorneioModelo.java` e `docs\Guia_Criacao_Torneios.md`. |

### Ferramentas de pesquisa
As ferramentas ficaram em `tools/research/` e só leem o original:
- `dump-cfg.mjs <dir> [arq] [--all] [--full]`: lista os `ConfigLigaType` dos `.cfg`, usando `packages/data/src/javaser.mjs`.
- `exe-strings.mjs <exe> <out-latin1> <out-utf16>`: extrai strings Latin-1 e UTF-16 do executável sem executá-lo.
  - O GraalVM guarda as strings Java como Latin-1 compacto, então quase tudo útil está na saída Latin-1.
  - A região do aplicativo fica entre os offsets `0x3100000` e `0x3600000`.

> O executável é **GraalVM native-image**. Não há bytecode, mas os nomes de classe, método e campo e todas as mensagens ao usuário ficam no heap da imagem. Daí vêm as evidências `EXE`.

---

## 1. Calendário anual do Brasil

### 1.1 Princípios do original
- Cada competição tem um arquivo `calendario_<id>.txt`, com **uma data `dd/MM` por rodada ou jogo**, em ordem.
  - Linhas vazias no fim são ignoradas.
  - Fontes: `TM` ("contendo as datas de cada rodada") e `EXE#loadLibertadoresDates`, `getLibertadoresDateForRound`, `getStateDateForRound`.
  - Confiança: Alta.
- **O número de datas é o número de "slots" de jogo da competição.** Num mata-mata em ida e volta, cada perna ocupa uma data. Confiança: Alta, porque a contagem bate exatamente com o formato real em Libertadores, Sul-Americana, Supermundial e Recopa (ver 2.x).
- Limite de **40 datas por liga**: `EXE:"Limite de 40 datas excedido para turno e returno."`. Confiança: Alta.
- O ano corre de 01/01 a 31/12. Há uma **pausa no meio do ano**, de 31/05 a 22/07 no calendário nacional (Copa do Mundo 2026).
  - Evidência: `EXE#midYearPauseTriggered`, `EXE#processMidYearAdvance`, `EXE#enableMidYearPauseMode`.
  - Opção `EXE:"Jogar competições de seleções"`.
  - Confiança: Alta.
- Quando a liga tem menos rodadas que datas, usa as **primeiras N datas**. As restantes ficam para fases finais e playoffs. Confiança: Média, deduzida da Série B (38 rodadas + playoff) e da Série D (fases).

### 1.2 Tabela de calendários do Brasil e do continente

| Competição | Arquivo | Datas | Datas exatas (dd/MM) |
|---|---|---|---|
| Torneio amistoso de pré-temporada (opcional) | `torneio_amistoso` | 5 | 01/01 03/01 05/01 07/01 09/01 |
| Amistosos avulsos | `amistoso` | 8 | 02/01 05/01 08/01 17/06 21/12 24/12 27/12 30/12 |
| Supercopa Grão-Pará | `supercopagrao` | 1 | 04/01 |
| **Estaduais** (todas as UFs e divisões) | `estaduais` | 25 | 11/01 13/01 16/01 18/01 21/01 23/01 26/01 30/01 07/02 13/02 16/02 18/02 21/02 01/03 04/03 13/03 27/03 03/04 08/04 14/04 17/04 24/04 29/04 01/05 09/05 |
| **Brasileiro Série A–D** (e ligas nacionais de outros países) | `nacional` | 40 | 28/01 04/02 09/02 26/02 11/03 15/03 18/03 22/03 01/04 05/04 12/04 19/04 26/04 02/05 09/05 17/05 24/05 31/05 · 22/07 26/07 29/07 09/08 16/08 23/08 30/08 06/09 13/09 20/09 08/10 11/10 18/10 25/10 28/10 04/11 18/11 23/11 25/11 08/12 11/12 14/12 |
| **Supercopa do Brasil** | `supercopa` | 1 | 01/02 |
| **Libertadores** | `libertadores` | 19 | 03/02 11/02 17/02 23/02 03/03 09/03 29/03 09/04 16/04 29/04 03/05 10/05 13/08 20/08 17/09 25/09 22/10 01/11 01/12 |
| **Recopa Sul-Americana** | `recopa` | 2 | 20/02 27/02 |
| Recopa Catarinense | `recopacatarinense` | 1 | 06/03 |
| **Copa Nacional (Copa do Brasil)** | `copa_nacional` | 13 | 08/03 25/03 06/05 13/05 01/08 05/08 26/08 02/09 08/11 15/11 21/11 29/11 06/12 |
| **Sul-Americana** | `sulamericana` | 16 | 10/03 30/03 07/04 15/04 30/04 04/05 11/05 07/06 14/06 09/09 16/09 01/10 06/10 15/10 22/10 11/11 |
| **Copa do Nordeste** | `nordeste` | 10 | 31/03 10/04 14/04 21/04 29/04 20/05 27/05 03/06 07/06 11/06 |
| Copa ES | `copaes` | 13 | 31/03 10/04 14/04 21/04 29/04 01/05 08/05 14/05 20/05 27/05 03/06 06/06 12/06 |
| Copa Grão-Pará | `copagrao` | 3 | 14/05 20/05 27/05 |
| Copa Paulista | `copapaulista` | 18 | 14/05 20/05 27/05 03/06 06/06 12/06 15/06 18/06 22/06 26/06 28/06 01/07 04/07 07/07 11/07 14/07 04/09 08/09 |
| Copa Sul-Sudeste | `sulsudeste` | 11 | 05/06 08/06 16/06 24/06 28/06 03/07 06/07 10/07 21/07 02/08 10/08 |
| Recopa Gaúcha | `recopagaucha` | 1 | 09/06 |
| Recopa Paraibana | `recopaparaibana` | 1 | 09/06 |
| Copa Verde | `copaverde` | 10 | 15/06 18/06 22/06 26/06 28/06 01/07 04/07 07/07 11/07 14/07 |
| Copa Rio | `copario` | 10 | (iguais às da Copa Verde) |
| Copa Alagoas | `copaalagoas` | 10 | (iguais às da Copa Verde) |
| Copa Governo de Sergipe | `copagoverno` | 8 | 15/06 18/06 22/06 26/06 28/06 01/07 04/07 07/07 |
| **Supermundial de Clubes** | `supermundial` | 7 | 21/06 25/06 29/06 02/07 06/07 10/07 15/07 |
| Copa FGF (RS) | `copafgf` | 14 | 04/09 08/09 16/09 24/09 27/09 02/10 05/10 14/10 21/10 02/11 06/11 10/11 22/11 30/11 |
| Copa Paraná | `copaparana` | 11 | 04/09 08/09 16/09 24/09 27/09 02/10 05/10 14/10 21/10 02/11 10/11 |
| Copa Paraíba | `copaparaiba` | 7 | 04/09 08/09 16/09 24/09 27/09 02/10 05/10 |
| Taça Fares Lopes (CE) | `fareslopes` | 8 | 04/09 08/09 16/09 24/09 27/09 02/10 05/10 14/10 |
| Copa Santa Catarina | `copasantacatarina` | 12 | 06/09 13/09 20/09 08/10 11/10 18/10 25/10 28/10 04/11 18/11 22/11 25/11 |
| **Intercontinental FIFA** | `intercontinental` | 5 | 16/12 19/12 22/12 25/12 29/12 |
| Apertura (ARG/URU) | `apertura` | 20 | 28/01 04/02 10/02 25/02 11/03 15/03 18/03 22/03 01/04 05/04 12/04 19/04 26/04 03/05 10/05 17/05 24/05 31/05 22/07 26/07 |
| Clausura (ARG/URU) | `clausura` | 20 | 29/07 09/08 16/08 23/08 30/08 06/09 13/09 20/09 07/10 11/10 18/10 25/10 28/10 04/11 18/11 22/11 25/11 02/12 10/12 13/12 |

Também existem calendários de outras confederações:
- UEFA: `champions_uefa`, `europa_league`, `conference_league`, `uefa`, `uefa_super_cup`.
- AFC: `afc`, `afc_champions`, `afc_champions_two`, `afc_challenge`.
- CAF: `caf`, `caf_champions`, `caf_confederation`, `caf_super_cup`.
- CONCACAF e Caribe: `concacaf`, `leagues_cup`, `central_american_cup`, `caribbean_cup`, `CFU_shield`.
- OFC: `ofc_champions`, `ofc_pro_league`.

Eles já estão em `calendars.json`. São necessários para a fase 2 (continentais) e para alimentar o Intercontinental e o Supermundial.

Confiança dos dados: **Alta**. São cópias literais da raiz. `BF26\arquivos` duplica esses arquivos, mas pode estar desatualizado.

### 1.3 Ordem cronológica de um ano no Brasil
1. **Jan**:
   - pré-temporada opcional: `EXE:"Deseja criar um torneio Amistoso de início de temporada?"`;
   - Supercopa Grão-Pará (04/01);
   - **estaduais** a partir de 11/01;
   - **Brasileiro** a partir de 28/01.
2. **Fev**:
   - **Supercopa do Brasil** (01/02);
   - **Libertadores**: fases preliminares 1–3, de 03/02 a 09/03;
   - **Recopa** (20/02 e 27/02).
3. **Mar**:
   - Recopa Catarinense (06/03);
   - **Copa do Brasil**: 1ª fase em 08/03 e 2ª em 25/03;
   - **Sul-Americana**: preliminar em 10/03 e grupos a partir de 30/03;
   - Libertadores, grupos a partir de 29/03;
   - **Copa do Nordeste** e Copa ES a partir de 31/03.
4. **Abr–Mai**:
   - grupos da Libertadores e da Sul-Americana;
   - **fim dos estaduais** em 09/05;
   - Copa do Brasil em 06/05 e 13/05;
   - Copa Paulista e Copa Grão-Pará a partir de 14/05.
5. **31/05 → 22/07**: **pausa das ligas nacionais**. Nesse intervalo:
   - Nordeste (final em 11/06) e Copa Sul-Sudeste;
   - Recopas Gaúcha e Paraibana;
   - Copa Verde, Copa Rio, Copa Alagoas e Copa Governo SE;
   - play-off de oitavas da Sul-Americana (07/06 e 14/06);
   - **Supermundial** (21/06–15/07).
6. **Ago–Nov**:
   - Brasileiro retomado em 22/07;
   - mata-matas da Libertadores, da Sul-Americana e da Copa do Brasil;
   - copas estaduais do 2º semestre (FGF, Paraná, Paraíba, Fares Lopes, Santa Catarina);
   - **final da Sul-Americana** em 11/11.
7. **Dez**:
   - **final da Libertadores** em 01/12;
   - **final da Copa do Brasil** em 06/12;
   - **última rodada do Brasileiro** em 14/12;
   - **Intercontinental** de 16/12 a 29/12;
   - amistosos;
   - **cerimônia FIFA The Best** e virada do ano (ver 4.1).

---

## 2. Formato de cada competição

### 2.1 Modelo genérico de fase (como o original representa)
- O `Fixture` do original tem os campos `round`, `isPlayoff`, `playoffType` (nome da fase, ex.: "Semi-Final", "Final"), `serie` (nome da competição), `leg` (1 ou 2), `knockout` e `hasPenalties`. Fonte: `TM`. Confiança: Alta.
- **Jogo único eliminatório** usa `knockout = true` e `hasPenalties = true`: empate vai direto aos pênaltis. Fonte: `TM`. Confiança: Alta.
- **Prorrogação**: não há nenhuma string de prorrogação no executável. **Não existe prorrogação**: empate no tempo normal ou no agregado leva aos pênaltis. Confiança: Média.
- **Gols fora**:
  - o `Fixture` tem o campo `awayGoals` e o método `getAwayGoals` (`EXE`);
  - nenhuma mensagem de "gol fora" ou "gol qualificado" foi encontrada;
  - nos formatos o texto é sempre "Desempate por Pênaltis";
  - **regra fiel**: agregado → pênaltis, **sem** gol fora (como na CONMEBOL e na CBF desde 2022).
  - Use `awayGoals` só como flag por competição, desligada por padrão. Confiança: Média.
- **Campo neutro**: o rótulo `EXE:"Jogo Único - Campo Neutro"` aparece nos painéis das supercopas. As finais de supercopa, Recopa estadual e Supercopa do Brasil são em campo neutro. Confiança: Média.
- **Progressão de fases**: a progressão é feita por `checkProgression()`. Quando todos os jogos de uma fase têm `played`, a fase seguinte é gerada. Os confrontos do mata-mata **não são conhecidos de antemão**. Evidências:
  - `TM`;
  - `EXE:"As chaves ainda não foram geradas. A fase regular deve terminar."`;
  - `EXE:" As semifinais e a final serão geradas após a conclusão da Fase de Grupos."`.

  Confiança: Alta.
- **Campeão e vice**: o campeão é o vencedor da partida `playoffType == "Final"`. Para o histórico, `addChampion(nome, ano, campeão, vice, artilheiro, técnico, ...)` (`ACC`). Confiança: Alta.
- **Desempate em tabela**:
  - o campo `desempate` existe em `ConfigLigaType` e está **0 em todos** os `.cfg`;
  - há também `EXE#tieBreakOrder` e `EXE#headToHeadHistory`.
  - A ordem exata do original não aparece. Proposta: **pontos, vitórias, saldo, gols pró, confronto direto, sorteio**. É o critério da CBF e é o que `computeStandings` já faz.
  - Confiança: Média para "existe confronto direto"; Baixa para a ordem exata.
- **Opção "pontos em disputa de pênaltis"**:
  - existe `EXE:"Pontos obtidos em disputas de Pênaltis"` e `EXE#penaltyTiebreakerCheck` (opção de jogo);
  - é uma variante opcional em que empate em liga vai para os pênaltis e o vencedor ganha um ponto extra;
  - deixar como opção de regra, **desligada**.
  - Confiança: Média.

### 2.2 Estaduais
**Regra geral**:
- O campo `formula` de cada divisão em `conf_estadual\<UF>.cfg` é o **número do `(Tipo N)`** em `formatos\estaduais\<nTimes>_Times.txt`. Confiança: **Alta**. Verificação:
  - SP d1 tem 16 clubes e `formula` 2. `FMT:16/T2` traz 8 rodadas parciais, 8 classificados, quartas e semi em jogo único e final em ida e volta: é o Paulistão real.
  - RJ d1 tem 12 clubes e `formula` 2. `FMT:12/T2` é Taça Guanabara + Taça Rio.
  - MG d1 tem 12 clubes e `formula` 9. `FMT:12/T9` traz 3 grupos de 4 + Troféu Inconfidência.
  - RS d1 tem `formula` 7: Taça Farroupilha.
  - SC d1 tem `formula` 5: Taça Acesc.
  - PE tem 31 clubes e `formula` 1: Torneio Frevo e Torneio Forró.
- **Datas**: todos os estaduais usam o mesmo `calendario_estaduais.txt` (25 datas). Cada fase consome as datas seguintes. Confiança: Alta (`EXE#loadStateDates`, `getStateDateForRound`).
- **Rebaixamento e acesso entre divisões estaduais**:
  - campos `nRebaixados` (total), `rebaixadosDireto`, `playoffRebaixamento` (quantos caem via playoff ou quadrangular) e `rebaixamentoGeral` (pela classificação geral);
  - métodos `EXE#applyStatePromotionRelegation` e `EXE#applyStateDirectPromotionRelegation`;
  - **sobem da divisão N+1 tantos clubes quantos caem da divisão N**; a última divisão não rebaixa.
  - Confiança: Alta para os campos; Média para "sobem = caem".
- **Clubes "sem divisão"**: são os clubes da UF fora de qualquer divisão. Existe `EXE:"Disputam playoff com liga abaixo: "` e `EXE:"ª div x sem div.)"`, ou seja, a última divisão pode disputar playoff com os sem divisão. Por padrão: 0. Confiança: Média.
- **Flag `valido`**: está `false` em todos os `.cfg` estaduais. O que liga os estaduais é a opção de jogo `playStateLeagues` (`EXE#playStateLeagues`, `EXE:"Fora do Brasil não mostrar estaduais/regionais"`). **Ignorar `valido` nos estaduais.** Confiança: Média.
- **Título em histórico**: `StateSeasonRecord` e `getLastYearStateStandings`. O campeão estadual recebe `ESTADUAL = 5.000.000` (`PRM`). Confiança: Alta.

#### 2.2.1 Mapeamento `formula` → formato, por UF e divisão (fonte `EST:*` + `FMT:*`)
Legenda:
- "turno" = todos contra todos em turno único;
- "I/V" = ida e volta;
- "JU" = jogo único;
- "PS" = playoff-semi.

O rebaixamento aparece como `total/direto`. "+pReb" indica quantos caem por playoff ou quadrangular.

| UF | Div | Nome | Clubes | F | Formato (resumo de `FMT:n/TF`) | Reb. |
|---|---|---|---|---|---|---|
| AC | 1 | Acreanão | 8 | 1 | turno → 4 → semi I/V, 3º lugar JU, final JU | 2/2 |
| AC | 2 | Acreanão Série B | 4 | 1 | grupo I/V → 2 → final I/V, pên. | – |
| AL | 1 | Alagoano | 8 | 7 | turno → 4 → semi I/V → final I/V | 1/1 |
| AL | 2 | Alagoano Série B | 6 | 1 | turno → 4 → semi I/V → final I/V | – |
| AM | 1 | Barezão | 8 | 3 | 2 turnos com 2 grupos (o 1º turno é grupo x grupo), cada um com 1º → semi, 2º e 3º → PS JU, semi JU, final JU; depois "Final Geral" entre os campeões dos turnos (JU) | 2/2 |
| AP | 1 | Amapazão | 8 | 2 | turno → 4 → semi I/V → final JU | 2/2 |
| AP | 2 | Amapazão Série B | 12 | 1 | 2 grupos de 6 (dentro) → 2 por grupo → semi I/V → final JU | – |
| BA | 1/2/3 | Baianão A/B/C | 10 cada | 2 | turno → 4 → semi JU → final JU | 2/2, 2/2, 1/1 |
| CE | 1 | Cearense | 10 | 5 | F1: 2×5 (dentro), 3 → F2 e 2 → **quadrangular de rebaixamento**. F2: 2×3 (grupo x grupo), 2 → semi I/V, 1 → disputa de 5º; 3º lugar JU; final I/V | 2/0, pReb 2 |
| CE | 2 | Cearense B | 10 | 6 | 2×5 (dentro): 1º → semi, 2º e 3º → PS JU, 2 → quadrangular de rebaixamento; semi JU, final JU | 2/0, pReb 2 |
| CE | 3 | Cearense C | 4 | 1 | grupo I/V → 2 → final I/V | – |
| DF | 1 | Candangão | 10 | 11 | turno → 4 → semi I/V → final I/V | 2/2 |
| DF | 2 | Candangão B | 8 | 4 | só turno (pontos corridos) | – |
| ES | 1 | Capixabão | 10 | 4 | turno → **8** → quartas, semi e final I/V | 2/2 |
| ES | 2 | Capixabão B | 8 | 2 | turno → 4 → semi I/V → final JU | – |
| GO | 1 | Goianão | 12 | 8 | 8 rodadas → 8 → quartas, semi e final I/V; 2 → **playoff de rebaixamento** I/V | 2/1, pReb 1 |
| GO | 2 | Goianão B | 10 | 8 | turno **I/V**, o 1º é campeão | 2/2 |
| GO | 3 | Goianão C | 10 | 9 | turno, o 1º é campeão | – |
| MA | 1 | Maranhense | 8 | 5 | turno → 4 → semi I/V → final I/V; 2 → playoff de rebaixamento I/V | 2/1, pReb 1 |
| MA | 2 | Maranhense B | 12 | 13 | 4 grupos de 3 I/V → 2 por grupo → quartas e semi I/V → final JU | – |
| MG | 1 | Mineiro | 12 | 9 | 3 grupos de 4, cada um contra os outros 2 grupos (8 rodadas); o 1º de cada grupo e o melhor 2º → semi I/V → final JU; os 4 melhores restantes → **Troféu Inconfidência** (semi I/V, final I/V) | 2/2, rebGeral |
| MG | 2 | Módulo II | 12 | 10 | 2 grupos de 6 I/V → 8 → quartas, semi e final I/V | 2/2 |
| MG | 3 | Segundona | 12 | 11 | 2×6 turno → 3 por grupo → **hexagonal** em turno (o 1º é campeão) | – |
| MS | 1 | Sul-Mato-Grossense | 10 | 15 | turno: 2 → semi direto, 4 → PS I/V; semi I/V; 3º lugar JU; final I/V | 2/2 |
| MS | 2 | Sul-Mato-Grossense B | 6 | 3 | grupo I/V em pontos corridos, sem mata-mata | – |
| MT | 1 | Mato-Grossense | 10 | 12 | turno: 2 → semi, 4 → PS JU; semi I/V; final JU | 2/2 |
| MT | 2 | Mato-Grossense B | 10 | 10 | 2×5 (dentro): 1 → semi, 2 → PS JU; semi I/V; final I/V | – |
| PA | 1 | Parazão | 12 | 12 | 6 rodadas → 8 → quartas JU, semi JU, final I/V | – (0) |
| PA | 2 | Parazão B1 | 12 | 13 | 2×6 I/V → 2 por grupo → semi JU → final JU | 2/2, rebGeral |
| PA | 3 | Parazão B2 | 8 | 2 | turno → 4 → semi I/V → final JU | – |
| PB | 1 | Paraibano | 10 | 11 | turno → 4 → semi I/V → final I/V | 2/2 |
| PB | 2 | Paraibano B | 10 | 12 | turno: 2 → semi, 4 → PS JU; semi I/V; final JU | 2/2 |
| PB | 3 | Paraibano C | 4 | 2 | turno → 2 → final JU | – |
| PE | 1 | Pernambucano | 31 | 1 | "Torneio Frevo": 24 clubes em 4×6 (dentro), 4 → oitavas JU → quartas JU → quadrangular → 3 avançam. "Torneio Forró": os 7 melhores de PE + 3 do quadrangular em 2×5 (grupo x grupo), 1º → semi, 2º e 3º → PS I/V; semi I/V; final I/V | – |
| PI | 1 | Piauiense | 8 | 7 | turno → 4 → semi I/V → final I/V | 2/2 |
| PI | 2 | Piauiense B | 6 | 2 | turno → 4 → semi I/V → final JU | – |
| PR | 1 | Paranaense A1 | 12 | 6 | 2×6 (grupo x grupo) → 4 por grupo → quartas, semi e final I/V | 2/2 |
| PR | 2 | Paranaense A2 | 10 | 4 | turno → 8 → quartas, semi e final I/V | 2/2 |
| PR | 3 | Terceirona | 8 | 7 | turno → 4 → semi I/V → final I/V | – |
| RJ | 1 | Carioca | 12 | 2 | **Taça Guanabara**: 2×6 (grupo x grupo), 4 → quartas JU, semi I/V, final JU; 2 por grupo → quadrangular de rebaixamento I/V. Os perdedores das quartas jogam a **Taça Rio** (semi I/V, final JU) | 2/0, pReb 2 |
| RJ | 2 | Carioca A2 | 12 | 3 | **Taça Santos Dumont**: turno → 4 → semi I/V → final I/V | 2/2 |
| RJ | 3 | Carioca B1 | 12 | 4 | turno → 4 → semi I/V → final I/V | 2/2 |
| RJ | 4 | Carioca B2 | 9 | 1 | turno → 4 → semi I/V → final I/V | 1/1 |
| RJ | 5 | Carioca C | 13 | 1 | turno → 4 → semi I/V → final I/V | – |
| RN | 1 | Potiguar | 8 | 6 | turno: 2 → semi, 4 → PS I/V; semi I/V; final I/V | 2/2 |
| RN | 2 | Potiguar B | 7 | 1 | turno → 4 → quadrangular final em turno (o 1º é campeão) | – |
| RO | 1 | Rondoniense | 7 | 2 | turno I/V → 4 → semi I/V → final I/V | 1/1 |
| RO | 2 | Rondoniense B | 2 | 1 | final I/V, pênaltis | – |
| RR | 1 | Roraimense | 9 | 3 | turno → 4 → semi JU → final JU | – |
| RS | 1 | Gauchão | 12 | 7 | 2×6 (grupo x grupo), 4 → quartas JU, semi I/V, final I/V; 2 por grupo → quadrangular de rebaixamento I/V. Os perdedores das quartas jogam a **Taça Farroupilha** (semi I/V, final I/V) | 2/0, pReb 2 |
| RS | 2 | Gauchão A2 | 16 | 1 | turno → 8 → quartas, semi e final I/V | 2/2 |
| RS | 3 | Gauchão B | 8 | 7 | turno → 4 → semi I/V → final I/V | – |
| SC | 1 | Catarinense | 12 | 5 | 2×6 (grupo x grupo), 4 → quartas, semi e final I/V; 2 por grupo → quadrangular de rebaixamento I/V. Os perdedores das quartas jogam a **Taça Acesc** (semi JU, final I/V) | 2/0, pReb 2 |
| SC | 2 | Catarinense B | 9 | 2 | turno: 2 → semi, 4 → PS I/V; semi I/V; final I/V | 1/1 |
| SC | 3 | Catarinense C | 3 | 1 | grupo I/V → 2 → final I/V | – |
| SE | 1 | Sergipão | 10 | 14 | turno: 1 → semi, 6 → PS JU; semi I/V; final I/V | 2/2 |
| SE | 2 | Sergipão A2 | 10 | 9 | turno, o 1º é campeão | 1/1 |
| SE | 3 | Sergipão A3 | 14 | 1 | 2×7 → 4 por grupo → quartas I/V, semi I/V, final JU | – |
| SP | 1 | Paulistão | 16 | 2 | 8 rodadas (parcial) → 8 → quartas JU, semi JU, final I/V | 2/2 |
| SP | 2 | Paulistão A2 | 16 | 3 | F1 em turno → 8 → F2 com 2×4 I/V → 2 por grupo → semi I/V → final I/V | 2/2 |
| SP | 3/4 | A3 / A4 | 16 | 1 | turno → 8 → quartas, semi e final I/V | 2/2 |
| SP | 5 | Segundona | 24 | 1 | 4×6 I/V → 4 por grupo → oitavas, semi e final I/V (as quartas não aparecem no arquivo; ver lacunas) | – |
| TO | 1/2 | Tocantinense A/B | 8 | 7 | turno → 4 → semi I/V → final I/V | 2/2, – |

Notas:
- "turno → k" significa que **os k primeiros da classificação geral** avançam.
- O pareamento do mata-mata é sempre **1º×último classificado, 2º×penúltimo...**. O melhor campanha manda o 2º jogo e tem vantagem só no pareamento, sem vantagem do empate.
  - Confiança: Baixa, pois os arquivos não citam vantagem.
  - Proposta fiel ao estilo do jogo: empate → pênaltis.
- Fases "parciais" (`Rodadas: 8 (Parcial)`), como SP d1, PA d1 e GO d1: cada clube joga **8 (ou 6) jogos contra adversários sorteados**, não todos contra todos.
  - Proposta: usar as k primeiras rodadas de um round-robin embaralhado.
  - Confiança: Média.
- `rebGeral` (MG d1, PA d2): o rebaixamento usa a **classificação geral** de todas as fases, e não a de um grupo.
  - Rótulo: `EXE:"CLASSIFICAÇÃO GERAL (incluindo mata-matas)"`.
  - Confiança: Média.
- Rótulos e fases com nome próprio que a UI deve mostrar:
  - `"TAÇA GUANABARA - GRUPO 1"`, `"SEMIFINAL TAÇA RIO"`, `"FINAL TAÇA ACESC"`;
  - `"FINAL INCONFIDÊNCIA"`, `"Grupo A - Torneio Forró"`, `"(Torneio Frevo - Grupo A)"`;
  - `"QUADRANGULAR FINAL"`, `"PLAYOFF DE REBAIXAMENTO"`, `"FINAL GERAL / CAMPEÃO"`.

  Fonte: `EXE`. Confiança: Alta.
- Os métodos com nome de tipo confirmam que esses formatos são **codificados à mão** no original, um a um:
  - `createPlayoffSemi31TeamsTipo1`, `createRelegationPlayoff12TeamsTipo8`, `createQuadrangularRebaixamento12Teams`, `createQuadrangularRebaixamentoTipo14`;
  - `createSemiFinalsAfterPlayoffTipo14`, `createSemiFinalsAfterPlayoffTipo15`, `createPlayoffSemiTipo6`, `createRelegationQuadTipo6`;
  - `renderRelegationQuadrangularTipo5`, `createTipo5Knockout`.

  **No COSMICFUT, converter cada Tipo num `FormatDef` declarativo** (ver 7.1).

### 2.3 Copa Nacional (Copa do Brasil), classe `NationalCup`
- Há uma copa nacional **por país**: `getNationalCupByCountryId`, `initializeNationalCups` e troféus `tr_copa_<PAÍS>.png`. Confiança: Alta.
- O Brasil tem um modo "real", `brazilCopaReal = true` no `NAC:BRA`, com **potes 1–6**. Evidências:
  - `EXE#getPote1..getPote6`, `generatePot5Pool`, `generatePot6`, `fillPotFromBrazilSafe`;
  - `EXE:"Potes da Copa do Brasil"`, `EXE:"Visualização de potes disponível apenas para a Copa do Brasil."`.

  Confiança: Alta.
- Fases nomeadas: `EXE#generate16Avos`, `EXE:"16-Avos"`, `"Oitavas de Final"`, `"Quartas de Final"`, `"Semi"`, `"Final"`. Confiança: Alta.
- **Estrutura proposta, casando as 13 datas de `CAL:copa_nacional`** (confiança Média):

| Datas | Fase | Formato |
|---|---|---|
| 08/03 | 1ª fase | jogo único, mandante = pior ranqueado; pênaltis |
| 25/03 | 2ª fase | jogo único |
| 06/05 · 13/05 | 3ª fase / 16-avos (entram os clubes da Série A e os da Libertadores, pote 1) | ida e volta |
| 01/08 · 05/08 | oitavas | ida e volta |
| 26/08 · 02/09 | quartas | ida e volta |
| 08/11 · 15/11 | semifinal | ida e volta |
| 21/11 · 29/11 | reserva (o original pode usá-las para a final em I/V) | – |
| 06/12 | **final em jogo único**, campo neutro (formato real da CdB 2026) | JU, pênaltis |

  Conta: 1 + 1 + 2 + 2 + 2 + 2 + 2 (reserva) + 1 = 13.
  Alternativa equivalente: final em I/V em 21/11 e 29/11, com 06/12 sem uso. A engine deve aceitar as duas opções via `FormatDef`. **Padrão recomendado**: final em JU em 06/12.
- **Participantes no modo real** (proposta, confiança Baixa):
  - 126 clubes: os 20 da Série A, os 20 da B, os 28 da C, e os melhores dos estaduais por UF até completar;
  - potes 1–6 por ranking (reputação, depois divisão);
  - os clubes da Libertadores entram direto nos 16-avos (pote 1).
- Prêmio do campeão: `NACIONAL_CUP = 77.000.000` (`PRM`). Confiança: Alta.
- **Vaga**: o campeão vai à **Libertadores** do ano seguinte (ver 2.6) e à **Supercopa**. Confiança: Média.

### 2.4 Supercopa (`Supercopa`, por país)
- **Jogo único em campo neutro em 01/02**, entre o **campeão da liga** e o **campeão da Copa nacional** do ano anterior.
  - Se o mesmo clube ganhar os dois, a vaga vai para o **vice da Copa**. Proposta, fiel à regra real.
  - Evidências: `getSupercopaByCountry`, `initializeSupercopas`, `CAL:supercopa` (1 data), troféus `tr_supercopa_<PAÍS>.png`.
  - Confiança: Alta para a data e o formato; Média para os participantes.
- Prêmio: `SUPERCOPA = 6.000.000`. Confiança: Alta.

### 2.5 Copa do Nordeste e regionais
- **Nordeste** (`CopaDoNordeste`):
  - classificação via `qualifyNordesteTeams` e `nextSeasonNordesteTeams` (definida no fim da temporada anterior);
  - `isNordesteState`: AL, BA, CE, MA, PB, PE, PI, RN e SE;
  - tem 10 datas;
  - proposta (confiança Baixa): **16 clubes**, os melhores do estadual anterior por UF, até 2 por UF e 1 extra para BA, PE e CE;
  - 4 grupos de 4 I/V ocupam 6 datas (31/03–29/04);
  - quartas JU (20/05), semi JU (27/05) e final I/V (03/06 e 07/06);
  - 11/06 fica como reserva.
  - Alternativa: as semis em I/V usam todas as datas.
- **Copa Verde, Sul-Sudeste, Paulista, Rio, FGF, Paraná, SC, ES, Alagoas, Governo SE, Grão-Pará, Paraíba e Fares Lopes**:
  - existem no original, com classe própria, calendário e troféu;
  - evidência: `ACC`, que traz um `addChampion` para cada uma;
  - **fase 1 do COSMICFUT: não implementar**; deixar o registro preparado.
  - Participantes propostos: clubes da UF ou região **fora das Séries A e B**, pela posição no estadual. Confiança: Baixa.
- **Recopas estaduais** (Gaúcha, Catarinense, Paraibana) e Supercopa Grão-Pará:
  - jogo único entre o campeão do estadual e o campeão da copa estadual do ano anterior;
  - evidência: `ACC`, que usa `vice` como adversário.
  - Confiança: Média.

### 2.6 Libertadores (`ContinentalTournament`, `LibertadoresQualifier`, `LibertadoresConfig`)
**Estrutura** (19 datas). A contagem bate exatamente com o formato real 2+2+2+6+2+2+2+1. Confiança: **Alta**.

| Datas | Fase |
|---|---|
| 03/02 · 11/02 | 1ª fase preliminar (I/V) |
| 17/02 · 23/02 | 2ª fase preliminar (I/V) |
| 03/03 · 09/03 | 3ª fase preliminar (I/V) |
| 29/03 · 09/04 · 16/04 · 29/04 · 03/05 · 10/05 | fase de grupos: 8 grupos de 4, I/V (6 rodadas) |
| 13/08 · 20/08 | oitavas (I/V) |
| 17/09 · 25/09 | quartas (I/V) |
| 22/10 · 01/11 | semifinal (I/V) |
| 01/12 | final em jogo único, campo neutro |

**Evidências**:
- `EXE:"PRIMEIRA FASE (Preliminar)"`, `"SEGUNDA FASE (Preliminar)"`, `"TERCEIRA FASE (Preliminar)"`;
- `"1ª/2ª/3ª Rodada - Fase de Grupos"`, `"OITAVAS DE FINAL"`, `"QUARTAS DE FINAL"`;
- `EXE:" A Fase de Grupos será sorteada após a conclusão da Fase Preliminar."`.

**Repasses para a Sul-Americana**: `EXE#addLibertadoresPhase3Losers` e `EXE#addLibertadoresGroup3rdPlace`:
- os perdedores da 3ª fase preliminar vão à fase de grupos da Sul-Americana;
- os 3º colocados dos grupos vão ao play-off de oitavas da Sul-Americana.

Confiança: Alta.

**Vagas**: são calculadas no fim da temporada (`nextSeasonLibertadoresTeams`, `selectTeamsForLibertadores`, `getLibertadoresOrder`, `fillLibertadores`, `initializeLibertadoresReal`).
- `fillLibertadores` indica uma **ordem de preenchimento com repasse**: se o campeão da Copa já está classificado pela liga, a vaga desce na tabela.
- Há o rótulo `EXE:"Libertadores (3º Colocado)"` e o histórico `libertadoresChampionsHistory`.
- Confiança: Média para o mecanismo; Baixa para os números abaixo.

Proposta de alocação fiel (regra CONMEBOL 2026), em ordem de prioridade:

| País | Vagas | Ordem |
|---|---|---|
| BRA | 7 (+ campeões) | campeão da Libertadores e da Sul-Americana anteriores (grupos) → campeão da CdB (grupos) → Série A 1º–4º (grupos) → 5º (3ª fase) → 6º (2ª fase). Se houver repetição, a vaga desce na tabela da Série A. |
| ARG | 6 | campeões do Apertura e do Clausura e a tabela anual |
| demais CONMEBOL (URU, CHI, COL, EQU, PAR, PER, BOL, VEN) | 4 | os 4 primeiros da liga; os 2 primeiros vão aos grupos e os 3º e 4º às preliminares |

- Prêmio do campeão: `LIBERTADORES = 136.000.000`. Confiança: Alta.
- O campeão vai ao **Intercontinental** e ao **Supermundial** (6 vagas da CONMEBOL), além da **Recopa**.

### 2.7 Sul-Americana (`CopaSulamericana`, com enum `Stage`)
**Estrutura** (16 datas: 1+6+2+2+2+2+1). Confiança: **Alta**.

| Datas | Fase |
|---|---|
| 10/03 | fase preliminar, jogo único entre clubes do mesmo país (`EXE:"Sulamericana (Preliminar)"`) |
| 30/03 · 07/04 · 15/04 · 30/04 · 04/05 · 11/05 | grupos: 8×4 I/V |
| 07/06 · 14/06 | play-off de oitavas: 2ºs dos grupos × 3ºs da Libertadores (`EXE:"Sulamericana (Play-off de Oitavas) - Ida/Volta"`) |
| 09/09 · 16/09 | oitavas I/V: 1ºs dos grupos × vencedores do play-off |
| 01/10 · 06/10 | quartas I/V |
| 15/10 · 22/10 | semi I/V |
| 11/11 | final em jogo único, campo neutro (`"Sulamericana (Final)"`) |

- **Vagas**: proposta (confiança Baixa) de 6 do Brasil: Série A 7º–12º, mais a vaga do campeão anterior. Os demais países seguem a regra CONMEBOL. Fonte do mecanismo: `selectTeamsForSulamericana`, `nextSeasonSulamericanaTeams` e `fillSulamericana`.
- Prêmio: `SULAMERICANA = 34.000.000`. Confiança: Alta.

### 2.8 Recopa Sul-Americana (`RecopaSulamericana`)
- **Ida e volta** em 20/02 e 27/02, entre o campeão da Libertadores e o da Sul-Americana do ano anterior. Confiança: Alta.
- Evidência: `EXE:"Aviso: Campeões continentais não encontrados para Recopa em "`.
- Prêmio: `RECOPA = 12.000.000`.

### 2.9 Intercontinental (`IntercontinentalTournament`)
- 5 datas (16–29/12), mata-mata em **jogo único**, com os **6 campeões continentais** do ano. Confiança: Média. Evidências:
  - `awardIntercontinentalIntermediateTrophies`;
  - troféus `tr_derbi_america.png`, `tr_cup_africa_asia_pacifico.png`, `tr_challenger.png` e `tr_intercontinental.png`;
  - `EXE:"Copa África-Ásia-Pacífico"`, `"Copa Intercontinental FIFA"`.
- Ordem proposta, como a FIFA real:

| Data | Jogo |
|---|---|
| 16/12 | Play-off África-Ásia-Pacífico: OFC × AFC |
| 19/12 | **Dérbi das Américas**: CONCACAF × CONMEBOL (troféu intermediário) |
| 22/12 | **Copa África-Ásia-Pacífico**: CAF × vencedor de 16/12 (troféu intermediário) |
| 25/12 | **Challenger Cup**: vencedor de 19/12 × vencedor de 22/12 (troféu intermediário) |
| 29/12 | **Final**: campeão da UEFA × vencedor de 25/12 |

- Prêmio: `INTERCONTINENTAL = 27.000.000`.

### 2.10 Supermundial (`Supermundial`)
- 7 datas (21/06–15/07). Formato: **32 clubes, 8 grupos de 4** em turno único (3 datas), depois oitavas, quartas, semi e final em JU (4 datas). Confiança: **Alta**, porque a contagem bate.
- Vagas, de `EXE`:
  - `"Europa (UEFA) - 12 Vagas"`, `"América do Sul (CONMEBOL) - 6 Vagas"`;
  - `"América do Norte/Central (CONCACAF) - 4 Vagas"`, `"África (CAF) - 4 Vagas"`;
  - `"País Sede - 1 Vaga"`, `"Melhor time do País Sede ("`;
  - AFC: 4 e OFC: 1, para completar 32.

  Métodos: `selectTeamsForSupermundial` e `ensureSupermundialHostSet`. Confiança: Alta.
- Critério proposto: os campeões continentais dos 4 últimos anos e depois o ranking por reputação. Confiança: Baixa.
- **Periodicidade**: o original carrega datas todo ano. Proposta: **a cada 4 anos (2029, 2033...)**, com flag `supermundialEveryYear` para o modo fiel. Confiança: Baixa.
- Prêmio: `SUPERMUNDIAL = 223.000.000` (o maior do jogo).

### 2.11 Amistosos
- O torneio de pré-temporada é opcional, nos formatos `EXE:"2 grupos de 4, semi e final"`, `"1 grupo de 4, final"` e `"1 grupo de 6"`.
- Amistosos avulsos são marcados nas datas de `CAL:amistoso`. Há uma recusa por reputação: `EXE:"Amistoso recusado. (Reputação muito baixa para enfrentar este time)"`.
- Prêmio: `AMISTOSO = 500.000`.
- Prioridade: fase 3.

---

## 3. Brasileirão por série (e regra geral das ligas nacionais)

### 3.1 Dados do `NAC:BRA` (confiança Alta)
| Div | Clubes | formula | nGrupos | doisTurnos | nRebaixados / direto | playoffAcesso | vagasSobemPeloMataMata | Extra |
|---|---|---|---|---|---|---|---|---|
| A (1) | 20 | 0 | 0 | sim | 4 / 4 | não | 0 | `brazilCopaReal = T`, `brazilSerieDReal = T` (flags do país) |
| B (2) | 20 | 0 | 0 | sim | 4 / 4 | **sim** | **2** | `duasVoltasMataMataSobe = [f, f, f]` |
| C (3) | **28** | **3** | **2** | **não** | 4 / 4 | não | 0 | `jogosDentroGrupo = T` |
| D (4) | **96** | **6** | **16** | sim | **64 / 64** | não | 0 | – |
| 5–10 | 20 cada | 0 | 0 | sim | 4 / 4 | não | 0 | – |

- Em todas as divisões, `duasVoltasMataMata = [T × 7]`: os mata-matas da liga são em ida e volta.
- Em todas, `desempate = 0` e `positionPrizes` tem 81 zeros.

### 3.2 Regra por série (o que a engine deve fazer)

**Série A** (formula 0): pontos corridos com 20 clubes em turno e returno, nas datas 1–38 de `CAL:nacional`. Caem os **4 últimos**.
- Prêmio do campeão: `LIGA_A = 50.000.000`.
- Vagas continentais: ver 2.6 e 2.7.
- Confiança: Alta.

**Série B** (formula 0 + `playoffAcesso`): pontos corridos com 20 clubes em turno e returno.
- Sobem 4, para equilibrar os 4 que caem da A: 2 sobem direto (1º e 2º) e `vagasSobemPeloMataMata = 2` saem do **Playoff de Acesso**.
- Evidências:
  - `EXE#setPlayoffAcessoPromotionZone`, `promPlayoffZone`, `targetPromotedSpots`, `updatePlayoffAcessoInfo`;
  - `EXE:" vaga(s) no Playoff de Acesso"`, `"O Playoff de Acesso ainda não foi gerado. A fase regular deve terminar primeiro."`, `" via Playoff de Acesso)"`.
- Proposta (confiança Média): o playoff reúne do **3º ao 6º**, com **3º×6º e 4º×5º em jogo único** na casa do melhor colocado (`duasVoltasMataMataSobe` é false). Datas 39 (11/12) e 40 (14/12). Os vencedores sobem; empate vai aos pênaltis.
- Caem os 4 últimos. Prêmio: `LIGA_B = 4.000.000`.

**Série C** (formula 3, 28 clubes, 2 grupos, turno único, dentro do grupo):
- Conta de equilíbrio: 28 − 4 (caem) − 4 (sobem) + 4 (vindos da B) + 4 (vindos da D) = 28. Confiança: Alta.
- Formato proposto (confiança Baixa; não há string específica):
  - **Fase 1**: 2 grupos de 14 em turno único dentro do grupo (13 rodadas);
  - **Fase 2**: os 4 primeiros de cada grupo formam **2 quadrangulares** (A1, A4, B2, B3 / B1, B4, A2, A3) em ida e volta (6 rodadas). **Os 2 primeiros de cada quadrangular sobem**;
  - **Final**: os líderes dos quadrangulares, em ida e volta;
  - **Rebaixamento**: os 2 últimos de cada grupo da fase 1, pois `rebaixamentoGeral = false`.
  - Datas: 13 + 6 + 2 = 21 de 40.
- Prêmio: `LIGA_C = 3.000.000`.

**Série D** (formula 6, 96 clubes, 16 grupos de 6, turno e returno):
- Fase de grupos: 10 rodadas.
- **Os 4 primeiros de cada grupo (64)** passam ao mata-mata em ida e volta: "64-avos", com 64 clubes (`EXE:"64-avos de Final"`); depois 16-avos, oitavas e quartas.
- **Os 4 vencedores das quartas sobem.** Depois vêm semi e final, só pelo título.
- Datas: 10 + 2×6 = 22.
- Confiança: Média, pelo formato real de 2026 e pela string "64-avos".
- `nRebaixados = 64`. O original roda o modo **"Série D Real"**:
  - evidências: `brazilSerieDReal`, `EXE#generateSerieDReal`, `applySerieDRealMode`, `lockedBySerieDReal`, `EXE:" times selecionados para a Série D."`, `EXE:" times selecionados, cortando para 96"`, `"[Série D Real] AVISO: "`;
  - a cada ano a D é **remontada**:
    - 4 clubes rebaixados da C;
    - 28 "mantidos" (96 − 4 que sobem − 64 que saem);
    - **64 vindos dos estaduais** (os melhores colocados de cada UF que ainda não estão em A–D).
  - Os 64 que "caem" voltam a disputar só o estadual.
  - Confiança: Média, pela conta exata e pelas strings.
- Prêmio: `LIGA_D = 1.000.000`.

**Divisões 5–10**: no original são ligas fictícias de 20 clubes em pontos corridos, com 4 descendo e 4 subindo.
- No Brasil real não existem. Com a regra Série D Real, os clubes "sem divisão" vêm dos estaduais.
- **Recomendação COSMICFUT**: no Brasil, **não criar divisões 5–10**. Clubes sem A–D jogam só o estadual e entram na D pela regra acima.
- Confiança: Média.

### 3.3 Repartição das vagas da Série D por UF (modo real; proposta, confiança Baixa)
- Cada UF recebe vagas proporcionais ao número de clubes no estadual da 1ª divisão. Mínimo de 2 vagas e máximo de 4 (SP, RJ, MG, RS).
- Distribuir 64 vagas pela ordem do estadual, pulando quem já está em A, B ou C.
- Se faltar clube na UF, a vaga passa para a UF com mais clubes disponíveis.

### 3.4 Outros países
- **formula 0**: pontos corridos, com `doisTurnos` ligado ou não.
  - Rebaixa `nRebaixados`; sobem da divisão de baixo os mesmos `nRebaixados` da divisão de cima.
  - Na prática, o pipeline já faz `min(nRebaixados, ...)`. Revisar: a regra correta é **sobem(i+1) = caem(i)**, sem o corte por `teams/2` no Brasil D→5.
  - EUA d1 (30 clubes, `doisTurnos = false`) é turno único.
  - Confiança: Alta.
- **playoffAcesso** (só BRA d2 tem `true`): os `vagasSobemPeloMataMata` lugares saem de um mata-mata entre as posições seguintes às de acesso direto. Pernas conforme `duasVoltasMataMataSobe[]`. Confiança: Média.
- **playoffRebaixamento** e `duasVoltasplayoffReb[]`: a regra é a mesma, para o rebaixamento. Nenhuma liga nacional usa; os estaduais usam (ver 2.2). Confiança: Alta.
- **Apertura/Clausura** (`aperturaClausura = T`):
  - Duas competições na mesma divisão: Apertura no `CAL:apertura` (até 26/07) e Clausura no `CAL:clausura` (29/07–13/12), com o mesmo grupo de clubes. **Cada uma tem campeão próprio** (`addChampion(apName ...)`, `addChampion(clName ...)`, `ACC` linhas 12558, 12579, 14790, 14812).
  - Há ainda um **campeão do ano** (`addChampion(compName ...)`): é a **Finalíssima** entre os campeões do Apertura e do Clausura (`EXE:"FINALÍSSIMA NÃO NECESSÁRIA / AGUARDANDO"`). Se o mesmo clube vencer os dois, não há jogo.
  - O **rebaixamento** usa a **tabela somada** das duas fases (`pickBestSeasonByPositionAndSide` fica para o time do ano; ver 4.8).
  - Nome da 2ª fase: `nomeClausura`, por exemplo "1ª divisão (C)".
  - Confiança: Alta para a existência dos 3 campeões; Média para a tabela somada.
- **URU d1**: 16 clubes, formula 0. Apertura em turno único (15 rodadas) e Clausura em turno único (15 rodadas). Caem 4. Confiança: Média.
- **ARG d1** (30 clubes, formula 4, nGrupos 2, AC):
  - Em cada torneio: **2 zonas de 15** em turno único dentro da zona (14 rodadas, mais 1 "rodada interzonal de clássicos", opcional).
  - Os **8 primeiros de cada zona** passam ao mata-mata cruzado (A1×B8...): oitavas, quartas, semi e final.
  - Pernas por `duasVoltasMataMata = [f, T, T, T, T, T, T]`: **oitavas em jogo único**, as demais em ida e volta.
  - Ressalva: a ordem do array (da 1ª fase para a final) é uma inferência.
  - Datas: 14 + 1 + 2 + 2 + 2 = 21 > 20. **Proposta**: semi e final em jogo único (14 + 1 + 1 + 1 + 1 = 18), ou sem a rodada interzonal (14 + 1 + 2 + 2 + 1 = 20).
  - Caem 2, pela **tabela anual** (promédio simplificado = pontos somados).
  - Confiança: Média.
- **Copas nacionais e supercopas dos outros países**: o mesmo modelo de `NationalCup` e `Supercopa`, em mata-mata de jogo único por potência de 2, com o calendário `copa_nacional` compartilhado. Confiança: Média.

---

## 4. Virada de temporada

### 4.1 Sequência do original (nomes de método, `EXE`)
1. `processMidYearAdvance`, na pausa de junho: renovações de meio de ano da CPU (`processMidYearCpuContracts`, `EXE:"Finalizando renovações de meio de ano..."`) e janela de transferências.
2. Fim das competições:
   - `finishChampionship` / `processChampions` / `addChampion` / `addTournamentChampion` / `trackContinentalChampion`;
   - `awardLeagueTrophies` (`EXE:"DEBUG awardLeagueTrophies: processing active country: "`);
   - `leaguePrizesAwardedYear`.
3. **Pós-temporada** (`postSeasonTriggered`, `processPostSeasonEvents`, `EXE:"DEBUG: Forwarding to CEREMONY screen and processing events"`). É a **Cerimônia FIFA The Best**:
   - prêmios: Melhor Jogador, Melhor Sub-21, Puskás, Luva de Ouro (goleiro), Artilheiro, Clube do Ano e Melhor Técnico;
   - votação do humano: `EXE:"Selecione o jogador que você considera o Melhor do Mundo:"`;
   - Time do Ano.
4. `processYearEndAdvance` / `finalizeSeason` / `recordCurrentSeasonHistory` / `createYearlyBackup`.
5. `handlePromotionRelegation` → `applyDirectPromotionRelegation`, `applyStatePromotionRelegation`, `generateSerieDReal`, `updateDivisions`.
6. `updateContinentalQualifiers` / `setupQualifiers`: as vagas do ano seguinte, `nextSeason*Teams`, já foram fixadas.
7. `processYearlyContracts` (`EXE:"Fazendo transição de ano e renovando contratos..."`):
   - jogadores com contrato vencido saem (`EXE:" ficou sem contrato e está na lista de jogadores livres."`);
   - aviso ao humano: `EXE:" jogadores sem contrato sairão do time! Deseja continuar?"`.
8. `applyYearEndBonus` (`EXE:"Evolução de fim de ano: Jogadores ganharam bônus de força!"`), `runCpuRetirements`, `handlePlayerRetirement` e envelhecimento.
9. `startNewSeason` / `resetSeason` / `generateSeasonFixtures` / `initialize*` (copas, continentais, Nordeste, supercopas).

Confiança: Alta para a existência e os nomes de cada etapa; Média para a ordem exata.

### 4.2 Acesso e rebaixamento
- **Ligas nacionais**: `relegated(i) = promoted(i+1)`.
  - O conjunto que sobe = acesso direto + vencedores do playoff de acesso.
  - O conjunto que desce = últimos colocados, mais os do playoff ou quadrangular de rebaixamento, quando houver.
- **Brasil**: as séries A–C seguem o 3.2. A D é remontada pelo modo Série D Real.
- **Estaduais**: o mesmo, por UF. Os promovidos da última divisão saem do pool "sem divisão" da UF, ou de nenhum lugar se o pool não existir.
- **Atenção à ordem**: o campeão e o vice ficam no histórico **antes** de mover os clubes.
- Confiança: Alta.

### 4.3 Envelhecimento e evolução
**Evidências**:
- `applyMonthlyEvolution` (`EXE:"Os jogadores evoluíram seus atributos neste mês!"`): a evolução é **mensal**;
- `applyYearEndBonus`: bônus de fim de ano;
- `advanceAllPlayersStatus`;
- **treino** (uma vez por ano, `EXE:"Você já realizou o treino da equipe neste ano."`). Efeitos por jogador:
  - `"Treinou bem (+1 Força)"`;
  - `"Notamos uma piora nas habilidades (-2 Força)"`;
  - `"Você descobriu a posição ideal do jogador (+10 Força)"`;
  - `"Ficou decepcionado por trocar de posição (-10 Força)"`.

  Confiança: Alta.

A escala do original é a "Força". No COSMICFUT é o `overall`, de 0 a 99.

**Proposta de números** (confiança Baixa), calibrada para casar com `ageAdjust` e `growthGap` do pipeline:
- **Mensal** (12×/ano), com Δ por jogador = `crescimento(idade, gap) + ruído`, em que `gap = potential − overall`:
  - até 21 anos: `+gap × 0,035` por mês, mais 0,25 se jogou ≥ 50% dos jogos do mês;
  - de 22 a 25: `+gap × 0,03` por mês;
  - de 26 a 29 (**pico**): Δ ≈ 0, com ruído de ±0,15;
  - de 30 a 31: −0,08 por mês;
  - de 32 a 33: −0,17 por mês;
  - 34+: −0,30 por mês.
  - Arredondar no fim do ano; o `overall` exibido é inteiro.
- **Fim de ano**: bônus de +1 para jogadores ≤ 23 anos com ≥ 20 jogos, e de +1 para "destaque da temporada" (média ≥ 7,0).
- **Potencial**:
  - aos 24 anos fica igual a `max(potential, overall)`;
  - antes disso, ±2 por ano (ruído), com teto de 99.
- **Idade**: +1 em 01/01. Confiança: Média, porque o ano do jogo vira em 01/01.

### 4.4 Aposentadoria
**Evidências** (confiança Alta):
- O humano só pode aposentar jogadores com **33 anos ou mais**: `EXE:" ainda não tem idade para se aposentar (Mínimo 33 anos)."`, `canRetire`.
- **Cada aposentadoria gera um júnior**:
  - `EXE:"Jogador aposentado!\nNovo jogador promovido aos Juniores: "`;
  - `EXE:" se aposentou.\nUm novo jogador ("`, `") foi adicionado aos juniores."`;
  - `EXE:"Ele deixará o elenco principal e um novo jovem da base subirá aos juniores."`.
- A CPU aposenta por conta própria (`shouldCpuRetire`, `runCpuRetirements`) na virada do ano.

**Proposta de probabilidade anual** para a CPU e para jogadores do humano sem decisão manual (confiança Baixa):
- 33: 10%; 34: 20%; 35: 35%; 36: 55%; 37: 75%; 38+: 95%;
- +15 pontos percentuais se `overall < 55` ou se jogou menos de 10 jogos;
- −10 pontos percentuais se `overall ≥ 80`;
- goleiros: idade efetiva = idade − 2.

### 4.5 Juniores e regens
**Evidências** (confiança Alta):
- A academia de juniores (`YouthAcademyDialog`, `getYouthSquad`, `setJuniores`, `getNumeroTitularesJuniores`) tem **limite de 20 jogadores** (`EXE:"Sua academia de juniores está cheia (limite de 20 jogadores)!"`, `"Capacidade da academia excedida (Máx 20)"`).
- **Promoção ao profissional só a partir dos 15 anos** (`EXE:"Precisa completar 15 anos para ser promovido!"`, `getNextAgeForPromotion`, `promoteYouthPlayer`, `EXE:" promovido ao profissional!"`).
- Elenco profissional: **máximo de 52 jogadores** (`EXE:"Seu elenco está cheio (limite de 52 jogadores)!"`).
- **Peneira de Talentos**: uma vez por ano (`EXE:"Você já realizou uma peneira este ano."`). Os níveis de custo ficam junto à peneira no executável:

| Nível | Custo |
|---|---|
| Local | grátis |
| Estadual | R$ 1M |
| Nacional | R$ 7,5M |
| Global | R$ 20M |

  Há resultados em "Peneira A/B" e `makeOfferToYouthPlayer` (oferta aos achados). Um júnior dispensado pode "desistir do futebol" ou ir para outro clube: `EXE:" desistiu do futebol."`, `" não desistiu e foi para o "`.
- Outra escala de custo aparece perto de `YouthAcademyDialog`/`TrainingDialog`:

| Nível | Custo |
|---|---|
| Municipal | R$ 100 mil |
| Intermunicipal | R$ 500 mil |
| Regional | R$ 750 mil |
| Interestadual | R$ 5M |
| Internacional | R$ 10M |
| Intercontinental | R$ 15M |

  É provavelmente o **nível de investimento do treino ou da base** (`EXE:"Escolha o nível de investimento:"`). Confiança: Baixa quanto ao uso exato.

**Geração de regen** (proposta, confiança Baixa nos números):
- **Nome**:
  - `names/<NAC>.txt` + `surnames/<NAC>.txt` da nacionalidade do clube; linhas repetidas valem como peso (nota 06);
  - 8% de chance de nacionalidade estrangeira da mesma confederação;
  - **no Brasil**, 35% de chance de **apelido de nome único**, usando só o nome ou o sobrenome (estilo do original).
- **Idade**: 15–17 (júnior).
- **Posição**: cobre a posição mais carente do elenco.
- **Overall inicial**: `squadTarget(nível, rep) − 22 ± 6`.
- **Potencial**: `overall + growthGap(idade) + N(0, 5)`.
  - 2% de chance de "**Promessa Mundial**" (`EXE:"Promessa Mundial"`), com potencial de 88–95.
- **Quando gerar**:
  - 1 júnior para **cada aposentadoria** (regra do original);
  - +2 por ano por clube, até o limite de 20;
  - peneira manual do humano: 3–6 candidatos conforme o nível.

### 4.6 Contratos e renovação
**Evidências** (confiança Alta):
- `generateDefaultContractExpiration`: a data de fim padrão fica no **meio do ano** (`EXE:"Contrato até: 15/08/2026"`, aparentemente dd/MM do fim da janela).
- `isContractRenewalDate`, `checkContractWarnings` (`EXE:" vence em 1 mês. Considere renovar!"`).
- Opção `autoRenewContracts` (`OPT autoRenewContracts=false`) e `contractWarningMode` (`OPT contractWarningMode=0`).
- Durações oferecidas: `"6 meses"`, `"2 anos"`, `"3 anos"` (há também 1 ano), e `EXE:" assinou com seu time por 2 anos."`.
- A CPU renova no meio e no fim do ano (`processCpuPlayerContractRenewals`, `processMidYearCpuContracts`, `processYearlyContracts`).
- Não é possível renovar contrato de jogador emprestado (`EXE:"Não é possível renovar contrato de jogador emprestado"`). O limite de jogadores emprestados é 12.
- O salário é pedido pelo jogador (`EXE:"O salário não foi aceito.\nO jogador quer um salário de:"`, `calculateSalaryByReputation`).

**Proposta**:
- Os contratos vencem em **30/06 ou 31/12**.
- A CPU renova 75% dos titulares com menos de 31 anos e 40% dos demais.
- Quem não renova vira **agente livre** no dia seguinte.

### 4.7 Finanças na virada
- `getInitialMoneyForDivision` é usado **só no início do jogo**. O caixa **não é zerado** na virada. Confiança: Média.
- O livro-caixa anual (`FinanceManager`, com campos `revenueTickets`, `revenueSponsors`, `revenuePrizes`, `revenueSales`, `addRevenueTV`, `expenseSalaries`, `expensePurchases`, `expenseStadium`, `expenseLuvas`, `expenseLoanInterest`, `expenseTerminationFine`) é **zerado** e arquivado no histórico. Confiança: Média.
- O **patrocínio** é recalculado pela **nova divisão** (`getSponsorshipForDivision`). Confiança: Média.

### 4.8 Histórico
Estruturas serializadas (confiança Alta):
- `GameData$CompetitionHistory`, `GameData$Trophy`, `GameData$TeamOfYearEntry`;
- `clubOfYearHistory`, `teamOfYearHistory`, `libertadoresChampionsHistory` e históricos das demais confederações (`uefaChampionsHistory`...);
- `StateSeasonRecord`, `getStateStandingsHistory`;
- `TeamHistoryItem`, `CoachHistoryItem`, `PlayerInfo$CareerHistoryEntry`, `PlayerInfo$CompetitionStats`;
- `headToHeadHistory` (confronto direto histórico), `TransferEvent` (`EXE:"10 Maiores Transferências da História"`).

Telas: "Histórico de Campeões", "Maior Campeão", "Campeão Atual", "Ranking por Títulos/Pontos", "Ranking por Reputação", "Recorde do Clube".

Registro mínimo por competição e ano:
```
{ competitionId, season, championId, viceId, topScorer: { playerId, goals }, coachName }
```
É o que recebe `addChampion(nome, ano, campeão, vice, artilheiro, técnico, ...)`.

---

## 5. Economia fiel

### 5.1 Premiações (`PRM`, só para o **campeão**; confiança Alta)
| Chave | Valor (R$) | Competição |
|---|---|---|
| SUPERMUNDIAL | 223.000.000 | Supermundial |
| LIBERTADORES | 136.000.000 | Libertadores |
| NACIONAL_CUP | 77.000.000 | Copa do Brasil e copas nacionais |
| LIGA_A | 50.000.000 | Série A (divisão 1) |
| SULAMERICANA | 34.000.000 | Sul-Americana |
| INTERCONTINENTAL | 27.000.000 | Intercontinental |
| RECOPA | 12.000.000 | Recopa Sul-Americana |
| SUPERCOPA | 6.000.000 | Supercopa nacional |
| ESTADUAL | 5.000.000 | Estaduais (qualquer UF e divisão) |
| LIGA_B | 4.000.000 | Série B |
| LIGA_C | 3.000.000 | Série C |
| LIGA_D | 1.000.000 | Série D |
| AMISTOSO | 500.000 | Torneio amistoso |

- **Prêmio por colocação**:
  - o campo `positionPrizes[81]` de `ConfigLigaType` está todo em "0";
  - existe a tela `LeaguePrizesDialog` (`EXE:"Configurar Premiação por Colocação"`, `"Prêmio Campeão:"`, `"Prêmio Vice-Campeão:"`);
  - **o padrão do original é pagar só o campeão**; a premiação por colocação é configurável.
  - **Recomendação**: pagar só o campeão no modo fiel. A `leaguePrize` atual da engine, que é proporcional, fica como modo "moderno" opcional.
  - Confiança: Alta.
- Há `applyChampionBonus` e `applyNonChampionPenalty`: bônus para quem é campeão e penalidade para quem não é. Provavelmente atuam sobre a **reputação** ou a confiança. Confiança: Baixa.

### 5.2 Caixa inicial e patrocínio (`VAL`; confiança Alta)
| Divisão | Caixa inicial | Patrocínio (anual) |
|---|---|---|
| 1 | 15.000.000 | 6.000.000 |
| 2 | 12.000.000 | 4.500.000 |
| 3 | 10.000.000 | 2.500.000 |
| 4 | 3.500.000 | 2.000.000 |
| sem divisão / 5+ | 2.000.000 | 1.000.000 |

- O patrocínio aparece na projeção anual como `"Patrocínio/Sócio torcedor"`. Proposta: pagar em 12 parcelas mensais, como a engine já faz.
- A divisão usada é a **divisão nacional** do clube. Clubes só de estadual usam `default`.

### 5.3 Bilheteria, ingresso e estádio
**Evidências**:
- `calculateTicketIncome`, `revenueTickets`, tela `EXE:"-PREÇO DOS INGRESSOS-"` e opção `EXE:"Usar sempre os preços sugeridos"`: **o humano define o preço, e existe um preço sugerido**. Confiança: Alta.
- `Stadium`, com capacidade (`" - Capacidade Total: "`).
- Expansão: `EXE:"Digite a quantidade de lugares para expandir (Custo aprox: 1 milhão/1000 lugares):"`, ou seja, **R$ 1.000 por lugar**. Confiança: Alta.
- **Manutenção mensal** (`"Manutenção mensal: R$ "`, `expenseStadium`).
- **Gramado** (`EXE:"Escolha o Gramado do Estádio"`, `assignPitchTypesByReputation`).

**Proposta de fórmula** (confiança Baixa):
- `precoSugerido = base[div] × (1 + 0,15 × (rep − 2,5))`, com base de R$ 60 / 40 / 25 / 15 / 10 nas divisões 1 a 4 e no default.
- `publico = capacidade × min(1, demanda)`, em que:
  - `demanda = 0,35 + 0,1 × rep + 0,15 × moralTorcida + 0,1 × importanciaJogo − 0,5 × max(0, preco/precoSugerido − 1)`;
  - a importância do jogo é 1 em final ou clássico e 0 em jogo comum;
  - o termo de preço é a elasticidade.
- `renda = publico × preco`, só para o mandante; em jogo neutro, 50/50.
- `manutencao = capacidade × R$ 1,5 por mês`.

### 5.4 Outras receitas e despesas
- **TV**: `addRevenueTV` existe e não há valor no disco. Manter `ECONOMY.tvPerSeason` atual. Confiança: Média para a existência.
- **Empréstimo bancário**:
  - juros de **5% ao mês** (`EXE:"Juros mensais (5%): "`);
  - toma-se e paga-se em blocos de **R$ 500 mil** (`"Pegar 500 mil"`, `"Pagar 500 mil"`);
  - o teto depende da reputação (`getMaxLoanForReputation`).
  - Proposta de teto: `2M × (rep + 1)`.
  - Confiança: Alta para os juros e o bloco.
- **Salários**: mensais por padrão; há a opção semanal `isSalaryWeekly`. Confiança: Alta.
- **Multa rescisória de jogador**: `"Multa estimada deste jogador: "`, `expenseTerminationFine`. Proposta: salários restantes até o fim do contrato.

### 5.5 Luvas (`LuvaDebt`)
**O que é** (confiança Alta):
- **Luva de assinatura** pedida pelo **empresário** ao contratar um jogador, típica de jogador livre ou em fim de contrato;
- `EXE:"O empresário do jogador "` … `" pediu uma Luva de assinatura.\n\nValor da Luva (80% do passe): "`.
- O valor é **80% do valor de mercado ("passe")**.
- Pagamento à vista ou **parcelado** (`EXE:"\n\nComo deseja pagar a Luva?"`). Cada parcelamento vira um `LuvaDebt` na lista `luvaDebts` do clube.
- O débito é cobrado mensalmente (`processMonthlyLuvas`, `getMonthlyLuvas`, `expenseLuvas`).
- Pode ser quitado antes: `payOffLuvaForPlayer`, `"Quitar Luva"`, `"Detalhes de Luvas"`, `"Parcelas Res."`.

**Modelo proposto**:
```
LuvaDebt { playerId, total, monthly, remainingInstallments }
```
- Opções de parcelamento: 6 ou 12 parcelas, sem juros. Confiança: Baixa.
- Se o jogador sair do clube, a dívida **continua**. Confiança: Baixa.

### 5.6 Torcida, estrela e craque
**Flags por jogador**: `estrela`, `craque`, `topWorld` (`isEstrela`, `isCraque`, `isTopWorld`, `setTopMundial`, ícones `estrela.png` e `craque.png`, `"Top Mundial"`, `"Promessa Mundial"`). Confiança: Alta.

**Reação da torcida** (confiança Alta):
- `EXE:"Os torcedores estão em festa pela chegada de um craque!"`;
- `EXE:"A torcida ficou animada com a contratação de uma estrela!"`;
- `EXE:"A torcida não gostou da venda de uma estrela do time!"`.

Proposta de efeito na `confiancaTorcida` (confiança Baixa nos números):

| Evento | Efeito |
|---|---|
| Contratar craque | +8 |
| Contratar estrela | +5 |
| Vender estrela | −6 |
| Vender craque | −10 |

**Moral**: `morale` existe na engine. No original, a força é afetada pelo "ritmo" (`RhythmRenderer`) e pela energia. Mantém-se o modelo atual.

---

## 6. Carreira do técnico

### 6.1 Modelo do original
Campos do técnico (`Coach`, `EXE`): `pontosReputacao`, `estabilidade`, `contratoAnos`, `confiancaDiretoria`, `confiancaTorcida`, `nacionalidade`, `CoachHistoryItem`. Telas: "Perfil do Técnico" e "Ranking de Técnicos". Confiança: Alta.

**Estabilidade** (0–100%) define a demissão. Confiança: Alta para os limiares.
- `checkAutoFire` / `checkForAutoFire` / `updateCpuCoachesStability`.
- Técnico da CPU: `EXE:" demitiu seu técnico devido à baixa estabilidade ("`.
- Humano:
  - `EXE:"A confiança da Diretoria caiu para "`, `"A confiança da Torcida caiu para "`;
  - demissão: `EXE:"%). O clube decidiu encerrar o seu contrato e pagará a multa rescisória."` ou `EXE:"%). A diretoria cedeu à pressão popular e encerrou o seu contrato com o pagamento da multa."`;
  - **Demissão pela diretoria ou pela torcida: o clube paga a multa ao técnico.**
- **Limiares** (Alta):
  - acima de **79%**, outro técnico não consegue pressionar (`EXE:"O técnico está com muita estabilidade (Acima de 79%)."`);
  - abaixo de **43%**, o técnico está "prestes a cair" (`EXE:"O técnico já está prestes a cair (Abaixo de 43%)."`).
- **Pedir demissão**: o técnico **paga** multa de **6 meses de salário** (`EXE:"Multa de rescisão (6 meses): R$ "`, `"Você pediu demissão e pagou a multa rescisória."`).
  - Também existe **acordo mútuo**, sem multa, que depende da estabilidade (`EXE:"Deseja pedir demissão por acordo mútuo?\n(Sem multa de rescisão - Estabilidade em "`).
  - Proposta: o acordo é permitido com estabilidade ≤ 43%.

### 6.2 Propostas e vagas (`JobOffer`, `JobsCenterScreen`, `PendingJobApplication`)
**Fluxo do original** (confiança Alta para o fluxo):
- **Convites**: `checkForJobInvitations` / `generateJobOffers` / `activeJobOffers`, tela "Convites para ser técnico", `acceptJobOffer`, `clearJobOffers`.
  - A oferta mostra elenco, divisão, contrato e **estabilidade** do clube.
  - `JobOfferDialog` mostra `"Duração: 1 ano"`: a proposta padrão é de 1 ano.
- **Central de empregos**: lista clubes **e seleções** (`"Assumir Seleção"`) que buscam técnico (`EXE:"(Você pode se candidatar a assumir times ou seleções da lista que buscam novos técnicos)"`). Há colunas de estabilidade e contrato.
- **Candidatura por e-mail** (`addJobApplication`, `checkForPendingJobApplications`):
  - `EXE:"Recebemos seu e-mail de interesse ... resposta definitiva em breve (7 dias)."`: **resposta em 7 dias**;
  - aprovação: `EXE:"Parabéns! Você foi o escolhido para treinar nosso time!"`;
  - recusa: `"Sentimos muito! Mas já escolhemos um novo treinador para nosso time."`.
- **Declarar interesse publicamente** num clube que já tem técnico:
  - a estabilidade do técnico atual **cai drasticamente** (`EXE:"Seu interesse foi recebido e aumentou a pressão sobre o técnico atual!"`);
  - a ação bloqueia nova declaração por **6 meses** (`"Aguarde 6 meses desde o seu último interesse"`);
  - se o técnico atual tiver **status muito maior** que o seu, a diretoria fica com ele (`"Vamos permanecer com o atual treinador."`);
  - se a pressão funcionar: `EXE:"A diretoria demitiu o técnico sob pressão ... Deseja assumir o ..."`.
- **Trocar de clube**: assumir um novo clube enquanto empregado exige **pagar a multa** (`EXE:"Deseja pagar a multa e assumir o novo time?"`). Não se pode voltar a um clube deixado há **menos de 30 dias** (`EXE:"Você deixou este time há menos de 30 dias."`).
- **Mercado de técnicos da CPU**: `processMonthlyCoachHiring`, `hireCoachForTeam`, `unemployedCoaches`, `"Técnicos Livres"`, `"Últimas trocas de técnicos"`, `generateRandomCoachName`.

### 6.3 Reputação do técnico
- Existe `calculateCoachRankings` e `getTopRankedCoachOfSeason`, com os componentes `EXE:"Pontos de Vitórias/Empates"` e `EXE:"Pontos de Títulos (Piso)"`.
- O prêmio é `"Melhor Técnico do Mundo (The Best)"`.
- Confiança: Alta para os componentes; Baixa para os pesos.
- **Proposta**:
  - `pontosReputacao += 3 × vitórias + 1 × empates` (por jogo oficial), multiplicado pelo fator da divisão (D1 1,0; D2 0,6; D3 0,4; D4 0,25; estadual 0,3; continental 1,5);
  - `+ título × prêmioDaCompetição / 1M`, com piso de 5 pontos por título ("Piso");
  - decaimento anual de 15%.
- **Ofertas**: clube com `reputação ≤ reputaçãoTécnico + 0,5` aceita ou convida. Proposta: `repTec = clamp(pontos / 400, 0, 5)`.

### 6.4 Estabilidade: proposta de dinâmica (confiança Baixa)
- Início: 60%.
- Por jogo:
  - vitória: +2 (+3 se for clássico ou mata-mata);
  - empate: 0 em casa, +0,5 fora;
  - derrota: −3 (−5 em casa contra time de reputação menor);
  - eliminação em copa: −6.
- Por expectativa: no fim do turno, se a posição for pior que a esperada pela reputação: `−2 × (posição − esperada)`. A expectativa é o ranking de reputação do clube dentro da divisão.
- Títulos: +25. Acesso: +20. Rebaixamento: −40, com demissão garantida para a CPU.
- **Demissão automática**:
  - humano: se `estabilidade < 20%` após uma rodada, ou se a confiança da diretoria for < 15%;
  - CPU: probabilidade semanal = `max(0, 43 − est) / 100`.
  - Não há demissão nas 5 primeiras rodadas após assumir.

---

## 7. Prioridades de implementação

### 7.1 Fase 1: estaduais, Copa Nacional, séries com acesso e rebaixamento, virada de temporada

**Engine (`packages/engine`)**

1. **Modelo declarativo de formato** (`season/format.ts`, novo):
   ```ts
   type Legs = 1 | 2;
   type TieRule = { legs: Legs; penalties: true; awayGoals?: false; neutral?: boolean; homeSecondLegToBetter?: boolean };
   type Advance = { top?: number; perGroup?: number; bestThirds?: number; directToSemi?: number; toPlayoffSemi?: number;
                    toRelegationGroup?: number | { perGroup: number }; toSecondaryCup?: 'losersQF' | number };
   type StageDef =
     | { id: string; kind: 'table'; groups: number; crossGroups?: boolean; legs: Legs; partialRounds?: number; advance: Advance }
     | { id: string; kind: 'knockout'; rounds: { name: string; tie: TieRule }[]; seeding: 'table' | 'cross' | 'draw' | 'pots'; thirdPlace?: TieRule }
     | { id: string; kind: 'relegationGroup' | 'relegationPlayoff'; legs: Legs; relegated: number }
     | { id: string; kind: 'secondaryCup'; name: string; from: 'losersQF' | 'bestNonQualified'; rounds: StageDef[] };
   interface FormatDef { id: string; stages: StageDef[]; championFrom: string; relegation: 'table' | 'overall' | 'stage'; calendarId: string }
   ```
   - `Fixture` (contract): adicionar `stageId`, `group?`, `leg?: 1 | 2`, `tieId?`, `knockout?: boolean`, `neutral?: boolean` e `label?` (para "Taça Rio", "Torneio Forró"...).
   - `Competition.type`: ampliar para `'league' | 'cup' | 'state' | 'continental' | 'supercup'`, e adicionar `format: FormatDef`, `stageState`, `championId?`, `viceId?`, `relegatedIds?`, `promotedIds?`.
   - Funções novas:
     - `buildStage(comp, stageDef, clubs, rng)`;
     - `isStageFinished(comp, stageId)`;
     - `progressCompetition(comp, rng)`: é o `checkProgression()` do original, chamado em `advanceDay` depois dos jogos;
     - `resolveTie(fixtures, rule)`: soma o agregado e vai aos pênaltis;
     - `stageStandings(comp, stageId, group?)`;
     - `overallStandings(comp)`, que inclui os mata-matas, como no original;
     - `competitionChampion(comp)`.
   - O motor de partida já suporta `knockout`. É preciso garantir que o pênalti seja disputado no **2º jogo** de um confronto em I/V quando o agregado empatar. Isso exige passar à partida o placar agregado (`MatchConfig.aggregate`).
2. **Calendário multi-competição** (`season/calendar.ts`):
   - `assignDates(comp, calendarDates)` consome as datas em ordem por fase ou rodada;
   - `buildYearCalendar(registry, calendars, season)`;
   - detecção de conflito: o clube tem jogo em duas competições no mesmo dia. Política: prioridade continental > copa > liga > estadual, e o jogo de menor prioridade vai para a próxima data livre (o original pode simplesmente não colidir; logar).
3. **Ligas especiais**:
   - `formula 0` com `playoffAcesso` (Série B);
   - `formula 3` (Série C);
   - `formula 6` (Série D, grupos + 64-avos);
   - `formula 4` + `aperturaClausura` (ARG);
   - `aperturaClausura` em formula 0 (URU).
   - Implementar como `FormatDef` gerados por `nationalFormat(cfg)`.
   - Suportar ligas com **mais de 40 clubes** em grupos (BRA-4 = 96).
4. **Virada de temporada** (`season/rollover.ts`):
   ```ts
   endSeason(state, world, rng): SeasonSummary  // campeões, vices, artilheiros, rebaixados, promovidos, qualificados
   applyPromotionRelegation(world, summary)     // nacionais + estaduais + Série D Real
   ageAndEvolve(players, stats, rng)            // mensal: applyMonthlyEvolution; anual: applyYearEndBonus, +1 idade
   retirePlayers(world, rng) -> Retirement[]    // ≥33; gera 1 júnior por aposentadoria
   generateYouth(club, namePools, rng, n)       // names/ surnames/ por nacionalidade
   expireContracts(world, date) -> FreeAgent[]
   rolloverFinance(state)                       // arquiva ledger, recalcula patrocínio pela nova divisão
   recordHistory(world, summary)                // CompetitionHistory, Trophy, TeamOfYear
   startNewSeason(world, calendars, rng): SeasonState
   ```
   - Novo `WorldState` persistível, acima de `SeasonState`. Guarda divisões atuais por país e UF, histórico, juniores, contratos e as vagas do ano seguinte. Hoje a temporada é descartável e não tem continuidade.
5. **Economia fiel**:
   - `PrizeTable` vinda de `economy.json.prizes`, paga **só ao campeão**, mantendo `leaguePrize` proporcional como opção;
   - caixa inicial e patrocínio por divisão;
   - `ticketRevenue` com `preco` e `precoSugerido`;
   - `LuvaDebt` (5.5);
   - empréstimo bancário com 5% ao mês.

**Pipeline (`packages/data`)**
1. **`formats/estaduais.json`**: converter os 14 `N_Times.txt` (≈60 tipos) para `FormatDef`.
   - Fazer à mão, uma vez, com testes de contagem de jogos.
   - O parser automático do texto é frágil, pois tem typos como `Semi: Ida]`, `(3 Grupos de 4]` e `Somente: Ida`.
   - Gerar a chave `"<n>_<tipo>"`.
2. **`states.json`**: incluir por divisão `formatKey`, `relegated` (`nRebaixados`), `relegatedDirect`, `relegationPlayoff` (`playoffRebaixamento`), `relegationOverall` (`rebaixamentoGeral`) e `promotedFromBelow`.
3. **`leagues.json`**: incluir todos os campos de `ConfigLigaType`:
   - `formula`, `nGrupos`, `jogosDentroGrupo`, `classificaPeloGeral`, `melhoresTerceiros`, `numeroTimesMataMata`;
   - `playoffAcesso`, `vagasSobemPeloMataMata`, `playoffRebaixamento`, `rebaixadoPeloGrupo`, `rebaixamentoGeral`;
   - `duasVoltasMataMata[]`, `duasVoltasMataMataSobe[]`, `duasVoltasplayoffReb[]`;
   - `aperturaClausura`, `nomeClausura`, `desempate`, `positionPrizes`;
   - e, no nível do país, `brazilCopaReal` e `brazilSerieDReal`.
   - **Corrigir `relegated` e `promoted`** para `promoted(i+1) = relegated(i)`, sem o corte por `teams/2` quando a divisão tem grupos. Também **não gerar BRA-5..10**, ou marcá-las `fictional: true`.
4. **`competitions.json`** (registro novo):
   ```
   { id, kind, countryId|uf|confed, calendarId, formatKey, prizeKey, trophy, qualification: QualRule }
   ```
   Cobre CdB, Supercopa, Nordeste, Libertadores, Sul-Americana, Recopa, Intercontinental e Supermundial (e as regionais, desligadas).
5. **Vínculo clube → UF** para a Série D Real e o Nordeste (já existe `club.state`), e **ranking inicial do estadual**, pela ordem de força, para a primeira temporada.

Ordem sugerida dentro da fase 1:
1. formato e mata-mata;
2. Copa do Brasil;
3. estaduais SP, RJ, MG e RS, e depois o resto;
4. Séries B, C e D;
5. virada de temporada;
6. economia.

### 7.2 Fase 2: continentais
**Engine**:
- `qualifyContinental(world, summary): Record<compId, clubId[]>`, com a ordem de preenchimento e o repasse (`fillLibertadores`).
- Repasses Libertadores → Sul-Americana (`phase3Losers`, `group3rd`).
- Sorteio com potes e restrição de país (`drawGroups(pots, constraints, rng)`).
- Recopa, Supercopa, Intercontinental (com troféus intermediários) e Supermundial (32 clubes, flag de periodicidade).
- Simular os campeonatos de **outros países** só o necessário para gerar classificados: rodar `quickSimulate` das ligas estrangeiras na virada. Isso evita ter 37 países "ao vivo".

**Pipeline**:
- `continental-slots.json` com as vagas por país e confederação (tabela 2.6/2.7) e as vagas do Supermundial (12/6/4/4/4/1/1).
- Calendários das outras confederações (já existem).

### 7.3 Fase 3: carreira do técnico
**Engine** (`career/`):
```ts
interface Coach { id; name; nationality; reputationPoints; stability; boardConfidence; fanConfidence; contract: { clubId; until; wage }; history: CoachHistoryItem[] }
interface JobOffer { clubId|nationalTeamId; wage; years: 1; stability; createdAt; expiresAt }
updateStability(coach, matchResult, expectation)
checkAutoFire(coach, club) -> FireEvent | null
generateJobOffers(world, coach, rng)
applyForJob(coach, clubId)      // resposta em 7 dias
declareInterest(coach, clubId)  // −estabilidade do técnico atual; bloqueio de 6 meses
resign(coach, mutual)           // multa de 6 meses ou acordo mútuo
coachRankings(world)            // pontos de vitórias/empates + títulos (piso)
```
- Técnicos da CPU: `processMonthlyCoachHiring` e um pool de desempregados.
- Prêmios de fim de ano (The Best), Clube do Ano e Time do Ano.

**UI**: Central de Empregos, Caixa de e-mails do escritório, Perfil e Ranking de Técnicos.

---

## 8. Lacunas e decisões em aberto
1. **Série C (formula 3)**: não há string que descreva a 2ª fase. A proposta de 3.2 é Baixa. Validar com uma partida no original, observando a tela de classificação da Série C.
2. **Copa do Brasil**: o uso das 13 datas e a final em jogo único ou em ida e volta. A proposta de 2.3 é Média ou Baixa.
3. **Copa do Nordeste**: o número de clubes e o formato são Baixa.
4. **Supermundial**: anual no original? Os dados carregam datas todo ano.
5. **Ordem do array `duasVoltasMataMata`**: vai da 1ª fase para a final, ou o contrário?
6. **SP d5** (`FMT:24/T1`): pula as quartas (oitavas → semi). Provável erro de digitação do arquivo; implementar oitavas → quartas → semi → final.
7. **Critérios de desempate exatos**: `desempate = 0` sem tabela de significados.
8. **Escala de custos "Municipal…Intercontinental"**: confirmar o que ela compra (treino ou base).
9. Pontos do ranking de técnicos e a dinâmica de estabilidade: os números ficam para calibrar.

Quem tiver o jogo original pode confirmar 1–5 em uma temporada simulada. As demais lacunas se resolvem com calibração.
