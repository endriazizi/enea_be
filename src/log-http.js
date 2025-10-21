const logger = require('./logger');


module.exports = function httpLogger(req, res, next) {
const start = Date.now();
const { method, url, headers } = req;
const reqBody = req.body; // express.json già attivo in server.js


// intercetta res.send/res.json per catturare il body
const oldJson = res.json.bind(res);
const oldSend = res.send.bind(res);
let respBody;


res.json = (data) => { respBody = data; return oldJson(data); };
res.send = (data) => { respBody = data; return oldSend(data); };


res.on('finish', () => {
const ms = Date.now() - start;
// Evita log eccessivi: limita response a 2048 caratteri
const respPreview = typeof respBody === 'string' ? respBody : JSON.stringify(respBody);
const limitedResp = respPreview?.length > 2048 ? respPreview.slice(0, 2048) + '...[truncated]' : respPreview;


logger.info({
msg: 'HTTP', method, url, status: res.statusCode, ms, headers,
reqBody,
respBody: limitedResp
});
});


next();
};