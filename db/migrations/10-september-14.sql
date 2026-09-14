-- Synthetic activity for 14 September 2026. No changes to earlier documents.
-- Apply after a backup to an existing demo; also runs on a fresh Compose volume.
BEGIN;
SELECT pg_advisory_xact_lock(20260914);
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM operations.seed_batches WHERE name='10-september-14') THEN RETURN; END IF;
 PERFORM set_config('app.actor','Demo data operator',true),
   set_config('app.reason','Synthetic activity for 2026-09-14',true),
   set_config('app.approved_by','Demo owner',true);

 INSERT INTO customers(customer_id,name,city,manager) VALUES
 (13,'Cedar Test Systems','Хайфа','Анна'),
 (14,'Sharon Photonics','Нетания','Давид');
 INSERT INTO orders(order_id,customer_id,order_date,original_due_date,due_date,status,channel,delay_reason) VALUES
 (113,13,'2026-09-14','2026-09-16','2026-09-16','active','Сайт',''),
 (114,1,'2026-09-14','2026-09-21','2026-09-21','active','Прямые продажи',''),
 (115,14,'2026-09-14','2026-09-24','2026-09-24','active','Партнёры',''),
 (116,8,'2026-09-14','2026-09-22','2026-09-22','active','Прямые продажи','');
 INSERT INTO order_items(order_id,line_no,product_id,quantity,unit_price) VALUES
 (113,1,6,2,2500),(113,2,7,2,1500),
 (114,1,1,2,12000),(114,2,7,2,1500),
 (115,1,4,3,9000),(115,2,3,2,6000),
 (116,1,5,4,4500);

 -- Complete old orders 105, 109, 110; ship 113 in full and 114 in part.
 -- Existing shipment 14 for order 106 already falls on this date: keep it once.
 INSERT INTO shipments(shipment_id,order_id,shipped_at,quantity,order_item_id)
 SELECT v.shipment_id,v.order_id,DATE '2026-09-14',v.quantity,i.order_item_id
 FROM (VALUES (401,105,1,2),(402,109,1,3),(403,110,1,2),
              (404,113,1,2),(405,113,2,2),(406,114,1,1))
      AS v(shipment_id,order_id,line_no,quantity)
 JOIN order_items i USING(order_id,line_no);
 INSERT INTO payments(payment_id,order_id,paid_at,amount,note) VALUES
 (401,105,'2026-09-14',9000,'Demo: final payment'),
 (402,113,'2026-09-14',8000,'Demo: full payment'),
 (403,114,'2026-09-14',13500,'Demo: 50% advance'),
 (404,115,'2026-09-14',19500,'Demo: 50% advance');

 IF EXISTS (
   SELECT 1 FROM shipments s JOIN order_items i USING(order_item_id,order_id)
   JOIN orders o USING(order_id) WHERE s.shipped_at<o.order_date
 ) OR EXISTS (
   SELECT 1 FROM shipments s JOIN order_items i USING(order_item_id,order_id)
   GROUP BY i.order_item_id,i.quantity HAVING sum(s.quantity)>i.quantity
 ) THEN RAISE EXCEPTION 'Invalid synthetic shipment chronology or quantity'; END IF;
 INSERT INTO operations.seed_batches(name) VALUES('10-september-14');
END $$;
COMMIT;
