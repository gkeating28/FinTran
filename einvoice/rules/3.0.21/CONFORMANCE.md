# Conformance

Rules version 3.0.21. Validator `saxon-js-peppol-bis-3.0.21`.

The CEN EN 16931 and Peppol BIS Schematron files were compiled with the ISO Schematron stylesheets in Saxon-HE 12.5, then exported to SaxonJS SEF with `xslt3`.

The official `base-example.xml` from OpenPeppol produces no `svrl:failed-assert` from either layer. On 25 October 2026 that run took 287 milliseconds in SaxonJS on this project.

XSD validation uses `xmllint-wasm` 5.3.0 (libxml2 compiled to WebAssembly) and the OASIS UBL 2.1 schemas pinned in `xsd/`. An invoice is checked against `UBL-Invoice-2.1.xsd` and a credit note against `UBL-CreditNote-2.1.xsd`. A fatal XSD error stops Schematron. Each failure records the line and, when libxml gives only a line, the column of the first character on that line.

The golden outbound files `sales-invoice`, `sales-credit-note`, and `sales-reverse-charge` pass. The OpenPeppol billing examples in `einvoice/examples` pass: `base-example.xml`, `base-example_profile02.xml`, `base-creditnote-correction.xml`, `base-negative-inv-correction.xml`, `Allowance-example.xml`, `sales-order-example.xml`, and the VAT category examples. A local run of the sales invoice schema check completed in under a second. A sales invoice padded to the 4 MB limit passed XSD and Schematron in 1,281 ms on 6 November 2026. The purchase fixture is not an outbound file; its `PaymentID` is not in the UBL element order, so XSD reports it. That difference is explained by the fixture, not by the schema.

Negative Peppol unit cases live in the OpenPeppol repository under `rules/unit-UBL-PEPPOL`. They are fragments, so a full Schematron run reports more than the one expected rule. A sampled run is still required before calling the conformance suite complete.
