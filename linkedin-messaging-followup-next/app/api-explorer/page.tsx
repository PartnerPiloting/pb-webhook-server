'use client';

import React, { useState, useEffect } from 'react';
import { Star, Search, ArrowLeft, Copy, ExternalLink, Play, Check, ChevronDown, ChevronRight, Zap, Database, Users, Settings, AlertCircle, Calendar, FileText, Activity, RefreshCw } from 'lucide-react';
import Link from 'next/link';

// Detect backend URL from current hostname
function getBackendUrl(): string {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname || '';
    if (/^(localhost|127\.0\.0\.1)$/i.test(host)) {
      return 'http://localhost:3001';
    }
    if (/staging/i.test(host)) {
      return 'https://pb-webhook-server-staging.onrender.com';
    }
  }
  return 'https://pb-webhook-server.onrender.com';
}

interface Endpoint {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  description: string;
  category: string;
  params?: string;
  body?: string;
  requiresClientId?: boolean;
  dangerous?: boolean;
}

// All endpoints organized by category
const ENDPOINTS: Endpoint[] = [
  // === HEALTH & DEBUG ===
  { id: 'health', method: 'GET', path: '/health', description: 'Basic server health check', category: 'Health & Debug' },
  { id: 'debug-gemini', method: 'GET', path: '/debug-gemini-info', description: 'Check Gemini AI model status', category: 'Health & Debug' },
  { id: 'debug-clients', method: 'GET', path: '/debug-clients', description: 'List all clients with status', category: 'Health & Debug', params: '?limit=10' },
  { id: 'debug-render-api', method: 'GET', path: '/debug-render-api', description: 'Check Render API connection', category: 'Health & Debug' },
  { id: 'debug-job-status', method: 'GET', path: '/debug-job-status', description: 'Check job status across clients', category: 'Health & Debug' },
  { id: 'debug-job-status-client', method: 'GET', path: '/debug-job-status/:clientId/:operation', description: 'Check specific client job status', category: 'Health & Debug', params: 'clientId=Guy-Wilson, operation=batchScore' },
  { id: 'debug-pmpro', method: 'GET', path: '/debug/valid-pmpro-levels', description: 'List valid PMPro membership levels', category: 'Health & Debug' },
  
  // === CLIENT MANAGEMENT ===
  { id: 'get-client', method: 'GET', path: '/api/client/:clientId', description: 'Get client details for editing', category: 'Client Management', params: 'clientId=Keith-Sinclair' },
  { id: 'onboard-client', method: 'POST', path: '/api/onboard-client', description: 'Create new client with defaults', category: 'Client Management', body: '{ clientName, email, wordpressUserId, airtableBaseId, serviceLevel }' },
  { id: 'update-client', method: 'PUT', path: '/api/update-client/:clientId', description: 'Update existing client', category: 'Client Management', params: 'clientId=Keith-Sinclair' },
  { id: 'validate-base', method: 'POST', path: '/api/validate-client-base', description: 'Validate Airtable base has required tables', category: 'Client Management', body: '{ airtableBaseId: "appXXX" }' },
  { id: 'sync-statuses', method: 'POST', path: '/api/sync-client-statuses', description: 'Sync client statuses from WordPress', category: 'Client Management' },
  { id: 'verify-access', method: 'GET', path: '/api/verify-client-access/:clientId', description: 'Verify client has valid membership', category: 'Client Management' },
  { id: 'check-membership', method: 'POST', path: '/api/check-client-membership/:clientId', description: 'Check client membership status', category: 'Client Management' },
  
  // === LEAD SCORING ===
  { id: 'batch-score', method: 'GET', path: '/run-batch-score', description: 'Run batch lead scoring (v1 - deprecated)', category: 'Lead Scoring', params: '?limit=5', requiresClientId: true },
  { id: 'batch-score-v2', method: 'GET', path: '/run-batch-score-v2', description: 'Run batch lead scoring (v2 - production)', category: 'Lead Scoring', params: '?limit=5', requiresClientId: true },
  { id: 'score-lead', method: 'GET', path: '/score-lead', description: 'Score a single lead', category: 'Lead Scoring', params: '?recordId=recXXX', requiresClientId: true },
  { id: 'smart-resume', method: 'GET', path: '/smart-resume-client-by-client', description: 'Smart resume batch scoring', category: 'Lead Scoring', params: '?limit=5' },
  { id: 'smart-resume-post', method: 'POST', path: '/smart-resume-client-by-client', description: 'Smart resume with options', category: 'Lead Scoring', body: '{ limit: 5 }' },
  { id: 'smart-resume-status', method: 'GET', path: '/smart-resume-status', description: 'Check smart resume lock status', category: 'Lead Scoring' },
  { id: 'reset-smart-resume', method: 'POST', path: '/reset-smart-resume-lock', description: 'Reset stuck smart resume lock', category: 'Lead Scoring', dangerous: true },
  
  // === POST SCORING ===
  { id: 'post-batch-score', method: 'POST', path: '/run-post-batch-score', description: 'Run post scoring batch (v1)', category: 'Post Scoring', body: '{ clientId, limit: 5 }' },
  { id: 'post-batch-v2', method: 'POST', path: '/run-post-batch-score-v2', description: 'Run post scoring batch (v2 - production)', category: 'Post Scoring', body: '{ clientId, limit: 5 }' },
  { id: 'post-batch-simple', method: 'POST', path: '/run-post-batch-score-simple', description: 'Simple post scoring (no harvesting)', category: 'Post Scoring', body: '{ clientId, limit: 5 }' },
  { id: 'post-batch-level2', method: 'POST', path: '/run-post-batch-score-level2', description: 'Level 2 post scoring only', category: 'Post Scoring', body: '{ clientId, limit: 5 }' },
  { id: 'harvest-guy', method: 'GET', path: '/harvest-guy-wilson', description: 'Test harvest for Guy Wilson', category: 'Post Scoring' },
  
  // === ATTRIBUTES ===
  { id: 'get-attributes', method: 'GET', path: '/api/attributes', description: 'Get all lead scoring attributes', category: 'Attributes', requiresClientId: true },
  { id: 'get-attribute', method: 'GET', path: '/api/attributes/:id/edit', description: 'Get single attribute for editing', category: 'Attributes', requiresClientId: true },
  { id: 'save-attribute', method: 'POST', path: '/api/attributes/:id/save', description: 'Save attribute changes', category: 'Attributes', requiresClientId: true },
  { id: 'ai-edit-attribute', method: 'POST', path: '/api/attributes/:id/ai-edit', description: 'AI-assisted attribute editing', category: 'Attributes', requiresClientId: true },
  { id: 'ai-field-help', method: 'POST', path: '/api/attributes/:id/ai-field-help', description: 'Get AI help for attribute field', category: 'Attributes', requiresClientId: true },
  { id: 'validate-budget', method: 'POST', path: '/api/attributes/:id/validate-budget', description: 'Validate token budget for attribute', category: 'Attributes', requiresClientId: true },
  { id: 'verify-filtering', method: 'GET', path: '/api/attributes/verify-active-filtering', description: 'Verify attribute active filtering works', category: 'Attributes', requiresClientId: true },
  { id: 'get-post-attributes', method: 'GET', path: '/api/post-attributes', description: 'Get all post scoring attributes', category: 'Attributes', requiresClientId: true },
  { id: 'get-post-attribute', method: 'GET', path: '/api/post-attributes/:id/edit', description: 'Get single post attribute', category: 'Attributes', requiresClientId: true },
  { id: 'save-post-attribute', method: 'POST', path: '/api/post-attributes/:id/save', description: 'Save post attribute changes', category: 'Attributes', requiresClientId: true },
  { id: 'ai-edit-post-attr', method: 'POST', path: '/api/post-attributes/:id/ai-edit', description: 'AI-assisted post attribute editing', category: 'Attributes', requiresClientId: true },
  
  // === TOKEN USAGE ===
  { id: 'token-usage', method: 'GET', path: '/api/token-usage', description: 'Get lead scoring token usage', category: 'Token Usage', requiresClientId: true },
  { id: 'post-token-usage', method: 'GET', path: '/api/post-token-usage', description: 'Get post scoring token usage', category: 'Token Usage', requiresClientId: true },
  
  // === AUDITING ===
  { id: 'audit-comprehensive', method: 'GET', path: '/api/audit/comprehensive', description: 'Run comprehensive system audit', category: 'Auditing', requiresClientId: true },
  { id: 'audit-quick', method: 'GET', path: '/api/audit/quick', description: 'Run quick system audit', category: 'Auditing', requiresClientId: true },
  { id: 'audit-autofix', method: 'POST', path: '/api/audit/auto-fix', description: 'Auto-fix audit issues', category: 'Auditing', requiresClientId: true, dangerous: true },
  
  // === PRODUCTION ISSUES ===
  { id: 'analyze-issues', method: 'GET', path: '/api/analyze-issues', description: 'Analyze production issues by severity', category: 'Production Issues', params: '?status=unfixed&days=7' },
  { id: 'mark-fixed', method: 'POST', path: '/api/mark-issue-fixed', description: 'Mark issue as fixed', category: 'Production Issues', body: '{ pattern: "error text", commitHash: "abc123", fixNotes: "description" }' },
  { id: 'analyze-logs', method: 'POST', path: '/api/analyze-logs/recent', description: 'Analyze recent Render logs', category: 'Production Issues', body: '{ minutes: 30 }' },
  { id: 'debug-prod-issues', method: 'GET', path: '/debug-production-issues', description: 'Debug production issues table', category: 'Production Issues' },
  
  // === CALENDAR ===
  { id: 'calendar-setup', method: 'GET', path: '/api/calendar/setup-info', description: 'Get calendar setup info', category: 'Calendar', requiresClientId: true },
  { id: 'calendar-chat', method: 'POST', path: '/api/calendar/chat', description: 'Chat with calendar AI', category: 'Calendar', requiresClientId: true },
  { id: 'calendar-extract', method: 'POST', path: '/api/calendar/extract-profile', description: 'Extract profile from calendar text', category: 'Calendar', requiresClientId: true },
  { id: 'calendar-lookup', method: 'GET', path: '/api/calendar/lookup-lead', description: 'Lookup lead for calendar', category: 'Calendar', requiresClientId: true },
  { id: 'calendar-update', method: 'PATCH', path: '/api/calendar/update-lead', description: 'Update lead from calendar', category: 'Calendar', requiresClientId: true },
  
  // === WEBHOOKS ===
  { id: 'pb-webhook', method: 'POST', path: '/api/pb-webhook', description: 'LinkedHelper webhook receiver', category: 'Webhooks', body: '(LinkedHelper format)' },
  { id: 'initiate-pb', method: 'GET', path: '/api/initiate-pb-message', description: 'Initiate PB message', category: 'Webhooks' },
  
  // === TESTING ===
  { id: 'test-wp', method: 'GET', path: '/api/test-wordpress-connection', description: 'Test WordPress API connection', category: 'Testing' },
  { id: 'test-alerts', method: 'GET', path: '/api/test-daily-alerts', description: 'Test daily alert emails', category: 'Testing' },
  { id: 'test-airtable', method: 'GET', path: '/api/test-airtable-warm', description: 'Test Airtable connection warmup', category: 'Testing' },
  { id: 'test-membership', method: 'GET', path: '/api/test-membership-sync', description: 'Test membership sync', category: 'Testing' },
  
  // === ENV & CONFIG ===
  { id: 'scan-env', method: 'POST', path: '/api/scan-env-vars', description: 'Scan environment variables', category: 'Config' },
  { id: 'enhance-env', method: 'POST', path: '/api/enhance-env-descriptions', description: 'Enhance env var descriptions with AI', category: 'Config' },
  { id: 'json-quality', method: 'GET', path: '/api/json-quality-analysis', description: 'Analyze JSON quality issues', category: 'Config', requiresClientId: true },
];

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  'Health & Debug': <Activity className="w-4 h-4" />,
  'Client Management': <Users className="w-4 h-4" />,
  'Lead Scoring': <Zap className="w-4 h-4" />,
  'Post Scoring': <FileText className="w-4 h-4" />,
  'Attributes': <Settings className="w-4 h-4" />,
  'Token Usage': <Database className="w-4 h-4" />,
  'Auditing': <AlertCircle className="w-4 h-4" />,
  'Production Issues': <AlertCircle className="w-4 h-4" />,
  'Calendar': <Calendar className="w-4 h-4" />,
  'Webhooks': <RefreshCw className="w-4 h-4" />,
  'Testing': <Play className="w-4 h-4" />,
  'Config': <Settings className="w-4 h-4" />,
};

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-green-100 text-green-800',
  POST: 'bg-blue-100 text-blue-800',
  PUT: 'bg-yellow-100 text-yellow-800',
  PATCH: 'bg-orange-100 text-orange-800',
  DELETE: 'bg-red-100 text-red-800',
};

