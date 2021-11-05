const Web3 = require('web3');
const fetch = require("node-fetch");
const admin = require("firebase-admin");
admin.initializeApp()
let web3 = new Web3(Web3.givenProvider || "ws://localhost:8545");

const providers = {
    ETHERMINE: "ethermine",
    HIVEON: "hiveon"
}

module.exports = {
    getMinerData: async function(miner, provider, previousUnpaid, isSetup) {
        return getMinerData(miner, provider, previousUnpaid, isSetup);
    },
    admin,
    providers
}

class ApiUrls {

    minerUrl
    payoutsUrl

    constructor(minerUrl, payoutsUrl) {
        this.minerUrl = minerUrl
        this.payoutsUrl = payoutsUrl
    }

}

function minerAndProviderToApiUrls(miner, provider) {
    switch (provider) {
        case providers.ETHERMINE:
            const baseUrlEthermine = 'https://api.ethermine.org/miner/' + miner;
            const minerUrlEthemine = baseUrlEthermine + '/dashboard';
            const payoutsUrlEthermine = baseUrlEthermine + '/payouts';
            return new ApiUrls(minerUrlEthemine, payoutsUrlEthermine)
        case providers.HIVEON:
            const baseUrlHiveon = 'https://hiveon.net/api/v1/stats/miner/' + miner;
            const minerUrlHiveon = baseUrlHiveon + '/ETH';
            const payoutsUrlHiveon = minerUrlHiveon + '/billing-acc';
            return new ApiUrls(minerUrlHiveon, payoutsUrlHiveon)
    }
}

async function getMinerData(miner, provider, previousUnpaid, isSetup) {
    const apiUrl = minerAndProviderToApiUrls(miner, provider)
    switch (provider) {
        case providers.ETHERMINE:
            return await getEtherMineData(apiUrl, previousUnpaid, isSetup);
        case providers.HIVEON:
            return await getHiveonData(apiUrl, previousUnpaid, isSetup);
    }
}

async function getEtherMineData(apiUrl, previousUnpaid, isSetup) {
    const json = await fetch(apiUrl.minerUrl, {method: "Get"}).then(response => response.json());
    const unpaidWei = new web3.utils.BN(String(json.data.currentStatistics.unpaid));
    const unpaid = parseFloat(web3.utils.fromWei(unpaidWei, 'ether'));
    let diff;
    if (isSetup) {
        diff = 0;
    } else if (unpaid >= previousUnpaid) {
        diff = unpaid - previousUnpaid;
    } else {
        const payoutJson = await fetch(apiUrl.payoutsUrl, {method: "Get"}).then(response => response.json());
        const payout = new web3.utils.BN(String(payoutJson.data[0].amount));
        const latestPayout = parseFloat(web3.utils.fromWei(payout, 'ether'));
        diff = unpaid + (latestPayout - previousUnpaid);
    }

    return {
        average: averageHashRateEthemine(json),
        unpaid: unpaid,
        date: admin.firestore.Timestamp.fromDate(new Date()),
        diff: diff
    };
}

/**
 * @param {Object[]} json.data.statistics - holds current miner stats
 * @param {number} json.data.statistics[].currentHashrate - reported miner hashRate
 */
function averageHashRateEthemine(json) {
    const stats = json.data.statistics;
    let average = 0;
    for (let i = 0; i < stats.length; i++) {
        average += (stats[i].currentHashrate / 1000000);
    }
    return average / stats.length;
}

async function getHiveonData(apiUrl, previousUnpaid, isSetup) {
    const json = await fetch(apiUrl.minerUrl, { method: "Get" }).then(response => response.json());
    const average = parseInt(json.hashrate24h) / 1000000;

    const unpaidJson = await fetch(apiUrl.payoutsUrl, {method:"Get"}).then(response => response.json());
    const unpaid = unpaidJson.totalUnpaid;

    let diff;
    if (isSetup) {
        diff = 0;
    } else if (unpaid > previousUnpaid) {
        diff = unpaid - previousUnpaid;
    } else {
        const latestPayout = 0.1; // TODO fix to properly collect data from the API about latest payout
        diff = unpaid + (latestPayout - previousUnpaid);
    }

    return {
        average: average,
        unpaid: unpaid,
        date: admin.firestore.Timestamp.fromDate(new Date()),
        diff: diff
    };
}