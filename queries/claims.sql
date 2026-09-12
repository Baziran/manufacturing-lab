-- Claims opened in the inclusive period, with events known by its end.
SELECT c.claim_id, i.order_id, i.order_item_id, p.sku, p.name AS product,
       cu.name AS customer, cu.manager, c.opened_at, c.reason, c.quantity,
       c.quantity * i.unit_price AS goods_value,
       CASE WHEN c.returned_at <= %(as_of)s::date THEN c.returned_at END AS returned_at,
       CASE WHEN c.closed_at <= %(as_of)s::date THEN c.closed_at END AS closed_at,
       CASE WHEN c.closed_at <= %(as_of)s::date THEN c.resolution END AS resolution,
       CASE WHEN c.closed_at <= %(as_of)s::date THEN 'closed'
            WHEN c.returned_at <= %(as_of)s::date THEN 'returned'
            ELSE 'review' END AS claim_status
FROM claims c
JOIN order_items i USING (order_item_id)
JOIN orders o USING (order_id)
JOIN customers cu USING (customer_id)
JOIN products p USING (product_id)
WHERE c.opened_at >= %(period_start)s::date
  AND c.opened_at <= %(as_of)s::date
ORDER BY c.opened_at DESC, c.claim_id DESC;
