import { useState, useEffect } from 'react';
import axios from 'axios';
import DeleteConfirmModal from './DeleteConfirmModal';
import { useToast } from '../contexts/ToastContext';

const API_URL = import.meta.env.VITE_API_URL || 
                (typeof window !== 'undefined' && window.APP_CONFIG?.API_URL) || 
                'http://localhost:4000';

export default function DocumentList() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const { showSuccess, showError } = useToast();

  const fetchDocs = async () => {
    try {
      const response = await axios.get(`${API_URL}/docs`);
      setDocs(response.data);
    } catch (error) {
      console.error('Error fetching docs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (docId, docName) => {
    setDeleteConfirm({
      docId,
      docName: docName || docId
    });
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;

    setDeleting(deleteConfirm.docId);
    try {
      const response = await axios.delete(`${API_URL}/docs/${deleteConfirm.docId}`, {
        headers: { 'x-user-id': 'demo-user' }
      });
      
      if (response.data.ok) {
        // Remove from local state immediately
        setDocs(prev => prev.filter(d => d.docId !== deleteConfirm.docId));
        // Refresh to ensure consistency
        await fetchDocs();
        showSuccess('Document deleted successfully');
      } else {
        showError('Failed to delete document. Please try again.');
      }
    } catch (error) {
      console.error('Error deleting doc:', error);
      showError('Failed to delete document. Please try again.');
    } finally {
      setDeleting(null);
      setDeleteConfirm(null);
    }
  };

  const filteredDocs = docs.filter(doc => {
    const searchLower = searchQuery.toLowerCase();
    const filename = (doc.filename || doc.title || doc.originalUri || doc.docId).toLowerCase();
    const sourceType = (doc.sourceType || '').toLowerCase();
    return filename.includes(searchLower) || sourceType.includes(searchLower);
  });

  useEffect(() => {
    fetchDocs();
    const interval = setInterval(fetchDocs, 5000);
    return () => clearInterval(interval);
  }, []);

  const getTypeIcon = (type) => {
    const icons = {
      pdf: '📄',
      audio: '🎵',
      image: '🖼️',
      text: '📝',
      url: '🔗',
    };
    return icons[type] || '📄';
  };

  const getTypeColor = (type) => {
    const colors = {
      pdf: 'bg-red-100 text-red-800',
      audio: 'bg-purple-100 text-purple-800',
      image: 'bg-green-100 text-green-800',
      text: 'bg-blue-100 text-blue-800',
      url: 'bg-yellow-100 text-yellow-800',
    };
    return colors[type] || 'bg-gray-100 text-gray-800';
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
        <div className="text-center py-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400 mx-auto"></div>
          <p className="text-gray-500 dark:text-gray-400 mt-2">Loading documents...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700 relative">
      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={confirmDelete}
        title="Delete Document"
        itemName={deleteConfirm?.docName || 'this document'}
        type="document"
      />
      <div className="mb-4">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Documents</h2>
          <button
            onClick={fetchDocs}
            className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors font-medium"
          >
            🔄 Refresh
          </button>
        </div>
        <input
          type="text"
          placeholder="Search documents..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      
      {filteredDocs.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-4xl mb-2">📭</div>
          <p className="text-gray-500 dark:text-gray-400">
            {searchQuery ? 'No documents found matching your search' : 'No documents uploaded yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {filteredDocs.map((doc) => (
            <div
              key={doc.docId}
              className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-all"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2 mb-2">
                    {doc.sourceType && (
                      <span className={`px-2 py-1 text-xs rounded-md font-medium ${getTypeColor(doc.sourceType)}`}>
                        {getTypeIcon(doc.sourceType)} {doc.sourceType}
                      </span>
                    )}
                    {doc.processedAt ? (
                      <span className="text-xs text-green-600 dark:text-green-400 font-medium">✓ Processed</span>
                    ) : (
                      <span className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">⏳ Processing...</span>
                    )}
                  </div>
                  <p className="font-medium text-sm text-gray-900 dark:text-white truncate" title={doc.filename || doc.title || doc.originalUri || doc.docId}>
                    {doc.filename || doc.title || (doc.originalUri && doc.originalUri !== 'inline' ? new URL(doc.originalUri).pathname.split('/').pop() : 'Text Document') || doc.docId}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {new Date(doc.uploadedAt).toLocaleString()}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(doc.docId, doc.filename || doc.title || doc.originalUri || doc.docId)}
                  disabled={deleting === doc.docId}
                  className="ml-2 p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Delete document"
                >
                  {deleting === doc.docId ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-600"></div>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

