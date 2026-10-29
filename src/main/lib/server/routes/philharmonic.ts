import { Hono } from 'hono'

import type { Variables } from '../types'
import philharmonicAvatar from './philharmonic-avatar'
import philharmonicConversations from './philharmonic-conversations'
import philharmonicCrud from './philharmonic-crud'
import philharmonicSse from './philharmonic-sse'
import philharmonicTasks from './philharmonic-tasks'

export { emitToAll, emitToTask, emitToConversation } from './philharmonic-sse'

const philharmonic = new Hono<{ Variables: Variables }>()

philharmonic.route('/', philharmonicAvatar)
philharmonic.route('/', philharmonicCrud)
philharmonic.route('/', philharmonicSse)
philharmonic.route('/', philharmonicConversations)
philharmonic.route('/', philharmonicTasks)

export default philharmonic
