// The period report's wire examples (actovia-ios trends, phase 2). actovia-ios's
// PeriodReportWireTests holds the same JSON, so the two sides agree on it.
export const PERIOD_REQUEST = {
  period: { kind: 'month', start: '2026-09-01', end: '2026-09-30' },
  current: {
    elapsedDays: 30,
    daysWithData: 28,
    sleepMin: { average: 432, min: 350, max: 510, days: 28 },
    steps: { average: 7040, min: 2100, max: 13200, days: 28 },
    exerciseMin: { average: 24, min: 0, max: 75, days: 28 },
    hrvMs: { average: 44, min: 31, max: 58, days: 27 },
    restingHr: { average: 59, min: 55, max: 64, days: 27 },
    waterCups: { days: 0 },
    stepGoalRate: 0.32,
    sleepTargetRate: 0.6
  },
  previous: {
    elapsedDays: 31,
    daysWithData: 31,
    sleepMin: { average: 407, min: 330, max: 480, days: 31 },
    steps: { average: 8000, min: 3100, max: 15000, days: 31 },
    exerciseMin: { average: 24, min: 0, max: 60, days: 31 },
    hrvMs: { average: 43, min: 30, max: 55, days: 31 },
    restingHr: { average: 61, min: 57, max: 66, days: 31 },
    waterCups: { days: 0 },
    stepGoalRate: 0.45,
    sleepTargetRate: 0.42
  },
  notes: [
    {
      day: '2026-09-15',
      headline: 'A little under-slept, so take it easy.',
      insights: [
        {
          category: 'sleep',
          title:
            'You slept 5 h 52 min last night, about half an hour less than usual.'
        }
      ]
    }
  ],
  habits: [],
  locale: 'en'
}

// A report as the model writes it (no `period` — the desktop adds the request's).
export const PERIOD_REPORT = {
  headline: 'More sleep, fewer steps than in August.',
  headlineHighlight: 'More sleep',
  headlineCategory: 'sleep',
  insights: [
    {
      category: 'sleep',
      title:
        'You slept 7 h 12 min a night on average, 25 minutes more than in August.',
      highlights: ['7 h 12 min', '25 minutes more'],
      stat: { value: '7:12', unit: 'hr', caption: 'August 6:47' }
    },
    {
      category: 'activity',
      title:
        'Daily steps fell 12 % to 7,040; you reached your goal on 9 of 28 days.',
      highlights: ['fell 12 %', '9 of 28 days'],
      stat: { value: '7,040', unit: 'steps', caption: 'August 8,000' }
    },
    {
      category: 'recovery',
      title:
        'Resting heart rate eased to 59 bpm from 61, and HRV held at 44 ms.',
      highlights: ['59 bpm']
    }
  ],
  comparisons: [
    {
      metric: 'sleep',
      current: '7 h 12 min',
      previous: '6 h 47 min',
      direction: 'up'
    },
    { metric: 'steps', current: '7,040', previous: '8,000', direction: 'down' },
    { metric: 'hrv', current: '44 ms', previous: '43 ms', direction: 'flat' },
    {
      metric: 'restingHr',
      current: '59 bpm',
      previous: '61 bpm',
      direction: 'down'
    }
  ],
  nudge: 'Take a short walk after lunch on workdays.'
}
