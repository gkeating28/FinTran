-- The transition check only compares its own arguments with literals, so it needs no schema on its search path.
alter function private.e_document_transition_allowed(public.e_document_direction, public.e_document_status, public.e_document_status)
  set search_path = '';
