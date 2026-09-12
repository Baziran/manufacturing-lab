-- Synthetic customer claims; additive and safe to apply again.
BEGIN;
CREATE TABLE IF NOT EXISTS claims (
 claim_id integer PRIMARY KEY,
 order_item_id integer NOT NULL REFERENCES order_items,
 opened_at date NOT NULL,
 reason text NOT NULL CHECK (reason IN ('transit_damage','power_on_failure','incomplete','spec_mismatch')),
 quantity integer NOT NULL CHECK (quantity > 0),
 returned_at date,
 closed_at date,
 resolution text CHECK (resolution IN ('replacement','missing_parts')),
 CHECK (returned_at IS NULL OR returned_at >= opened_at),
 CHECK (closed_at IS NULL OR closed_at >= opened_at),
 CHECK (closed_at IS NULL OR returned_at IS NULL OR closed_at >= returned_at),
 CHECK ((closed_at IS NULL) = (resolution IS NULL))
);
INSERT INTO claims (claim_id,order_item_id,opened_at,reason,quantity,returned_at,closed_at,resolution)
SELECT v.id,i.order_item_id,v.opened::date,v.reason,1,v.returned::date,v.closed::date,v.resolution
FROM (VALUES
 (1,101,1,'2026-09-05','transit_damage','2026-09-07','2026-09-10','replacement'),
 (2,102,1,'2026-09-07','power_on_failure','2026-09-09',NULL,NULL),
 (3,101,2,'2026-09-06','incomplete',NULL,'2026-09-08','missing_parts'),
 (4,103,1,'2026-09-11','spec_mismatch','2026-09-12',NULL,NULL),
 (5,105,1,'2026-09-12','transit_damage',NULL,NULL,NULL)
) AS v(id,order_id,line_no,opened,reason,returned,closed,resolution)
JOIN order_items i ON i.order_id=v.order_id AND i.line_no=v.line_no
ON CONFLICT (claim_id) DO NOTHING;
GRANT SELECT ON claims TO dashboard;
COMMENT ON TABLE claims IS 'Customer claims and physical returns; no automatic financial or inventory postings.';
COMMIT;
