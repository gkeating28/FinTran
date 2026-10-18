"use client";

import { useActionState, useEffect, useState } from "react";
import {
  createOrganisation,
  createTenant,
  grantAccess,
  signIn,
  signUp,
} from "@/lib/actions";
import FormModal from "@/components/FormModal";
import { QuietInput } from "@/components/QuietField";
import type { ActionState, Role } from "@/lib/types";
import auth from "@/components/auth.module.css";
import ops from "@/components/OpsPage.module.css";

function Status({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p className={ops.alert} role="alert">
        {state.error}
      </p>
    );
  }
  if (state.message) {
    return (
      <p className={ops.notice} role="status">
        {state.message}
      </p>
    );
  }
  return null;
}

export function SignInForm({ initialError }: { initialError?: string }) {
  const [state, action, pending] = useActionState(signIn, {
    error: initialError,
  });

  return (
    <form className={auth.form} action={action}>
      {state.error ? (
        <p className={auth.alert} role="alert">
          {state.error}
        </p>
      ) : null}
      <label className={auth.field}>
        Email
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label className={auth.field}>
        Password
        <input name="password" type="password" autoComplete="current-password" required minLength={8} />
      </label>
      <button className={auth.submit} type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export function SignUpForm() {
  const [state, action, pending] = useActionState(signUp, {});

  return (
    <form className={auth.form} action={action}>
      {state.error ? (
        <p className={auth.alert} role="alert">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p className={auth.notice} role="status">
          {state.message}
        </p>
      ) : null}
      <label className={auth.field}>
        Name
        <input name="displayName" type="text" autoComplete="name" maxLength={80} />
      </label>
      <label className={auth.field}>
        Email
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label className={auth.field}>
        Password
        <input name="password" type="password" autoComplete="new-password" required minLength={8} />
      </label>
      <button className={auth.submit} type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}

export function CreateTenantForm() {
  const [open, setOpen] = useState(false);

  return (
    <span>
      <button className={ops.primary} type="button" onClick={() => setOpen(true)}>
        Create tenant
      </button>
      {open ? (
        <FormModal title="Create tenant" onClose={() => setOpen(false)}>
          <TenantFields />
        </FormModal>
      ) : null}
    </span>
  );
}

function TenantFields() {
  const [state, action, pending] = useActionState(createTenant, {});

  return (
    <form className={ops.modalForm} action={action} autoComplete="off" noValidate>
      <Status state={state} />
      <label className={ops.field}>
        Tenant
        <QuietInput name="tenantName" required minLength={2} maxLength={80} autoFocus placeholder="Northwind Group" />
      </label>
      <label className={ops.field}>
        First organisation
        <QuietInput name="organisationName" required minLength={2} maxLength={80} placeholder="Northwind Ltd" />
      </label>
      <div className={ops.modalActions}>
        <button className={ops.primary} type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create tenant"}
        </button>
      </div>
    </form>
  );
}

export function CreateOrganisationForm({ tenantId }: { tenantId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <span>
      <button className={ops.primary} type="button" onClick={() => setOpen(true)}>
        Add organisation
      </button>
      {open ? (
        <FormModal title="Add organisation" onClose={() => setOpen(false)}>
          <OrganisationFields tenantId={tenantId} />
        </FormModal>
      ) : null}
    </span>
  );
}

function OrganisationFields({ tenantId }: { tenantId: string }) {
  const [state, action, pending] = useActionState(createOrganisation, {});

  return (
    <form className={ops.modalForm} action={action} autoComplete="off" noValidate>
      <input type="hidden" name="tenantId" value={tenantId} />
      <Status state={state} />
      <label className={ops.field}>
        Organisation
        <QuietInput name="organisationName" required minLength={2} maxLength={80} autoFocus placeholder="Harbour Trading" />
      </label>
      <div className={ops.modalActions}>
        <button className={ops.primary} type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add organisation"}
        </button>
      </div>
    </form>
  );
}

export function GrantAccessForm({
  organisationId,
  callerRole,
}: {
  organisationId: string;
  callerRole: Role;
}) {
  const [open, setOpen] = useState(false);

  return (
    <span>
      <button className={ops.primary} type="button" onClick={() => setOpen(true)}>
        Grant access
      </button>
      {open ? (
        <FormModal title="Grant access" onClose={() => setOpen(false)}>
          <AccessFields
            organisationId={organisationId}
            callerRole={callerRole}
            onSaved={() => setOpen(false)}
          />
        </FormModal>
      ) : null}
    </span>
  );
}

function AccessFields({
  organisationId,
  callerRole,
  onSaved,
}: {
  organisationId: string;
  callerRole: Role;
  onSaved: () => void;
}) {
  const [state, action, pending] = useActionState(grantAccess, {});

  useEffect(() => {
    if (state.message) onSaved();
  }, [state.message, onSaved]);

  return (
    <form className={ops.modalForm} action={action} autoComplete="off" noValidate>
      <input type="hidden" name="organisationId" value={organisationId} />
      <Status state={state} />
      <label className={ops.field}>
        Email
        <QuietInput name="email" type="text" inputMode="email" required autoFocus placeholder="colleague@company.com" />
      </label>
      <label className={ops.field}>
        Role
        <select name="role" defaultValue="member" autoComplete="off">
          <option value="member">Member</option>
          {callerRole === "owner" ? <option value="admin">Admin</option> : null}
          {callerRole === "owner" ? <option value="owner">Owner</option> : null}
        </select>
      </label>
      <div className={ops.modalActions}>
        <button className={ops.primary} type="submit" disabled={pending}>
          {pending ? "Granting…" : "Grant access"}
        </button>
      </div>
    </form>
  );
}
