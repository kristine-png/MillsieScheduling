import { useState, useMemo } from 'react';
import { DndContext, useDraggable, useDroppable, pointerWithin, useSensors, useSensor, PointerSensor, DragOverlay } from '@dnd-kit/core';
import { initialEmployees, taskTemplates, runTemplates, hoursOfDay } from './data';
import { Clock, GripVertical, AlertCircle, Users, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Plus, Trash2, Edit2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { format, addWeeks, subWeeks, startOfWeek, addDays, getWeek } from 'date-fns';
import './App.css';

// Draggable Sidebar Item (Pre-calculated Generated Task)
function DraggableGeneratedTask({ task }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `generated-${task.id}`,
    data: { type: 'generated', task },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`task-template task-${task.groupId}`}
      style={{ opacity: isDragging ? 0.5 : 1, touchAction: 'none' }}
    >
      <GripVertical size={16} className="drag-handle-icon" />
      <div className="task-content-wrapper">
        <div className="task-title" style={{ fontSize: '0.875rem' }}>{task.name}</div>
        <div className="task-meta">
          <Clock size={12} />
          {task.duration}m
        </div>
      </div>
    </div>
  );
}

// Droppable Schedule Slot (Full Day)
function DroppableDay({ dateStr, children }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `day-${dateStr}`,
    data: { dateStr },
  });

  return (
    <div
      ref={setNodeRef}
      style={{ 
        position: 'relative', 
        height: '100%', 
        backgroundColor: isOver ? 'rgba(79, 70, 229, 0.05)' : 'transparent' 
      }}
    >
      {/* Visual background grid lines */}
      {hoursOfDay.map(hour => (
        <div key={hour} className="hour-slot" style={{ pointerEvents: 'none' }} />
      ))}
      {children}
    </div>
  );
}

// Layout helper for overlap collision detection
function layoutDayTasks(tasks) {
  if (tasks.length === 0) return [];
  
  const getStartMins = (t) => (t.startHour - 7) * 60 + (t.startMinute || 0);
  const getEndMins = (t) => getStartMins(t) + t.duration;

  const sorted = [...tasks].sort((a, b) => {
    const startA = getStartMins(a);
    const startB = getStartMins(b);
    if (startA !== startB) return startA - startB;
    return getEndMins(b) - getEndMins(a);
  });

  const columns = [];
  let lastEventEnding = null;
  const results = [];

  const packEvents = () => {
    const numColumns = columns.length;
    columns.forEach((col, colIdx) => {
      col.forEach(task => {
        results.push({
          task,
          layout: {
            left: (100 / numColumns) * colIdx,
            width: 100 / numColumns
          }
        });
      });
    });
  };

  sorted.forEach(task => {
    const start = getStartMins(task);
    if (lastEventEnding !== null && start >= lastEventEnding) {
      packEvents();
      columns.length = 0;
      lastEventEnding = null;
    }

    let placed = false;
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const lastEventInCol = col[col.length - 1];
      if (getEndMins(lastEventInCol) <= start) {
        col.push(task);
        placed = true;
        break;
      }
    }
    
    if (!placed) {
      columns.push([task]);
    }

    const end = getEndMins(task);
    if (lastEventEnding === null || end > lastEventEnding) {
      lastEventEnding = end;
    }
  });

  if (columns.length > 0) {
    packEvents();
  }

  return results;
}

