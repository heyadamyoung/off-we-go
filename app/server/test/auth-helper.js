import { createHash, randomBytes } from 'node:crypto'

export async function authenticate(repository, email) {
  const user = await repository.ensureUser(email.toLowerCase())
  const accessToken = randomBytes(32).toString('base64url')
  await repository.createSession({
    hash: createHash('sha256').update(accessToken).digest('hex'),
    userId: user.id,
    expiresAt: new Date('2100-01-01T00:00:00.000Z'),
  })
  return `Bearer ${accessToken}`
}
