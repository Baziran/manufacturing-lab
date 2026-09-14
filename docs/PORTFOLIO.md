# Manufacturing Lab: portfolio walkthrough

This personal project translates manufacturing management questions into a working analytical interface. Its value as a portfolio example is the connection between business requirements, data definitions, usable screens and deployment.

## What this project helps assess

**Technical project management:** turning a management question into requirements, priorities and acceptance criteria. **Systems integration:** connecting data, application behavior and operating procedures. **Manufacturing knowledge:** interpreting orders, supply constraints, shipments, payments and quality claims correctly.

I initiated the project, owned its business requirements and directed implementation through review, corrections and acceptance. AI tools generated code and supported technical implementation and deployment. The combination makes both the product decisions and the resulting application available for assessment.

## Two-minute demo

1. [Open the demo](https://83.147.192.229/#sales), select English and September 2026.
2. Compare orders, shipments and payments. Open a metric to see the records that explain it.
3. Open an order and follow its items to the BOM and component shortages. Look at which orders depend on a missing component.
4. Inspect order **102** and its claim: the completed shipment and the later return are distinct events.
5. Open Projects to see milestones, dependencies, acceptance criteria and progress. Progress is separate from shipment or payment status.
6. If time permits, open Health to inspect the application/database and operations evidence. Switch language to Hebrew to see the RTL interface.

The sample periods are August and September 2026. Business facts are constrained by the report date; operational checks have their own timestamps. An unavailable optional service should be read as a demo limitation, not hidden by invented successful results.

## Decisions I can explain

### Keep different business events separate

An order may have several shipments and several payments. Joining them without aggregation can multiply the amounts. The reporting model aggregates these events by order before presenting totals. A later return does not erase an earlier on-time shipment.

### Make an exception actionable

A shortage total alone does not tell a manager what to do. The interface links it to components, expected supply and affected orders. The same principle connects a claim to its original order and a project milestone to its delivery context.

### Separate planned and actual progress

Future dates can contain plans, not future actuals. Period comparisons use equivalent elapsed intervals. The inventory snapshot is explicitly a teaching simplification rather than a claim to a complete warehouse ledger.

### Make delivery part of the project

The repository includes environment setup, tests, Docker packaging, CI/CD and operational exercises. The public application is read-only; administrative work stays outside the browser. The single-server setup and same-server backups remain explicit limitations.

## Contribution and scope

**Grigory Shmykov:** business requirements, metrics, workflow design, prioritization, acceptance review and direction of corrections. **AI assistance:** code generation and technical implementation/deployment support. The project demonstrates using manufacturing and IT experience to direct and evaluate a working system; it is not a claim that all source code was written manually.

All business data and quality documents are synthetic. There are no claims of commercial adoption, cost savings or production availability.

[Back to the project](../README.md)
