# **Checklist Pré-Live — Segunda 18h**

Use este checklist 1 hora antes da live para validar que tudo está funcionando.

## **✅ Infraestrutura (Docker Compose)**

- [ ] `docker-compose up -d` executado com sucesso
- [ ] Todos os containers estão rodando:
  ```bash
  docker-compose ps
  # Esperado: postgres, api, web, promtail, loki — status "Up"
  ```
- [ ] Banco de dados foi seed:
  ```bash
  npm run seed
  # Esperado: "Seed completed" ou similar
  ```

## **✅ Endpoints /v1 (Teste Prévio)**

- [ ] `GET /v1/health` retorna 200:
  ```bash
  curl http://localhost:3001/v1/health
  # Esperado: {"status": "ok"}
  ```

- [ ] `GET /v1/status` retorna métricas:
  ```bash
  curl http://localhost:3001/v1/status
  # Esperado: {"uptime": ..., "checkouts": 0, "failures": 0}
  ```

- [ ] `POST /v1/checkout` funciona (clique 5 vezes, observe 50% falha):
  ```bash
  for i in {1..5}; do
    curl -X POST http://localhost:3001/v1/checkout \
      -H "Content-Type: application/json" \
      -d "{\"productId\": \"MONITOR-240HZ\", \"userId\": \"user-1\"}"
    echo ""
    sleep 1
  done
  # Esperado: ~50% retornam 200, ~50% retornam 500
  ```

- [ ] `POST /v1/simulate-crash` funciona:
  ```bash
  curl -X POST http://localhost:3001/v1/simulate-crash
  # Esperado: {"crashed": true}
  
  curl http://localhost:3001/v1/health
  # Esperado: agora retorna 500
  
  curl -X POST http://localhost:3001/v1/simulate-crash  # Reset
  # Esperado: recupera status 200
  ```

## **✅ Endpoints /v2 (Live Ao Vivo)**

Repetir os mesmos testes acima, mas com `/v2`:

- [ ] `GET /v2/health` retorna 200
- [ ] `GET /v2/status` retorna métricas
- [ ] `POST /v2/checkout` falha aleatoriamente (5x clicks)
- [ ] `POST /v2/simulate-crash` funciona

## **✅ Logs e Loki**

- [ ] Promtail está enviando logs para Loki:
  ```bash
  docker-compose logs promtail | tail -20
  # Esperado: logs de coleta, sem erros
  ```

- [ ] Loki está recebendo logs (query via API):
  ```bash
  curl -G \
    -d 'query={job="api"} | json' \
    -d 'limit=10' \
    http://localhost:3100/loki/api/v1/query_range | jq '.data.result | length'
  # Esperado: número > 0 (logs foram recebidos)
  ```

- [ ] Loki UI acessível:
  ```bash
  open http://localhost:3100
  # Esperado: interface Grafana Loki carrega
  ```

- [ ] Logs estruturados aparecem corretamente (verificar em Loki UI):
  - Campos: level, timestamp, correlationId, endpoint, productId, reason
  - Formato: JSON válido

## **✅ Frontend (Dashboard)**

- [ ] Acesso ao dashboard:
  ```bash
  open http://localhost:3000
  # Esperado: Dashboard HOSTMASTER carrega
  ```

- [ ] Dashboard mostra:
  - [ ] Menu sidebar com navegação (Home, Produtos, Pedidos, Analytics, Settings)
  - [ ] Lista de produtos com botão "Comprar [Nome]"
  - [ ] Painel "Logs Recentes" no lado direito

- [ ] Botão "Comprar [Produto]" funciona:
  - [ ] Clique → POST /v2/checkout é chamado
  - [ ] Status 200 → mensagem de sucesso
  - [ ] Status 500 → mensagem de erro
  - [ ] "Logs Recentes" atualiza em tempo real

## **✅ Hermes Agent (Testes Simples)**

- [ ] Hermes consegue acessar API da aplicação:
  ```bash
  # Teste manual: Hermes consulta /v2/health
  curl http://localhost:3001/v2/health
  # Esperado: 200
  ```

- [ ] Hermes consegue acessar Loki:
  ```bash
  curl -G \
    -d 'query={job="api"} | json' \
    -d 'limit=5' \
    http://localhost:3100/loki/api/v1/query_range
  # Esperado: JSON com logs estruturados
  ```

- [ ] Telegram Bot está configurado:
  - [ ] Número do chat ID configurado
  - [ ] Bot consegue enviar teste:
    ```bash
    # Envie uma msg teste via Hermes para verificar conectividade
    ```

## **✅ Dados de Teste**

