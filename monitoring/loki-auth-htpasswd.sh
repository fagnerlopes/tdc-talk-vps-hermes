#!/bin/sh
# Escreve o .htpasswd a partir da env var, no boot.
#
# A imagem do nginx executa tudo em /docker-entrypoint.d/*.sh antes de subir o
# servidor. O hash chega por LOKI_BASIC_AUTH_B64 (env var do Coolify) e NUNCA e
# versionado — este repositorio e publico.
#
# POR QUE BASE64: o hash htpasswd e cheio de `$` (`hermes:$apr1$sal$hash`), e o
# `$` nao sobrevive a interpolacao do Docker Compose. Testado: passando o hash
# cru, `hermes:$apr1$Nqc9VQaU$EteDq...` chega no container como
# `hermes:$apr1qc9VQaUteDq...` — o Compose come os `$X`. Escapar com `$$` no
# .env produz outro estrago (`$$apr1$qc9...`). Base64 usa so [A-Za-z0-9+/=],
# nao tem `$`, e atravessa Compose e Coolify intacto.
#
# Gerar o valor:
#   printf '%s' "usuario:$(openssl passwd -apr1 '<senha>')" | base64 -w0
set -e

if [ -z "${LOKI_BASIC_AUTH_B64:-}" ]; then
  echo "[loki-auth] ERRO: LOKI_BASIC_AUTH_B64 nao definida." >&2
  echo "[loki-auth] Sem ela o Loki ficaria aberto — abortando de proposito." >&2
  exit 1
fi

printf '%s' "$LOKI_BASIC_AUTH_B64" | base64 -d > /etc/nginx/.htpasswd
chmod 640 /etc/nginx/.htpasswd
chown root:nginx /etc/nginx/.htpasswd

if ! grep -q ':' /etc/nginx/.htpasswd; then
  echo "[loki-auth] ERRO: .htpasswd sem ':' — o base64 nao decodificou num" >&2
  echo "[loki-auth] par usuario:hash. Confira LOKI_BASIC_AUTH_B64." >&2
  exit 1
fi

echo "[loki-auth] .htpasswd escrito para o usuario '$(cut -d: -f1 /etc/nginx/.htpasswd)'"
