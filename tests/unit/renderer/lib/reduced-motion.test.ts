// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'

import {
  applyReducedMotion,
  bootReducedMotion,
  isMotionReduced
} from '@/lib/reduced-motion'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-reduce-motion')
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
})
it('restores the app preference before render and never overrides the OS', () => {
  applyReducedMotion(true)
  expect(isMotionReduced()).toBe(true)
  document.documentElement.removeAttribute('data-reduce-motion')
  bootReducedMotion()
  expect(isMotionReduced()).toBe(true)
  applyReducedMotion(false)
  expect(isMotionReduced()).toBe(false)
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  expect(isMotionReduced()).toBe(true)
})
it('malformed cached values fall back to the system', () => {
  localStorage.setItem('actovia-reduce-motion', 'broken')
  bootReducedMotion()
  expect(isMotionReduced()).toBe(false)
})
