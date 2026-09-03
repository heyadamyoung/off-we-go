import * as defaultOidc from 'openid-client'

export function readOidcConfig(env) {
  const required = name => {
    const value = String(env[name] || '').trim()
    if (!value) throw new Error(`${name} is required`)
    return value
  }
  return {
    issuer: required('WAYFARE_OIDC_ISSUER').replace(/\/$/, ''),
    clientId: required('WAYFARE_OIDC_CLIENT_ID'),
    clientSecret: required('WAYFARE_OIDC_CLIENT_SECRET'),
  }
}

export function createOidcIdentityProvider({ issuer, clientId, clientSecret, oidc = defaultOidc }) {
  if (!issuer || !clientId || !clientSecret)
    throw new Error('OIDC issuer, client ID, and client secret are required')
  let configuration = null
  const getConfiguration = async () => {
    if (!configuration) {
      configuration = Promise.resolve().then(() =>
        oidc.discovery(
          new URL(issuer),
          clientId,
          { client_secret: clientSecret },
          oidc.ClientSecretBasic(clientSecret),
        ),
      )
    }
    try {
      return await configuration
    } catch (error) {
      configuration = null
      throw error
    }
  }

  return {
    async authorizationUrl({ redirectUri, state, nonce, codeChallenge }) {
      const config = await getConfiguration()
      return oidc.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid profile email',
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      }).href
    },

    async exchangeCallback({ currentUrl, redirectUri, state, nonce, codeVerifier }) {
      const config = await getConfiguration()
      const tokens = await oidc.authorizationCodeGrant(
        config,
        new URL(currentUrl),
        {
          pkceCodeVerifier: codeVerifier,
          expectedState: state,
          expectedNonce: nonce,
          idTokenExpected: true,
        },
        { redirect_uri: redirectUri },
      )
      const claims = tokens.claims()
      if (!claims) throw new Error('The identity provider did not return ID token claims')
      return {
        issuer: claims.iss,
        subject: claims.sub,
        email: claims.email,
        emailVerified: claims.email_verified === true,
        name: claims.name || claims.preferred_username || null,
      }
    },

    async endSessionUrl({ postLogoutRedirectUri }) {
      const config = await getConfiguration()
      return oidc.buildEndSessionUrl(config, {
        client_id: clientId,
        post_logout_redirect_uri: postLogoutRedirectUri,
      }).href
    },
  }
}
