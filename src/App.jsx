import { useState, useMemo } from 'react';
import { DndContext, useDraggable, useDroppable, pointerWithin, useSensors, useSensor, PointerSensor, DragOverlay } from '@dnd-kit/core';
import { initialEmployees, taskTemplates, runTemplates, hoursOfDay } from './data';
import { Clock, GripVertical, AlertCircle, Users, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Printer, Trash2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { format, addWeeks, subWeeks, startOfWeek, addDays, getWeek } from 'date-fns';
import TeamManagement from './TeamManagement';
import './App.css';

const HOUR_ROW_HEIGHT = 80;
const SCHEDULE_HOURS = 11;
const SNAP_MINUTES = 5;

const defaultFermentationAssignments = {
  'task-sanitation': ['emp-2'],
  'task-stickering': ['emp-2'],
  'task-boiling': ['emp-2'],
  'task-mixing': ['emp-1'],
  'task-cleanup': ['emp-1'],
};

const DIP_PROCESSING_LINE_TASK_IDS = new Set([
  'task-dip-filling',
  'task-dip-sealing',
  'task-dip-sleeves-boxes',
]);
const DIP_PROCESSING_CHANGEOVER_MINUTES = 15;

function createInitialRunSetups() {
  return Object.fromEntries(
    runTemplates.map(runTemplate => [
      runTemplate.id,
      {
        amount: '1',
        flavorCount: '1',
        defaultEmployeeId: '',
        assignments: runTemplate.id === 'run-fermentation' ? defaultFermentationAssignments : {},
      },
    ])
  );
}

function createInitialProcessSetups() {
  const processFolderRunIds = new Set(['run-veg-prep', 'run-packaging-prep']);
  const processFolderTasks = runTemplates
    .filter(runTemplate => processFolderRunIds.has(runTemplate.id))
    .flatMap(runTemplate => runTemplate.tasks);
  return Object.fromEntries(
    processFolderTasks.map(taskId => [taskId, { amount: '1', employeeIds: [] }])
  );
}

function getDurationWorkerCount(template, employeeIds = []) {
  if (!template?.maxPeopleAffectingDuration) return 1;
  const assignedCount = Math.max(1, employeeIds.length || 1);
  return Math.min(assignedCount, template.maxPeopleAffectingDuration);
}

function getTaskDuration(template, amount, employeeIds = []) {
  let duration = template.baseMinutes;
  if (template.variableMinutesPerCycle > 0) {
    const cycles = template.isBatchProcess
      ? Math.ceil(amount / template.unitsPerCycle)
      : amount / template.unitsPerCycle;
    const workerCount = getDurationWorkerCount(template, employeeIds);
    const workerSpecificVariableMinutes = template.variableMinutesPerCycleByWorkerCount?.[workerCount];
    const variableMinutes = workerSpecificVariableMinutes ?? (template.variableMinutesPerCycle / workerCount);
    duration += cycles * variableMinutes;
  }
  return Math.round(duration);
}

function getDipProcessingElapsedDuration(amount, flavorCount = 1) {
  const stationDurations = [...DIP_PROCESSING_LINE_TASK_IDS].map(taskId => {
    const template = taskTemplates.find(t => t.id === taskId);
    return template ? getTaskDuration(template, amount) : 0;
  });
  const productionMinutes = Math.max(...stationDurations);
  const changeoverMinutes = Math.max(0, Number(flavorCount) - 1) * DIP_PROCESSING_CHANGEOVER_MINUTES;
  return Math.round(productionMinutes + changeoverMinutes);
}

function getRunTaskDuration(runTemplate, taskId, amount, flavorCount = 1, employeeIds = []) {
  if (runTemplate?.id === 'run-dip-processing' && DIP_PROCESSING_LINE_TASK_IDS.has(taskId)) {
    return getDipProcessingElapsedDuration(amount, flavorCount);
  }

  const template = taskTemplates.find(t => t.id === taskId);
  if (!template) return 0;
  const taskAmount = getTaskAmountForRun(taskId, amount, flavorCount);
  return getTaskDuration(template, taskAmount, employeeIds);
}

function getRunConfiguredDuration(runTemplate, amount, flavorCount = 1, assignments = {}) {
  if (runTemplate.id === 'run-dip-processing') {
    return getDipProcessingElapsedDuration(amount, flavorCount);
  }

  return runTemplate.tasks.reduce((sum, taskId) => {
    const taskAmount = getTaskAmountForRun(taskId, amount, flavorCount);
    return sum + getRunTaskDuration(runTemplate, taskId, taskAmount, flavorCount, assignments[taskId] || []);
  }, 0);
}

function formatDuration(minutes) {
  const roundedMinutes = Math.round(minutes);
  const hours = Math.floor(roundedMinutes / 60);
  const remainingMinutes = roundedMinutes % 60;

  if (hours === 0) return `${remainingMinutes}m`;
  if (remainingMinutes === 0) return `${hours}h`;
  return `${hours}h ${remainingMinutes}m`;
}

const singularUnits = {
  bags: 'bag',
  batches: 'batch',
  bins: 'bin',
  blocks: 'block',
  boxes: 'box',
  buckets: 'bucket',
  cases: 'case',
  changeovers: 'changeover',
  containers: 'container',
  inspections: 'inspection',
  lids: 'lid',
  pans: 'pan',
  'prep sets': 'prep set',
  racks: 'rack',
  runs: 'run',
};

function getDisplayUnit(amount, unitName) {
  return Number(amount) === 1 ? (singularUnits[unitName] || unitName) : unitName;
}

function formatAmountLabel(amount, unitName) {
  return `${amount} ${getDisplayUnit(amount, unitName)}`;
}

function formatTime(hour, min = 0) {
  const normalizedHour = hour % 24;
  const h = normalizedHour > 12 ? normalizedHour - 12 : normalizedHour || 12;
  const m = Math.round(min).toString().padStart(2, '0');
  const ampm = normalizedHour >= 12 ? 'PM' : 'AM';
  return `${h}:${m} ${ampm}`;
}

function getTaskTimeRange(task) {
  const endTotalMins = (task.startHour * 60) + (task.startMinute || 0) + task.duration;
  const endHour = Math.floor(endTotalMins / 60);
  const endMin = endTotalMins % 60;
  return `${formatTime(task.startHour, task.startMinute || 0)} - ${formatTime(endHour, endMin)}`;
}

function getDropTimeFromDrag(active, over) {
  if (!active?.rect?.current?.translated || !over?.rect) return null;

  const dropY = active.rect.current.translated.top - over.rect.top;
  const maxY = SCHEDULE_HOURS * HOUR_ROW_HEIGHT - 20;
  const clampedY = Math.max(0, Math.min(dropY, maxY));
  const totalMinutes = (clampedY / HOUR_ROW_HEIGHT) * 60;
  const snappedTotalMinutes = Math.round(totalMinutes / SNAP_MINUTES) * SNAP_MINUTES;
  const startHour = 7 + Math.floor(snappedTotalMinutes / 60);
  const startMinute = snappedTotalMinutes % 60;

  return {
    startHour,
    startMinute,
    top: (snappedTotalMinutes / 60) * HOUR_ROW_HEIGHT,
  };
}

function getTaskAmountForRun(taskId, amount, flavorCount = 1) {
  if (
    taskId === 'task-flavor-changeover'
    || taskId === 'task-cheese-changeover'
  ) {
    return Math.max(0, Number(flavorCount) - 1);
  }
  return amount;
}

function hasFlavorCountField(runTemplateId) {
  return runTemplateId === 'run-dip-processing'
    || runTemplateId === 'run-dip-mixing'
    || runTemplateId === 'run-cheese-mixing';
}

function hasDefaultEmployeeField(runTemplateId) {
  return runTemplateId === 'run-dip-mixing';
}

function getRunDisplayName(runTemplate, inputAmount, inputUnit, fallbackName = 'Production Run') {
  return `${runTemplate?.name || fallbackName} (${formatAmountLabel(inputAmount, inputUnit)})`;
}

function addMinutesToStart(startHour, startMinute, minutesToAdd) {
  const totalMinutes = startHour * 60 + startMinute + minutesToAdd;
  return {
    startHour: Math.floor(totalMinutes / 60),
    startMinute: totalMinutes % 60,
  };
}

function getSequentialLayout(runTemplate, amount, flavorCount = 1) {
  let offset = 0;
  return Object.fromEntries(runTemplate.tasks.map(taskId => {
    const taskAmount = getTaskAmountForRun(taskId, amount, flavorCount);
    const currentOffset = offset;
    offset += getRunTaskDuration(runTemplate, taskId, taskAmount, flavorCount);
    return [taskId, currentOffset];
  }));
}

function getRunLayout(runTemplate, amount, flavorCount = 1) {
  if (runTemplate.id === 'run-dip-processing') {
    return Object.fromEntries(runTemplate.tasks.map(taskId => [taskId, 0]));
  }

  if (runTemplate.id !== 'run-fermentation') {
    return getSequentialLayout(runTemplate, amount, flavorCount);
  }

  const durationByTaskId = Object.fromEntries(
    runTemplate.tasks.map(taskId => {
      const template = taskTemplates.find(t => t.id === taskId);
      return [taskId, template ? getTaskDuration(template, amount) : 0];
    })
  );

  const sanitationDuration = durationByTaskId['task-sanitation'] || 0;
  const stickeringDuration = durationByTaskId['task-stickering'] || 0;
  const boilingDuration = durationByTaskId['task-boiling'] || 0;
  const mixingDuration = durationByTaskId['task-mixing'] || 0;
  const boilStartOffset = sanitationDuration + stickeringDuration;
  const mixingStartOffset = boilStartOffset + 4;
  const cleanupStartOffset = Math.max(
    boilStartOffset + boilingDuration,
    mixingStartOffset + Math.max(0, mixingDuration - 91)
  );

  return {
    'task-sanitation': 0,
    'task-stickering': sanitationDuration,
    'task-boiling': boilStartOffset,
    'task-mixing': mixingStartOffset,
    'task-cleanup': cleanupStartOffset,
  };
}

function toggleEmployeeId(employeeIds = [], employeeId, maxSelections = Infinity) {
  if (!employeeId) return employeeIds;
  if (employeeIds.includes(employeeId)) {
    return employeeIds.filter(id => id !== employeeId);
  }
  return [...employeeIds, employeeId].slice(-maxSelections);
}

// Draggable Sidebar Item (Full Run Template)
function DraggableRunTemplate({
  runTemplate,
  taskTemplates,
  employees,
  amount,
  flavorCount,
  defaultEmployeeId,
  assignments,
  isExpanded,
  onToggle,
  onAmountChange,
  onFlavorCountChange,
  onDefaultEmployeeChange,
  onAssignmentChange,
}) {
  const parsedAmount = Math.max(1, Number(amount) || 1);
  const parsedFlavorCount = Math.max(1, Number(flavorCount) || 1);
  const changeovers = Math.max(0, parsedFlavorCount - 1);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `run-template-${runTemplate.id}`,
    data: {
      type: 'run-template',
      runTemplate,
      inputAmount: parsedAmount,
      flavorCount: parsedFlavorCount,
      defaultEmployeeId,
      assignments,
    },
  });

  const totalConfiguredMinutes = getRunConfiguredDuration(
    runTemplate,
    parsedAmount,
    parsedFlavorCount,
    assignments
  );
  const durationLabel = runTemplate.id === 'run-dip-processing' ? 'line time' : 'total work';

  return (
    <div className="run-setup-card">
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        className={`task-template task-${runTemplate.groupId}`}
        style={{ opacity: isDragging ? 0.5 : 1, marginBottom: 0, touchAction: 'none' }}
        onClick={onToggle}
      >
        <div className="run-drag-handle" aria-hidden="true">
          <GripVertical size={16} className="drag-handle-icon" />
        </div>
        <div className="task-content-wrapper">
          <div className="task-title" style={{ fontSize: '0.875rem' }}>{runTemplate.name}</div>
          <div className="task-meta">
            <Clock size={12} />
            {formatAmountLabel(parsedAmount, runTemplate.inputUnit)}, {formatDuration(totalConfiguredMinutes)} {durationLabel}
          </div>
        </div>
        <ChevronDown size={16} className={`run-expand-icon ${isExpanded ? 'is-expanded' : ''}`} />
      </div>

      {isExpanded && (
      <div className="run-setup-controls">
        <label className="compact-field">
          <span>{getDisplayUnit(parsedAmount, runTemplate.inputUnit)}</span>
          <input
            type="number"
            min="1"
            value={amount}
            onChange={e => onAmountChange(e.target.value)}
          />
        </label>

        {hasFlavorCountField(runTemplate.id) && (
          <label className="compact-field">
            <span>Flavours</span>
            <input
              type="number"
              min="1"
              value={flavorCount}
              onChange={e => onFlavorCountChange(e.target.value)}
            />
            <small>{formatAmountLabel(changeovers, 'changeovers')}</small>
          </label>
        )}

        {hasDefaultEmployeeField(runTemplate.id) && (
          <div className="run-assignment-row">
            <label className="run-assignment-name" htmlFor={`${runTemplate.id}-default-employee`}>Main employee</label>
            <select
              id={`${runTemplate.id}-default-employee`}
              value={defaultEmployeeId || ''}
              onChange={e => onDefaultEmployeeChange(e.target.value)}
            >
              <option value="">Unassigned</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>{emp.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="run-assignment-list">
          {runTemplate.tasks.map(taskId => {
            const task = taskTemplates.find(t => t.id === taskId);
            if (!task) return null;
            const overrideEmployeeId = (assignments[taskId] || [])[0] || '';
            const defaultEmployee = employees.find(emp => emp.id === defaultEmployeeId);
            const defaultOptionLabel = defaultEmployee
              ? `Use main employee (${defaultEmployee.name})`
              : 'Use main employee';

            return (
              <div key={taskId} className="run-assignment-row">
                <label className="run-assignment-name" htmlFor={`${runTemplate.id}-${taskId}-employee`}>{task.name}</label>
                <select
                  id={`${runTemplate.id}-${taskId}-employee`}
                  value={overrideEmployeeId}
                  onChange={e => onAssignmentChange(taskId, e.target.value)}
                >
                  {hasDefaultEmployeeField(runTemplate.id) ? (
                    <option value="">{defaultOptionLabel}</option>
                  ) : (
                    <option value="">Unassigned</option>
                  )}
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </div>
      )}
    </div>
  );
}

function DraggableProcessTemplate({
  task,
  employees,
  amount,
  employeeIds,
  onAmountChange,
  onEmployeeToggle,
}) {
  const parsedAmount = Math.max(1, Number(amount) || 1);
  const selectedEmployeeIds = employeeIds || [];
  const maxSelections = task.maxPeopleAffectingDuration || 1;
  const duration = getTaskDuration(task, parsedAmount, selectedEmployeeIds);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `task-template-${task.id}`,
    data: {
      type: 'task-template',
      taskTemplate: task,
      inputAmount: parsedAmount,
      employeeIds: selectedEmployeeIds,
    },
  });

  return (
    <div className="process-setup-row">
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        className={`task-template task-${task.groupId} process-task-card`}
        style={{ opacity: isDragging ? 0.5 : 1, marginBottom: 0, touchAction: 'none' }}
      >
        <div className="run-drag-handle" aria-hidden="true">
          <GripVertical size={16} className="drag-handle-icon" />
        </div>
        <div className="task-content-wrapper">
          <div className="task-title" style={{ fontSize: '0.825rem' }}>{task.name}</div>
          <div className="task-meta">
            <Clock size={12} />
            {formatAmountLabel(parsedAmount, task.unitName)}, {formatDuration(duration)}
          </div>
        </div>
      </div>
      <div className="process-setup-controls">
        <label className="compact-field process-amount-field">
          <span>{getDisplayUnit(parsedAmount, task.unitName)}</span>
          <input
            type="number"
            min="1"
            value={amount}
            onChange={e => onAmountChange(e.target.value)}
          />
        </label>
        {maxSelections > 1 ? (
          <div className="mini-checkbox-list" aria-label={`${task.name} people`}>
            {employees.map(emp => (
              <label key={emp.id} className="mini-checkbox-row">
                <input
                  type="checkbox"
                  checked={selectedEmployeeIds.includes(emp.id)}
                  onChange={() => onEmployeeToggle(emp.id, maxSelections)}
                />
                <span>{emp.name}</span>
              </label>
            ))}
          </div>
        ) : (
          <select
            value={selectedEmployeeIds[0] || ''}
            onChange={e => onEmployeeToggle(e.target.value, maxSelections)}
            aria-label={`${task.name} person`}
          >
            <option value="">Unassigned</option>
            {employees.map(emp => (
              <option key={emp.id} value={emp.id}>{emp.name}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

function ProcessFolder({
  runTemplate,
  taskTemplates,
  employees,
  processSetups,
  isExpanded,
  onToggle,
  onAmountChange,
  onEmployeeToggle,
}) {
  return (
    <div className="run-setup-card">
      <button
        type="button"
        className={`task-template task-${runTemplate.groupId} run-folder-button`}
        onClick={onToggle}
      >
        <div className="task-content-wrapper">
          <div className="task-title" style={{ fontSize: '0.875rem' }}>{runTemplate.name}</div>
          <div className="task-meta">
            <Clock size={12} />
            Separate process cards
          </div>
        </div>
        <ChevronDown size={16} className={`run-expand-icon ${isExpanded ? 'is-expanded' : ''}`} />
      </button>

      {isExpanded && (
        <div className="run-setup-controls process-folder-controls">
          {runTemplate.tasks.map(taskId => {
            const task = taskTemplates.find(t => t.id === taskId);
            if (!task) return null;
            const setup = processSetups[taskId] || { amount: '1', employeeIds: [] };

            return (
              <DraggableProcessTemplate
                key={taskId}
                task={task}
                employees={employees}
                amount={setup.amount}
                employeeIds={setup.employeeIds || []}
                onAmountChange={amount => onAmountChange(taskId, amount)}
                onEmployeeToggle={(employeeId, maxSelections) => onEmployeeToggle(taskId, employeeId, maxSelections)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function DropTimeHint({ hint }) {
  if (!hint) return null;

  return (
    <div className="drop-time-hint" style={{ top: `${hint.top}px` }}>
      <span>{formatTime(hint.startHour, hint.startMinute)}</span>
    </div>
  );
}

// Droppable Schedule Slot (Full Day)
function DroppableDay({ dateStr, dragTimeHint, children }) {
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
      <DropTimeHint hint={dragTimeHint?.dateStr === dateStr ? dragTimeHint : null} />
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

function PrintWeekSchedule({
  weekDays,
  currentWeekNumber,
  weekStartStr,
  weekEndStr,
  scheduledTasks,
  employees,
  activeRuns,
}) {
  const getAssignedEmployeeNames = (task) => {
    const employeeIds = task.employeeIds || (task.employeeId ? [task.employeeId] : []);
    const names = employeeIds
      .map(employeeId => employees.find(e => e.id === employeeId)?.name)
      .filter(Boolean);
    return names.length > 0 ? names.join(', ') : 'Unassigned';
  };

  const getRunName = (task) => {
    const run = activeRuns.find(item => item.id === task.runId);
    return run?.name || 'Single process';
  };

  const getSortedTasksForDay = (dayId) => scheduledTasks
    .filter(task => task.dateStr === dayId)
    .sort((a, b) => {
      const startA = (a.startHour * 60) + (a.startMinute || 0);
      const startB = (b.startHour * 60) + (b.startMinute || 0);
      return startA - startB;
    });

  return (
    <section className="print-week">
      <header className="print-week-header">
        <div>
          <h1>Millsie Production Schedule</h1>
          <p>Week {currentWeekNumber} - {weekStartStr} to {weekEndStr}</p>
        </div>
        <div className="print-generated">Printed {format(new Date(), 'MMM d, yyyy h:mm a')}</div>
      </header>

      <div className="print-day-list">
        {weekDays.map(day => {
          const dayTasks = getSortedTasksForDay(day.id);

          return (
            <section key={day.id} className="print-day">
              <div className="print-day-title">
                <h2>{day.name}</h2>
                <span>{day.formattedDate}</span>
              </div>

              {dayTasks.length === 0 ? (
                <div className="print-empty-day">No scheduled production.</div>
              ) : (
                <table className="print-task-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Process</th>
                      <th>Amount</th>
                      <th>Work Time</th>
                      <th>Employee</th>
                      <th>Run</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayTasks.map(task => (
                      <tr key={task.id}>
                        <td>{getTaskTimeRange(task)}</td>
                        <td>{task.name}</td>
                        <td>{task.inputAmount ? formatAmountLabel(task.inputAmount, task.inputUnit) : '-'}</td>
                        <td>{formatDuration(task.duration)}</td>
                        <td>{getAssignedEmployeeNames(task)}</td>
                        <td>{getRunName(task)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}

// Scheduled Task Block on Grid
function ScheduledTaskBlock({ scheduledTask, employees, onClick, layout }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `scheduled-${scheduledTask.id}`,
    data: { type: 'scheduled', scheduledTask },
  });

  const assignedEmployees = (scheduledTask.employeeIds || (scheduledTask.employeeId ? [scheduledTask.employeeId] : []))
    .map(employeeId => employees.find(e => e.id === employeeId))
    .filter(Boolean);
  const hasUntrainedEmployee = assignedEmployees.some(emp => (emp.skills[scheduledTask.templateId] || 'untrained') === 'untrained');
  
  const height = Math.max((scheduledTask.duration / 60) * 80, 24);
  const startMins = (scheduledTask.startHour - 7) * 60 + (scheduledTask.startMinute || 0);
  const top = (startMins / 60) * 80;

  const leftPercent = layout ? layout.left : 0;
  const widthPercent = layout ? layout.width : 100;

  const timeString = getTaskTimeRange(scheduledTask);

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
        {scheduledTask.inputAmount ? `${formatAmountLabel(scheduledTask.inputAmount, scheduledTask.inputUnit)} - ` : ''}{timeString} ({formatDuration(scheduledTask.duration)})
      </div>
      {assignedEmployees.length > 0 ? (
        <div className="task-meta">
          <Users size={12} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{assignedEmployees.map(emp => emp.name).join(', ')}</span>
          {hasUntrainedEmployee && <AlertCircle size={12} color="var(--danger)" style={{ flexShrink: 0 }} />}
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
  const [employees, setEmployees] = useState(initialEmployees);
  const [currentView, setCurrentView] = useState('schedule');
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
  const weekDayIds = useMemo(() => new Set(weekDays.map(day => day.id)), [weekDays]);

  const currentWeekNumber = getWeek(currentDate, { weekStartsOn: 1 });
  const weekStartStr = weekDays[0].formattedDate;
  const weekEndStr = weekDays[4].formattedDate;
  
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [assigningTask, setAssigningTask] = useState(null);
  const [selectedEmployees, setSelectedEmployees] = useState([]);
  const [selectedRunAmount, setSelectedRunAmount] = useState('1');
  const [runSetups, setRunSetups] = useState(() => createInitialRunSetups());
  const [processSetups, setProcessSetups] = useState(() => createInitialProcessSetups());
  const [expandedRunId, setExpandedRunId] = useState(null);

  const [activeDragItem, setActiveDragItem] = useState(null);
  const [dragTimeHint, setDragTimeHint] = useState(null);
  const visibleWeekTaskCount = scheduledTasks.filter(task => weekDayIds.has(task.dateStr)).length;

  const handleRunSetupAmountChange = (runTemplateId, amount) => {
    setRunSetups(prev => ({
      ...prev,
      [runTemplateId]: {
        ...(prev[runTemplateId] || { assignments: {} }),
        amount,
      },
    }));
  };

  const handleRunSetupFlavorCountChange = (runTemplateId, flavorCount) => {
    setRunSetups(prev => ({
      ...prev,
      [runTemplateId]: {
        ...(prev[runTemplateId] || { amount: '1', assignments: {} }),
        flavorCount,
      },
    }));
  };

  const handleRunSetupDefaultEmployeeChange = (runTemplateId, defaultEmployeeId) => {
    setRunSetups(prev => ({
      ...prev,
      [runTemplateId]: {
        ...(prev[runTemplateId] || { amount: '1', assignments: {} }),
        defaultEmployeeId,
      },
    }));
  };

  const handleRunSetupAssignmentChange = (runTemplateId, taskId, employeeId) => {
    setRunSetups(prev => {
      const runSetup = prev[runTemplateId] || { amount: '1', assignments: {} };
      return {
        ...prev,
        [runTemplateId]: {
          ...runSetup,
          assignments: {
            ...runSetup.assignments,
            [taskId]: employeeId ? [employeeId] : [],
          },
        },
      };
    });
  };

  const handleProcessAmountChange = (taskId, amount) => {
    setProcessSetups(prev => ({
      ...prev,
      [taskId]: {
        ...(prev[taskId] || { employeeIds: [] }),
        amount,
      },
    }));
  };

  const handleProcessEmployeeToggle = (taskId, employeeId, maxSelections = 1) => {
    setProcessSetups(prev => {
      const setup = prev[taskId] || { amount: '1', employeeIds: [] };
      const employeeIds = maxSelections > 1
        ? toggleEmployeeId(setup.employeeIds || [], employeeId, maxSelections)
        : (employeeId ? [employeeId] : []);

      return {
        ...prev,
        [taskId]: {
          ...setup,
          employeeIds,
        },
      };
    });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  const handleDragStart = (event) => {
    setActiveDragItem(event.active);
    setDragTimeHint(null);
  };

  const handleDragMove = (event) => {
    const { active, over } = event;
    if (!over?.id?.startsWith('day-')) {
      setDragTimeHint(null);
      return;
    }

    const dropTime = getDropTimeFromDrag(active, over);
    if (!dropTime) {
      setDragTimeHint(null);
      return;
    }

    setDragTimeHint({
      dateStr: over.data.current.dateStr,
      ...dropTime,
    });
  };

  const handleDragEnd = (event) => {
    setActiveDragItem(null);
    setDragTimeHint(null);
    const { active, over } = event;
    if (!over) return;

    if (over.id.startsWith('day-')) {
      const { dateStr } = over.data.current;

      // Calculate precision drop time based on Y offset.
      const dropTime = getDropTimeFromDrag(active, over);
      if (!dropTime) return;
      const { startHour, startMinute } = dropTime;

      if (active.data.current?.type === 'run-template') {
        const runTemplate = active.data.current.runTemplate;
        const runId = uuidv4();
        const inputAmount = Math.max(1, Number(active.data.current.inputAmount) || 1);
        const flavorCount = Math.max(1, Number(active.data.current.flavorCount) || 1);
        const defaultEmployeeId = active.data.current.defaultEmployeeId || '';
        const assignments = active.data.current.assignments || {};
        const layoutOffsets = getRunLayout(runTemplate, inputAmount, flavorCount);

        const newTasks = runTemplate.tasks.map(taskId => {
          const template = taskTemplates.find(t => t.id === taskId);
          if (!template) return null;

          const taskAmount = getTaskAmountForRun(taskId, inputAmount, flavorCount);
          if (taskAmount <= 0) return null;

          const taskStart = addMinutesToStart(startHour, startMinute, layoutOffsets[taskId] || 0);
          const employeeIds = assignments[template.id] || (defaultEmployeeId ? [defaultEmployeeId] : []);
          const duration = getRunTaskDuration(runTemplate, taskId, inputAmount, flavorCount, employeeIds);

          return {
            id: uuidv4(),
            runId,
            templateId: template.id,
            groupId: template.groupId,
            name: template.name,
            dateStr,
            startHour: taskStart.startHour,
            startMinute: taskStart.startMinute,
            duration,
            employeeIds,
            inputAmount: taskAmount,
            inputUnit: template.unitName,
            buckets: taskAmount,
          };
        }).filter(Boolean);

        setScheduledTasks(prev => [...prev, ...newTasks]);
        setActiveRuns(prev => [...prev, {
          id: runId,
          templateId: runTemplate.id,
          inputAmount,
          flavorCount,
          defaultEmployeeId,
          name: getRunDisplayName(runTemplate, inputAmount, runTemplate.inputUnit),
          groupId: runTemplate.groupId,
          inputUnit: runTemplate.inputUnit,
          buckets: inputAmount,
        }]);
      }

      if (active.data.current?.type === 'task-template') {
        const template = active.data.current.taskTemplate;
        const runId = uuidv4();
        const inputAmount = Math.max(1, Number(active.data.current.inputAmount) || 1);
        const inputUnit = template.unitName;
        const employeeIds = active.data.current.employeeIds || [];
        const duration = getTaskDuration(template, inputAmount, employeeIds);

        setScheduledTasks(prev => [...prev, {
          id: uuidv4(),
          runId,
          templateId: template.id,
          groupId: template.groupId,
          name: template.name,
          dateStr,
          startHour,
          startMinute,
          duration,
          employeeIds,
          inputAmount,
          inputUnit,
          buckets: inputAmount,
        }]);
        setActiveRuns(prev => [...prev, {
          id: runId,
          templateId: null,
          inputAmount,
          inputUnit,
          baseName: template.name,
          name: getRunDisplayName(null, inputAmount, inputUnit, template.name),
          groupId: template.groupId,
          buckets: inputAmount,
        }]);
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

  const handleAssignSubmit = (e) => {
    e.preventDefault();
    if (!assigningTask) return;

    const inputAmount = Math.max(1, Number(selectedRunAmount) || 1);
    const activeRun = activeRuns.find(r => r.id === assigningTask.runId);
    const runTemplate = runTemplates.find(rt => rt.id === activeRun?.templateId);
    const inputUnit = runTemplate?.inputUnit || assigningTask.inputUnit || activeRun?.inputUnit || 'units';

    setActiveRuns(prev => prev.map(run => run.id === assigningTask.runId
      ? {
          ...run,
          inputAmount,
          inputUnit,
          buckets: inputAmount,
          name: getRunDisplayName(runTemplate, inputAmount, inputUnit, run.baseName || assigningTask.name),
        }
      : run
    ));

    setScheduledTasks(prev => {
      const runTasks = prev
        .filter(t => t.runId === assigningTask.runId)
        .sort((a, b) => {
          const aIndex = runTemplate?.tasks.indexOf(a.templateId) ?? 0;
          const bIndex = runTemplate?.tasks.indexOf(b.templateId) ?? 0;
          return aIndex - bIndex;
        });

      const firstTask = runTasks[0];
      const updates = new Map();
      const flavorCount = activeRun?.flavorCount || 1;
      const layoutOffsets = runTemplate ? getRunLayout(runTemplate, inputAmount, flavorCount) : {};

      runTasks.forEach(t => {
        const template = taskTemplates.find(tt => tt.id === t.templateId);
        const taskAmount = getTaskAmountForRun(t.templateId, inputAmount, flavorCount);
        const employeeIds = t.id === assigningTask.id ? selectedEmployees : (t.employeeIds || []);
        const duration = template ? getRunTaskDuration(runTemplate, t.templateId, inputAmount, flavorCount, employeeIds) : t.duration;
        const taskStart = firstTask
          ? addMinutesToStart(firstTask.startHour, firstTask.startMinute || 0, layoutOffsets[t.templateId] || 0)
          : { startHour: t.startHour, startMinute: t.startMinute || 0 };

        updates.set(t.id, {
          ...t,
          dateStr: firstTask?.dateStr || t.dateStr,
          startHour: taskStart.startHour,
          startMinute: taskStart.startMinute,
          inputAmount: taskAmount,
          inputUnit: template?.unitName || inputUnit,
          buckets: taskAmount,
          duration,
          employeeIds,
        });
      });

      return prev.map(t => updates.get(t.id) || t);
    });

    setIsAssignModalOpen(false);
    setAssigningTask(null);
  };

  const handleDeleteTask = () => {
    if (!assigningTask) return;

    setScheduledTasks(prev => prev.filter(t => t.id !== assigningTask.id));
    setActiveRuns(prev => prev.filter(run => (
      run.id !== assigningTask.runId || scheduledTasks.some(t => t.runId === run.id && t.id !== assigningTask.id)
    )));

    setIsAssignModalOpen(false);
    setAssigningTask(null);
  };

  const handleClearWeek = () => {
    if (visibleWeekTaskCount === 0) return;
    if (!window.confirm(`Clear all ${visibleWeekTaskCount} scheduled process blocks from this week?`)) return;

    const remainingTasks = scheduledTasks.filter(task => !weekDayIds.has(task.dateStr));
    const remainingRunIds = new Set(remainingTasks.map(task => task.runId));

    setScheduledTasks(remainingTasks);
    setActiveRuns(prev => prev.filter(run => remainingRunIds.has(run.id)));

    if (assigningTask && weekDayIds.has(assigningTask.dateStr)) {
      setIsAssignModalOpen(false);
      setAssigningTask(null);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveDragItem(null);
        setDragTimeHint(null);
      }}
      collisionDetection={pointerWithin}
    >
      <div className="app-layout">
        <div className="sidebar-panel">
          <div className="sidebar-header" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <h2 style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>Millsie Scheduling</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Production Control</p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button 
                className={`btn ${currentView === 'schedule' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1, padding: '0.5rem', fontSize: '0.875rem' }}
                onClick={() => setCurrentView('schedule')}
              >
                Schedule
              </button>
              <button 
                className={`btn ${currentView === 'team' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1, padding: '0.5rem', fontSize: '0.875rem' }}
                onClick={() => setCurrentView('team')}
              >
                Team
              </button>
            </div>
            </div>
          
          {currentView === 'schedule' && (
            <div className="sidebar-content" style={{ padding: '1rem' }}>
              <div>
                <div className="section-title">Run Blocks</div>
                {runTemplates.map(runTemplate => {
                  const runSetup = runSetups[runTemplate.id] || { amount: '1', assignments: {} };
                  if (runTemplate.id === 'run-veg-prep' || runTemplate.id === 'run-packaging-prep') {
                    return (
                      <ProcessFolder
                        key={runTemplate.id}
                        runTemplate={runTemplate}
                        taskTemplates={taskTemplates}
                        employees={employees}
                        processSetups={processSetups}
                        isExpanded={expandedRunId === runTemplate.id}
                        onToggle={() => setExpandedRunId(prev => prev === runTemplate.id ? null : runTemplate.id)}
                        onAmountChange={handleProcessAmountChange}
                        onEmployeeToggle={handleProcessEmployeeToggle}
                      />
                    );
                  }

                  return (
                    <DraggableRunTemplate
                      key={runTemplate.id}
                      runTemplate={runTemplate}
                      taskTemplates={taskTemplates}
                      employees={employees}
                      amount={runSetup.amount}
                      flavorCount={runSetup.flavorCount || '1'}
                      defaultEmployeeId={runSetup.defaultEmployeeId || ''}
                      assignments={runSetup.assignments}
                      isExpanded={expandedRunId === runTemplate.id}
                      onToggle={() => setExpandedRunId(prev => prev === runTemplate.id ? null : runTemplate.id)}
                      onAmountChange={amount => handleRunSetupAmountChange(runTemplate.id, amount)}
                      onFlavorCountChange={flavorCount => handleRunSetupFlavorCountChange(runTemplate.id, flavorCount)}
                      onDefaultEmployeeChange={employeeId => handleRunSetupDefaultEmployeeChange(runTemplate.id, employeeId)}
                      onAssignmentChange={(taskId, employeeId) => handleRunSetupAssignmentChange(runTemplate.id, taskId, employeeId)}
                    />
                  );
                })}
              </div>

              <div style={{ marginTop: '2rem' }}>
                <div className="section-title">Scheduled Runs</div>
                {activeRuns.length === 0 && (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', textAlign: 'center', padding: '2rem 0' }}>
                    Drag a run block onto the schedule.
                  </div>
                )}
                {activeRuns.map(run => (
                  <div key={run.id} className="task-group">
                    <div className="task-group-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>{run.name}</span>
                      <div style={{ display: 'flex', gap: '4px' }}>
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
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {scheduledTasks.filter(t => t.runId === run.id).length} process blocks on the calendar
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {currentView === 'schedule' ? (
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
              <button className="btn btn-secondary print-week-button" onClick={() => window.print()}>
                <Printer size={16} />
                Print Week
              </button>
              <button
                className="btn btn-danger clear-week-button"
                disabled={visibleWeekTaskCount === 0}
                onClick={handleClearWeek}
                title="Clear scheduled blocks from this week"
              >
                <Trash2 size={16} />
                Clear Week
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
                  <DroppableDay dateStr={day.id} dragTimeHint={dragTimeHint}>
                    {layoutDayTasks(scheduledTasks.filter(t => t.dateStr === day.id)).map(result => (
                      <ScheduledTaskBlock 
                        key={result.task.id} 
                        scheduledTask={result.task} 
                        layout={result.layout}
                        employees={employees} 
                        onClick={(task) => {
                          setAssigningTask(task);
                          setSelectedEmployees(task.employeeIds || (task.employeeId ? [task.employeeId] : []));
                          setSelectedRunAmount(String(task.inputAmount || task.buckets || activeRuns.find(run => run.id === task.runId)?.inputAmount || 1));
                          setIsAssignModalOpen(true);
                        }}
                      />
                    ))}
                  </DroppableDay>
                </div>
              ))}
            </div>
          </div>

          <PrintWeekSchedule
            weekDays={weekDays}
            currentWeekNumber={currentWeekNumber}
            weekStartStr={weekStartStr}
            weekEndStr={weekEndStr}
            scheduledTasks={scheduledTasks}
            employees={employees}
            activeRuns={activeRuns}
          />
        </div>
        ) : (
          <TeamManagement 
            employees={employees} 
            setEmployees={setEmployees} 
            taskTemplates={taskTemplates} 
            runTemplates={runTemplates}
          />
        )}

        {isAssignModalOpen && assigningTask && (
          <div className="modal-overlay">
            <div className="modal-content">
              <h3>Edit Schedule</h3>
              <p style={{ marginBottom: '1rem', color: 'var(--text-muted)' }}>{assigningTask.name} ({formatDuration(assigningTask.duration)})</p>
              <form onSubmit={handleAssignSubmit}>
                <div className="form-group">
                  <label>Run amount (updates this whole run)</label>
                  <input
                    type="number"
                    min="1"
                    value={selectedRunAmount}
                    onChange={e => setSelectedRunAmount(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>People assigned to this block</label>
                  <div className="checkbox-list">
                    {employees.map(emp => {
                      const skill = emp.skills[assigningTask.templateId] || 'untrained';
                      const assignmentTemplate = taskTemplates.find(t => t.id === assigningTask.templateId);
                      const maxSelections = assignmentTemplate?.maxPeopleAffectingDuration || Infinity;
                      const isChecked = selectedEmployees.includes(emp.id);
                      const isDisabled = !isChecked && selectedEmployees.length >= maxSelections;
                      let skillLabel = '';
                      if (skill === 'expert') skillLabel = ' (Expert)';
                      if (skill === 'beginner') skillLabel = ' (Beginner)';
                      if (skill === 'untrained') skillLabel = ' (Untrained)';
                      
                      return (
                        <label key={emp.id} className="checkbox-row">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={isDisabled}
                            onChange={e => {
                              setSelectedEmployees(prev => e.target.checked
                                ? [...prev, emp.id].slice(-maxSelections)
                                : prev.filter(id => id !== emp.id)
                              );
                            }}
                          />
                          <span>{emp.name}{skillLabel}</span>
                        </label>
                      );
                    })}
                  </div>
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
          activeDragItem.data.current?.type === 'run-template' ? (
            <div className={`task-template task-${activeDragItem.data.current.runTemplate.groupId}`} style={{ margin: 0, opacity: 0.9, width: '280px', pointerEvents: 'none' }}>
              <GripVertical size={16} className="drag-handle-icon" />
              <div className="task-content-wrapper">
                <div className="task-title" style={{ fontSize: '0.875rem' }}>{activeDragItem.data.current.runTemplate.name}</div>
                <div className="task-meta">
                  <Clock size={12} />
                  Drop to split into process blocks
                </div>
              </div>
            </div>
          ) : activeDragItem.data.current?.type === 'task-template' ? (
            <div className={`task-template task-${activeDragItem.data.current.taskTemplate.groupId}`} style={{ margin: 0, opacity: 0.9, width: '260px', pointerEvents: 'none' }}>
              <GripVertical size={16} className="drag-handle-icon" />
              <div className="task-content-wrapper">
                <div className="task-title" style={{ fontSize: '0.875rem' }}>{activeDragItem.data.current.taskTemplate.name}</div>
                <div className="task-meta">
                  <Clock size={12} />
                  {formatAmountLabel(
                    activeDragItem.data.current.inputAmount,
                    activeDragItem.data.current.taskTemplate.unitName
                  )}
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
