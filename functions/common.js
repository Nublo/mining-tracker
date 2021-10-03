const Web3 = require('web3');
let web3 = new Web3(Web3.givenProvider || "ws://localhost:8545");
const providers = require('./providers')
const db = providers.admin.firestore();

module.exports = {
    isMinerExists: async function (miner) {
        const minerDoc = await db.collection('miners').doc(miner).get();
        return minerDoc.exists;
    },
    collectMinersData: async function() {
        return collectMinersData()
    },
    cronMiner: async function(miner, provider) {
        return cronMiner(miner, provider);
    },
    db,
    web3
};

async function collectMinersData() {
    const miners = await db.collection('miners').get();
    miners.forEach(async doc => {
        console.log("Processing:" + doc.id + "; enabled=" + doc.data().enabled +
            "; provider=" + doc.data().provider);
        if (doc.data().enabled) {
            await cronMiner(doc.id, doc.data().provider);
        }
    });
}

async function cronMiner(miner, provider) {
    const snapshot = await db
        .collection('miners')
        .doc(miner)
        .collection('unpaidDaily')
        .orderBy('date', 'desc')
        .limit(1)
        .get();
    const previousUnpaid = snapshot.docs[0].data().unpaid;
    const data = await providers.getMinerData(miner, provider, previousUnpaid, false)
    await db.collection('miners').doc(miner).collection('unpaidDaily').add(data);
    return data;
}