import { useState } from 'react';
import Chat from './components/Chat';
import Uploader from './components/Uploader';
import DocumentList from './components/DocumentList';
import ToastContainer from './components/ToastContainer';
import { ToastProvider, useToast } from './contexts/ToastContext';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';

function AppContent() {
  const [activeTab, setActiveTab] = useState('chat');
  const [refreshKey, setRefreshKey] = useState(0);
  const { toasts, removeToast } = useToast();
  const { isDark, toggleTheme } = useTheme();

  const handleUploadSuccess = () => {
    setRefreshKey(prev => prev + 1);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">SecondBrain</h1>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Your AI-powered knowledge companion</p>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={toggleTheme}
                className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {isDark ? (
                  <svg className="w-5 h-5 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                )}
              </button>
              <div className="hidden sm:flex items-center space-x-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
                <button
                onClick={() => setActiveTab('chat')}
                className={`px-4 py-2 rounded-md font-medium text-sm transition-all ${
                  activeTab === 'chat'
                    ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                💬 Chat
              </button>
              <button
                onClick={() => setActiveTab('upload')}
                className={`px-4 py-2 rounded-md font-medium text-sm transition-all ${
                  activeTab === 'upload'
                    ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                📤 Upload
              </button>
              <button
                onClick={() => setActiveTab('documents')}
                className={`px-4 py-2 rounded-md font-medium text-sm transition-all ${
                  activeTab === 'documents'
                    ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                📚 Documents
              </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className={`${activeTab === 'chat' ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
            {activeTab === 'chat' && (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg h-[700px] flex flex-col border border-gray-200 dark:border-gray-700">
                <div className="p-6 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-gray-700 dark:to-gray-600">
                  <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">Chat with your documents</h2>
                  <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">Ask questions about your uploaded content</p>
                </div>
                <div className="flex-1 overflow-hidden">
                  <Chat />
                </div>
              </div>
            )}

            {activeTab === 'upload' && (
              <Uploader onUploadSuccess={handleUploadSuccess} />
            )}

            {activeTab === 'documents' && (
              <DocumentList key={refreshKey} />
            )}
          </div>

          {activeTab === 'chat' && (
            <div className="space-y-6">
              <DocumentList key={refreshKey} />
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Quick Actions</h3>
                <button
                  onClick={() => setActiveTab('upload')}
                  className="w-full px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-500 dark:to-indigo-500 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 dark:hover:from-blue-600 dark:hover:to-indigo-600 transition-all shadow-md hover:shadow-lg font-medium"
                >
                  📤 Upload New Document
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </ThemeProvider>
  );
}

export default App;

