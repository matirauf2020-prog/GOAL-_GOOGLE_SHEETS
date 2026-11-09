/* Public OAuth Web Client ID. Do not upload a client secret or OAuth JSON. */
window.GOALOS_GOOGLE_CLIENT_ID = '742709884845-i6ikkp6eni62vdvtqb00upra29kj3n0a.apps.googleusercontent.com';

// Load the optional receipt tools without coupling them to the app's main bundle.
(function loadGoalOSReceiptTools() {
  const current = document.currentScript;
  if (!current || document.querySelector('[data-goalos-receipt-script]')) return;
  const script = document.createElement('script');
  script.src = new URL('receipt.js', current.src).href;
  script.defer = true;
  script.dataset.goalosReceiptScript = 'true';
  document.head.appendChild(script);
})();
