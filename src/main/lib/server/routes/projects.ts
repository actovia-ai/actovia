import { existsSync } from 'fs'

import { NotFoundError } from '@exodus/shared'
import { dialog } from 'electron'
import { Hono } from 'hono'
import { z } from 'zod'

import {
  bindConversation,
  createNewProject,
  gitBranch,
  openFolderAsProject
} from '../../agents/projects'
import { getConversationById } from '../../db/conversation-queries'
import {
  getProjectById,
  listRecentProjects,
  updateProject
} from '../../db/project-queries'
import { getMainWindow } from '../../window'
import { desktopOnly } from '../middlewares/desktop-only'
import type { Variables } from '../types'
import { getRequiredParam, successResponse, validateSchema } from '../utils'

const router = new Hono<{ Variables: Variables }>()

router.get('/', async (c) => successResponse(c, await listRecentProjects()))

router.post('/', desktopOnly, async (c) => {
  const { name } = validateSchema(
    z.object({ name: z.string().trim().min(1).max(80) }),
    await c.req.json(),
    'Invalid name'
  )
  return successResponse(c, await createNewProject(name))
})

router.post('/pick', desktopOnly, async (c) => {
  const win = getMainWindow()
  const opts = {
    properties: ['openDirectory', 'createDirectory'] as Array<
      'openDirectory' | 'createDirectory'
    >
  }
  const result = win
    ? await dialog.showOpenDialog(win, opts)
    : await dialog.showOpenDialog(opts)
  return successResponse(c, {
    path: result.canceled ? null : (result.filePaths[0] ?? null)
  })
})

router.post('/open', desktopOnly, async (c) => {
  const { folder } = validateSchema(
    z.object({ folder: z.string().min(1) }),
    await c.req.json(),
    'Invalid folder'
  )
  return successResponse(c, await openFolderAsProject(folder))
})

router.get('/conversations/:id', async (c) => {
  const conversation = await getConversationById(getRequiredParam(c, 'id'))
  const project = conversation?.projectId
    ? ((await getProjectById(conversation.projectId)) ?? null)
    : null
  // An opened folder can be moved or deleted behind Actovia' back (spec §10).
  const missing = project ? !existsSync(project.workDir) : false
  return successResponse(c, {
    project,
    missing,
    branch: project && !missing ? await gitBranch(project.workDir) : null
  })
})

router.put('/conversations/:id', desktopOnly, async (c) => {
  const { projectId } = validateSchema(
    z.object({ projectId: z.string().uuid().nullable() }),
    await c.req.json(),
    'Invalid project'
  )
  await bindConversation(getRequiredParam(c, 'id'), projectId)
  return successResponse(c, { success: true })
})

router.patch('/:id', desktopOnly, async (c) => {
  const id = getRequiredParam(c, 'id')
  const { useWorktrees } = validateSchema(
    z.object({ useWorktrees: z.boolean() }),
    await c.req.json(),
    'Invalid project'
  )
  if (!(await getProjectById(id))) throw new NotFoundError()
  return successResponse(c, await updateProject(id, { useWorktrees }))
})

export default router
