/**
 * admin-surveys.js
 * Page logic for admin-surveys.html: render survey rows into the
 * static table shell already in the HTML, and wire up the
 * create/edit dialog and delete confirmation.
 *
 * The <table>, <thead>, and empty-state message are written once
 * in admin-surveys.html — they never change shape. This file only
 * ever touches the pieces that are actually data-driven: the rows
 * in #survey-table-body, the caption text, and which of
 * #survey-table / #survey-empty-state is visible.
 */

const surveyTable = document.getElementById('survey-table');
const surveyTableCaption = document.getElementById('survey-table-caption');
const surveyTableBody = document.getElementById('survey-table-body');
const surveyEmptyState = document.getElementById('survey-empty-state');
const listError = document.getElementById('list-error');

const surveyForm = document.getElementById('survey-form');
const surveyDialogTitle = document.getElementById('survey-dialog-title');
const surveyIdInput = document.getElementById('survey-id');
const surveyNameInput = document.getElementById('survey-name');
const surveyDescriptionInput = document.getElementById('survey-description');
const surveyColumnsInput = document.getElementById('survey-columns');
const surveyNameField = surveyNameInput.closest('.field');
const surveySaveBtn = document.getElementById('survey-save-btn');
const surveyFormError = document.getElementById('survey-form-error');

function showListError(message) {
  if (!message) {
    listError.hidden = true;
    listError.textContent = '';
    return;
  }
  listError.hidden = false;
  listError.textContent = message;
}

function showFormError(message) {
  if (!message) {
    surveyFormError.hidden = true;
    surveyFormError.textContent = '';
    return;
  }
  surveyFormError.hidden = false;
  surveyFormError.textContent = message;
}

function renderSurveyTable() {
  const surveys = SurveyDB.getSurveys();

  if (surveys.length === 0) {
    surveyTable.hidden = true;
    surveyEmptyState.hidden = false;
    surveyTableBody.innerHTML = '';
    return;
  }

  surveyTable.hidden = false;
  surveyEmptyState.hidden = true;
  surveyTableCaption.textContent = `${surveys.length} survey${surveys.length === 1 ? '' : 's'}`;

  surveyTableBody.innerHTML = '';

  surveys.forEach((survey) => {
    const questionCount = SurveyDB.getQuestions(survey.id).length;
    const row = document.createElement('tr');

    row.innerHTML = `
      <td class="cell-name">${escapeHtml(survey.name)}</td>
      <td class="cell-muted">${escapeHtml(survey.description || '—')}</td>
      <td>${questionCount}</td>
      <td class="cell-actions">
        <a class="btn btn-small" href="admin-questions.html?surveyId=${survey.id}">Questions</a>
        <button type="button" class="btn btn-small" data-action="edit" data-id="${survey.id}">Edit</button>
        <button type="button" class="btn btn-small btn-danger" data-action="delete" data-id="${survey.id}">Delete</button>
      </td>
    `;
    surveyTableBody.appendChild(row);
  });

  surveyTableBody.querySelectorAll('[data-action="edit"]').forEach((btn) => {
    btn.addEventListener('click', () => openEditDialog(Number(btn.dataset.id)));
  });
  surveyTableBody.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', () => handleDeleteClick(Number(btn.dataset.id)));
  });
}

// Create survey
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
    if (id) {
      SurveyDB.updateSurvey(id, data);
    } else {
      SurveyDB.createSurvey(data);
    }
    DialogUtil.closeDialog('survey-dialog');
    renderSurveyTable();
  } catch (err) {
    showFormError(err.message);
  }
});

document.getElementById('new-survey-btn').addEventListener('click', openCreateDialog);

DialogUtil.initDialogs();
renderSurveyTable();