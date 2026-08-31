import type { AuthSession } from './shared/model/types'

interface ExperienceApiClient {
  request<T = any>(path: string, options?: {
    method?: string; body?: unknown; headers?: Record<string, string>
  }): Promise<T>
  acceptSession(session: AuthSession): Promise<AuthSession | null>
}

export function createLogtoExperienceClient(api: ExperienceApiClient) {
  let interaction = ''
  const call = <T = any>(path: string, method: string, body: unknown = {}) =>
    api.request<T>(`/auth/experience${path}`, {
      method, body, headers: interaction ? { 'x-wayfare-experience': interaction } : undefined,
    })
  const begin = async (interactionEvent: 'SignIn' | 'Register') => {
    const started = await api.request<{ interaction: string }>('/auth/experience/start', {
      method: 'POST', body: {},
    })
    interaction = started.interaction
    await call('', 'PUT', { interactionEvent })
  }
  const finish = async (verificationId: string) => {
    await call('/identification', 'POST', { verificationId })
    const session = await call<AuthSession>('/submit', 'POST')
    return api.acceptSession(session)
  }

  return {
    async signIn(email: string, password: string) {
      const normalizedEmail = email.trim().toLowerCase()
      await begin('SignIn')
      const verification = await call<{ verificationId: string }>('/verification/password', 'POST', {
        identifier: { type: 'email', value: normalizedEmail }, password,
      })
      return finish(verification.verificationId)
    },

    async sendRegistrationCode(email: string) {
      const normalizedEmail = email.trim().toLowerCase()
      await begin('Register')
      const verification = await call<{ verificationId: string }>('/verification/verification-code', 'POST', {
        identifier: { type: 'email', value: normalizedEmail }, interactionEvent: 'Register',
      })
      return verification.verificationId
    },

    async completeRegistration({ verificationId, code, password }:
      { verificationId: string; code: string; password: string }) {
      await call('/verification/verification-code/verify', 'POST', { verificationId, code: code.trim() })
      await call('/profile', 'POST', { type: 'password', value: password })
      return finish(verificationId)
    },
  }
}
