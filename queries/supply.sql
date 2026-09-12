-- Сначала потребность каждой позиции, затем один итог на заказ и компонент.
WITH shipped AS (
 SELECT order_item_id,SUM(quantity) AS qty FROM shipments WHERE shipped_at<=%(as_of)s GROUP BY order_item_id
), demand AS (
 SELECT b.component_id,o.order_id,o.due_date-2 AS needed_by,
 GREATEST(i.quantity-COALESCE(s.qty,0),0)*b.quantity AS needed
 FROM orders o JOIN order_items i USING(order_id) JOIN bom b USING(product_id)
 LEFT JOIN shipped s USING(order_item_id)
 WHERE o.status='active' AND o.order_date<=%(as_of)s
), order_demand AS (
 SELECT component_id,order_id,needed_by,SUM(needed) AS needed
 FROM demand GROUP BY component_id,order_id,needed_by
), totals AS (
 SELECT component_id,SUM(needed) AS needed,MIN(needed_by) FILTER(WHERE needed>0) AS needed_by,
 COUNT(*) FILTER(WHERE needed>0) AS impacted_orders,
 COALESCE(json_agg(json_build_object('order_id',order_id,'quantity',needed,'needed_by',needed_by)
 ORDER BY needed_by,order_id) FILTER(WHERE needed>0),'[]') AS orders
 FROM order_demand GROUP BY component_id
), incoming AS (
 SELECT component_id,SUM(quantity) AS incoming_qty,MIN(expected_at) AS expected_at,
 json_agg(json_build_object('purchase_id',purchase_id,'quantity',quantity,'expected_at',expected_at,'status',status)
 ORDER BY expected_at) AS purchases FROM purchase_orders GROUP BY component_id
)
SELECT c.*,i.on_hand,i.reserved_external,i.on_hand-i.reserved_external AS available,
 COALESCE(t.needed,0) AS needed,
 GREATEST(COALESCE(t.needed,0)-(i.on_hand-i.reserved_external),0) AS shortage,
 GREATEST((i.on_hand-i.reserved_external)-COALESCE(t.needed,0),0) AS excess,
 t.needed_by,COALESCE(t.impacted_orders,0) AS impacted_orders,COALESCE(t.orders,'[]') AS orders,
 COALESCE(inc.incoming_qty,0) AS incoming_qty,inc.expected_at,COALESCE(inc.purchases,'[]') AS purchases
FROM components c JOIN inventory i USING(component_id)
LEFT JOIN totals t USING(component_id) LEFT JOIN incoming inc USING(component_id)
ORDER BY shortage DESC,c.component_id;
