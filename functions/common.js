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
    cronMiner: async function(miner, provider, channelId) {
        return cronMiner(miner, provider, channelId);
    },
    db,
    web3
};

async function collectMinersData() {
    const miners = await db.collection('miners').get();
    const updateMiners = [];
    miners.forEach(async doc => {
        try {
            const lastUpdate = doc.data().lastUpdate.toDate();
            const isEnabled = doc.data().enabled && isBeforeToday(lastUpdate);
            if (isEnabled) {
                updateMiners.push(
                    cronMiner(
                        doc.id,
                        doc.data().provider,
                        doc.data().channelId
                    )
                )
            }
            console.log(
                doc.id +
                "; enabled=" + doc.data().enabled +
                "; provider=" + doc.data().provider +
                "; lastUpdate=" + lastUpdate.toDateString() +
                "; isEnabled=" + isEnabled
            );
        } catch (error) {
            console.log(error);
            sendErrorInfo(error, doc.id, false);
        }
    });
    await Promise.all(updateMiners);
}

function isBeforeToday(before) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    before.setHours(0,0,0,0);
    return before.getTime() < now.getTime();
}

async function cronMiner(miner, provider, channelId) {
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
        if (channelId) {
            reportCollectedData(data, miner, channelId)
        }
        return data;
    } catch (error) {
        console.log(error);
        sendErrorInfo(error, miner, true);
    }
}

function reportCollectedData(data, miner, channelId) {
    const copyData = {};
    copyData.averageHashRate = Number(data.average.toFixed(2));
    copyData.maxStale = Number((data.maxStale * 100).toFixed(2));
    copyData.averageStale = Number((data.staleAverage * 100).toFixed(2));
    bot.telegram.sendMessage(
        channelId,
        miner + "\n```\n" + JSON.stringify(copyData, null, 2) + "\n```",
        { parse_mode: 'MarkdownV2' }
    );
}

function sendErrorInfo(error, miner, withRetry) {
    const chatId = functions.config().config.chat_id;
    bot.telegram.sendMessage(chatId, "MiningTrackerGroup - " + error.message);
    if (withRetry) {
        const retryLink = 'https://us-central1-miningtrackergroup.cloudfunctions.net/api/collect/' + miner; // TODO hardcoded to specific deployemnt
        bot.telegram.sendMessage(
            chatId,
            "Retry for <a href=\"" + retryLink + "\">" + miner + "</a>",
            {"parse_mode": "HTML"}
        )
    }
}