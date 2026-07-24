import { useState, useMemo, useEffect, useRef } from 'react';
import { DndContext, useDraggable, useDroppable, pointerWithin, useSensors, useSensor, PointerSensor, DragOverlay } from '@dnd-kit/core';
import { initialEmployees, taskTemplates, runTemplates, hoursOfDay } from './data';
import { Clock, GripVertical, AlertCircle, Users, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Printer, Trash2, StickyNote } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { format, addWeeks, subWeeks, startOfWeek, addDays, getWeek } from 'date-fns';
import TeamManagement from './TeamManagement';
import { isSupabaseConfigured, supabase } from './supabase';
import './App.css';

const HOUR_ROW_HEIGHT = 80;
const SCHEDULE_HOURS = 11;
const SNAP_MINUTES = 5;
const LUNCH_START_HOUR = 12;
const LUNCH_START_MINUTE = 0;
const LUNCH_DURATION_MINUTES = 30;
const LUNCH_START_ABSOLUTE_MINUTES = (LUNCH_START_HOUR * 60) + LUNCH_START_MINUTE;
const LUNCH_END_ABSOLUTE_MINUTES = LUNCH_START_ABSOLUTE_MINUTES + LUNCH_DURATION_MINUTES;
const SCHEDULE_START_HOUR = 7;
const FERMENTATION_BOILING_START_OFFSET_MINUTES = 15;
const CHEESE_PROCESSING_STAGGER_MINUTES = 20;

const defaultFermentationAssignments = {
  'task-sanitation': ['emp-2'],
  'task-stickering': ['emp-2'],
  'task-boiling': ['emp-5', 'emp-6'],
  'task-cleanup': ['emp-5', 'emp-6'],
};

const DIP_PROCESSING_LINE_TASK_IDS = new Set([
  'task-dip-filling',
]);
const DIP_PROCESSING_CHANGEOVER_MINUTES = 10;
const DIP_PROCESSING_SETUP_CLEANUP_MINUTES = 40;
const MIXING_CHANGEOVER_MINUTES = 10;
const MIXING_CHANGEOVER_TASK_IDS = new Set([
  'task-cheese-mixing',
  'task-dip-mixing',
]);
const MIXING_TASK_IDS = new Set([
  'task-cheese-mixing',
  'task-dip-mixing',
  'task-sauce-mixing',
]);
const CONTINUOUS_ACROSS_LUNCH_TASK_IDS = new Set([
  'task-dip-filling',
  'task-sauce-filling',
]);
const DAY_END_ABSOLUTE_MINUTES = 17 * 60;
const SCHEDULER_WORKSPACE_ID = 'millsie-production';
const SHARED_SCHEDULER_EMAIL = 'admin@millsie.com';
const DAILY_DUTY_BLOCKS = [
  {
    idPrefix: 'opening-duties',
    taskId: 'task-opening-duties',
    startHour: 8,
    startMinute: 0,
    notes: 'Sinks, tables, sanitizer bottles, dry dishes, clean cloths, high-touch surfaces, carts.',
  },
  {
    idPrefix: 'closing-duties',
    taskId: 'task-closing-duties',
    startHour: 15,
    startMinute: 45,
    notes: 'Post-op cleaning plus garbage, recycling, cardboard, organics, and general waste.',
  },
];
const DEFAULT_AVAILABILITY = {
  isWorking: true,
  start: '08:00',
  end: '16:30',
  lunchMinutes: 30,
};
const EMPLOYEE_SHIFT_OVERRIDES = {
  Khemika: {
    start: '07:00',
    end: '17:00',
    daysOff: new Set(['Friday']),
  },
  Cecilia: {
    start: '08:30',
    end: '17:00',
  },
};
const EMPLOYEE_COLOR_FALLBACKS = ['#EB4213', '#FF99DC', '#826DEE', '#D8F382', '#00C2A8', '#FFB000', '#3A86FF', '#F97316'];
const TASK_GROUP_LAYOUT_ORDER = [
  'ferment-prep',
  'cheese-processing',
  'dip-processing',
  'dip-mixing',
  'veg-prep',
  'packaging-prep',
  'sanitation',
  'misc-work',
];
const CHEESE_CASES_PER_BATCH_BY_FLAVOR = {
  Smoke: 27.5,
  Delight: 26.4,
  Nigella: 27.1,
  Meadow: 24.4,
  Classic: 25.9,
};
const CHEESE_CASES_PER_RACK = 50;
const CHEESE_BATCH_CONVERTIBLE_TASK_IDS = new Set([
  'task-cheese-dipping',
  'task-cheese-sealing',
]);
const CHEESE_BATCH_SHARED_TASK_IDS = new Set([
  'task-cheese-slicing',
  'task-cheese-dipping',
  'task-cheese-sealing',
  'task-cheese-packing',
]);
const TAPE_CASES_TASK_ID = 'task-tape-boxes';
const CASES_PER_TAPE_BUNDLE = 25;
const TAPE_CASES_PER_PALLET_BY_UNIT_MODE = {
  cheesePallets: 84 * CASES_PER_TAPE_BUNDLE,
  dipPallets: 56 * CASES_PER_TAPE_BUNDLE,
};
const DEFAULT_CHEESE_FLAVORS = [{ id: 'cheese-flavor-1', flavor: 'Smoke', batches: '1', lotCode: '' }];
const ASSUMPTION_FLAG_TASK_IDS = new Set([
  TAPE_CASES_TASK_ID,
  'task-cheese-dipping',
  'task-cheese-sealing',
  'task-cheese-packing',
]);

function createInitialRunSetups() {
  return Object.fromEntries(
    runTemplates.map(runTemplate => [
      runTemplate.id,
      {
        amount: '1',
        flavorCount: '1',
        cheeseFlavor: 'Smoke',
        cheeseFlavors: runTemplate.id === 'run-cheese-processing' ? DEFAULT_CHEESE_FLAVORS : undefined,
        defaultEmployeeId: '',
        assignments: runTemplate.id === 'run-fermentation' ? defaultFermentationAssignments : {},
        prepAheadTaskIds: [],
      },
    ])
  );
}

function createInitialProcessSetups() {
  const processFolderRunIds = new Set([
    'run-dip-mixing',
    'run-dip-processing',
    'run-veg-prep',
    'run-packaging-prep',
    'run-support',
  ]);
  const processFolderTasks = runTemplates
    .filter(runTemplate => processFolderRunIds.has(runTemplate.id))
    .flatMap(runTemplate => runTemplate.tasks);
  return Object.fromEntries(
    processFolderTasks.map(taskId => [taskId, {
      amount: '1',
      flavorCount: '1',
      unitMode: taskId === TAPE_CASES_TASK_ID ? 'cases' : 'racks',
      cheeseFlavor: 'Smoke',
      employeeIds: [],
      prepAhead: false,
    }])
  );
}

function createDailyDutyTask(dayId, duty) {
  const template = taskTemplates.find(task => task.id === duty.taskId);
  if (!template) return null;

  return {
    id: `${duty.idPrefix}-${dayId}`,
    runId: `${duty.idPrefix}-run-${dayId}`,
    templateId: template.id,
    groupId: template.groupId,
    name: template.name,
    dateStr: dayId,
    startHour: duty.startHour,
    startMinute: duty.startMinute,
    duration: getTaskDuration(template, 1),
    employeeIds: [],
    inputAmount: 1,
    inputUnit: template.unitName,
    buckets: 1,
    notes: duty.notes,
    isAutomaticDaily: true,
  };
}

function normalizeDailyDutyTask(task) {
  if (!task?.isAutomaticDaily) return task;
  const duty = DAILY_DUTY_BLOCKS.find(item => item.taskId === task.templateId);
  const template = taskTemplates.find(item => item.id === task.templateId);
  if (!duty || !template) return task;

  const duration = getTaskDuration(template, 1);
  if (
    task.startHour === duty.startHour
    && task.startMinute === duty.startMinute
    && task.duration === duration
    && task.notes === duty.notes
  ) {
    return task;
  }

  return {
    ...task,
    startHour: duty.startHour,
    startMinute: duty.startMinute,
    duration,
    notes: duty.notes,
  };
}

