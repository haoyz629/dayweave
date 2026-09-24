export type CommonItemFields = {
  title: string;
  notes: string;
  tags: string[];
};

export function syncFormCommonFields<T extends CommonItemFields>(
  targetForm: T,
  sourceForm: CommonItemFields
): T {
  return {
    ...targetForm,
    title: sourceForm.title,
    notes: sourceForm.notes,
    tags: Array.isArray(sourceForm.tags) ? [...sourceForm.tags] : []
  };
}
