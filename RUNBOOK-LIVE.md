# Runbook da Live — 20 minutos

Script minuto a minuto. Deixe esta página aberta numa aba fora da tela compartilhada.

As URLs já são as definitivas. O Loki exige `-u "$LOKI_USER:$LOKI_PASS"`; exporte as
duas variáveis no terminal da aba 4 antes de começar.

## Setup de tela

| Aba | Conteúdo | Papel |
|---|---|---|
| 1 | **Loja** — `https://hostmaster.fagnerlopes.dev` | palco principal, Atos 1 e 3 |
| 2 | Telegram (chat com o Hermes) | onde a descoberta acontece |
| 3 | Grafana Explore — `https://grafana.hostmaster.fagnerlopes.dev` | prova visual de que o log está no Loki |
| 4 | Terminal | botões de pânico |
| 5 | **Painel** — `https://hostmaster.fagnerlopes.dev/dashboard` | só se precisar dos controles |

Abas 4 e 5 nunca aparecem, a menos que algo dê errado.

**Faça login no painel (aba 5) ANTES de começar.** A sessão dura 12h. Descobrir que
ela expirou no meio da talk custa caro, e a tela de login no telão não ajuda a
narrativa.

> ⚠️ **Não abra o `<details>` "Controles de demo" com a tela compartilhada.** Ele
> mostra os botões de forçar falha — e conta para a plateia que a falha é encenada.
> Ele nasce fechado; deixe fechado. Se precisar forçar algo, use a aba 4.

## T-15min — antes de subir

```bash
API_URL=https://api.hostmaster.fagnerlopes.dev WEB_URL=https://hostmaster.fagnerlopes.dev \
LOKI_URL=https://loki.hostmaster.fagnerlopes.dev GRAFANA_URL=https://grafana.hostmaster.fagnerlopes.dev \
LOKI_USER=hermes LOKI_PASS="$LOKI_PASS" \
ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" ./scripts/smoke.sh \
  && API_URL=https://api.hostmaster.fagnerlopes.dev ./scripts/reset-demo.sh
```

`0 falharam` é o critério. Os "pulados" (contagem de containers e Promtail) são
esperados de fora da VPS.

As duas coisas precisam sair verdes. `reset-demo.sh` garante `failureRate=0.5`, `crashed=false`, `health=200` — o baseline sem o qual a narrativa não funciona.

Depois disso, **não rode mais nada com `failureRate` alterado.**

## T+0 → T+4 — abertura

Contexto: um e-commerce em produção numa VPS. Painel administrativo aberto, produtos, tudo normal.

Ponto a fixar antes de clicar em qualquer coisa: **a aplicação não sabe que o Hermes existe.** Ela só escreve log JSON em arquivo. Nenhum webhook, nenhum alerta, nenhum cron. É isso que faz a observabilidade ser agnóstica.

## T+4 → T+8 — Ato 1: a falha aparece

1. Clique em **Comprar Monitor 240Hz IPS**
2. Clique em mais 2 ou 3 produtos

Uma dessas vai retornar 500 — toast vermelho com **"Não foi possível concluir o
pagamento"** e um **código de referência**. É o que um cliente real veria: a loja não
mostra o motivo técnico. Esse motivo (`payment_gateway_timeout`) é justamente o que o
Hermes vai descobrir no Ato 2.

> **Se der uma sequência longa de sucessos:** não vai dar. O `CHECKOUT_MAX_SUCCESS_STREAK=3` força a falha no 4º clique seguido. Se ainda assim quiser garantir o timing, rode na aba 4 antes de clicar:
> ```bash
> curl -X POST https://api.hostmaster.fagnerlopes.dev/v2/config -H 'content-type: application/json' -d '{"forceNextOutcome":"fail"}'
> ```
> A linha de log gerada é byte-idêntica à de uma falha natural.

3. Leia o **código de referência** do toast em voz alta. É o `correlationId`, e é o
   gancho do próximo ato.

Se quiser mostrar a linha de log chegando ao vivo, a aba 5 (painel) tem "Logs
recentes" atualizando a cada 2s — mas ali o motivo técnico aparece, então use só
depois que o Hermes tiver diagnosticado.

