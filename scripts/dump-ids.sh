#!/usr/bin/env bash
PSQL="PGPASSWORD=postgres psql -U postgres -h localhost -d noshow_recovery -tAc"
ACME=$(eval $PSQL "\"SELECT id FROM clients WHERE name='Acme Corp'\"")
GLOBEX=$(eval $PSQL "\"SELECT id FROM clients WHERE name='Globex Industries'\"")
FRANK=$(eval $PSQL "\"SELECT id FROM leads WHERE name='Frank Reynolds'\"")
ACME_SCHED=$(eval $PSQL "\"SELECT id FROM leads WHERE client_id='$ACME' AND status='scheduled' LIMIT 1\"")
echo "acme=$ACME"
echo "globex=$GLOBEX"
echo "frank=$FRANK"
echo "acme_scheduled=$ACME_SCHED"
