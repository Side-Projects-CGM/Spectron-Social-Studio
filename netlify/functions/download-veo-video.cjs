const { download } = require('./download-veo-test.cjs');
const { serveDownload } = require('../lib/video-stream.cjs');
exports.download = (event, context) => download(event, context, 'ai-video');
exports.default = request => serveDownload(request, download, 'ai-video');
