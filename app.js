/* Emergency rollback: load the last known-good GoalOS app from its immutable commit. */
(() => {
  'use strict';
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/gh/matirauf2020-prog/GOAL-_GOOGLE_SHEETS@dc11e91f4a73a226359d14321a0efec878858611/app.js';
  script.async = false;
  script.onerror = () => {
    console.error('Could not load the last known-good GoalOS app bundle.');
    const app = document.getElementById('app');
    if (app) app.textContent = 'GoalOS could not load. Please check your internet connection and refresh.';
  };
  document.head.appendChild(script);
})();
