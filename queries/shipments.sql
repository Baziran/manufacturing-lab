-- Каждая отгрузка использует цену своей позиции заказа.
SELECT s.shipment_id,s.order_id,s.order_item_id,s.shipped_at,s.quantity,
 s.quantity*i.unit_price AS amount,c.name AS customer,p.sku,p.name AS product
FROM shipments s JOIN order_items i USING(order_item_id,order_id)
JOIN orders o USING(order_id) JOIN customers c USING(customer_id) JOIN products p USING(product_id)
WHERE s.shipped_at>=%(period_start)s::date AND o.status='active'
AND o.order_date<=%(as_of)s AND s.shipped_at<=%(as_of)s
ORDER BY s.shipped_at DESC,s.shipment_id;
