/**
 * data-table.js
 * ---------------------------------------------------------------
 * Reusable table tools, shared by every admin table. Same idea as
 * dialog.js and render-input.js: one shared behaviour, exposed on
 * window, instead of per-page copies.
 *
 * A page describes its table (columns, how a row is drawn, row
 * actions) and hands over rows with setRows(). This file owns
 * everything else: the header, the rows, the tool panels, the
 * active conditions, chips, counts and empty states.
 *
 * Markup: the page writes the static shell (see admin-surveys.html)
 * and marks the pieces with data-dt="..." attributes. Lookups are
 * scoped to the table's root element, so two tables on one page
 * never clash and no ids are hard-coded here. A tool whose markup
 * is missing from the shell is simply switched off.
 *
 * Tools:
 *  - Search:  one condition at a time from a single form.
 *  - Filter:  builder rows; + applies a row, the bin removes it.
 *  - Sort:    builder rows (first level sorts, later ones break ties),
 *             plus clickable header arrows for a quick one-column sort.
 *  - Columns: tick boxes to hide/show columns (one always stays).
 * Search and Filter write into the same `filters` list, and every
 * condition must match (AND).
 *
 * Pipeline on every render():
 *   rows → filters → sort → draw (visible columns only)
 * ---------------------------------------------------------------
 */

