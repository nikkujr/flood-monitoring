// Run in the browser console on an admin records page, at desktop and mobile widths.
(() => {
  const inputs = [...document.querySelectorAll('.toolbar label > input')];
  if (!inputs.length) throw new Error('Open an admin records page before checking its search toolbar.');
  for (const input of inputs) {
    const box = input.getBoundingClientRect();
    const wrapper = input.closest('label').getBoundingClientRect();
    const style = getComputedStyle(input);
    if (box.top < wrapper.top || box.bottom > wrapper.bottom || box.left < wrapper.left || box.right > wrapper.right) {
      throw new Error('Search input overlaps its wrapper.');
    }
    if (style.borderTopWidth !== '0px' || style.borderLeftWidth !== '0px') {
      throw new Error('Search input has a second border inside its wrapper.');
    }
    if (wrapper.height < 44) throw new Error('Search field is smaller than the shared control height.');
  }
  const pageButtons = [...document.querySelectorAll('.pagination > div > button')];
  if (pageButtons.length && pageButtons.some(button => button.getBoundingClientRect().top !== pageButtons[0].getBoundingClientRect().top)) {
    throw new Error('Pagination buttons are stacked instead of sharing a row.');
  }
  return 'Admin toolbar containment checks passed.';
})();
