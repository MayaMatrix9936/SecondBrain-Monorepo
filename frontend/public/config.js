// Runtime configuration - loaded after build
(function() {
  const hostname = window.location.hostname;
  let backendUrl = 'http://localhost:4000'; // Default for local development
  
  if (hostname.includes('onrender.com')) {
    // Backend URL on Render
    backendUrl = 'https://secondbrain-backend-1ocr.onrender.com';
  }
  
  window.APP_CONFIG = {
    API_URL: backendUrl
  };
  
  console.log('Runtime config loaded:', window.APP_CONFIG);
})();

