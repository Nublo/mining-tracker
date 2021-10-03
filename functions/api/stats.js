const functions = require("firebase-functions");
const common = require('../common')

exports.stats = functions.https.onRequest(async (req, res) => {
    const miner = req.params.miner;
    const isAddress = common.web3.utils.isAddress(miner)
    if (!isAddress) {
        res.status(400).send("Not a valid ETH address: " + miner);
        return;
    }

    const minerExistsResult = await common.isMinerExists(miner);
    if (!minerExistsResult) {
        res.status(400).send(miner + " - unknown miner");
        return;
    }

    let hashRate = 0;
    if (req.query.hashRate) {
        hashRate = req.query.hashRate;
    } else {
        let minerRef = await common.db.collection('miners').doc(miner).get();
        hashRate = minerRef.data().hashRate;
    }
    console.log("hashRate - " + hashRate);

    let endDate = new Date();
    endDate.setHours(0, 0, 0);

    let startDate = new Date(endDate);
    startDate.setMonth(startDate.getMonth() - 1); // set start 1 month before
    endDate.setDate(endDate.getDate() + 1); // set end to tomorrow

    if (req.query.endDate) {
        endDate = new Date(String(req.query.endDate));
        console.log("endDate - " + req.query.endDate)
    }
    if (req.query.startDate) {
        startDate = new Date(String(req.query.startDate));
        console.log("startDate - " + req.query.startDate)
    }
    const events = await common.db
        .collection('miners')
        .doc(miner)
        .collection('unpaidDaily')
        .where('date', '>=', startDate)
        .where('date', '<', endDate)
        .orderBy('date', 'desc')
        .get();
    const stats = [];
    let missed = 0;
    events.forEach((doc) => {
        const entry = {};
        entry.date = doc.data().date.toDate().toDateString();
        entry.average = doc.data().average;
        entry.unpaid = doc.data().unpaid;
        entry.diff = doc.data().diff;
        stats.push(entry);

        if (entry.average && entry.diff && entry.average < hashRate) {
            missed += entry.diff * (1 - (entry.average / hashRate));
        }
    });
    const computationParams = {
        'MH/s' : hashRate,
        start: startDate.toDateString(),
        end: endDate.toDateString()
    };
    const jsonAnswer = {};
    jsonAnswer.computationParams = computationParams;
    jsonAnswer.missed = {
        total: missed,
        half: missed / 2
    };
    jsonAnswer.stats = stats;
    res.set('Cache-Control', 'public, max-age=1800, s-maxage=1800');
    res.json(jsonAnswer);
});