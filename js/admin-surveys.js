/**
 * admin-surveys.js
 * Page logic for admin-surveys.html.
 *
 * The table itself (header, rows, Search panel, chips, counts and
 * empty states) is run by DataTable from js/data-table.js. This file
 * only says which columns the survey table has, how each row is
 * built from storage, and wires the create/edit/delete dialogs.
 */

const listError = document.getElementById('list-error');
const surveyTableBody = document.getElementById('survey-table-body');

const surveyForm = document.getElementById('survey-form');
const surveyDialogTitle = document.getElementById('survey-dialog-title');
const surveyIdInput = document.getElementById('survey-id');
const surveyNameInput = document.getElementById('survey-name');
const surveyDescriptionInput = document.getElementById('survey-description');
const surveyColumnsInput = document.getElementById('survey-columns');
const surveyNameField = surveyNameInput.closest('.field');
const surveySaveBtn = document.getElementById('survey-save-btn');
const surveyFormError = document.getElementById('survey-form-error');

/* ===== Table columns — add a column here and the header, rows and Search follow ===== */
const SURVEY_COLUMNS = [
  {
    key: 'name',
    label: 'Name',
    type: 'text',
    placeholder: 'e.g. feedback',
    cell: (s) => `<td class="cell-name">${escapeHtml(s.name)}</td>`,
  },
  {
    key: 'description',
    label: 'Description',
    type: 'text',
    placeholder: 'e.g. customer',
    cell: (s) => `<td class="cell-muted">${escapeHtml(s.description || '—')}</td>`,
  },
  {
    key: 'questions',
    label: 'Questions',
    type: 'number',
    cell: (s) => `<td class="num">${s.questions}</td>`,
  },
  {
    key: 'created',
    label: 'Created',
    type: 'date',
    cell: (s) => `<td class="cell-date">${s.created ? DataTable.formatDate(s.created) : '—'}</td>`,
  },
];

const surveyTable = DataTable.create(document.getElementById('survey-data-table'), {
  columns: SURVEY_COLUMNS,
  noun: ['survey', 'surveys'],
  actions: (s) => `
    <a class="btn btn-small" href="admin-questions.html?surveyId=${s.id}">Questions</a>
    <button type="button" class="btn btn-small" data-action="edit" data-id="${s.id}">Edit</button>
    <button type="button" class="btn btn-small btn-danger" data-action="delete" data-id="${s.id}">Delete</button>`,
});

/* One row per survey, with the derived values the columns search on */
function buildSurveyRows() {
  return SurveyDB.getSurveys().map((s) => ({
    ...s,
    questions: SurveyDB.getQuestions(s.id).length,
    created: DataTable.toLocalDate(s.createdAt), // "YYYY-MM-DD" in local time, or "" if missing
  }));
}

function renderSurveyTable() {
  surveyTable.setRows(buildSurveyRows());
}

/* One listener for every row's Edit/Delete, so nothing is re-attached on each render */
surveyTableBody.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-action]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (btn.dataset.action === 'edit') openEditDialog(id);
  if (btn.dataset.action === 'delete') handleDeleteClick(id);
});

function showListError(message) {
  listError.hidden = !message;
  listError.textContent = message ?? '';
}

function showFormError(message) {
  surveyFormError.hidden = !message;
  surveyFormError.textContent = message ?? '';
}

/* ===== Create / edit dialog ===== */

function openCreateDialog() {
  surveyIdInput.value = '';
  surveyNameInput.value = '';
  RenderInput.setFieldError(surveyNameField, null);
  surveyDescriptionInput.value = '';
  surveyColumnsInput.value = '1';
  surveyDialogTitle.textContent = 'New survey';
  surveySaveBtn.textContent = 'Create survey';
  showFormError(null);
  DialogUtil.openDialog('survey-dialog');
}

function openEditDialog(id) {
  const survey = SurveyDB.getSurvey(id);
  if (!survey) return;
  surveyIdInput.value = survey.id;
  surveyNameInput.value = survey.name;
  RenderInput.setFieldError(surveyNameField, null);
  surveyDescriptionInput.value = survey.description ?? '';
  surveyColumnsInput.value = String(survey.columns ?? 1);
  surveyDialogTitle.textContent = 'Edit survey';
  surveySaveBtn.textContent = 'Save changes';
  showFormError(null);
  DialogUtil.openDialog('survey-dialog');
}

function handleDeleteClick(id) {
  const survey = SurveyDB.getSurvey(id);
  if (!survey) return;
  DialogUtil.confirmAction(
    `Delete survey "${survey.name}"? Its questions will be removed too. This cannot be undone.`,
    () => {
      SurveyDB.deleteSurvey(id);
      renderSurveyTable();
    }
  );
}

surveyNameInput.addEventListener('input', () => {
  if (surveyNameField.classList.contains('field--invalid')) {
    RenderInput.setFieldError(surveyNameField, null);
  }
});

surveyForm.addEventListener('submit', (event) => {
  event.preventDefault();
  showFormError(null);

  const name = surveyNameInput.value.trim();
  if (!name) {
    RenderInput.setFieldError(surveyNameField, 'This name field is required');
    return;
  }

  const id = surveyIdInput.value;
  const data = {
    name,
    description: surveyDescriptionInput.value,
    columns: Number(surveyColumnsInput.value),
  };

  try {
    if (id) SurveyDB.updateSurvey(id, data);
    else SurveyDB.createSurvey(data);
    DialogUtil.closeDialog('survey-dialog');
    renderSurveyTable(); // active searches are kept
  } catch (err) {
    showFormError(err.message);
  }
});

document.getElementById('new-survey-btn').addEventListener('click', openCreateDialog);

DialogUtil.initDialogs();
renderSurveyTable();