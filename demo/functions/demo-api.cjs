const {createDemoState, openDemoStore} = require('../../netlify/lib/demo-state.cjs');
const {createProviderCleanup} = require('../../netlify/lib/demo-provider-cleanup.cjs');
const {createDemoGateway} = require('../../netlify/lib/demo-gateway.cjs');

// This is the only function deployed by netlify.demo.toml. Legacy/test endpoints are not published.
exports.default = createDemoGateway({
  videoEnabled:() => process.env.DEMO_DISABLE_VIDEO !== 'true',
  stateFactory:event => createDemoState({
    store:openDemoStore(event), password:process.env.DEMO_PRESENTER_PASSWORD,
    secret:process.env.DEMO_COOKIE_SECRET,
    origin:process.env.DEMO_ORIGIN || process.env.DEPLOY_PRIME_URL,
    removeInteraction:createProviderCleanup({apiKey:process.env.GOOGLE_DEVELOPER_API_KEY || process.env.GEMINI_API_KEY})
  }),
  handlers:{
    text:event => require('../../netlify/functions/generate.js').handler(event),
    image:event => require('../../netlify/functions/generate-ai-image.cjs').handler(event),
    video:event => require('../../netlify/functions/start-veo-video.cjs').handler(event),
    status:event => require('../../netlify/functions/veo-video-status.cjs').handler(event),
    download:event => require('../../netlify/functions/download-veo-video.cjs').download(event)
  }
});
