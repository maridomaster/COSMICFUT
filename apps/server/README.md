# @cosmicfut/server — modo online

Servidor **autoritativo** do COSMICFUT (Fastify + Socket.io). Ele guarda a `SeasonState` de cada sala, avança os dias com a engine e roda as partidas humanas ao vivo. O cliente só manda intenções (escalação, pronto, comandos de partida) e nunca envia resultados.

- Protocolo canônico: `packages/shared/src/net.ts`. As extensões do servidor estão em `src/protocol.ts`.
- A engine (`packages/engine`) roda direto em TypeScript, com o *type stripping* nativo do Node, sem build. O `src/node-hooks.ts` resolve os imports sem extensão.

## Rodar localmente

Requer Node ≥ 23.6. O projeto foi desenvolvido no Node 26.

```bash
# na raiz do monorepo
npm run server          # dev com --watch (porta 8787)
npm run server:test     # testes (vitest + socket.io-client)

# ou dentro de apps/server
npm run start           # sem watch
npm run typecheck
```

Teste de saúde: `curl http://localhost:8787/health`.

### Variáveis de ambiente

| Variável | Padrão | O que faz |
|---|---|---|
| `PORT` | `8787` | Porta HTTP/WebSocket. |
| `HOST` | `0.0.0.0` | Interface de escuta. |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Origens liberadas, separadas por vírgula. `*` libera todas. |
| `WEB_DIST` | `apps/web/dist` | Build do front servido pelo servidor (`off` desliga). |
| `DATA_DIR` | `apps/web/public/data` | JSON do jogo (`clubs-index`, `clubs/`, `leagues`, `calendars`, `economy`). |
| `PERSIST_DIR` | `apps/server/.data` | Snapshot JSON por sala (`<CODE>.json` + resumo `<CODE>.meta.json`). **Precisa ficar num volume persistente** (as carreiras online salvas vivem aqui). Use `PERSIST=0` para desligar. |
| `LOBBY_TTL_MS` (ou `ROOM_TTL_MS`) | `21600000` (6 h) | Só uma sala **ainda no lobby** e sem ninguém conectado é apagada depois desse tempo. Carreira com a temporada iniciada **nunca expira** (só o host a encerra). |
| `ROOM_UNLOAD_MS` | `600000` (10 min) | Carreira sem ninguém conectado sai da memória depois disso (fica no disco e volta ao abrir o código / a lista). |
| `MAX_BACKUP_MB` | `30` | Tamanho máximo do arquivo em `POST /rooms/restore`. |
| `PUBLIC_URL` | — | URL pública fixa (convites). Sem ela, lê `PUBLIC_URL_FILE`. |
| `PUBLIC_URL_FILE` | `<raiz>/.data/public-url.txt` | Arquivo com a URL do túnel (escrito pelo lançador). |
| `DISCONNECT_GRACE_MS` | `60000` | Depois desse tempo, o clube de um jogador desconectado passa para a IA. |
| `HALF_TIME_TIMEOUT_MS` | `30000` | O intervalo espera os humanos por, no máximo, esse tempo. |
| `PAUSE_TIMEOUT_MS` | `60000` | Duração máxima de uma pausa combinada. |
| `LOG` | `1` | Use `0` para silenciar o logger do Fastify. |
| `SIM_WORKERS` | min(4, núcleos − 1) | worker_threads da simulação da carreira. `0` = inline no thread principal (só para depurar: trava o event loop). |
| `SEASON_END_TIMEOUT_MS` | `180000` | Fim de temporada: espera as renovações por até esse tempo e roda a virada. |
| `DEV_COMMANDS` | — | `1` habilita `dev:advance` (host avança rápido simulando também os jogos humanos). |
| `PLANNING_GRACE_MS` | `20000` | Quem cai/recarrega a página: a rodada espera por ele até isso (limitado a `DISCONNECT_GRACE_MS`). `RoomPlayer.graceUntil` mostra o prazo. |
| `PREMATCH_MS` | `8000` | Pré-jogo: `match:preview` (confronto + escalações + `startsAt`) vai isso antes do `match:start`. `0` desliga. |

### Mercado online (13/11)

Eventos `market:offer | contract | respond | withdraw | list | release` (ver `packages/shared/src/net.ts`), só na fase `planning`. O servidor valida janela, saldo e dono e roda a API de transferências da engine no worker. Depois de cada ação que muda o estado, a sala recebe **`market:update`** (patch gzip com `state.market` + clubes envolvidos + notícias novas, ≈ 20 KB contra ≈ 430 KB do `season:snapshot` do estado); o snapshot completo da sala (rejoin/disco) é atualizado sem broadcast. Proposta por jogador de **outro humano** fica `pending` no clube dele até o fim do planejamento (sem resposta: recusada).

### Testar sozinho com bots

```bash
cd apps/server
npm run start                                                   # terminal 1
node scripts/bot.ts --create --start-when 2 --speed 50          # terminal 2: cria a sala e imprime o código
node scripts/bot.ts --code ABC234                               # terminal 3: entra, escolhe um clube e marca pronto
```

