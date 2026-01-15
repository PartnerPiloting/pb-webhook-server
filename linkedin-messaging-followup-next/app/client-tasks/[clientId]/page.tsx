"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { getBackendBase } from '../../../services/api';
import { 
  CheckCircleIcon, 
  ClockIcon,
  ArrowTopRightOnSquareIcon,
  ExclamationTriangleIcon,
  ArrowLeftIcon,
  ClipboardDocumentListIcon,
  PencilSquareIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ChatBubbleLeftIcon
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolidIcon } from '@heroicons/react/24/solid';

// Task interface
interface Task {
  id: string;
  task: string;
  phase: string;
  phaseOrder: number;
  taskOrder: number;
  status: string;
  instructionsUrl: string | null;
  notes: string;
}

/**
 * ClientTasksPage - Full page view for client onboarding tasks
 */
export default function ClientTasksPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Ensure clientId is a string (useParams can return string | string[])
  const clientId = Array.isArray(params.clientId) ? params.clientId[0] : params.clientId as string;
  
  const [tasks, setTasks] = useState<Task[]>([]);
  const [clientName, setClientName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  
  // Coach notes state
  const [coachNotes, setCoachNotes] = useState(''); // Full history of notes
  const [newNote, setNewNote] = useState(''); // New note being composed
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(true);
  
  // Task notes editing state
  const [editingTaskNotes, setEditingTaskNotes] = useState<string | null>(null);
  const [taskNotesValue, setTaskNotesValue] = useState('');
  const [savingTaskNotes, setSavingTaskNotes] = useState(false);

  const backendBase = getBackendBase();

  // Build URL with preserved client auth params
  const buildUrlWithAuth = useCallback((path: string) => {
    // Try to get client code from: URL params first, then localStorage
    const clientParam = searchParams.get('client') || searchParams.get('testClient');
    let clientCode = clientParam;
    
    if (!clientCode && typeof window !== 'undefined') {
      clientCode = localStorage.getItem('clientCode');
    }
    
    if (clientCode) {
      return `${path}?client=${encodeURIComponent(clientCode)}`;
    }
    return path;
  }, [searchParams]);

  useEffect(() => {
    if (clientId) {
      loadTasks();
      loadCoachNotes();
    }
  }, [clientId]);

  const loadCoachNotes = async () => {
    try {
      const response = await fetch(`${backendBase}/api/client/${clientId}/coach-notes`);
      const data = await response.json();
      
      if (data.success) {
        setCoachNotes(data.coachNotes || '');
      }
    } catch (err) {
      console.error('Error loading coach notes:', err);
    }
  };

  const addCoachNote = async () => {
    if (!newNote.trim()) return; // No empty notes
    
    try {
      setSavingNotes(true);
      
      const response = await fetch(`${backendBase}/api/client/${clientId}/coach-notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: newNote, append: true })
      });
      
      const data = await response.json();
      
      if (data.success) {
        // Update the notes history with the response (includes new timestamped note)
        setCoachNotes(data.coachNotes || '');
        setNewNote(''); // Clear the input
      } else {
        alert(`❌ Failed to add note: ${data.error}`);
      }
    } catch (err: unknown) {
      console.error('Error adding coach note:', err);
      alert(`❌ Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSavingNotes(false);
    }
  };

  const saveTaskNotes = async (taskId: string) => {
    try {
      setSavingTaskNotes(true);
      
      const response = await fetch(`${backendBase}/api/task/${taskId}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: taskNotesValue })
      });
      
      const data = await response.json();
      
      if (data.success) {
        // Update local state
        setTasks(tasks.map(task => 
          task.id === taskId ? { ...task, notes: taskNotesValue } : task
        ));
        setEditingTaskNotes(null);
        setTaskNotesValue('');
      } else {
        alert(`❌ Failed to save: ${data.error}`);
      }
    } catch (err: unknown) {
      console.error('Error saving task notes:', err);
      alert(`❌ Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSavingTaskNotes(false);
    }
  };

  const startEditingTaskNotes = (task: Task) => {
    setEditingTaskNotes(task.id);
    setTaskNotesValue(task.notes || '');
  };

  const cancelEditingTaskNotes = () => {
    setEditingTaskNotes(null);
    setTaskNotesValue('');
  };

  const loadTasks = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await fetch(`${backendBase}/api/client/${clientId}/tasks`);
      const data = await response.json();
      
      if (data.success) {
        setTasks(data.tasks || []);
        // Format client name for display (Keith-Sinclair -> Keith Sinclair)
        setClientName(clientId.replace(/-/g, ' '));
      } else {
        setError(data.error || 'Failed to load tasks');
      }
    } catch (err: unknown) {
      console.error('Error loading tasks:', err);
      setError(err instanceof Error ? err.message : 'Failed to load tasks');
    } finally {
      setIsLoading(false);
    }
  };

  const updateTaskStatus = async (taskId: string, newStatus: string) => {
    try {
      setUpdatingTaskId(taskId);
      
      const response = await fetch(`${backendBase}/api/task/${taskId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setTasks(tasks.map(task => 
          task.id === taskId ? { ...task, status: newStatus } : task
        ));
      } else {
        alert(`❌ Failed to update: ${data.error}`);
      }
    } catch (err: unknown) {
      console.error('Error updating task:', err);
      alert(`❌ Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setUpdatingTaskId(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Done': return 'bg-green-100 text-green-800 border-green-200';
      case 'In progress': return 'bg-blue-100 text-blue-800 border-blue-200';
      default: return 'bg-gray-100 text-gray-600 border-gray-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Done': return <CheckCircleSolidIcon className="h-6 w-6 text-green-500" />;
      case 'In progress': return <ClockIcon className="h-6 w-6 text-blue-500" />;
      default: return <div className="h-6 w-6 rounded-full border-2 border-gray-300" />;
    }
  };

  // Group tasks by phase, preserving phase order
  const tasksByPhase: Record<string, Task[]> = {};
  const phaseOrderMap: Record<string, number> = {};
  
  // Tasks are already sorted by Phase Order then Task Order from the API
  tasks.forEach((task: Task) => {
    const phase = task.phase || 'Other';
    if (!tasksByPhase[phase]) {
      tasksByPhase[phase] = [];
      phaseOrderMap[phase] = task.phaseOrder || 999;
    }
    tasksByPhase[phase].push(task);
  });
  
  // Get phases sorted by their order
  const sortedPhases = Object.keys(tasksByPhase).sort((a, b) => 
    (phaseOrderMap[a] || 999) - (phaseOrderMap[b] || 999)
  );

  // Calculate progress
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t: Task) => t.status === 'Done').length;
  const inProgressTasks = tasks.filter((t: Task) => t.status === 'In progress').length;
  const progressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin h-10 w-10 border-4 border-green-600 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-500 text-lg">Loading tasks...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="max-w-2xl mx-auto mt-12">
        <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center">
          <ExclamationTriangleIcon className="h-14 w-14 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-red-800 mb-2">Error Loading Tasks</h2>
          <p className="text-red-600 mb-4">{error}</p>
          <div className="flex justify-center gap-3">
            <button
              onClick={loadTasks}
              className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 font-medium"
            >
              Try Again
            </button>
            <button
              onClick={() => router.push(buildUrlWithAuth('/coached-clients'))}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium"
            >
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Back Button */}
      <button
        onClick={() => router.push(buildUrlWithAuth('/coached-clients'))}
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 group"
      >
        <ArrowLeftIcon className="h-5 w-5 group-hover:-translate-x-1 transition-transform" />
        <span>Back to Coached Clients</span>
      </button>

      {/* Header Card */}
      <div className="bg-gradient-to-r from-green-600 to-green-700 rounded-xl p-6 mb-8 text-white shadow-lg">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <ClipboardDocumentListIcon className="h-8 w-8" />
              <h1 className="text-2xl font-bold">{clientName}'s Onboarding</h1>
            </div>
            <p className="text-green-100">
              Track progress through the onboarding checklist
            </p>
          </div>
          
          {/* Stats */}
          <div className="text-right">
            <div className="text-3xl font-bold">{progressPercent}%</div>
            <div className="text-green-100 text-sm">Complete</div>
          </div>
        </div>
        
        {/* Progress Bar */}
        <div className="mt-6">
          <div className="flex justify-between text-sm text-green-100 mb-2">
            <span>{completedTasks} completed</span>
            <span>{inProgressTasks} in progress</span>
            <span>{totalTasks - completedTasks - inProgressTasks} remaining</span>
          </div>
          <div className="bg-white/30 rounded-full h-3">
            <div 
              className="bg-white h-3 rounded-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Coach Notes Section */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-8 overflow-hidden">
        <button
          onClick={() => setNotesExpanded(!notesExpanded)}
          className="w-full px-6 py-4 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
        >
          <div className="flex items-center gap-3">
            <PencilSquareIcon className="h-5 w-5 text-gray-500" />
            <span className="font-medium text-gray-700">Coach Notes</span>
            {coachNotes && !notesExpanded && (
              <span className="text-sm text-gray-400 truncate max-w-xs">
                — {coachNotes.split('\n').pop()?.substring(0, 50)}...
              </span>
            )}
          </div>
          {notesExpanded ? (
            <ChevronUpIcon className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronDownIcon className="h-5 w-5 text-gray-400" />
          )}
        </button>
        
        {notesExpanded && (
          <div className="p-6 space-y-4">
            {/* Notes History - Read Only */}
            {coachNotes && (
              <div className="bg-gray-50 rounded-lg p-4 max-h-64 overflow-y-auto">
                <p className="text-xs font-medium text-gray-500 mb-3">📝 Note History (oldest → newest)</p>
                <div className="space-y-3">
                  {coachNotes.split('\n\n').map((note, index) => {
                    // Parse timestamp and content: [15 Jan 2026, 10:30 am] Note text
                    const match = note.match(/^\[(.+?)\]\s*(.*)$/s);
                    if (match) {
                      return (
                        <div key={index} className="border-l-2 border-green-300 pl-3 py-1">
                          <p className="text-xs text-gray-400 mb-1">{match[1]}</p>
                          <p className="text-sm text-gray-700 whitespace-pre-wrap">{match[2]}</p>
                        </div>
                      );
                    }
                    // Legacy note without timestamp
                    return (
                      <div key={index} className="border-l-2 border-gray-300 pl-3 py-1">
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{note}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            
            {/* Add New Note */}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-2">
                ➕ Add New Note
              </label>
              <textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Type your note here... Timestamp will be added automatically when you save."
                className="w-full h-24 px-4 py-3 border border-gray-200 rounded-lg resize-none focus:ring-2 focus:ring-green-500 focus:border-transparent text-gray-700 placeholder-gray-400"
                onKeyDown={(e) => {
                  // Ctrl+Enter or Cmd+Enter to save
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    addCoachNote();
                  }
                }}
              />
              <div className="mt-3 flex items-center justify-between">
                <p className="text-xs text-gray-400">
                  Tip: Press Ctrl+Enter to save quickly
                </p>
                <button
                  onClick={addCoachNote}
                  disabled={savingNotes || !newNote.trim()}
                  className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  {savingNotes ? 'Saving...' : 'Add Note'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Empty State */}
      {tasks.length === 0 ? (
        <div className="text-center py-16 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
          <ClipboardDocumentListIcon className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-700 mb-2">No Tasks Yet</h2>
          <p className="text-gray-500 mb-4">
            Tasks haven't been added for this client yet.
          </p>
          <button
            onClick={() => router.push(buildUrlWithAuth('/coached-clients'))}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
          >
            Go Back & Add Tasks
          </button>
        </div>
      ) : (
        /* Task Phases - sorted by Phase Order */
        <div className="space-y-8">
          {sortedPhases.map((phase: string) => {
            const phaseTasks = tasksByPhase[phase];
            const phaseCompleted = phaseTasks.filter((t: Task) => t.status === 'Done').length;
            const phasePercent = Math.round((phaseCompleted / phaseTasks.length) * 100);
            
            return (
              <div key={phase} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                {/* Phase Header */}
                <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold text-gray-900 text-lg">{phase}</h2>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-500">
                        {phaseCompleted}/{phaseTasks.length} done
                      </span>
                      <div className="w-24 bg-gray-200 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full transition-all ${
                            phasePercent === 100 ? 'bg-green-500' : 'bg-blue-500'
                          }`}
                          style={{ width: `${phasePercent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Task List */}
                <div className="divide-y divide-gray-100">
                  {phaseTasks.map((task: Task, index: number) => (
                    <div 
                      key={task.id}
                      className={`px-6 py-4 flex items-start gap-4 transition-colors ${
                        task.status === 'Done' ? 'bg-green-50/50' : 'hover:bg-gray-50'
                      }`}
                    >
                      {/* Task Number */}
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm font-medium text-gray-500">
                        {task.taskOrder || index + 1}
                      </div>
                      
                      {/* Status Toggle */}
                      <button
                        onClick={() => {
                          const newStatus = task.status === 'Done' ? 'Todo' : 'Done';
                          updateTaskStatus(task.id, newStatus);
                        }}
                        disabled={updatingTaskId === task.id}
                        className="flex-shrink-0 mt-0.5"
                        title={task.status === 'Done' ? 'Mark as incomplete' : 'Mark as complete'}
                      >
                        {updatingTaskId === task.id ? (
                          <div className="animate-spin h-6 w-6 border-2 border-green-500 border-t-transparent rounded-full" />
                        ) : (
                          getStatusIcon(task.status)
                        )}
                      </button>
                      
                      {/* Task Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className={`font-medium ${
                            task.status === 'Done' ? 'text-gray-500 line-through' : 'text-gray-900'
                          }`}>
                            {task.task}
                          </span>
                          {task.instructionsUrl && (
                            <a
                              href={task.instructionsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 hover:underline"
                              title="View Instructions"
                            >
                              <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                              Instructions
                            </a>
                          )}
                        </div>
                        
                        {/* Task Notes - Editable */}
                        <div className="mt-2">
                          {editingTaskNotes === task.id ? (
                            <div className="flex items-start gap-2">
                              <textarea
                                value={taskNotesValue}
                                onChange={(e) => setTaskNotesValue(e.target.value)}
                                placeholder="Add a note about this task..."
                                className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                                rows={2}
                                autoFocus
                              />
                              <div className="flex flex-col gap-1">
                                <button
                                  onClick={() => saveTaskNotes(task.id)}
                                  disabled={savingTaskNotes}
                                  className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                                >
                                  {savingTaskNotes ? '...' : 'Save'}
                                </button>
                                <button
                                  onClick={cancelEditingTaskNotes}
                                  disabled={savingTaskNotes}
                                  className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-start gap-2 group">
                              {task.notes ? (
                                <>
                                  <p className="text-sm text-gray-500 italic flex-1">
                                    📝 {task.notes}
                                  </p>
                                  <button
                                    onClick={() => startEditingTaskNotes(task)}
                                    className="text-xs text-gray-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                    Edit
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => startEditingTaskNotes(task)}
                                  className="text-xs text-gray-400 hover:text-blue-600 flex items-center gap-1"
                                >
                                  <ChatBubbleLeftIcon className="h-3 w-3" />
                                  Add note
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {/* Status Dropdown */}
                      <select
                        value={task.status}
                        onChange={(e) => updateTaskStatus(task.id, e.target.value)}
                        disabled={updatingTaskId === task.id}
                        className={`text-sm font-medium px-3 py-1.5 rounded-lg border cursor-pointer ${getStatusColor(task.status)}`}
                      >
                        <option value="Todo">Todo</option>
                        <option value="In progress">In progress</option>
                        <option value="Done">Done</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      
      {/* Footer */}
      <div className="mt-8 text-center text-gray-500 text-sm">
        Changes are saved automatically
      </div>
    </div>
  );
}
