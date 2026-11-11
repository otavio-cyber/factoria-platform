#!/usr/bin/env bash
# Espelho do init de produção (saas-data/init/01-bancos-e-usuarios.sh), só com o banco do app.
# Roda UMA vez, quando o volume é criado. Para recriar: pnpm db:reset
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_pw="$FACTORIA_OWNER_PASSWORD" -v app_pw="$FACTORIA_APP_PASSWORD" <<'SQL'
-- Dono do schema: só migrations. Runtime do app: sem ownership, sem BYPASSRLS.
CREATE ROLE factoria_owner LOGIN PASSWORD :'owner_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE factoria_app   LOGIN PASSWORD :'app_pw'   NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE DATABASE factoria_saas OWNER factoria_owner;
REVOKE ALL ON DATABASE factoria_saas FROM PUBLIC;
GRANT CONNECT ON DATABASE factoria_saas TO factoria_owner, factoria_app;
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname factoria_saas <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

ALTER SCHEMA public OWNER TO factoria_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO factoria_app;

ALTER DEFAULT PRIVILEGES FOR ROLE factoria_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO factoria_app;
ALTER DEFAULT PRIVILEGES FOR ROLE factoria_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO factoria_app;
ALTER DEFAULT PRIVILEGES FOR ROLE factoria_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO factoria_app;
SQL

echo "Factoria dev: banco factoria_saas pronto."
