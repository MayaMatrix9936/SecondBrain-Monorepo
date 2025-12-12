import { useState } from 'react';
import axios from 'axios';
import { useToast } from '../contexts/ToastContext';

// Get API URL from env var (build time) or runtime config (fallback)
const API_URL = import.meta.env.VITE_API_URL || 
                (typeof window !== 'undefined' && window.APP_CONFIG?.API_URL) || 
                'http://localhost:4000';
console.log('API_URL:', API_URL); // Debug: Check what URL is being used
console.log('VITE_API_URL env:', import.meta.env.VITE_API_URL); // Debug: Check if env var exists
console.log('APP_CONFIG:', typeof window !== 'undefined' ? window.APP_CONFIG : 'N/A');

export default function Uploader({ onUploadSuccess }) {
  const [uploadType, setUploadType] = useState('file');
  const [files, setFiles] = useState([]);
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const { showSuccess, showError } = useToast();

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setFiles(Array.from(e.target.files));
      setMessage('');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setUploading(true);
    setMessage('');

    try {
      const formData = new FormData();
      const headers = {
        'x-user-id': 'demo-user'
      };

      if (uploadType === 'file' && files.length > 0) {
        // Append all files to formData
        files.forEach(file => {
          formData.append('files', file);
        });
        console.log('Uploading to:', `${API_URL}/upload`, `Files: ${files.length}`); // Debug
        const response = await axios.post(`${API_URL}/upload`, formData, { headers });
        showSuccess(`${files.length} file(s) uploaded successfully! Processing...`);
        setFiles([]);
        setMessage('');
        if (onUploadSuccess) onUploadSuccess();
      } else if (uploadType === 'text' && text.trim()) {
        const response = await axios.post(
          `${API_URL}/upload`,
          { text: text },
          { headers }
        );
        showSuccess(`Text uploaded successfully! Processing...`);
        setText('');
        setMessage('');
        if (onUploadSuccess) onUploadSuccess();
      } else if (uploadType === 'url' && url.trim()) {
        const response = await axios.post(
          `${API_URL}/upload`,
          { url: url },
          { headers }
        );
        showSuccess(`URL uploaded successfully! Processing...`);
        setUrl('');
        setMessage('');
        if (onUploadSuccess) onUploadSuccess();
      } else {
        showError('Please provide a file, text, or URL');
      }
    } catch (error) {
      console.error('Upload error:', error);
      const errorMessage = error.response?.data?.error || error.response?.data?.details || error.message || 'Upload failed. Please try again.';
      console.error('Error details:', error.response?.data);
      showError(`Upload failed: ${errorMessage}`);
      setMessage(`Error: ${errorMessage}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (uploadType === 'file' && e.dataTransfer.files.length > 0) {
      setFiles(Array.from(e.dataTransfer.files));
      setMessage('');
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 border border-gray-200 dark:border-gray-700">
      <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-6">Upload Content</h2>
      
      <div className="flex space-x-2 mb-6 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
        <button
          onClick={() => setUploadType('file')}
          className={`flex-1 px-4 py-2 rounded-md transition-all font-medium ${
            uploadType === 'file'
              ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm'
              : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
          }`}
        >
          📄 File
        </button>
        <button
          onClick={() => setUploadType('text')}
          className={`flex-1 px-4 py-2 rounded-md transition-all font-medium ${
            uploadType === 'text'
              ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm'
              : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
          }`}
        >
          📝 Text
        </button>
        <button
          onClick={() => setUploadType('url')}
          className={`flex-1 px-4 py-2 rounded-md transition-all font-medium ${
            uploadType === 'url'
              ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm'
              : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
          }`}
        >
          🔗 URL
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {uploadType === 'file' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Select Files (PDF, Audio, Image, or Text) - Multiple files supported
            </label>
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-dashed rounded-lg transition-colors ${
                isDragging
                  ? 'border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/30'
                  : 'border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500'
              }`}
            >
              <div className="space-y-1 text-center">
                <svg className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                  <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div className="flex text-sm text-gray-600 dark:text-gray-400">
                  <label className="relative cursor-pointer rounded-md font-medium text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300">
                    <span>Upload file(s)</span>
                    <input type="file" className="sr-only" onChange={handleFileChange} multiple />
                  </label>
                  <p className="pl-1">or drag and drop</p>
                </div>
                {files.length > 0 && (
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    {files.length} file(s) selected:
                    <ul className="list-disc list-inside mt-1">
                      {files.map((file, idx) => (
                        <li key={idx}>{file.name}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {uploadType === 'text' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Enter Text
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              placeholder="Paste or type your text here..."
            />
          </div>
        )}

        {uploadType === 'url' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Enter URL
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="https://example.com/article"
            />
          </div>
        )}

        <button
          type="submit"
          disabled={uploading}
          className="w-full px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-500 dark:to-indigo-500 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 dark:hover:from-blue-600 dark:hover:to-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg font-medium"
        >
          {uploading ? '⏳ Uploading...' : '📤 Upload'}
        </button>

        {message && (
          <div
            className={`p-4 rounded-lg ${
              message.includes('✅')
                ? 'bg-green-50 text-green-800 border border-green-200'
                : message.includes('⚠️')
                ? 'bg-yellow-50 text-yellow-800 border border-yellow-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            {message}
          </div>
        )}
      </form>
    </div>
  );
}

