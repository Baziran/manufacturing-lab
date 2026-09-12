-- Correct synthetic order 102: full shipment before the power-on failure claim.
-- The existing later shipment is moved, not duplicated. Safe to run again.
BEGIN;
UPDATE shipments SET shipped_at='2026-09-06'
WHERE shipment_id=12 AND order_id=102;
INSERT INTO shipments(shipment_id,order_id,shipped_at,quantity,order_item_id)
SELECT 302,102,'2026-09-06',1,order_item_id
FROM order_items WHERE order_id=102 AND line_no=2
ON CONFLICT(shipment_id) DO NOTHING;
UPDATE orders SET delay_reason='' WHERE order_id=102;
COMMIT;
