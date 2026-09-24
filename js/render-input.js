/**
 * render-input.js
 * ---------------------------------------------------------------
 * One config-driven renderer that replaces the old per-type
 * component files (TextField, EmailField, ChoiceField, FileField).
 * Adding a new HTML input type is a matter of adding one entry to
 * QUESTION_TYPES, not writing a new file.
 * ---------------------------------------------------------------
 */

/**
 * Each entry describes one question type:
 *  - value:     stored on the question as `type`
 *  - label:     shown in the admin "Type" dropdown
 *  - input:     the native <input type="..."> to use ('textarea',
 *               'select' and 'choice' are handled specially below)
 *  - hasRange:  show min/max/step config in the admin form
 *  - hasMaxLength: show a max length config in the admin form
 *  - hasOptions:   show the options editor in the admin form
 *  - hasFileConfig: show the file format/size config in the admin form
 */
const QUESTION_TYPES = [
  { value: 'short_text', label: 'Short text', input: 'text' },
  { value: 'long_text', label: 'Long text', input: 'textarea', hasMaxLength: true },
  { value: 'email', label: 'Email', input: 'email' },
  { value: 'tel', label: 'Telephone', input: 'tel' },
  { value: 'password', label: 'Password', input: 'password', hasMaxLength: true },
  { value: 'number', label: 'Number', input: 'number', hasRange: true },
  { value: 'range', label: 'Range / slider', input: 'range', hasRange: true },
  { value: 'date', label: 'Date', input: 'date' },
  { value: 'time', label: 'Time', input: 'time' },
  { value: 'url', label: 'URL', input: 'url' },
  { value: 'color', label: 'Color', input: 'color' },
  { value: 'choice', label: 'Choice (radio / checkbox)', input: 'choice', hasOptions: true },
  { value: 'select', label: 'Dropdown', input: 'select', hasOptions: true },
  { value: 'file', label: 'File upload', input: 'file', hasFileConfig: true },
];

function typeConfig(typeValue) {
  return QUESTION_TYPES.find((t) => t.value === typeValue) ?? QUESTION_TYPES[0];
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  children.forEach((child) => child && node.appendChild(child));
  return node;
}

/**
 * Renders a full question field: label, optional description, the
 * appropriate input(s), and a slot for a validation error message.
 *
 * `onChange(value)` fires on every input/change event with the
 * current value already coerced into the right shape (string,
 * number, array of strings for multi-choice, array of File for file
 * inputs).
 *
 * Returns the field <div> to insert into the DOM.
 */
