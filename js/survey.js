/**
 * survey.js
 * Page logic for survey.html: loads the current survey (by
 * ?surveyId= in the URL, or the first one), renders its quiz,
 * handles submission, and wires the << < > >> navigation between
 * surveys.
 *
 * survey.html now defines four fixed top-level states inside
 * #survey-content: #loading-message, #empty-state, #survey-view,
 * and #confirmation-view. This file only ever toggles `hidden`
 * between them and fills in text/fields — it no longer rebuilds
 * the heading, description, banner, or form shell from scratch.
 * The only genuinely dynamic piece left is the set of question
 * fields themselves (#survey-fields), since their count and type
 * are admin-defined data.
 */

const navBar = document.getElementById('survey-nav');
const positionLabel = document.getElementById('survey-position');

const loadingMessage = document.getElementById('loading-message');
const emptyState = document.getElementById('empty-state');
const surveyView = document.getElementById('survey-view');
const confirmationView = document.getElementById('confirmation-view');

const surveyHeading = document.getElementById('survey-heading');
const surveyDescription = document.getElementById('survey-description');
const noQuestionsMessage = document.getElementById('no-questions-message');
const surveyQuiz = document.getElementById('survey-quiz');
const bannerError = document.getElementById('form-banner-error');
const surveyForm = document.getElementById('survey-form');
const surveyFields = document.getElementById('survey-fields');
const submitBtn = document.getElementById('survey-submit-btn');

const confirmationSurveyName = document.getElementById('confirmation-survey-name');
const confirmationDate = document.getElementById('confirmation-date');

const params = new URLSearchParams(window.location.search);
const requestedId = params.get('surveyId');

const surveys = SurveyDB.getSurveys().sort((a, b) => a.id - b.id);

function showState(el) {
  [loadingMessage, emptyState, surveyView, confirmationView].forEach((node) => {
    node.hidden = node !== el;
  });
}

function currentIndex() {
  if (!requestedId) return 0;
  const idx = surveys.findIndex((s) => s.id === Number(requestedId));
  return idx === -1 ? 0 : idx;
}

function goTo(index) {
  const target = surveys[index];
  if (!target) return;
  window.location.href = `survey.html?surveyId=${target.id}`;
}

function renderNav(index) {
  if (surveys.length <= 1) {
    navBar.hidden = true;
    return;
  }
  navBar.hidden = false;
  positionLabel.textContent = `${index + 1} of ${surveys.length}`;

  const atStart = index <= 0;
  const atEnd = index >= surveys.length - 1;

  document.getElementById('nav-first').disabled = atStart;
  document.getElementById('nav-prev').disabled = atStart;
  document.getElementById('nav-next').disabled = atEnd;
  document.getElementById('nav-last').disabled = atEnd;

  document.getElementById('nav-first').onclick = () => goTo(0);
  document.getElementById('nav-prev').onclick = () => goTo(index - 1);
  document.getElementById('nav-next').onclick = () => goTo(index + 1);
  document.getElementById('nav-last').onclick = () => goTo(surveys.length - 1);
}

function renderEmptyState() {
  navBar.hidden = true;
  showState(emptyState);
}

function renderSurvey(survey) {
  const questions = SurveyDB.getQuestions(survey.id);

  showState(surveyView);

  surveyHeading.textContent = survey.name;

  if (survey.description) {
    surveyDescription.textContent = survey.description;
    surveyDescription.hidden = false;
  } else {
    surveyDescription.hidden = true;
  }

  if (questions.length === 0) {
    noQuestionsMessage.hidden = false;
    surveyQuiz.hidden = true;
    return;
  }
  noQuestionsMessage.hidden = true;
  surveyQuiz.hidden = false;

  bannerError.hidden = true;
  bannerError.textContent = '';
  surveyFields.innerHTML = '';

  const answers = {};
  const files = {};
  const fieldEls = {};

  questions.forEach((question) => {
    const fieldEl = RenderInput.renderQuestionField(question, {
      onChange: (value) => {
        if (question.type === 'file') files[question.name] = value;
        else answers[question.name] = value;
      },
    });
    fieldEls[question.name] = fieldEl;
    surveyFields.appendChild(fieldEl);
  });

  submitBtn.disabled = false;
  submitBtn.textContent = 'Submit response';

  surveyForm.onsubmit = (event) =>
    handleSubmit(event, survey, questions, answers, files, fieldEls);
}
//Submit handler: validate, show errors, and if valid, submit to storage and show confirmation.
function handleSubmit(event, survey, questions, answers, files, fieldEls) {
  event.preventDefault();
  bannerError.hidden = true;
  bannerError.textContent = '';
  questions.forEach((q) => RenderInput.setFieldError(fieldEls[q.name], null));

  const errors = validate(questions, answers, files);
  if (Object.keys(errors).length > 0) {
    Object.entries(errors).forEach(([name, message]) => {
      RenderInput.setFieldError(fieldEls[name], message);
    });
    surveyView.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  submitAnswers(survey, answers, files);
}

async function submitAnswers(survey, answers, files) {
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting…';

  try {
    const encodedFiles = {};
    for (const [name, fileList] of Object.entries(files)) {
      encodedFiles[name] = await Promise.all(fileList.map(SurveyDB.fileToBase64));
    }
    const receipt = SurveyDB.createResponse(survey.id, { answers, files: encodedFiles });
    renderConfirmation(receipt);
  } catch (err) {
    bannerError.hidden = false;
    bannerError.textContent = err.message || 'Something went wrong. Please try again.';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit response';
  }
}

function validate(questions, answers, files) {
  const errors = {};
  questions.forEach((question) => {
    if (!question.required) return;

    if (question.type === 'file') {
      if (!files[question.name] || files[question.name].length === 0) {
                errors[question.name] = RenderInput.requiredMessage(question);
      }
      return;
    }

    if (question.type === 'choice' && question.allowMultiple) {
      const selected = Array.isArray(answers[question.name]) ? answers[question.name] : [];
      if (selected.length === 0) {
        errors[question.name] = 'Select at least one option.';
        return;
      }
      if (question.minSelection && selected.length < question.minSelection) {
        errors[question.name] = `Select at least ${question.minSelection} option${question.minSelection === 1 ? '' : 's'}.`;
        return;
      }
      if (question.maxSelection && selected.length > question.maxSelection) {
        errors[question.name] = `Select at most ${question.maxSelection} option${question.maxSelection === 1 ? '' : 's'}.`;
        return;
      }
      return;
    }

    const value = answers[question.name];
        if (value === undefined || value === null || String(value).trim() === '') {
      errors[question.name] = RenderInput.requiredMessage(question);
    }
  });
  return errors;
}

function renderConfirmation(receipt) {
  navBar.hidden = true;
  const date = new Date(receipt.submittedAt).toLocaleString();
  confirmationSurveyName.textContent = receipt.surveyName;
  confirmationDate.textContent = date;
  showState(confirmationView);
}

/* ---------------------------------------------------------------
 * Init
 * ------------------------------------------------------------- */

if (surveys.length === 0) {
  renderEmptyState();
} else {
  const index = currentIndex();
  renderNav(index);
  renderSurvey(surveys[index]);
}