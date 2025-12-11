// Runtime configuration - loaded after build
// Update this with your actual backend URL from Render
window.APP_CONFIG = {
  API_URL: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:4000' 
    : 'https://secondbrain-backend.onrender.com' // ⚠️ UPDATE THIS with your actual backend URL
};

