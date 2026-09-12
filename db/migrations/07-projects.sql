-- Read-only project-management demo linked to existing orders. Additive/idempotent.
BEGIN;
CREATE TABLE IF NOT EXISTS projects (
 project_id integer PRIMARY KEY,
 order_id integer NOT NULL REFERENCES orders,
 title text NOT NULL,
 owner text NOT NULL,
 started_at date NOT NULL,
 deadline date NOT NULL CHECK (deadline >= started_at),
 forecast_at date NOT NULL CHECK (forecast_at >= started_at),
 forecast_recorded_at date NOT NULL,
 completed_at date CHECK (completed_at >= started_at)
);
CREATE TABLE IF NOT EXISTS project_stages (
 project_id integer NOT NULL REFERENCES projects,
 stage_no integer NOT NULL CHECK (stage_no > 0),
 title text NOT NULL,
 owner text NOT NULL,
 planned_start date NOT NULL,
 planned_end date NOT NULL CHECK (planned_end >= planned_start),
 actual_start date,
 completed_at date CHECK (completed_at >= actual_start),
 depends_on integer,
 weight integer NOT NULL CHECK (weight > 0),
 acceptance text NOT NULL,
 blocked_at date,
 block_reason text,
 PRIMARY KEY (project_id,stage_no),
 FOREIGN KEY (project_id,depends_on) REFERENCES project_stages(project_id,stage_no),
 CHECK (depends_on IS NULL OR depends_on < stage_no),
 CHECK ((blocked_at IS NULL) = (block_reason IS NULL))
);
INSERT INTO projects VALUES
 (1,108,'Система охлаждения и сервисные комплекты','Михаил','2026-09-08','2026-09-16','2026-09-18','2026-09-11',NULL),
 (2,111,'Комплектация термоконтроллеров Max','Михаил','2026-09-11','2026-09-20','2026-09-20','2026-09-11',NULL),
 (3,101,'Термоконтроллеры для Orion Labs','Анна','2026-09-01','2026-09-05','2026-09-05','2026-09-01','2026-09-05')
ON CONFLICT DO NOTHING;
INSERT INTO project_stages VALUES
 (1,1,'Технические требования','Анна','2026-09-08','2026-09-08','2026-09-08','2026-09-08',NULL,10,'Требования согласованы с заказчиком',NULL,NULL),
 (1,2,'Спецификация и BOM','Давид','2026-09-09','2026-09-09','2026-09-09','2026-09-09',1,15,'Состав изделия утверждён',NULL,NULL),
 (1,3,'Закупка компонентов','Михаил','2026-09-09','2026-09-12','2026-09-09',NULL,2,20,'Все компоненты приняты на склад','2026-09-11','Не подтверждён срок поставки радиаторов'),
 (1,4,'Сборка и комплектация','Давид','2026-09-13','2026-09-14',NULL,NULL,3,30,'Все позиции собраны и проверена комплектность',NULL,NULL),
 (1,5,'Испытания','Давид','2026-09-15','2026-09-15',NULL,NULL,4,15,'Протокол испытаний без открытых замечаний',NULL,NULL),
 (1,6,'Приёмка проекта','Анна','2026-09-16','2026-09-16',NULL,NULL,5,10,'Результат принят заказчиком',NULL,NULL),
 (2,1,'Технические требования','Михаил','2026-09-11','2026-09-11','2026-09-11','2026-09-11',NULL,10,'Требования согласованы с заказчиком',NULL,NULL),
 (2,2,'Спецификация и BOM','Давид','2026-09-12','2026-09-13','2026-09-12',NULL,1,15,'Состав изделия утверждён',NULL,NULL),
 (2,3,'Закупка компонентов','Михаил','2026-09-14','2026-09-15',NULL,NULL,2,20,'Все компоненты приняты на склад',NULL,NULL),
 (2,4,'Сборка и комплектация','Давид','2026-09-16','2026-09-18',NULL,NULL,3,30,'Все позиции собраны и проверена комплектность',NULL,NULL),
 (2,5,'Испытания','Давид','2026-09-19','2026-09-19',NULL,NULL,4,15,'Протокол испытаний без открытых замечаний',NULL,NULL),
 (2,6,'Приёмка проекта','Михаил','2026-09-20','2026-09-20',NULL,NULL,5,10,'Результат принят заказчиком',NULL,NULL),
 (3,1,'Технические требования','Анна','2026-09-01','2026-09-01','2026-09-01','2026-09-01',NULL,10,'Требования согласованы с заказчиком',NULL,NULL),
 (3,2,'Спецификация и BOM','Давид','2026-09-01','2026-09-01','2026-09-01','2026-09-01',1,15,'Состав изделия утверждён',NULL,NULL),
 (3,3,'Закупка компонентов','Анна','2026-09-02','2026-09-02','2026-09-02','2026-09-02',2,20,'Все компоненты приняты на склад',NULL,NULL),
 (3,4,'Сборка и комплектация','Давид','2026-09-03','2026-09-03','2026-09-03','2026-09-03',3,30,'Все позиции собраны и проверена комплектность',NULL,NULL),
 (3,5,'Испытания','Давид','2026-09-04','2026-09-04','2026-09-04','2026-09-04',4,15,'Протокол испытаний без открытых замечаний',NULL,NULL),
 (3,6,'Приёмка проекта','Анна','2026-09-05','2026-09-05','2026-09-05','2026-09-05',5,10,'Результат принят заказчиком',NULL,NULL)
ON CONFLICT DO NOTHING;
GRANT SELECT ON projects,project_stages TO dashboard;
COMMIT;
