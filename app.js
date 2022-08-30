import express from 'express'
import axios from 'axios';
import {Issuer, generators} from 'openid-client'

const app = express()

const listen_port = process.env.PORT || 5555

const neon_oauth_url = 'https://oauth2.stage.neon.tech'
const neon_api_url = 'https://console.stage.neon.tech/api/v1'

// Show index page with link to Neon project creation
app.get('/', async (req, res) => {
  // Instantiate OAuth client
  console.log('GOT REQUEST', req.url)
  const redirect_uri = req.protocol + '://' + req.get('host') + '/callback'
  console.log('REDIRECT URL IS:', redirect_uri);

  let neonIssuer = await Issuer.discover(neon_oauth_url)
  const neonOAuthClient = new neonIssuer.Client({
    client_id: process.env.NEON_OAUTH_ID,
    redirect_uris: [redirect_uri],
    response_types: ['code'],
    client_secret: process.env.NEON_OAUTH_SECRET,
  })

  // Store the code_verifier in memory
  const state = generators.state()
  const codeVerifier = generators.codeVerifier()
  const codeChallenge = generators.codeChallenge(codeVerifier)

  const authUrl = neonOAuthClient.authorizationUrl({
    scope: `openid offline`,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })
  res.send(`Hello! <a href="#" onclick="window.open('${authUrl}', 'popup', 'width=800,height=600')">Create database at Neon</a>`)
})

// Callback to catch OAuth redirect and ask API for project connection string
app.get('/callback', async (req, res) => {
  console.log('GOT CB REQUEST', req.url)

  const redirect_uri = req.protocol + '://' + req.get('host') + '/callback'
  console.log('REDIRECT URL IS:', redirect_uri);
  try {
    // finish OAuth and get access_token
    const params = neonOAuthClient.callbackParams(req);
    const tokenSet = await neonOAuthClient.callback(redirect_uri, params, { code_verifier: codeVerifier, state });

    // With access token we can talk with Neon API on behalf of the user
    const neonClient = axios.create({
      baseURL: neon_api_url,
      headers: {'Authorization': `Bearer ${tokenSet.access_token}`}
    });

    // We need to get project that we have access to. Normally it would one,
    // so select the first.
    let project = (await neonClient.get(`/projects`)).data[0];

    // Use the first user and database in this project. "web_access" is an internal role
    // and will disapper soon, so filter it out.
    let role = project.roles.filter(role => role.name != "web_access")[0]
    let dbname = project.databases[0].name

    // Neon does not store role passwords, so we need to reset it to get an unencrypted one.
    let dsn_with_pass = (await neonClient.post(`/projects/${project.id}/roles/${role.name}/reset_password`)).data.dsn;

    console.log('SUCCESS! DSN is:', dsn_with_pass)
    // Okay, we can show connection string
    res.send(`Done: you can connect to '${dsn_with_pass}/${dbname}'`)
  } catch (e) {
    console.error('FAILED TO OAUTH', e);
  }
})

app.listen(listen_port, () => {
  console.log(`Listening on port ${listen_port}`)
})
