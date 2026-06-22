export const initialEmployees = [
  { id: 'emp-1', name: 'Alice', skills: { 'task-sanitation': 'expert', 'task-boiling': 'beginner', 'task-cleanup': 'expert' } },
  { id: 'emp-2', name: 'Bob', skills: { 'task-sanitation': 'beginner', 'task-boiling': 'expert', 'task-cleanup': 'expert' } },
  { id: 'emp-3', name: 'Charlie', skills: { 'task-sanitation': 'untrained', 'task-boiling': 'untrained', 'task-cleanup': 'beginner' } },
];

export const taskTemplates = [
  {
    id: 'task-sanitation',
    groupId: 'ferment-prep',
    name: 'Bucket Sanitation',
    colorVar: '--ferment',
    baseMinutes: 0,
    variableMinutesPerCycle: 60,
    unitsPerCycle: 46,
    unitName: 'buckets',
    isBatchProcess: false, // continuous scaling
  },
  {
    id: 'task-stickering',
    groupId: 'ferment-prep',
    name: 'Stickering & Holdbac',
    colorVar: '--ferment',
    baseMinutes: 0,
    variableMinutesPerCycle: 15,
    unitsPerCycle: 48,
    unitName: 'buckets',
    isBatchProcess: false,
  },
  {
    id: 'task-boiling',
    groupId: 'ferment-prep',
    name: 'Fermentation Boiling',
    colorVar: '--ferment',
    baseMinutes: 0,
    variableMinutesPerCycle: 18,
    unitsPerCycle: 3,
    unitName: 'buckets',
    isBatchProcess: true, // Must run full cycles
  },
  {
    id: 'task-mixing',
    groupId: 'ferment-prep',
    name: 'Fermentation Mixing',
    colorVar: '--ferment',
    baseMinutes: 0,
    variableMinutesPerCycle: 4.8,
    unitsPerCycle: 1.75,
    unitName: 'buckets',
    isBatchProcess: true,
  },
  {
    id: 'task-cleanup',
    groupId: 'ferment-prep',
    name: 'Ferment Cleanup',
    colorVar: '--ferment',
    baseMinutes: 120,
    variableMinutesPerCycle: 0,
    unitsPerCycle: 1,
    unitName: 'buckets',
    isBatchProcess: false,
  },
  {
    id: 'task-beets',
    groupId: 'veg-prep',
    name: 'Roasting Beets',
    colorVar: '--veg',
    baseMinutes: 0,
    variableMinutesPerCycle: 60,
    unitsPerCycle: 1,
    unitName: 'batches',
    isBatchProcess: false,
  },
  {
    id: 'task-cucumber',
    groupId: 'veg-prep',
    name: 'Cucumber Prep',
    colorVar: '--veg',
    baseMinutes: 0,
    variableMinutesPerCycle: 45,
    unitsPerCycle: 1,
    unitName: 'batches',
    isBatchProcess: false,
  },
  {
    id: 'task-jalapeno',
    groupId: 'veg-prep',
    name: 'Jalapeno Prep',
    colorVar: '--veg',
    baseMinutes: 0,
    variableMinutesPerCycle: 30,
    unitsPerCycle: 1,
    unitName: 'batches',
    isBatchProcess: false,
  },
  {
    id: 'task-basil',
    groupId: 'veg-prep',
    name: 'Basil Prep',
    colorVar: '--veg',
    baseMinutes: 0,
    variableMinutesPerCycle: 30,
    unitsPerCycle: 1,
    unitName: 'batches',
    isBatchProcess: false,
  },
  {
    id: 'task-cilantro',
    groupId: 'veg-prep',
    name: 'Cilantro Prep',
    colorVar: '--veg',
    baseMinutes: 0,
    variableMinutesPerCycle: 30,
    unitsPerCycle: 1,
    unitName: 'batches',
    isBatchProcess: false,
  }
];

export const runTemplates = [
  {
    id: 'run-fermentation',
    name: 'Fermentation Run',
    groupId: 'ferment-prep',
    inputUnit: 'cases',
    bucketsPerInputUnit: 3,
    tasks: [
      'task-sanitation',
      'task-stickering',
      'task-boiling',
      'task-mixing',
      'task-cleanup'
    ]
  },
  {
    id: 'run-veggie-prep',
    name: 'Veggie Prep Run',
    groupId: 'veg-prep',
    inputUnit: 'batches',
    bucketsPerInputUnit: 1,
    tasks: [
      'task-beets',
      'task-cucumber',
      'task-jalapeno',
      'task-basil',
      'task-cilantro'
    ]
  }
];

export const daysOfWeek = [
  { id: 'mon', name: 'Monday' },
  { id: 'tue', name: 'Tuesday' },
  { id: 'wed', name: 'Wednesday' },
  { id: 'thu', name: 'Thursday' },
  { id: 'fri', name: 'Friday' }
];

// Hours from 7 AM to 5 PM
export const hoursOfDay = Array.from({ length: 11 }, (_, i) => i + 7);
