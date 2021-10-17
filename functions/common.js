const Web3 = require('web3');
let web3 = new Web3(Web3.givenProvider || "ws://localhost:8545");
const providers = require('./providers')
const admin = require("firebase-admin");
const db = providers.admin.firestore();

const functions = require("firebase-functions");
const { Telegraf } = require('telegraf')
const bot = new Telegraf(functions.config().config.bot_id)

module.exports = {
    isMinerExists: async function (miner) {
        const minerDoc = await db.collection('miners').doc(miner).get();
        return minerDoc.exists;
    },
    collectMinersData: async function() {
        await collectMinersData();
    },
    cronMiner: async function(miner, provider) {
        return cronMiner(miner, provider);
    },
    db,
    web3
};

async function collectMinersData() {
    const miners = await db.collection('miners').get();
    const now = new Date();
    now.setHours(0,0,0,0)

    miners.forEach(async doc => {
        const lastUpdate = doc.data().lastUpdate.toDate();
        lastUpdate.setHours(0,0,0,0);

        const isEnabled = doc.data().enabled && lastUpdate.getTime() < now.getTime();
        if (isEnabled) {
            await cronMiner(doc.id, doc.data().provider);
        }
        console.log(
            doc.id +
            "; enabled=" + doc.data().enabled +
            "; provider=" + doc.data().provider +
            "; lastUpdate=" + lastUpdate.toDateString() +
            "; isEnabled=" + isEnabled
        );
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
    try {
        const data = await providers.getMinerData(miner, provider, previousUnpaid, false)
        await db.runTransaction(async (_) => {
            const minerRef = db.collection('miners').doc(miner);
            await minerRef.collection('unpaidDaily').add(data);
            await minerRef.update({lastUpdate: admin.firestore.Timestamp.fromDate(new Date())});
        });
        return data;
    } catch (error) {
        console.log(error);
        sendErrorInfo(error, miner);
    }
}

function sendErrorInfo(error, miner) {
    const recollectLink = 'https://us-central1-miningtrackergroup.cloudfunctions.net/api/collect/' + miner; // TODO hardcoded to specific deployemnt
    const chatId = functions.config().config.chat_id;
    bot.telegram.sendMessage(chatId, "MiningTrackerGroup - " + error.message);
    bot.telegram.sendMessage(
        chatId,
        "Retry for <a href=\"" + recollectLink + "\">" + miner + "</a>",
        {"parse_mode": "HTML"}
    )
}