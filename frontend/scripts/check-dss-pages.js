// Paste into the browser console while signed into the admin application.
(async () => {
  const originalPath = location.pathname;
  const waitFor = async predicate => {
    const deadline = Date.now() + 15000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('DSS page did not become ready.');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  };
  const hasHeading = text => [...document.querySelectorAll('h2')].some(item => item.textContent === text && item.getBoundingClientRect().height > 0);
  const open = async (label, title) => {
    const button = [...document.querySelectorAll('nav[aria-label="Administration"] button')].find(item => item.textContent.includes(label));
    if (!button) throw new Error(`Missing navigation: ${label}`);
    button.click();
    await waitFor(() => [...document.querySelectorAll('h1')].some(item => item.textContent === title));
  };
  try {
    await open('Reports & Statistics', 'Reports & Statistics');
    await waitFor(() => hasHeading('Report status distribution'));
    await open('Decision Support (DSS)', 'Decision Support System');
    await waitFor(() => hasHeading('Priority Areas and Recommended Actions') && hasHeading('Priority Households'));
    if (document.querySelector('app-dss .metrics')) throw new Error('DSS summary cards remain.');
    const actions = [...document.querySelectorAll('app-dss .heading-actions button')];
    if (!actions[0]?.textContent.includes('Assessment filters') || !actions[1]?.textContent.includes('Refresh')) throw new Error('Assessment filters must be beside Refresh.');
    if (!document.querySelector('app-dss .decision-reference')) throw new Error('Decision Rules footer reference is missing.');
    await open('Evacuation Planner', 'Evacuation Planner');
    await waitFor(() => hasHeading('Evacuation & rescue'));
    await open('Assistance and Shelters', 'Assistance and Shelters');
    await waitFor(() => hasHeading('Residents needing assistance') && hasHeading('Center capacity'));
    if ([...document.querySelectorAll('nav[aria-label="Administration"] button')].some(item => item.textContent.includes('Response Management'))) throw new Error('Removed Response Management page remains in navigation.');
    return 'DSS tables, filter placement, footer reference, separate pages, and retained statistics passed.';
  } finally {
    history.replaceState({}, '', originalPath);
    dispatchEvent(new PopStateEvent('popstate'));
  }
})()
