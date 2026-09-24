/**
 * admin-questions.js
 * Page logic for admin-questions.html: survey details, the
 * questions table, the add/edit dialog (with per-type config
 * panels), and the preview dialog.
 *
 * The questions <table>, its <thead>, and the empty-state message
 * are written once in admin-questions.html — they never change
 * shape. This file only ever touches what's actually data-driven:
 * the rows in #question-table-body, the caption text, and which of
 * #question-table / #question-empty-state is visible.
 */

const params = new URLSearchParams(window.location.search);
const surveyId = Number(params.get('surveyId'));

const survey = SurveyDB.getSurvey(surveyId);

if (!survey) {
  document.querySelector('main').innerHTML =
    '<p class="page-message">Survey not found. <a href="admin-surveys.html">Back to surveys</a>.</p>';
  throw new Error('Survey not found');
}

document.getElementById('survey-name-crumb').textContent = survey.name;
document.title = `${survey.name} — Questions — Admin`;

/* ---------------------------------------------------------------
 * Survey details section
 * ------------------------------------------------------------- */

function renderSurveyDetails() {
  const questionCount = SurveyDB.getQuestions(survey.id).length;
  const responseCount = SurveyDB.getResponses(survey.id).length;
  const created = new Date(survey.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  document.getElementById('survey-details-body').innerHTML = `
    <h2>${escapeHtml(survey.name)}</h2>
    <p>${escapeHtml(survey.description || 'No description provided.')}</p>
    <dl>
      <div><dt>Created</dt><dd>${created}</dd></div>
      <div><dt>Questions</dt><dd>${questionCount}</dd></div>
      <div><dt>Responses</dt><dd>${responseCount}</dd></div>
    </dl>
  `;
}

/* ---------------------------------------------------------------
 * Questions table
 * ------------------------------------------------------------- */

const questionTable = document.getElementById('question-table');
const questionTableCaption = document.getElementById('question-table-caption');
const questionTableBody = document.getElementById('question-table-body');
const questionEmptyState = document.getElementById('question-empty-state');
const listError = document.getElementById('list-error');

function showListError(message) {
  listError.hidden = !message;
  listError.textContent = message ?? '';
}

function renderQuestionTable() {
  const questions = SurveyDB.getQuestions(survey.id);

  if (questions.length === 0) {
    questionTable.hidden = true;
    questionEmptyState.hidden = false;
    questionTableBody.innerHTML = '';
    return;
  }

  questionTable.hidden = false;
  questionEmptyState.hidden = true;
  questionTableCaption.textContent = `${questions.length} question${questions.length === 1 ? '' : 's'}`;

  questionTableBody.innerHTML = '';

  questions.forEach((question) => {
    const config = RenderInput.typeConfig(question.type);
    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="cell-mono">${escapeHtml(question.name)}</td>
      <td class="cell-muted">${escapeHtml(question.prompt)}</td>
      <td><span class="badge">${escapeHtml(config.label)}</span></td>
      <td>${question.required ? 'Yes' : 'No'}</td>
      <td class="cell-actions">
        <button type="button" class="btn btn-small" data-action="edit" data-id="${question.id}">Edit</button>
        <button type="button" class="btn btn-small btn-danger" data-action="delete" data-id="${question.id}">Delete</button>
      </td>
    `;
    questionTableBody.appendChild(row);
  });

  questionTableBody.querySelectorAll('[data-action="edit"]').forEach((btn) => {
    btn.addEventListener('click', () => openEditDialog(Number(btn.dataset.id)));
  });
  questionTableBody.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', () => handleDeleteClick(Number(btn.dataset.id)));
  });
}

function handleDeleteClick(id) {
  const question = SurveyDB.getQuestion(survey.id, id);
  if (!question) return;
  DialogUtil.confirmAction(`Delete question "${question.name}"? This cannot be undone.`, () => {
    SurveyDB.deleteQuestion(survey.id, id);
    renderQuestionTable();
    renderSurveyDetails();
  });
}

/* ---------------------------------------------------------------
 * Add / edit question dialog
 * ------------------------------------------------------------- */

const questionForm = document.getElementById('question-form');
const questionDialogTitle = document.getElementById('question-dialog-title');
const questionIdInput = document.getElementById('question-id');
const questionNameInput = document.getElementById('question-name');
const questionTypeSelect = document.getElementById('question-type');
const questionPromptInput = document.getElementById('question-prompt');
const questionDescriptionInput = document.getElementById('question-description');
const questionRequiredInput = document.getElementById('question-required');
const questionConfigPanel = document.getElementById('question-config-panel');
const questionSaveBtn = document.getElementById('question-save-btn');
const questionFormError = document.getElementById('question-form-error');
const typeLockedHint = document.getElementById('type-locked-hint');

let optionRows = []; // [{ value, label }] — working state for the options editor
let editingId = null;

// Populate the type dropdown once from the shared registry.
RenderInput.QUESTION_TYPES.forEach((t) => {
  const opt = document.createElement('option');
  opt.value = t.value;
  opt.textContent = t.label;
  questionTypeSelect.appendChild(opt);
});

function showFormError(message) {
  questionFormError.hidden = !message;
  questionFormError.textContent = message ?? '';
}

function defaultOptionRows() {
  return [
    { value: '', label: '' },
    { value: '', label: '' },
  ];
}

function renderConfigPanel(type, values = {}) {
  const config = RenderInput.typeConfig(type);
  questionConfigPanel.innerHTML = '';
  questionConfigPanel.className = 'config-panel';

  if (config.hasMaxLength) {
    questionConfigPanel.appendChild(
      field('Max length (optional)', makeInput('number', 'cfg-maxLength', { min: 1, value: values.maxLength ?? '' }))
    );
  }

  if (config.hasRange) {
    const row = document.createElement('div');
    row.className = 'form-row';
    row.appendChild(field('Minimum', makeInput('number', 'cfg-min', { value: values.min ?? 0 })));
    row.appendChild(field('Maximum', makeInput('number', 'cfg-max', { value: values.max ?? 100 })));
    row.appendChild(field('Step', makeInput('number', 'cfg-step', { value: values.step ?? 1, min: 0 })));
    questionConfigPanel.appendChild(row);
  }

  if (config.hasOptions) {
    if (type === 'choice') {
      const allowMultipleField = document.createElement('div');
      allowMultipleField.className = 'checkbox-field';
      allowMultipleField.innerHTML = `
        <input type="checkbox" id="cfg-allowMultiple" ${values.allowMultiple ? 'checked' : ''} />
        <label for="cfg-allowMultiple">Allow multiple selections</label>
      `;
      questionConfigPanel.appendChild(allowMultipleField);

      const selectionRow = document.createElement('div');
      selectionRow.className = 'form-row';
      selectionRow.id = 'selection-limits-row';
      selectionRow.hidden = !values.allowMultiple;
      selectionRow.appendChild(
        field('Min selections', makeInput('number', 'cfg-minSelection', { min: 1, value: values.minSelection ?? '' }))
      );
      selectionRow.appendChild(
        field('Max selections', makeInput('number', 'cfg-maxSelection', { min: 1, value: values.maxSelection ?? '' }))
      );
      questionConfigPanel.appendChild(selectionRow);

      allowMultipleField.querySelector('input').addEventListener('change', (e) => {
        selectionRow.hidden = !e.target.checked;
      });
    }

    optionRows = values.options && values.options.length ? [...values.options] : defaultOptionRows();
    const optionsWrap = document.createElement('div');
    optionsWrap.className = 'form';
    optionsWrap.id = 'options-editor';
    questionConfigPanel.appendChild(field('Options', optionsWrap));
    renderOptionRows(optionsWrap);
  }

  if (config.hasFileConfig) {
    questionConfigPanel.appendChild(
      field('Allowed formats', makeInput('text', 'cfg-fileFormat', { placeholder: 'pdf or pdf,docx', value: values.fileFormat ?? '', mono: true }))
    );
    const row = document.createElement('div');
    row.className = 'form-row';
    row.appendChild(field('Max file size', makeInput('number', 'cfg-maxFileSize', { min: 1, value: values.maxFileSize ?? '' })));
    const unitSelect = document.createElement('select');
    unitSelect.id = 'cfg-maxFileSizeUnit';
    unitSelect.innerHTML = `<option value="kb">KB</option><option value="mb">MB</option>`;
    unitSelect.value = values.maxFileSizeUnit ?? 'mb';
    row.appendChild(field('Unit', unitSelect));
    questionConfigPanel.appendChild(row);

    const multipleFilesField = document.createElement('div');
    multipleFilesField.className = 'checkbox-field';
    multipleFilesField.innerHTML = `
      <input type="checkbox" id="cfg-allowMultipleFiles" ${values.allowMultipleFiles ? 'checked' : ''} />
      <label for="cfg-allowMultipleFiles">Allow multiple files</label>
    `;
    questionConfigPanel.appendChild(multipleFilesField);
  }
}

function renderOptionRows(container) {
  container.innerHTML = '';
  optionRows.forEach((opt, index) => {
    const row = document.createElement('div');
    row.className = 'option-row';
    row.innerHTML = `
      <input type="text" class="mono" placeholder="VALUE" value="${escapeHtml(opt.value)}" data-opt="value" required />
      <input type="text" placeholder="Label shown to respondents" value="${escapeHtml(opt.label)}" data-opt="label" required />
      <button type="button" class="btn btn-small btn-danger" data-remove-option ${optionRows.length <= 2 ? 'disabled' : ''}>Remove</button>
    `;
    row.querySelector('[data-opt="value"]').addEventListener('input', (e) => {
      optionRows[index].value = e.target.value;
    });
    row.querySelector('[data-opt="label"]').addEventListener('input', (e) => {
      optionRows[index].label = e.target.value;
    });
    row.querySelector('[data-remove-option]').addEventListener('click', () => {
      optionRows.splice(index, 1);
      renderOptionRows(container);
    });
    container.appendChild(row);
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-small';
  addBtn.textContent = 'Add option';
  addBtn.addEventListener('click', () => {
    optionRows.push({ value: '', label: '' });
    renderOptionRows(container);
  });
  container.appendChild(addBtn);
}

function field(labelText, inputEl) {
  const wrap = document.createElement('div');
  const label = document.createElement('label');
  label.textContent = labelText;
  if (inputEl.id) label.setAttribute('for', inputEl.id);
  wrap.appendChild(label);
  wrap.appendChild(inputEl);
  return wrap;
}

function makeInput(type, id, opts = {}) {
  const input = document.createElement('input');
  input.type = type;
  input.id = id;
  if (opts.mono) input.classList.add('mono');
  Object.entries(opts).forEach(([key, value]) => {
    if (key === 'mono') return;
    if (value !== undefined && value !== null && value !== '') input.setAttribute(key, value);
  });
  return input;
}

function collectConfigValues(type) {
  const config = RenderInput.typeConfig(type);
  const values = {};

  if (config.hasMaxLength) {
    const v = document.getElementById('cfg-maxLength')?.value;
    if (v) values.maxLength = Number(v);
  }
  if (config.hasRange) {
    values.min = Number(document.getElementById('cfg-min')?.value ?? 0);
    values.max = Number(document.getElementById('cfg-max')?.value ?? 100);
    values.step = Number(document.getElementById('cfg-step')?.value ?? 1);
  }
  if (config.hasOptions) {
    values.options = optionRows
      .filter((o) => o.value.trim() !== '' && o.label.trim() !== '')
      .map((o) => ({ value: o.value.trim(), label: o.label.trim() }));
    if (type === 'choice') {
      values.allowMultiple = document.getElementById('cfg-allowMultiple')?.checked ?? false;
      const minSel = document.getElementById('cfg-minSelection')?.value;
      const maxSel = document.getElementById('cfg-maxSelection')?.value;
      if (minSel) values.minSelection = Number(minSel);
      if (maxSel) values.maxSelection = Number(maxSel);
    }
  }
  if (config.hasFileConfig) {
    values.fileFormat = document.getElementById('cfg-fileFormat')?.value ?? '';
    const maxSize = document.getElementById('cfg-maxFileSize')?.value;
    if (maxSize) values.maxFileSize = Number(maxSize);
    values.maxFileSizeUnit = document.getElementById('cfg-maxFileSizeUnit')?.value ?? 'mb';
    values.allowMultipleFiles = document.getElementById('cfg-allowMultipleFiles')?.checked ?? false;
  }

  return values;
}

function openCreateDialog() {
  editingId = null;
  questionIdInput.value = '';
  questionNameInput.value = '';
  questionTypeSelect.value = 'short_text';
  questionTypeSelect.disabled = false;
  typeLockedHint.hidden = true;
  questionPromptInput.value = '';
  questionDescriptionInput.value = '';
  questionRequiredInput.checked = false;
  questionDialogTitle.textContent = 'New question';
  questionSaveBtn.textContent = 'Create question';
  showFormError(null);
  renderConfigPanel('short_text', {});
  DialogUtil.openDialog('question-dialog');
}

function openEditDialog(id) {
  const question = SurveyDB.getQuestion(survey.id, id);
  if (!question) return;

  editingId = id;
  questionIdInput.value = question.id;
  questionNameInput.value = question.name;
  questionTypeSelect.value = question.type;
  questionTypeSelect.disabled = true;
  typeLockedHint.hidden = false;
  questionPromptInput.value = question.prompt;
  questionDescriptionInput.value = question.description ?? '';
  questionRequiredInput.checked = !!question.required;
  questionDialogTitle.textContent = 'Edit question';
  questionSaveBtn.textContent = 'Save changes';
  showFormError(null);
  renderConfigPanel(question.type, question);
  DialogUtil.openDialog('question-dialog');
}

questionTypeSelect.addEventListener('change', () => {
  if (!questionTypeSelect.disabled) {
    renderConfigPanel(questionTypeSelect.value, {});
  }
});

questionForm.addEventListener('submit', (event) => {
  event.preventDefault();
  showFormError(null);

  const name = questionNameInput.value.trim();
  const prompt = questionPromptInput.value.trim();
  const type = questionTypeSelect.value;

  if (!/^[a-z0-9_]+$/.test(name)) {
    showFormError('Question name must be lowercase letters, numbers, and underscores only.');
    return;
  }
  if (!prompt) {
    showFormError('Prompt is required.');
    return;
  }

  const existingNames = SurveyDB.getQuestions(survey.id)
    .filter((q) => q.id !== editingId)
    .map((q) => q.name);
  if (existingNames.includes(name)) {
    showFormError(`A question named "${name}" already exists in this survey.`);
    return;
  }

  const data = {
    name,
    type,
    prompt,
    description: questionDescriptionInput.value.trim(),
    required: questionRequiredInput.checked,
    ...collectConfigValues(type),
  };

  try {
    if (editingId) {
      SurveyDB.updateQuestion(survey.id, editingId, data);
    } else {
      SurveyDB.createQuestion(survey.id, data);
    }
    DialogUtil.closeDialog('question-dialog');
    renderQuestionTable();
    renderSurveyDetails();
  } catch (err) {
    showFormError(err.message);
  }
});

document.getElementById('new-question-btn').addEventListener('click', openCreateDialog);

/* ---------------------------------------------------------------
 * Preview dialog — renders the quiz read-only, as respondents see it
 * ------------------------------------------------------------- */

document.getElementById('preview-btn').addEventListener('click', () => {
  const previewForm = document.getElementById('preview-form');
  previewForm.innerHTML = '';

  const questions = SurveyDB.getQuestions(survey.id);
  if (questions.length === 0) {
    previewForm.innerHTML = '<p class="page-message">No questions to preview yet.</p>';
  } else {
    questions.forEach((question) => {
      const fieldEl = RenderInput.renderQuestionField(question, { onChange: () => {} });
      // Read-only preview: disable every control so nothing can be submitted from here.
      fieldEl.querySelectorAll('input, select, textarea, button').forEach((el) => {
        el.disabled = true;
      });
      previewForm.appendChild(fieldEl);
    });
  }

  DialogUtil.openDialog('preview-dialog');
});

/* ---------------------------------------------------------------
 * Init
 * ------------------------------------------------------------- */

DialogUtil.initDialogs();
renderSurveyDetails();
renderQuestionTable();