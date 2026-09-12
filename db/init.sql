-- Синтетические данные. Это учебная фабрика, не данные Mechanical Devices.
BEGIN;
CREATE TABLE customers (
    customer_id integer PRIMARY KEY, name text NOT NULL,
    city text NOT NULL, manager text NOT NULL
);
CREATE TABLE products (
    product_id integer PRIMARY KEY, sku text UNIQUE NOT NULL,
    name text NOT NULL, unit_price numeric(12,2) NOT NULL CHECK(unit_price > 0)
);
CREATE TABLE orders (
    order_id integer PRIMARY KEY, customer_id integer NOT NULL REFERENCES customers,
    product_id integer NOT NULL REFERENCES products,
    order_date date NOT NULL, original_due_date date NOT NULL, due_date date NOT NULL,
    quantity integer NOT NULL CHECK(quantity > 0), unit_price numeric(12,2) NOT NULL CHECK(unit_price > 0),
    status text NOT NULL CHECK(status IN ('active','cancelled')),
    channel text NOT NULL, delay_reason text NOT NULL DEFAULT '',
    CHECK(due_date >= order_date)
);
CREATE TABLE shipments (
    shipment_id integer PRIMARY KEY, order_id integer NOT NULL REFERENCES orders,
    shipped_at date NOT NULL, quantity integer NOT NULL CHECK(quantity > 0)
);
CREATE TABLE payments (
    payment_id integer PRIMARY KEY, order_id integer NOT NULL REFERENCES orders,
    paid_at date NOT NULL, amount numeric(12,2) NOT NULL CHECK(amount <> 0),
    note text NOT NULL DEFAULT ''
);
CREATE TABLE components (
    component_id integer PRIMARY KEY, sku text UNIQUE NOT NULL,
    name text NOT NULL, unit text NOT NULL DEFAULT 'шт.', supplier text NOT NULL
);
CREATE TABLE bom (
    product_id integer NOT NULL REFERENCES products,
    component_id integer NOT NULL REFERENCES components,
    quantity integer NOT NULL CHECK(quantity > 0),
    PRIMARY KEY(product_id,component_id)
);
CREATE TABLE inventory (
    component_id integer PRIMARY KEY REFERENCES components,
    on_hand integer NOT NULL CHECK(on_hand >= 0),
    reserved_external integer NOT NULL CHECK(reserved_external >= 0 AND reserved_external <= on_hand)
);
CREATE TABLE purchase_orders (
    purchase_id integer PRIMARY KEY, component_id integer NOT NULL REFERENCES components,
    quantity integer NOT NULL CHECK(quantity > 0), expected_at date NOT NULL,
    status text NOT NULL CHECK(status IN ('confirmed','unconfirmed'))
);
INSERT INTO customers VALUES
(1,'Orion Labs','Хайфа','Анна'),(2,'Vector Electronics','Йокнеам','Михаил'),
(3,'Carmel Systems','Хайфа','Анна'),(4,'Nova Instruments','Тель-Авив','Давид'),
(5,'Atlas Research','Реховот','Михаил'),(6,'Negev Robotics','Беэр-Шева','Давид'),
(7,'Galil Engineering','Кармиэль','Анна'),(8,'Delta Micro','Нетания','Михаил'),
(9,'Helix Devices','Петах-Тиква','Давид'),(10,'Northstar Tech','Хайфа','Анна'),
(11,'Prism Analytics','Герцлия','Михаил'),(12,'Vertex Testing','Ашдод','Давид');
INSERT INTO products VALUES
(1,'TC-100','Термоконтроллер Compact',12000),(2,'TC-200','Термоконтроллер Pro',18000),
(3,'TH-10','Термоголовка Standard',6000),(4,'TH-20','Термоголовка Precision',9000),
(5,'CT-01','Контрольный модуль',4500),(6,'PS-24','Блок питания 24V',2500),
(7,'SN-K','Комплект датчиков',1500),(8,'CL-10','Охлаждающий модуль',8000),
(9,'FX-01','Оснастка для испытаний',3500),(10,'IF-02','Модуль интерфейса',5000),
(11,'TC-300','Термоконтроллер Max',24000),(12,'ST-01','Сервисный комплект',2000);
INSERT INTO orders VALUES
(101,1,1,'2026-09-01','2026-09-05','2026-09-05',2,12000,'active','Прямые продажи',''),
(102,2,2,'2026-09-02','2026-09-07','2026-09-07',3,18000,'active','Партнёры','Нет комплектующих'),
(103,3,3,'2026-09-03','2026-09-09','2026-09-09',4,6000,'active','Сайт','Повторное испытание'),
(104,4,4,'2026-09-04','2026-09-08','2026-09-10',2,9000,'active','Прямые продажи','Нет комплектующих'),
(105,5,5,'2026-09-05','2026-09-12','2026-09-12',4,4500,'active','Партнёры','Ожидание сборки'),
(106,6,6,'2026-09-06','2026-09-14','2026-09-14',4,2500,'active','Сайт',''),
(107,7,7,'2026-09-07','2026-09-15','2026-09-15',5,1500,'active','Прямые продажи',''),
(108,8,8,'2026-09-08','2026-09-16','2026-09-16',3,8000,'active','Партнёры','Нет комплектующих'),
(109,9,9,'2026-09-09','2026-09-17','2026-09-17',4,3500,'active','Сайт',''),
(110,10,10,'2026-09-10','2026-09-18','2026-09-18',2,5000,'active','Прямые продажи',''),
(111,11,11,'2026-09-11','2026-09-20','2026-09-20',2,24000,'active','Партнёры',''),
(112,12,12,'2026-09-12','2026-09-22','2026-09-22',3,2000,'cancelled','Сайт','Отмена клиента');
INSERT INTO shipments VALUES
(1,101,'2026-09-03',1),(2,101,'2026-09-04',1),
(3,102,'2026-09-06',1),(4,103,'2026-09-08',1),(5,103,'2026-09-10',3),
(6,105,'2026-09-11',1),(7,105,'2026-09-12',1),
(8,107,'2026-09-10',2),(9,107,'2026-09-11',3),
(10,109,'2026-09-12',1),(11,111,'2026-09-12',1),
(12,102,'2026-09-15',2),(13,104,'2026-09-16',2),
(14,106,'2026-09-14',4),(15,108,'2026-09-18',3);
INSERT INTO payments VALUES
(1,101,'2026-09-01',12000,'Аванс'),(2,101,'2026-09-04',12000,'Окончательный расчёт'),
(3,102,'2026-09-02',18000,'Аванс'),(4,102,'2026-09-07',9000,'Частичная оплата'),
(5,103,'2026-09-03',24000,'Оплата'),(6,104,'2026-09-04',18000,'Оплата'),
(7,105,'2026-09-06',9000,'Аванс'),(8,106,'2026-09-07',10000,'Оплата'),
(9,107,'2026-09-08',7500,'Оплата'),(10,108,'2026-09-09',12000,'Аванс'),
(11,109,'2026-09-10',14000,'Оплата'),(12,110,'2026-09-11',12000,'Переплата'),
(13,111,'2026-09-12',24000,'Аванс'),(14,103,'2026-09-12',-2000,'Возврат платежа; сумма заказа сохранена'),
(15,102,'2026-09-16',27000,'Окончательный расчёт');
INSERT INTO components VALUES
(1,'C-101','Плата управления','шт.','CircuitWorks'),(2,'C-102','Модуль Пельтье','шт.','ThermoParts'),
(3,'C-103','Датчик температуры','шт.','SensorLab'),(4,'C-104','Корпус Precision','шт.','MetalCraft'),
(5,'C-105','Дисплей 4.3″','шт.','DisplayOne'),(6,'C-106','Трансформатор 24V','шт.','PowerLine'),
(7,'C-107','Разъём датчика','шт.','ConnectPro'),(8,'C-108','Радиатор охлаждения','шт.','ThermoParts'),
(9,'C-109','Монтажная пластина','шт.','MetalCraft'),(10,'C-110','Ethernet-модуль','шт.','CircuitWorks'),
(11,'C-111','Силовой модуль','шт.','PowerLine'),(12,'C-112','Уплотнитель','шт.','SealTech');
INSERT INTO bom VALUES
(1,1,1),(1,2,2),(2,1,1),(2,2,4),(3,3,1),(4,4,1),(4,3,2),
(5,5,1),(6,6,1),(7,7,2),(8,8,1),(9,9,1),(10,10,1),(11,11,2),(12,12,1);
INSERT INTO inventory VALUES
(1,4,3),(2,7,2),(3,8,5),(4,1,0),(5,10,2),(6,8,2),
(7,20,0),(8,2,1),(9,6,2),(10,3,0),(11,2,1),(12,30,0);
INSERT INTO purchase_orders VALUES
(1,1,6,'2026-09-15','confirmed'),(2,2,10,'2026-09-16','confirmed'),
(3,3,8,'2026-09-14','confirmed'),(4,4,3,'2026-09-18','unconfirmed'),
(5,5,10,'2026-09-20','confirmed'),(6,6,5,'2026-09-17','confirmed'),
(7,7,20,'2026-09-22','confirmed'),(8,8,4,'2026-09-15','confirmed'),
(9,9,6,'2026-09-19','confirmed'),(10,10,5,'2026-09-20','unconfirmed'),
(11,11,4,'2026-09-19','confirmed'),(12,12,10,'2026-09-25','confirmed');
CREATE INDEX ON orders(order_date);
CREATE INDEX ON shipments(order_id,shipped_at);
CREATE INDEX ON payments(order_id,paid_at);
CREATE ROLE dashboard LOGIN;
GRANT CONNECT ON DATABASE manufacturing_lab TO dashboard;
GRANT USAGE ON SCHEMA public TO dashboard;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dashboard;
ALTER ROLE dashboard SET default_transaction_read_only = on;
COMMENT ON TABLE inventory IS 'Фиксированный учебный снимок. Резервы относятся к внешним заказам, не показанным в этом наборе.';
COMMIT;