Opções do bot: `--url`, `--nick`, `--club <id>`, `--country 29`, `--speed <ms/minuto>` e `--rounds <n>`. Com `--rounds`, o bot sai depois de n rodadas.

O bot escolhe um clube livre e marca **pronto** em toda rodada. No intervalo, ele confirma a volta. Também dá para criar uma sala pela UI e completar com bots.

Os bots rodam direto da raiz, sem `--import` (registram o resolvedor de `.ts` da engine no próprio script): `node apps/server/scripts/bot.ts …`, `node apps/server/scripts/bot-pvp.ts --code X` — ou `npm run bot` / `npm run bot:pvp -- --code X` em `apps/server`. O `bot-pvp` responde sozinho às propostas de humanos pelos jogadores dele: aceita se o valor ≥ valor de mercado × `--accept-ratio` (padrão 1; `0` recusa todas).

## Como jogar com amigos

Um único processo e um único túnel: o servidor também serve o front (`apps/web/dist`).

1. Na raiz do monorepo: `npm run play`. Isso faz o build do web e sobe o servidor em `http://localhost:8787`, sem watch.
2. Em outro terminal: `cloudflared tunnel --url http://localhost:8787` (ou `npm run play:tunnel`). Alternativa: `ngrok http 8787`.
3. Copie a URL `https://….trycloudflare.com` (ou a do ngrok) e abra no navegador. Crie a sala e envie o **link de convite** aos amigos. O WebSocket funciona pelo túnel.

Notas:
- O front usa a mesma origem da página como servidor, então não precisa de `VITE_SERVER_URL` nem de `CORS_ORIGINS`. No `npm run dev` (Vite em `:5173`) o padrão continua `http://localhost:8787`.
- `WEB_DIST` muda a pasta do build (`WEB_DIST=off` desliga o front). Sem o build, só a API/Socket.io fica ativa.
- Rotas do app (`/online/ABCDEF`) devolvem o `index.html`. `/data/*.json` tem cache de 5 min, `/assets/` com hash tem cache de 1 ano e `index.html` não é cacheado.
- O `cloudflared` não é instalado pelo projeto. Instale-o à parte (`winget install Cloudflare.cloudflared`).
- A URL do túnel rápido muda a cada execução; mande o novo link se reiniciar.
## Deploy (Fly.io ou Railway)

O estado das salas fica **em memória**, com snapshot em disco. Por isso, rode **uma única instância** e monte um volume em `/data`. Sem volume, as salas se perdem a cada deploy.

O `Dockerfile` é construído a partir da **raiz** do monorepo, porque precisa da engine, do shared e dos JSON de `apps/web/public/data`:

```bash
docker build -f apps/server/Dockerfile -t cosmicfut-server .
docker run -p 8787:8787 -v cosmicfut-data:/data -e CORS_ORIGINS=http://localhost:5173 cosmicfut-server
```

Com BuildKit, o `apps/server/Dockerfile.dockerignore` é aplicado automaticamente e deixa fora do contexto `node_modules`, `dist`, `.data` e `apps/web/public/assets` (o `players-market.json` vai junto: o simulador precisa dele).

### VPS (Hostinger ou outro) — carreira online salva

- **Volume persistente obrigatório em `/data`** (`PERSIST_DIR=/data`, já é o padrão da imagem). É lá que ficam as carreiras (`<CODE>.json`, `<CODE>.meta.json`). Sem volume, todas as carreiras somem no próximo deploy.
- Uma instância só (estado em memória + disco). Reiniciar é seguro: as carreiras voltam do disco paradas e só andam quando alguém entra.
- `docker run -d --restart unless-stopped -p 8787:8787 -v /srv/cosmicfut/data:/data -e CORS_ORIGINS=https://seu-dominio -e PUBLIC_URL=https://seu-dominio cosmicfut-server`
- O front: a imagem só tem a API/Socket.io. Para um processo só, gere `apps/web/dist` no host (`npm run build`) e monte com `-v /srv/cosmicfut/web:/app/apps/web/dist:ro` (o servidor serve o build e as rotas do SPA); ou sirva o `dist` por um Nginx na frente com proxy de `/socket.io`, `/rooms`, `/careers`, `/health`, `/public-url` para a porta 8787 (WebSocket com `Upgrade`).
- Saúde: `GET /health` (`rooms` em memória, `careersOnDisk`, `players`, `persist`).
- Backup extra: o host pode baixar o `.json.gz` da carreira em "Carreira e sala"; para o servidor todo, copie a pasta do volume.

### Fly.io

```toml
# fly.toml (na raiz; deploy com: fly deploy --dockerfile apps/server/Dockerfile)
app = "cosmicfut-server"
primary_region = "gru"

[env]
  CORS_ORIGINS = "https://seu-front.example"

[http_service]
  internal_port = 8787
  force_https = true
  auto_stop_machines = "off"   # salas vivem em memória: não deixe a máquina dormir no meio da rodada
  min_machines_running = 1

[[mounts]]
  source = "cosmicfut_data"
  destination = "/data"
```

Antes do primeiro deploy, crie o volume com `fly volumes create cosmicfut_data --region gru --size 1`. Mantenha `fly scale count 1`.

