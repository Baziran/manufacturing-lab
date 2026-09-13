-- Additional synthetic history, generated through the real audit trigger.
-- Timestamps are actual recording times; source orders remain unchanged.
BEGIN;
CREATE TABLE IF NOT EXISTS operations.seed_batches (
 name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
DO $$
DECLARE item record; total integer;
BEGIN
 IF EXISTS (SELECT 1 FROM operations.seed_batches WHERE name='09-evidence-examples') THEN RETURN; END IF;
 FOR item IN SELECT o.order_id,o.due_date,c.manager FROM public.orders o
   JOIN public.customers c USING(customer_id) WHERE o.order_id BETWEEN 101 AND 112 ORDER BY o.order_id
 LOOP
  PERFORM set_config('app.actor',item.manager||' (demo)',true),
    set_config('app.reason','Demo: created order copy',true),set_config('app.approved_by','',true);
  INSERT INTO operations.demo_orders(order_id,due_date,status) VALUES(item.order_id,item.due_date,'active') ON CONFLICT DO NOTHING;
  SELECT count(*) INTO total FROM audit.events WHERE entity='operations.demo_orders' AND order_id=item.order_id;
  IF total<3 THEN
   PERFORM set_config('app.actor','Elena (demo)',true),
     set_config('app.reason','Demo: shipment deadline moved for additional testing',true),
     set_config('app.approved_by','Alex (demo)',true);
   UPDATE operations.demo_orders SET due_date=due_date+1+(item.order_id%2) WHERE order_id=item.order_id;
   total:=total+1;
  END IF;
  IF total<3 THEN
   PERFORM set_config('app.actor','Daniel (demo)',true),
     set_config('app.reason','Demo: copy status changed after planning review',true),
     set_config('app.approved_by','Elena (demo)',true);
   UPDATE operations.demo_orders SET status='ready' WHERE order_id=item.order_id;
  END IF;
 END LOOP;
 INSERT INTO operations.seed_batches(name) VALUES('09-evidence-examples');
END $$;
COMMIT;
