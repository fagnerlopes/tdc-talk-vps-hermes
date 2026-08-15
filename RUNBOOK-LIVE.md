# Runbook da Live — 20 minutos

Script minuto a minuto. Deixe esta página aberta numa aba fora da tela compartilhada.

**Substitua `vps70013.publiccloud.com.br` pelo domínio real antes de começar.**

## Setup de tela

| Aba | Conteúdo | Papel |
|---|---|---|
| 1 | Dashboard HOSTMASTER — `http://vps70013.publiccloud.com.br:3000` | palco principal |
| 2 | Telegram (chat com o Hermes) | onde a descoberta acontece |
| 3 | Grafana Explore — `http://vps70013.publiccloud.com.br:3300` | prova visual de que o log está no Loki |
| 4 | Terminal | botões de pânico |

Aba 4 nunca aparece, a menos que algo dê errado.

## T-15min — antes de subir

```bash
./scripts/smoke.sh && ./scripts/reset-demo.sh
```

As duas coisas precisam sair verdes. `reset-demo.sh` garante `failureRate=0.5`, `crashed=false`, `health=200` — o baseline sem o qual a narrativa não funciona.

Depois disso, **não rode mais nada com `failureRate` alterado.**

## T+0 → T+4 — abertura

Contexto: um e-commerce em produção numa VPS. Painel administrativo aberto, produtos, tudo normal.

Ponto a fixar antes de clicar em qualquer coisa: **a aplicação não sabe que o Hermes existe.** Ela só escreve log JSON em arquivo. Nenhum webhook, nenhum alerta, nenhum cron. É isso que faz a observabilidade ser agnóstica.

## T+4 → T+8 — Ato 1: a falha aparece

1. Clique em **Comprar Monitor 240Hz IPS**
2. Clique em mais 2 ou 3 produtos

Uma dessas vai retornar 500 — toast vermelho com o `reason` e o `correlationId`, e a linha vermelha aparecendo no painel "Logs recentes" em até 2s.

> **Se der uma sequência longa de sucessos:** não vai dar. O `CHECKOUT_MAX_SUCCESS_STREAK=3` força a falha no 4º clique seguido. Se ainda assim quiser garantir o timing, rode na aba 4 antes de clicar:
> ```bash
> curl -X POST http://vps70013.publiccloud.com.br:3001/v2/config -H 'content-type: application/json' -d '{"forceNextOutcome":"fail"}'
> ```
> A linha de log gerada é byte-idêntica à de uma falha natural.

3. Leia o `correlationId` do toast em voz alta. É o gancho do próximo ato.

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
| Precisa de uma falha AGORA | `curl -X POST http://vps70013.publiccloud.com.br:3001/v2/config -H 'content-type: application/json' -d '{"forceNextOutcome":"fail"}'` |
| Precisa de um sucesso AGORA | `curl -X POST http://vps70013.publiccloud.com.br:3001/v2/config -H 'content-type: application/json' -d '{"forceNextOutcome":"success"}'` |
| Gerar erro sem clicar na tela | `curl -X POST http://vps70013.publiccloud.com.br:3001/v2/checkout -H 'content-type: application/json' -d '{"productId":"MONITOR-240HZ","forceFailure":true}'` |
| Mostrar o serviço caindo inteiro | `curl -X POST http://vps70013.publiccloud.com.br:3001/v2/simulate-crash` |
| Voltar ao normal | `./scripts/reset-demo.sh` |
| Dashboard travou | recarregue a página — o polling se auto-cura |
| Stack inteira travou | `docker compose down && docker compose up -d` — volta em ~15s |

**Nunca digite `docker compose down -v`.** O `-v` apaga `postgres_data` e `loki_data` — some com todo o histórico que o Hermes vai buscar, no meio da demo.

## Se o Hermes não achar nada no Loki

Diagnóstico em três comandos, nesta ordem:

```bash
curl -s http://vps70013.publiccloud.com.br:9080/ready                                     # Promtail vivo?
docker compose exec api tail -2 /var/log/app/api.log                 # a API está escrevendo?
curl -s http://vps70013.publiccloud.com.br:3100/loki/api/v1/label/job/values | jq -r '.data[]'   # o Loki tem job=api?
```

Se os três passarem e o Hermes ainda falhar, o problema é a query dele: quase sempre é `-d` em vez de `--data-urlencode`, que devolve HTTP 400.

**Plano B narrativo:** o painel "Logs recentes" do dashboard mostra as mesmas linhas, vindas de um ring buffer em memória, independente de Loki e Promtail. Dá para contar a história inteira a partir dele enquanto conserta o resto.

## Depois da live

```bash
docker compose down          # sem -v
```

Se o Loki estiver exposto publicamente, derrube ou feche a porta — o repositório é público e o Loki roda com `auth_enabled: false`.