function getDurationWorkerCount(template, employeeIds = []) {
  if (!template?.maxPeopleAffectingDuration) return 1;
  const assignedCount = Math.max(1, employeeIds.filter(Boolean).length || 1);
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

function getCheeseRackEstimate(batchCount, flavor) {
  const casesPerBatch = CHEESE_CASES_PER_BATCH_BY_FLAVOR[flavor] || 26;
  const expectedCases = Math.max(1, Number(batchCount) || 1) * casesPerBatch;
  return Math.max(1, Math.ceil(expectedCases / CHEESE_CASES_PER_RACK));
}

function normalizeCheeseFlavors(cheeseFlavors, fallbackAmount = 1, fallbackFlavor = 'Smoke') {
  const rows = Array.isArray(cheeseFlavors) && cheeseFlavors.length > 0
    ? cheeseFlavors
    : [{ id: 'cheese-flavor-1', flavor: fallbackFlavor || 'Smoke', batches: String(fallbackAmount || 1), lotCode: '' }];

  return rows.map((row, index) => ({
    id: row.id || `cheese-flavor-${index + 1}`,
    flavor: row.flavor || 'Smoke',
    batches: Math.max(1, Number(row.batches) || 1),
    lotCode: String(row.lotCode || '').trim(),
  }));
}

function getCheesePlan(cheeseFlavors, fallbackAmount = 1, fallbackFlavor = 'Smoke') {
  const rows = normalizeCheeseFlavors(cheeseFlavors, fallbackAmount, fallbackFlavor);
  const totalBatches = rows.reduce((sum, row) => sum + row.batches, 0);
  const totalRacks = rows.reduce((sum, row) => sum + getCheeseRackEstimate(row.batches, row.flavor), 0);
  const summary = rows.map(row => `${formatAmountLabel(row.batches, 'batches')} ${row.flavor}`).join(', ');

  return { rows, totalBatches, totalRacks, summary };
}

function getCheeseFlavorLotLabel(cheeseFlavors) {
  if (!Array.isArray(cheeseFlavors) || cheeseFlavors.length === 0) return '';
  return cheeseFlavors
    .map(row => `${row.flavor || 'Cheese'}${row.lotCode ? ` · Lot ${row.lotCode}` : ' · Lot —'}`)
    .join(' / ');
}

function getCheeseProcessAmount(task, amount, unitMode = 'racks', flavor = 'Smoke') {
  if (CHEESE_BATCH_CONVERTIBLE_TASK_IDS.has(task?.id) && unitMode === 'batches') {
    return getCheeseRackEstimate(amount, flavor);
  }
  return Math.max(1, Number(amount) || 1);
}

function getTapeCasesAmount(amount, unitMode = 'cases') {
  const parsedAmount = Math.max(1, Number(amount) || 1);
  const casesPerPallet = TAPE_CASES_PER_PALLET_BY_UNIT_MODE[unitMode];
  return casesPerPallet ? parsedAmount * casesPerPallet : parsedAmount;
}

function getProcessTaskDuration(task, amount, employeeIds = [], flavorCount = 1, unitMode = 'racks', flavor = 'Smoke') {
  if (task?.id === TAPE_CASES_TASK_ID) {
    return getTaskDuration(task, getTapeCasesAmount(amount, unitMode), employeeIds);
  }

  const effectiveAmount = getCheeseProcessAmount(task, amount, unitMode, flavor);
  const baseDuration = getTaskDuration(task, amount, employeeIds);
  if (MIXING_CHANGEOVER_TASK_IDS.has(task?.id)) {
    return baseDuration + Math.max(0, Number(flavorCount) - 1) * MIXING_CHANGEOVER_MINUTES;
  }
  if (effectiveAmount !== amount) {
    return getTaskDuration(task, effectiveAmount, employeeIds);
  }
  return baseDuration;
}

function getRunTaskIds(runTemplate) {
  return runTemplate.tasks;
}

function getActiveRunTaskIds(runTemplate, prepAheadTaskIds = []) {
  const skipped = new Set(prepAheadTaskIds || []);
  return getRunTaskIds(runTemplate).filter(taskId => !skipped.has(taskId));
}

function getDipProcessingElapsedDuration(amount, flavorCount = 1) {
  const stationDurations = [...DIP_PROCESSING_LINE_TASK_IDS].map(taskId => {
    const template = taskTemplates.find(t => t.id === taskId);
    return template ? getTaskDuration(template, amount) : 0;
  });
  const productionMinutes = Math.max(...stationDurations);
  const changeoverMinutes = Math.max(0, Number(flavorCount) - 1) * DIP_PROCESSING_CHANGEOVER_MINUTES;
  return Math.round(DIP_PROCESSING_SETUP_CLEANUP_MINUTES + productionMinutes + changeoverMinutes);
}

function getRunTaskDuration(runTemplate, taskId, amount, flavorCount = 1, employeeIds = [], cheeseFlavor = 'Smoke', cheeseFlavors = null) {
  if (runTemplate?.id === 'run-dip-processing' && DIP_PROCESSING_LINE_TASK_IDS.has(taskId)) {
    return getDipProcessingElapsedDuration(amount, flavorCount);
  }

  const template = taskTemplates.find(t => t.id === taskId);
  if (!template) return 0;
  const taskAmount = getTaskAmountForRun(taskId, amount, flavorCount, cheeseFlavor, cheeseFlavors);
  if (runTemplate?.id === 'run-dip-mixing') {
    return getProcessTaskDuration(template, taskAmount, employeeIds, flavorCount);
  }
  return getTaskDuration(template, taskAmount, employeeIds);
}

function getRunConfiguredDuration(runTemplate, amount, flavorCount = 1, assignments = {}, cheeseFlavor = 'Smoke', cheeseFlavors = null, prepAheadTaskIds = []) {
  if (runTemplate.id === 'run-dip-processing') {
    return getDipProcessingElapsedDuration(amount, flavorCount);
  }

  if (runTemplate.id === 'run-fermentation' || runTemplate.id === 'run-cheese-processing') {
    const layoutOffsets = getRunLayout(runTemplate, amount, flavorCount, cheeseFlavor, assignments, cheeseFlavors);
    const activeTaskIds = getActiveRunTaskIds(runTemplate, prepAheadTaskIds);
    if (activeTaskIds.length === 0) return 0;
    return Math.max(...activeTaskIds.map(taskId => {
      return (layoutOffsets[taskId] || 0) + getRunTaskDuration(runTemplate, taskId, amount, flavorCount, assignments[taskId] || [], cheeseFlavor, cheeseFlavors);
    }));
  }

  return getActiveRunTaskIds(runTemplate, prepAheadTaskIds).reduce((sum, taskId) => {
    return sum + getRunTaskDuration(runTemplate, taskId, amount, flavorCount, assignments[taskId] || [], cheeseFlavor, cheeseFlavors);
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
  duties: 'duty',
  inspections: 'inspection',
  lids: 'lid',
  pans: 'pan',
  pallets: 'pallet',
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

function timeInputToMinutes(value) {
  const [hours, minutes] = String(value || '00:00').split(':').map(Number);
  return (hours * 60) + (minutes || 0);
}

function formatHours(minutes) {
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const remainingMinutes = rounded % 60;
  if (hours === 0) return `${remainingMinutes}m`;
  if (remainingMinutes === 0) return `${hours}h`;
  return `${hours}h ${remainingMinutes}m`;
}

function getAvailabilityKey(dayId, employeeId) {
  return `${dayId}-${employeeId}`;
}

function getDefaultEmployeeAvailability(employee, day) {
  const shift = EMPLOYEE_SHIFT_OVERRIDES[employee?.name];
  return {
    ...DEFAULT_AVAILABILITY,
    ...(shift ? { start: shift.start, end: shift.end } : {}),
    isWorking: !shift?.daysOff?.has(day?.name),
  };
}

function getTaskEmployeeIds(task) {
  return task.employeeIds || (task.employeeId ? [task.employeeId] : []);
}

function getTaskDefaultNote(task, sourceAmountLabel = '') {
  if (!task) return '';
  if (task.id === TAPE_CASES_TASK_ID) {
    return sourceAmountLabel
      ? `Estimated from ${sourceAmountLabel}; timing uses 300 cases per hour.`
      : 'Timing uses 300 cases per hour.';
  }
  if (CHEESE_BATCH_CONVERTIBLE_TASK_IDS.has(task.id) && sourceAmountLabel) {
    return `Estimated from ${sourceAmountLabel}.`;
  }
  if (task.id === 'task-boiling') {
    return 'Full boiling and mixing flow; bucket washing can overlap after first 15 minutes.';
  }
  if (task.id === 'task-mixing-room-setup') {
    return 'Sanitize the machine, lay out cardboard, and gather equipment.';
  }
  return task.timingNote || '';
}

function createMixingCompanionTasks(mixingTask) {
  if (!MIXING_TASK_IDS.has(mixingTask.templateId)) return [mixingTask];

  const setupTemplate = taskTemplates.find(task => task.id === 'task-mixing-room-setup');
  const cleanupTemplate = taskTemplates.find(task => task.id === 'task-mixing-cleanup');
  const mixingStart = addMinutesToStart(mixingTask.startHour, mixingTask.startMinute || 0, setupTemplate.baseMinutes);
  const cleanupStart = addMinutesToStart(mixingStart.startHour, mixingStart.startMinute, mixingTask.duration);

  return [
    {
      ...mixingTask,
      id: uuidv4(),
      templateId: setupTemplate.id,
      groupId: setupTemplate.groupId,
      name: setupTemplate.name,
      startHour: mixingTask.startHour,
      startMinute: mixingTask.startMinute || 0,
      duration: setupTemplate.baseMinutes,
      inputAmount: 1,
      inputUnit: setupTemplate.unitName,
      buckets: 1,
      notes: getTaskDefaultNote(setupTemplate),
      isAutomaticCompanion: true,
    },
    {
      ...mixingTask,
      startHour: mixingStart.startHour,
      startMinute: mixingStart.startMinute,
    },
    {
      ...mixingTask,
      id: uuidv4(),
      templateId: cleanupTemplate.id,
      groupId: cleanupTemplate.groupId,
      name: cleanupTemplate.name,
      startHour: cleanupStart.startHour,
      startMinute: cleanupStart.startMinute,
      duration: cleanupTemplate.baseMinutes,
      inputAmount: 1,
      inputUnit: cleanupTemplate.unitName,
      buckets: 1,
      notes: getTaskDefaultNote(cleanupTemplate),
      isAutomaticCompanion: true,
    },
  ];
}

function mergeNotes(defaultNote, customNote = '') {
  return [defaultNote, customNote].filter(Boolean).join('\n');
}

function getTaskGroupLayoutRank(groupId) {
  const index = TASK_GROUP_LAYOUT_ORDER.indexOf(groupId);
  return index === -1 ? TASK_GROUP_LAYOUT_ORDER.length : index;
}

function getEmployeeColor(employee, index = 0) {
  return employee?.color || EMPLOYEE_COLOR_FALLBACKS[index % EMPLOYEE_COLOR_FALLBACKS.length];
}

function getAvailableMinutes(availability = DEFAULT_AVAILABILITY) {
  if (!availability.isWorking) return 0;

  const shiftMinutes = Math.max(0, timeInputToMinutes(availability.end) - timeInputToMinutes(availability.start));
  const lunchMinutes = Math.max(0, Number(availability.lunchMinutes ?? DEFAULT_AVAILABILITY.lunchMinutes) || 0);
  return Math.max(0, shiftMinutes - lunchMinutes);
}

function getAbsoluteMinutes(hour, minute = 0) {
  return (hour * 60) + (minute || 0);
}

function getTimeFromAbsoluteMinutes(totalMinutes) {
  return {
    startHour: Math.floor(totalMinutes / 60),
    startMinute: totalMinutes % 60,
  };
}

function moveStartOutOfLunch(totalMinutes) {
  if (totalMinutes >= LUNCH_START_ABSOLUTE_MINUTES && totalMinutes < LUNCH_END_ABSOLUTE_MINUTES) {
    return LUNCH_END_ABSOLUTE_MINUTES;
  }
  return totalMinutes;
}

function addWorkMinutesToAbsoluteStart(startTotalMinutes, workMinutes) {
  const normalizedStart = moveStartOutOfLunch(startTotalMinutes);
  const rawEnd = normalizedStart + workMinutes;

  if (normalizedStart < LUNCH_START_ABSOLUTE_MINUTES && rawEnd > LUNCH_START_ABSOLUTE_MINUTES) {
    return rawEnd + LUNCH_DURATION_MINUTES;
  }

  return rawEnd;
}

function addWorkMinutesToStart(startHour, startMinute, minutesToAdd) {
  return getTimeFromAbsoluteMinutes(addWorkMinutesToAbsoluteStart(getAbsoluteMinutes(startHour, startMinute), minutesToAdd));
}

function getTaskElapsedMinutes(task) {
  const start = getAbsoluteMinutes(task.startHour, task.startMinute || 0);
  return addWorkMinutesToAbsoluteStart(start, task.duration) - moveStartOutOfLunch(start);
}

function getTaskWorkSegments(task) {
  const rawStart = getAbsoluteMinutes(task.startHour, task.startMinute || 0);
  const start = moveStartOutOfLunch(rawStart);
  const duration = Math.max(0, task.duration || 0);

  if (duration <= 0) return [];

  const endWithoutLunch = start + duration;
  if (CONTINUOUS_ACROSS_LUNCH_TASK_IDS.has(task.templateId)) {
    return [{
      start,
      duration: addWorkMinutesToAbsoluteStart(start, duration) - start,
    }];
  }
  if (start >= LUNCH_END_ABSOLUTE_MINUTES || endWithoutLunch <= LUNCH_START_ABSOLUTE_MINUTES) {
    return [{ start, duration }];
  }

  const beforeLunchDuration = Math.max(0, LUNCH_START_ABSOLUTE_MINUTES - start);
  const afterLunchDuration = duration - beforeLunchDuration;
  const segments = [];

  if (beforeLunchDuration > 0) {
    segments.push({ start, duration: beforeLunchDuration });
  }
  if (afterLunchDuration > 0) {
    segments.push({ start: LUNCH_END_ABSOLUTE_MINUTES, duration: afterLunchDuration });
  }

  return segments;
}

function getTaskTimeRange(task) {
  const rawStart = getAbsoluteMinutes(task.startHour, task.startMinute || 0);
  const startTotalMins = moveStartOutOfLunch(rawStart);
  const endTotalMins = addWorkMinutesToAbsoluteStart(rawStart, task.duration);
  const startTime = getTimeFromAbsoluteMinutes(startTotalMins);
  const endTime = getTimeFromAbsoluteMinutes(endTotalMins);
  return `${formatTime(startTime.startHour, startTime.startMinute)} - ${formatTime(endTime.startHour, endTime.startMinute)}`;
}

function getDropTimeFromDrag(active, over) {
  if (!active?.rect?.current?.translated || !over?.rect) return null;

  const dropY = active.rect.current.translated.top - over.rect.top;
  const maxY = SCHEDULE_HOURS * HOUR_ROW_HEIGHT - 20;
  const clampedY = Math.max(0, Math.min(dropY, maxY));
  const totalMinutes = (clampedY / HOUR_ROW_HEIGHT) * 60;
  const snappedTotalMinutes = Math.round(totalMinutes / SNAP_MINUTES) * SNAP_MINUTES;
  const rawStartTotalMinutes = (SCHEDULE_START_HOUR * 60) + snappedTotalMinutes;
  const adjustedStartTotalMinutes = moveStartOutOfLunch(rawStartTotalMinutes);
  const adjustedScheduleMinutes = adjustedStartTotalMinutes - (SCHEDULE_START_HOUR * 60);
  const startHour = Math.floor(adjustedStartTotalMinutes / 60);
  const startMinute = adjustedStartTotalMinutes % 60;

  return {
    startHour,
    startMinute,
    top: (adjustedScheduleMinutes / 60) * HOUR_ROW_HEIGHT,
  };
}

function getTaskAmountForRun(taskId, amount, flavorCount = 1, cheeseFlavor = 'Smoke', cheeseFlavors = null) {
  void flavorCount;
  if (CHEESE_BATCH_SHARED_TASK_IDS.has(taskId) && cheeseFlavors) {
    const cheesePlan = getCheesePlan(cheeseFlavors, amount, cheeseFlavor);
    return CHEESE_BATCH_CONVERTIBLE_TASK_IDS.has(taskId)
      ? cheesePlan.totalRacks
      : cheesePlan.totalBatches;
  }
  if (CHEESE_BATCH_CONVERTIBLE_TASK_IDS.has(taskId)) {
    const task = taskTemplates.find(t => t.id === taskId);
    return getCheeseProcessAmount(task, amount, 'batches', cheeseFlavor);
  }
  return amount;
}

function hasFlavorCountField(runTemplateId) {
  return runTemplateId === 'run-dip-processing'
    || runTemplateId === 'run-dip-mixing';
}

function hasDefaultEmployeeField() {
  return false;
}

function getRunDisplayName(runTemplate, inputAmount, inputUnit, fallbackName = 'Production Run') {
  return `${runTemplate?.name || fallbackName} (${formatAmountLabel(inputAmount, inputUnit)})`;
}

function addMinutesToStart(startHour, startMinute, minutesToAdd) {
  return addWorkMinutesToStart(startHour, startMinute, minutesToAdd);
}

function getNextWorkingDayId(dateStr) {
  let next = addDays(new Date(`${dateStr}T12:00:00`), 1);
  while ([0, 6].includes(next.getDay())) {
    next = addDays(next, 1);
  }
  return format(next, 'yyyy-MM-dd');
}

function getWorkMinutesUntilDayEnd(startHour, startMinute) {
  const start = moveStartOutOfLunch(getAbsoluteMinutes(startHour, startMinute));
  if (start >= DAY_END_ABSOLUTE_MINUTES) return 0;
  const lunchMinutes = start < LUNCH_START_ABSOLUTE_MINUTES ? LUNCH_DURATION_MINUTES : 0;
  return Math.max(0, DAY_END_ABSOLUTE_MINUTES - start - lunchMinutes);
}

function splitTaskAcrossWorkingDays(task) {
  const chunks = [];
  let remainingDuration = Math.max(0, task.duration || 0);
  let dateStr = task.dateStr;
  let startHour = task.startHour;
  let startMinute = task.startMinute || 0;
  const originalDuration = remainingDuration;
  const originalAmount = Number(task.inputAmount) || 0;
  let chunkIndex = 0;

  while (remainingDuration > 0) {
    let availableMinutes = getWorkMinutesUntilDayEnd(startHour, startMinute);
    if (availableMinutes <= 0) {
      dateStr = getNextWorkingDayId(dateStr);
      startHour = SCHEDULE_START_HOUR;
      startMinute = 0;
      availableMinutes = getWorkMinutesUntilDayEnd(startHour, startMinute);
    }

    const duration = Math.min(remainingDuration, availableMinutes);
    const isContinuation = chunkIndex > 0;
    const inputAmount = originalAmount > 0 && originalDuration > 0
      ? Math.round((originalAmount * duration / originalDuration) * 100) / 100
      : task.inputAmount;

    chunks.push({
      ...task,
      id: chunkIndex === 0 ? task.id : uuidv4(),
      dateStr,
      startHour,
      startMinute,
      duration,
      inputAmount,
      buckets: inputAmount || task.buckets,
      isContinuation,
      continuationOfId: chunkIndex === 0 ? task.id : (task.continuationOfId || task.id),
      notes: isContinuation
        ? mergeNotes(task.notes || '', 'Carryover from previous day; drag this block to reschedule it.')
        : task.notes,
    });

    remainingDuration -= duration;
    if (remainingDuration > 0) {
      dateStr = getNextWorkingDayId(dateStr);
      startHour = SCHEDULE_START_HOUR;
      startMinute = 0;
      chunkIndex += 1;
    }
  }

  return chunks;
}

function expandTasksAcrossWorkingDays(tasks) {
  return tasks.flatMap(splitTaskAcrossWorkingDays);
}

function getSequentialLayout(runTemplate, amount, flavorCount = 1, cheeseFlavor = 'Smoke', assignments = {}, cheeseFlavors = null) {
  let offset = 0;
  return Object.fromEntries(getRunTaskIds(runTemplate).map(taskId => {
    const currentOffset = offset;
    offset += getRunTaskDuration(runTemplate, taskId, amount, flavorCount, assignments[taskId] || [], cheeseFlavor, cheeseFlavors);
    return [taskId, currentOffset];
  }));
}

function getRunLayout(runTemplate, amount, flavorCount = 1, cheeseFlavor = 'Smoke', assignments = {}, cheeseFlavors = null) {
  if (runTemplate.id === 'run-dip-processing') {
    return Object.fromEntries(runTemplate.tasks.map(taskId => [taskId, 0]));
  }

  if (runTemplate.id === 'run-cheese-processing') {
    return Object.fromEntries(
      getRunTaskIds(runTemplate).map((taskId, index) => [
        taskId,
        index * CHEESE_PROCESSING_STAGGER_MINUTES,
      ])
    );
  }

  if (runTemplate.id !== 'run-fermentation') {
    return getSequentialLayout(runTemplate, amount, flavorCount, cheeseFlavor, assignments, cheeseFlavors);
  }

  const durationByTaskId = Object.fromEntries(
    runTemplate.tasks.map(taskId => {
      const template = taskTemplates.find(t => t.id === taskId);
      return [taskId, template ? getTaskDuration(template, amount) : 0];
    })
  );

  const boilingDuration = durationByTaskId['task-boiling'] || 0;
  const cleanupStartOffset = FERMENTATION_BOILING_START_OFFSET_MINUTES + boilingDuration;

  return {
    'task-sanitation': 0,
    'task-stickering': 0,
    'task-boiling': FERMENTATION_BOILING_START_OFFSET_MINUTES,
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

function EmployeeCheckboxPicker({
  employees,
  selectedEmployeeIds = [],
  maxSelections = Infinity,
  label = 'Assigned',
  onChange,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedNames = selectedEmployeeIds
    .map(employeeId => employees.find(employee => employee.id === employeeId)?.name)
    .filter(Boolean);

  return (
    <div className={`employee-picker ${isOpen ? 'is-open' : ''}`}>
      <button
        type="button"
        className="employee-picker-toggle"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(current => !current)}
      >
        <span>{label}</span>
        <span className="employee-picker-summary">
          {selectedNames.length > 0 ? selectedNames.join(', ') : 'None'}
        </span>
        <ChevronDown size={15} className={`employee-picker-chevron ${isOpen ? 'is-open' : ''}`} />
      </button>
      {isOpen && (
        <div className="mini-checkbox-list" aria-label={`${label} employees`}>
          {employees.map(employee => (
            <label key={employee.id} className="mini-checkbox-row">
              <input
                type="checkbox"
                checked={selectedEmployeeIds.includes(employee.id)}
                onChange={() => onChange(toggleEmployeeId(selectedEmployeeIds, employee.id, maxSelections))}
              />
              <span>{employee.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// Draggable Sidebar Item (Full Run Template)
function DraggableRunTemplate({
  runTemplate,
  taskTemplates,
  employees,
  amount,
  flavorCount,
  cheeseFlavor,
  cheeseFlavors,
  defaultEmployeeId,
  assignments = {},
  prepAheadTaskIds = [],
  isExpanded,
  onToggle,
  onAmountChange,
  onFlavorCountChange,
  onCheeseFlavorChange,
  onCheeseFlavorsChange,
  onDefaultEmployeeChange,
  onAssignmentChange,
}) {
  const parsedAmount = Math.max(1, Number(amount) || 1);
  const parsedFlavorCount = Math.max(1, Number(flavorCount) || 1);
  const changeovers = Math.max(0, parsedFlavorCount - 1);
  const cheesePlan = getCheesePlan(cheeseFlavors, parsedAmount, cheeseFlavor);
  const runAmount = runTemplate.id === 'run-cheese-processing' ? cheesePlan.totalBatches : parsedAmount;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `run-template-${runTemplate.id}`,
    data: {
      type: 'run-template',
      runTemplate,
      inputAmount: runAmount,
      flavorCount: parsedFlavorCount,
      cheeseFlavor,
      cheeseFlavors: runTemplate.id === 'run-cheese-processing' ? cheesePlan.rows : undefined,
      defaultEmployeeId,
      assignments,
      prepAheadTaskIds,
    },
  });

  const totalConfiguredMinutes = getRunConfiguredDuration(
    runTemplate,
    runAmount,
    parsedFlavorCount,
    assignments,
    cheeseFlavor,
    runTemplate.id === 'run-cheese-processing' ? cheesePlan.rows : null,
    prepAheadTaskIds
  );
  const durationLabel = ['run-dip-processing', 'run-fermentation'].includes(runTemplate.id) ? 'timeline time' : 'total work';

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
            {formatAmountLabel(runAmount, runTemplate.inputUnit)}, {formatDuration(totalConfiguredMinutes)} {durationLabel}
          </div>
        </div>
        <ChevronDown size={16} className={`run-expand-icon ${isExpanded ? 'is-expanded' : ''}`} />
      </div>

      {isExpanded && (
      <div className="run-setup-controls">
        {runTemplate.id !== 'run-cheese-processing' && (
          <label className="compact-field">
            <span>{getDisplayUnit(parsedAmount, runTemplate.inputUnit)}</span>
            <input
              type="number"
              min="1"
              value={amount}
              onChange={e => onAmountChange(e.target.value)}
            />
          </label>
        )}

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

        {runTemplate.id === 'run-cheese-processing' && (
          <div className="cheese-flavour-list">
            <div className="cheese-flavour-summary">
              <span>{formatAmountLabel(cheesePlan.totalBatches, 'batches')}</span>
              <small>{formatAmountLabel(cheesePlan.totalRacks, 'racks')} est.</small>
            </div>
            {cheesePlan.rows.map((row, index) => (
              <div key={row.id} className="cheese-flavour-row">
                <select
                  value={row.flavor}
                  onChange={e => {
                    const nextRows = cheesePlan.rows.map(item => (
                      item.id === row.id ? { ...item, flavor: e.target.value } : item
                    ));
                    onCheeseFlavorsChange(nextRows);
                    if (index === 0) onCheeseFlavorChange(e.target.value);
                  }}
                >
                  {Object.keys(CHEESE_CASES_PER_BATCH_BY_FLAVOR).map(flavor => (
                    <option key={flavor} value={flavor}>{flavor}</option>
                  ))}
                </select>
                <input
                  className="cheese-lot-input"
                  type="text"
                  value={row.lotCode}
                  placeholder="Lot code"
                  aria-label={`${row.flavor} lot code`}
                  onChange={e => {
                    const nextRows = cheesePlan.rows.map(item => (
                      item.id === row.id ? { ...item, lotCode: e.target.value } : item
                    ));
                    onCheeseFlavorsChange(nextRows);
                  }}
                />
                <input
                  type="number"
                  min="1"
                  value={row.batches}
                  onChange={e => {
                    const nextRows = cheesePlan.rows.map(item => (
                      item.id === row.id ? { ...item, batches: e.target.value } : item
                    ));
                    onCheeseFlavorsChange(nextRows);
                    onAmountChange(String(getCheesePlan(nextRows).totalBatches));
                  }}
                />
                <span>{formatAmountLabel(getCheeseRackEstimate(row.batches, row.flavor), 'racks')}</span>
                <button
                  type="button"
                  className="mini-remove-button"
                  disabled={cheesePlan.rows.length === 1}
                  onClick={() => {
                    const nextRows = cheesePlan.rows.filter(item => item.id !== row.id);
                    onCheeseFlavorsChange(nextRows);
                    onAmountChange(String(getCheesePlan(nextRows).totalBatches));
                  }}
                >
                  x
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-secondary add-flavour-button"
              onClick={() => {
                const nextRows = [
                  ...cheesePlan.rows,
                  { id: `cheese-flavor-${Date.now()}`, flavor: 'Smoke', batches: 1, lotCode: '' },
                ];
                onCheeseFlavorsChange(nextRows);
                onAmountChange(String(getCheesePlan(nextRows).totalBatches));
              }}
            >
              Add flavour
            </button>
          </div>
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
          {getRunTaskIds(runTemplate).map(taskId => {
            const task = taskTemplates.find(t => t.id === taskId);
            if (!task) return null;
            const selectedEmployeeIds = assignments[taskId] || [];
            const maxSelections = task.assignmentRoles?.length || task.maxPeopleAffectingDuration || 1;

            return (
              <div key={taskId} className="run-assignment-row">
                <div className="run-assignment-heading">
                  <label className="run-assignment-name" htmlFor={`${runTemplate.id}-${taskId}-employee`}>{task.name}</label>
                </div>
                <EmployeeCheckboxPicker
                  employees={employees}
                  selectedEmployeeIds={selectedEmployeeIds}
                  maxSelections={maxSelections}
                  onChange={employeeIds => onAssignmentChange(taskId, employeeIds)}
                />
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
  flavorCount,
  unitMode,
  cheeseFlavor,
  employeeIds,
  prepAhead,
  onAmountChange,
  onFlavorCountChange,
  onUnitModeChange,
  onCheeseFlavorChange,
  onEmployeeToggle,
}) {
  const parsedAmount = Math.max(1, Number(amount) || 1);
  const parsedFlavorCount = Math.max(1, Number(flavorCount) || 1);
  const changeovers = Math.max(0, parsedFlavorCount - 1);
  const isTapeCasesTask = task.id === TAPE_CASES_TASK_ID;
  const selectedUnitMode = unitMode || (isTapeCasesTask ? 'cases' : 'racks');
  const selectedCheeseFlavor = cheeseFlavor || 'Smoke';
  const isCheeseConvertible = CHEESE_BATCH_CONVERTIBLE_TASK_IDS.has(task.id);
  const effectiveAmount = isTapeCasesTask
    ? getTapeCasesAmount(parsedAmount, selectedUnitMode)
    : getCheeseProcessAmount(task, parsedAmount, selectedUnitMode, selectedCheeseFlavor);
  const displayUnitName = isTapeCasesTask
    ? (selectedUnitMode === 'cases' ? 'cases' : 'pallets')
    : (isCheeseConvertible && selectedUnitMode === 'batches' ? 'batches' : task.unitName);
  const selectedEmployeeIds = employeeIds || [];
  const maxSelections = task.maxPeopleAffectingDuration || 1;
  const duration = getProcessTaskDuration(task, parsedAmount, selectedEmployeeIds, parsedFlavorCount, selectedUnitMode, selectedCheeseFlavor);
  const displayedDuration = MIXING_TASK_IDS.has(task.id) ? duration + 90 : duration;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `task-template-${task.id}`,
    disabled: prepAhead,
    data: {
      type: 'task-template',
      taskTemplate: task,
      inputAmount: parsedAmount,
      flavorCount: parsedFlavorCount,
      unitMode: selectedUnitMode,
      cheeseFlavor: selectedCheeseFlavor,
      effectiveAmount,
      employeeIds: selectedEmployeeIds,
      prepAhead,
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
            {formatAmountLabel(parsedAmount, displayUnitName)}
            {isTapeCasesTask && selectedUnitMode !== 'cases' ? ` -> ${formatAmountLabel(effectiveAmount, 'cases')}` : ''}
            {isCheeseConvertible && selectedUnitMode === 'batches' ? ` -> ${formatAmountLabel(effectiveAmount, task.unitName)}` : ''}, {formatDuration(displayedDuration)}
            {MIXING_TASK_IDS.has(task.id) ? ' incl. set-up & cleanup' : ''}
          </div>
        </div>
      </div>
      <div className="process-setup-controls">
        <label className="compact-field process-amount-field">
          <span>{getDisplayUnit(parsedAmount, displayUnitName)}</span>
          <input
            type="number"
            min="1"
            value={amount}
            onChange={e => onAmountChange(e.target.value)}
          />
        </label>
        {isCheeseConvertible && (
          <div className="cheese-conversion-controls">
            <label className="compact-field">
              <span>Unit</span>
              <select
                value={selectedUnitMode}
                onChange={e => onUnitModeChange(e.target.value)}
              >
                <option value="racks">Racks</option>
                <option value="batches">Batches</option>
              </select>
            </label>
            {selectedUnitMode === 'batches' && (
              <label className="compact-field">
                <span>Flavour</span>
                <select
                  value={selectedCheeseFlavor}
                  onChange={e => onCheeseFlavorChange(e.target.value)}
                >
                  {Object.keys(CHEESE_CASES_PER_BATCH_BY_FLAVOR).map(flavor => (
                    <option key={flavor} value={flavor}>{flavor}</option>
                  ))}
                </select>
                <small>{formatAmountLabel(effectiveAmount, 'racks')} est.</small>
              </label>
            )}
          </div>
        )}
        {isTapeCasesTask && (
          <div className="cheese-conversion-controls">
            <label className="compact-field">
              <span>Unit</span>
              <select
                value={selectedUnitMode}
                onChange={e => onUnitModeChange(e.target.value)}
              >
                <option value="cases">Cases / boxes</option>
                <option value="cheesePallets">Cheese pallets</option>
                <option value="dipPallets">Dip pallets</option>
              </select>
            </label>
            {selectedUnitMode !== 'cases' && (
              <small>{formatAmountLabel(effectiveAmount, 'cases')} est.</small>
            )}
          </div>
        )}
        {MIXING_CHANGEOVER_TASK_IDS.has(task.id) && (
          <label className="compact-field process-amount-field">
            <span>flavours</span>
            <input
              type="number"
              min="1"
              value={flavorCount}
              onChange={e => onFlavorCountChange(e.target.value)}
            />
            <small>{formatAmountLabel(changeovers, 'changeovers')}</small>
          </label>
        )}
        <EmployeeCheckboxPicker
          employees={employees}
          selectedEmployeeIds={selectedEmployeeIds}
          maxSelections={task.assignmentRoles?.length || maxSelections}
          onChange={employeeIds => onEmployeeToggle(employeeIds, task.assignmentRoles?.length || maxSelections)}
        />
      </div>
    </div>
  );
}

function ProcessFolder({
  runTemplate,
  taskTemplates,
  employees,
  processSetups,
  folderAmount,
  isExpanded,
  onToggle,
  onFolderAmountChange,
  onAmountChange,
  onFlavorCountChange,
  onUnitModeChange,
  onCheeseFlavorChange,
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
          {runTemplate.id === 'run-cheese-processing' && (
            <label className="compact-field process-folder-main-field">
              <span>All cheese batches</span>
              <input
                type="number"
                min="1"
                value={folderAmount || '1'}
                onChange={e => onFolderAmountChange(e.target.value)}
              />
            </label>
          )}
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
                flavorCount={setup.flavorCount || '1'}
                unitMode={setup.unitMode || 'racks'}
                cheeseFlavor={setup.cheeseFlavor || 'Smoke'}
                employeeIds={setup.employeeIds || []}
                prepAhead={setup.prepAhead || false}
                onAmountChange={amount => onAmountChange(taskId, amount)}
                onFlavorCountChange={flavorCount => onFlavorCountChange(taskId, flavorCount)}
                onUnitModeChange={unitMode => onUnitModeChange(taskId, unitMode)}
                onCheeseFlavorChange={cheeseFlavor => onCheeseFlavorChange(taskId, cheeseFlavor)}
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

function DraggableMiscTemplate({
  name,
  duration,
  onNameChange,
  onDurationChange,
}) {
  const parsedDuration = Math.max(5, Number(duration) || 30);
  const displayName = name.trim() || 'Misc Work';
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: 'misc-work-template',
    data: {
      type: 'misc-template',
      name: displayName,
      duration: parsedDuration,
    },
  });

  return (
    <div className="run-setup-card misc-setup-card">
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        className="task-template task-misc-work"
        style={{ opacity: isDragging ? 0.5 : 1, marginBottom: 0, touchAction: 'none' }}
      >
        <div className="run-drag-handle" aria-hidden="true">
          <GripVertical size={16} className="drag-handle-icon" />
        </div>
        <div className="task-content-wrapper">
          <div className="task-title" style={{ fontSize: '0.875rem' }}>{displayName}</div>
          <div className="task-meta">
            <Clock size={12} />
            {formatDuration(parsedDuration)}
          </div>
        </div>
      </div>
      <div className="run-setup-controls misc-setup-controls">
        <label className="compact-field">
          <span>Name</span>
          <input
            type="text"
            value={name}
            onChange={e => onNameChange(e.target.value)}
            placeholder="Misc Work"
          />
        </label>
        <label className="compact-field">
          <span>Minutes</span>
          <input
            type="number"
            min="5"
            step="5"
            value={duration}
            onChange={e => onDurationChange(e.target.value)}
          />
        </label>
      </div>
    </div>
  );
}

function EmployeeCapacityHeader({
  weekDays,
  employees,
  scheduledTasks,
  availability,
  onAvailabilityChange,
  scrollRef,
  onScroll,
}) {
  const [expandedEmployeeKey, setExpandedEmployeeKey] = useState(null);

  return (
    <div className="capacity-strip" ref={scrollRef} onScroll={onScroll}>
      <div className="capacity-time-cell">People</div>
      {weekDays.map(day => {
        const dayTasks = scheduledTasks.filter(task => task.dateStr === day.id);
        const unassignedMinutes = dayTasks.reduce((sum, task) => (
          getTaskEmployeeIds(task).length === 0 ? sum + task.duration : sum
        ), 0);
        const expandedEmployee = employees.find(employee => getAvailabilityKey(day.id, employee.id) === expandedEmployeeKey);
        const expandedEmployeeIndex = employees.findIndex(employee => employee.id === expandedEmployee?.id);
        const expandedAvailability = expandedEmployee
          ? availability[expandedEmployeeKey] || getDefaultEmployeeAvailability(expandedEmployee, day)
          : null;

        return (
          <div key={day.id} className="capacity-day-card">
            <div className="capacity-day-topline">
              <div className="capacity-day-title">{day.name}</div>
              <div className={`capacity-unassigned ${unassignedMinutes > 0 ? 'has-unassigned' : ''}`}>
                Unassigned {formatHours(unassignedMinutes)}
              </div>
            </div>
            <div className="capacity-employee-list">
              {employees.map((employee, employeeIndex) => {
                const key = getAvailabilityKey(day.id, employee.id);
                const employeeAvailability = availability[key] || getDefaultEmployeeAvailability(employee, day);
                const assignedMinutes = dayTasks.reduce((sum, task) => (
                  getTaskEmployeeIds(task).includes(employee.id) ? sum + task.duration : sum
                ), 0);
                const availableMinutes = getAvailableMinutes(employeeAvailability);
                const statusClass = !employeeAvailability.isWorking
                  ? 'is-off'
                  : assignedMinutes > availableMinutes
                    ? 'is-over'
                    : assignedMinutes >= availableMinutes * 0.85
                      ? 'is-tight'
                      : 'is-ok';
                const employeeKey = getAvailabilityKey(day.id, employee.id);
                const isExpanded = expandedEmployeeKey === employeeKey;
                const employeeColor = getEmployeeColor(employee, employeeIndex);

                return (
                  <div
                    key={employee.id}
                    className={`capacity-employee-row ${statusClass} ${isExpanded ? 'is-expanded' : ''}`}
                    style={{ '--employee-color': employeeColor }}
                  >
                    <button
                      type="button"
                      className="capacity-employee-summary"
                      onClick={() => setExpandedEmployeeKey(prev => prev === employeeKey ? null : employeeKey)}
                    >
                      <span className="capacity-employee-name">{employee.name}</span>
                      <span className="capacity-hours">{formatHours(assignedMinutes)} / {formatHours(availableMinutes)}</span>
                    </button>
                  </div>
                );
              })}
            </div>
            {expandedEmployee && expandedAvailability && (
              <div
                className="capacity-employee-details"
                style={{ '--employee-color': getEmployeeColor(expandedEmployee, expandedEmployeeIndex) }}
              >
                <div className="capacity-details-name">{expandedEmployee.name}</div>
                <label className="capacity-working-toggle">
                  <input
                    type="checkbox"
                    checked={expandedAvailability.isWorking}
                    onChange={e => onAvailabilityChange(day.id, expandedEmployee.id, { isWorking: e.target.checked })}
                  />
                  <span>Working today</span>
                </label>
                <div className="capacity-time-inputs">
                  <label>
                    <span>Start</span>
                    <input
                      type="time"
                      value={expandedAvailability.start}
                      disabled={!expandedAvailability.isWorking}
                      onChange={e => onAvailabilityChange(day.id, expandedEmployee.id, { start: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>End</span>
                    <input
                      type="time"
                      value={expandedAvailability.end}
                      disabled={!expandedAvailability.isWorking}
                      onChange={e => onAvailabilityChange(day.id, expandedEmployee.id, { end: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>Lunch</span>
                    <input
                      type="number"
                      min="0"
                      step="5"
                      value={expandedAvailability.lunchMinutes ?? DEFAULT_AVAILABILITY.lunchMinutes}
                      disabled={!expandedAvailability.isWorking}
                      onChange={e => onAvailabilityChange(day.id, expandedEmployee.id, { lunchMinutes: e.target.value })}
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Droppable Schedule Slot (Full Day)
function LunchBlock() {
  const lunchStartMins = LUNCH_START_ABSOLUTE_MINUTES - (SCHEDULE_START_HOUR * 60);
  const top = (lunchStartMins / 60) * HOUR_ROW_HEIGHT;
  const height = (LUNCH_DURATION_MINUTES / 60) * HOUR_ROW_HEIGHT;

  return (
    <div
      className="lunch-block"
      style={{
        top: `${top}px`,
        height: `${height}px`,
      }}
    >
      Lunch
    </div>
  );
}

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
      <LunchBlock />
      <DropTimeHint hint={dragTimeHint?.dateStr === dateStr ? dragTimeHint : null} />
      {children}
    </div>
  );
}

// Layout helper for overlap collision detection
function layoutDayTasks(tasks) {
  if (tasks.length === 0) return [];
  
  const getStartMins = (t) => moveStartOutOfLunch(getAbsoluteMinutes(t.startHour, t.startMinute || 0)) - (SCHEDULE_START_HOUR * 60);
  const getEndMins = (t) => getStartMins(t) + getTaskElapsedMinutes(t);

  const sorted = [...tasks].sort((a, b) => {
    const startA = getStartMins(a);
    const startB = getStartMins(b);
    if (startA !== startB) return startA - startB;
    const groupA = getTaskGroupLayoutRank(a.groupId);
    const groupB = getTaskGroupLayoutRank(b.groupId);
    if (groupA !== groupB) return groupA - groupB;
    return getEndMins(b) - getEndMins(a);
  });

  const columns = [];
  let lastEventEnding = null;
  const results = [];

  const packEvents = () => {
    const orderedColumns = columns
      .map((col, originalIndex) => ({
        col,
        originalIndex,
        groupRank: Math.min(...col.map(task => getTaskGroupLayoutRank(task.groupId))),
        firstStart: Math.min(...col.map(task => getStartMins(task))),
      }))
      .sort((a, b) => {
        if (a.groupRank !== b.groupRank) return a.groupRank - b.groupRank;
        if (a.firstStart !== b.firstStart) return a.firstStart - b.firstStart;
        return a.originalIndex - b.originalIndex;
      });
    const numColumns = orderedColumns.length;
    orderedColumns.forEach(({ col }, colIdx) => {
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

    const availableColumns = columns
      .map((col, index) => {
        const lastEventInCol = col[col.length - 1];
        return {
          col,
          index,
          lastTask: lastEventInCol,
          lastEnd: getEndMins(lastEventInCol),
        };
      })
      .filter(item => item.lastEnd <= start)
      .sort((a, b) => {
        const aSameRun = a.lastTask.runId === task.runId ? 0 : 1;
        const bSameRun = b.lastTask.runId === task.runId ? 0 : 1;
        if (aSameRun !== bSameRun) return aSameRun - bSameRun;

        const aSameGroup = a.lastTask.groupId === task.groupId ? 0 : 1;
        const bSameGroup = b.lastTask.groupId === task.groupId ? 0 : 1;
        if (aSameGroup !== bSameGroup) return aSameGroup - bSameGroup;

        const aGap = start - a.lastEnd;
        const bGap = start - b.lastEnd;
        if (aGap !== bGap) return aGap - bGap;

        return a.index - b.index;
      });

    let placed = false;
    if (availableColumns.length > 0) {
      availableColumns[0].col.push(task);
      placed = true;
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
    if (task.isAutomaticDaily) return 'Daily duties';
    const run = activeRuns.find(item => item.id === task.runId);
    return run?.name || 'Single process';
  };

  const getRunSortDetails = (task, runStartByKey = new Map()) => {
    const run = activeRuns.find(item => item.id === task.runId);
    const runId = task.isAutomaticDaily ? `daily-${task.dateStr}` : (task.runId || task.id);
    return {
      groupRank: getTaskGroupLayoutRank(task.groupId),
      runName: task.isAutomaticDaily ? 'Daily duties' : (run?.name || 'Single process'),
      runId,
      runStart: runStartByKey.get(runId) ?? ((task.startHour * 60) + (task.startMinute || 0)),
      start: (task.startHour * 60) + (task.startMinute || 0),
    };
  };

  const getSortedTasksForDay = (dayId) => {
    const dayTasks = scheduledTasks.filter(task => task.dateStr === dayId);
    const runStartByKey = dayTasks.reduce((map, task) => {
      const runId = task.isAutomaticDaily ? `daily-${task.dateStr}` : (task.runId || task.id);
      const start = (task.startHour * 60) + (task.startMinute || 0);
      const existingStart = map.get(runId);
      if (existingStart === undefined || start < existingStart) {
        map.set(runId, start);
      }
      return map;
    }, new Map());

    return dayTasks.sort((a, b) => {
      const detailsA = getRunSortDetails(a, runStartByKey);
      const detailsB = getRunSortDetails(b, runStartByKey);

      if (detailsA.groupRank !== detailsB.groupRank) return detailsA.groupRank - detailsB.groupRank;
      if (detailsA.runStart !== detailsB.runStart) return detailsA.runStart - detailsB.runStart;
      if (detailsA.runName !== detailsB.runName) return detailsA.runName.localeCompare(detailsB.runName);
      if (detailsA.runId !== detailsB.runId) return detailsA.runId.localeCompare(detailsB.runId);
      return detailsA.start - detailsB.start;
    });
  };

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
                <div className="print-task-grid">
                  <div className="print-task-row print-task-head">
                    <div>Time</div>
                    <div>Run</div>
                    <div>Process</div>
                    <div>Amount</div>
                    <div>Work Time</div>
                    <div>Employee</div>
                    <div>Notes</div>
                  </div>
                  {dayTasks.map((task, index) => {
                    const runName = getRunName(task);
                    const previousRunName = index > 0 ? getRunName(dayTasks[index - 1]) : '';
                    const isRunStart = index === 0 || runName !== previousRunName || task.runId !== dayTasks[index - 1].runId;

                    return (
                      <div key={task.id} className={`print-task-row${isRunStart ? ' print-run-start' : ''}`}>
                        <div>{getTaskTimeRange(task)}</div>
                        <div>{isRunStart ? runName : ''}</div>
                        <div>{task.name}</div>
                        <div>{task.inputAmount ? formatAmountLabel(task.inputAmount, task.inputUnit) : '-'}</div>
                        <div>{formatDuration(task.duration)}</div>
                        <div>{getAssignedEmployeeNames(task)}</div>
                        <div>{[getCheeseFlavorLotLabel(task.cheeseFlavors), task.notes].filter(Boolean).join(' — ') || '-'}</div>
                      </div>
                    );
                  })}
                </div>
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
  const hasTimingAssumption = ASSUMPTION_FLAG_TASK_IDS.has(scheduledTask.templateId);
  const segments = getTaskWorkSegments(scheduledTask);
  const firstSegmentStart = segments[0]?.start || moveStartOutOfLunch(getAbsoluteMinutes(scheduledTask.startHour, scheduledTask.startMinute || 0));
  const lastSegment = segments[segments.length - 1] || { start: firstSegmentStart, duration: scheduledTask.duration };
  const top = ((firstSegmentStart - (SCHEDULE_START_HOUR * 60)) / 60) * HOUR_ROW_HEIGHT;
  const elapsedHeight = Math.max((((lastSegment.start + lastSegment.duration) - firstSegmentStart) / 60) * HOUR_ROW_HEIGHT, 24);

  const leftPercent = layout ? layout.left : 0;
  const widthPercent = layout ? layout.width : 100;
  const displayWidthPercent = scheduledTask.isAutomaticDaily && widthPercent < 50
    ? Math.min(100 - leftPercent, widthPercent * 2)
    : widthPercent;

  const timeString = getTaskTimeRange(scheduledTask);
  const cheeseFlavorLotLabel = getCheeseFlavorLotLabel(scheduledTask.cheeseFlavors);
  const renderTaskContent = (height, isContinued = false) => (
    <>
      <div className="task-title task-title-with-employees" style={{ fontSize: widthPercent < 50 ? '0.75rem' : '0.875rem' }}>
        <span>{(isContinued || scheduledTask.isContinuation) ? `${scheduledTask.name} continued` : scheduledTask.name}</span>
        {!isContinued && assignedEmployees.length > 0 && (
          <span className="title-employee-dots" aria-label={assignedEmployees.map(emp => emp.name).join(', ')}>
            {assignedEmployees.map(emp => {
              const employeeIndex = employees.findIndex(item => item.id === emp.id);
              return (
                <span
                  key={emp.id}
                  className="title-employee-dot"
                  style={{ backgroundColor: getEmployeeColor(emp, employeeIndex) }}
                />
              );
            })}
          </span>
        )}
      </div>
      {!isContinued && (
        <>
          {cheeseFlavorLotLabel && (
            <div className="cheese-lot-badge" title={cheeseFlavorLotLabel}>
              {cheeseFlavorLotLabel}
            </div>
          )}
          <div className="task-meta" style={{ marginBottom: '2px', fontSize: '0.7rem' }}>
            {scheduledTask.inputAmount ? `${formatAmountLabel(scheduledTask.inputAmount, scheduledTask.inputUnit)} - ` : ''}{timeString} ({formatDuration(scheduledTask.duration)})
          </div>
          {assignedEmployees.length > 0 ? (
            <div className="task-meta">
              <Users size={12} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{assignedEmployees.map(emp => emp.name).join(', ')}</span>
              {hasUntrainedEmployee && <AlertCircle size={12} color="var(--danger)" style={{ flexShrink: 0 }} />}
            </div>
          ) : (
            <div className="task-meta" style={{ color: 'var(--danger)', fontWeight: 500 }}>
              <AlertCircle size={12} style={{ flexShrink: 0 }} /> {widthPercent < 50 ? 'Un...' : 'Unassigned'}
            </div>
          )}
          {scheduledTask.notes && height >= 58 && (
            <div className="task-meta task-notes-preview">
              <StickyNote size={12} />
              <span>{scheduledTask.notes}</span>
            </div>
          )}
          {hasTimingAssumption && height >= 78 && (
            <div className="task-meta timing-assumption-preview">
              <AlertCircle size={12} />
              <span>Timing assumption</span>
            </div>
          )}
        </>
      )}
    </>
  );

  return (
    <div 
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="scheduled-task-wrapper"
      style={{ 
        height: `${elapsedHeight}px`, 
        top: `${top + 1}px`,
        left: `calc(${leftPercent}% + 1px)`,
        width: `calc(${displayWidthPercent}% - 2px)`,
        opacity: isDragging ? 0.5 : 1,
        touchAction: 'none',
        position: 'absolute',
        lineHeight: 1.2,
      }}
      onClick={(e) => {
        if (!isDragging) {
          e.stopPropagation();
          onClick(scheduledTask);
        }
      }}
    >
      {segments.map((segment, index) => {
        const segmentTop = ((segment.start - firstSegmentStart) / 60) * HOUR_ROW_HEIGHT;
        const segmentHeight = Math.max((segment.duration / 60) * HOUR_ROW_HEIGHT, 24);
        const showFullContent = index === 0;

        return (
          <div
            key={`${scheduledTask.id}-segment-${index}`}
            className={`scheduled-task scheduled-task-segment task-${scheduledTask.groupId}`}
            style={{
              height: `${segmentHeight - 2}px`,
              top: `${segmentTop}px`,
              padding: segmentHeight < 40 ? '2px 6px' : '0.5rem',
            }}
          >
            {renderTaskContent(segmentHeight, !showFullContent)}
          </div>
        );
      })}
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured);
  const [authPassword, setAuthPassword] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [schedulerReady, setSchedulerReady] = useState(!isSupabaseConfigured);
  const [syncStatus, setSyncStatus] = useState(isSupabaseConfigured ? 'Connecting…' : 'Local only');
  const [syncError, setSyncError] = useState('');
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
  const [selectedNotes, setSelectedNotes] = useState('');
  const [selectedCustomName, setSelectedCustomName] = useState('');
  const [selectedCustomDuration, setSelectedCustomDuration] = useState('30');
  const [runSetups, setRunSetups] = useState(() => createInitialRunSetups());
  const [processSetups, setProcessSetups] = useState(() => createInitialProcessSetups());
  const [employeeAvailability, setEmployeeAvailability] = useState({});
  const [miscWorkName, setMiscWorkName] = useState('Misc Work');
  const [miscWorkDuration, setMiscWorkDuration] = useState('30');
  const [expandedRunId, setExpandedRunId] = useState(null);
  const capacityScrollRef = useRef(null);
  const scheduleScrollRef = useRef(null);
  const saveTimerRef = useRef(null);

  const [activeDragItem, setActiveDragItem] = useState(null);
  const [dragTimeHint, setDragTimeHint] = useState(null);
  const visibleWeekTaskCount = scheduledTasks.filter(task => weekDayIds.has(task.dateStr) && !task.isAutomaticDaily).length;

  const syncHorizontalScroll = (source, targetRef) => {
    if (targetRef.current && targetRef.current.scrollLeft !== source.currentTarget.scrollLeft) {
      targetRef.current.scrollLeft = source.currentTarget.scrollLeft;
    }
  };

  useEffect(() => {
    if (!supabase) return undefined;

    supabase.auth.getSession().then(({ data, error }) => {
      if (error) setAuthMessage(error.message);
      setSession(data.session);
      setAuthLoading(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
      if (!nextSession) {
        setSchedulerReady(false);
        setSyncStatus('Signed out');
      }
    });

    return () => authListener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !session?.user?.id) return;
    let cancelled = false;

    const loadSchedulerState = async () => {
      setSchedulerReady(false);
      setSyncError('');
      setSyncStatus('Loading schedule…');

      const { data, error } = await supabase
        .from('scheduler_state')
        .select('state, updated_at')
        .eq('workspace_id', SCHEDULER_WORKSPACE_ID)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        setSyncError(error.message);
        setSyncStatus('Database setup needed');
        return;
      }

      const saved = data?.state || {};
      if (Array.isArray(saved.employees)) setEmployees(saved.employees);
      if (Array.isArray(saved.activeRuns)) setActiveRuns(saved.activeRuns);
      if (Array.isArray(saved.scheduledTasks)) {
        setScheduledTasks(saved.scheduledTasks.map(normalizeDailyDutyTask));
      }
      if (saved.runSetups) setRunSetups(saved.runSetups);
      if (saved.processSetups) setProcessSetups(saved.processSetups);
      if (saved.employeeAvailability) setEmployeeAvailability(saved.employeeAvailability);
      setSchedulerReady(true);
      setSyncStatus(data?.updated_at ? 'Schedule synced' : 'Ready to save');
    };

    loadSchedulerState();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  useEffect(() => {
    if (!supabase || !session?.user?.id || !schedulerReady) return undefined;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSyncStatus('Saving…');
      const state = {
        employees,
        activeRuns,
        scheduledTasks,
        runSetups,
        processSetups,
        employeeAvailability,
      };
      const { error } = await supabase
        .from('scheduler_state')
        .upsert({
          workspace_id: SCHEDULER_WORKSPACE_ID,
          state,
          updated_at: new Date().toISOString(),
          updated_by: session.user.id,
        }, { onConflict: 'workspace_id' });

      if (error) {
        setSyncError(error.message);
        setSyncStatus('Save failed');
      } else {
        setSyncError('');
        setSyncStatus('Saved');
      }
    }, 700);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [
    activeRuns,
    employeeAvailability,
    employees,
    processSetups,
    runSetups,
    scheduledTasks,
    schedulerReady,
    session?.user?.id,
  ]);

  const handlePasswordSignIn = async (event) => {
    event.preventDefault();
    if (!supabase || !authPassword) return;
    setAuthMessage('Signing in…');
    const { error } = await supabase.auth.signInWithPassword({
      email: SHARED_SCHEDULER_EMAIL,
      password: authPassword,
    });
    setAuthMessage(error ? 'Email or password is incorrect.' : '');
  };

  useEffect(() => {
    // Keep the generated daily-duty blocks aligned with the visible week.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScheduledTasks(prev => {
      const normalizedTasks = prev.map(normalizeDailyDutyTask);
      const existingIds = new Set(normalizedTasks.map(task => task.id));
      const missingDailyTasks = weekDays.flatMap(day => (
        DAILY_DUTY_BLOCKS
          .map(duty => createDailyDutyTask(day.id, duty))
          .filter(task => task && !existingIds.has(task.id))
      ));

      const normalizedChanged = normalizedTasks.some((task, index) => task !== prev[index]);
      if (missingDailyTasks.length > 0) return [...normalizedTasks, ...missingDailyTasks];
      return normalizedChanged ? normalizedTasks : prev;
    });
  }, [weekDays]);

  useEffect(() => {
    // Seed availability when a new week or employee appears.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEmployeeAvailability(prev => {
      let changed = false;
      const next = { ...prev };
      weekDays.forEach(day => {
        employees.forEach(employee => {
          const key = getAvailabilityKey(day.id, employee.id);
          if (!next[key]) {
            next[key] = getDefaultEmployeeAvailability(employee, day);
            changed = true;
          }
        });
      });
      return changed ? next : prev;
    });
  }, [employees, weekDays]);

  const handleAvailabilityChange = (dayId, employeeId, patch) => {
    const key = getAvailabilityKey(dayId, employeeId);
    setEmployeeAvailability(prev => ({
      ...prev,
      [key]: {
        ...(prev[key] || DEFAULT_AVAILABILITY),
        ...patch,
      },
    }));
  };

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

  const handleRunSetupCheeseFlavorChange = (runTemplateId, cheeseFlavor) => {
    setRunSetups(prev => ({
      ...prev,
      [runTemplateId]: {
        ...(prev[runTemplateId] || { amount: '1', assignments: {} }),
        cheeseFlavor,
      },
    }));
  };

  const handleRunSetupCheeseFlavorsChange = (runTemplateId, cheeseFlavors) => {
    const cheesePlan = getCheesePlan(cheeseFlavors);
    setRunSetups(prev => ({
      ...prev,
      [runTemplateId]: {
        ...(prev[runTemplateId] || { amount: '1', assignments: {} }),
        amount: String(cheesePlan.totalBatches),
        cheeseFlavor: cheesePlan.rows[0]?.flavor || 'Smoke',
        cheeseFlavors: cheesePlan.rows,
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

  const handleRunSetupAssignmentChange = (runTemplateId, taskId, employeeSelection) => {
    setRunSetups(prev => {
      const runSetup = prev[runTemplateId] || { amount: '1', assignments: {} };
      const employeeIds = Array.isArray(employeeSelection)
        ? employeeSelection
        : (employeeSelection ? [employeeSelection] : []);
      return {
        ...prev,
        [runTemplateId]: {
          ...runSetup,
          assignments: {
            ...runSetup.assignments,
            [taskId]: employeeIds,
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

  const handleCheeseFolderAmountChange = (amount) => {
    handleRunSetupAmountChange('run-cheese-processing', amount);
    setProcessSetups(prev => {
      const next = { ...prev };
      CHEESE_BATCH_SHARED_TASK_IDS.forEach(taskId => {
        const currentSetup = next[taskId] || { employeeIds: [] };
        next[taskId] = {
          ...currentSetup,
          amount,
          ...(CHEESE_BATCH_CONVERTIBLE_TASK_IDS.has(taskId) ? { unitMode: 'batches' } : {}),
        };
      });
      return next;
    });
  };

  const handleProcessFlavorCountChange = (taskId, flavorCount) => {
    setProcessSetups(prev => ({
      ...prev,
      [taskId]: {
        ...(prev[taskId] || { employeeIds: [] }),
        flavorCount,
      },
    }));
  };

  const handleProcessUnitModeChange = (taskId, unitMode) => {
    setProcessSetups(prev => ({
      ...prev,
      [taskId]: {
        ...(prev[taskId] || { employeeIds: [] }),
        unitMode,
      },
    }));
  };

  const handleProcessCheeseFlavorChange = (taskId, cheeseFlavor) => {
    setProcessSetups(prev => ({
      ...prev,
      [taskId]: {
        ...(prev[taskId] || { employeeIds: [] }),
        cheeseFlavor,
      },
    }));
  };

  const handleProcessEmployeeToggle = (taskId, employeeSelection, maxSelections = 1) => {
    setProcessSetups(prev => {
      const setup = prev[taskId] || { amount: '1', employeeIds: [] };
      const employeeIds = Array.isArray(employeeSelection)
        ? employeeSelection
        : (
          maxSelections > 1
            ? toggleEmployeeId(setup.employeeIds || [], employeeSelection, maxSelections)
            : (employeeSelection ? [employeeSelection] : [])
        );

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
        const cheeseFlavor = active.data.current.cheeseFlavor || 'Smoke';
        const cheeseFlavors = active.data.current.cheeseFlavors || null;
        const cheesePlan = getCheesePlan(cheeseFlavors, inputAmount, cheeseFlavor);
        const defaultEmployeeId = active.data.current.defaultEmployeeId || '';
        const assignments = active.data.current.assignments || {};
        const prepAheadTaskIds = active.data.current.prepAheadTaskIds || [];
        const layoutOffsets = getRunLayout(runTemplate, inputAmount, flavorCount, cheeseFlavor, assignments, cheeseFlavors);

        const newTasks = getActiveRunTaskIds(runTemplate, prepAheadTaskIds).map(taskId => {
          const template = taskTemplates.find(t => t.id === taskId);
          if (!template) return null;

          const taskAmount = getTaskAmountForRun(taskId, inputAmount, flavorCount, cheeseFlavor, cheeseFlavors);
          if (taskAmount <= 0) return null;

          const taskStart = addMinutesToStart(startHour, startMinute, layoutOffsets[taskId] || 0);
          const employeeIds = assignments[template.id] || (defaultEmployeeId ? [defaultEmployeeId] : []);
          const duration = getRunTaskDuration(runTemplate, taskId, inputAmount, flavorCount, employeeIds, cheeseFlavor, cheeseFlavors);

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
            notes: runTemplate.id === 'run-cheese-processing' && CHEESE_BATCH_CONVERTIBLE_TASK_IDS.has(taskId)
              ? getTaskDefaultNote(template, cheesePlan.summary)
              : getTaskDefaultNote(template),
            sourceAmount: runTemplate.id === 'run-cheese-processing' ? cheesePlan.totalBatches : undefined,
            sourceUnitMode: runTemplate.id === 'run-cheese-processing' ? 'batches' : undefined,
            cheeseFlavor: runTemplate.id === 'run-cheese-processing' ? cheeseFlavor : undefined,
            cheeseFlavors: runTemplate.id === 'run-cheese-processing' ? cheesePlan.rows : undefined,
          };
        }).filter(Boolean);

        setScheduledTasks(prev => [...prev, ...expandTasksAcrossWorkingDays(newTasks)]);
        setActiveRuns(prev => [...prev, {
          id: runId,
          templateId: runTemplate.id,
          inputAmount,
          flavorCount,
          cheeseFlavor,
          cheeseFlavors: runTemplate.id === 'run-cheese-processing' ? cheesePlan.rows : undefined,
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
        const flavorCount = Math.max(1, Number(active.data.current.flavorCount) || 1);
        const unitMode = active.data.current.unitMode || 'racks';
        const cheeseFlavor = active.data.current.cheeseFlavor || 'Smoke';
        const effectiveAmount = Math.max(1, Number(active.data.current.effectiveAmount) || inputAmount);
        const inputUnit = template.unitName;
        const employeeIds = active.data.current.employeeIds || [];
        const duration = getProcessTaskDuration(template, inputAmount, employeeIds, flavorCount, unitMode, cheeseFlavor);
        const sourceAmountLabel = CHEESE_BATCH_CONVERTIBLE_TASK_IDS.has(template.id) && unitMode === 'batches'
          ? `${formatAmountLabel(inputAmount, 'batches')} ${cheeseFlavor}`
          : template.id === TAPE_CASES_TASK_ID && unitMode !== 'cases'
          ? `${formatAmountLabel(inputAmount, 'pallets')} ${unitMode === 'cheesePallets' ? 'cheese' : 'dip'}`
          : '';
        const defaultNote = getTaskDefaultNote(template, sourceAmountLabel);

        const processTask = {
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
          inputAmount: effectiveAmount,
          flavorCount,
          inputUnit,
          buckets: effectiveAmount,
          notes: defaultNote,
          sourceAmount: inputAmount,
          sourceUnitMode: unitMode,
          cheeseFlavor,
        };
        const processTasks = createMixingCompanionTasks(processTask);
        setScheduledTasks(prev => [...prev, ...expandTasksAcrossWorkingDays(processTasks)]);
        setActiveRuns(prev => [...prev, {
          id: runId,
          templateId: null,
          inputAmount: effectiveAmount,
          flavorCount,
          inputUnit,
          baseName: template.name,
          name: getRunDisplayName(null, effectiveAmount, inputUnit, template.name),
          groupId: template.groupId,
          buckets: effectiveAmount,
        }]);
      }

      if (active.data.current?.type === 'misc-template') {
        const template = taskTemplates.find(t => t.id === 'task-misc-work');
        const runId = uuidv4();
        const duration = Math.max(5, Number(active.data.current.duration) || 30);
        const name = active.data.current.name || 'Misc Work';

        setScheduledTasks(prev => [...prev, ...splitTaskAcrossWorkingDays({
          id: uuidv4(),
          runId,
          templateId: template?.id || 'task-misc-work',
          groupId: template?.groupId || 'misc-work',
          name,
          dateStr,
          startHour,
          startMinute,
          duration,
          employeeIds: [],
          inputAmount: 1,
          inputUnit: 'block',
          buckets: 1,
          notes: '',
          isCustomWork: true,
        })]);
        setActiveRuns(prev => [...prev, {
          id: runId,
          templateId: null,
          inputAmount: 1,
          inputUnit: 'block',
          baseName: name,
          name: getRunDisplayName(null, 1, 'block', name),
          groupId: template?.groupId || 'misc-work',
          buckets: 1,
        }]);
      }
      
      if (active.data.current?.type === 'scheduled') {
        const draggedTask = active.data.current.scheduledTask;
        setScheduledTasks(prev => prev.flatMap(t => {
          if (t.id !== draggedTask.id) return [t];
          return splitTaskAcrossWorkingDays({
            ...t,
            dateStr,
            startHour,
            startMinute,
          });
        }));
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
    const customName = selectedCustomName.trim() || assigningTask.name;
    const customDuration = Math.max(5, Number(selectedCustomDuration) || assigningTask.duration || 30);

    setActiveRuns(prev => prev.map(run => run.id === assigningTask.runId
      ? {
          ...run,
          inputAmount,
          inputUnit,
          buckets: inputAmount,
          baseName: assigningTask.isCustomWork ? customName : run.baseName,
          name: assigningTask.isCustomWork
            ? getRunDisplayName(null, 1, 'block', customName)
            : getRunDisplayName(runTemplate, inputAmount, inputUnit, run.baseName || assigningTask.name),
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
      const flavorCount = Math.max(1, Number(activeRun?.flavorCount || assigningTask.flavorCount) || 1);
      const cheeseFlavor = activeRun?.cheeseFlavor || assigningTask.cheeseFlavor || 'Smoke';
      const cheeseFlavors = activeRun?.cheeseFlavors || assigningTask.cheeseFlavors || null;
      const cheesePlan = getCheesePlan(cheeseFlavors, inputAmount, cheeseFlavor);
      const layoutAssignments = Object.fromEntries(runTasks.map(t => [
        t.templateId,
        t.id === assigningTask.id ? selectedEmployees : (t.employeeIds || []),
      ]));
      const layoutOffsets = runTemplate ? getRunLayout(runTemplate, inputAmount, flavorCount, cheeseFlavor, layoutAssignments, cheeseFlavors) : {};

      runTasks.forEach(t => {
        const template = taskTemplates.find(tt => tt.id === t.templateId);
        const taskAmount = getTaskAmountForRun(t.templateId, inputAmount, flavorCount, cheeseFlavor, cheeseFlavors);
        const employeeIds = t.id === assigningTask.id ? selectedEmployees : (t.employeeIds || []);
        const duration = t.isCustomWork
          ? (t.id === assigningTask.id ? customDuration : t.duration)
          : template
          ? runTemplate
            ? getRunTaskDuration(runTemplate, t.templateId, inputAmount, flavorCount, employeeIds, cheeseFlavor, cheeseFlavors)
            : getProcessTaskDuration(template, inputAmount, employeeIds, flavorCount)
          : t.duration;
        const taskStart = firstTask
          ? addMinutesToStart(firstTask.startHour, firstTask.startMinute || 0, layoutOffsets[t.templateId] || 0)
          : { startHour: t.startHour, startMinute: t.startMinute || 0 };

        updates.set(t.id, {
          ...t,
          name: t.isCustomWork && t.id === assigningTask.id ? customName : t.name,
          dateStr: firstTask?.dateStr || t.dateStr,
          startHour: taskStart.startHour,
          startMinute: taskStart.startMinute,
          inputAmount: taskAmount,
          inputUnit: template?.unitName || inputUnit,
          buckets: taskAmount,
          flavorCount,
          duration,
          employeeIds,
          notes: t.id === assigningTask.id ? selectedNotes.trim() : (t.notes || ''),
          cheeseFlavor: runTemplate?.id === 'run-cheese-processing' ? cheeseFlavor : t.cheeseFlavor,
          cheeseFlavors: runTemplate?.id === 'run-cheese-processing' ? cheesePlan.rows : t.cheeseFlavors,
          sourceAmount: runTemplate?.id === 'run-cheese-processing' ? cheesePlan.totalBatches : t.sourceAmount,
          sourceUnitMode: runTemplate?.id === 'run-cheese-processing' ? 'batches' : t.sourceUnitMode,
        });
      });

      return prev.map(t => updates.get(t.id) || t);
    });

    setIsAssignModalOpen(false);
    setAssigningTask(null);
  };

  const handleDeleteTask = () => {
    if (!assigningTask) return;
    if (assigningTask.isAutomaticDaily) return;

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

    const remainingTasks = scheduledTasks.filter(task => !weekDayIds.has(task.dateStr) || task.isAutomaticDaily);
    const remainingRunIds = new Set(remainingTasks.map(task => task.runId));

    setScheduledTasks(remainingTasks);
    setActiveRuns(prev => prev.filter(run => remainingRunIds.has(run.id)));

    if (assigningTask && weekDayIds.has(assigningTask.dateStr)) {
      setIsAssignModalOpen(false);
      setAssigningTask(null);
    }
  };

  if (!isSupabaseConfigured) {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <h1>Supabase configuration needed</h1>
          <p>Add the project URL and publishable key to the Vercel project environment variables.</p>
        </section>
      </main>
    );
  }

  if (authLoading) {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <h1>Millsie Scheduler</h1>
          <p>Connecting securely…</p>
        </section>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="auth-screen">
        <form className="auth-card" onSubmit={handlePasswordSignIn}>
          <h1>Millsie Scheduler</h1>
          <p>Enter the shared production scheduling password.</p>
          <label>
            <span>Password</span>
            <input
              type="password"
              value={authPassword}
              onChange={event => setAuthPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <button type="submit" className="btn btn-primary">Sign in</button>
          {authMessage && <div className="auth-message">{authMessage}</div>}
        </form>
      </main>
    );
  }

  if (!schedulerReady) {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <h1>Millsie Scheduler</h1>
          <p>{syncError ? 'The shared schedule database needs attention.' : 'Loading the shared schedule…'}</p>
          {syncError && <div className="auth-error">{syncError}</div>}
          <button type="button" className="btn btn-secondary" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </section>
      </main>
    );
  }

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
                {runTemplates.filter(runTemplate => runTemplate.id !== 'run-sanitation-qa').map(runTemplate => {
                  const runSetup = runSetups[runTemplate.id] || { amount: '1', assignments: {} };
                  if (
                    runTemplate.id === 'run-dip-mixing'
                    || runTemplate.id === 'run-dip-processing'
                    || runTemplate.id === 'run-veg-prep'
                    || runTemplate.id === 'run-packaging-prep'
                    || runTemplate.id === 'run-support'
                  ) {
                    return (
                      <ProcessFolder
                        key={runTemplate.id}
                        runTemplate={runTemplate}
                        taskTemplates={taskTemplates}
                        employees={employees}
                        processSetups={processSetups}
                        folderAmount={runSetup.amount || '1'}
                        isExpanded={expandedRunId === runTemplate.id}
                        onToggle={() => setExpandedRunId(prev => prev === runTemplate.id ? null : runTemplate.id)}
                        onFolderAmountChange={runTemplate.id === 'run-cheese-processing' ? handleCheeseFolderAmountChange : amount => handleRunSetupAmountChange(runTemplate.id, amount)}
                        onAmountChange={handleProcessAmountChange}
                        onFlavorCountChange={handleProcessFlavorCountChange}
                        onUnitModeChange={handleProcessUnitModeChange}
                        onCheeseFlavorChange={handleProcessCheeseFlavorChange}
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
                      cheeseFlavor={runSetup.cheeseFlavor || 'Smoke'}
                      cheeseFlavors={runSetup.cheeseFlavors || DEFAULT_CHEESE_FLAVORS}
                      defaultEmployeeId={runSetup.defaultEmployeeId || ''}
                      assignments={runSetup.assignments}
                      prepAheadTaskIds={runSetup.prepAheadTaskIds || []}
                      isExpanded={expandedRunId === runTemplate.id}
                      onToggle={() => setExpandedRunId(prev => prev === runTemplate.id ? null : runTemplate.id)}
                      onAmountChange={amount => handleRunSetupAmountChange(runTemplate.id, amount)}
                      onFlavorCountChange={flavorCount => handleRunSetupFlavorCountChange(runTemplate.id, flavorCount)}
                      onCheeseFlavorChange={cheeseFlavor => handleRunSetupCheeseFlavorChange(runTemplate.id, cheeseFlavor)}
                      onCheeseFlavorsChange={cheeseFlavors => handleRunSetupCheeseFlavorsChange(runTemplate.id, cheeseFlavors)}
                      onDefaultEmployeeChange={employeeId => handleRunSetupDefaultEmployeeChange(runTemplate.id, employeeId)}
                      onAssignmentChange={(taskId, employeeId) => handleRunSetupAssignmentChange(runTemplate.id, taskId, employeeId)}
                    />
                  );
                })}
                <DraggableMiscTemplate
                  name={miscWorkName}
                  duration={miscWorkDuration}
                  onNameChange={setMiscWorkName}
                  onDurationChange={setMiscWorkDuration}
                />
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
              <span className={`sync-status ${syncError ? 'has-error' : ''}`}>{syncStatus}</span>
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
              <button className="btn btn-secondary" onClick={() => supabase.auth.signOut()}>
                Sign out
              </button>
            </div>
          </div>

          <EmployeeCapacityHeader
            weekDays={weekDays}
            employees={employees}
            scheduledTasks={scheduledTasks}
            availability={employeeAvailability}
            onAvailabilityChange={handleAvailabilityChange}
            scrollRef={capacityScrollRef}
            onScroll={event => syncHorizontalScroll(event, scheduleScrollRef)}
          />

          <div
            className="schedule-grid-container"
            ref={scheduleScrollRef}
            onScroll={event => syncHorizontalScroll(event, capacityScrollRef)}
          >
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
                          setSelectedNotes(task.notes || '');
                          setSelectedCustomName(task.name || 'Misc Work');
                          setSelectedCustomDuration(String(task.duration || 30));
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
                {assigningTask.isCustomWork ? (
                  <>
                    <div className="form-group">
                      <label>Block name</label>
                      <input
                        type="text"
                        value={selectedCustomName}
                        onChange={e => setSelectedCustomName(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Duration minutes</label>
                      <input
                        type="number"
                        min="5"
                        step="5"
                        value={selectedCustomDuration}
                        onChange={e => setSelectedCustomDuration(e.target.value)}
                        required
                      />
                    </div>
                  </>
                ) : (
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
                )}
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
                <div className="form-group">
                  <label>Notes</label>
                  <div className="quick-note-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setSelectedNotes(prev => mergeNotes(prev, 'Carryover from previous day.'))}
                    >
                      From yesterday
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setSelectedNotes(prev => mergeNotes(prev, 'Prep for next day.'))}
                    >
                      For tomorrow
                    </button>
                  </div>
                  <textarea
                    className="notes-field"
                    value={selectedNotes}
                    onChange={e => setSelectedNotes(e.target.value)}
                    placeholder="Flavours, SKU notes, special instructions..."
                    rows={4}
                  />
                </div>
                <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
                  {assigningTask.isAutomaticDaily ? (
                    <span />
                  ) : (
                    <button type="button" className="btn" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }} onClick={handleDeleteTask}>Remove from Schedule</button>
                  )}
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
          ) : activeDragItem.data.current?.type === 'misc-template' ? (
            <div className="task-template task-misc-work" style={{ margin: 0, opacity: 0.9, width: '260px', pointerEvents: 'none' }}>
              <GripVertical size={16} className="drag-handle-icon" />
              <div className="task-content-wrapper">
                <div className="task-title" style={{ fontSize: '0.875rem' }}>{activeDragItem.data.current.name}</div>
                <div className="task-meta">
                  <Clock size={12} />
                  {formatDuration(activeDragItem.data.current.duration)}
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
