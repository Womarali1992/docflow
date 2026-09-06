/**
 * Request templates — the checklists an engagement is built from.
 *
 * The first read seeds a provider's two starter checklists on the server, so a
 * new firm never faces an empty templates screen.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import type { RequestTemplate, TemplateItem, TemplateKind } from '../types';
import { keys } from './keys';
import { useScope, useSignedIn } from './auth';

export function useTemplates() {
  const scope = useScope();
  const signedIn = useSignedIn();
  return useQuery<RequestTemplate[]>({
    queryKey: keys.templates(scope),
    queryFn: () => api.templates.list(),
    enabled: signedIn,
  });
}

export function useTemplate(id: string | undefined) {
  const scope = useScope();
  const signedIn = useSignedIn();
  return useQuery<RequestTemplate>({
    queryKey: keys.template(scope, id ?? 'none'),
    queryFn: () => api.templates.get(id!),
    enabled: signedIn && Boolean(id),
  });
}

function useTemplateMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>, idOf: (input: TInput) => string | undefined) {
  const queryClient = useQueryClient();
  const scope = useScope();
  return useMutation({
    mutationFn: fn,
    onSuccess: (_result, input) => {
      queryClient.invalidateQueries({ queryKey: keys.templates(scope) });
      const id = idOf(input);
      if (id) queryClient.invalidateQueries({ queryKey: keys.template(scope, id) });
    },
  });
}

export function useCreateTemplate() {
  return useTemplateMutation<{ name: string; kind?: TemplateKind; items: TemplateItem[] }, RequestTemplate>(
    (input) => api.templates.create(input),
    () => undefined
  );
}

export function useUpdateTemplate() {
  return useTemplateMutation<{ id: string; patch: Partial<{ name: string; kind: TemplateKind; items: TemplateItem[] }> }, RequestTemplate>(
    (input) => api.templates.update(input.id, input.patch),
    (input) => input.id
  );
}

/** Archives rather than deletes: engagements built from it keep their references. */
export function useArchiveTemplate() {
  return useTemplateMutation<string, { ok: true; archived: true }>((id) => api.templates.remove(id), (id) => id);
}
