/**
 * settings.js
 * ---------------------------------------------------------------
 * Shared "Settings" panel: light/dark theme and a spacing scale
 * slider. Persisted in localStorage under one key so every page
 * (admin-surveys, admin-questions, survey) stays in sync.
 *
 * This script injects its own button + <dialog> into the page —
 * pages don't need to hand-write this markup, same spirit as
 * dialog.js being a shared behaviour rather than duplicated code.
 *
 * A tiny inline script in each page's <head> applies the saved
 * theme/spacing BEFORE this file loads, so there's no flash of
 * the wrong theme on load. This file only needs to handle the
 * interactive part: the button, the dialog, and live updates.
 * ---------------------------------------------------------------
 */

const SETTINGS_KEY = 'survey_app_settings';
const COLOR_SCHEMES = ['purple', 'green', 'beige'];
const DEFAULT_SETTINGS = { theme: 'light', spacingScale: 1, colorScheme: 'purple' };

function getSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      theme: parsed.theme === 'dark' ? 'dark' : 'light',
      spacingScale: typeof parsed.spacingScale === 'number' ? parsed.spacingScale : 1,
      colorScheme: COLOR_SCHEMES.includes(parsed.colorScheme) ? parsed.colorScheme : 'purple',
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function applySettings(settings) {
  document.documentElement.setAttribute('data-theme', settings.theme);
  document.documentElement.setAttribute('data-color-scheme', settings.colorScheme);
  document.documentElement.style.setProperty('--space-unit', `${8 * settings.spacingScale}px`);
}

function injectSettingsUI() {
  const settings = getSettings();

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-icon settings-toggle';
  btn.id = 'settings-btn';
  btn.setAttribute('aria-label', 'Settings');
  btn.innerHTML = '<svg class="icon" aria-hidden="true"><use href="icons/icons.svg#settings"></use></svg>';

  const nav = document.querySelector('.site-nav');
  (nav ?? document.body).appendChild(btn);

  const dialog = document.createElement('dialog');
  dialog.id = 'settings-dialog';
  dialog.setAttribute('aria-labelledby', 'settings-dialog-title');
  dialog.innerHTML = `
    <div class="dialog-body">
      <h2 id="settings-dialog-title">Settings</h2>

            <div class="settings-group">
        <span class="field-label" id="theme-label">Theme</span>
        <div class="theme-toggle" role="radiogroup" aria-labelledby="theme-label">
          <label class="theme-option">
            <input type="radio" name="theme" value="light" />
            <svg class="icon" aria-hidden="true"><use href="icons/icons.svg#sun"></use></svg>
            <span>Light</span>
          </label>
          <label class="theme-option">
            <input type="radio" name="theme" value="dark" />
            <svg class="icon" aria-hidden="true"><use href="icons/icons.svg#moon"></use></svg>
            <span>Dark</span>
          </label>
        </div>
      </div>

      <div class="settings-group">
        <span class="field-label" id="color-label">Color</span>
        <div class="color-toggle" role="radiogroup" aria-labelledby="color-label">
          <label class="color-option">
            <input type="radio" name="colorScheme" value="purple" />
            <span class="color-swatch" style="background: var(--scheme-preview-purple)"></span>
            <span>Purple</span>
          </label>
          <label class="color-option">
            <input type="radio" name="colorScheme" value="green" />
            <span class="color-swatch" style="background: var(--scheme-preview-green)"></span>
            <span>Green</span>
          </label>
          <label class="color-option">
            <input type="radio" name="colorScheme" value="beige" />
            <span class="color-swatch" style="background: var(--scheme-preview-beige)"></span>
            <span>Beige</span>
          </label>
        </div>
      </div>

      <div class="settings-group">
        <label for="spacing-slider" class="field-label">Spacing</label>
        <div class="range-row">
          <input type="range" id="spacing-slider" min="0.75" max="1.5" step="0.05" />
          <output for="spacing-slider" id="spacing-output" class="range-output"></output>
        </div>
        <p class="field-hint">Adjusts padding and gaps across the whole app.</p>
      </div>

      <div class="form-actions">
        <button type="button" class="btn" id="settings-close-btn">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);

  // Wire open/close for this dialog specifically (it didn't exist
  // yet when DialogUtil.initDialogs() ran at page load).
  btn.addEventListener('click', () => dialog.showModal());
  dialog.querySelector('#settings-close-btn').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

    // Theme radios
  dialog.querySelectorAll('input[name="theme"]').forEach((input) => {
    input.checked = input.value === settings.theme;
    input.addEventListener('change', () => {
      settings.theme = input.value;
      applySettings(settings);
      saveSettings(settings);
    });
  });

  // Color scheme radios
  dialog.querySelectorAll('input[name="colorScheme"]').forEach((input) => {
    input.checked = input.value === settings.colorScheme;
    input.addEventListener('change', () => {
      settings.colorScheme = input.value;
      applySettings(settings);
      saveSettings(settings);
    });
  });


  // Spacing slider
  const slider = dialog.querySelector('#spacing-slider');
  const output = dialog.querySelector('#spacing-output');
  slider.value = settings.spacingScale;
  output.textContent = `${Math.round(settings.spacingScale * 100)}%`;

  slider.addEventListener('input', () => {
    settings.spacingScale = Number(slider.value);
    output.textContent = `${Math.round(settings.spacingScale * 100)}%`;
    applySettings(settings); // live preview while dragging
  });
  slider.addEventListener('change', () => {
    saveSettings(settings); // persist once the user releases the slider
  });
}

// Re-apply immediately (the inline head snippet already did this
// before paint; this just keeps everything using one source of
// truth once the rest of the page's JS is running).
applySettings(getSettings());
injectSettingsUI();
