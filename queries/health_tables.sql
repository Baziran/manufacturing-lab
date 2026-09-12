-- Число живых/мёртвых строк — оценка статистики, не COUNT(*).
SELECT relname AS name,pg_total_relation_size(relid) AS total_bytes,
 pg_indexes_size(relid) AS index_bytes,n_live_tup AS estimated_rows,
 n_dead_tup AS dead_rows,seq_scan,COALESCE(idx_scan,0) AS index_scan,
 last_vacuum,last_autovacuum,last_analyze,last_autoanalyze
FROM pg_stat_user_tables WHERE schemaname='public'
ORDER BY pg_total_relation_size(relid) DESC,relname;
