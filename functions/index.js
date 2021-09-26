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

exports.cronJob = functions.pubsub.schedule('0 10 * * *').onRun(async () => {
    const miners = await common.db.collection('miners').get();
    miners.forEach(async doc => {
        console.log("Processing:" + doc.id + "; enabled=" + doc.data().enabled);
        if (doc.data().enabled) {
            await common.cronMiner(doc.id);
        }
    });
});