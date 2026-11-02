# 🎟️ Porto Bilhetes Bot

Bot de Telegram que te avisa quando o FC Porto põe bilhetes à venda, com o link do anúncio e o link direto para a bilheteira.

**Dois tipos de aviso:**
- 🚨 **JÁ À VENDA**: quando o clube "dropa" os bilhetes sem aviso prévio (ex.: um jogo novo aparece na bilheteira).
- 📅 **A venda abre quarta, 4/11 às 10h00**: quando o clube anuncia antes. O bot lê o dia e a hora no anúncio (título, tweet ou corpo da notícia) e manda-te **lembretes 30 min antes e no minuto em que abre**.

**Fontes vigiadas** (de 2 em 2 minutos):

| Fonte | O que deteta |
|---|---|
| Twitter/X @FCPorto *(opcional)* | Posts do clube que falem de bilhetes (ou tenham 🎟️) |
| bilhetes.fcporto.pt | Jogos/eventos novos que aparecem na bilheteira oficial |
| fcporto.pt | Notícias novas do clube que falem de bilhetes |
| Google News | Notícias da A Bola, Record, O Jogo, etc. sobre abertura de vendas |

Tudo gratuito: **Vercel** (corre o código) + **Upstash Redis** (memória do bot) + **cron-job.org** (acorda o bot de 2 em 2 min).

> **Sobre o Twitter:** é a única fonte que custa dinheiro (a API do X deixou de ter plano gratuito para contas novas). É opcional: o bot funciona sem ela e liga-a sozinho se puseres a variável `X_BEARER_TOKEN`. Vê a secção "Ativar o Twitter/X" mais abaixo.

> **Porque o cron-job.org?** No plano gratuito do Vercel, o cron interno só pode correr 1 vez por dia. O `vercel.json` mantém essa execução diária como reserva, e o cron-job.org trata dos 2 em 2 minutos.

---

## Instalação (≈ 15 minutos)

### 1. Criar o bot no Telegram
1. No Telegram, abre o **@BotFather** e manda `/newbot`.
2. Dá-lhe um nome (ex.: *Porto Bilhetes*) e um username acabado em `bot` (ex.: `calix_porto_bilhetes_bot`).
3. Guarda o **token** que ele te dá (algo como `7123456789:AAF...`).

### 2. Pôr o código no GitHub
1. Cria um repositório novo no GitHub (pode ser privado), por exemplo `porto-bilhetes-bot`.
2. Envia esta pasta para lá:
   ```bash
   cd porto-bilhetes-bot
   git init && git add . && git commit -m "bot bilhetes FC Porto"
   git branch -M main
   git remote add origin https://github.com/<o-teu-user>/porto-bilhetes-bot.git
   git push -u origin main
   ```

### 3. Criar o projeto no Vercel
Podes ter vários projetos na mesma conta gratuita, por isso o teu projeto atual fica intocado.
1. Em vercel.com → **Add New… → Project** → importa o repositório `porto-bilhetes-bot`.
2. Framework Preset: **Other**. Não mudes mais nada e carrega em **Deploy**.

### 4. Ligar a base de dados (Upstash Redis)
1. No projeto novo → separador **Storage** → **Create Database** → escolhe **Upstash for Redis** (plano Free).
2. Liga-a ao projeto (**Connect**). O Vercel cria sozinho as variáveis com o URL e o token.

### 5. Variáveis de ambiente
No projeto → **Settings → Environment Variables**, adiciona:

| Nome | Valor |
|---|---|
| `TELEGRAM_BOT_TOKEN` | o token do BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | uma palavra-passe aleatória (só letras, números, `_` e `-`) |
| `CRON_SECRET` | outra palavra-passe aleatória, diferente |
| `ADMIN_CHAT_ID` | *(opcional)* o teu chat ID, para receberes avisos se uma fonte avariar (vês no passo 7) |
| `X_BEARER_TOKEN` | *(opcional)* ativa o Twitter/X, vê a secção "Ativar o Twitter/X" |
| `ALLOWED_CHAT_IDS` | *(opcional)* IDs separados por vírgula, se quiseres que só tu e os teus amigos se possam inscrever |

Para gerar palavras-passe: `openssl rand -hex 24` (ou escreve uma sequência longa qualquer).

Depois vai a **Deployments → ⋯ → Redeploy** para as variáveis entrarem em vigor.

### 6. Ligar o Telegram ao Vercel
Abre no browser (troca pelos teus valores):
```
https://<o-teu-projeto>.vercel.app/api/setup?key=<CRON_SECRET>
```
Deves ver `"ok": true` e o nome do teu bot.

### 7. Inscrever-te
Abre o bot no Telegram e manda `/start`. Ele responde com o teu **chat ID**. Se quiseres os avisos de avaria, mete esse número em `ADMIN_CHAT_ID` e faz redeploy.

O teu amigo (ou quem quiseres) só tem de abrir o bot e mandar `/start` também.

