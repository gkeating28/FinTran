# Conformance

Rules version 3.0.21. Validator `saxon-js-peppol-bis-3.0.21`.

The CEN EN 16931 and Peppol BIS Schematron files were compiled with the ISO Schematron stylesheets in Saxon-HE 12.5, then exported to SaxonJS SEF with `xslt3`.

The official `base-example.xml` from OpenPeppol produces no `svrl:failed-assert` from either layer. On 25 October 2026 that run took 287 milliseconds in SaxonJS on this project.

XSD validation with a WebAssembly libxml2 build is not wired in this version. The route still refuses a `DOCTYPE`, an external entity, a CII root, and any file that is not a UBL 2.1 Invoice or CreditNote before Schematron runs. Element order is covered by the golden UBL round trip of the four FinTran fixtures.

Negative Peppol unit cases live in the OpenPeppol repository under `rules/unit-UBL-PEPPOL`. They are fragments, so a full Schematron run reports more than the one expected rule. A sampled run is still required before calling the conformance suite complete.
