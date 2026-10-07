// Run in the browser console with a resident or evacuation-center editor open.
(() => {
  const editor = document.querySelector('.editor-wizard');
  if (!editor) throw new Error('Open a long record form first.');
  if (editor.querySelectorAll('.editor-section:not([hidden]), .editor-review:not([hidden])').length !== 1) throw new Error('Only the current step should be visible.');
  if (editor.querySelector('.editor-review[hidden]') && [...editor.querySelectorAll('.modal-actions button')].some(button => button.textContent.trim() === 'Save changes')) throw new Error('Saving must require the review step.');
  const review = editor.querySelector('.editor-review:not([hidden])');
  if (review && review.getBoundingClientRect().width < editor.querySelector('form').getBoundingClientRect().width - 2) throw new Error('Review must fill the form width.');
  if (editor.querySelectorAll('.editor-progress [aria-current="step"]').length !== 1) throw new Error('Exactly one step must be current.');
  const progress = editor.querySelector('.editor-progress');
  const stepList = progress.querySelector('ol');
  if (!progress.classList.contains('expanded') && getComputedStyle(stepList).display !== 'none') throw new Error('Step list should be collapsed at every screen size.');
  if (progress.classList.contains('expanded') && stepList.getBoundingClientRect().height > Math.min(160, innerHeight * .25) + 1) throw new Error('Expanded steps should have a bounded scrolling area.');
  if (editor.querySelector('.editor-section[hidden] input:disabled')) throw new Error('Earlier entries must remain available for submission.');
  const bounds = editor.getBoundingClientRect();
  for (const button of editor.querySelectorAll('.modal-actions button')) {
    const box = button.getBoundingClientRect();
    if (box.bottom > bounds.bottom || box.top < bounds.top || box.right > bounds.right || box.left < bounds.left) throw new Error('Wizard action is outside the dialog.');
  }
  return 'Wizard visibility and action placement checks passed.';
})();
