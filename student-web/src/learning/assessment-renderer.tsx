import type { FormEvent } from "react";
import type { Item, Response } from "./education-types";

export function AssessmentRenderer({ item, options, busy, onSubmit }: {
  item: Item; options: { id: string; label: string }[]; busy: boolean; onSubmit: (response: Response) => void;
}) {
  const fields = item.response_schema.fields ?? [];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    let response: Response;
    if (item.kind === "single_choice") response = String(form.get("answer"));
    else if (item.kind === "ordering") {
      const selects = Array.from(event.currentTarget.querySelectorAll("select"));
      const order = selects.map(select => select.value);
      response = order;
      if (new Set(order).size < order.length) {
        selects.find((select, index) => order.indexOf(select.value) !== index)?.setCustomValidity("每一步请选择不同的动作。");
        event.currentTarget.reportValidity();
        return;
      }
    } else if (item.kind === "numeric") response = fields.map(field => Number(form.get(field.id)));
    else response = Object.fromEntries(fields.map(field => [field.id, String(form.get(field.id) ?? "").trim()]));
    onSubmit(response);
  }

  return <form onSubmit={submit}>
    <fieldset disabled={busy} className="education-answer">
      <legend>{item.prompt}</legend>
      {item.kind === "single_choice" && options.map(option =>
        <label className="education-option" key={option.id}><input type="radio" name="answer" required value={option.id}/>{option.label}</label>)}
      {item.kind === "ordering" && options.map((_, index) =>
        <label key={index}>第 {index + 1} 步
          <select aria-label={`第 ${index + 1} 步`} defaultValue="" required onChange={event => {
            for (const select of Array.from(event.currentTarget.form?.querySelectorAll("select") ?? [])) select.setCustomValidity("");
          }}>
            <option value="" disabled>选择动作</option>
            {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>)}
      {item.kind === "numeric" && fields.map(field =>
        <label key={field.id}>{field.label}（{field.unit}）
          <input name={field.id} type="number" step="any" required/>
        </label>)}
      {item.kind === "structured_explanation" && fields.map(field =>
        <label key={field.id}>{field.label}<textarea name={field.id} maxLength={800}/></label>)}
    </fieldset>
    <div className="toolbar">
      <button type="submit" className="primary" disabled={busy}>提交作答</button>
      <button type="button" disabled={busy} onClick={() => onSubmit(null)}>还不确定</button>
    </div>
  </form>;
}
