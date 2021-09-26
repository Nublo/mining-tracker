const functions = require("firebase-functions");
const fetch = require("node-fetch");
const Web3 = require('web3');
let web3 = new Web3(Web3.givenProvider || "ws://localhost:8545");

const admin = require('firebase-admin');
admin.initializeApp();

exports.setupMiner = functions.https.onRequest(async (req, res) => {
    const validateResult = await validateMinerSetup(req.path.split('/').pop(), req.query.hashRate);

    if (validateResult.isError) {
        res.status(400).send(validateResult.error);
        return;
    }

    const result = await setupMiner(validateResult.miner, validateResult.hashRate);
    res.json(result);
});

async function validateMinerSetup(miner, hashRate) {
    const result = {};
    if (!miner.startsWith("0x")) {
        miner = "0x" + miner;
    }

    const isAddress = web3.utils.isAddress(miner);
    if (!isAddress) {
        result.isError = true;
        result.error = "Not a valid ETH address: " + miner;
        return result;
    }

    const minerExistsResult = await isMinerExists(miner);
    if (minerExistsResult) {
        result.isError = true;
        result.error = miner + " already has been added";
        return result;
    }

    if (!hashRate) {
        result.isError = true;
        result.error = "Provide hashRate for setup {url}?hashRate=300";
        return result;
    }

    result.isError = false;
    result.hashRate = hashRate;
    result.miner = miner;
    return result;
}

async function setupMiner(miner, hashRate) {
    const minerUrl = 'https://api.ethermine.org/miner/' + miner + '/dashboard';
    const json = await fetch(minerUrl, {method: "Get"}).then(response => response.json());

    const data = {
        average: averageHashes(json),
        unpaid: minedEth(json),
        date: admin.firestore.Timestamp.fromDate(new Date()),
        diff: 0
    };
    await admin.firestore().collection('miners').doc(miner).set(
        {
            hashRate: parseInt(hashRate),
            enabled: true
        }
    );
    await admin.firestore().collection('miners').doc(miner).collection('unpaidDaily').add(data);
    return data;
}

exports.stats = functions.https.onRequest(async (req, res) => {
    const miner = req.path.split('/').pop();
    const isAddress = web3.utils.isAddress(miner)
    if (!isAddress) {
        res.status(400).send("Not a valid ETH address: " + miner);
        return;
    }

    const minerExistsResult = await isMinerExists(miner);
    if (!minerExistsResult) {
        res.status(400).send(miner + " - unknown miner");
        return;
    }

    let hashRate = 0;
    if (req.query.hashRate) {
        hashRate = req.query.hashRate;
    } else {
        let minerRef = await admin.firestore().collection('miners').doc(miner).get();
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
    const events = await admin.firestore()
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
        MH: hashRate,
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

exports.cronJob = functions.pubsub.schedule('0 10 * * *').onRun(async () => {
    const miners = await admin.firestore().collection('miners').get();
    miners.forEach(async doc => {
        console.log("Processing:" + doc.id + "; enabled=" + doc.data().enabled);
        if (doc.data().enabled) {
            await cronMiner(doc.id);
        }
    });
});

exports.collect = functions.https.onRequest(async (req, res) => {
    let miner = req.path.split('/').pop();
    if (!miner.startsWith("0x")) {
        miner = "0x" + miner;
    }
    const minerExistsResult = await isMinerExists(miner);
    if (!minerExistsResult) {
        res.status(400).send("Unknown miner - " + miner);
        return;
    }

    const minerDoc = await admin.firestore().collection('miners').doc(miner).get();
    if (!minerDoc.data().enabled) {
        res.status(200).send("Miner disabled - " + miner);
        return;
    }

    const result = await cronMiner(miner);
    res.json(result);
});

async function cronMiner(miner) {
    const baseUrl = 'https://api.ethermine.org/miner/' + miner;
    const minerUrl = baseUrl + '/dashboard';
    const payoutsUrl = baseUrl + '/payouts';

    const json = await fetch(minerUrl, {method: "Get"}).then(response => response.json());
    const unpaid = minedEth(json);

    const snapshot = await admin.firestore()
        .collection('miners')
        .doc(miner)
        .collection('unpaidDaily')
        .orderBy('date', 'desc')
        .limit(1)
        .get();
    const previousUnpaid = snapshot.docs[0].data().unpaid;
    let diff;
    if (unpaid >= previousUnpaid) {
        diff = unpaid - previousUnpaid;
    } else {
        const payoutJson = await fetch(payoutsUrl, {method: "Get"}).then(response => response.json());
        const payout = new web3.utils.BN(String(payoutJson.data[0].amount));
        const latestPayout = parseFloat(web3.utils.fromWei(payout, 'ether'));
        diff = unpaid + (latestPayout - previousUnpaid);
    }

    const data = {
        average: averageHashes(json),
        unpaid: unpaid,
        date: admin.firestore.Timestamp.fromDate(new Date()),
        diff: diff
    };

    await admin.firestore().collection('miners').doc(miner).collection('unpaidDaily').add(data);
    return data;
}

async function isMinerExists(miner) {
    const minerDoc = await admin.firestore().collection('miners').doc(miner).get();
    return minerDoc.exists;
}

/**
 * @param {Object[]} json.data.statistics - holds current miner stats
 * @param {number} json.data.statistics[].reportedHashrate - reported miner hashRate
 */
function averageHashes(json) {
    const stats = json.data.statistics;
    let average = 0;
    for (let i = 0; i < stats.length; i++) {
        average += (stats[i].reportedHashrate / 1000000);
    }
    return average / stats.length;
}

/**
 * @param {number} json.data.currentStatistics.unpaid - miner current statistics
 */
function minedEth(json) {
    const unpaid = new web3.utils.BN(String(json.data.currentStatistics.unpaid));
    return parseFloat(web3.utils.fromWei(unpaid, 'ether'));
}