### Railway

1. Crie um serviço a partir do repositório. Em **Settings → Build**, use o Dockerfile `apps/server/Dockerfile` com o *root directory* na raiz do repositório.
2. Adicione um **Volume** montado em `/data`.
3. Defina `CORS_ORIGINS`. A `PORT` é injetada pelo próprio Railway.
4. Configure **1 réplica**. O health check fica em `/health`.

## Arquitetura

```
src/
  start.ts         entrada: registra node-hooks e importa main
  main.ts          lê env, sobe o servidor, SIGINT/SIGTERM salvam as salas
  server.ts        Fastify (/health, /rooms/:code) + Socket.io (handlers, anti-flood, acks)
  room.ts          sala: jogadores, lobby, carreira (metadados + snapshot gzip), rodada, matchday, fim de temporada/virada, reconexão
  live-match.ts    partida ao vivo (MatchSimulation + ticks + intervalo/pausa)
  match-config.ts  config pública da partida (relacionados + regras do mata-mata) e dados da fixture
  career-data.ts   CareerData, players-market, bundles dos humanos, names/, regra de clube jogável
  sim-core.ts      CareerSimulator: dono de world/state por sala (createCareer, advanceDay inPlace, season-end, nextSeason, migrateCareer, pack gzip)
  sim-worker.ts    worker_threads que roda o CareerSimulator
  sim-pool.ts      pool de workers (sala presa a um worker; recria e reidrata se o worker morrer) ou modo inline
  validate.ts      validação de payloads (tipos, tamanhos, ids do elenco)
  persist.ts       snapshot JSON por sala (debounce + rename atômico)
  data.ts          leitura dos JSON do jogo (cache)
  protocol.ts      extensões do protocolo
scripts/bot.ts     cliente de linha de comando
scripts/measure-career.ts  tempos/tamanhos da carreira (dias, pack gzip, virada)
scripts/bench-online.ts    último ready→match:start e atraso do event loop (--workers 0|N)
test/              vitest (lobby, carreira, Copa ida/volta, PvP mata-mata, virada, rejoin, persistência/migração, determinismo)
```

### Fluxo de uma sala

1. **`lobby`**
   - `room:create` ou `room:join` devolve `{ playerId, token }`. Guarde o token, porque ele é a credencial de reconexão.
   - Cada jogador usa `room:pick-club`. O clube precisa ser do país de `settings.countryId`, ser jogável na carreira (divisão nacional real ou, no Brasil, qualquer estadual) e não pode ser repetido.
   - O host chama `room:start`: `createCareer` (no worker) com os clubes humanos.
2. **`planning`**: cada jogador usa `round:set-lineup` e depois `round:ready { ready: true }`.
3. Quando todos os humanos **conectados** estão prontos, a sala entra em **`simulating`**.
   - O worker roda `advanceDay(state, worldSquads(world, base), {}, { inPlace })` até o próximo dia com jogo de um humano PRESENTE (qualquer competição). Jogos de humanos ausentes são simulados (quickSimulate).
   - Ele envia um `round:results` para cada dia que teve jogos.
4. **`matchday`**
   - O `season:snapshot` do dia chega logo depois (JSON+gzip binário; o mundo só vai no início, na virada e no rejoin/`season:sync`).
   - Cada partida com humano roda ao vivo, com `match:start` (config com `fixtureMatchRules`: mata-mata, agregado, pênaltis sem prorrogação), `match:tick` a cada `matchSpeedMs` e `match:end` (com `aggregate`/`advancing`).
   - A sala inteira recebe `match:info`, com o placar resumido de todas as partidas.
   - No intervalo, o servidor envia `match:pause`. A partida espera `match:resume` dos humanos conectados ou o timeout.
5. Quando as partidas terminam:
   - o servidor roda `advanceDay` com `playedResults`;
   - envia `round:results` do dia e um `season:snapshot`;
   - volta para `planning`. Se a temporada acabou (`seasonOver`), vai para `season-end`.
6. **`season-end`**: `season:end` (stage `review`) com campeões, acesso/rebaixamento, classificados e contratos vencendo. Cada humano manda `season:renew { renew: { id: { wage, years } | true } }`. Com todos prontos (ou no timeout) o worker roda `nextSeason` (pools de `careerNamePoolCodes`), envia `season:end` (stage `done`, resumo completo) e o snapshot com o mundo novo; volta a `planning`. Quem não mandar renovações (ou só marcar pronto) renova automaticamente os jogadores com menos de 33 anos, aceitando o pedido.

**Reconexão:** `room:rejoin { code, token }` devolve `room:state` e `season:snapshot`. Se houver partida em andamento, também devolve `match:start` com o estado atual e `match:pause`, se ela estiver pausada.

**Persistência:** v2 = metadados + `world`/`state` em JSON+gzip (base64) + escalações; ao carregar, o worker chama `migrateCareer`. Salas v1 (temporada antiga) voltam ao lobby com os mesmos jogadores e clubes (log). A partida em andamento não é salva. Depois de um reinício, a sala volta ao `planning` do mesmo dia. Como a engine é determinística, a rodada é refeita.
