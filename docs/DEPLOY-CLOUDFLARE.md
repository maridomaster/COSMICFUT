# COSMICFUT online grátis — GitHub Pages + Cloudflare

O jogo fica no **GitHub Pages** (site estático) e o modo online usa um **relay na Cloudflare** (Worker + Durable
Objects, plano gratuito). A simulação da carreira **não roda na Cloudflare**: roda no navegador de um dos técnicos (o
"anfitrião da simulação"). O relay só autentica, repassa mensagens e guarda o ponto salvo da carreira.

Custo: **R$ 0**. Não precisa de cartão de crédito.

---

## 1. Criar a conta na Cloudflare (uma vez)

1. Acesse <https://dash.cloudflare.com/sign-up> e crie a conta (e-mail + senha). Confirme o e-mail.
2. Não precisa cadastrar domínio nem cartão. O plano **Free** já inclui Workers e Durable Objects (SQLite).

## 2. Publicar o relay (no terminal, na pasta do projeto)

```powershell
cd "E:\PROJETOS CLAUDE\COSMICFUT"
npm install
npx wrangler login          # abre o navegador: clique em "Allow" para autorizar o wrangler
npm run edge:deploy         # publica o Worker "cosmicfut-edge"
```

No fim, o `edge:deploy` mostra o endereço, algo como:

```
https://cosmicfut-edge.SEU-SUBDOMINIO.workers.dev
```

- Na primeira vez a Cloudflare pode pedir para escolher o subdomínio `*.workers.dev` (é só um nome; aceite o sugerido).
- Teste: abra `https://cosmicfut-edge.SEU-SUBDOMINIO.workers.dev/health` → `{"ok":true,"edge":true,...}`.
- Nenhum ID de conta ou token fica no repositório (o `wrangler login` guarda a sessão só no seu computador).

**Opcional (recomendado):** restringir quem pode usar o relay ao seu site. Em `apps/edge/wrangler.toml`:

```toml
[vars]
ALLOWED_ORIGINS = "https://maridomaster.github.io"
```

e rode `npm run edge:deploy` de novo. (Vazio = qualquer origem.)

## 3. Ligar o GitHub Pages

No GitHub, no repositório **maridomaster/COSMICFUT**:

1. **Settings → Pages → Build and deployment → Source:** escolha **GitHub Actions**.
2. **Settings → Secrets and variables → Actions → aba Variables → New repository variable:**
   - Nome: `EDGE_URL`
   - Valor: `wss://cosmicfut-edge.SEU-SUBDOMINIO.workers.dev` (o endereço do passo 2, trocando `https://` por `wss://`)
3. (Opcional) Variável `PAGES_BASE`: só se usar domínio próprio (aí o valor é `/`). Sem ela, o site fica em
   `https://maridomaster.github.io/COSMICFUT/`.
4. Faça um push na `main` (ou **Actions → GitHub Pages → Run workflow**). Em ~3–5 min o site está no ar em
   **https://maridomaster.github.io/COSMICFUT/**.

O workflow (`.github/workflows/pages.yml`) roda `npm ci`, gera o site com `VITE_ONLINE_BACKEND=cloudflare`,
copia `index.html` para `404.html` (links como `/COSMICFUT/online/CODIGO` funcionam) e publica com
`actions/deploy-pages`. Os dados (`/data`) e escudos (`/assets`, ~100 MB) vão junto — o limite do Pages é 1 GB.

## 4. Jogar

1. Abra o site, **Online com amigos**, crie a sala e mande o link (botão **Copiar link**).
2. Quem cria a sala vira o **anfitrião da simulação** — aparece no canto: *"Você é o anfitrião da simulação (não feche a
   aba durante a rodada)"*. A aba precisa ficar aberta enquanto vocês jogam (pode ficar em segundo plano).
3. Se o anfitrião fechar a aba ou cair, em ~3 s outro técnico conectado assume sozinho: ele carrega o último ponto salvo
   e, se a rodada estava no meio, **rejoga o dia** (os outros veem *"Retomando…"*).
4. Quando todos saem, a carreira fica guardada na Cloudflare para sempre (só salas ainda no lobby expiram, em 6 h).
   Para continuar: **Minhas carreiras online → Continuar**.

---

## Desenvolvimento local (sem conta, sem login)

```powershell
npm run edge:dev                                  # relay local (wrangler dev / workerd) em http://127.0.0.1:8788
npm run dev:edge --workspace @cosmicfut/web       # Vite em http://localhost:5183 apontando para o relay local
```

Para simular vários jogadores no mesmo computador use origens diferentes (cada uma tem seu próprio "navegador" de
carreiras): `http://a.localhost:5183`, `http://b.localhost:5183`…

Testes:

```powershell
npm run edge:test                                       # relay (unidade) + integração em processo
$env:BUDGET='1'; npx vitest run test/budget.test.ts     # (em packages/online-core) orçamento de requisições, ~2 min
$env:EDGE_URL='http://127.0.0.1:8788'; npx vitest run test/live-edge.test.ts   # contra o wrangler dev rodando
```

O servidor Node (`npm run play`, VPS, túnel) continua funcionando igual — ele usa a mesma sala
(`packages/online-core`). O backend do web é escolhido no build: `VITE_ONLINE_BACKEND=server` (padrão) ou `cloudflare`.

## Limites do plano gratuito (resumo)

| Recurso | Limite Free | Uso estimado |
|---|---|---|
| Requisições a Durable Objects | 100 mil/dia (mensagens WebSocket recebidas contam; a documentação de preços fala em 20 recebidas = 1 requisição — as contas aqui usam o pior caso, 1 = 1) | 6 técnicos, noite de 3 h: ~5–20 mil mensagens (pior caso medido com bots: ~60 mil) |
| CPU por mensagem | 10 ms | relay: 0,02–1,5 ms (só lê cabeçalhos) |
| Armazenamento | 5 GB | ~0,6–1,5 MB por carreira |
| Workers (HTTP) | 100 mil/dia | lista de salas, criar sala, status das carreiras |

Detalhes, arquitetura e números medidos: nota Obsidian *43 - Online Grátis (GitHub Pages + Cloudflare)*.
