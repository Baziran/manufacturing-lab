#!/bin/sh
# The application retains the read-only grants from the training schema.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv dashboard_password DASHBOARD_PASSWORD
ALTER ROLE dashboard PASSWORD :'dashboard_password';
SQL
