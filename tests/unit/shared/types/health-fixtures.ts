// The spec's §4 examples; actovia-ios's HealthWireTests holds the same JSON,
// so the two sides agree on the wire.
export const SNAPSHOT = {
  date: '2026-10-01',
  localTime: '15:00',
  locale: 'zh-Hant',
  sleep: {
    asleepMin: 372,
    baselineMin: 425,
    deepMin: 52,
    coreMin: 209,
    remMin: 81,
    awakeMin: 30,
    bedtime: '23:48',
    wake: '06:00'
  },
  activity: {
    steps: 5840,
    stepGoal: 8000,
    activeKcal: 310,
    kcalGoal: 500,
    exerciseMin: 12,
    standHours: 6,
    workouts: []
  },
  recovery: {
    level: 'low',
    hrvMs: 38,
    hrvBaselineMs: 44,
    restingHr: 61,
    restingHrBaseline: 58,
    respRate: 14.2
  },
  body: { waterCups: 3, weightKg: null, weightTrend30d: null, mood: null },
  odyState: 'tired'
}

export const SUMMARY = {
  headline: '有點沒睡飽',
  summary: '昨晚只睡了 **6 小時 12 分**。',
  categories: {
    sleep: '深睡偏少。',
    activity: '還差 2,160 步。',
    recovery: 'HRV 偏低。',
    body: null
  },
  memorySuggestion: {
    section: 'profile',
    key: 'weekday-sleep',
    summary: '工作日平均只睡 6 小時左右'
  }
}

// A structured report as the model writes it (no `summary` — the desktop fills that in for older clients).
export const REPORT = {
  headline: '有點沒睡飽，記得多走走。',
  headlineHighlight: '有點沒睡飽',
  headlineCategory: 'sleep',
  insights: [
    {
      category: 'sleep',
      text: '昨晚只睡了 6 小時 12 分，比平時少了將近一小時。',
      highlights: ['6 小時 12 分'],
      stat: { value: '6:12', unit: '小時', caption: '平時 7:05' }
    },
    {
      category: 'recovery',
      text: 'HRV 38 ms，低於你的 44 基線，身體還在恢復。',
      highlights: ['38 ms', '身體還在恢復']
    },
    {
      category: 'activity',
      text: '今天走了 5,840 步，離 8,000 的目標還差 2,160 步。',
      highlights: ['5,840 步'],
      stat: { value: '5,840', unit: '步', caption: '目標 8,000' }
    }
  ],
  nudge: '今晚早點上床，睡前少看螢幕。',
  categories: SUMMARY.categories,
  memorySuggestion: SUMMARY.memorySuggestion
}
