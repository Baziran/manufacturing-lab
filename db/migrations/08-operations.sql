BEGIN;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS operations;
CREATE TABLE IF NOT EXISTS audit.events (
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 transaction_id bigint NOT NULL DEFAULT txid_current(),
 entity text NOT NULL, order_id integer NOT NULL, action text NOT NULL,
 before_data jsonb, after_data jsonb,
 actor text NOT NULL, reason text NOT NULL, approved_by text NOT NULL,
 database_user text NOT NULL DEFAULT session_user
);
CREATE INDEX IF NOT EXISTS audit_order_time ON audit.events(order_id,changed_at DESC);
CREATE TABLE IF NOT EXISTS operations.demo_orders (
 order_id integer PRIMARY KEY REFERENCES public.orders,
 due_date date NOT NULL, status text NOT NULL CHECK(status IN ('active','paused','ready'))
);
CREATE TABLE IF NOT EXISTS operations.restore_probe (id integer PRIMARY KEY, value text NOT NULL);
CREATE OR REPLACE FUNCTION audit.track_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,audit AS $$
DECLARE who text; why text;
BEGIN
 IF TG_OP='UPDATE' AND to_jsonb(NEW)=to_jsonb(OLD) THEN RETURN NEW; END IF;
 who := nullif(current_setting('app.actor',true),'');
 why := nullif(current_setting('app.reason',true),'');
 IF who IS NULL OR why IS NULL THEN
  RAISE EXCEPTION 'Audited writes require app.actor and app.reason';
 END IF;
 INSERT INTO audit.events(entity,order_id,action,before_data,after_data,actor,reason,approved_by)
 VALUES(TG_TABLE_SCHEMA||'.'||TG_TABLE_NAME,COALESCE(NEW.order_id,OLD.order_id),TG_OP,
 CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END,
 CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END,who,why,
 COALESCE(current_setting('app.approved_by',true),''));
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION audit.track_order() FROM PUBLIC;
DROP TRIGGER IF EXISTS order_audit ON public.orders;
CREATE TRIGGER order_audit AFTER INSERT OR UPDATE OR DELETE ON public.orders
 FOR EACH ROW EXECUTE FUNCTION audit.track_order();
DROP TRIGGER IF EXISTS demo_order_audit ON operations.demo_orders;
CREATE TRIGGER demo_order_audit AFTER INSERT OR UPDATE OR DELETE ON operations.demo_orders
 FOR EACH ROW EXECUTE FUNCTION audit.track_order();
SELECT set_config('app.actor','Demo operator',true),set_config('app.reason','Initial demonstration copy',true),set_config('app.approved_by','Demo director',true);
INSERT INTO operations.demo_orders SELECT order_id,due_date,'active' FROM public.orders WHERE order_id IN (104,108,111)
 ON CONFLICT DO NOTHING;
GRANT USAGE ON SCHEMA audit,operations TO dashboard;
GRANT SELECT ON audit.events,operations.demo_orders TO dashboard;
COMMENT ON TABLE audit.events IS 'Transactional row audit. App role is read-only; superuser can alter records. Actors supplied by SSH operator are demo identities, not authenticated end users.';
COMMIT;
