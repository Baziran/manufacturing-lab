-- Текущая БД; накопительные счётчики PostgreSQL с момента stats_reset.
SELECT current_database() AS name,current_setting('server_version') AS version,
 pg_database_size(current_database()) AS size_bytes,
 EXTRACT(EPOCH FROM clock_timestamp()-pg_postmaster_start_time()) AS uptime_seconds,
 d.numbackends AS connections,
 (SELECT SUM(numbackends) FROM pg_stat_database) AS server_connections,
 current_setting('max_connections')::integer AS max_connections,
 d.xact_commit AS commits,d.xact_rollback AS rollbacks,d.blks_read,d.blks_hit,
 CASE WHEN d.blks_hit+d.blks_read>0 THEN ROUND(100.0*d.blks_hit/(d.blks_hit+d.blks_read),2) END AS cache_hit_pct,
 d.tup_inserted AS inserted,d.tup_updated AS updated,d.tup_deleted AS deleted,
 d.deadlocks,d.temp_files,d.temp_bytes,d.stats_reset,
 (SELECT COUNT(*) FROM pg_locks WHERE database=d.datid AND NOT granted) AS waiting_locks
FROM pg_stat_database d WHERE d.datname=current_database();
