const functions = require("firebase-functions")
const app = require('express')()
const common = require('./common')

const { setupMiner } = require('./api/setupMiner')
const { stats } = require('./api/stats')
const { collect } = require('./api/collect')

app.get('/setupMiner/:miner', setupMiner)
app.get('/stats/:miner', stats)
app.get('/collect/:miner', collect)
app.get(
    ['/setupMiner', '/stats', 'collect'],
    function ( req, res ) {
        res.status(400).send("Invalid empty miner");
    }
)
exports.api = functions.https.onRequest(app);
exports.cronJob = functions.pubsub.schedule('0 10 * * *')
    .retryConfig({retryCount: 3})
    .onRun(async () => { await common.collectMinersData() });