export default function ApiExplorerPage() {
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['Health & Debug']));
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; status: 'loading' | 'success' | 'error'; data?: unknown } | null>(null);

  // Load favorites from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('api-explorer-favorites');
    if (saved) {
      setFavorites(new Set(JSON.parse(saved)));
    }
  }, []);

  const toggleFavorite = (id: string) => {
    const newFavorites = new Set(favorites);
    if (newFavorites.has(id)) {
      newFavorites.delete(id);
    } else {
      newFavorites.add(id);
    }
    setFavorites(newFavorites);
    localStorage.setItem('api-explorer-favorites', JSON.stringify([...newFavorites]));
  };

  const toggleCategory = (category: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  const copyToClipboard = (endpoint: Endpoint) => {
    const url = `${getBackendUrl()}${endpoint.path}${endpoint.params ? `?${endpoint.params.replace(/\?/, '')}` : ''}`;
    navigator.clipboard.writeText(url);
    setCopiedId(endpoint.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const testEndpoint = async (endpoint: Endpoint) => {
    if (endpoint.method !== 'GET') return;
    
    setTestResult({ id: endpoint.id, status: 'loading' });
    
    try {
      const url = `${getBackendUrl()}${endpoint.path.replace(':clientId', 'Guy-Wilson').replace(':id', 'rec123')}`;
      const response = await fetch(url, {
        headers: endpoint.requiresClientId ? { 'x-client-id': 'Guy-Wilson' } : {}
      });
      const data = await response.json();
      setTestResult({ id: endpoint.id, status: 'success', data });
    } catch {
      setTestResult({ id: endpoint.id, status: 'error' });
    }
  };

  // Filter endpoints
  const filteredEndpoints = ENDPOINTS.filter(ep => 
    ep.path.toLowerCase().includes(search.toLowerCase()) ||
    ep.description.toLowerCase().includes(search.toLowerCase()) ||
    ep.category.toLowerCase().includes(search.toLowerCase())
  );

  // Group by category
  const categories = [...new Set(ENDPOINTS.map(ep => ep.category))];
  
  // Separate favorites
  const favoriteEndpoints = filteredEndpoints.filter(ep => favorites.has(ep.id));
  const categorizedEndpoints = categories.reduce((acc, cat) => {
    acc[cat] = filteredEndpoints.filter(ep => ep.category === cat && !favorites.has(ep.id));
    return acc;
  }, {} as Record<string, Endpoint[]>);

  const renderEndpoint = (endpoint: Endpoint) => (
    <div
      key={endpoint.id}
      className={`p-3 border rounded-lg ${endpoint.dangerous ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'} hover:shadow-sm transition-shadow`}
    >
      <div className="flex items-start gap-3">
        <button
          onClick={() => toggleFavorite(endpoint.id)}
          className="mt-0.5 text-gray-400 hover:text-yellow-500"
        >
          <Star className={`w-4 h-4 ${favorites.has(endpoint.id) ? 'fill-yellow-400 text-yellow-400' : ''}`} />
        </button>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${METHOD_COLORS[endpoint.method]}`}>
              {endpoint.method}
            </span>
            <code className="text-sm font-mono text-gray-800 break-all">{endpoint.path}</code>
            {endpoint.requiresClientId && (
              <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 text-xs rounded">x-client-id</span>
            )}
            {endpoint.dangerous && (
              <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-xs rounded">⚠️ Dangerous</span>
            )}
          </div>
          <p className="text-sm text-gray-600 mt-1">{endpoint.description}</p>
          {endpoint.params && (
            <p className="text-xs text-gray-500 mt-1 font-mono">Params: {endpoint.params}</p>
          )}
          {endpoint.body && (
            <p className="text-xs text-gray-500 mt-1 font-mono">Body: {endpoint.body}</p>
          )}
        </div>

        <div className="flex gap-1">
          <button
            onClick={() => copyToClipboard(endpoint)}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
            title="Copy URL"
          >
            {copiedId === endpoint.id ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
          </button>
          {endpoint.method === 'GET' && (
            <>
              <button
                onClick={() => testEndpoint(endpoint)}
                className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded"
                title="Test endpoint"
              >
                <Play className="w-4 h-4" />
              </button>
              <a
                href={`${getBackendUrl()}${endpoint.path}`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                title="Open in new tab"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            </>
          )}
        </div>
      </div>
      
      {testResult?.id === endpoint.id && (
        <div className={`mt-2 p-2 rounded text-xs font-mono overflow-auto max-h-40 ${
          testResult.status === 'loading' ? 'bg-gray-100' :
          testResult.status === 'success' ? 'bg-green-50 border border-green-200' :
          'bg-red-50 border border-red-200'
        }`}>
          {testResult.status === 'loading' ? 'Loading...' :
           testResult.status === 'success' ? JSON.stringify(testResult.data, null, 2) :
           'Error fetching endpoint'}
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Link href="/" className="inline-flex items-center text-blue-600 hover:text-blue-800 mb-4">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Dashboard
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Database className="w-8 h-8 text-blue-600" />
            API Explorer
          </h1>
          <p className="text-gray-600 mt-2">
            {ENDPOINTS.length} endpoints • {favorites.size} favorites
          </p>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search endpoints..."
              className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        {/* Favorites Section */}
        {favoriteEndpoints.length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-yellow-700 mb-3 flex items-center gap-2">
              <Star className="w-5 h-5 fill-yellow-400 text-yellow-400" />
              Favorites
            </h2>
            <div className="space-y-2">
              {favoriteEndpoints.map(renderEndpoint)}
            </div>
          </div>
        )}

        {/* Categories */}
        <div className="space-y-4">
          {categories.map(category => {
            const endpoints = categorizedEndpoints[category];
            if (!endpoints || endpoints.length === 0) return null;
            
            const isExpanded = expandedCategories.has(category);
            
            return (
              <div key={category} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <button
                  onClick={() => toggleCategory(category)}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors"
                >
                  {isExpanded ? <ChevronDown className="w-5 h-5 text-gray-400" /> : <ChevronRight className="w-5 h-5 text-gray-400" />}
                  <span className="text-gray-600">{CATEGORY_ICONS[category]}</span>
                  <span className="font-semibold text-gray-900">{category}</span>
                  <span className="text-sm text-gray-500">({endpoints.length})</span>
                </button>
                
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-2">
                    {endpoints.map(renderEndpoint)}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Empty State */}
        {filteredEndpoints.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            No endpoints match your search.
          </div>
        )}
      </div>
    </div>
  );
}
