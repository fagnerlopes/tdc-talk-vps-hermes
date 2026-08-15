#!/bin/sh
# Valida a senha do admin do Grafana e a torna autoritativa em TODO boot.
#
# POR QUE ESTE ARQUIVO EXISTE — dois problemas, resolvidos no mesmo lugar.
#
# 1) GF_SECURITY_ADMIN_PASSWORD so vale no PRIMEIRO boot. O Grafana cria o
#    usuario admin quando o grafana.db ainda nao existe; a partir dai a env var
#    e simplesmente ignorada. Medido na imagem 11.2.0:
#
#      volume novo  + GF_SECURITY_ADMIN_PASSWORD=senha-um   -> login senha-um   200
#      MESMO volume + GF_SECURITY_ADMIN_PASSWORD=senha-dois -> login senha-dois 401
#                                                              login senha-um   200
#
#    Em producao o volume grafana_data existe desde o primeiro deploy. Trocar a
#    variavel no Coolify e redeployar NAO mudaria nada, e a senha continuaria
#    sendo a default `admin` — publica, num dominio exposto na internet. O erro
#    seria silencioso: o deploy passa, o container fica saudavel, e so o login
#    revela o problema.
#
#    Correcao: quando o banco ja existe, aplicamos a senha pela CLI antes de
#    subir o servidor. A env var passa a valer sempre, sem apagar volume.
#    O comando e idempotente — roda a cada boot sem efeito colateral.
#
# 2) Sem a variavel, o Grafana sobe com admin/admin. Abortamos de proposito, do
#    mesmo jeito que o loki-auth aborta sem LOKI_BASIC_AUTH_B64: falhar alto e
#    melhor que subir um Grafana aberto por engano.
#
#    A checagem vive AQUI e nao no `:?` do compose porque o parser do Coolify so
#    lida bem com a forma `${VAR:-default}` — mesmo motivo documentado em
#    docker-compose.yml para o loki-auth.
set -e

if [ -z "${GF_SECURITY_ADMIN_PASSWORD:-}" ]; then
  echo "[grafana] ERRO: GF_SECURITY_ADMIN_PASSWORD nao definida." >&2
  echo "[grafana] Sem ela o Grafana subiria com admin/admin num dominio" >&2
  echo "[grafana] publico — abortando de proposito." >&2
  exit 1
fi

if [ "$GF_SECURITY_ADMIN_PASSWORD" = "admin" ]; then
  echo "[grafana] ERRO: GF_SECURITY_ADMIN_PASSWORD e a senha default 'admin'." >&2
  echo "[grafana] Escolha outra — abortando." >&2
  exit 1
fi

if [ -f /var/lib/grafana/grafana.db ]; then
  # Banco pre-existente: a env var seria ignorada. Aplicamos pela CLI.
  echo "[grafana] banco existente — aplicando GF_SECURITY_ADMIN_PASSWORD via CLI"
  grafana cli --homepath=/usr/share/grafana --config=/etc/grafana/grafana.ini \
    admin reset-admin-password "$GF_SECURITY_ADMIN_PASSWORD"
else
  echo "[grafana] banco novo — GF_SECURITY_ADMIN_PASSWORD vale no primeiro boot"
fi

exec /run.sh "$@"
