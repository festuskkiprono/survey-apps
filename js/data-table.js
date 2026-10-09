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
 * never clash and no ids are hard-coded here.
 *
 * Step 1: Search. Filter, Sort and Columns plug into the same
 * state and render() in later steps.
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
    if (!raw) return 'Enter a value to search for.';
    if (col.type === 'number' && !Number.isFinite(toNumber(raw))) return `${col.label} needs a number, like 5.`;
    return '';
  }

  /* ---------- Table factory ---------- */

  /**
   * options:
   *  columns: [{ key, label, type: 'text'|'number'|'date',
   *              value?(row)  -> the value searched (defaults to row[key]),
   *              cell?(row)   -> the full <td> html (defaults to the escaped value),
   *              searchable?  -> false to leave it out of Search,
   *              placeholder? -> hint text for the value box }]
   *  noun:    ['survey', 'surveys']
   *  actions?(row) -> html for a trailing actions cell (never searched)
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
      searchForm: q('search-form'),
      searchCol: q('search-col'),
      searchRel: q('search-rel'),
      searchVal: q('search-val'),
      searchField: q('search-field'),
      searchError: q('search-error'),
      searchCount: q('count-search'),
    };

    const columns = options.columns;
    const searchable = columns.filter((c) => c.searchable !== false);
    const [singular, plural] = options.noun ?? ['row', 'rows'];
    const TOOL_TITLES = { search: 'Search' };

    const state = {
      rows: [],      // everything the page handed over
      filters: [],   // active conditions: [{ id, col, rel, value, source: 'search' }]
      tool: null,    // which side panel is open: 'search' | null
    };
    let nextFilterId = 1;

    const colOf = (key) => columns.find((c) => c.key === key);
    const valueOf = (col, row) => (col.value ? col.value(row) : row[col.key]);
    const relLabel = (col, rel) => RELATIONS[col.type].find((r) => r[0] === rel)[1];
    const countLabel = (n) => `${n} ${n === 1 ? singular : plural}`;
    const shownValue = (col, raw) => (col.type === 'date' ? formatDate(raw) : raw);

    /* ----- Matching ----- */

    function matches(row, f) {
      const col = colOf(f.col);
      const v = valueOf(col, row);
      if (col.type === 'number') return TESTS[f.rel](Number(v), toNumber(f.value));
      if (col.type === 'date') return Boolean(v) && TESTS[f.rel](v, f.value); // rows with no date never match
      return TESTS[f.rel](String(v ?? ''), f.value);
    }

    const visibleRows = () => state.rows.filter((row) => state.filters.every((f) => matches(row, f)));

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
      els.searchVal.placeholder =
        col.placeholder ?? (col.type === 'number' ? 'e.g. 5' : col.type === 'text' ? 'e.g. feedback' : '');
      setSearchError('');
    }

    // Reuses the app's .field--invalid styling from components.css
    function setSearchError(msg) {
      els.searchError.textContent = msg;
      els.searchField.classList.toggle('field--invalid', Boolean(msg));
      if (msg) els.searchVal.setAttribute('aria-invalid', 'true');
      else els.searchVal.removeAttribute('aria-invalid');
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
        root.querySelector(`[data-tool-panel="${state.tool}"]`).querySelector('input, select, button')?.focus();
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
      els.head.innerHTML =
        columns.map((c) => `<th scope="col" class="${c.type === 'number' ? 'num' : ''}">${esc(c.label)}</th>`).join('') +
        (options.actions ? `<th scope="col">${esc(options.actionsLabel ?? 'Actions')}</th>` : '');
    }

    function renderRow(row) {
      const cells = columns.map((c) => (c.cell ? c.cell(row) : `<td>${esc(valueOf(c, row))}</td>`)).join('');
      const actions = options.actions ? `<td class="cell-actions">${options.actions(row)}</td>` : '';
      return `<tr>${cells}${actions}</tr>`;
    }

    // Chips: Search · Column · Relationship · Value — each segment's × removes the condition
    function renderChips() {
      const chips = state.filters
        .map((f) => {
          const col = colOf(f.col);
          const rel = relLabel(col, f.rel);
          const val = shownValue(col, f.value);
          const aria = esc(`Remove search: ${col.label} ${rel} ${val}`);
          const seg = (k, v) =>
            `<button type="button" data-remove="${f.id}" aria-label="${aria}"><span class="k">${k}</span>${esc(v)}<span class="x" aria-hidden="true">×</span></button>`;
          return `<span class="dt-chip"><span class="dt-chip-tag">Search</span>${seg('Column', col.label)}${seg('Relationship', rel)}${seg('Value', val)}</span>`;
        })
        .join('');
      els.chips.innerHTML =
        chips + (state.filters.length > 1 ? `<button type="button" class="dt-clear" data-clear>Clear all</button>` : '');
    }

    // Counts on the tool buttons, so active conditions show even with the panel closed
    function renderCounts() {
      const n = state.filters.filter((f) => f.source === 'search').length;
      els.searchCount.textContent = n;
      els.searchCount.hidden = n === 0;
    }

    function render() {
      const total = state.rows.length;
      const hasRows = total > 0;

      // Nothing to search: drop stale conditions so a new first row isn't hidden by them
      if (!hasRows) {
        state.filters = [];
        if (state.tool) closePanel({ restoreFocus: false });
      }
      els.table.hidden = !hasRows;
      els.empty.hidden = hasRows;
      els.tools.hidden = !hasRows;
      els.foot.hidden = !hasRows;

      renderHead();

      const shown = visibleRows();
      const colspan = columns.length + (options.actions ? 1 : 0);
      const n = state.filters.length;

      els.body.innerHTML = !hasRows
        ? ''
        : shown.length
          ? shown.map(renderRow).join('')
          : `<tr class="dt-empty-row"><td colspan="${colspan}">No ${plural} match ${n === 1 ? 'this search' : 'these searches'}. Remove a condition below to see more.</td></tr>`;

      els.caption.textContent = n ? `${shown.length} of ${countLabel(total)}` : countLabel(total);

      // Screen-reader announcement; the caption and chips already show this visually
      els.status.textContent = n
        ? `Showing ${shown.length} of ${countLabel(total)} matching ${n === 1 ? 'this search' : `all ${n} searches`}.`
        : '';

      renderChips();
      renderCounts();
    }

    els.chips.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-remove]');
      if (rm) state.filters = state.filters.filter((f) => f.id !== Number(rm.dataset.remove));
      else if (e.target.closest('[data-clear]')) state.filters = [];
      else return;
      render();
      // The clicked chip is gone; keep focus somewhere sensible
      (els.chips.querySelector('button') ?? els.tools.querySelector('[data-tool="search"]'))?.focus();
    });

    initSearch();
    applyPanel();

    return {
      /** Replace the table's rows and re-render. Active conditions are kept. */
      setRows(rows) {
        state.rows = rows;
        render();
      },
    };
  }

  window.DataTable = { create, RELATIONS, toLocalDate, formatDate };
})();