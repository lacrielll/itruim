type RecordValue = Record<string, any>;

export function questionEditorPayload(form: RecordValue) {
  const body: RecordValue = {
    type: form.type,
    text: form.text,
    points: Number(form.points),
  };
  if (form.type === "SINGLE" || form.type === "MULTIPLE") {
    body.options = form.options.map((option: RecordValue) => ({
      ...(option.id ? { id: option.id } : {}),
      text: option.text,
      is_correct: Boolean(option.is_correct),
    }));
  } else if (form.type === "NUMERIC") {
    body.numeric_kind = form.numeric_kind ?? "FLOAT";
    body.correct_value = Number(form.correct_value);
    body.absolute_tolerance =
      body.numeric_kind === "INTEGER" ? 0 : Number(form.absolute_tolerance);
  } else if (form.type === "SHORT_TEXT") {
    body.answers = form.answers;
  }
  return body;
}

export function questionEditorForm(question: RecordValue) {
  const base = {
    type: question.type,
    text: question.text,
    points: question.points,
  };
  if (question.type === "SINGLE" || question.type === "MULTIPLE") {
    return {
      ...base,
      options: question.options.map((option: RecordValue) => ({
        id: option.id,
        text: option.text,
        is_correct: Boolean(option.is_correct),
      })),
    };
  }
  if (question.type === "NUMERIC") {
    return {
      ...base,
      correct_value: question.numeric.correct_value,
      absolute_tolerance: question.numeric.absolute_tolerance,
      numeric_kind:
        question.numeric.numeric_kind ??
        (Number.isInteger(question.numeric.correct_value) &&
        question.numeric.absolute_tolerance === 0
          ? "INTEGER"
          : "FLOAT"),
    };
  }
  return { ...base, answers: [...question.answers] };
}
