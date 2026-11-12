/**
 * What a button asked for after a save: "Save and post", "Save and activate" and so on. The button sends it as
 * `then_action` with the document form, so the save and the action happen in one step. If the save fails the action
 * never runs.
 */
export const AFTER_SAVE = ["post", "open", "close", "cancel", "create_from_order"] as const;

/** A posted document only saves its paid amount, and the one action that can follow is a credit note. */
export const AFTER_PAID = ["create_credit_note"] as const;

export type FollowOn = (typeof AFTER_SAVE)[number] | (typeof AFTER_PAID)[number];

/** The follow-on action a form asked for, if it is one this kind of save allows. Anything else is no action. */
export function followOnFrom(formData: FormData, allowed: readonly FollowOn[]): FollowOn | null {
  const asked = String(formData.get("then_action") ?? "").trim();
  return allowed.find((item) => item === asked) ?? null;
}
