"use client";
import React, { useState, useEffect } from 'react';
import { getBackendBase } from '../services/api';
import { 
  XMarkIcon, 
  CheckCircleIcon, 
  ClockIcon,
  ArrowTopRightOnSquareIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolidIcon } from '@heroicons/react/24/solid';

/**
 * ClientTasksModal - Modal to view and manage client onboarding tasks
 */
const ClientTasksModal = ({ isOpen, onClose, clientId, clientName }) => {
  const [tasks, setTasks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updatingTaskId, setUpdatingTaskId] = useState(null);

  const backendBase = getBackendBase();

  useEffect(() => {
    if (isOpen && clientId) {
      loadTasks();
    }
  }, [isOpen, clientId]);

  const loadTasks = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await fetch(`${backendBase}/api/client/${clientId}/tasks`);
      const data = await response.json();
      
      if (data.success) {
        setTasks(data.tasks || []);
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
        // Update local state
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
      case 'Done': return <CheckCircleSolidIcon className="h-5 w-5 text-green-500" />;
      case 'In progress': return <ClockIcon className="h-5 w-5 text-blue-500" />;
      default: return <div className="h-5 w-5 rounded-full border-2 border-gray-300" />;
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
  const progressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 transition-opacity"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden">
          
          {/* Header */}
          <div className="bg-gradient-to-r from-green-600 to-green-700 px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">
                  {clientName}'s Onboarding Tasks
                </h2>
                <p className="text-green-100 text-sm mt-1">
                  {completedTasks} of {totalTasks} tasks completed ({progressPercent}%)
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              >
                <XMarkIcon className="h-6 w-6 text-white" />
              </button>
            </div>
            
            {/* Progress Bar */}
            <div className="mt-3 bg-white/30 rounded-full h-2">
              <div 
                className="bg-white h-2 rounded-full transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Content */}
          <div className="overflow-y-auto max-h-[calc(85vh-140px)] p-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <div className="animate-spin h-8 w-8 border-4 border-green-600 border-t-transparent rounded-full mx-auto mb-4"></div>
                  <p className="text-gray-500">Loading tasks...</p>
                </div>
              </div>
            ) : error ? (
              <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
                <ExclamationTriangleIcon className="h-12 w-12 text-red-400 mx-auto mb-4" />
                <p className="text-red-600">{error}</p>
                <button
                  onClick={loadTasks}
                  className="mt-4 px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200"
                >
                  Try Again
                </button>
              </div>
            ) : tasks.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500">No tasks found. Click "Add Tasks" to create onboarding tasks.</p>
              </div>
            ) : (
              <div className="space-y-8">
                {Object.entries(tasksByPhase).map(([phase, phaseTasks]) => (
                  <div key={phase}>
                    {/* Phase Header */}
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                      <span className="bg-gray-200 px-2 py-0.5 rounded text-xs">
                        {phaseTasks.filter(t => t.status === 'Done').length}/{phaseTasks.length}
                      </span>
                      {phase}
                    </h3>
                    
                    {/* Task List */}
                    <div className="space-y-2">
                      {phaseTasks.map((task) => (
                        <div 
                          key={task.id}
                          className={`border rounded-lg p-4 transition-all ${
                            task.status === 'Done' 
                              ? 'bg-green-50 border-green-200' 
                              : 'bg-white hover:shadow-md'
                          }`}
                        >
                          <div className="flex items-start gap-4">
                            {/* Status Icon/Checkbox */}
                            <button
                              onClick={() => {
                                const newStatus = task.status === 'Done' ? 'Todo' : 'Done';
                                updateTaskStatus(task.id, newStatus);
                              }}
                              disabled={updatingTaskId === task.id}
                              className="flex-shrink-0 mt-0.5"
                            >
                              {updatingTaskId === task.id ? (
                                <div className="animate-spin h-5 w-5 border-2 border-green-500 border-t-transparent rounded-full" />
                              ) : (
                                getStatusIcon(task.status)
                              )}
                            </button>
                            
                            {/* Task Content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-3">
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
                                    className="text-blue-500 hover:text-blue-700 flex-shrink-0"
                                    title="View Instructions"
                                  >
                                    <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                                  </a>
                                )}
                              </div>
                              
                              {/* Status Selector */}
                              <div className="mt-2 flex items-center gap-2">
                                <select
                                  value={task.status}
                                  onChange={(e) => updateTaskStatus(task.id, e.target.value)}
                                  disabled={updatingTaskId === task.id}
                                  className={`text-xs font-medium px-2 py-1 rounded border ${getStatusColor(task.status)} cursor-pointer`}
                                >
                                  <option value="Todo">Todo</option>
                                  <option value="In progress">In progress</option>
                                  <option value="Done">Done</option>
                                </select>
                                
                                {task.notes && (
                                  <span className="text-xs text-gray-500 italic truncate">
                                    {task.notes}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t bg-gray-50 px-6 py-4 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClientTasksModal;
