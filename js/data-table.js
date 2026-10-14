/**
 * data-table.js
 * ---------------------------------------------------------------
 * Reusable table tools, shared by every admin table. Same idea as
 * dialog.js and render-input.js: one shared behaviour, exposed on
 * window, instead of per-page copies.
 *
 * A page describes its table (columns, how a row is drawn, row
 * actions) and hands over rows with setRows(). This file owns
 * everything else: the header, the rows, the tool panel, the
 * active conditions, chips, counts and empty states.
 *
 * Markup: the page writes the static shell (see admin-surveys.html)
 * and marks the pieces with data-dt="..." attributes. Lookups are
 * scoped to the table's root element, so two tables on one page
 * never clash and no ids are hard-coded here. A tool whose markup
 * is missing from the shell is simply switched off.
 *
 * Tools (the open tool's panel sits between the toolbar and the table):
 *  - Search:  one condition at a time; the Search button adds it.
 *  - Filter:  draft rows (+ adds a row, the bin removes one). Nothing
 *             reaches the table until the Filter button is pressed.
 *  - Sort:    draft levels, applied with the Sort button. The first
 *             level sorts; later ones break ties. Clicking a column
 *             header is a quick sort that applies straight away.
 *  - Columns: tick boxes to hide/show columns (one always stays).
 * Search and Filter conditions sit in one `filters` list, and every
 * condition must match (AND). Removing a chip applies straight away.
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
      filterApply: q('filter-apply'),
      filterPending: q('filter-pending'),
      filterCount: q('count-filter'),
      // Sort
      sortRows: q('sort-rows'),
      sortApply: q('sort-apply'),
      sortPending: q('sort-pending'),
      sortCount: q('count-sort'),
      // Columns
      colChecks: q('col-checks'),
      showAllCols: q('show-all-cols'),
      colCount: q('count-columns'),
    };

    const has = {
      search: Boolean(els.searchForm),
      filter: Boolean(els.filterRows && els.filterApply),
      sort: Boolean(els.sortRows && els.sortApply),
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
      filters: [],           // APPLIED conditions: [{ id, col, rel, value, source: 'search' | 'filter', rowId? }]
      filterRows: [],        // DRAFT filter rows in the panel: [{ id, col, rel, value, error }]
      sorts: [],             // APPLIED sort levels, in priority order: [{ rowId, col, dir }]
      sortRows: [],          // DRAFT sort rows in the panel: [{ id, col ('' = not chosen), dir, error }]
      hiddenCols: new Set(), // keys of columns the user has hidden
      tool: null,            // which panel is open: 'search' | 'filter' | 'sort' | 'columns' | null
    };
    let nextFilterId = 1;
    let nextRowId = 1;

    const colOf = (key) => columns.find((c) => c.key === key);
    const valueOf = (col, row) => (col.value ? col.value(row) : row[col.key]);
    const relLabel = (col, rel) => RELATIONS[col.type].find((r) => r[0] === rel)[1];
    const orderLabel = (dir) => (dir === 'asc' ? 'Ascending' : 'Descending');
    const countLabel = (n) => `${n} ${n === 1 ? singular : plural}`;
    const shownValue = (col, raw) => (col.type === 'date' ? formatDate(raw) : raw);
    const placeholderFor = (col) =>
      col.placeholder ?? (col.type === 'number' ? 'e.g. 5' : col.type === 'text' ? 'e.g. feedback' : '');
    const visibleColumns = () => columns.filter((c) => !state.hiddenCols.has(c.key));
    const focusId = (id) => document.getElementById(id)?.focus();

    /* ----- Matching + sorting ----- */

    function matches(row, f) {
      const col = colOf(f.col);
      const v = valueOf(col, row);
      if (col.type === 'number') return TESTS[f.rel](Number(v), toNumber(f.value));
      if (col.type === 'date') return Boolean(v) && TESTS[f.rel](v, f.value); // rows with no date never match
      return TESTS[f.rel](String(v ?? ''), f.value);
    }

    const matchAll = (rows) => rows.filter((row) => state.filters.every((f) => matches(row, f)));

    // Numbers compare as numbers; text and dates with localeCompare, so "apple" and "Zebra"
    // sort alphabetically regardless of case, and "Survey 2" comes before "Survey 10".
    function compareBy(col, a, b) {
      const va = valueOf(col, a);
      const vb = valueOf(col, b);
      if (col.type === 'number') return Number(va) - Number(vb);
      return String(va ?? '').localeCompare(String(vb ?? ''), undefined, { sensitivity: 'base', numeric: true });
    }

    function sortAll(rows) {
      if (!state.sorts.length) return rows;
      return [...rows].sort((a, b) => {
        for (const { col, dir } of state.sorts) { // first level decides; later levels break ties
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

    function setSearchError(msg) {
      els.searchError.textContent = msg;
      els.searchField?.classList.toggle('field--invalid', Boolean(msg));
      if (msg) els.searchVal.setAttribute('aria-invalid', 'true');
      else els.searchVal.removeAttribute('aria-invalid');
    }

    /* ----- Shared helpers for the draft row lists ----- */

    // Clear one row's inline error without redrawing the list (keeps focus where it is)
    function clearRowError(row, rowEl) {
      if (!row.error) return;
      row.error = '';
      rowEl.querySelectorAll('[aria-invalid]').forEach((el) => {
        el.removeAttribute('aria-invalid');
        el.removeAttribute('aria-describedby');
      });
      rowEl.querySelector('.dt-f-error')?.remove();
    }

    // Labels are shown on the first row only; later rows keep them for screen readers
    const labelClass = (i) => (i === 0 ? 'field-label' : 'field-label visually-hidden');

    const rowButtons = (noun) => `
      <div class="dt-f-actions">
        <button type="button" class="btn btn-icon dt-f-add" data-action="add" aria-label="Add a ${noun} row below" title="Add a row">${ICONS.plus}</button>
        <button type="button" class="btn btn-icon dt-f-bin" data-action="delete" aria-label="Remove this ${noun} row" title="Remove row">${ICONS.bin}</button>
      </div>`;

    /* ----- Filter: draft rows, applied with the Filter button ----- */

    function newFilterRow() {
      const col = searchable[0];
      return { id: nextRowId++, col: col.key, rel: RELATIONS[col.type][0][0], value: '', error: '' };
    }

    function ensureFilterRow() {
      if (has.filter && state.filterRows.length === 0) state.filterRows.push(newFilterRow());
    }

    const filterRowById = (id) => state.filterRows.find((r) => r.id === Number(id));
    const fid = (part, rowId) => `${idPrefix}-f${part}-${rowId}`;
    const appliedFilters = () => state.filters.filter((f) => f.source === 'filter');
    const filledFilterRows = () => state.filterRows.filter((r) => r.value.trim() !== '');

    // A draft row is "applied" when the table is using exactly what it says
    function isFilterRowApplied(r) {
      const f = appliedFilters().find((x) => x.rowId === r.id);
      return Boolean(f) && f.col === r.col && f.rel === r.rel && f.value === r.value.trim();
    }

    // True when the panel holds changes the table isn't using yet
    function filterIsPending() {
      const draft = filledFilterRows().map((r) => `${r.id}|${r.col}|${r.rel}|${r.value.trim()}`).join('\n');
      const live = appliedFilters().map((f) => `${f.rowId}|${f.col}|${f.rel}|${f.value}`).join('\n');
      return draft !== live;
    }

    function renderFilterRows() {
      if (!has.filter) return;
      els.filterRows.innerHTML = state.filterRows
        .map((r, i) => {
          const col = colOf(r.col);
          const invalid = r.error ? `aria-invalid="true" aria-describedby="${fid('err', r.id)}"` : '';
          return `<div class="dt-frow${isFilterRowApplied(r) ? ' is-applied' : ''}" data-frow="${r.id}">
            <div class="dt-f-col">
              <label class="${labelClass(i)}" for="${fid('col', r.id)}">Column</label>
              <select id="${fid('col', r.id)}" data-field="col">
                ${searchable.map((c) => `<option value="${esc(c.key)}" ${c.key === r.col ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
              </select>
            </div>
            <div class="dt-f-rel">
              <label class="${labelClass(i)}" for="${fid('rel', r.id)}">Relationship</label>
              <select id="${fid('rel', r.id)}" data-field="rel">
                ${RELATIONS[col.type].map(([v, l]) => `<option value="${v}" ${v === r.rel ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
            </div>
            <div class="dt-f-val">
              <label class="${labelClass(i)}" for="${fid('val', r.id)}">Value</label>
              <input id="${fid('val', r.id)}" data-field="value" type="${col.type === 'date' ? 'date' : 'text'}"
                inputmode="${col.type === 'number' ? 'decimal' : 'text'}" placeholder="${esc(placeholderFor(col))}"
                value="${esc(r.value)}" autocomplete="off" ${invalid}>
            </div>
            ${rowButtons('filter')}
            ${r.error ? `<p class="field-error dt-f-error" id="${fid('err', r.id)}">${esc(r.error)}</p>` : ''}
          </div>`;
        })
        .join('');
    }

    // Validate every row; apply them all together, or apply nothing
    function commitFilters() {
      state.filterRows.forEach((r) => (r.error = ''));
      const filled = filledFilterRows();
      let firstBad = null;

      filled.forEach((r) => {
        const err = validateCondition(colOf(r.col), r.value.trim());
        if (err) {
          r.error = err;
          firstBad ??= r;
        }
      });
      // Pressing Filter on an empty panel with nothing applied: say what's missing
      if (!filled.length && !appliedFilters().length) {
        firstBad = state.filterRows[0];
        firstBad.error = 'Enter a value.';
      }
      if (firstBad) {
        renderFilterRows();
        updatePending();
        focusId(fid('val', firstBad.id));
        return;
      }

      filled.forEach((r) => (r.value = r.value.trim()));
      state.filters = state.filters
        .filter((f) => f.source !== 'filter')
        .concat(filled.map((r) => ({ id: nextFilterId++, rowId: r.id, col: r.col, rel: r.rel, value: r.value, source: 'filter' })));
      // Blank rows have done their job; keep the filled ones (or one blank row to type into)
      state.filterRows = filled;
      ensureFilterRow();
      render();
      els.filterApply.focus();
    }

    function initFilter() {
      const container = els.filterRows;

      // Keep typed values in state so redrawing never loses them
      container.addEventListener('input', (e) => {
        const rowEl = e.target.closest('[data-frow]');
        const row = rowEl && filterRowById(rowEl.dataset.frow);
        if (!row || e.target.dataset.field !== 'value') return;
        row.value = e.target.value;
        clearRowError(row, rowEl);
        updatePending();
      });

      // Column change resets Relationship and Value to fit the new column's type
      container.addEventListener('change', (e) => {
        const rowEl = e.target.closest('[data-frow]');
        const row = rowEl && filterRowById(rowEl.dataset.frow);
        if (!row) return;
        if (e.target.dataset.field === 'col') {
          Object.assign(row, { col: e.target.value, rel: RELATIONS[colOf(e.target.value).type][0][0], value: '', error: '' });
          renderFilterRows();
          focusId(fid('val', row.id));
        } else if (e.target.dataset.field === 'rel') {
          row.rel = e.target.value;
        }
        updatePending();
      });

      // Enter in a value box presses the Filter button
      container.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.target.dataset.field !== 'value') return;
        e.preventDefault();
        commitFilters();
      });

      container.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const row = filterRowById(btn.closest('[data-frow]').dataset.frow);
        const index = state.filterRows.indexOf(row);

        if (btn.dataset.action === 'add') {
          const fresh = newFilterRow();
          state.filterRows.splice(index + 1, 0, fresh); // new row goes right below this one
          renderFilterRows();
          updatePending();
          focusId(fid('col', fresh.id));
        }

        // Removing a row only changes the draft; the table updates when Filter is pressed
        if (btn.dataset.action === 'delete') {
          state.filterRows.splice(index, 1);
          ensureFilterRow();
          renderFilterRows();
          updatePending();
          const next = state.filterRows[Math.min(index, state.filterRows.length - 1)];
          focusId(fid('val', next.id));
        }
      });

      els.filterApply.addEventListener('click', commitFilters);
      ensureFilterRow();
    }

    /* ----- Sort: draft levels, applied with the Sort button ----- */

    function newSortRow(col = '', dir = 'asc') {
      return { id: nextRowId++, col, dir, error: '' };
    }

    function ensureSortRow() {
      if (has.sort && state.sortRows.length === 0) state.sortRows.push(newSortRow());
    }

    const sortRowById = (id) => state.sortRows.find((r) => r.id === Number(id));
    const sid = (part, rowId) => `${idPrefix}-s${part}-${rowId}`;
    const filledSortRows = () => state.sortRows.filter((r) => r.col);

    function isSortRowApplied(r) {
      const s = state.sorts.find((x) => x.rowId === r.id);
      return Boolean(s) && s.col === r.col && s.dir === r.dir;
    }

    function sortIsPending() {
      const draft = filledSortRows().map((r) => `${r.id}|${r.col}|${r.dir}`).join('\n');
      const live = state.sorts.map((s) => `${s.rowId}|${s.col}|${s.dir}`).join('\n');
      return draft !== live;
    }

    function renderSortRows() {
      if (!has.sort) return;
      els.sortRows.innerHTML = state.sortRows
        .map((r, i) => {
          const invalid = r.error ? `aria-invalid="true" aria-describedby="${sid('err', r.id)}"` : '';
          return `<div class="dt-frow dt-srow${isSortRowApplied(r) ? ' is-applied' : ''}" data-srow="${r.id}">
            <span class="dt-s-lead">${i === 0 ? 'Sort by' : 'Then by'}</span>
            <div class="dt-s-col">
              <label class="${labelClass(i)}" for="${sid('col', r.id)}">Column</label>
              <select id="${sid('col', r.id)}" data-field="col" ${invalid}>
                <option value="" ${r.col ? '' : 'selected'}>Choose a column</option>
                ${sortable.map((c) => `<option value="${esc(c.key)}" ${c.key === r.col ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
              </select>
            </div>
            <div class="dt-s-dir">
              <label class="${labelClass(i)}" for="${sid('dir', r.id)}">Order</label>
              <select id="${sid('dir', r.id)}" data-field="dir">
                ${SORT_ORDERS.map(([v, l]) => `<option value="${v}" ${v === r.dir ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
            </div>
            ${rowButtons('sort')}
            ${r.error ? `<p class="field-error dt-f-error" id="${sid('err', r.id)}">${esc(r.error)}</p>` : ''}
          </div>`;
        })
        .join('');
    }

    function commitSorts() {
      state.sortRows.forEach((r) => (r.error = ''));
      const filled = filledSortRows();
      const seen = new Set();
      let firstBad = null;

      // A column can only be sorted once; a second level on it would never break a tie
      filled.forEach((r) => {
        if (seen.has(r.col)) {
          r.error = `${colOf(r.col).label} is already a sort level above. Pick another column or remove this row.`;
          firstBad ??= r;
        }
        seen.add(r.col);
      });
      if (!filled.length && !state.sorts.length) {
        firstBad = state.sortRows[0];
        firstBad.error = 'Choose a column to sort by.';
      }
      if (firstBad) {
        renderSortRows();
        updatePending();
        focusId(sid('col', firstBad.id));
        return;
      }

      state.sorts = filled.map((r) => ({ rowId: r.id, col: r.col, dir: r.dir }));
      state.sortRows = filled;
      ensureSortRow();
      render();
      els.sortApply.focus();
    }

    function initSort() {
      els.sortRows.addEventListener('change', (e) => {
        const rowEl = e.target.closest('[data-srow]');
        const row = rowEl && sortRowById(rowEl.dataset.srow);
        const field = e.target.dataset.field;
        if (!row || (field !== 'col' && field !== 'dir')) return;
        row[field] = e.target.value;
        clearRowError(row, rowEl);
        updatePending();
      });

      els.sortRows.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const row = sortRowById(btn.closest('[data-srow]').dataset.srow);
        const index = state.sortRows.indexOf(row);

        if (btn.dataset.action === 'add') {
          const fresh = newSortRow();
          state.sortRows.splice(index + 1, 0, fresh);
          renderSortRows();
          updatePending();
          focusId(sid('col', fresh.id));
        }

        // Removing a level only changes the draft; the table updates when Sort is pressed
        if (btn.dataset.action === 'delete') {
          state.sortRows.splice(index, 1);
          ensureSortRow();
          renderSortRows();
          updatePending();
          const next = state.sortRows[Math.min(index, state.sortRows.length - 1)];
          focusId(sid('col', next.id));
        }
      });

      els.sortApply.addEventListener('click', commitSorts);

      // Header arrows: a quick sort that applies straight away.
      // The Sort panel rows are updated to match, so the two never disagree.
      els.head.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-sort-key]');
        if (!btn) return;
        const key = btn.dataset.sortKey;
        const existing = state.sorts.find((s) => s.col === key);
        if (existing) {
          existing.dir = existing.dir === 'asc' ? 'desc' : 'asc'; // already sorted: flip it, keep other levels
          const row = state.sortRows.find((r) => r.id === existing.rowId);
          if (row) row.dir = existing.dir;
        } else {
          // A header click on a new column replaces all sort levels with that one column
          const row = newSortRow(key, 'asc');
          state.sortRows = [row];
          state.sorts = [{ rowId: row.id, col: key, dir: 'asc' }];
        }
        render();
        els.head.querySelector(`[data-sort-key="${key}"]`)?.focus(); // the header was redrawn
      });

      ensureSortRow();
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
        focusId(`${idPrefix}-colvis-${key}`); // keep focus in the list after it redraws
      });
      els.showAllCols?.addEventListener('click', () => {
        state.hiddenCols.clear();
        render();
        els.colChecks.querySelector('input')?.focus();
      });
    }

    /* ----- Tool buttons + panel ----- */

    function applyPanel() {
      const t = state.tool;
      els.side.hidden = !t;
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

    // "Changes not applied yet" notes beside the Filter and Sort buttons
    function updatePending() {
      const set = (pendingEl, applyBtn, on) => {
        if (pendingEl) pendingEl.hidden = !on;
        applyBtn?.classList.toggle('is-pending', on);
      };
      if (has.filter) set(els.filterPending, els.filterApply, filterIsPending());
      if (has.sort) set(els.sortPending, els.sortApply, sortIsPending());
    }

    function renderHead() {
      els.head.innerHTML =
        visibleColumns()
          .map((c) => {
            const cls = c.type === 'number' ? 'num' : '';
            if (!has.sort || c.sortable === false) return `<th scope="col" class="${cls}">${esc(c.label)}</th>`;
            const i = state.sorts.findIndex((s) => s.col === c.key);
            const aria = i === -1 ? 'none' : state.sorts[i].dir === 'asc' ? 'ascending' : 'descending';
            const level = i !== -1 && state.sorts.length > 1 ? `<span class="dt-priority" title="Sort level ${i + 1}">${i + 1}</span>` : '';
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

    // Bottom chips show what the table is using. Each segment's × undoes that one thing.
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
      const sortChips = state.sorts.map((s) => {
        const label = colOf(s.col).label;
        const aria = `Remove sort: ${label} ${orderLabel(s.dir)}`;
        const seg = (k, v) => segBtn(`data-remove-sort="${s.rowId}"`, aria, k, v);
        return `<span class="dt-chip"><span class="dt-chip-tag is-sort">Sort</span>${seg('Column', label)}${seg('Order', orderLabel(s.dir))}</span>`;
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

    // Counts on the tool buttons reflect what is applied, so they show even with the panel closed
    function renderCounts() {
      const setCount = (el, n) => {
        if (!el) return;
        el.textContent = n;
        el.hidden = n === 0;
      };
      setCount(els.searchCount, state.filters.filter((f) => f.source === 'search').length);
      setCount(els.filterCount, appliedFilters().length);
      setCount(els.sortCount, state.sorts.length);
    }

    function render() {
      const total = state.rows.length;
      const hasRows = total > 0;

      // Nothing to show: drop stale conditions so a new first row isn't hidden by them.
      // Sort and hidden columns are view preferences, so they are kept.
      if (!hasRows) {
        state.filters = [];
        state.filterRows = [];
        ensureFilterRow();
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
      updatePending();

      const shown = sortAll(matchAll(state.rows));
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
      const parts = [];
      if (n) parts.push(`Showing ${shown.length} of ${countLabel(total)} matching ${n === 1 ? 'this condition' : `all ${n} conditions`}.`);
      if (state.sorts.length) parts.push(`Sorted by ${state.sorts.map((s) => `${colOf(s.col).label} ${s.dir === 'asc' ? 'ascending' : 'descending'}`).join(', then ')}.`);
      els.status.textContent = parts.join(' ');

      renderChips();
      renderCounts();
    }

    // Chips apply straight away, and take the matching panel row with them
    els.chips.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-remove]');
      const rmSort = e.target.closest('[data-remove-sort]');
      const showCol = e.target.closest('[data-show-col]');
      if (rm) {
        const f = state.filters.find((x) => x.id === Number(rm.dataset.remove));
        state.filters = state.filters.filter((x) => x !== f);
        if (f?.source === 'filter') {
          state.filterRows = state.filterRows.filter((r) => r.id !== f.rowId);
          ensureFilterRow();
        }
      } else if (rmSort) {
        const rowId = Number(rmSort.dataset.removeSort);
        state.sorts = state.sorts.filter((s) => s.rowId !== rowId);
        state.sortRows = state.sortRows.filter((r) => r.id !== rowId);
        ensureSortRow();
      } else if (showCol) {
        state.hiddenCols.delete(showCol.dataset.showCol);
      } else if (e.target.closest('[data-clear]')) {
        state.filters = [];
        state.filterRows = [];
        ensureFilterRow();
        state.sorts = [];
        state.sortRows = [];
        ensureSortRow();
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