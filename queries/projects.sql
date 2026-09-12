-- Ongoing projects carry across months. Future milestones are plans, not actuals.
WITH stages AS (
 SELECT s.project_id,s.stage_no,s.title,s.owner,s.planned_start,s.planned_end,s.depends_on,s.weight,s.acceptance,
 CASE WHEN s.actual_start<=%(as_of)s THEN s.actual_start END AS actual_start,
 CASE WHEN s.completed_at<=%(as_of)s THEN s.completed_at END AS completed_at,
 CASE WHEN s.blocked_at<=%(as_of)s AND (s.completed_at IS NULL OR s.completed_at>%(as_of)s) THEN s.block_reason END AS block_reason,
 CASE WHEN s.completed_at<=%(as_of)s THEN 'done'
 WHEN s.blocked_at<=%(as_of)s THEN 'blocked'
 WHEN s.depends_on IS NOT NULL AND (dep.completed_at IS NULL OR dep.completed_at>%(as_of)s) THEN 'waiting'
 WHEN s.actual_start<=%(as_of)s THEN 'active' ELSE 'planned' END AS stage_status
 FROM project_stages s LEFT JOIN project_stages dep ON dep.project_id=s.project_id AND dep.stage_no=s.depends_on
), totals AS (
 SELECT project_id,json_agg(s ORDER BY stage_no) AS stages,
 ROUND(100.0*SUM(weight) FILTER (WHERE stage_status='done')/SUM(weight)) AS progress,
 COUNT(*) FILTER (WHERE stage_status='done') AS done_count,COUNT(*) AS stage_count,
 COUNT(*) FILTER (WHERE stage_status='blocked') AS blocked_count
 FROM stages s GROUP BY project_id
)
SELECT p.project_id,p.order_id,p.title,p.owner,p.started_at,p.deadline,
 CASE WHEN p.forecast_recorded_at<=%(as_of)s THEN p.forecast_at ELSE p.deadline END AS forecast_at,
 CASE WHEN p.completed_at<=%(as_of)s THEN p.completed_at END AS completed_at,
 c.name AS customer,o.due_date AS order_due_date,
 (SELECT SUM(i.quantity*i.unit_price) FROM order_items i WHERE i.order_id=p.order_id) AS order_amount,
 COALESCE(t.progress,0) AS progress,t.done_count,t.stage_count,t.blocked_count,t.stages,
 CASE WHEN p.completed_at<=%(as_of)s THEN 'done'
 WHEN p.deadline<%(as_of)s THEN 'overdue'
 WHEN t.blocked_count>0 OR (p.forecast_recorded_at<=%(as_of)s AND p.forecast_at>p.deadline) THEN 'risk'
 ELSE 'active' END AS project_status
FROM projects p JOIN orders o USING(order_id) JOIN customers c USING(customer_id) JOIN totals t USING(project_id)
WHERE p.started_at<=%(as_of)s AND (p.completed_at IS NULL OR p.completed_at>=%(period_start)s)
ORDER BY p.deadline,p.project_id;