function renderQuestionField(question, { value, onChange, id } = {}) {
  const config = typeConfig(question.type);
  const fieldId = id ?? `q_${question.id}`;

  const labelText = question.prompt + (question.required ? ' *' : '');
  const wrapper = el('div', { class: 'field', 'data-question-name': question.name });

  if (config.input === 'choice') {
    // Semantic grouped control: fieldset + legend, not a bare label.
    const fieldset = el('fieldset', { class: 'choice-group' });
    fieldset.appendChild(el('legend', { text: labelText }));
    if (question.description) {
      fieldset.appendChild(el('p', { class: 'field-description', text: question.description }));
    }

    const selected = new Set(Array.isArray(value) ? value : value ? [value] : []);
    const inputType = question.allowMultiple ? 'checkbox' : 'radio';

    (question.options ?? []).forEach((opt, i) => {
      const optionId = `${fieldId}_opt${i}`;
      const input = el('input', {
        type: inputType,
        id: optionId,
        name: fieldId,
        value: opt.value,
        checked: selected.has(opt.value) || undefined,
        required: question.required && !question.allowMultiple ? true : undefined,
      });
      input.addEventListener('change', () => {
        if (inputType === 'checkbox') {
          if (input.checked) selected.add(opt.value);
          else selected.delete(opt.value);
          onChange?.([...selected]);
        } else {
          onChange?.(opt.value);
        }
      });
      const optionLabel = el('label', { class: 'choice-option', for: optionId });
      optionLabel.appendChild(input);
      optionLabel.appendChild(el('span', { text: opt.label }));
      fieldset.appendChild(optionLabel);
    });

    wrapper.appendChild(fieldset);
    appendErrorSlot(wrapper);
    return wrapper;
  }

  // Every other type: a proper <label for="..."> plus its control.
  const label = el('label', { for: fieldId, class: 'field-label', text: labelText });
  wrapper.appendChild(label);

  if (question.description) {
    wrapper.appendChild(el('p', { class: 'field-description', text: question.description }));
  }

  if (config.input === 'textarea') {
    const textarea = el('textarea', {
      id: fieldId,
      name: fieldId,
      rows: 5,
      required: question.required || undefined,
      maxlength: question.maxLength || undefined,
    });
    textarea.value = value ?? '';
    textarea.addEventListener('input', () => onChange?.(textarea.value));
    wrapper.appendChild(textarea);
  } else if (config.input === 'select') {
    const select = el('select', {
      id: fieldId,
      name: fieldId,
      required: question.required || undefined,
    });
    select.appendChild(el('option', { value: '', text: 'Select an option…' }));
    (question.options ?? []).forEach((opt) => {
      const optionEl = el('option', { value: opt.value, text: opt.label });
      if (value === opt.value) optionEl.selected = true;
      select.appendChild(optionEl);
    });
    select.addEventListener('change', () => onChange?.(select.value));
    wrapper.appendChild(select);
  } else if (config.input === 'file') {
    const input = el('input', {
      type: 'file',
      id: fieldId,
      name: fieldId,
      required: question.required || undefined,
      multiple: question.allowMultipleFiles || undefined,
      accept: acceptFromFormat(question.fileFormat),
    });
    input.addEventListener('change', () => onChange?.([...input.files]));
    wrapper.appendChild(input);

    const hint = [
      question.fileFormat && `Allowed: ${question.fileFormat}`,
      question.maxFileSize && `Max size: ${question.maxFileSize} ${question.maxFileSizeUnit}`,
      question.allowMultipleFiles && 'Multiple files allowed',
    ]
      .filter(Boolean)
      .join(' · ');
    if (hint) wrapper.appendChild(el('p', { class: 'field-hint', text: hint }));
  } else if (config.input === 'range') {
    const row = el('div', { class: 'range-row' });
    const input = el('input', {
      type: 'range',
      id: fieldId,
      name: fieldId,
      min: question.min ?? 0,
      max: question.max ?? 100,
      step: question.step ?? 1,
    });
    input.value = value ?? question.min ?? 0;
    const output = el('output', { for: fieldId, class: 'range-output', text: input.value });
    input.addEventListener('input', () => {
      output.textContent = input.value;
      onChange?.(Number(input.value));
    });
    row.appendChild(input);
    row.appendChild(output);
    wrapper.appendChild(row);
  } else {
    // text, email, tel, password, number, date, time, url, color
    const input = el('input', {
      type: config.input,
      id: fieldId,
      name: fieldId,
      required: question.required || undefined,
      maxlength: config.hasMaxLength ? question.maxLength || undefined : undefined,
      min: config.hasRange ? question.min ?? undefined : undefined,
      max: config.hasRange ? question.max ?? undefined : undefined,
      step: config.hasRange ? question.step ?? undefined : undefined,
    });
    input.value = value ?? '';
    input.addEventListener('input', () => onChange?.(input.value));
    wrapper.appendChild(input);
  }

  appendErrorSlot(wrapper);
  return wrapper;
}

function appendErrorSlot(wrapper) {
  wrapper.appendChild(el('p', { class: 'field-error', 'data-error-slot': true }));
}

function setFieldError(wrapper, message) {
  const slot = wrapper.querySelector('[data-error-slot]');
  if (slot) slot.textContent = message ?? '';
}

function acceptFromFormat(format) {
  if (!format) return undefined;
  return format
    .split(',')
    .map((ext) => '.' + ext.trim().replace('.', ''))
    .join(',');
}

window.RenderInput = {
  QUESTION_TYPES,
  typeConfig,
  renderQuestionField,
  setFieldError,
};
