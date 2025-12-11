import { useState, useEffect } from 'react';
import axios from 'axios';
import DeleteConfirmModal from './DeleteConfirmModal';
import { useToast } from '../contexts/ToastContext';

const API_URL = import.meta.env.VITE_API_URL || 
                (typeof window !== 'undefined' && window.APP_CONFIG?.API_URL) || 
                'http://localhost:4000';

export default function Trash() {
  const [trashItems, setTrashItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const { showSuccess, showError } = useToast();

  const fetchTrash = async () => {
    try {
      const response = await axios.get(`${API_URL}/trash`, {
        headers: { 'x-user-id': 'demo-user' }
      });
      setTrashItems(response.data);
    } catch (error) {
      console.error('Error fetching trash:', error);
      showError('Failed to load trash items');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrash();
  }, []);

  const handleRestore = async (itemId) => {
    setRestoring(itemId);
    try {
      await axios.post(`${API_URL}/trash/restore/${itemId}`, {}, {
        headers: { 'x-user-id': 'demo-user' }
      });
      showSuccess('Item restored successfully');
      await fetchTrash();
      // Refresh the page to show restored items in their respective views
      window.location.reload();
    } catch (error) {
      console.error('Error restoring item:', error);
      showError('Failed to restore item');
    } finally {
      setRestoring(null);
    }
  };

  const handlePermanentDelete = (itemId, itemName) => {
    setDeleteConfirm({
      itemId,
      itemName: itemName || itemId,
      permanent: true
    });
  };

  const confirmPermanentDelete = async () => {
    if (!deleteConfirm) return;

    setDeleting(deleteConfirm.itemId);
    try {
      await axios.delete(`${API_URL}/trash/${deleteConfirm.itemId}`, {
        headers: { 'x-user-id': 'demo-user' }
      });
      showSuccess('Item permanently deleted');
      await fetchTrash();
    } catch (error) {
      console.error('Error permanently deleting item:', error);
      showError('Failed to permanently delete item');
    } finally {
      setDeleting(null);
      setDeleteConfirm(null);
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return date.toLocaleDateString();
  };

  const getDaysUntilPermanentDelete = (deletedAt) => {
    const deleted = new Date(deletedAt);
    const thirtyDaysLater = new Date(deleted.getTime() + (30 * 24 * 60 * 60 * 1000));
    const now = new Date();
    const diffMs = thirtyDaysLater - now;
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700">
      <div className="p-6 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">🗑️ Trash</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Items are automatically deleted after 30 days
            </p>
          </div>
          <button
            onClick={fetchTrash}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      <div className="p-6">
        {trashItems.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">🗑️</div>
            <p className="text-gray-600 dark:text-gray-400 text-lg">Trash is empty</p>
            <p className="text-gray-500 dark:text-gray-500 text-sm mt-2">
              Deleted items will appear here and can be restored within 30 days
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {trashItems.map((item) => {
              const daysLeft = getDaysUntilPermanentDelete(item.deletedAt);
              const itemName = item.type === 'document' 
                ? (item.data.doc?.filename || item.data.doc?.title || item.data.doc?.originalUri || item.itemId)
                : (item.data.conversation?.title || item.itemId);
              
              return (
                <div
                  key={item.itemId}
                  className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase">
                          {item.type === 'document' ? '📄 Document' : '💬 Conversation'}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          Deleted {formatDate(item.deletedAt)}
                        </span>
                      </div>
                      <h3 className="font-medium text-gray-900 dark:text-white mb-1">
                        {itemName}
                      </h3>
                      {item.type === 'document' && item.data.doc?.sourceType && (
                        <span className="inline-block text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded mt-1">
                          {item.data.doc.sourceType}
                        </span>
                      )}
                      <div className="mt-2 flex items-center gap-4">
                        {daysLeft > 0 ? (
                          <span className="text-xs text-orange-600 dark:text-orange-400">
                            ⏰ {daysLeft} day{daysLeft !== 1 ? 's' : ''} until permanent deletion
                          </span>
                        ) : (
                          <span className="text-xs text-red-600 dark:text-red-400">
                            ⚠️ Will be permanently deleted soon
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <button
                        onClick={() => handleRestore(item.itemId)}
                        disabled={restoring === item.itemId}
                        className="px-3 py-2 text-sm font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Restore item"
                      >
                        {restoring === item.itemId ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-600"></div>
                        ) : (
                          '↩️ Restore'
                        )}
                      </button>
                      <button
                        onClick={() => handlePermanentDelete(item.itemId, itemName)}
                        disabled={deleting === item.itemId}
                        className="px-3 py-2 text-sm font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Permanently delete"
                      >
                        {deleting === item.itemId ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-600"></div>
                        ) : (
                          '🗑️ Delete Forever'
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {deleteConfirm && (
        <DeleteConfirmModal
          isOpen={true}
          onClose={() => setDeleteConfirm(null)}
          onConfirm={confirmPermanentDelete}
          title="Permanently Delete Item"
          message={`Are you sure you want to permanently delete "${deleteConfirm.itemName}"? This action cannot be undone.`}
          confirmText="Delete Forever"
          confirmClass="bg-red-600 hover:bg-red-700"
        />
      )}
    </div>
  );
}

