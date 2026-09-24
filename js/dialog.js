/**
 * dialog.js
 * ---------------------------------------------------------------
 * Small reusable helpers around the native <dialog> element.
 * All three pages open/close modals (create/edit survey,
 * add/edit question, delete confirmation, preview) — this keeps
 * that logic in one place instead of duplicated per page.
 * ---------------------------------------------------------------
 */

/**
 * Opens a <dialog> by id. Uses showModal() for a real modal
 * (focus-trapped, backdrop, closes on Escape natively).
 */
function openDialog(dialogId) {
  const dialog = document.getElementById(dialogId);
  if (!dialog) return;
  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }
}

function closeDialog(dialogId) {
  const dialog = document.getElementById(dialogId);
  if (!dialog) return;
  dialog.close ? dialog.close() : dialog.removeAttribute('open');
}

/**
 * Wires up every element with [data-close-dialog="dialogId"] to
 * close that dialog when clicked, and makes clicking the dialog's
 * own backdrop (a click directly on the <dialog> element, outside
 * its content box) close it too.
 */
function initDialogs() {
  document.querySelectorAll('dialog').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) {
        dialog.close();
      }
    });
  });

  document.querySelectorAll('[data-close-dialog]').forEach((el) => {
    el.addEventListener('click', () => {
      closeDialog(el.getAttribute('data-close-dialog'));
    });
  });

  document.querySelectorAll('[data-open-dialog]').forEach((el) => {
    el.addEventListener('click', () => {
      openDialog(el.getAttribute('data-open-dialog'));
    });
  });
}

/**
 * Shows a confirmation dialog and calls onConfirm if the user
 * confirms. Expects the page to have a <dialog id="confirm-dialog">
 * with a message slot [data-confirm-message] and a
 * [data-confirm-accept] button.
 */
function confirmAction(message, onConfirm) {
  const dialog = document.getElementById('confirm-dialog');
  if (!dialog) {
    // Fallback if the page hasn't got a confirm dialog markup.
    if (window.confirm(message)) onConfirm();
    return;
  }

  const messageEl = dialog.querySelector('[data-confirm-message]');
  if (messageEl) messageEl.textContent = message;

  const acceptBtn = dialog.querySelector('[data-confirm-accept]');
  const handler = () => {
    acceptBtn.removeEventListener('click', handler);
    dialog.close();
    onConfirm();
  };
  acceptBtn.addEventListener('click', handler);

  openDialog('confirm-dialog');
}

window.DialogUtil = { openDialog, closeDialog, initDialogs, confirmAction };
