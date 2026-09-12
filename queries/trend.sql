-- Независимые суммы по дням: денежный оборот позиций, отгрузок и платежей.
WITH days AS (
 SELECT generate_series(date_trunc('month',%(as_of)s::date),%(as_of)s::date,'1 day')::date AS day
), bookings AS (
 SELECT o.order_date AS day,SUM(i.quantity*i.unit_price) AS booked
 FROM orders o JOIN order_items i USING(order_id) WHERE o.status='active' GROUP BY o.order_date
), dispatched AS (
 SELECT s.shipped_at AS day,SUM(s.quantity*i.unit_price) AS shipped
 FROM shipments s JOIN order_items i USING(order_item_id,order_id) JOIN orders o USING(order_id)
 WHERE o.status='active' GROUP BY s.shipped_at
), cash AS (
 SELECT p.paid_at AS day,SUM(p.amount) AS paid
 FROM payments p JOIN orders o USING(order_id) WHERE o.status='active' GROUP BY p.paid_at
)
SELECT d.day,COALESCE(b.booked,0) AS booked,COALESCE(s.shipped,0) AS shipped,COALESCE(c.paid,0) AS paid
FROM days d LEFT JOIN bookings b USING(day) LEFT JOIN dispatched s USING(day) LEFT JOIN cash c USING(day)
ORDER BY d.day;