## T+8 → T+13 — Ato 2: o Hermes descobre

No Telegram (aba 2):

```
"Hermes, procure erros 500 nos últimos 5 minutos"
```

O Hermes consulta o Loki e responde com endpoint, produto, timestamp e `correlationId` — **o mesmo que você acabou de ler na tela.** Esse é o beat: ninguém contou nada a ele.

```
"Qual é a causa?"
```

Ele lê o `stack` e diagnostica `payment_gateway_timeout`, com recomendação.

Opcional, se sobrar tempo: mostre a aba 3 (Grafana → Explore → `{job="api"} | json | level="error"`) para provar que o dado é o mesmo, e que o Hermes só consultou uma API aberta — nada proprietário.

## T+13 → T+18 — Ato 3: monitoramento autônomo

```
"Crie um cron para monitorar erros no checkout"
```

Hermes confirma o cron.

Volte à aba 1 e clique em **Comprar** mais 2 ou 3 vezes até sair um 500. Em até 1 minuto o Hermes avisa sozinho no Telegram.

Fechamento:

```
"Quantos erros temos agora?"
"Desligue o monitor"
```

## T+18 → T+20 — encerramento

O que a plateia acabou de ver: a aplicação nunca soube que estava sendo observada. Trocar o Loki por outro backend, ou o Hermes por outro agente, não muda nada dos dois lados. É isso que "agnóstico" quer dizer na prática.

## Botões de pânico

Todos na aba 4.

| Situação | Comando |
|---|---|
| Precisa de uma falha AGORA | `curl -X POST https://api.hostmaster.fagnerlopes.dev/v2/config -H 'content-type: application/json' -d '{"forceNextOutcome":"fail"}'` |
| Precisa de um sucesso AGORA | `curl -X POST https://api.hostmaster.fagnerlopes.dev/v2/config -H 'content-type: application/json' -d '{"forceNextOutcome":"success"}'` |
| Gerar erro sem clicar na tela | `curl -X POST https://api.hostmaster.fagnerlopes.dev/v2/checkout -H 'content-type: application/json' -d '{"productId":"MONITOR-240HZ","forceFailure":true}'` |
| Mostrar o serviço caindo inteiro | `curl -X POST https://api.hostmaster.fagnerlopes.dev/v2/simulate-crash` |
| Voltar ao normal | `API_URL=https://api.hostmaster.fagnerlopes.dev ./scripts/reset-demo.sh` |
| Dashboard travou | recarregue a página — o polling se auto-cura |
| Stack inteira travou | redeploy pela UI do Coolify, ou `docker compose down && docker compose up -d` na VPS |

**Nunca digite `docker compose down -v`.** O `-v` apaga `postgres_data` e `loki_data` — some com todo o histórico que o Hermes vai buscar, no meio da demo.

## Se o Hermes não achar nada no Loki

Diagnóstico em três comandos, nesta ordem:

```bash
# 1. Promtail vivo? (so de dentro da VPS — ele nao tem dominio)
docker compose exec promtail wget -qO- localhost:9080/ready

# 2. A API esta escrevendo? (idem, de dentro da VPS)
docker compose exec api tail -2 /var/log/app/api.log

# 3. O Loki tem job=api? (de qualquer lugar, COM credencial)
curl -s -u "$LOKI_USER:$LOKI_PASS" \
  https://loki.hostmaster.fagnerlopes.dev/loki/api/v1/label/job/values | jq -r '.data[]'
```

**Se o passo 3 devolver 401**, o problema é credencial, não query — exporte
`LOKI_USER` e `LOKI_PASS`.

Se os três passarem e o Hermes ainda falhar, o problema é a query dele: quase sempre é `-d` em vez de `--data-urlencode`, que devolve HTTP 400.

**Plano B narrativo:** o painel "Logs recentes" do dashboard mostra as mesmas linhas, vindas de um ring buffer em memória, independente de Loki e Promtail. Dá para contar a história inteira a partir dele enquanto conserta o resto.

## Depois da live

```bash
docker compose down          # sem -v
```

Nada fica exposto: a stack não publica porta nenhuma no host, e o Loki está atrás de
basic-auth. Se quiser encerrar de vez, derrube pela UI do Coolify.
