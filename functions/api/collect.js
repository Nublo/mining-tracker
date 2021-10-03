const functions = require("firebase-functions");
const common = require('../common')

exports.collect = functions.https.onRequest(async (req, res) => {
    let miner = req.params.miner;
    const minerExistsResult = await common.isMinerExists(miner);
    if (!minerExistsResult) {
        res.status(400).send("Unknown miner - " + miner);
        return;
    }

    const minerDoc = await common.db.collection('miners').doc(miner).get();
    if (!minerDoc.data().enabled) {
        res.status(200).send("Miner disabled - " + miner);
        return;
    }

    const result = await common.cronMiner(miner, minerDoc.data().provider);
    res.json(result);
});