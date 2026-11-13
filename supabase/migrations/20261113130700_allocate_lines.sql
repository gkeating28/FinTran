-- Payments release B, phase 6: allocate several documents from one payment or credit note in one step.
--
-- The screens let a person fill in an amount against each open document and apply them together. Done as separate
-- calls, the first could succeed and the second fail. This does them in one call, targets in id order, so either every
-- amount is applied or none is.
create function public.allocate_lines(p_source jsonb, p_lines jsonb) returns integer
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_line record;
  v_count integer := 0;
begin
  for v_line in
    select (item->>'targetHeaderId')::uuid as target_id, (item->>'amount')::numeric as amount
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as item
    where coalesce((item->>'amount')::numeric, 0) <> 0
    order by (item->>'targetHeaderId')::uuid
  loop
    perform public.allocate(p_source, v_line.target_id, v_line.amount, null);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.allocate_lines(jsonb, jsonb) from public, anon;
grant execute on function public.allocate_lines(jsonb, jsonb) to authenticated;
