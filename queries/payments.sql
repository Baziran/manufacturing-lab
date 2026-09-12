-- Возвраты сохраняют отрицательный знак: итог совпадает с карточкой поступлений.
SELECT p.payment_id,p.order_id,p.paid_at,p.amount,c.name AS customer
FROM payments p JOIN orders o USING(order_id) JOIN customers c USING(customer_id)
WHERE p.paid_at >= %(period_start)s::date AND o.status='active' AND o.order_date <= %(as_of)s AND p.paid_at <= %(as_of)s
ORDER BY p.paid_at DESC,p.payment_id;
