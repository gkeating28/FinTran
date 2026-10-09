"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ORGANISATION_COOKIE } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { isRole, type ActionState } from "@/lib/types";

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function failure(error: { message: string } | null, fallback: string): ActionState {
  return { error: error?.message || fallback };
}

async function rememberOrganisation(organisationId: string) {
  const cookieStore = await cookies();
  cookieStore.set(ORGANISATION_COOKIE, organisationId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function signIn(_state: ActionState, formData: FormData): Promise<ActionState> {
  const email = text(formData, "email");
  const password = text(formData, "password");
  if (!email || password.length < 8) {
    return { error: "Enter the email and password for your account." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  redirect("/");
}

export async function signUp(_state: ActionState, formData: FormData): Promise<ActionState> {
  const email = text(formData, "email");
  const password = text(formData, "password");
  const displayName = text(formData, "displayName");

  if (!email.includes("@")) return { error: "Enter a valid email address." };
  if (password.length < 8) return { error: "Use a password of at least 8 characters." };

  const supabase = await createClient();
  const headerStore = await headers();
  const origin = headerStore.get("origin");
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: displayName ? { display_name: displayName } : undefined,
      emailRedirectTo: origin ? `${origin}/auth/confirm` : undefined,
    },
  });

  if (error) return { error: error.message };
  if (!data.session) {
    return {
      message: "Check your email and confirm the account, then sign in.",
    };
  }

  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete(ORGANISATION_COOKIE);
  redirect("/login");
}

export async function selectOrganisation(formData: FormData) {
  const organisationId = text(formData, "organisationId");
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId || !organisationId) redirect("/login");

  const { data } = await supabase
    .from("organisation_access")
    .select("organisation_id")
    .eq("user_id", userId)
    .eq("organisation_id", organisationId)
    .maybeSingle();

  if (!data) return;

  await rememberOrganisation(organisationId);
  revalidatePath("/", "layout");
}

export async function createTenant(_state: ActionState, formData: FormData): Promise<ActionState> {
  const tenantName = text(formData, "tenantName");
  const organisationName = text(formData, "organisationName");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_tenant", {
    tenant_name: tenantName,
    organisation_name: organisationName,
  });

  if (error) return failure(error, "The tenant could not be created.");

  const organisationId =
    data && typeof data === "object" && "organisation_id" in data
      ? String(data.organisation_id)
      : "";
  if (organisationId) await rememberOrganisation(organisationId);

  revalidatePath("/", "layout");
  redirect("/");
}

export async function createOrganisation(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const tenantId = text(formData, "tenantId");
  const organisationName = text(formData, "organisationName");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_organisation", {
    p_tenant_id: tenantId,
    organisation_name: organisationName,
  });

  if (error) return failure(error, "The organisation could not be created.");
  if (typeof data === "string") await rememberOrganisation(data);

  revalidatePath("/organisations");
  redirect("/organisations");
}

export async function grantAccess(_state: ActionState, formData: FormData): Promise<ActionState> {
  const organisationId = text(formData, "organisationId");
  const email = text(formData, "email");
  const role = text(formData, "role");
  if (!isRole(role)) return { error: "Choose owner, admin, or member." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("grant_organisation_access", {
    p_organisation_id: organisationId,
    p_email: email,
    p_role: role,
  });

  if (error) return failure(error, "Access could not be granted.");

  revalidatePath("/access");
  return { message: `${email} now has the ${role} role.` };
}

export async function revokeAccess(formData: FormData) {
  const organisationId = text(formData, "organisationId");
  const userId = text(formData, "userId");
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_organisation_access", {
    p_organisation_id: organisationId,
    p_user_id: userId,
  });

  if (error) {
    redirect(`/access?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/access");
  redirect("/access");
}
