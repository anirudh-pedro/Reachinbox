#!/bin/bash
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq postgresql postgresql-contrib

CONF_FILE=$(ls /etc/postgresql/*/main/postgresql.conf | head -n 1)
HBA_FILE=$(ls /etc/postgresql/*/main/pg_hba.conf | head -n 1)

sed -i 's/port = 5432/port = 5433/' "$CONF_FILE"
sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'/" "$CONF_FILE"
echo "host all all 0.0.0.0/0 md5" >> "$HBA_FILE"

service postgresql restart

sudo -u postgres psql -p 5433 -c "ALTER USER postgres WITH PASSWORD 'postgrespassword';" || true
sudo -u postgres psql -p 5433 -c "CREATE DATABASE reachinbox_db;" || true

echo "Postgres on 5433 setup complete!"
