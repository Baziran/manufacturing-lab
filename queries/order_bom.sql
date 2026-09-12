-- Полный состав и открытая потребность по каждой позиции, включая уже отгруженные.
WITH shipped AS (
 SELECT order_item_id,SUM(quantity) AS qty FROM shipments WHERE shipped_at<=%(as_of)s GROUP BY order_item_id
)
SELECT o.order_id,i.order_item_id,b.component_id,b.quantity AS per_unit,
 i.quantity*b.quantity AS ordered_needed,
 CASE WHEN o.status='active' THEN GREATEST(i.quantity-COALESCE(s.qty,0),0)*b.quantity ELSE 0 END AS open_needed
FROM orders o JOIN order_items i USING(order_id) JOIN bom b USING(product_id)
LEFT JOIN shipped s USING(order_item_id)
WHERE o.order_date>=date_trunc('month',%(as_of)s::date) AND o.order_date<=%(as_of)s
ORDER BY o.order_id,b.component_id,i.line_no;
