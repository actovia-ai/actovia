import { MotionConfig } from 'motion/react'
import { useEffect, type ReactNode } from 'react'

import { useSettings } from '@/hooks/use-settings'
import { applyReducedMotion, useReducedMotion } from '@/lib/reduced-motion'

export function MotionProvider({ children }: { children: ReactNode }) {
  const { data } = useSettings()
  const reduce = useReducedMotion()
  useEffect(() => {
    if (data !== undefined) applyReducedMotion(data.reduceMotion === true)
  }, [data?.reduceMotion, data !== undefined])
  return (
    <MotionConfig reducedMotion={reduce ? 'always' : 'never'}>
      {children}
    </MotionConfig>
  )
}
