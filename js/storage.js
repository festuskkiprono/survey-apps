/**
 * storage.js
 * ---------------------------------------------------------------
 * The entire data layer for the survey app. Replaces what used to
 * be a Java API + XML wire format with plain localStorage reads
 * and writes. Every function here is synchronous.
 *
 * Schema (each key holds a JSON string):
 *
 *  survey_app_surveys    -> [ { id, name, description, createdAt } ]
 *
 *  survey_app_questions  -> [ {
 *      id, surveyId, name, type, prompt, description, required, order,
 *      // type-specific, present only when relevant:
 *      maxLength,
 *      options: [{ value, label }], allowMultiple, minSelection, maxSelection,
 *      fileFormat, maxFileSize, maxFileSizeUnit, allowMultipleFiles,
 *      min, max, step                 // for number/range
 *  } ]
 *
 *  survey_app_responses  -> [ {
 *      id, surveyId, surveyName, submittedAt,
 *      answers: { [questionName]: value },
 *      files:   { [questionName]: [ { filename, mimeType, base64 } ] }
 *  } ]
 *
 *  survey_app_next_id    -> { surveys: N, questions: N, responses: N }
 * ---------------------------------------------------------------
 */

const KEYS = {
  surveys: 'survey_app_surveys',
  questions: 'survey_app_questions',
  responses: 'survey_app_responses',
  nextId: 'survey_app_next_id',
};

/* ---------------------------------------------------------------
 * Low-level read/write helpers
 * ------------------------------------------------------------- */

function readArray(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.warn(`survey-app: could not parse localStorage key "${key}", resetting it.`);
    return [];
  }
}

function writeArray(key, arr) {
  localStorage.setItem(key, JSON.stringify(arr));
}

function readNextIds() {
  const raw = localStorage.getItem(KEYS.nextId);
  if (!raw) return { surveys: 1, questions: 1, responses: 1 };
  try {
    return JSON.parse(raw);
  } catch {
    return { surveys: 1, questions: 1, responses: 1 };
  }
}

function nextId(kind) {
  const ids = readNextIds();
  const id = ids[kind] ?? 1;
  ids[kind] = id + 1;
  localStorage.setItem(KEYS.nextId, JSON.stringify(ids));
  return id;
}

/* ---------------------------------------------------------------
 * Surveys
 * ------------------------------------------------------------- */

function getSurveys() {
  return readArray(KEYS.surveys);
}

function getSurvey(id) {
  return getSurveys().find((s) => s.id === Number(id)) ?? null;
}

function createSurvey({ name, description }) {
  const surveys = getSurveys();
  const survey = {
    id: nextId('surveys'),
    name: name.trim(),
    description: (description ?? '').trim(),
    createdAt: new Date().toISOString(),
  };
  surveys.push(survey);
  writeArray(KEYS.surveys, surveys);
  return survey;
}

function updateSurvey(id, { name, description }) {
  const surveys = getSurveys();
  const survey = surveys.find((s) => s.id === Number(id));
  if (!survey) throw new Error('Survey not found');
  survey.name = name.trim();
  survey.description = (description ?? '').trim();
  writeArray(KEYS.surveys, surveys);
  return survey;
}

function deleteSurvey(id) {
  const surveys = getSurveys().filter((s) => s.id !== Number(id));
  writeArray(KEYS.surveys, surveys);
  // Cascade: remove this survey's questions too. Responses are kept
  // as historical records (they snapshot surveyName at submit time).
  const questions = readArray(KEYS.questions).filter((q) => q.surveyId !== Number(id));
  writeArray(KEYS.questions, questions);
}

/* ---------------------------------------------------------------
 * Questions
 * ------------------------------------------------------------- */

function getQuestions(surveyId) {
  return readArray(KEYS.questions)
    .filter((q) => q.surveyId === Number(surveyId))
    .sort((a, b) => a.order - b.order);
}

function getQuestion(surveyId, questionId) {
  return getQuestions(surveyId).find((q) => q.id === Number(questionId)) ?? null;
}

function nextOrder(surveyId) {
  const existing = getQuestions(surveyId);
  return existing.length === 0 ? 0 : Math.max(...existing.map((q) => q.order)) + 1;
}

function createQuestion(surveyId, data) {
  const questions = readArray(KEYS.questions);
  const question = {
    id: nextId('questions'),
    surveyId: Number(surveyId),
    order: nextOrder(surveyId),
    ...data,
  };
  questions.push(question);
  writeArray(KEYS.questions, questions);
  return question;
}

function updateQuestion(surveyId, questionId, data) {
  const questions = readArray(KEYS.questions);
  const question = questions.find(
    (q) => q.id === Number(questionId) && q.surveyId === Number(surveyId)
  );
  if (!question) throw new Error('Question not found');
  Object.assign(question, data);
  writeArray(KEYS.questions, questions);
  return question;
}

function deleteQuestion(surveyId, questionId) {
  const questions = readArray(KEYS.questions).filter(
    (q) => !(q.id === Number(questionId) && q.surveyId === Number(surveyId))
  );
  writeArray(KEYS.questions, questions);
}

function reorderQuestions(surveyId, orderedIds) {
  const questions = readArray(KEYS.questions);
  orderedIds.forEach((id, index) => {
    const q = questions.find((q) => q.id === Number(id) && q.surveyId === Number(surveyId));
    if (q) q.order = index;
  });
  writeArray(KEYS.questions, questions);
}

/* ---------------------------------------------------------------
 * Responses
 * ------------------------------------------------------------- */

function getResponses(surveyId) {
  return readArray(KEYS.responses)
    .filter((r) => r.surveyId === Number(surveyId))
    .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
}

function createResponse(surveyId, { answers, files }) {
  const survey = getSurvey(surveyId);
  const responses = readArray(KEYS.responses);
  const response = {
    id: nextId('responses'),
    surveyId: Number(surveyId),
    surveyName: survey ? survey.name : '(deleted survey)',
    submittedAt: new Date().toISOString(),
    answers: answers ?? {},
    files: files ?? {},
  };
  responses.push(response);
  writeArray(KEYS.responses, responses);
  return response;
}

/* ---------------------------------------------------------------
 * File helper — reads a File object into a base64 data URL
 * ------------------------------------------------------------- */

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({ filename: file.name, mimeType: file.type, base64: reader.result });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/* ---------------------------------------------------------------
 * Debug helper — callable from the browser console as SurveyDB.dump()
 * ------------------------------------------------------------- */

function dump() {
  const data = {
    surveys: getSurveys(),
    questions: readArray(KEYS.questions),
    responses: readArray(KEYS.responses),
    nextIds: readNextIds(),
  };
  console.log('%cSurveyDB dump', 'font-weight:bold', data);
  return data;
}

function clearAll() {
  Object.values(KEYS).forEach((key) => localStorage.removeItem(key));
  console.log('SurveyDB: all data cleared.');
}

/* ---------------------------------------------------------------
 * Public API
 * ------------------------------------------------------------- */

window.SurveyDB = {
  // surveys
  getSurveys,
  getSurvey,
  createSurvey,
  updateSurvey,
  deleteSurvey,
  // questions
  getQuestions,
  getQuestion,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  reorderQuestions,
  // responses
  getResponses,
  createResponse,
  fileToBase64,
  // debug
  dump,
  clearAll,
};
