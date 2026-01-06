"use client";
import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getBackendBase } from '../../../services/api';
import { 
  CheckCircleIcon, 
  ClockIcon,
  ArrowTopRightOnSquareIcon,
  ExclamationTriangleIcon,
  ArrowLeftIcon,
  ClipboardDocumentListIcon
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolidIcon } from '@heroicons/react/24/solid';

/**
 * ClientTasksPage - Full page view for client onboarding tasks
 */
export default function ClientTasksPage() {
  const params = useParams();
  const router = useRouter();
  // Ensure clientId is a string (useParams can return string | string[])
  const clientId = Array.isArray(params.clientId) ? params.clientId[0] : params.clientId as string;
  
  const [tasks, setTasks] = useState<any[]>([]);
  const [clientName, setClientName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);

  const backendBase = getBackendBase();

  useEffect(() => {
    if (clientId) {
      loadTasks();
    }
  }, [clientId]);

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
    } catch (err) {
      console.error('Error loading tasks:', err);
      setError(err.message || 'Failed to load tasks');
    } finally {
      setIsLoading(false);
    }
  };

  const updateTaskStatus = async (taskId, newStatus) => {
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
    } catch (err) {
      console.error('Error updating task:', err);
      alert(`❌ Error: ${err.message}`);
    } finally {
      setUpdatingTaskId(null);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'Done': return 'bg-green-100 text-green-800 border-green-200';
      case 'In progress': return 'bg-blue-100 text-blue-800 border-blue-200';
      default: return 'bg-gray-100 text-gray-600 border-gray-200';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'Done': return <CheckCircleSolidIcon className="h-6 w-6 text-green-500" />;
      case 'In progress': return <ClockIcon className="h-6 w-6 text-blue-500" />;
      default: return <div className="h-6 w-6 rounded-full border-2 border-gray-300" />;
    }
  };

  // Group tasks by phase
  const tasksByPhase = tasks.reduce((acc, task) => {
    const phase = task.phase || 'Other';
    if (!acc[phase]) acc[phase] = [];
    acc[phase].push(task);
    return acc;
  }, {});

  // Calculate progress
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.status === 'Done').length;
  const inProgressTasks = tasks.filter(t => t.status === 'In progress').length;
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
              onClick={() => router.push('/coached-clients')}
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
        onClick={() => router.push('/coached-clients')}
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

      {/* Empty State */}
      {tasks.length === 0 ? (
        <div className="text-center py-16 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
          <ClipboardDocumentListIcon className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-700 mb-2">No Tasks Yet</h2>
          <p className="text-gray-500 mb-4">
            Tasks haven't been added for this client yet.
          </p>
          <button
            onClick={() => router.push('/coached-clients')}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
          >
            Go Back & Add Tasks
          </button>
        </div>
      ) : (
        /* Task Phases */
        <div className="space-y-8">
          {Object.entries(tasksByPhase).map(([phase, phaseTasks]) => {
            const phaseCompleted = phaseTasks.filter(t => t.status === 'Done').length;
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
                  {phaseTasks.map((task, index) => (
                    <div 
                      key={task.id}
                      className={`px-6 py-4 flex items-start gap-4 transition-colors ${
                        task.status === 'Done' ? 'bg-green-50/50' : 'hover:bg-gray-50'
                      }`}
                    >
                      {/* Task Number */}
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm font-medium text-gray-500">
                        {task.order || index + 1}
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
                        
                        {/* Notes */}
                        {task.notes && (
                          <p className="mt-1 text-sm text-gray-500 italic">
                            {task.notes}
                          </p>
                        )}
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
