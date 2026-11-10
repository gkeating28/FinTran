import { startTransition, type FormEvent } from "react";

/**
 * Submit handler for a form whose save can fail. React 19 resets a form after its `action` runs,
 * which wipes the entries when the save returns an error. Sending the data through a transition
 * leaves the form as the person filled it in. Use it as `onSubmit={keepEntries(action)}` with the
 * action from `useActionState`, in place of the form's `action`.
 */
export function keepEntries(action: (data: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(event.currentTarget, submitter);
    startTransition(() => action(data));
  };
}
