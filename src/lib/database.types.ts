export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          id: number
          new_values: Json | null
          old_values: Json | null
          organisation_id: string | null
          row_id: string
          table_name: string
          tenant_id: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          id?: never
          new_values?: Json | null
          old_values?: Json | null
          organisation_id?: string | null
          row_id: string
          table_name: string
          tenant_id: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          id?: never
          new_values?: Json | null
          old_values?: Json | null
          organisation_id?: string | null
          row_id?: string
          table_name?: string
          tenant_id?: string
        }
        Relationships: []
      }
      cost_centres: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          description: string
          id: string
          organisation_id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          organisation_id: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          organisation_id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cost_centres_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_centres_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_centres_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_centres_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      currencies: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          id: string
          iso_code: string
          name: string
          organisation_id: string
          rate: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          iso_code: string
          name: string
          organisation_id: string
          rate: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          iso_code?: string
          name?: string
          organisation_id?: string
          rate?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "currencies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "currencies_iso_code_fkey"
            columns: ["iso_code"]
            isOneToOne: false
            referencedRelation: "ref_currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "currencies_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "currencies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "currencies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          address_line3: string | null
          address_needs_review: boolean
          city: string | null
          code: string
          company_number: string | null
          contact_details: string | null
          country_code: string
          county: string | null
          created_at: string
          created_by: string | null
          currency_id: string
          email: string | null
          id: string
          name: string
          notes: string | null
          organisation_id: string
          peppol_id: string | null
          peppol_scheme: string | null
          phone: string | null
          post_code: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          vat_number: string | null
          website: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          address_line3?: string | null
          address_needs_review?: boolean
          city?: string | null
          code: string
          company_number?: string | null
          contact_details?: string | null
          country_code?: string
          county?: string | null
          created_at?: string
          created_by?: string | null
          currency_id: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          organisation_id: string
          peppol_id?: string | null
          peppol_scheme?: string | null
          phone?: string | null
          post_code?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          vat_number?: string | null
          website?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          address_line3?: string | null
          address_needs_review?: boolean
          city?: string | null
          code?: string
          company_number?: string | null
          contact_details?: string | null
          country_code?: string
          county?: string | null
          created_at?: string
          created_by?: string | null
          currency_id?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          organisation_id?: string
          peppol_id?: string | null
          peppol_scheme?: string | null
          phone?: string | null
          post_code?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          vat_number?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "ref_countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "customers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_currency_id_fkey"
            columns: ["organisation_id", "currency_id"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["organisation_id", "id"]
          },
          {
            foreignKeyName: "customers_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_peppol_scheme_fkey"
            columns: ["peppol_scheme"]
            isOneToOne: false
            referencedRelation: "ref_eas"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          description: string
          id: string
          organisation_id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          organisation_id: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          organisation_id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "departments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      gl_codes: {
        Row: {
          account_type: string
          code: string
          created_at: string
          created_by: string | null
          description: string
          id: string
          organisation_id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_type: string
          code: string
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          organisation_id: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_type?: string
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          organisation_id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gl_codes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gl_codes_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gl_codes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gl_codes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organisation_access: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          organisation_id: string
          role: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          organisation_id: string
          role: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          organisation_id?: string
          role?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organisation_access_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organisation_access_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organisation_access_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organisation_access_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organisation_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organisation_defaults: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          address_line3: string | null
          address_needs_review: boolean
          bank_account_name: string | null
          banking_details: string | null
          bic: string | null
          city: string | null
          company_number: string | null
          contact_email: string | null
          contact_name: string | null
          country_code: string
          county: string | null
          created_at: string
          created_by: string | null
          home_currency_id: string | null
          iban: string | null
          lock_date: string | null
          logo_path: string | null
          organisation_id: string
          peppol_id: string | null
          peppol_scheme: string | null
          phone: string | null
          post_code: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          vat_number: string | null
          website: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          address_line3?: string | null
          address_needs_review?: boolean
          bank_account_name?: string | null
          banking_details?: string | null
          bic?: string | null
          city?: string | null
          company_number?: string | null
          contact_email?: string | null
          contact_name?: string | null
          country_code?: string
          county?: string | null
          created_at?: string
          created_by?: string | null
          home_currency_id?: string | null
          iban?: string | null
          lock_date?: string | null
          logo_path?: string | null
          organisation_id: string
          peppol_id?: string | null
          peppol_scheme?: string | null
          phone?: string | null
          post_code?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          vat_number?: string | null
          website?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          address_line3?: string | null
          address_needs_review?: boolean
          bank_account_name?: string | null
          banking_details?: string | null
          bic?: string | null
          city?: string | null
          company_number?: string | null
          contact_email?: string | null
          contact_name?: string | null
          country_code?: string
          county?: string | null
          created_at?: string
          created_by?: string | null
          home_currency_id?: string | null
          iban?: string | null
          lock_date?: string | null
          logo_path?: string | null
          organisation_id?: string
          peppol_id?: string | null
          peppol_scheme?: string | null
          phone?: string | null
          post_code?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          vat_number?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organisation_defaults_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "ref_countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "organisation_defaults_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organisation_defaults_home_currency_id_fkey"
            columns: ["organisation_id", "home_currency_id"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["organisation_id", "id"]
          },
          {
            foreignKeyName: "organisation_defaults_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: true
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organisation_defaults_peppol_scheme_fkey"
            columns: ["peppol_scheme"]
            isOneToOne: false
            referencedRelation: "ref_eas"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "organisation_defaults_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organisation_defaults_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organisations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          slug: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          slug: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          slug?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organisations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organisations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organisations_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          description: string
          id: string
          organisation_id: string
          purchase_gl_code_id: string
          purchase_price: number
          purchase_vat_code_id: string
          sales_gl_code_id: string
          sales_price: number
          sales_vat_code_id: string
          tenant_id: string
          unit_code: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          organisation_id: string
          purchase_gl_code_id: string
          purchase_price: number
          purchase_vat_code_id: string
          sales_gl_code_id: string
          sales_price: number
          sales_vat_code_id: string
          tenant_id: string
          unit_code?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          organisation_id?: string
          purchase_gl_code_id?: string
          purchase_price?: number
          purchase_vat_code_id?: string
          sales_gl_code_id?: string
          sales_price?: number
          sales_vat_code_id?: string
          tenant_id?: string
          unit_code?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_purchase_gl_code_id_fkey"
            columns: ["organisation_id", "purchase_gl_code_id"]
            isOneToOne: false
            referencedRelation: "gl_codes"
            referencedColumns: ["organisation_id", "id"]
          },
          {
            foreignKeyName: "products_purchase_vat_code_id_fkey"
            columns: ["organisation_id", "purchase_vat_code_id"]
            isOneToOne: false
            referencedRelation: "vat_rates"
            referencedColumns: ["organisation_id", "id"]
          },
          {
            foreignKeyName: "products_sales_gl_code_id_fkey"
            columns: ["organisation_id", "sales_gl_code_id"]
            isOneToOne: false
            referencedRelation: "gl_codes"
            referencedColumns: ["organisation_id", "id"]
          },
          {
            foreignKeyName: "products_sales_vat_code_id_fkey"
            columns: ["organisation_id", "sales_vat_code_id"]
            isOneToOne: false
            referencedRelation: "vat_rates"
            referencedColumns: ["organisation_id", "id"]
          },
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_unit_code_fkey"
            columns: ["unit_code"]
            isOneToOne: false
            referencedRelation: "ref_units"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "products_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          email: string
          id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          email: string
          id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          email?: string
          id?: string
        }
        Relationships: []
      }
      ref_countries: {
        Row: {
          active: boolean
          code: string
          name: string
          vat_prefix_only: boolean
        }
        Insert: {
          active?: boolean
          code: string
          name: string
          vat_prefix_only?: boolean
        }
        Update: {
          active?: boolean
          code?: string
          name?: string
          vat_prefix_only?: boolean
        }
        Relationships: []
      }
      ref_currencies: {
        Row: {
          active: boolean
          code: string
          minor_units: number | null
          name: string
        }
        Insert: {
          active?: boolean
          code: string
          minor_units?: number | null
          name: string
        }
        Update: {
          active?: boolean
          code?: string
          minor_units?: number | null
          name?: string
        }
        Relationships: []
      }
      ref_eas: {
        Row: {
          active: boolean
          code: string
          name: string
        }
        Insert: {
          active?: boolean
          code: string
          name: string
        }
        Update: {
          active?: boolean
          code?: string
          name?: string
        }
        Relationships: []
      }
      ref_payment_means: {
        Row: {
          active: boolean
          code: string
          common: boolean
          name: string
        }
        Insert: {
          active?: boolean
          code: string
          common?: boolean
          name: string
        }
        Update: {
          active?: boolean
          code?: string
          common?: boolean
          name?: string
        }
        Relationships: []
      }
      ref_units: {
        Row: {
          active: boolean
          code: string
          common: boolean
          name: string
        }
        Insert: {
          active?: boolean
          code: string
          common?: boolean
          name: string
        }
        Update: {
          active?: boolean
          code?: string
          common?: boolean
          name?: string
        }
        Relationships: []
      }
      ref_vat_categories: {
        Row: {
          active: boolean
          code: string
          name: string
          rate_must_be_zero: boolean
          requires_exemption_reason: boolean
        }
        Insert: {
          active?: boolean
          code: string
          name: string
          rate_must_be_zero: boolean
          requires_exemption_reason: boolean
        }
        Update: {
          active?: boolean
          code?: string
          name?: string
          rate_must_be_zero?: boolean
          requires_exemption_reason?: boolean
        }
        Relationships: []
      }
      ref_vatex: {
        Row: {
          active: boolean
          code: string
          name: string
        }
        Insert: {
          active?: boolean
          code: string
          name: string
        }
        Update: {
          active?: boolean
          code?: string
          name?: string
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          address_line3: string | null
          address_needs_review: boolean
          city: string | null
          code: string
          company_number: string | null
          contact_details: string | null
          country_code: string
          county: string | null
          created_at: string
          created_by: string | null
          currency_id: string
          email: string | null
          id: string
          name: string
          notes: string | null
          organisation_id: string
          peppol_id: string | null
          peppol_scheme: string | null
          phone: string | null
          post_code: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          vat_number: string | null
          website: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          address_line3?: string | null
          address_needs_review?: boolean
          city?: string | null
          code: string
          company_number?: string | null
          contact_details?: string | null
          country_code?: string
          county?: string | null
          created_at?: string
          created_by?: string | null
          currency_id: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          organisation_id: string
          peppol_id?: string | null
          peppol_scheme?: string | null
          phone?: string | null
          post_code?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          vat_number?: string | null
          website?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          address_line3?: string | null
          address_needs_review?: boolean
          city?: string | null
          code?: string
          company_number?: string | null
          contact_details?: string | null
          country_code?: string
          county?: string | null
          created_at?: string
          created_by?: string | null
          currency_id?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          organisation_id?: string
          peppol_id?: string | null
          peppol_scheme?: string | null
          phone?: string | null
          post_code?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          vat_number?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "ref_countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "suppliers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suppliers_currency_id_fkey"
            columns: ["organisation_id", "currency_id"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["organisation_id", "id"]
          },
          {
            foreignKeyName: "suppliers_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suppliers_peppol_scheme_fkey"
            columns: ["peppol_scheme"]
            isOneToOne: false
            referencedRelation: "ref_eas"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "suppliers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suppliers_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          slug: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          slug: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          slug?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenants_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenants_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_forms: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          layout: Json
          organisation_id: string
          tenant_id: string
          transaction_type_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          layout: Json
          organisation_id: string
          tenant_id: string
          transaction_type_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          layout?: Json
          organisation_id?: string
          tenant_id?: string
          transaction_type_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transaction_forms_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_forms_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_forms_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_forms_transaction_type_id_fkey"
            columns: ["organisation_id", "transaction_type_id"]
            isOneToOne: true
            referencedRelation: "transaction_types"
            referencedColumns: ["organisation_id", "id"]
          },
          {
            foreignKeyName: "transaction_forms_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_headers: {
        Row: {
          amount_due: number
          contact_details: string | null
          created_at: string
          created_by: string | null
          currency_id: string
          customer_id: string | null
          due_date: string | null
          exchange_rate: number
          flex1: string | null
          flex2: string | null
          flex3: string | null
          flex4: string | null
          flex5: string | null
          foreign_nett_amount: number
          foreign_total_amount: number
          foreign_vat_amount: number
          home_nett_amount: number
          home_total_amount: number
          home_vat_amount: number
          id: string
          issuer_snapshot: Json | null
          notes: string | null
          order_number: string | null
          organisation_id: string
          paid_amount: number
          party_snapshot: Json | null
          posted_at: string | null
          posted_by: string | null
          preceding_date: string | null
          preceding_header_id: string | null
          preceding_reference: string | null
          reference: number | null
          rounding_amount: number
          status: Database["public"]["Enums"]["document_status"]
          supplier_id: string | null
          supplier_name: string
          supplier_reference: string | null
          supply_date: string | null
          tenant_id: string
          transaction_date: string
          transaction_type_id: string
          updated_at: string
          updated_by: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount_due: number
          contact_details?: string | null
          created_at?: string
          created_by?: string | null
          currency_id: string
          customer_id?: string | null
          due_date?: string | null
          exchange_rate: number
          flex1?: string | null
          flex2?: string | null
          flex3?: string | null
          flex4?: string | null
          flex5?: string | null
          foreign_nett_amount?: number
          foreign_total_amount?: number
          foreign_vat_amount?: number
          home_nett_amount?: number
          home_total_amount?: number
          home_vat_amount?: number
          id?: string
          issuer_snapshot?: Json | null
          notes?: string | null
          order_number?: string | null
          organisation_id: string
          paid_amount?: number
          party_snapshot?: Json | null
          posted_at?: string | null
          posted_by?: string | null
          preceding_date?: string | null
          preceding_header_id?: string | null
          preceding_reference?: string | null
          reference?: number | null
          rounding_amount?: number
          status?: Database["public"]["Enums"]["document_status"]
          supplier_id?: string | null
          supplier_name: string
          supplier_reference?: string | null
          supply_date?: string | null
          tenant_id: string
          transaction_date: string
          transaction_type_id: string
          updated_at?: string
          updated_by?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount_due?: number
          contact_details?: string | null
          created_at?: string
          created_by?: string | null
          currency_id?: string
          customer_id?: string | null
          due_date?: string | null
          exchange_rate?: number
          flex1?: string | null
          flex2?: string | null
          flex3?: string | null
          flex4?: string | null
          flex5?: string | null
          foreign_nett_amount?: number
          foreign_total_amount?: number
          foreign_vat_amount?: number
          home_nett_amount?: number
          home_total_amount?: number
          home_vat_amount?: number
          id?: string
          issuer_snapshot?: Json | null
          notes?: string | null
          order_number?: string | null
          organisation_id?: string
          paid_amount?: number
          party_snapshot?: Json | null
          posted_at?: string | null
          posted_by?: string | null
          preceding_date?: string | null
          preceding_header_id?: string | null
          preceding_reference?: string | null
          reference?: number | null
          rounding_amount?: number
          status?: Database["public"]["Enums"]["document_status"]
          supplier_id?: string | null
          supplier_name?: string
          supplier_reference?: string | null
          supply_date?: string | null
          tenant_id?: string
          transaction_date?: string
          transaction_type_id?: string
          updated_at?: string
          updated_by?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transaction_headers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_headers_currency_id_fkey"
            columns: ["organisation_id", "currency_id"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["organisation_id", "id"]
          },
          {
            foreignKeyName: "transaction_headers_customer_id_fkey"
            columns: ["organisation_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organisation_id", "id"]
          },
          {
            foreignKeyName: "transaction_headers_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_headers_posted_by_fkey"
            columns: ["posted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_headers_preceding_header_id_fkey"
            columns: ["organisation_id", "preceding_header_id"]
            isOneToOne: false
            referencedRelation: "transaction_headers"
            referencedColumns: ["organisation_id", "id"]
          },
          {
            foreignKeyName: "transaction_headers_supplier_id_fkey"
            columns: ["organisation_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["organisation_id", "id"]
          },
          {
            foreignKeyName: "transaction_headers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_headers_transaction_type_id_fkey"
            columns: ["organisation_id", "transaction_type_id"]
            isOneToOne: false
            referencedRelation: "transaction_types"
            referencedColumns: ["organisation_id", "id"]
          },
          {
            foreignKeyName: "transaction_headers_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_headers_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_lines: {
        Row: {
          cost_centre_id: string | null
          created_at: string
          created_by: string | null
          department_id: string | null
          description: string
          discount_amount: number
          exemption_code: string | null
          exemption_reason: string | null
          gl_code_id: string | null
          header_id: string
          id: string
          line_note: string | null
          line_number: number
          nett_amount: number
          organisation_id: string
          price: number
          product_id: string | null
          quantity: number
          reference: number | null
          seller_item_id: string | null
          tenant_id: string
          transaction_type_id: string
          unit_code: string
          updated_at: string
          updated_by: string | null
          vat_amount: number
          vat_category: string
          vat_percentage: number
          vat_rate_id: string | null
        }
        Insert: {
          cost_centre_id?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          description: string
          discount_amount?: number
          exemption_code?: string | null
          exemption_reason?: string | null
          gl_code_id?: string | null
          header_id: string
          id?: string
          line_note?: string | null
          line_number: number
          nett_amount: number
          organisation_id: string
          price: number
          product_id?: string | null
          quantity: number
          reference?: number | null
          seller_item_id?: string | null
          tenant_id: string
          transaction_type_id: string
          unit_code?: string
          updated_at?: string
          updated_by?: string | null
          vat_amount: number
          vat_category?: string
          vat_percentage?: number
          vat_rate_id?: string | null
        }
        Update: {
          cost_centre_id?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          description?: string
          discount_amount?: number
          exemption_code?: string | null
          exemption_reason?: string | null
          gl_code_id?: string | null
          header_id?: string
          id?: string
          line_note?: string | null
          line_number?: number
          nett_amount?: number
          organisation_id?: string
          price?: number
          product_id?: string | null
          quantity?: number
          reference?: number | null
          seller_item_id?: string | null
          tenant_id?: string
          transaction_type_id?: string
          unit_code?: string
          updated_at?: string
          updated_by?: string | null
          vat_amount?: number
          vat_category?: string
          vat_percentage?: number
          vat_rate_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transaction_lines_cost_centre_id_fkey"
            columns: ["organisation_id", "cost_centre_id"]
            isOneToOne: false
            referencedRelation: "cost_centres"
            referencedColumns: ["organisation_id", "id"]
          },
          {
            foreignKeyName: "transaction_lines_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_lines_department_id_fkey"
            columns: ["organisation_id", "department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["organisation_id", "id"]
          },
          {
            foreignKeyName: "transaction_lines_exemption_code_fkey"
            columns: ["exemption_code"]
            isOneToOne: false
            referencedRelation: "ref_vatex"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "transaction_lines_gl_code_id_fkey"
            columns: ["organisation_id", "gl_code_id"]
            isOneToOne: false
            referencedRelation: "gl_codes"
            referencedColumns: ["organisation_id", "id"]
          },
          {
            foreignKeyName: "transaction_lines_header_id_fkey"
            columns: ["organisation_id", "header_id"]
            isOneToOne: false
            referencedRelation: "transaction_headers"
            referencedColumns: ["organisation_id", "id"]
          },
          {
            foreignKeyName: "transaction_lines_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_lines_product_id_fkey"
            columns: ["organisation_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["organisation_id", "id"]
          },
          {
            foreignKeyName: "transaction_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_lines_transaction_type_id_fkey"
            columns: ["organisation_id", "transaction_type_id"]
            isOneToOne: false
            referencedRelation: "transaction_types"
            referencedColumns: ["organisation_id", "id"]
          },
          {
            foreignKeyName: "transaction_lines_unit_code_fkey"
            columns: ["unit_code"]
            isOneToOne: false
            referencedRelation: "ref_units"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "transaction_lines_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_lines_vat_category_fkey"
            columns: ["vat_category"]
            isOneToOne: false
            referencedRelation: "ref_vat_categories"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "transaction_lines_vat_rate_id_fkey"
            columns: ["organisation_id", "vat_rate_id"]
            isOneToOne: false
            referencedRelation: "vat_rates"
            referencedColumns: ["organisation_id", "id"]
          },
        ]
      }
      transaction_types: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          description: string
          document_kind: Database["public"]["Enums"]["document_kind"]
          flex1_label: string | null
          flex2_label: string | null
          flex3_label: string | null
          flex4_label: string | null
          flex5_label: string | null
          id: string
          last_reference: number
          numbering: Database["public"]["Enums"]["numbering_rule"]
          organisation_id: string
          tenant_id: string
          type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          description: string
          document_kind?: Database["public"]["Enums"]["document_kind"]
          flex1_label?: string | null
          flex2_label?: string | null
          flex3_label?: string | null
          flex4_label?: string | null
          flex5_label?: string | null
          id?: string
          last_reference: number
          numbering?: Database["public"]["Enums"]["numbering_rule"]
          organisation_id: string
          tenant_id: string
          type: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string
          document_kind?: Database["public"]["Enums"]["document_kind"]
          flex1_label?: string | null
          flex2_label?: string | null
          flex3_label?: string | null
          flex4_label?: string | null
          flex5_label?: string | null
          id?: string
          last_reference?: number
          numbering?: Database["public"]["Enums"]["numbering_rule"]
          organisation_id?: string
          tenant_id?: string
          type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transaction_types_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_types_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_types_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_types_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_vat_breakdown: {
        Row: {
          exemption_code: string | null
          exemption_reason: string | null
          header_id: string
          organisation_id: string
          taxable_amount: number
          tenant_id: string
          vat_amount: number
          vat_category: string
          vat_percentage: number
        }
        Insert: {
          exemption_code?: string | null
          exemption_reason?: string | null
          header_id: string
          organisation_id: string
          taxable_amount: number
          tenant_id: string
          vat_amount: number
          vat_category: string
          vat_percentage: number
        }
        Update: {
          exemption_code?: string | null
          exemption_reason?: string | null
          header_id?: string
          organisation_id?: string
          taxable_amount?: number
          tenant_id?: string
          vat_amount?: number
          vat_category?: string
          vat_percentage?: number
        }
        Relationships: [
          {
            foreignKeyName: "transaction_vat_breakdown_exemption_code_fkey"
            columns: ["exemption_code"]
            isOneToOne: false
            referencedRelation: "ref_vatex"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "transaction_vat_breakdown_organisation_id_header_id_fkey"
            columns: ["organisation_id", "header_id"]
            isOneToOne: false
            referencedRelation: "transaction_headers"
            referencedColumns: ["organisation_id", "id"]
          },
          {
            foreignKeyName: "transaction_vat_breakdown_vat_category_fkey"
            columns: ["vat_category"]
            isOneToOne: false
            referencedRelation: "ref_vat_categories"
            referencedColumns: ["code"]
          },
        ]
      }
      vat_rates: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          description: string
          exemption_code: string | null
          exemption_reason: string | null
          id: string
          organisation_id: string
          rate: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
          vat_category: string
          vat_type: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          description: string
          exemption_code?: string | null
          exemption_reason?: string | null
          id?: string
          organisation_id: string
          rate: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          vat_category: string
          vat_type: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string
          exemption_code?: string | null
          exemption_reason?: string | null
          id?: string
          organisation_id?: string
          rate?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          vat_category?: string
          vat_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "vat_rates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vat_rates_exemption_code_fkey"
            columns: ["exemption_code"]
            isOneToOne: false
            referencedRelation: "ref_vatex"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "vat_rates_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vat_rates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vat_rates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vat_rates_vat_category_fkey"
            columns: ["vat_category"]
            isOneToOne: false
            referencedRelation: "ref_vat_categories"
            referencedColumns: ["code"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_organisation: {
        Args: { organisation_name: string; p_tenant_id: string }
        Returns: string
      }
      create_tenant: {
        Args: { organisation_name: string; tenant_name: string }
        Returns: Json
      }
      delete_organisation: {
        Args: { p_organisation_id: string }
        Returns: undefined
      }
      grant_organisation_access: {
        Args: { p_email: string; p_organisation_id: string; p_role: string }
        Returns: undefined
      }
      post_document: {
        Args: { p_header_id: string; p_logo_path?: string }
        Returns: undefined
      }
      revoke_organisation_access: {
        Args: { p_organisation_id: string; p_user_id: string }
        Returns: undefined
      }
      save_purchase_invoice: { Args: { p_document: Json }; Returns: string }
      void_document: {
        Args: { p_header_id: string; p_reason: string }
        Returns: undefined
      }
    }
    Enums: {
      document_kind: "invoice" | "credit_note" | "order"
      document_status: "draft" | "posted" | "void"
      numbering_rule: "on_insert" | "on_post"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      document_kind: ["invoice", "credit_note", "order"],
      document_status: ["draft", "posted", "void"],
      numbering_rule: ["on_insert", "on_post"],
    },
  },
} as const