(function () {
  /* Relationships offered per column type */
  const RELATIONS = {
    text: [
      ['contains', 'contains'],
      ['startsWith', 'starts with'],
      ['endsWith', 'ends with'],
      ['equals', 'equals'],
      ['notContains', 'does not contain'],
    ],
    number: [
      ['eq', 'equal to'],
      ['gt', 'more than'],
      ['lt', 'less than'],
      ['gte', 'at least'],
      ['lte', 'at most'],
    ],
    date: [
      ['on', 'on'],
      ['before', 'before'],
      ['after', 'after'],
    ],
  };

  const lower = (s) => s.toLowerCase();
  const TESTS = {
    contains: (v, q) => lower(v).includes(lower(q)),
    notContains: (v, q) => !lower(v).includes(lower(q)),
    startsWith: (v, q) => lower(v).startsWith(lower(q)),
    endsWith: (v, q) => lower(v).endsWith(lower(q)),
    equals: (v, q) => lower(v) === lower(q),
    eq: (v, q) => v === q,
    gt: (v, q) => v > q,
    lt: (v, q) => v < q,
    gte: (v, q) => v >= q,
    lte: (v, q) => v <= q,
    // Dates are compared as "YYYY-MM-DD" strings, which sort correctly
    on: (v, q) => v === q,
    before: (v, q) => v < q,
    after: (v, q) => v > q,
  };

  const SORT_ORDERS = [
    ['asc', 'Ascending'],
    ['desc', 'Descending'],
  ];

  const ICONS = {
    plus: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    check: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
    bin: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
    arrows: '<span class="dt-arrows" aria-hidden="true"><svg class="up" viewBox="0 0 10 6"><path d="M5 0 10 6H0z"/></svg><svg class="down" viewBox="0 0 10 6"><path d="M0 0h10L5 6z"/></svg></span>',
  };

  /* ---------- Helpers ---------- */

  // Safe for both element content and attribute values.
  // (utils.js escapeHtml does not escape quotes, so it is unsafe inside attributes.)
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const pad = (n) => String(n).padStart(2, '0');

  // ISO timestamp -> local calendar date "YYYY-MM-DD".
  // toISOString() is UTC, so a survey created at 01:00 in Nairobi would
  // otherwise land on the previous day.
  function toLocalDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // "2026-10-09" -> "09 Oct 2026"
  function formatDate(ymd) {
    if (!ymd) return '';
    return new Date(ymd + 'T00:00:00').toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  const toNumber = (raw) => Number(String(raw).replace(/,/g, ''));

  /* Shared validation for a condition. Returns an error message, or "" when valid. */
  function validateCondition(col, raw) {
    if (!raw) return 'Enter a value.';
    if (col.type === 'number' && !Number.isFinite(toNumber(raw))) return `${col.label} needs a number, like 5.`;
    return '';
  }

  /* ---------- Table factory ---------- */

  /**
   * options:
   *  columns: [{ key, label, type: 'text'|'number'|'date',
   *              value?(row)  -> the value matched and sorted (defaults to row[key]),
   *              cell?(row)   -> the full <td> html (defaults to the escaped value),
   *              searchable?  -> false to leave it out of Search and Filter,
   *              sortable?    -> false to leave it out of Sort,
   *              hideable?    -> false to keep it out of the Columns panel,
   *              placeholder? -> hint text for the value box }]
   *  noun:    ['survey', 'surveys']
   *  actions?(row) -> html for a trailing actions cell (never matched, sorted or hidden)
   */
  function create(root, options) {
    const q = (name) => root.querySelector(`[data-dt="${name}"]`);
    const els = {
      tools: q('tools'),
      workspace: q('workspace'),
      side: q('side'),
      sideTitle: q('side-title'),
      close: q('close'),
      table: q('table'),
      caption: q('caption'),
      head: q('head'),
      body: q('body'),
      empty: q('empty'),
      foot: q('foot'),
      status: q('status'),
      chips: q('chips'),
      // Search
      searchForm: q('search-form'),
      searchCol: q('search-col'),
      searchRel: q('search-rel'),
      searchVal: q('search-val'),
      searchField: q('search-field'),
      searchError: q('search-error'),
      searchCount: q('count-search'),
      // Filter
      filterRows: q('filter-rows'),
      filterCount: q('count-filter'),
      // Sort
      sortRows: q('sort-rows'),
      sortCount: q('count-sort'),
      // Columns
      colChecks: q('col-checks'),
      showAllCols: q('show-all-cols'),
      colCount: q('count-columns'),
    };

    const has = {
      search: Boolean(els.searchForm),
      filter: Boolean(els.filterRows),
      sort: Boolean(els.sortRows),
      columns: Boolean(els.colChecks),
    };

    const idPrefix = root.id || 'dt';
    const columns = options.columns;
    const searchable = columns.filter((c) => c.searchable !== false);
    const sortable = columns.filter((c) => c.sortable !== false);
    const hideable = columns.filter((c) => c.hideable !== false);
    const [singular, plural] = options.noun ?? ['row', 'rows'];
    const TOOL_TITLES = { search: 'Search', filter: 'Filters', sort: 'Sorting', columns: 'Columns' };
    const SOURCE_LABELS = { search: 'Search', filter: 'Filter' };

    const state = {
      rows: [],              // everything the page handed over
      filters: [],           // active conditions: [{ id, col, rel, value, source: 'search' | 'filter' }]
      filterRows: [],        // filter builder rows: [{ id, col, rel, value, filterId, error }] — filterId set once applied
      sortRows: [],          // sort builder rows: [{ id, col, dir, applied, error }] — applied rows, top to bottom, are the sort order
      hiddenCols: new Set(), // keys of columns the user has hidden
      tool: null,            // which side panel is open: 'search' | 'filter' | 'sort' | 'columns' | null
    };
    let nextFilterId = 1;
    let nextRowId = 1;
    let nextSortRowId = 1;

    const colOf = (key) => columns.find((c) => c.key === key);
    const valueOf = (col, row) => (col.value ? col.value(row) : row[col.key]);
    const relLabel = (col, rel) => RELATIONS[col.type].find((r) => r[0] === rel)[1];
    const orderLabel = (dir) => (dir === 'asc' ? 'Ascending' : 'Descending');
    const countLabel = (n) => `${n} ${n === 1 ? singular : plural}`;
    const shownValue = (col, raw) => (col.type === 'date' ? formatDate(raw) : raw);
    const placeholderFor = (col) =>
      col.placeholder ?? (col.type === 'number' ? 'e.g. 5' : col.type === 'text' ? 'e.g. feedback' : '');
    const visibleColumns = () => columns.filter((c) => !state.hiddenCols.has(c.key));
    const sortRules = () => state.sortRows.filter((r) => r.applied); // priority order, top to bottom

    /* ----- Matching + sorting ----- */

    function matches(row, f) {
      const col = colOf(f.col);
      const v = valueOf(col, row);
      if (col.type === 'number') return TESTS[f.rel](Number(v), toNumber(f.value));
      if (col.type === 'date') return Boolean(v) && TESTS[f.rel](v, f.value); // rows with no date never match
      return TESTS[f.rel](String(v ?? ''), f.value);
    }

    const applyFilters = (rows) => rows.filter((row) => state.filters.every((f) => matches(row, f)));

    // Numbers compare as numbers; text and dates with localeCompare, so "apple" and "Zebra"
    // sort alphabetically regardless of case, and "Survey 2" comes before "Survey 10".
    function compareBy(col, a, b) {
      const va = valueOf(col, a);
      const vb = valueOf(col, b);
      if (col.type === 'number') return Number(va) - Number(vb);
      return String(va ?? '').localeCompare(String(vb ?? ''), undefined, { sensitivity: 'base', numeric: true });
    }

    function applySort(rows) {
      const rules = sortRules();
      if (!rules.length) return rows;
      return [...rows].sort((a, b) => {
        for (const { col, dir } of rules) { // first rule decides; later rules break ties
          const c = compareBy(colOf(col), a, b);
          if (c !== 0) return dir === 'asc' ? c : -c;
        }
        return 0;
      });
    }

    /* ----- Search panel ----- */

    function initSearch() {
      els.searchCol.innerHTML = searchable
        .map((c) => `<option value="${esc(c.key)}">${esc(c.label)}</option>`)
        .join('');
      els.searchCol.addEventListener('change', syncSearchInputs);
      els.searchVal.addEventListener('input', () => setSearchError(''));

      els.searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const col = colOf(els.searchCol.value);
        const raw = els.searchVal.value.trim();
        const err = validateCondition(col, raw);
        if (err) {
          setSearchError(err);
          els.searchVal.focus();
          return;
        }
        state.filters.push({ id: nextFilterId++, col: col.key, rel: els.searchRel.value, value: raw, source: 'search' });
        els.searchVal.value = '';
        render();
        els.searchVal.focus(); // ready for the next condition
      });

      syncSearchInputs();
    }

    // Column change resets Relationship and Value to fit the new column's type
    function syncSearchInputs() {
      const col = colOf(els.searchCol.value);
      els.searchRel.innerHTML = RELATIONS[col.type].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
      els.searchVal.value = '';
      els.searchVal.type = col.type === 'date' ? 'date' : 'text';
      els.searchVal.inputMode = col.type === 'number' ? 'decimal' : 'text';
      els.searchVal.placeholder = placeholderFor(col);
      setSearchError('');
    }

    // Reuses the app's .field--invalid styling from components.css
    function setSearchError(msg) {
      els.searchError.textContent = msg;
      els.searchField.classList.toggle('field--invalid', Boolean(msg));
      if (msg) els.searchVal.setAttribute('aria-invalid', 'true');
      else els.searchVal.removeAttribute('aria-invalid');
    }

    /* ----- Filter builder rows ----- */

    function newFilterRow() {
      const col = searchable[0];
      return { id: nextRowId++, col: col.key, rel: RELATIONS[col.type][0][0], value: '', filterId: null, error: '' };
    }

    // There is always exactly one blank row to type into
    function ensureEmptyRow() {
      if (has.filter && !state.filterRows.some((r) => r.filterId === null)) state.filterRows.push(newFilterRow());
    }

    const rowById = (id) => state.filterRows.find((r) => r.id === Number(id));
    const fid = (part, rowId) => `${idPrefix}-f${part}-${rowId}`;

    function renderFilterRows() {
      if (!has.filter) return;
      els.filterRows.innerHTML = state.filterRows
        .map((r) => {
          const col = colOf(r.col);
          const applied = r.filterId !== null;
          const dis = applied ? 'disabled' : '';
          const invalid = r.error ? `aria-invalid="true" aria-describedby="${fid('err', r.id)}"` : '';
          return `<div class="dt-frow${applied ? ' is-applied' : ''}" data-frow="${r.id}">
            <div class="dt-f-col">
              <label class="field-label" for="${fid('col', r.id)}">Column</label>
              <select id="${fid('col', r.id)}" data-field="col" ${dis}>
                ${searchable.map((c) => `<option value="${esc(c.key)}" ${c.key === r.col ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
              </select>
            </div>
            <div class="dt-f-rel">
              <label class="field-label" for="${fid('rel', r.id)}">Relationship</label>
              <select id="${fid('rel', r.id)}" data-field="rel" ${dis}>
                ${RELATIONS[col.type].map(([v, l]) => `<option value="${v}" ${v === r.rel ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
            </div>
            <div class="dt-f-val">
              <label class="field-label" for="${fid('val', r.id)}">Value</label>
              <input id="${fid('val', r.id)}" data-field="value" type="${col.type === 'date' ? 'date' : 'text'}"
                inputmode="${col.type === 'number' ? 'decimal' : 'text'}" placeholder="${esc(placeholderFor(col))}"
                value="${esc(r.value)}" autocomplete="off" ${dis} ${invalid}>
            </div>
            <div class="dt-f-actions">
              <button type="button" class="btn btn-icon dt-f-add" data-action="add" ${dis}
                aria-label="${applied ? 'Filter applied' : 'Apply filter'}" title="${applied ? 'Applied' : 'Apply filter'}">
                ${applied ? ICONS.check : ICONS.plus}
              </button>
              <button type="button" class="btn btn-icon dt-f-bin" data-action="delete"
                aria-label="${applied ? 'Remove filter' : 'Clear row'}" title="${applied ? 'Remove filter' : 'Clear row'}">
                ${ICONS.bin}
              </button>
            </div>
            ${r.error ? `<p class="field-error dt-f-error" id="${fid('err', r.id)}">${esc(r.error)}</p>` : ''}
          </div>`;
        })
        .join('');
    }

    function focusBlankFilterRow() {
      const blank = state.filterRows.find((r) => r.filterId === null);
      if (blank) document.getElementById(fid('val', blank.id))?.focus();
    }

    function removeFilterRow(rowId) {
      const row = rowById(rowId);
      if (!row) return;
      if (row.filterId !== null) state.filters = state.filters.filter((f) => f.id !== row.filterId);
      // The last blank row is cleared rather than removed, so there is always one row to type into
      const blanks = state.filterRows.filter((r) => r.filterId === null);
      if (row.filterId === null && blanks.length === 1) Object.assign(row, newFilterRow(), { id: row.id });
      else state.filterRows = state.filterRows.filter((r) => r.id !== row.id);
      ensureEmptyRow();
    }

    function initFilter() {
      const container = els.filterRows;

      // Keep typed values in state so re-rendering never loses them
      container.addEventListener('input', (e) => {
        const rowEl = e.target.closest('[data-frow]');
        const row = rowEl && rowById(rowEl.dataset.frow);
        if (!row || e.target.dataset.field !== 'value') return;
        row.value = e.target.value;
        if (row.error) {
          row.error = '';
          e.target.removeAttribute('aria-invalid');
          e.target.removeAttribute('aria-describedby');
          rowEl.querySelector('.dt-f-error')?.remove();
        }
      });

      // Column change resets Relationship and Value to fit the new column's type
      container.addEventListener('change', (e) => {
        const rowEl = e.target.closest('[data-frow]');
        const row = rowEl && rowById(rowEl.dataset.frow);
        if (!row) return;
        if (e.target.dataset.field === 'col') {
          row.col = e.target.value;
          row.rel = RELATIONS[colOf(row.col).type][0][0];
          row.value = '';
          row.error = '';
          renderFilterRows();
          document.getElementById(fid('val', row.id))?.focus();
        } else if (e.target.dataset.field === 'rel') {
          row.rel = e.target.value;
        }
      });

      // Enter in a value box acts like the + button
      container.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.target.dataset.field !== 'value') return;
        e.preventDefault();
        e.target.closest('[data-frow]').querySelector('[data-action="add"]').click();
      });

      container.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const row = rowById(btn.closest('[data-frow]').dataset.frow);

        if (btn.dataset.action === 'add') {
          const col = colOf(row.col);
          const raw = row.value.trim();
          const err = validateCondition(col, raw);
          if (err) {
            row.error = err;
            renderFilterRows();
            document.getElementById(fid('val', row.id))?.focus();
            return;
          }
          const filter = { id: nextFilterId++, col: row.col, rel: row.rel, value: raw, source: 'filter' };
          state.filters.push(filter);
          Object.assign(row, { value: raw, filterId: filter.id, error: '' });
          state.filterRows.push(newFilterRow()); // fresh row for the next condition
          render();
          focusBlankFilterRow();
        }

        if (btn.dataset.action === 'delete') {
          removeFilterRow(row.id);
          render();
          focusBlankFilterRow();
        }
      });

      ensureEmptyRow();
    }

    /* ----- Sort builder rows ----- */

    function newSortRow() {
      return { id: nextSortRowId++, col: sortable[0].key, dir: 'asc', applied: false, error: '' };
    }

    function ensureEmptySortRow() {
      if (has.sort && !state.sortRows.some((r) => !r.applied)) state.sortRows.push(newSortRow());
    }

    const sortRowById = (id) => state.sortRows.find((r) => r.id === Number(id));
    const sid = (part, rowId) => `${idPrefix}-s${part}-${rowId}`;

    function renderSortRows() {
      if (!has.sort) return;
      let level = 0;
      els.sortRows.innerHTML = state.sortRows
        .map((r) => {
          const dis = r.applied ? 'disabled' : '';
          // Applied rows read "Sort by", "Then by"…; the blank row says what it would become
          const lead = r.applied ? (level++ === 0 ? 'Sort by' : 'Then by') : level === 0 ? 'Sort by' : 'Then by';
          const invalid = r.error ? `aria-invalid="true" aria-describedby="${sid('err', r.id)}"` : '';
          return `<div class="dt-frow dt-srow${r.applied ? ' is-applied' : ''}" data-srow="${r.id}">
            <span class="dt-s-lead">${lead}</span>
            <div class="dt-s-col">
              <label class="field-label" for="${sid('col', r.id)}">Column</label>
              <select id="${sid('col', r.id)}" data-field="col" ${dis} ${invalid}>
                ${sortable.map((c) => `<option value="${esc(c.key)}" ${c.key === r.col ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
              </select>
            </div>
            <div class="dt-s-dir">
              <label class="field-label" for="${sid('dir', r.id)}">Order</label>
              <select id="${sid('dir', r.id)}" data-field="dir" ${dis}>
                ${SORT_ORDERS.map(([v, l]) => `<option value="${v}" ${v === r.dir ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
            </div>
            <div class="dt-f-actions">
              <button type="button" class="btn btn-icon dt-f-add" data-action="add" ${dis}
                aria-label="${r.applied ? 'Sort applied' : 'Apply sort'}" title="${r.applied ? 'Applied' : 'Apply sort'}">
                ${r.applied ? ICONS.check : ICONS.plus}
              </button>
              <button type="button" class="btn btn-icon dt-f-bin" data-action="delete"
                aria-label="${r.applied ? 'Remove sort' : 'Clear row'}" title="${r.applied ? 'Remove sort' : 'Clear row'}">
                ${ICONS.bin}
              </button>
            </div>
            ${r.error ? `<p class="field-error dt-f-error" id="${sid('err', r.id)}">${esc(r.error)}</p>` : ''}
          </div>`;
        })
        .join('');
    }

    function focusBlankSortRow() {
      const blank = state.sortRows.find((r) => !r.applied);
      if (blank) document.getElementById(sid('col', blank.id))?.focus();
    }

    function removeSortRow(rowId) {
      const row = sortRowById(rowId);
      if (!row) return;
      const blanks = state.sortRows.filter((r) => !r.applied);
      if (!row.applied && blanks.length === 1) Object.assign(row, newSortRow(), { id: row.id }); // keep one blank row
      else state.sortRows = state.sortRows.filter((r) => r.id !== row.id);
      ensureEmptySortRow();
    }

    function initSort() {
      els.sortRows.addEventListener('change', (e) => {
        const row = sortRowById(e.target.closest('[data-srow]')?.dataset.srow);
        const field = e.target.dataset.field;
        if (!row || (field !== 'col' && field !== 'dir')) return;
        row[field] = e.target.value;
        if (row.error) {
          row.error = '';
          renderSortRows();
          document.getElementById(sid(field, row.id))?.focus();
        }
      });

      els.sortRows.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const row = sortRowById(btn.closest('[data-srow]').dataset.srow);

        if (btn.dataset.action === 'add') {
          // A column can only be sorted once; a second level on it would never break a tie
          if (sortRules().some((r) => r.col === row.col)) {
            row.error = `Already sorting by ${colOf(row.col).label}. Pick another column, or remove that sort first.`;
            renderSortRows();
            document.getElementById(sid('col', row.id))?.focus();
            return;
          }
          Object.assign(row, { applied: true, error: '' });
          state.sortRows.push(newSortRow());
          render();
          focusBlankSortRow();
        }

        if (btn.dataset.action === 'delete') {
          removeSortRow(row.id);
          render();
          focusBlankSortRow();
        }
      });

      // Header arrows: the quick way to sort by one column
      els.head.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-sort-key]');
        if (!btn) return;
        const key = btn.dataset.sortKey;
        const existing = sortRules().find((r) => r.col === key);
        if (existing) {
          existing.dir = existing.dir === 'asc' ? 'desc' : 'asc'; // already sorted: flip it, keep other levels
        } else {
          // A header click on a new column replaces all sort levels with that one column
          state.sortRows = [{ id: nextSortRowId++, col: key, dir: 'asc', applied: true, error: '' }];
          ensureEmptySortRow();
        }
        render();
        els.head.querySelector(`[data-sort-key="${key}"]`)?.focus(); // the header was redrawn
      });

      ensureEmptySortRow();
    }

    /* ----- Columns (show / hide) ----- */

    function renderColumnMenu() {
      if (!has.columns) return;
      const shownCount = visibleColumns().length;
      if (els.colCount) els.colCount.textContent = `${shownCount}/${columns.length}`;
      els.colChecks.innerHTML = hideable
        .map((c) => {
          const visible = !state.hiddenCols.has(c.key);
          const isLast = visible && shownCount === 1; // keep at least one column on screen
          return `<label class="dt-col-check${isLast ? ' is-locked' : ''}" ${isLast ? 'title="At least one column must stay visible"' : ''}>
            <input type="checkbox" id="${idPrefix}-colvis-${esc(c.key)}" data-col="${esc(c.key)}" ${visible ? 'checked' : ''} ${isLast ? 'disabled' : ''}>
            ${esc(c.label)}
          </label>`;
        })
        .join('');
      if (els.showAllCols) els.showAllCols.hidden = state.hiddenCols.size === 0;
    }

    function initColumns() {
      els.colChecks.addEventListener('change', (e) => {
        const key = e.target.dataset.col;
        if (!key) return;
        if (e.target.checked) state.hiddenCols.delete(key);
        else state.hiddenCols.add(key);
        render();
        document.getElementById(`${idPrefix}-colvis-${key}`)?.focus(); // keep focus in the list after it redraws
      });
      els.showAllCols?.addEventListener('click', () => {
        state.hiddenCols.clear();
        render();
        els.colChecks.querySelector('input')?.focus();
      });
    }

    /* ----- Tool buttons + side panel ----- */

    function applyPanel() {
      const t = state.tool;
      els.side.hidden = !t;
      els.workspace.classList.toggle('has-side', Boolean(t));
      els.tools.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
      root.querySelectorAll('[data-tool-panel]').forEach((p) => {
        p.hidden = p.dataset.toolPanel !== t;
      });
      if (t) els.sideTitle.textContent = TOOL_TITLES[t] ?? t;
    }

    // Clicking a tool opens its panel; clicking the active tool again closes it
    els.tools.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tool]');
      if (!btn) return;
      state.tool = state.tool === btn.dataset.tool ? null : btn.dataset.tool;
      applyPanel();
      if (state.tool) {
        root
          .querySelector(`[data-tool-panel="${state.tool}"]`)
          ?.querySelector('input:not(:disabled), select:not(:disabled)')
          ?.focus();
      }
    });

    function closePanel({ restoreFocus = true } = {}) {
      const was = state.tool;
      state.tool = null;
      applyPanel();
      if (was && restoreFocus) els.tools.querySelector(`[data-tool="${was}"]`)?.focus();
    }

    els.close.addEventListener('click', () => closePanel());

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !state.tool) return;
      if (document.querySelector('dialog[open]')) return; // Escape belongs to the open dialog
      closePanel();
    });

    /* ----- Rendering ----- */

    function renderHead() {
      const rules = sortRules();
      els.head.innerHTML =
        visibleColumns()
          .map((c) => {
            const cls = c.type === 'number' ? 'num' : '';
            if (!has.sort || c.sortable === false) return `<th scope="col" class="${cls}">${esc(c.label)}</th>`;
            const i = rules.findIndex((r) => r.col === c.key);
            const aria = i === -1 ? 'none' : rules[i].dir === 'asc' ? 'ascending' : 'descending';
            const level = i !== -1 && rules.length > 1 ? `<span class="dt-priority" title="Sort level ${i + 1}">${i + 1}</span>` : '';
            return `<th scope="col" class="${cls}" aria-sort="${aria}">
              <button type="button" class="dt-sort-btn" data-sort-key="${esc(c.key)}" title="Sort by ${esc(c.label)}">${esc(c.label)}${level}${ICONS.arrows}</button>
            </th>`;
          })
          .join('') + (options.actions ? `<th scope="col">${esc(options.actionsLabel ?? 'Actions')}</th>` : '');
    }

    function renderRow(row) {
      const cells = visibleColumns()
        .map((c) => (c.cell ? c.cell(row) : `<td>${esc(valueOf(c, row))}</td>`))
        .join('');
      const actions = options.actions ? `<td class="cell-actions">${options.actions(row)}</td>` : '';
      return `<tr>${cells}${actions}</tr>`;
    }

    // Bottom chips. Each segment's × undoes that one thing.
    function renderChips() {
      const segBtn = (attr, aria, k, v) =>
        `<button type="button" ${attr} aria-label="${esc(aria)}"><span class="k">${k}</span>${esc(v)}<span class="x" aria-hidden="true">×</span></button>`;

      // Search | Filter · Column · Relationship · Value
      const conditionChips = state.filters.map((f) => {
        const col = colOf(f.col);
        const rel = relLabel(col, f.rel);
        const val = shownValue(col, f.value);
        const source = SOURCE_LABELS[f.source];
        const aria = `Remove ${source.toLowerCase()}: ${col.label} ${rel} ${val}`;
        const seg = (k, v) => segBtn(`data-remove="${f.id}"`, aria, k, v);
        return `<span class="dt-chip"><span class="dt-chip-tag is-${f.source}" title="From ${source}">${source}</span>${seg('Column', col.label)}${seg('Relationship', rel)}${seg('Value', val)}</span>`;
      });

      // Sort · Column · Order
      const sortChips = sortRules().map((r) => {
        const label = colOf(r.col).label;
        const aria = `Remove sort: ${label} ${orderLabel(r.dir)}`;
        const seg = (k, v) => segBtn(`data-remove-sort="${r.id}"`, aria, k, v);
        return `<span class="dt-chip"><span class="dt-chip-tag is-sort">Sort</span>${seg('Column', label)}${seg('Order', orderLabel(r.dir))}</span>`;
      });

      // Hidden · Column — × shows it again
      const hiddenChips = columns
        .filter((c) => state.hiddenCols.has(c.key))
        .map(
          (c) =>
            `<span class="dt-chip"><span class="dt-chip-tag is-hidden">Hidden</span>${segBtn(`data-show-col="${esc(c.key)}"`, `Show column ${c.label}`, 'Column', c.label)}</span>`
        );

      const total = conditionChips.length + sortChips.length + hiddenChips.length;
      els.chips.innerHTML =
        [...conditionChips, ...sortChips, ...hiddenChips].join('') +
        (total > 1 ? `<button type="button" class="dt-clear" data-clear>Clear all</button>` : '');
    }

    // Counts on the tool buttons, so active tools show even with the panel closed
    function renderCounts() {
      const setCount = (el, n) => {
        if (!el) return;
        el.textContent = n;
        el.hidden = n === 0;
      };
      setCount(els.searchCount, state.filters.filter((f) => f.source === 'search').length);
      setCount(els.filterCount, state.filters.filter((f) => f.source === 'filter').length);
      setCount(els.sortCount, sortRules().length);
    }

    function render() {
      const total = state.rows.length;
      const hasRows = total > 0;

      // Nothing to show: drop stale conditions so a new first row isn't hidden by them.
      // Sort and hidden columns are view preferences, so they are kept.
      if (!hasRows) {
        state.filters = [];
        state.filterRows = [];
        ensureEmptyRow();
        if (state.tool) closePanel({ restoreFocus: false });
      }
      els.table.hidden = !hasRows;
      els.empty.hidden = hasRows;
      els.tools.hidden = !hasRows;
      els.foot.hidden = !hasRows;

      renderHead();
      renderFilterRows();
      renderSortRows();
      renderColumnMenu();

      const shown = applySort(applyFilters(state.rows));
      const colspan = visibleColumns().length + (options.actions ? 1 : 0);
      const n = state.filters.length;
      const which = n === 1 ? 'this condition' : 'these conditions';

      els.body.innerHTML = !hasRows
        ? ''
        : shown.length
          ? shown.map(renderRow).join('')
          : `<tr class="dt-empty-row"><td colspan="${colspan}">No ${plural} match ${which}. Remove a condition below to see more.</td></tr>`;

      els.caption.textContent = n ? `${shown.length} of ${countLabel(total)}` : countLabel(total);

      // Screen-reader announcement; the caption, header arrows and chips already show this visually
      const rules = sortRules();
      const parts = [];
      if (n) parts.push(`Showing ${shown.length} of ${countLabel(total)} matching ${n === 1 ? 'this condition' : `all ${n} conditions`}.`);
      if (rules.length) parts.push(`Sorted by ${rules.map((r) => `${colOf(r.col).label} ${r.dir === 'asc' ? 'ascending' : 'descending'}`).join(', then ')}.`);
      els.status.textContent = parts.join(' ');

      renderChips();
      renderCounts();
    }

    els.chips.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-remove]');
      const rmSort = e.target.closest('[data-remove-sort]');
      const showCol = e.target.closest('[data-show-col]');
      if (rm) {
        const id = Number(rm.dataset.remove);
        const row = state.filterRows.find((r) => r.filterId === id);
        if (row) removeFilterRow(row.id); // chip came from a filter row: remove that row too
        else state.filters = state.filters.filter((f) => f.id !== id);
      } else if (rmSort) {
        removeSortRow(Number(rmSort.dataset.removeSort));
      } else if (showCol) {
        state.hiddenCols.delete(showCol.dataset.showCol);
      } else if (e.target.closest('[data-clear]')) {
        state.filters = [];
        state.filterRows = [];
        ensureEmptyRow();
        state.sortRows = [];
        ensureEmptySortRow();
        state.hiddenCols.clear();
      } else {
        return;
      }
      render();
      // The clicked chip is gone; keep focus somewhere sensible
      (els.chips.querySelector('button') ?? els.tools.querySelector('[data-tool]'))?.focus();
    });

    if (has.search) initSearch();
    if (has.filter) initFilter();
    if (has.sort) initSort();
    if (has.columns) initColumns();
    applyPanel();

    return {
      /** Replace the table's rows and re-render. Conditions, sorts and hidden columns are kept. */
      setRows(rows) {
        state.rows = rows;
        render();
      },
    };
  }

  window.DataTable = { create, RELATIONS, toLocalDate, formatDate };
})();