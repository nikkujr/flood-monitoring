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
  const open = async (label, title) => {
    const button = [...document.querySelectorAll('nav[aria-label="Administration"] button')].find(item => item.textContent.includes(label));
    if (!button) throw new Error(`Missing navigation: ${label}`);
    button.click();
    await waitFor(() => document.querySelector('app-dss h1')?.textContent === title && document.querySelector('app-dss .statistics-tabs'));
  };
  const hasHeading = text => [...document.querySelectorAll('app-dss h2')].some(item => item.textContent === text);
  try {
    await open('Reports & Statistics', 'Reports & Statistics');
    if (location.pathname !== '/admin/statistics' || hasHeading('Zone assessment') || hasHeading('Recommended actions')) throw new Error('Decision outputs remain on Reports & Statistics.');
    if (!hasHeading('Report status distribution')) throw new Error('Report analytics are missing.');
    await open('Decision Support (DSS)', 'Decision Support System');
    if (location.pathname !== '/admin/dss' || !hasHeading('Zone assessment') || !hasHeading('Recommended actions')) throw new Error('DSS decision outputs are missing.');
    const actions = document.querySelector('app-dss .recommendations-panel');
    if (!actions || actions.hidden) throw new Error('Recommended actions must appear on the opening overview.');
    const zoneTab = [...document.querySelectorAll('app-dss .statistics-tabs button')].find(item => item.textContent === 'Zone assessment');
    zoneTab.click();
    await waitFor(() => [...document.querySelectorAll('app-dss h2')].find(item => item.textContent === 'Zone assessment')?.closest('section').hidden === false);
    return 'DSS navigation, moved sections, overview actions, and retained statistics passed.';
  } finally {
    history.replaceState({}, '', originalPath);
    dispatchEvent(new PopStateEvent('popstate'));
  }
})()
