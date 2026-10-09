"use client";

import { useActionState } from "react";
import {
  createOrganisation,
  createTenant,
  grantAccess,
  signIn,
  signUp,
} from "@/lib/actions";
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
  const [state, action, pending] = useActionState(createTenant, {});

  return (
    <form className={ops.form} action={action}>
      <label className={ops.field}>
        Tenant
        <input name="tenantName" required minLength={2} maxLength={80} placeholder="Northwind Group" />
      </label>
      <label className={ops.field}>
        First organisation
        <input name="organisationName" required minLength={2} maxLength={80} placeholder="Northwind Ltd" />
      </label>
      <button className={ops.primary} type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create tenant"}
      </button>
      <Status state={state} />
    </form>
  );
}

export function CreateOrganisationForm({ tenantId }: { tenantId: string }) {
  const [state, action, pending] = useActionState(createOrganisation, {});

  return (
    <form className={ops.form} action={action}>
      <input type="hidden" name="tenantId" value={tenantId} />
      <label className={ops.field}>
        New organisation
        <input name="organisationName" required minLength={2} maxLength={80} placeholder="Harbour Trading" />
      </label>
      <button className={ops.primary} type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add organisation"}
      </button>
      {state.error ? (
        <p className={ops.alert} role="alert">
          {state.error}
        </p>
      ) : null}
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
  const [state, action, pending] = useActionState(grantAccess, {});

  return (
    <form className={ops.form} action={action}>
      <input type="hidden" name="organisationId" value={organisationId} />
      <label className={ops.field}>
        Email
        <input name="email" type="email" required placeholder="colleague@company.com" />
      </label>
      <label className={ops.field}>
        Role
        <select name="role" defaultValue="member">
          <option value="member">Member</option>
          <option value="admin">Admin</option>
          {callerRole === "owner" ? <option value="owner">Owner</option> : null}
        </select>
      </label>
      <button className={ops.primary} type="submit" disabled={pending}>
        {pending ? "Granting…" : "Grant access"}
      </button>
      <Status state={state} />
    </form>
  );
}
