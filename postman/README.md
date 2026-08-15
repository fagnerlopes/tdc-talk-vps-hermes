# Collection do Postman — HOSTMASTER

Consumo manual dos endpoints da demo. Serve para três coisas: explorar a API, dirigir a demo sem depender da interface, e checar a stack rapidamente.

## Importar

No Postman, **Import** → arraste os quatro arquivos desta pasta. Depois **selecione um Environment** no canto superior direito — sem isso as variáveis ficam vazias e todo request falha.

| Environment | Quando usar |
|---|---|
| `HOSTMASTER — Local (docker compose)` | stack rodando na sua máquina |
| `HOSTMASTER — VPS (portas cruas)` | **obsoleto** — as portas foram fechadas; mantido só como histórico |
| `HOSTMASTER — VPS (dominios TLS)` | **produção** — é este que você quer |

## Pastas

| Pasta | Para quê |
|---|---|
| **1. Saúde e estado** | leitura pura, não altera nada |
| **2. Checkout** | comprar, com resultado natural ou falha garantida |
| **3. Controles de palco** | forçar falha, derrubar serviço, ajustar taxa, resetar |
| **4. Investigação no Loki** | as queries do [AGENTE.md](../AGENTE.md) — o que o Hermes faz |
| **5. Diagnóstico da stack** | quando algo não funciona, rode nesta ordem |

## Esta collection é o plano B do palco

Os controles de demo moram no `/dashboard`, atrás de login. Se a sessão falhar na hora da talk, **tudo o que aqueles botões fazem está na pasta 3**. Vale deixar o Postman aberto numa aba junto com o terminal.

## Detalhes que valem saber

**As queries do Loki são POST, não GET.** LogQL contém `|`, `{`, `}`, `"` e espaços. Codificação de query string é a causa nº 1 de HTTP 400 no Loki, e o comportamento do Postman com esses caracteres não é confiável. O Loki aceita `POST` com `application/x-www-form-urlencoded`, que o Postman codifica corretamente — então é esse o caminho usado. Pelo mesmo motivo, no terminal use sempre `curl --data-urlencode`, nunca `-d` puro.

**O `correlationId` se preenche sozinho.** Qualquer checkout grava o valor numa variável da collection, e a request `Rastrear correlationId` usa direto — sem copiar e colar no meio da apresentação.

**Duas requests do Loki esperam 3 segundos.** O Promtail entrega em lote a cada 1s. Consultar imediatamente depois de um checkout devolve vazio por corrida, não por defeito. A espera existe só onde há asserção rígida.

**`Resetar baseline` é o último item da pasta 3, de propósito.** Um run completo passa pelo `simulate-crash`, que *alterna* o estado. Sem o reset no fim, a stack terminaria derrubada — foi exatamente o que aconteceu na primeira versão desta collection.

**A janela das queries é de 60 minutos.** Erros mais antigos que isso não aparecem, e é esperado.

**Nada aqui autentica na API.** A API continua aberta para o Hermes, por design. O login protege apenas o dashboard do Next.

**O Loki, esse sim, autentica.** Preencha `loki_user` e `loki_pass` no Environment de produção — a pasta 4 inteira e o `/ready` da pasta 5 já estão configurados para usá-los. Sem isso, essas requests devolvem 401. Pela linha de comando, passe a senha sem gravá-la no arquivo:

```bash
npx newman@6 run postman/HOSTMASTER-TDC.postman_collection.json \
  -e postman/HOSTMASTER-vps-tls.postman_environment.json \
  --env-var "loki_pass=$LOKI_PASS"
```

## Rodar pela linha de comando

A collection também funciona como verificação automatizada:

```bash
npx newman@6 run postman/HOSTMASTER-TDC.postman_collection.json \
  -e postman/HOSTMASTER-vps-portas.postman_environment.json
```

Esperado: 25 requests, 15 asserções, 0 falhas. É complementar ao [`scripts/smoke.sh`](../scripts/smoke.sh), não substituto — o smoke test checa coisas que a collection não vê, como a contagem de containers e a taxa de falha ao longo de 10 tentativas.