### 8. Pô-lo a correr de 2 em 2 minutos
1. Cria conta grátis em **cron-job.org** → **Create cronjob**.
2. URL: `https://<o-teu-projeto>.vercel.app/api/check?key=<CRON_SECRET>`
3. Execution schedule: **Every 2 minutes**. Guarda.
4. Carrega em **Test run**: a resposta deve ser um JSON com `"sources"` e as três fontes com `"ok": true`.

**Pronto!** Na primeira execução o bot só memoriza o que já existe (não te enche de mensagens). A partir daí, só avisa o que for novo.

---

## Ativar o Twitter/X (opcional)

1. Vai a **console.x.com** (developer console do X) e entra com a tua conta do X.
2. Cria uma **App** e copia o **Bearer Token** dela.
3. Em **Billing**, carrega créditos (pagamento por uso, pré-pago). Começa com pouco, tipo 5 $: quando o saldo acaba, os pedidos simplesmente falham, por isso **não há contas-surpresa**.
4. No Vercel, adiciona `X_BEARER_TOKEN` com o Bearer Token e faz **Redeploy**.
5. Manda `/estado` ao bot: deve aparecer "Twitter/X oficial" com ✅.

**Quanto custa:** o X cobra por cada post devolvido (0,005 $ por post, segundo a tabela atual). O bot pede só os posts *publicados depois do último que já viu* e ignora retweets e respostas, por isso pagas apenas pelos posts novos do @FCPorto. Uma verificação sem posts novos não devolve nada. Com 20 a 40 posts por dia dá à volta de **3 a 6 $ por mês**. Confirma os preços na developer console, porque o X muda-os com frequência.

Se os créditos acabarem, o `/estado` mostra "sem créditos" e o admin recebe aviso; as outras fontes continuam a funcionar.

**Alternativa grátis:** na app do X, abre o perfil do @FCPorto, carrega no 🔔 e escolhe "Todos os posts". Recebes notificação de tudo o que publicam (não só bilhetes) e só se tiveres as notificações do X ligadas no telemóvel.

## Comandos do bot
- `/start`: ativar os avisos
- `/parar`: desativar
- `/vendas`: próximas aberturas de venda já anunciadas
- `/estado`: ver se cada fonte está a funcionar e quando foi a última verificação
- `/teste`: receber um aviso de exemplo
- `/ajuda`: lista de comandos

## Testar no teu PC (opcional)
Precisas de Node.js 20 ou mais recente. Não há dependências para instalar.
```bash
npm test         # testa a lógica com dados simulados
npm run dry-run  # lê as fontes reais e mostra o que o bot apanharia agora (não envia nada)
```
O `dry-run` é a melhor forma de confirmar que os sites do Porto estão a ser lidos bem.

## Personalizar
Está tudo em `lib/config.js`:
- `SOURCES`: adicionar ou tirar fontes (qualquer página ou feed RSS).
- `NEWS_QUERY`: a pesquisa feita no Google News.
- `TICKET_WORDS`, `SALE_WORDS`, `NEGATIVE_WORDS`: as palavras que decidem o que é relevante.
- `REMIND_BEFORE_MIN`: quantos minutos antes da abertura chega o lembrete (30 por defeito).

## Proteções incluídas
- **Sem duplicados**: a mesma notícia em vários jornais conta como uma só (fontes oficiais avisam sempre).
- **Anti-spam**: se a bilheteira mostrar de repente muitos links novos (ex.: o site mudou de layout), o bot não te bombardeia; guarda-os e avisa só o admin.
- **Avarias**: se uma fonte falhar 30 vezes seguidas (~1 hora), o admin recebe um aviso. As outras fontes continuam a funcionar.
- **Segurança**: `/api/check` e `/api/setup` só respondem com o `CRON_SECRET`; o webhook do Telegram só aceita pedidos com o `TELEGRAM_WEBHOOK_SECRET`.

## Limitações a ter em conta
- Se a bilheteira oficial for montada por JavaScript, a leitura direta pode vir vazia. Nesse caso o `/estado` mostra "0 itens" nessa fonte, mas o site do clube e as notícias continuam a cobrir os anúncios. Corre o `npm run dry-run` para veres.
- A hora da venda é lida do texto ("amanhã a partir das 10h00", "desta sexta-feira, pelas 17h00", "06/11 às 10:00"...). O bot distingue a hora da venda da hora do jogo, mas se um anúncio for muito ambíguo pode não apanhar a hora. Nesse caso diz "hora não indicada" e manda o link para veres.
- Os sites podem mudar de estrutura com o tempo; se uma fonte deixar de apanhar coisas, é em `lib/config.js` que se ajusta.

## Custos
Zero nos planos gratuitos (o Twitter/X, se o ativares, é à parte: ver acima). A 2 minutos são ~21 600 verificações por mês: dentro dos limites do Vercel Hobby e dos 500 mil comandos mensais do Upstash Free.
