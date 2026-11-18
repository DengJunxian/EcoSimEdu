import type { Evaluation, Item, Response } from "./education-types";

export function orderedOptions(item: Item, profile: string) {
  const options = [...(item.response_schema.options ?? [])];
  let state = 0;
  for (const char of profile + item.variant_id) state = Math.imul(31, state) + char.charCodeAt(0) | 0;
  for (let end = options.length - 1; end > 0; end--) {
    state = Math.imul(1664525, state) + 1013904223 | 0;
    const index = (state >>> 0) % (end + 1);
    [options[end], options[index]] = [options[index], options[end]];
  }
  return options;
}

export function evaluate(item: Item, response: Response): Evaluation {
  const base = { evaluator: item.evaluator.id, version: item.evaluator.version };
  if (response === null) return { ...base, result: "unassessed" };
  if (item.kind === "structured_explanation") {
    const fields = item.response_schema.fields ?? [];
    const complete = typeof response === "object" && !Array.isArray(response) &&
      fields.every(field => typeof response[field.id] === "string" && response[field.id].trim());
    return { ...base, result: complete ? "structure_complete" : "structure_incomplete" };
  }
  const values = item.evaluator.answers ?? item.evaluator.answer;
  const field_results = Array.isArray(values) && Array.isArray(response)
    ? values.map((value, index) => value === response[index]) : undefined;
  const correct = field_results ? Array.isArray(response) && response.length === field_results.length &&
    field_results.every(Boolean) : response === values;
  return { ...base, result: correct ? "correct" : "incorrect", field_results,
    ...(correct ? {} : { misconception_code: item.feedback.misconception_code }) };
}
