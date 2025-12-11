import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import DeleteConfirmModal from './DeleteConfirmModal';
import { useToast } from '../contexts/ToastContext';

const API_URL = import.meta.env.VITE_API_URL || 
                (typeof window !== 'undefined' && window.APP_CONFIG?.API_URL) || 
                'http://localhost:4000';

export default function Chat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const messagesEndRef = useRef(null);
  const abortControllerRef = useRef(null);
  const { showSuccess, showError } = useToast();

  const scrollToBottom = (force = false) => {
    if (force || messages.length > 0) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: force ? 'auto' : 'smooth' });
      }, 100);
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Auto-scroll during streaming
  useEffect(() => {
    const streamingMessage = messages.find(m => m.streaming);
    if (streamingMessage) {
      scrollToBottom(true);
    }
  }, [messages.map(m => m.content).join('')]);

  useEffect(() => {
    loadConversations();
    // Create a new conversation on mount
    const newId = uuidv4();
    setConversationId(newId);
  }, []);

  const loadConversations = async () => {
    try {
      const response = await axios.get(`${API_URL}/conversations`, {
        headers: { 'x-user-id': 'demo-user' }
      });
      setConversations(response.data);
    } catch (error) {
      console.error('Error loading conversations:', error);
    } finally {
      setLoadingConversations(false);
    }
  };

  const saveConversation = async (msgs) => {
    if (!conversationId || msgs.length === 0) return;
    
    try {
      const firstUserMessage = msgs.find(m => m.role === 'user');
      const title = firstUserMessage ? firstUserMessage.content.substring(0, 50) : 'New Conversation';
      
      await axios.post(`${API_URL}/conversations`, {
        conversationId,
        title,
        messages: msgs
      }, {
        headers: { 'x-user-id': 'demo-user' }
      });
      
      // Refresh conversation list
      await loadConversations();
    } catch (error) {
      console.error('Error saving conversation:', error);
    }
  };

  const loadConversation = async (convId) => {
    try {
      const response = await axios.get(`${API_URL}/conversations/${convId}`, {
        headers: { 'x-user-id': 'demo-user' }
      });
      setMessages(response.data.messages || []);
      setConversationId(convId);
      setShowHistory(false);
    } catch (error) {
      console.error('Error loading conversation:', error);
    }
  };

  const startNewConversation = () => {
    const newId = uuidv4();
    setConversationId(newId);
    setMessages([]);
    setShowHistory(false);
  };

  const deleteConversation = async (convId, e) => {
    e.stopPropagation();
    const conv = conversations.find(c => c.conversationId === convId);
    setDeleteConfirm({
      conversationId: convId,
      title: conv?.title || 'this conversation'
    });
  };

  const confirmDeleteConversation = async () => {
    if (!deleteConfirm) return;
    
    try {
      await axios.delete(`${API_URL}/conversations/${deleteConfirm.conversationId}`, {
        headers: { 'x-user-id': 'demo-user' }
      });
      await loadConversations();
      if (conversationId === deleteConfirm.conversationId) {
        startNewConversation();
      }
      setDeleteConfirm(null);
      showSuccess('Conversation deleted successfully');
    } catch (error) {
      console.error('Error deleting conversation:', error);
      showError('Failed to delete conversation');
      setDeleteConfirm(null);
    }
  };

  const copyMessage = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      showSuccess('Message copied to clipboard');
    } catch (error) {
      showError('Failed to copy message');
    }
  };

  const filteredConversations = conversations.filter(conv =>
    conv.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const stopStreaming = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
    setMessages(prev => {
      const updated = [...prev];
      const lastMsg = updated[updated.length - 1];
      if (lastMsg && lastMsg.streaming) {
        lastMsg.streaming = false;
      }
      return updated;
    });
  };

  const regenerateResponse = async () => {
    if (messages.length < 2) return;
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUserMessage) return;
    
    // Remove last assistant message
    const messagesWithoutLast = messages.slice(0, -1);
    setMessages(messagesWithoutLast);
    setInput(lastUserMessage.content);
    
    // Trigger new response
    setTimeout(() => {
      const fakeEvent = { preventDefault: () => {} };
      handleSend(fakeEvent, lastUserMessage.content);
    }, 100);
  };

  const handleSend = async (e, queryOverride = null) => {
    e?.preventDefault();
    const queryText = queryOverride || input.trim();
    if (!queryText || loading) return;

    const userMessage = { 
      role: 'user', 
      content: queryText,
      timestamp: new Date().toISOString()
    };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    if (!queryOverride) setInput('');
    setLoading(true);

    // Create placeholder for streaming response
    const assistantMessage = {
      role: 'assistant',
      content: '',
      sources: [],
      streaming: true,
      timestamp: new Date().toISOString()
    };
    const messagesWithPlaceholder = [...newMessages, assistantMessage];
    setMessages(messagesWithPlaceholder);

    // Create abort controller for cancellation
    abortControllerRef.current = new AbortController();

    try {
      // Use streaming by default
      const response = await fetch(`${API_URL}/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': 'demo-user'
        },
        body: JSON.stringify({
          userId: 'demo-user',
          query: queryText,
          k: 6,
          stream: true
        }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error('Streaming request failed');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sources = [];
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === 'sources') {
                sources = data.data || [];
              } else if (data.type === 'chunk') {
                fullContent += data.data;
                // Update message with streaming content
                setMessages(prev => {
                  const updated = [...prev];
                  const lastMsg = updated[updated.length - 1];
                  if (lastMsg && lastMsg.role === 'assistant') {
                    lastMsg.content = fullContent;
                    lastMsg.sources = sources;
                  }
                  return updated;
                });
              } else if (data.type === 'done') {
                fullContent = data.data || fullContent;
                // Final update
                setMessages(prev => {
                  const updated = [...prev];
                  const lastMsg = updated[updated.length - 1];
                  if (lastMsg && lastMsg.role === 'assistant') {
                    lastMsg.content = fullContent;
                    lastMsg.sources = sources;
                    lastMsg.streaming = false;
                  }
                  return updated;
                });
              } else if (data.type === 'error') {
                throw new Error(data.data || 'Streaming error');
              }
            } catch (parseError) {
              console.error('Error parsing SSE data:', parseError);
            }
          }
        }
      }

      // Final message state
      const finalMessages = [...newMessages, {
        role: 'assistant',
        content: fullContent,
        sources: sources,
        timestamp: new Date().toISOString()
      }];
      setMessages(finalMessages);
      
      // Save conversation after each exchange
      await saveConversation(finalMessages);
      abortControllerRef.current = null;
    } catch (error) {
      if (error.name === 'AbortError') {
        // User cancelled, update message to show it was stopped
        setMessages(prev => {
          const updated = [...prev];
          const lastMsg = updated[updated.length - 1];
          if (lastMsg && lastMsg.streaming) {
            lastMsg.streaming = false;
            lastMsg.content = lastMsg.content || '(Response stopped)';
            lastMsg.timestamp = new Date().toISOString();
          }
          return updated;
        });
      } else {
        console.error('Query error:', error);
        showError('Failed to get response. Please try again.');
        const errorMessage = {
          role: 'assistant',
          content: 'Sorry, I encountered an error. Please try again.',
          error: true,
          timestamp: new Date().toISOString()
        };
        const updatedMessages = [...newMessages, errorMessage];
        setMessages(updatedMessages);
        await saveConversation(updatedMessages);
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  // Simple markdown renderer for code blocks and formatting
  const renderMarkdown = (text) => {
    if (!text) return '';
    
    // Escape HTML first
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    // Code blocks
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
      return `<pre class="bg-gray-100 dark:bg-gray-800 p-3 rounded-lg overflow-x-auto my-2"><code class="text-sm">${code.trim()}</code></pre>`;
    });
    
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code class="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-sm font-mono">$1</code>');
    
    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    
    // Italic
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    
    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 hover:underline">$1</a>');
    
    // Line breaks
    html = html.replace(/\n/g, '<br />');
    
    return html;
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key === 'Escape' && deleteConfirm) {
        setDeleteConfirm(null);
      }
    };
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [deleteConfirm]);

  return (
    <div className="flex h-full relative">
      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={confirmDeleteConversation}
        title="Delete Conversation"
        itemName={deleteConfirm?.title || 'this conversation'}
        type="conversation"
      />
      {/* Conversation History Sidebar */}
      <div className={`${showHistory ? 'w-64' : 'w-0'} transition-all duration-300 overflow-hidden border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col`}>
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 dark:text-white">Chat History</h3>
            <button
              onClick={startNewConversation}
              className="px-3 py-1.5 text-sm bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors"
              title="New Conversation"
            >
              ➕ New
            </button>
          </div>
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        
        <div className="flex-1 overflow-y-auto">
          {loadingConversations ? (
            <div className="p-4 text-center text-gray-500 dark:text-gray-400">Loading...</div>
          ) : filteredConversations.length === 0 ? (
            <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
              {searchQuery ? 'No conversations found' : 'No conversations yet'}
            </div>
          ) : (
            <div className="p-2">
              {filteredConversations.map((conv) => (
                <div
                  key={conv.conversationId}
                  className={`group p-3 mb-2 rounded-lg cursor-pointer transition-colors ${
                    conversationId === conv.conversationId
                      ? 'bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700 border border-transparent'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div 
                      className="flex-1 min-w-0"
                      onClick={() => loadConversation(conv.conversationId)}
                    >
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {conv.title}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {new Date(conv.updatedAt || conv.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={(e) => deleteConversation(conv.conversationId, e)}
                      className="ml-2 p-1.5 text-red-600 hover:bg-red-50 rounded transition-all opacity-70 hover:opacity-100"
                      title="Delete conversation"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              title="Toggle History"
            >
              <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </button>
            <h3 className="font-semibold text-gray-900 dark:text-white">
              {conversations.find(c => c.conversationId === conversationId)?.title || 'New Conversation'}
            </h3>
          </div>
          <button
            onClick={startNewConversation}
            className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            New Chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-50 dark:bg-gray-900">
          {messages.length === 0 && (
            <div className="text-center text-gray-500 dark:text-gray-400 mt-12">
              <div className="text-6xl mb-4">🧠</div>
              <p className="text-xl font-semibold mb-2 text-gray-700 dark:text-gray-300">Welcome to SecondBrain</p>
              <p className="text-gray-500 dark:text-gray-400">Ask me anything about your uploaded documents!</p>
            </div>
          )}
          
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
              className={`max-w-3xl rounded-2xl px-5 py-3 shadow-sm group relative ${
                msg.role === 'user'
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-500 dark:to-indigo-500 text-white'
                  : msg.error
                  ? 'bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800'
                  : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700'
              }`}
              >
                <div className="flex items-start justify-between gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    {msg.role === 'assistant' ? (
                      <div 
                        className="whitespace-pre-wrap leading-relaxed prose prose-sm dark:prose-invert max-w-none"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                      />
                    ) : (
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    )}
                    {msg.timestamp && (
                      <p className="text-xs opacity-60 mt-2">{formatTimestamp(msg.timestamp)}</p>
                    )}
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => copyMessage(msg.content)}
                      className={`p-1.5 rounded hover:bg-opacity-20 ${
                        msg.role === 'user' ? 'hover:bg-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                      title="Copy message"
                    >
                      <svg className={`w-4 h-4 ${msg.role === 'user' ? 'text-white' : 'text-gray-600 dark:text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                    {msg.role === 'assistant' && idx === messages.length - 1 && !msg.streaming && (
                      <button
                        onClick={regenerateResponse}
                        className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                        title="Regenerate response"
                      >
                        <svg className="w-4 h-4 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-300 dark:border-gray-600 border-opacity-30">
                    <p className="text-xs opacity-75 font-medium mb-2">
                      📎 {msg.sources.length} source{msg.sources.length > 1 ? 's' : ''} referenced
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {msg.sources.map((source, idx) => {
                        const displayName = source.filename || 
                                           (source.originalUri && source.originalUri !== 'inline' 
                                             ? (source.originalUri.startsWith('http') 
                                                ? new URL(source.originalUri).hostname 
                                                : source.originalUri.split('/').pop())
                                             : `Document ${idx + 1}`);
                        const isUrl = source.originalUri && source.originalUri.startsWith('http');
                        
                        return (
                          <div
                            key={source.chunkId || idx}
                            className="text-xs px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                          >
                            {isUrl ? (
                              <a
                                href={source.originalUri}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 dark:text-blue-400 hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {displayName}
                              </a>
                            ) : (
                              <span className="cursor-default" title={`Source ${idx + 1} (Score: ${source.score?.toFixed(3) || 'N/A'})`}>
                                {displayName}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
          
          {loading && (
            <div className="flex justify-start">
              <div className="bg-white dark:bg-gray-800 rounded-2xl px-5 py-3 border border-gray-200 dark:border-gray-700 shadow-sm flex items-center gap-3">
                <div className="flex space-x-2">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                </div>
                <button
                  onClick={stopStreaming}
                  className="text-xs px-3 py-1 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                  title="Stop generating"
                >
                  Stop
                </button>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSend} className="border-t border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
          <div className="flex space-x-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question about your documents... (Press Enter to send)"
            className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !loading && input.trim()) {
                e.preventDefault();
                handleSend(e);
              }
            }}
          />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg font-medium"
            >
              Send
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