// Scheduled Task Block on Grid
function ScheduledTaskBlock({ scheduledTask, employees, onClick, layout }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `scheduled-${scheduledTask.id}`,
    data: { type: 'scheduled', scheduledTask },
  });

  const assignedEmp = employees.find(e => e.id === scheduledTask.employeeId);
  const skillLevel = assignedEmp ? assignedEmp.skills[scheduledTask.templateId] || 'untrained' : null;
  
  const height = Math.max((scheduledTask.duration / 60) * 80, 24);
  const startMins = (scheduledTask.startHour - 7) * 60 + (scheduledTask.startMinute || 0);
  const top = (startMins / 60) * 80;

  const leftPercent = layout ? layout.left : 0;
  const widthPercent = layout ? layout.width : 100;

  const formatTime = (hour, min) => {
    const h = hour > 12 ? hour - 12 : hour;
    const m = min.toString().padStart(2, '0');
    const ampm = hour >= 12 ? 'PM' : 'AM';
    return `${h}:${m} ${ampm}`;
  };

  const endTotalMins = (scheduledTask.startHour * 60) + (scheduledTask.startMinute || 0) + scheduledTask.duration;
  const endHour = Math.floor(endTotalMins / 60);
  const endMin = endTotalMins % 60;
  const timeString = `${formatTime(scheduledTask.startHour, scheduledTask.startMinute || 0)} - ${formatTime(endHour, endMin)}`;

  return (
    <div 
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`scheduled-task task-${scheduledTask.groupId}`}
      style={{ 
        height: `${height - 2}px`, 
        top: `${top + 1}px`,
        left: `calc(${leftPercent}% + 2px)`,
        width: `calc(${widthPercent}% - 4px)`,
        opacity: isDragging ? 0.5 : 1,
        touchAction: 'none',
        position: 'absolute',
        padding: height < 40 ? '2px 6px' : '0.5rem',
        lineHeight: 1.2
      }}
      onClick={(e) => {
        if (!isDragging) {
          e.stopPropagation();
          onClick(scheduledTask);
        }
      }}
    >
      <div className="task-title" style={{ fontSize: widthPercent < 50 ? '0.75rem' : '0.875rem' }}>{scheduledTask.name}</div>
      <div className="task-meta" style={{ marginBottom: '2px', fontSize: '0.7rem' }}>
        {timeString} ({scheduledTask.duration}m)
      </div>
      {assignedEmp ? (
        <div className="task-meta">
          <Users size={12} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{assignedEmp.name}</span>
          {skillLevel === 'untrained' && <AlertCircle size={12} color="var(--danger)" style={{ flexShrink: 0 }} />}
        </div>
      ) : (
        <div className="task-meta" style={{ color: 'var(--danger)', fontWeight: 500 }}>
          <AlertCircle size={12} style={{ flexShrink: 0 }} /> {widthPercent < 50 ? 'Un...' : 'Unassigned'}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [employees] = useState(initialEmployees);
  const [activeRuns, setActiveRuns] = useState([]);
  const [scheduledTasks, setScheduledTasks] = useState([]);
  
  const [currentDate, setCurrentDate] = useState(new Date());

  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate, { weekStartsOn: 1 });
    return Array.from({ length: 5 }).map((_, i) => {
      const date = addDays(start, i);
      return {
        id: format(date, 'yyyy-MM-dd'),
        name: format(date, 'EEEE'),
        formattedDate: format(date, 'MMM d')
      };
    });
  }, [currentDate]);

  const currentWeekNumber = getWeek(currentDate, { weekStartsOn: 1 });
  const weekStartStr = weekDays[0].formattedDate;
  const weekEndStr = weekDays[4].formattedDate;
  
  const [isNewRunModalOpen, setIsNewRunModalOpen] = useState(false);
  const [selectedRunTemplate, setSelectedRunTemplate] = useState(runTemplates[0].id);
  const [runInputAmount, setRunInputAmount] = useState(1);

  const [isEditRunModalOpen, setIsEditRunModalOpen] = useState(false);
  const [editingRunId, setEditingRunId] = useState(null);
  const [editRunInputAmount, setEditRunInputAmount] = useState('');

  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [assigningTask, setAssigningTask] = useState(null);
  const [selectedEmployee, setSelectedEmployee] = useState('');

  const [activeDragItem, setActiveDragItem] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  const handleDragStart = (event) => {
    setActiveDragItem(event.active);
  };

  const handleDragEnd = (event) => {
    setActiveDragItem(null);
    const { active, over } = event;
    if (!over) return;

    if (over.id.startsWith('day-')) {
      const { dateStr } = over.data.current;

      // Calculate precision drop time based on Y offset
      const dropY = active.rect.current.translated.top - over.rect.top;
      const clampedY = Math.max(0, Math.min(dropY, 11 * 80 - 20)); // Don't drop perfectly at the bottom edge
      
      const totalMinutes = (clampedY / 80) * 60;
      const startHour = 7 + Math.floor(totalMinutes / 60);
      const startMinute = Math.round((totalMinutes % 60) / 5) * 5;

      if (active.data.current?.type === 'generated') {
        const generatedTask = active.data.current.task;

        const newTask = {
          id: uuidv4(),
          templateId: generatedTask.templateId,
          groupId: generatedTask.groupId,
          name: generatedTask.name,
          dateStr,
          startHour,
          startMinute,
          duration: generatedTask.duration,
          employeeId: null,
          runId: generatedTask.runId
        };
        
        setScheduledTasks([...scheduledTasks, newTask]);
        
        setActiveRuns(prev => prev.map(run => {
          if (run.id === generatedTask.runId) {
            return {
              ...run,
              generatedTasks: run.generatedTasks.filter(t => t.id !== generatedTask.id)
            };
          }
          return run;
        }));
      }
      
      if (active.data.current?.type === 'scheduled') {
        const draggedTask = active.data.current.scheduledTask;
        setScheduledTasks(prev => prev.map(t => 
          t.id === draggedTask.id 
            ? { ...t, dateStr, startHour, startMinute } 
            : t
        ));
      }
    }
  };

  const handleAddRun = (e) => {
    e.preventDefault();
    const runTemplate = runTemplates.find(rt => rt.id === selectedRunTemplate);
    if (!runTemplate) return;

    const parsedInputAmount = Number(runInputAmount) || 1;
    const totalBuckets = parsedInputAmount * runTemplate.bucketsPerInputUnit;
    const runId = uuidv4();

    const generatedTasks = runTemplate.tasks.map(taskId => {
      const template = taskTemplates.find(t => t.id === taskId);
      if (!template) return null;

      let duration = template.baseMinutes;
      if (template.variableMinutesPerCycle > 0) {
        const cycles = template.isBatchProcess 
          ? Math.ceil(totalBuckets / template.unitsPerCycle)
          : (totalBuckets / template.unitsPerCycle);
        duration += cycles * template.variableMinutesPerCycle;
      }

      return {
        id: uuidv4(),
        runId,
        templateId: template.id,
        groupId: template.groupId,
        name: template.name,
        duration: Math.round(duration)
      };
    }).filter(Boolean);

    const newRun = {
      id: runId,
      templateId: runTemplate.id,
      inputAmount: parsedInputAmount,
      name: `${runTemplate.name} (${parsedInputAmount} ${runTemplate.inputUnit})`,
      groupId: runTemplate.groupId,
      buckets: totalBuckets,
      generatedTasks
    };

    setActiveRuns([...activeRuns, newRun]);
    setIsNewRunModalOpen(false);
    setRunInputAmount(1);
  };

  const handleEditRunSubmit = (e) => {
    e.preventDefault();
    const runToEdit = activeRuns.find(r => r.id === editingRunId);
    if (!runToEdit) return;

    const runTemplate = runTemplates.find(rt => rt.id === runToEdit.templateId);
    if (!runTemplate) return;

    const parsedInputAmount = Number(editRunInputAmount) || 1;
    const totalBuckets = parsedInputAmount * runTemplate.bucketsPerInputUnit;

    const getNewDuration = (taskId) => {
      const template = taskTemplates.find(t => t.id === taskId);
      if (!template) return 0;
      let duration = template.baseMinutes;
      if (template.variableMinutesPerCycle > 0) {
        const cycles = template.isBatchProcess 
          ? Math.ceil(totalBuckets / template.unitsPerCycle)
          : (totalBuckets / template.unitsPerCycle);
        duration += cycles * template.variableMinutesPerCycle;
      }
      return Math.round(duration);
    };

    setActiveRuns(prev => prev.map(run => {
      if (run.id === editingRunId) {
        return {
          ...run,
          name: `${runTemplate.name} (${parsedInputAmount} ${runTemplate.inputUnit})`,
          buckets: totalBuckets,
          inputAmount: parsedInputAmount,
          generatedTasks: run.generatedTasks.map(t => ({
            ...t,
            duration: getNewDuration(t.templateId)
          }))
        };
      }
      return run;
    }));

    setScheduledTasks(prev => prev.map(t => {
      if (t.runId === editingRunId) {
        return {
          ...t,
          duration: getNewDuration(t.templateId)
        };
      }
      return t;
    }));

    setIsEditRunModalOpen(false);
    setEditingRunId(null);
  };

  const handleAssignSubmit = (e) => {
    e.preventDefault();
    if (!assigningTask) return;

    setScheduledTasks(prev => prev.map(t => 
      t.id === assigningTask.id 
        ? { ...t, employeeId: selectedEmployee || null }
        : t
    ));

    setIsAssignModalOpen(false);
    setAssigningTask(null);
  };

  const handleDeleteTask = () => {
    if (!assigningTask) return;

    // Remove from calendar
    setScheduledTasks(prev => prev.filter(t => t.id !== assigningTask.id));

    // Put it back in the sidebar
    setActiveRuns(prev => prev.map(run => {
      if (run.id === assigningTask.runId) {
        return {
          ...run,
          generatedTasks: [...run.generatedTasks, {
            id: assigningTask.id, // Re-use ID so React keys don't complain
            runId: assigningTask.runId,
            templateId: assigningTask.templateId,
            groupId: assigningTask.groupId,
            name: assigningTask.name,
            duration: assigningTask.duration
          }]
        };
      }
      return run;
    }));

    setIsAssignModalOpen(false);
    setAssigningTask(null);
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} collisionDetection={pointerWithin}>
      <div className="app-layout">
        <div className="sidebar-panel">
          <div className="sidebar-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2>Millsie Scheduling</h2>
              <p>Active Production Runs</p>
            </div>
          </div>
          
          <div className="sidebar-content" style={{ padding: '1rem' }}>
            <button className="btn btn-primary" style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }} onClick={() => setIsNewRunModalOpen(true)}>
              <Plus size={16} /> New Production Run
            </button>

            <div style={{ marginTop: '2rem' }}>
              {activeRuns.length === 0 && (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', textAlign: 'center', padding: '2rem 0' }}>
                  No active runs. Add one above.
                </div>
              )}
              {activeRuns.map(run => (
                <div key={run.id} className="task-group">
                  <div className="task-group-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <ChevronDown size={16} />
                      <span>{run.name}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button 
                        className="btn btn-icon" 
                        style={{ padding: '2px', color: 'var(--text-muted)' }}
                        title="Edit Yield Amount"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingRunId(run.id);
                          setEditRunInputAmount(run.inputAmount || '');
                          setIsEditRunModalOpen(true);
                        }}
                      >
                        <Edit2 size={14} />
                      </button>
                      <button 
                        className="btn btn-icon" 
                        style={{ padding: '2px', color: 'var(--text-muted)' }}
                        title="Delete Production Run"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`Are you sure you want to delete ${run.name}? This will also remove any of its tasks from the schedule.`)) {
                            setActiveRuns(prev => prev.filter(r => r.id !== run.id));
                            setScheduledTasks(prev => prev.filter(t => t.runId !== run.id));
                          }
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  {run.generatedTasks.length === 0 ? (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', paddingLeft: '1.5rem' }}>All tasks scheduled!</div>
                  ) : (
                    <div className="task-group-list">
                      {run.generatedTasks.map(task => (
                        <DraggableGeneratedTask key={task.id} task={task} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div style={{ marginTop: '2rem' }}>
              <div className="section-title">Team</div>
              {employees.map(emp => {
                const expertSkills = Object.entries(emp.skills)
                  .filter(([_, level]) => level === 'expert')
                  .map(([taskId, _]) => {
                    const task = taskTemplates.find(t => t.id === taskId);
                    return task ? task.name : taskId;
                  });

                return (
                  <div key={emp.id} className="employee-card" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.25rem' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{emp.name}</span>
                    {expertSkills.length > 0 ? (
                      <span style={{ fontSize: '0.75rem', color: 'var(--success)' }}>
                        Expert: {expertSkills.join(', ')}
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No expert skills</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="schedule-main">
          <div className="schedule-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
              <CalendarDays size={20} color="var(--primary)" />
              Week {currentWeekNumber} ({weekStartStr} - {weekEndStr})
            </div>
            
            <div className="week-navigation">
              <button className="btn btn-icon" onClick={() => setCurrentDate(subWeeks(currentDate, 1))}>
                <ChevronLeft size={16} />
              </button>
              <button className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }} onClick={() => setCurrentDate(new Date())}>
                Today
              </button>
              <button className="btn btn-icon" onClick={() => setCurrentDate(addWeeks(currentDate, 1))}>
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          <div className="schedule-grid-container">
            <div className="schedule-grid">
              {/* Header Row (Row 1) */}
              <div className="grid-header-cell" style={{ borderTopLeftRadius: 'var(--radius-lg)' }}>Time</div>
              {weekDays.map(day => (
                <div key={day.id} className="grid-header-cell">
                  <div>{day.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>{day.formattedDate}</div>
                </div>
              ))}

              {/* Time Column (Col 1, Rows 2 to 12) */}
              {hoursOfDay.map((hour, idx) => (
                <div key={`time-${hour}`} className="time-cell" style={{ gridColumn: 1, gridRow: idx + 2 }}>
                  <span>{hour > 12 ? `${hour - 12} PM` : `${hour} AM`}</span>
                </div>
              ))}

              {/* Day Columns (Cols 2 to 6, spanning rows 2 to 12) */}
              {weekDays.map((day, colIdx) => (
                <div key={`col-${day.id}`} className="day-column" style={{ gridColumn: colIdx + 2, gridRow: '2 / span 11' }}>
                  <DroppableDay dateStr={day.id}>
                    {layoutDayTasks(scheduledTasks.filter(t => t.dateStr === day.id)).map(result => (
                      <ScheduledTaskBlock 
                        key={result.task.id} 
                        scheduledTask={result.task} 
                        layout={result.layout}
                        employees={employees} 
                        onClick={(task) => {
                          setAssigningTask(task);
                          setSelectedEmployee(task.employeeId || '');
                          setIsAssignModalOpen(true);
                        }}
                      />
                    ))}
                  </DroppableDay>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Modals */}
        {isNewRunModalOpen && (
          <div className="modal-overlay">
            <div className="modal-content">
              <h3>Start Production Run</h3>
              <form onSubmit={handleAddRun}>
                <div className="form-group">
                  <label>Production Group</label>
                  <select value={selectedRunTemplate} onChange={e => setSelectedRunTemplate(e.target.value)}>
                    {runTemplates.map(rt => (
                      <option key={rt.id} value={rt.id}>{rt.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Yield Amount ({runTemplates.find(rt => rt.id === selectedRunTemplate)?.inputUnit})</label>
                  <input 
                    type="number" 
                    min="1" 
                    value={runInputAmount} 
                    onChange={e => setRunInputAmount(e.target.value)}
                    required
                  />
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    This equals {(Number(runInputAmount) || 0) * (runTemplates.find(rt => rt.id === selectedRunTemplate)?.bucketsPerInputUnit || 1)} buckets.
                  </p>
                </div>
                <div className="modal-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setIsNewRunModalOpen(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Create Run</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {isEditRunModalOpen && editingRunId && (
          <div className="modal-overlay">
            <div className="modal-content">
              <h3>Edit Yield Amount</h3>
              <form onSubmit={handleEditRunSubmit}>
                <div className="form-group">
                  <label>
                    New Yield Amount 
                    ({runTemplates.find(rt => rt.id === activeRuns.find(r => r.id === editingRunId)?.templateId)?.inputUnit})
                  </label>
                  <input 
                    type="number" 
                    min="1" 
                    value={editRunInputAmount} 
                    onChange={e => setEditRunInputAmount(e.target.value)}
                    required
                  />
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    This equals {(Number(editRunInputAmount) || 0) * (runTemplates.find(rt => rt.id === activeRuns.find(r => r.id === editingRunId)?.templateId)?.bucketsPerInputUnit || 1)} buckets.
                  </p>
                </div>
                <div className="modal-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setIsEditRunModalOpen(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Update Run</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {isAssignModalOpen && assigningTask && (
          <div className="modal-overlay">
            <div className="modal-content">
              <h3>Edit Schedule</h3>
              <p style={{ marginBottom: '1rem', color: 'var(--text-muted)' }}>{assigningTask.name} ({assigningTask.duration}m)</p>
              <form onSubmit={handleAssignSubmit}>
                <div className="form-group">
                  <label>Employee</label>
                  <select value={selectedEmployee} onChange={e => setSelectedEmployee(e.target.value)}>
                    <option value="">-- Unassigned --</option>
                    {employees.map(emp => {
                      const skill = emp.skills[assigningTask.templateId] || 'untrained';
                      let skillLabel = '';
                      if (skill === 'expert') skillLabel = ' (Expert)';
                      if (skill === 'beginner') skillLabel = ' (Beginner)';
                      if (skill === 'untrained') skillLabel = ' (Untrained ⚠️)';
                      
                      return (
                        <option key={emp.id} value={emp.id}>{emp.name}{skillLabel}</option>
                      );
                    })}
                  </select>
                </div>
                <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
                  <button type="button" className="btn" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }} onClick={handleDeleteTask}>Remove from Schedule</button>
                  <div style={{ display: 'flex', gap: '1rem' }}>
                    <button type="button" className="btn btn-secondary" onClick={() => setIsAssignModalOpen(false)}>Cancel</button>
                    <button type="submit" className="btn btn-primary">Save Assignment</button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
      
      <DragOverlay>
        {activeDragItem ? (
          activeDragItem.data.current?.type === 'generated' ? (
            <div className={`task-template task-${activeDragItem.data.current.task.groupId}`} style={{ margin: 0, opacity: 0.9, width: '280px', pointerEvents: 'none' }}>
              <GripVertical size={16} className="drag-handle-icon" />
              <div className="task-content-wrapper">
                <div className="task-title" style={{ fontSize: '0.875rem' }}>{activeDragItem.data.current.task.name}</div>
                <div className="task-meta">
                  <Clock size={12} />
                  {activeDragItem.data.current.task.duration}m
                </div>
              </div>
            </div>
          ) : activeDragItem.data.current?.type === 'scheduled' ? (
            <div className={`scheduled-task task-${activeDragItem.data.current.scheduledTask.groupId}`} style={{ 
              position: 'relative', 
              height: `${Math.max((activeDragItem.data.current.scheduledTask.duration / 60) * 80, 24)}px`,
              width: '150px',
              opacity: 0.9,
              pointerEvents: 'none'
            }}>
              <div className="task-title" style={{ fontSize: '0.875rem' }}>{activeDragItem.data.current.scheduledTask.name}</div>
            </div>
          ) : null
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
