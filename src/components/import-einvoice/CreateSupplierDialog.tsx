"use client";

import { PartyForm } from "@/components/PartyManager";
import { semanticRecord, semanticText } from "@/lib/einvoice/semantic-read";
import { paymentTermsDays, suggestSupplierCode } from "@/lib/supplier-from-invoice";
import { createClient } from "@/lib/supabase/client";
import type { Supplier } from "./types";
import type { ImportFormState } from "./useImportForm";

/** The supplier form, filled in from the e-invoice, opened by Create New. */
export function CreateSupplierDialog({ form }: { form: ImportFormState }) {
  const { semantic, organisationId, homeCurrencyId, suppliers, setSuppliers, currencies, setSupplierId, showCreate, setShowCreate, countries, schemes, seller, sellerName, endpoint, invoiceCurrency } = form;
  return (
    showCreate ? (
      <PartyForm
        kind="suppliers"
        row={null}
        currencies={currencies.map((currency) => ({ id: currency.id, code: currency.code, name: currency.code }))}
        countries={countries}
        schemes={schemes}
        homeCurrencyId={homeCurrencyId}
        notice={currencies.some((currency) => currency.iso_code === semanticText(semantic?.["BT-5"]) || currency.code === semanticText(semantic?.["BT-5"])) ? null : `Add the invoice currency ${semanticText(semantic?.["BT-5"])} before saving this supplier.`}
        blockSave={!currencies.some((currency) => currency.iso_code === semanticText(semantic?.["BT-5"]) || currency.code === semanticText(semantic?.["BT-5"]))}
        seed={{
          code: suggestSupplierCode(sellerName, suppliers.map((supplier) => supplier.code)),
          name: sellerName,
          vatNumber: semanticText(seller?.["BT-31"]),
          companyNumber: semanticText(seller?.["BT-30"]),
          peppolScheme: endpoint.scheme,
          peppolId: endpoint.id,
          addressLine1: semanticText(semanticRecord(seller?.["BG-5"])?.["BT-35"]),
          addressLine2: semanticText(semanticRecord(seller?.["BG-5"])?.["BT-36"]),
          addressLine3: semanticText(semanticRecord(seller?.["BG-5"])?.["BT-162"]),
          city: semanticText(semanticRecord(seller?.["BG-5"])?.["BT-37"]),
          postCode: semanticText(semanticRecord(seller?.["BG-5"])?.["BT-38"]),
          county: semanticText(semanticRecord(seller?.["BG-5"])?.["BT-39"]),
          countryCode: semanticText(semanticRecord(seller?.["BG-5"])?.["BT-40"]) || "IE",
          email: semanticText(semanticRecord(seller?.["BG-6"])?.["BT-43"]),
          phone: semanticText(semanticRecord(seller?.["BG-6"])?.["BT-42"]),
          paymentTermsDays: paymentTermsDays(semanticText(semantic?.["BT-2"]), semanticText(semantic?.["BT-9"])),
          currencyId: invoiceCurrency?.id ?? "",
        }}
        onSaved={(savedCode) => {
          const supabase = createClient();
          void supabase.from("suppliers").select("id, name, code, vat_number, peppol_scheme, peppol_id, currency_id").eq("organisation_id", organisationId).then((result) => {
            const list = (result.data ?? []) as Supplier[];
            setSuppliers(list);
            const created = list.find((supplier) => supplier.code === savedCode);
            if (created) setSupplierId(created.id);
          });
        }}
        onClose={() => setShowCreate(false)}
      />
    ) : null
  );
}