- [ ] Produtos foram seed corretamente:
  ```bash
  # Verificar no banco (se tiver acesso direto):
  psql postgresql://dev_user:dev123@localhost:5432/hermes_demo -c "SELECT * FROM products;"
  # Esperado: 3-5 produtos com IDs como TEMPLATE-NEXTJS, EBOOK-REACT, etc
  ```

- [ ] Usuários foram seed:
  ```bash
  # Verificar no banco:
  psql postgresql://dev_user:dev123@localhost:5432/hermes_demo -c "SELECT * FROM users;"
  # Esperado: 2-3 usuários fake
  ```

## **✅ Performance e Timeouts**

- [ ] Endpoints respondem em < 1 segundo:
  ```bash
  time curl http://localhost:3001/v2/health
  # Esperado: < 1000ms
  ```

- [ ] Logs chegam em Loki < 5 segundos após erro:
  - Faça um `POST /v2/checkout`, observe erro
  - Aguarde 5 segundos
  - Consulte Loki, verifique se log apareceu

- [ ] Dashboard atualiza em < 2 segundos:
  - Clique "Comprar" no dashboard
  - Observe "Logs Recentes" atualizar

## **✅ Reset/Cleanup Pré-Live**

- [ ] Estado da aplicação resetado:
  ```bash
  # Se simulou crash, resetar:
  curl -X POST http://localhost:3001/v2/simulate-crash
  curl -X POST http://localhost:3001/v2/simulate-crash  # Reset
  
  curl http://localhost:3001/v2/health
  # Esperado: 200
  ```

- [ ] Logs antigos podem ser ignorados (não precisam deletar):
  - Hermes buscará apenas erros dos últimos 5 minutos
  - Logs antigos não interferem

- [ ] Banco de dados em estado limpo:
  ```bash
  # Opcional: resetar orders/checkouts
  # Mas não é necessário para a demo
  ```

## **✅ Documentação Pronta**

- [ ] [PRD.md](PRD.md) atualizado e acessível
- [ ] [CLAUDE.md](CLAUDE.md) atualizado e acessível
- [ ] [AGENTE.md](AGENTE.md) criado e acessível
- [ ] [README.md](README.md) criado e acessível

## **✅ Comunicação & Telegram**

- [ ] Chat privado com Hermes está aberto
- [ ] Números do chat ID configurados corretamente
- [ ] Teste mensagem simples para verificar conectividade
- [ ] Hermes consegue enviar mensagem de teste para Telegram

## **✅ Compartilhamento de Tela**

- [ ] OBS/ScreenShare configurado:
  - [ ] Resolução ok (1920x1080 ideal)
  - [ ] Áudio funcionando
  - [ ] Dashboard visível sem zoom excessivo

- [ ] Aba Telegram aberta (para mostrar avisos em tempo real)
- [ ] Aba Loki UI aberta (para mostrar logs quando necessário)
- [ ] Terminal aberto (para mostrar curl commands se precisar)

## **✅ Plano B (Se Algo Der Errado)**

- [ ] Backup: Toda a stack pode ser reiniciada em < 2 minutos:
  ```bash
  docker-compose down
  docker-compose up -d
  npm run seed
  ```

- [ ] Hermes pode ser testado isoladamente (sem app rodando)

- [ ] Se logs não chegarem em Loki: pode-se testar Hermes consultando logs locais

## **✅ 15 minutos Antes da Live**

```bash
# Rodinha de verificação final
echo "=== Verificação Final (15 min antes) ==="
curl http://localhost:3001/v2/health && echo "✓ API Health OK"
curl http://localhost:3000 > /dev/null && echo "✓ Dashboard OK"
curl -s http://localhost:3100/loki/api/v1/query_range?query={job=\"api\"} | jq '.data.result | length' && echo "✓ Loki OK"
docker-compose ps | grep "Up" && echo "✓ Containers OK"
echo "=== Tudo pronto! Boa live! 🚀 ==="
```

## **Durante a Live (Quick Reference)**

| Ação | Comando/URL |
|------|------------|
| Testar Dashboard | `http://localhost:3000` |
| Testar API | `curl http://localhost:3001/v2/health` |
| Ver Logs em Tempo Real | `http://localhost:3100` |
| Simular Erro | Clique "Comprar [Produto]" no dashboard |
| Avisar Hermes | Envie áudio/mensagem no Telegram |
| Reset se Precisar | `docker-compose down && docker-compose up -d && npm run seed` |

---

✅ **Checklist completo = live tranquila!**

Qualquer dúvida, consulte [AGENTE.md](AGENTE.md) ou [README.md](README.md).

**Boa sorte! 🎬**
