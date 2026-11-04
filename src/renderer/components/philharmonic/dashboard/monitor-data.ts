import type { PlanDto } from '@actovia/shared/types/philharmonic'

/** Real plan updates in local calendar days, including quiet days. */
export function monitorData(plans: PlanDto[], now = new Date()) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 6 + index
    )
    return { date: date.getTime(), completed: 0, active: 0, stopped: 0 }
  })
  const steps = { done: 0, running: 0, pending: 0, failed: 0 }
  for (const plan of plans) {
    const date = new Date(plan.updatedAt)
    const day = days.find(
      (d) =>
        d.date ===
        new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
    )
    if (day)
      day[
        plan.status === 'completed'
          ? 'completed'
          : plan.status === 'aborted'
            ? 'stopped'
            : 'active'
      ]++
    for (const step of plan.steps)
      steps[step.status === 'skipped' ? 'done' : step.status]++
  }
  return { days, steps }
}
