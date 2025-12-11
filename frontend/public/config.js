// Runtime configuration - loaded after build
// Auto-detect backend URL based on frontend URL
(function() {
  const hostname = window.location.hostname;
  let backendUrl = 'http://localhost:4000'; // Default for local development
  
  if (hostname.includes('onrender.com')) {
    // If frontend is on Render, backend should be on Render too
    // Replace 'frontend' with 'backend' in the URL, or use your actual backend URL
    const frontendUrl = window.location.origin;
    // Try to construct backend URL (this is a guess - update with your actual backend URL)
    backendUrl = frontendUrl.replace('frontend', 'backend').replace('secondbrain-frontend', 'secondbrain-backend');
    // If that doesn't work, you'll need to manually set it below
  }
  
  window.APP_CONFIG = {
    API_URL: backendUrl
  };
  
  console.log('Runtime config loaded:', window.APP_CONFIG);
})();

