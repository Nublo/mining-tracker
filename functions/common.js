const admin = require("firebase-admin");
admin.initializeApp()

const fetch = require("node-fetch");
const Web3 = require('web3');
let web3 = new Web3(Web3.givenProvider || "ws://localhost:8545");
const db = admin.firestore();

module.exports = {
    isMinerExists: async function (miner) {
        const minerDoc = await admin.firestore().collection('miners').doc(miner).get();
        return minerDoc.exists;
    },
    collectMinersData: async function() {
        return collectMinersData()
    },
    cronMiner: async function(miner) {
        return cronMiner(miner);
    },
    db,
    web3
};

async function collectMinersData() {
    const miners = await db.collection('miners').get();
    miners.forEach(async doc => {
        console.log("Processing:" + doc.id + "; enabled=" + doc.data().enabled);
        if (doc.data().enabled) {
            await cronMiner(doc.id);
        }
    });
}

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