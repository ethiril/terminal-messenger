const TOAST_ELEMENT_ID = 'tm-toast';
const TOAST_VISIBLE_MS = 1600;

let toastHideTimer = null;

function showToast(message) {
  let toastElement = document.getElementById(TOAST_ELEMENT_ID);
  if (!toastElement) {
    toastElement = document.createElement('div');
    toastElement.id = TOAST_ELEMENT_ID;
    document.documentElement.appendChild(toastElement);
  }

  toastElement.textContent = `$ ${message}`;
  toastElement.classList.add('tm-toast-visible');

  if (toastHideTimer) clearTimeout(toastHideTimer);
  toastHideTimer = setTimeout(() => toastElement.classList.remove('tm-toast-visible'), TOAST_VISIBLE_MS);
}
