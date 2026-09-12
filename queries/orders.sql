-- Одна строка = один заказ. Сначала отгрузки по позиции, затем позиции по заказу.
WITH shipped AS (
 SELECT order_item_id,SUM(quantity) AS qty,MAX(shipped_at) AS last_shipped_at
 FROM shipments WHERE shipped_at<=%(as_of)s GROUP BY order_item_id
), line_data AS (
 SELECT i.*,p.name AS product,p.sku,i.quantity*i.unit_price AS amount,
 COALESCE(s.qty,0) AS shipped_qty,COALESCE(s.qty,0)*i.unit_price AS shipped_amount,
 GREATEST(i.quantity-COALESCE(s.qty,0),0) AS remaining_qty,s.last_shipped_at
 FROM order_items i JOIN products p USING(product_id) LEFT JOIN shipped s USING(order_item_id)
), totals AS (
 SELECT order_id,COUNT(*) AS item_count,SUM(quantity) AS quantity,SUM(amount) AS amount,
 SUM(shipped_qty) AS shipped_qty,SUM(shipped_amount) AS shipped_amount,SUM(remaining_qty) AS remaining_qty,
 MAX(last_shipped_at) AS last_shipped_at,
 string_agg(product,' · ' ORDER BY line_no) AS product,string_agg(sku,' · ' ORDER BY line_no) AS sku,
 json_agg(json_build_object('order_item_id',order_item_id,'line_no',line_no,'product_id',product_id,
 'product',product,'sku',sku,'quantity',quantity,'unit_price',unit_price,'amount',amount,
 'shipped_qty',shipped_qty,'shipped_amount',shipped_amount,'remaining_qty',remaining_qty) ORDER BY line_no) AS items
 FROM line_data GROUP BY order_id
), paid AS (
 SELECT order_id,SUM(amount) AS amount FROM payments WHERE paid_at<=%(as_of)s GROUP BY order_id
)
SELECT o.*,c.name AS customer,c.manager,t.item_count,t.quantity,t.amount,t.product,t.sku,t.items,
 (SELECT MIN(f.order_date) FROM orders f WHERE f.customer_id=o.customer_id AND f.status='active') AS first_order_date,
 t.shipped_qty,t.shipped_amount,t.remaining_qty,t.last_shipped_at,
 COALESCE(pay.amount,0) AS paid_amount,t.amount-COALESCE(pay.amount,0) AS remaining_to_pay,
 CASE WHEN o.status='cancelled' THEN 'cancelled' WHEN t.remaining_qty=0 THEN 'shipped'
 WHEN o.due_date<%(as_of)s THEN 'overdue' ELSE 'in_progress' END AS fulfillment_status,
 CASE WHEN COALESCE(pay.amount,0)=0 THEN 'unpaid' WHEN pay.amount<t.amount THEN 'partial'
 WHEN pay.amount=t.amount THEN 'paid' ELSE 'overpaid' END AS payment_status,
 CASE WHEN o.status='active' AND o.due_date<%(as_of)s AND t.remaining_qty>0
 THEN %(as_of)s::date-o.due_date ELSE 0 END AS days_overdue
FROM orders o JOIN customers c USING(customer_id) JOIN totals t USING(order_id) LEFT JOIN paid pay USING(order_id)
WHERE o.order_date>=date_trunc('month',%(as_of)s::date) AND o.order_date<=%(as_of)s
ORDER BY o.due_date,o.order_id;
