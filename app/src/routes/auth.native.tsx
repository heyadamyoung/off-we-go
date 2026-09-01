import { createFileRoute } from '@tanstack/react-router'
import { NativeLoginHandoff } from '../features/auth'

export const Route = createFileRoute('/auth/native')({ component: NativeLoginHandoff })
