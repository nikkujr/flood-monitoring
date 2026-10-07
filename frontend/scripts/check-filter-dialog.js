// Paste into the browser console with any filter dialog open.
(() => {
  const dialog = document.querySelector('dialog:modal');
  if (!dialog) throw new Error('Open a filter dialog first.');
  const rect = dialog.getBoundingClientRect();
  if (rect.height < 100 || rect.left < 0 || rect.right > innerWidth || rect.top < 0 || rect.bottom > innerHeight) throw new Error('Filter dialog is outside the viewport or collapsed.');
  if (dialog.scrollWidth > dialog.clientWidth) throw new Error('Filter dialog overflows horizontally.');
  if (!dialog.contains(document.activeElement)) throw new Error('Keyboard focus is outside the filter dialog.');
  if (getComputedStyle(dialog, '::backdrop').backgroundColor === 'rgba(0, 0, 0, 0)') throw new Error('Filter backdrop is transparent.');
  return 'Filter backdrop, modal focus, and responsive layout passed.';
})()
